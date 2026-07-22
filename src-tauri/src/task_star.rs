// task_star.rs — STAR 任务定义事件管理
//
// 每个任务按 S/Situation / T/Task / A/Action / R/Result 分解，
// 每段可记录多条事件（note/blocker/pause/resume）。

use tauri::State;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use crate::db::DbState;
use rusqlite::OptionalExtension;

// ─── DTOs ──────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct StarEventInput {
    pub task_id: String,
    pub star_section: String,  // 'S' | 'T' | 'A' | 'R'
    pub content: String,
    pub event_type: Option<String>,  // 'note' | 'blocker' | 'pause' | 'resume'
}

#[derive(Debug, Serialize, Deserialize)]
pub struct StarEventRow {
    pub id: String,
    pub task_id: String,
    pub star_section: String,
    pub content: String,
    pub event_type: String,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct StarEventUpdate {
    pub event_id: String,
    pub content: Option<String>,
    pub event_type: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct TaskPauseStats {
    pub task_id: String,
    pub pause_count: i64,
    pub total_pause_seconds: i64,
    pub is_paused_now: bool,
    pub current_pause_reason: Option<String>,
    pub current_pause_since: Option<String>,
}

// ─── Commands ──────────────────────────────────────

#[tauri::command]
pub fn add_star_event(
    state: State<'_, DbState>,
    input: StarEventInput,
) -> Result<String, String> {
    // Validate star_section
    if !["S", "T", "A", "R"].contains(&input.star_section.as_str()) {
        return Err("star_section 必须是 S/T/A/R".into());
    }
    if input.content.trim().is_empty() {
        return Err("内容不能为空".into());
    }

    let conn = state.personal.lock().unwrap();
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let event_type = input.event_type.unwrap_or_else(|| "note".into());

    // Validate event_type
    if !["note", "blocker", "pause", "resume"].contains(&event_type.as_str()) {
        return Err("event_type 必须是 note/blocker/pause/resume".into());
    }

    conn.execute(
        "INSERT INTO task_events (id, task_id, star_section, content, event_type, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![id, input.task_id, input.star_section, input.content, event_type, now],
    ).map_err(|e| e.to_string())?;

    // If pause event, also insert into task_pauses
    if event_type == "pause" {
        conn.execute(
            "INSERT INTO task_pauses (task_id, paused_at, reason) VALUES (?1, ?2, ?3)",
            params![input.task_id, now, input.content],
        ).map_err(|e| e.to_string())?;
    }

    // If resume event, find the latest open pause and close it
    if event_type == "resume" {
        conn.execute(
            "UPDATE task_pauses SET resumed_at = ?2
             WHERE task_id = ?1 AND resumed_at IS NULL",
            params![input.task_id, now],
        ).map_err(|e| e.to_string())?;
    }

    Ok(id)
}

#[tauri::command]
pub fn get_star_events(
    state: State<'_, DbState>,
    task_id: String,
    star_section: Option<String>,  // filter by section if provided
) -> Result<Vec<StarEventRow>, String> {
    let conn = state.personal.lock().unwrap();

    let (sql, section_filter) = if let Some(ref _sec) = star_section {
        (
            "SELECT id, task_id, star_section, content, event_type, created_at
             FROM task_events WHERE task_id = ?1 AND star_section = ?2
             ORDER BY created_at ASC",
            true,
        )
    } else {
        (
            "SELECT id, task_id, star_section, content, event_type, created_at
             FROM task_events WHERE task_id = ?1
             ORDER BY created_at ASC",
            false,
        )
    };

    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;

    let mut out = Vec::new();

    if section_filter {
        let rows = stmt.query_map(params![task_id, star_section.unwrap()], |r| {
            Ok(StarEventRow {
                id: r.get(0)?, task_id: r.get(1)?,
                star_section: r.get(2)?, content: r.get(3)?,
                event_type: r.get(4)?, created_at: r.get(5)?,
            })
        }).map_err(|e| e.to_string())?;
        for r in rows { out.push(r.map_err(|e| e.to_string())?); }
    } else {
        let rows = stmt.query_map(params![task_id], |r| {
            Ok(StarEventRow {
                id: r.get(0)?, task_id: r.get(1)?,
                star_section: r.get(2)?, content: r.get(3)?,
                event_type: r.get(4)?, created_at: r.get(5)?,
            })
        }).map_err(|e| e.to_string())?;
        for r in rows { out.push(r.map_err(|e| e.to_string())?); }
    }

    Ok(out)
}

#[tauri::command]
pub fn update_star_event(
    state: State<'_, DbState>,
    input: StarEventUpdate,
) -> Result<(), String> {
    let conn = state.personal.lock().unwrap();
    if let Some(content) = &input.content {
        conn.execute(
            "UPDATE task_events SET content = ?1 WHERE id = ?2",
            params![content, input.event_id],
        ).map_err(|e| e.to_string())?;
    }
    if let Some(event_type) = &input.event_type {
        conn.execute(
            "UPDATE task_events SET event_type = ?1 WHERE id = ?2",
            params![event_type, input.event_id],
        ).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn delete_star_event(
    state: State<'_, DbState>,
    event_id: String,
) -> Result<(), String> {
    let conn = state.personal.lock().unwrap();
    conn.execute("DELETE FROM task_events WHERE id = ?1", params![event_id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn pause_task(
    state: State<'_, DbState>,
    task_id: String,
    reason: Option<String>,
) -> Result<(), String> {
    let conn = state.personal.lock().unwrap();
    let now = chrono::Utc::now().to_rfc3339();

    let reason_text = reason.unwrap_or_default();

    // Update task status
    conn.execute(
        "UPDATE tasks SET status = 'paused', updated_at = ?1 WHERE id = ?2",
        params![now, task_id],
    ).map_err(|e| e.to_string())?;

    // Insert pause event
    let event_id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO task_events (id, task_id, star_section, content, event_type, created_at)
         VALUES (?1, ?2, 'A', ?3, 'pause', ?4)",
        params![event_id, task_id, &reason_text, now],
    ).map_err(|e| e.to_string())?;

    // Insert into task_pauses
    conn.execute(
        "INSERT INTO task_pauses (task_id, paused_at, reason) VALUES (?1, ?2, ?3)",
        params![task_id, now, &reason_text],
    ).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn resume_task(
    state: State<'_, DbState>,
    task_id: String,
) -> Result<(), String> {
    let conn = state.personal.lock().unwrap();
    let now = chrono::Utc::now().to_rfc3339();

    // Update task status back to active
    conn.execute(
        "UPDATE tasks SET status = 'active', updated_at = ?1 WHERE id = ?2",
        params![now, task_id],
    ).map_err(|e| e.to_string())?;

    // Insert resume event
    let event_id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO task_events (id, task_id, star_section, content, event_type, created_at)
         VALUES (?1, ?2, 'A', '恢复工作', 'resume', ?3)",
        params![event_id, task_id, now],
    ).map_err(|e| e.to_string())?;

    // Close latest open pause
    conn.execute(
        "UPDATE task_pauses SET resumed_at = ?2
         WHERE task_id = ?1 AND resumed_at IS NULL",
        params![task_id, now],
    ).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn get_task_pause_stats(
    state: State<'_, DbState>,
    task_id: String,
) -> Result<TaskPauseStats, String> {
    let conn = state.personal.lock().unwrap();

    let pause_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM task_pauses WHERE task_id = ?1",
        params![task_id], |r| r.get(0),
    ).map_err(|e| e.to_string())?;

    let total_pause_seconds: i64 = conn.query_row(
        "SELECT COALESCE(SUM(
            CASE WHEN resumed_at IS NOT NULL
                 THEN (julianday(resumed_at) - julianday(paused_at)) * 86400
                 ELSE (julianday('now') - julianday(paused_at)) * 86400
            END
        ), 0) FROM task_pauses WHERE task_id = ?1",
        params![task_id], |r| r.get(0),
    ).map_err(|e| e.to_string())?;

    // Check if currently paused (has open pause)
    let current_pause: Option<(String, String)> = conn.query_row(
        "SELECT reason, paused_at FROM task_pauses
         WHERE task_id = ?1 AND resumed_at IS NULL
         ORDER BY paused_at DESC LIMIT 1",
        params![task_id],
        |r| Ok((r.get::<_,String>(0)?, r.get::<_,String>(1)?)),
    ).optional().map_err(|e| e.to_string())?;

    Ok(TaskPauseStats {
        task_id,
        pause_count,
        total_pause_seconds: (total_pause_seconds as i64).max(0),
        is_paused_now: current_pause.is_some(),
        current_pause_reason: current_pause.as_ref().map(|(r, _)| r.clone()),
        current_pause_since: current_pause.map(|(_, s)| s),
    })
}
