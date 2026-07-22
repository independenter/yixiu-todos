// rules.rs — 强制录入规则
//
// 核心规则：当检测到"受控软件"被打开时，
// 若用户未事先录入关联任务，则每隔 N 分钟弹一次提醒/阻断。
// 这是个人精力纪律工具，不是 DRM。

use tauri::State;
use rusqlite::{params, OptionalExtension};
use serde::{Serialize, Deserialize};
use crate::db::DbState;
use chrono::Utc;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ForceRule {
    pub id: i64,
    pub app_name: String,
    pub enabled: bool,
    pub remind_interval_sec: i64,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ForceRuleInput {
    pub app_name: String,
    pub remind_interval_sec: Option<i64>, // 默认 300（5 分钟）
}

/// 检查某软件是否触发了强制规则
/// 返回：是否需要提醒 + 提示信息
#[tauri::command]
pub fn check_force_rule(
    state: State<'_, DbState>,
    app_name: String,
) -> Result<serde_json::Value, String> {
    let conn = state.personal.lock().unwrap();
    let row: Option<(i64, i64)> = conn.query_row(
        "SELECT id, remind_interval_sec FROM force_rules
         WHERE app_name=?1 AND enabled=1",
        params![app_name],
        |r| Ok((r.get(0)?, r.get(1)?)),
    ).optional().map_err(|e| e.to_string())?;

    if let Some((id, interval)) = row {
        // 记录一次"触发"事件
        let now = Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO force_events (app_name,detected_at,action) VALUES (?1,?2,'checked')",
            params![app_name, now],
        ).map_err(|e| e.to_string())?;

        Ok(serde_json::json!({
            "required": true,
            "rule_id": id,
            "app_name": app_name,
            "remind_interval_sec": interval,
            "message": format!("使用「{}」前，请先录入关联任务", app_name)
        }))
    } else {
        Ok(serde_json::json!({ "required": false }))
    }
}

/// 设置/新增一条强制规则
#[tauri::command]
pub fn set_force_rule(
    state: State<'_, DbState>,
    input: ForceRuleInput,
) -> Result<i64, String> {
    if input.app_name.trim().is_empty() {
        return Err("app_name 不能为空".into());
    }
    let interval = input.remind_interval_sec.unwrap_or(300);
    if !(60..=3600).contains(&interval) {
        return Err("remind_interval_sec 必须在 60-3600 之间".into());
    }

    let conn = state.personal.lock().unwrap();
    let now = Utc::now().to_rfc3339();

    // upsert：同名应用更新，否则插入
    let existing: Option<i64> = conn.query_row(
        "SELECT id FROM force_rules WHERE app_name=?1",
        params![input.app_name],
        |r| r.get(0),
    ).optional().map_err(|e| e.to_string())?;

    let id = if let Some(eid) = existing {
        conn.execute(
            "UPDATE force_rules SET enabled=1, remind_interval_sec=?2 WHERE id=?1",
            params![eid, interval],
        ).map_err(|e| e.to_string())?;
        eid
    } else {
        conn.execute(
            "INSERT INTO force_rules (app_name,remind_interval_sec,created_at) VALUES (?1,?2,?3)",
            params![input.app_name, interval, now],
        ).map_err(|e| e.to_string())?;
        conn.last_insert_rowid() as i64
    };
    Ok(id)
}

/// 关闭/删除一条规则
#[tauri::command]
pub fn clear_force_rule(
    state: State<'_, DbState>,
    app_name: String,
) -> Result<(), String> {
    let conn = state.personal.lock().unwrap();
    conn.execute(
        "DELETE FROM force_rules WHERE app_name=?1",
        params![app_name],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

/// 列出所有规则（前端可渲染为表格）
#[tauri::command]
pub fn list_force_rules(
    state: State<'_, DbState>,
) -> Result<Vec<ForceRule>, String> {
    let conn = state.personal.lock().unwrap();
    let mut s = conn.prepare(
        "SELECT id,app_name,enabled,remind_interval_sec,created_at FROM force_rules ORDER BY app_name"
    ).map_err(|e| e.to_string())?;
    let rows = s.query_map([], |r| Ok(ForceRule {
        id: r.get(0)?, app_name: r.get(1)?,
        enabled: r.get::<_,i64>(2)? != 0,
        remind_interval_sec: r.get(3)?,
        created_at: r.get(4)?,
    })).map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows { out.push(r.map_err(|e| e.to_string())?); }
    Ok(out)
}

/// 记录用户响应（前端弹窗"已录入/忽略"时调用）
#[tauri::command]
pub fn record_force_response(
    state: State<'_, DbState>,
    app_name: String,
    response: String, // "allowed" | "ignored" | "blocked"
) -> Result<(), String> {
    let conn = state.personal.lock().unwrap();
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO force_events (app_name,detected_at,action,user_response) VALUES (?1,?2,'responded',?3)",
        params![app_name, now, response],
    ).map_err(|e| e.to_string())?;
    Ok(())
}
