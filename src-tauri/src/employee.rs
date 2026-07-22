// employee.rs — 员工管理 + 任务分配 + 进度 + 告警
//
// 员工有自己独立的任务表 employee_tasks，结构与个人任务类似，
// 但多了 employee_id 与 progress（0-100）字段。

use tauri::State;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use chrono::Utc;
use crate::db::DbState;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct EmployeeInput {
    pub name: String,
    pub role: Option<String>,
    pub email: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct EmployeeRow {
    pub id: String,
    pub name: String,
    pub role: String,
    pub email: String,
    pub status: String,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct EmpTaskInput {
    pub employee_id: String,
    pub title: String,
    pub description: Option<String>,
    pub priority: Option<i64>,
    pub start_time: String,
    pub end_time: String,
    pub effort_percent: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct EmpTaskRow {
    pub id: String,
    pub employee_id: String,
    pub title: String,
    pub priority: i64,
    pub start_time: String,
    pub end_time: String,
    pub effort_percent: i64,
    pub progress: i64,
    pub status: String,
}

#[derive(Debug, Serialize)]
pub struct EmpWorkload {
    pub employee_id: String,
    pub name: String,
    pub total_percent: i64,
    pub active_tasks: i64,
    pub avg_progress: i64,
    pub alerts: Vec<String>,   // warning/error 文本
}

// ─── 1. 创建员工 ──────────────────────────────────────
#[tauri::command]
pub fn create_employee(
    state: State<'_, DbState>,
    input: EmployeeInput,
) -> Result<String, String> {
    let conn = state.conn.lock().unwrap();
    let id = uuid::Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO employees (id,name,role,email,status,created_at) VALUES (?1,?2,?3,?4,'active',?5)",
        params![id, input.name, input.role.unwrap_or_default(), input.email.unwrap_or_default(), now],
    ).map_err(|e| e.to_string())?;
    Ok(id)
}

// ─── 2. 列出员工 ──────────────────────────────────────
#[tauri::command]
pub fn list_employees(state: State<'_, DbState>) -> Result<Vec<EmployeeRow>, String> {
    let conn = state.conn.lock().unwrap();
    let mut s = conn.prepare(
        "SELECT id,name,role,email,status,created_at FROM employees WHERE status='active' ORDER BY name"
    ).map_err(|e| e.to_string())?;
    let rows = s.query_map([], |r| Ok(EmployeeRow {
        id: r.get(0)?, name: r.get(1)?, role: r.get(2)?,
        email: r.get(3)?, status: r.get(4)?, created_at: r.get(5)?,
    })).map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows { out.push(r.map_err(|e| e.to_string())?); }
    Ok(out)
}

// ─── 3. 给员工分配任务 ───────────────────────────────
#[tauri::command]
pub fn assign_task_to_employee(
    state: State<'_, DbState>,
    input: EmpTaskInput,
) -> Result<String, String> {
    let conn = state.conn.lock().unwrap();
    // 校验员工存在
    let cnt: i64 = conn.query_row(
        "SELECT COUNT(*) FROM employees WHERE id=?1 AND status='active'",
        params![input.employee_id], |r| r.get(0),
    ).map_err(|e| e.to_string())?;
    if cnt == 0 { return Err("员工不存在或已离职".into()); }

    let id = uuid::Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    conn.execute(
        r#"INSERT INTO employee_tasks
           (id,employee_id,title,description,priority,start_time,end_time,effort_percent,progress,status,created_at,updated_at)
           VALUES (?1,?2,?3,?4,?5,?6,?7,?8,0,'pending',?9,?10)"#,
        params![id, input.employee_id, input.title, input.description.unwrap_or_default(),
                input.priority.unwrap_or(2), input.start_time, input.end_time,
                input.effort_percent.unwrap_or(100), now, now],
    ).map_err(|e| e.to_string())?;
    Ok(id)
}

// ─── 4. 员工精力占用面板 ───────────────────────────────
#[tauri::command]
pub fn get_employee_workload(
    state: State<'_, DbState>,
    employee_id: String,
) -> Result<EmpWorkload, String> {
    let conn = state.conn.lock().unwrap();
    // 基本信息
    let name: String = conn.query_row(
        "SELECT name FROM employees WHERE id=?1", params![employee_id], |r| r.get(0),
    ).map_err(|e| e.to_string())?;

    // 活跃任务
    let mut s = conn.prepare(
        "SELECT id,employee_id,title,priority,start_time,end_time,effort_percent,progress,status
         FROM employee_tasks WHERE employee_id=?1 AND status IN ('pending','active')"
    ).map_err(|e| e.to_string())?;
    let rows: Vec<EmpTaskRow> = s.query_map(params![employee_id], |r| Ok(EmpTaskRow {
        id: r.get(0)?, employee_id: r.get(1)?, title: r.get(2)?,
        priority: r.get(3)?, start_time: r.get(4)?, end_time: r.get(5)?,
        effort_percent: r.get(6)?, progress: r.get(7)?, status: r.get(8)?,
    })).map_err(|e| e.to_string())?.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;

    let mut total = 0i64;
    let mut alerts: Vec<String> = Vec::new();
    for t in &rows {
        total += t.effort_percent;
    }
    if total > 100 {
        alerts.push(format!("精力占用 {}% 超过 100%，存在时间冲突", total));
    } else if total > 80 {
        alerts.push(format!("精力占用 {}%，接近上限", total));
    }

    // 检查时间重叠（简化：按 start_time 排序后两两比较）
    let mut sorted = rows.clone();
    sorted.sort_by(|a, b| a.start_time.cmp(&b.start_time));
    for i in 0..sorted.len() {
        for j in (i+1)..sorted.len() {
            if sorted[i].end_time > sorted[j].start_time {
                alerts.push(format!(
                    "任务冲突：{} 与 {} 时间重叠", sorted[i].title, sorted[j].title
                ));
            }
        }
    }

    let avg_prog = if rows.is_empty() { 0 } else {
        rows.iter().map(|t| t.progress).sum::<i64>() / rows.len() as i64
    };

    Ok(EmpWorkload {
        employee_id,
        name,
        total_percent: total,
        active_tasks: rows.len() as i64,
        avg_progress: avg_prog,
        alerts,
    })
}

// ─── 5. 更新员工任务进度 ───────────────────────────────
#[tauri::command]
pub fn update_employee_progress(
    state: State<'_, DbState>,
    task_id: String,
    progress: i64,        // 0-100
    status: Option<String>, // pending/active/done
) -> Result<(), String> {
    if !(0..=100).contains(&progress) { return Err("progress 必须在 0-100 之间".into()); }
    let conn = state.conn.lock().unwrap();
    let now = Utc::now().to_rfc3339();
    let st = status.unwrap_or_else(|| "active".into());
    conn.execute(
        "UPDATE employee_tasks SET progress=?2, status=?3, updated_at=?4 WHERE id=?1",
        params![task_id, progress, st, now],
    ).map_err(|e| e.to_string())?;
    Ok(())
}
