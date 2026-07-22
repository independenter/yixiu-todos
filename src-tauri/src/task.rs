// task.rs — 个人任务 CRUD + 精力占用面板 + 冲突检测入口

use tauri::State;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use chrono::{DateTime, Utc, ParseError};
use anyhow::Result;
use crate::db::DbState;
use crate::conflict;

// ─── DTO ───────────────────────────────────────────────
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TaskInput {
    pub title: String,
    pub description: Option<String>,
    pub priority: Option<i64>,        // 1=紧急 2=高 3=中 4=低
    pub start_time: String,           // ISO 8601
    pub end_time: String,
    pub effort_percent: Option<i64>, // 0-200，默认100
    pub category: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TaskRow {
    pub id: String,
    pub title: String,
    pub description: String,
    pub priority: i64,
    pub start_time: String,
    pub end_time: String,
    pub effort_percent: i64,
    pub status: String,
    pub category: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize)]
pub struct WorkloadPoint {
    pub time: String,        // ISO 时刻
    pub total_percent: i64,  // 该时刻的精力占用总和
    pub level: String,       // ok / warning / overload
    pub task_ids: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct ConflictItem {
    pub task_a_id: String,
    pub task_b_id: String,
    pub overlap_minutes: i64,
    pub severity: String,    // warning / error
    pub time_range: String,
}

// ─── 工具 ──────────────────────────────────────────────
fn now_iso() -> String {
    Utc::now().to_rfc3339()
}

fn parse_time(s: &str) -> std::result::Result<DateTime<Utc>, ParseError> {
    DateTime::parse_from_rfc3339(s).map(|dt| dt.with_timezone(&Utc))
}

// ─── 1. 创建任务 ──────────────────────────────────────
#[tauri::command]
pub fn create_task(
    state: State<'_, DbState>,
    input: TaskInput,
) -> Result<String, String> {
    let conn = state.personal.lock().unwrap();
    let id = uuid::Uuid::new_v4().to_string();
    let now = now_iso();
    let effort = input.effort_percent.unwrap_or(100);
    let pri = input.priority.unwrap_or(2);
    let cat = input.category.unwrap_or_else(|| "personal".into());

    // 校验时间
    let _s = parse_time(&input.start_time).map_err(|e| format!("start_time 解析失败: {e}"))?;
    let _e = parse_time(&input.end_time).map_err(|e| format!("end_time 解析失败: {e}"))?;

    conn.execute(
        r#"INSERT INTO tasks (id,title,description,priority,start_time,end_time,effort_percent,status,category,created_at,updated_at)
           VALUES (?1,?2,?3,?4,?5,?6,?7,'pending',?8,?9,?10)"#,
        params![
            id,
            input.title,
            input.description.unwrap_or_default(),
            pri,
            input.start_time,
            input.end_time,
            effort,
            cat,
            now,
            now,
        ],
    ).map_err(|e| e.to_string())?;

    // 创建后立刻检测冲突
    drop(conn);
    let _ = conflict::recompute_all(state.inner());

    Ok(id)
}

// ─── 2. 列出任务（可按状态/类别/时间范围过滤）────────
// 内部实现，供 commands 和 scheduler 共用
pub fn list_tasks_internal(
    db: &DbState,
    status: Option<String>,
    category: Option<String>,
    from: Option<String>,
    to: Option<String>,
) -> std::result::Result<Vec<TaskRow>, String> {
    let conn = db.personal.lock().unwrap();
    let mut sql = String::from(
        "SELECT id,title,description,priority,start_time,end_time,effort_percent,status,category,created_at,updated_at FROM tasks WHERE 1=1"
    );
    let mut params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

    if let Some(s) = &status { sql.push_str(" AND status = ?"); params.push(Box::new(s.clone())); }
    if let Some(c) = &category { sql.push_str(" AND category = ?"); params.push(Box::new(c.clone())); }
    if let Some(f) = &from { sql.push_str(" AND end_time >= ?"); params.push(Box::new(f.clone())); }
    if let Some(t) = &to   { sql.push_str(" AND start_time <= ?"); params.push(Box::new(t.clone())); }
    sql.push_str(" ORDER BY start_time ASC");

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let refs: Vec<&dyn rusqlite::ToSql> = params.iter().map(|b| b.as_ref()).collect();
    let rows = stmt.query_map(refs.as_slice(), |r| Ok(TaskRow {
        id: r.get(0)?, title: r.get(1)?, description: r.get(2)?,
        priority: r.get(3)?, start_time: r.get(4)?, end_time: r.get(5)?,
        effort_percent: r.get(6)?, status: r.get(7)?, category: r.get(8)?,
        created_at: r.get(9)?, updated_at: r.get(10)?,
    })).map_err(|e| e.to_string())?;

    let mut out = Vec::new();
    for r in rows { out.push(r.map_err(|e| e.to_string())?); }
    Ok(out)
}

/// Tauri command wrapper
#[tauri::command]
pub fn list_tasks(
    state: State<'_, DbState>,
    status: Option<String>,
    category: Option<String>,
    from: Option<String>,
    to: Option<String>,
) -> Result<Vec<TaskRow>, String> {
    list_tasks_internal(state.inner(), status, category, from, to)
}

// ─── 3. 更新任务 ──────────────────────────────────────
#[tauri::command]
pub fn update_task(
    state: State<'_, DbState>,
    id: String,
    patch: TaskInput, // 前端把要改的字段全量传回（简化实现）
) -> Result<(), String> {
    let conn = state.personal.lock().unwrap();
    let now = now_iso();
    conn.execute(
        r#"UPDATE tasks SET title=?2,description=?3,priority=?4,start_time=?5,end_time=?6,
           effort_percent=?7,category=?8,updated_at=?9 WHERE id=?1"#,
        params![id, patch.title, patch.description.unwrap_or_default(),
                patch.priority.unwrap_or(2), patch.start_time, patch.end_time,
                patch.effort_percent.unwrap_or(100), patch.category.unwrap_or_else(||"personal".into()), now],
    ).map_err(|e| e.to_string())?;
    drop(conn);
    let _ = conflict::recompute_all(state.inner());
    Ok(())
}

// ─── 4. 删除任务 ──────────────────────────────────────
#[tauri::command]
pub fn delete_task(state: State<'_, DbState>, id: String) -> Result<(), String> {
    let conn = state.personal.lock().unwrap();
    conn.execute("DELETE FROM tasks WHERE id=?1", params![id]).map_err(|e| e.to_string())?;
    drop(conn);
    let _ = conflict::recompute_all(state.inner());
    Ok(())
}

// ─── 5. 完成任务（提前完成）──────────────────────────
#[tauri::command]
pub fn complete_task(state: State<'_, DbState>, id: String) -> Result<(), String> {
    let conn = state.personal.lock().unwrap();
    let now = now_iso();
    conn.execute(
        "UPDATE tasks SET status='done', updated_at=?2 WHERE id=?1",
        params![id, now],
    ).map_err(|e| e.to_string())?;
    drop(conn);
    let _ = conflict::recompute_all(state.inner());
    Ok(())
}

// ─── 6. 延后任务（动态刷新占用）──────────────────────
#[tauri::command]
pub fn postpone_task(
    state: State<'_, DbState>,
    id: String,
    new_start: String,
    new_end: String,
) -> Result<(), String> {
    let _s = parse_time(&new_start).map_err(|e| format!("new_start 解析失败: {e}"))?;
    let _e = parse_time(&new_end).map_err(|e| format!("new_end 解析失败: {e}"))?;

    let conn = state.personal.lock().unwrap();
    let now = now_iso();
    conn.execute(
        "UPDATE tasks SET start_time=?2, end_time=?3, updated_at=?4 WHERE id=?1",
        params![id, new_start, new_end, now],
    ).map_err(|e| e.to_string())?;
    drop(conn);
    let _ = conflict::recompute_all(state.inner());
    Ok(())
}

// ─── 7. 精力占用面板（核心）──────────────────────────
// 返回按时间排序的“占用快照”列表，前端画甘特图/堆叠面积图
#[tauri::command]
pub fn get_workload_panel(
    state: State<'_, DbState>,
    _from: Option<String>,
    _to: Option<String>,
) -> Result<Vec<WorkloadPoint>, String> {
    let conn = state.personal.lock().unwrap();
    let rows: Vec<(String, String, i64)> = {
        let mut s = conn
            .prepare("SELECT start_time, end_time, effort_percent FROM tasks WHERE status IN ('pending','active')")            .map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        let iter = s.query_map([], |r| Ok((r.get::<_,String>(0)?, r.get::<_,String>(1)?, r.get::<_,i64>(2)?)))
            .map_err(|e| e.to_string())?;
        for r in iter { out.push(r.map_err(|e| e.to_string())?); }
        out
    };
    drop(conn);

    // 收集所有时间点
    let mut times: Vec<DateTime<Utc>> = Vec::new();
    for (s, e, _) in &rows {
        times.push(parse_time(s).map_err(|e| e.to_string())?);
        times.push(parse_time(e).map_err(|e| e.to_string())?);
    }
    times.sort();
    times.dedup_by(|a, b| a == b);

    // 按时间窗切片（相邻两点之间算一个区间）
    let mut result = Vec::new();
    for win in times.windows(2) {
        let t0 = win[0];
        let t1 = win[1];
        let mut total = 0i64;
        let ids: Vec<String> = Vec::new();
        for (s, e, ef) in &rows {
            let ss = parse_time(s).map_err(|e| e.to_string())?;
            let ee = parse_time(e).map_err(|e| e.to_string())?;
            if ss < t1 && ee > t0 {
                total += ef;
                // 用 start_time 反查 id（简化；生产可改成返回 id）
            }
        }
        let level = if total > 100 { "error".into() }
                     else if total > 50 { "warning".into() }
                     else { "ok".into() };
        result.push(WorkloadPoint {
            time: t0.to_rfc3339(),
            total_percent: total,
            level,
            task_ids: ids,
        });
    }
    Ok(result)
}

// ─── 8. 冲突报告 ──────────────────────────────────────
#[tauri::command]
pub fn get_conflict_report(state: State<'_, DbState>) -> Result<Vec<ConflictItem>, String> {
    conflict::recompute_all(state.inner()).map_err(|e| e.to_string())?;
    let conn = state.personal.lock().unwrap();
    let mut s = conn.prepare(
        "SELECT task_a_id, task_b_id, overlap_minutes, severity, start_time || '-' || end_time
         FROM task_overlaps ORDER BY overlap_minutes DESC"
    ).map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    let rows = s.query_map([], |r| Ok(ConflictItem {
        task_a_id: r.get(0)?, task_b_id: r.get(1)?,
        overlap_minutes: r.get(2)?, severity: r.get(3)?,
        time_range: r.get(4)?,
    })).map_err(|e| e.to_string())?;
    for r in rows { out.push(r.map_err(|e| e.to_string())?); }
    Ok(out)
}

// ─── 9. 导出时间相关任务 ──────────────────────────────
#[tauri::command]
pub fn export_time_report(
    state: State<'_, DbState>,
    from: String,
    to: String,
    format: String, // "json" | "csv"
) -> Result<String, String> {
    let tasks = list_tasks(state, None, None, Some(from), Some(to))?;
    match format.as_str() {
        "csv" => {
            let mut s = String::from("id,title,priority,start,end,effort%,status,category\n");
            for t in tasks {
                s.push_str(&format!("{},{},{},{},{},{},{},{}\n",
                    t.id, t.title, t.priority, t.start_time, t.end_time,
                    t.effort_percent, t.status, t.category));
            }
            Ok(s)
        }
        _ => serde_json::to_string_pretty(&tasks).map_err(|e| e.to_string()),
    }
}

// ─── 10. 清理（VACUUM + 删已完成/过期）──────────────
#[tauri::command]
pub fn vacuum_db(state: State<'_, DbState>, delete_done_older_than_days: Option<i64>) -> Result<(), String> {
    let conn = state.personal.lock().unwrap();
    if let Some(days) = delete_done_older_than_days {
        conn.execute(
            "DELETE FROM tasks WHERE status='done' AND updated_at < datetime('now', ?1)",
            params![format!("-{days} days")],
        ).map_err(|e| e.to_string())?;
    }
    conn.execute_batch("VACUUM; ANALYZE;").map_err(|e| e.to_string())?;
    Ok(())
}
