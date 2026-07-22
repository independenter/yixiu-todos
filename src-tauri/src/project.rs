// project.rs — 项目管理 + 任务分组

use tauri::State;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use crate::db::DbState;

#[derive(Debug, Serialize, Deserialize)]
pub struct ProjectInput {
    pub name: String,
    pub description: Option<String>,
    pub priority: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct ProjectRow {
    pub id: String,
    pub name: String,
    pub description: String,
    pub priority: i64,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize)]
pub struct ProjectWithStats {
    pub id: String,
    pub name: String,
    pub description: String,
    pub priority: i64,
    pub status: String,
    pub member_count: i64,
    pub task_total: i64,
    pub task_done: i64,
    pub overload_count: i64,   // 超载成员数
}

#[derive(Debug, Serialize)]
pub struct ProjectTaskRow {
    pub id: String,
    pub employee_id: String,
    pub employee_name: String,
    pub title: String,
    pub priority: i64,
    pub global_priority: i64,
    pub project_priority: i64,
    pub start_time: String,
    pub end_time: String,
    pub effort_percent: i64,
    pub progress: i64,
    pub status: String,
}

// ─── 1. 创建项目 ──
#[tauri::command]
pub fn create_project(
    state: State<'_, DbState>,
    input: ProjectInput,
) -> Result<String, String> {
    let conn = state.conn.lock().unwrap();
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO projects (id,name,description,priority,status,created_at,updated_at) VALUES (?1,?2,?3,?4,'active',?5,?6)",
        params![id, input.name, input.description.unwrap_or_default(), input.priority.unwrap_or(2), now, now],
    ).map_err(|e| e.to_string())?;
    Ok(id)
}

// ─── 2. 列出项目（含统计） ──
#[tauri::command]
pub fn list_projects(state: State<'_, DbState>) -> Result<Vec<ProjectWithStats>, String> {
    let conn = state.conn.lock().unwrap();
    let mut s = conn.prepare(
        "SELECT p.id,p.name,p.description,p.priority,p.status,p.created_at,p.updated_at,
                (SELECT COUNT(DISTINCT employee_id) FROM employee_tasks WHERE project_id=p.id) as member_count,
                (SELECT COUNT(*) FROM employee_tasks WHERE project_id=p.id) as task_total,
                (SELECT COUNT(*) FROM employee_tasks WHERE project_id=p.id AND status='done') as task_done
         FROM projects p WHERE p.status='active' ORDER BY p.priority, p.created_at"
    ).map_err(|e| e.to_string())?;
    let rows = s.query_map([], |r| {
        let id: String = r.get(0)?;
        // Check overload for this project's members
        Ok(ProjectWithStats {
            id, name: r.get(1)?, description: r.get(2)?,
            priority: r.get(3)?, status: r.get(4)?,
            member_count: r.get::<_, i64>(7).unwrap_or(0),
            task_total: r.get::<_, i64>(8).unwrap_or(0),
            task_done: r.get::<_, i64>(9).unwrap_or(0),
            overload_count: 0, // simplified; frontend can compute
        })
    }).map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows { out.push(r.map_err(|e| e.to_string())?); }
    Ok(out)
}

// ─── 3. 列出项目下所有任务 ──
#[tauri::command]
pub fn list_project_tasks(
    state: State<'_, DbState>,
    project_id: String,
) -> Result<Vec<ProjectTaskRow>, String> {
    let conn = state.conn.lock().unwrap();
    let mut s = conn.prepare(
        "SELECT et.id,et.employee_id,e.name,et.title,et.priority,et.global_priority,et.project_priority,
                et.start_time,et.end_time,et.effort_percent,et.progress,et.status
         FROM employee_tasks et JOIN employees e ON et.employee_id=e.id
         WHERE et.project_id=?1 ORDER BY et.global_priority"
    ).map_err(|e| e.to_string())?;
    let rows = s.query_map(params![project_id], |r| Ok(ProjectTaskRow {
        id: r.get(0)?, employee_id: r.get(1)?, employee_name: r.get(2)?,
        title: r.get(3)?, priority: r.get(4)?, global_priority: r.get(5)?,
        project_priority: r.get(6)?, start_time: r.get(7)?, end_time: r.get(8)?,
        effort_percent: r.get(9)?, progress: r.get(10)?, status: r.get(11)?,
    })).map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows { out.push(r.map_err(|e| e.to_string())?); }
    Ok(out)
}

// ─── 4. 更新项目 ──
#[tauri::command]
pub fn update_project(
    state: State<'_, DbState>,
    id: String,
    input: ProjectInput,
) -> Result<(), String> {
    let conn = state.conn.lock().unwrap();
    conn.execute(
        "UPDATE projects SET name=?1,description=?2,priority=?3,updated_at=?4 WHERE id=?5",
        params![input.name, input.description.unwrap_or_default(), input.priority.unwrap_or(2), chrono::Utc::now().to_rfc3339(), id],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

// ─── 5. 删除项目 ──
#[tauri::command]
pub fn delete_project(
    state: State<'_, DbState>,
    id: String,
) -> Result<(), String> {
    let conn = state.conn.lock().unwrap();
    // 解除关联任务的 project_id
    let _ = conn.execute("UPDATE employee_tasks SET project_id=NULL WHERE project_id=?1", params![id]);
    conn.execute("DELETE FROM projects WHERE id=?1", params![id]).map_err(|e| e.to_string())?;
    Ok(())
}

// ─── 6. 更新任务优先级（双优先级联动） ──
#[tauri::command]
pub fn update_task_priority(
    state: State<'_, DbState>,
    task_id: String,
    new_global_priority: i64,
) -> Result<(), String> {
    let conn = state.conn.lock().unwrap();
    conn.execute("UPDATE employee_tasks SET global_priority=?1 WHERE id=?2",
        params![new_global_priority, task_id]).map_err(|e| e.to_string())?;
    // 重算同一项目内的 project_priority
    let project_id: Option<String> = conn.query_row(
        "SELECT project_id FROM employee_tasks WHERE id=?1", params![task_id], |r| r.get(0)
    ).unwrap_or(None);
    if let Some(pid) = project_id {
        let mut s = conn.prepare(
            "SELECT id FROM employee_tasks WHERE project_id=?1 ORDER BY global_priority"
        ).unwrap();
        let ids: Vec<String> = s.query_map(params![pid], |r| r.get(0)).unwrap().filter_map(|r| r.ok()).collect();
        for (i, tid) in ids.iter().enumerate() {
            let _ = conn.execute("UPDATE employee_tasks SET project_priority=?1 WHERE id=?2", params![i as i64, tid]);
        }
    }
    Ok(())
}
