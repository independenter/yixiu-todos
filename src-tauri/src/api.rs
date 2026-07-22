// api.rs — HTTP API 服务（开发用，浏览器直接访问 SQLite）
//
// 在 Tauri dev 模式下启动一个 HTTP 服务（端口 3456），
// 浏览器通过此 API 读写数据库，无需 Tauri IPC。

use std::path::PathBuf;
use std::thread;
use std::sync::Mutex;
use std::io::Read;
use tiny_http::{Server, Response, Header};
use serde_json::{json, Value};
use rusqlite::Connection;

pub fn start(port: u16, db_path: PathBuf) {
    let addr = format!("0.0.0.0:{}", port);
    let server = match Server::http(&addr) {
        Ok(s) => { log::info!("🌐 HTTP API: http://localhost:{}/api", port); s }
        Err(e) => { log::warn!("⚠️ HTTP API 启动失败: {}", e); return; }
    };

    thread::spawn(move || {
        for mut request in server.incoming_requests() {
            let url = request.url().to_string();
            let method = request.method().as_str().to_string();
            let body = read_body(&mut request);

            let result = handle(method.as_str(), url.as_str(), &body, &db_path);
            let (status, resp_body) = match result { Ok(r) => (200, r), Err(e) => (400, json_str(&format!("{{\"error\":\"{}\"}}", e))) };

            let cors_origin = Header::from_bytes("Access-Control-Allow-Origin", "*").unwrap();
            let cors_methods = Header::from_bytes("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS").unwrap();
            let cors_headers = Header::from_bytes("Access-Control-Allow-Headers", "Content-Type").unwrap();
            let ct = Header::from_bytes("Content-Type", "application/json").unwrap();
            if method == "OPTIONS" {
                let _ = request.respond(Response::from_string("").with_status_code(204).with_header(cors_origin).with_header(cors_methods).with_header(cors_headers));
            } else {
                let _ = request.respond(Response::from_string(resp_body).with_status_code(status).with_header(ct).with_header(cors_origin).with_header(cors_methods).with_header(cors_headers));
            }
        }
    });
}

fn handle(method: &str, url: &str, body: &Value, db_path: &PathBuf) -> Result<String, String> {
    let conn = Mutex::new(Connection::open(db_path).map_err(|e| format!("db:{}", e))?);

    // ─── Tasks ─────────────────────────────────
    if method == "GET" && url == "/api/tasks" {
        let c = conn.lock().unwrap();
        let mut s = c.prepare("SELECT id,title,description,priority,start_time,end_time,effort_percent,status,category,created_at,updated_at FROM tasks ORDER BY start_time").unwrap();
        let rows: Vec<Value> = s.query_map([], map_task_row).unwrap().filter_map(|r| r.ok()).collect();
        return serde_json::to_string(&rows).map_err(|e| e.to_string());
    }

    if method == "POST" && url == "/api/tasks" {
        let c = conn.lock().unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        c.execute("INSERT INTO tasks (id,title,description,priority,start_time,end_time,effort_percent,status,category,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,'pending',?8,?9,?10)",
            rusqlite::params![id, body["title"].as_str().unwrap_or(""), body["description"].as_str().unwrap_or(""),
            body["priority"].as_i64().unwrap_or(2), body["start_time"].as_str().unwrap_or(""), body["end_time"].as_str().unwrap_or(""),
            body["effort_percent"].as_i64().unwrap_or(100), body["category"].as_str().unwrap_or("personal"), now, now]).unwrap();
        return Ok(format!("\"{}\"", id));
    }

    if method == "PUT" && url.starts_with("/api/tasks/") && !url.contains("/complete") {
        let id = url.strip_prefix("/api/tasks/").unwrap_or("");
        let c = conn.lock().unwrap();
        let now = chrono::Utc::now().to_rfc3339();
        c.execute("UPDATE tasks SET title=?1,description=?2,priority=?3,start_time=?4,end_time=?5,effort_percent=?6,category=?7,updated_at=?8 WHERE id=?9",
            rusqlite::params![body["title"].as_str().unwrap_or(""), body["description"].as_str().unwrap_or(""),
            body["priority"].as_i64().unwrap_or(2), body["start_time"].as_str().unwrap_or(""), body["end_time"].as_str().unwrap_or(""),
            body["effort_percent"].as_i64().unwrap_or(100), body["category"].as_str().unwrap_or("personal"), now, id]).unwrap();
        return Ok("null".into());
    }

    if method == "PUT" && url.starts_with("/api/tasks/") && url.ends_with("/complete") {
        let id = url.strip_prefix("/api/tasks/").and_then(|s| s.strip_suffix("/complete")).unwrap_or("");
        let c = conn.lock().unwrap();
        c.execute("UPDATE tasks SET status='done',updated_at=?1 WHERE id=?2", rusqlite::params![chrono::Utc::now().to_rfc3339(), id]).unwrap();
        return Ok("null".into());
    }

    if method == "DELETE" && url.starts_with("/api/tasks/") {
        let id = url.strip_prefix("/api/tasks/").unwrap_or("");
        let c = conn.lock().unwrap();
        c.execute("DELETE FROM tasks WHERE id=?1", rusqlite::params![id]).unwrap();
        return Ok("null".into());
    }

    // ─── Workload ──────────────────────────────
    if method == "GET" && url == "/api/workload" {
        let c = conn.lock().unwrap();
        let mut s = c.prepare("SELECT start_time,end_time,effort_percent FROM tasks WHERE status IN ('pending','active')").unwrap();
        let rows: Vec<(String,String,i64)> = s.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).unwrap().filter_map(|r| r.ok()).collect();
        drop(s);
        let points = compute_workload(&rows);
        return serde_json::to_string(&points).map_err(|e| e.to_string());
    }

    // ─── Conflicts ─────────────────────────────
    if method == "GET" && url == "/api/conflicts" {
        let c = conn.lock().unwrap();
        let mut s = c.prepare("SELECT id,start_time,end_time,effort_percent FROM tasks WHERE status IN ('pending','active')").unwrap();
        let rows: Vec<(String,String,i64,String)> = s.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get::<_,i64>(3)?, r.get::<_,String>(2)?))).unwrap().filter_map(|r| r.ok()).collect();
        drop(s);
        let conflicts = compute_conflicts(&rows);
        return serde_json::to_string(&conflicts).map_err(|e| e.to_string());
    }

    // ─── Employees ─────────────────────────────
    if method == "GET" && url == "/api/employees" {
        let c = conn.lock().unwrap();
        let mut s = c.prepare("SELECT id,name,role,email,status,created_at FROM employees WHERE status='active' ORDER BY name").unwrap();
        let rows: Vec<Value> = s.query_map([], |r| Ok(json!({"id":r.get::<_,String>(0)?,"name":r.get::<_,String>(1)?,"role":r.get::<_,String>(2)?,"email":r.get::<_,String>(3)?,"status":r.get::<_,String>(4)?,"created_at":r.get::<_,String>(5)?}))).unwrap().filter_map(|r| r.ok()).collect();
        return serde_json::to_string(&rows).map_err(|e| e.to_string());
    }

    if method == "POST" && url == "/api/employees" {
        let c = conn.lock().unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        c.execute("INSERT INTO employees (id,name,role,email,status,created_at) VALUES (?1,?2,?3,?4,'active',?5)",
            rusqlite::params![id, body["name"].as_str().unwrap_or(""), body["role"].as_str().unwrap_or(""), body["email"].as_str().unwrap_or(""), chrono::Utc::now().to_rfc3339()]).unwrap();
        return Ok(format!("\"{}\"", id));
    }

    if method == "GET" && url.starts_with("/api/employees/") && url.ends_with("/workload") {
        let eid = url.strip_prefix("/api/employees/").and_then(|s| s.strip_suffix("/workload")).unwrap_or("");
        let c = conn.lock().unwrap();
        let name: String = c.query_row("SELECT name FROM employees WHERE id=?1", rusqlite::params![eid], |r| r.get(0)).unwrap_or_default();
        let mut s = c.prepare("SELECT effort_percent,progress FROM employee_tasks WHERE employee_id=?1 AND status IN ('pending','active')").unwrap();
        let (total, count, sum_prog): (i64, i64, i64) = s.query_map(rusqlite::params![eid], |r| Ok((r.get::<_,i64>(0)?, 1i64, r.get::<_,i64>(1)?))).unwrap().filter_map(|r| r.ok()).fold((0,0,0), |(t,c,p),(e,_,pr)|(t+e,c+1,p+pr));
        return Ok(serde_json::to_string(&json!({"employee_id":eid,"name":name,"total_percent":total,"active_tasks":count,"avg_progress":if count>0{sum_prog/count}else{0},"alerts":Value::Array(vec![])})).unwrap());
    }

    // ─── Force Rules ───────────────────────────
    if method == "GET" && url == "/api/force-rules" {
        let c = conn.lock().unwrap();
        let mut s = c.prepare("SELECT id,app_name,enabled,remind_interval_sec,created_at FROM force_rules ORDER BY app_name").unwrap();
        let rows: Vec<Value> = s.query_map([], |r| Ok(json!({"id":r.get::<_,i64>(0)?,"app_name":r.get::<_,String>(1)?,"enabled":r.get::<_,bool>(2)?,"remind_interval_sec":r.get::<_,i64>(3)?,"created_at":r.get::<_,String>(4)?}))).unwrap().filter_map(|r| r.ok()).collect();
        return serde_json::to_string(&rows).map_err(|e| e.to_string());
    }

    if method == "POST" && url == "/api/force-rules" {
        let c = conn.lock().unwrap();
        c.execute("INSERT OR REPLACE INTO force_rules (app_name,enabled,remind_interval_sec,created_at) VALUES (?1,1,?2,?3)",
            rusqlite::params![body["app_name"].as_str().unwrap_or(""), body["remind_interval_sec"].as_i64().unwrap_or(300), chrono::Utc::now().to_rfc3339()]).unwrap();
        return Ok("null".into());
    }

    if method == "GET" && url.starts_with("/api/star/") {
        let task_id = url.strip_prefix("/api/star/").unwrap_or("");
        let c = conn.lock().unwrap();
        let mut s = c.prepare("SELECT id,task_id,star_section,content,event_type,created_at FROM task_events WHERE task_id=?1 ORDER BY created_at ASC").unwrap();
        let rows: Vec<Value> = s.query_map(rusqlite::params![task_id], |r| Ok(json!({"id":r.get::<_,String>(0)?,"task_id":r.get::<_,String>(1)?,"star_section":r.get::<_,String>(2)?,"content":r.get::<_,String>(3)?,"event_type":r.get::<_,String>(4)?,"created_at":r.get::<_,String>(5)?}))).unwrap().filter_map(|r| r.ok()).collect();
        return serde_json::to_string(&rows).map_err(|e| e.to_string());
    }

    // ─── STAR Events ──────────────────────────
    if method == "POST" && url == "/api/star" {
        let c = conn.lock().unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        c.execute("INSERT INTO task_events (id,task_id,star_section,content,event_type,created_at) VALUES (?1,?2,?3,?4,?5,?6)",
            rusqlite::params![id, body["task_id"].as_str().unwrap_or(""), body["star_section"].as_str().unwrap_or(""),
            body["content"].as_str().unwrap_or(""), body["event_type"].as_str().unwrap_or("note"), chrono::Utc::now().to_rfc3339()]).unwrap();
        return Ok(format!("\"{}\"", id));
    }

    if method == "POST" && url.contains("/pause") && !url.contains("pause-stats") {
        let task_id = url.strip_prefix("/api/tasks/").and_then(|s| s.strip_suffix("/pause")).unwrap_or("");
        let c = conn.lock().unwrap();
        let now = chrono::Utc::now().to_rfc3339();
        c.execute("UPDATE tasks SET status='paused',updated_at=?1 WHERE id=?2", rusqlite::params![now, task_id]).unwrap();
        let eid = uuid::Uuid::new_v4().to_string();
        c.execute("INSERT INTO task_events (id,task_id,star_section,content,event_type,created_at) VALUES (?1,?2,'A',?3,'pause',?4)", rusqlite::params![eid, task_id, body["reason"].as_str().unwrap_or(""), now]).unwrap();
        c.execute("INSERT INTO task_pauses (task_id,paused_at,reason) VALUES (?1,?2,?3)", rusqlite::params![task_id, now, body["reason"].as_str().unwrap_or("")]).unwrap();
        return Ok("null".into());
    }

    if method == "POST" && url.contains("/resume") {
        let task_id = url.strip_prefix("/api/tasks/").and_then(|s| s.strip_suffix("/resume")).unwrap_or("");
        let c = conn.lock().unwrap();
        let now = chrono::Utc::now().to_rfc3339();
        c.execute("UPDATE tasks SET status='active',updated_at=?1 WHERE id=?2", rusqlite::params![now, task_id]).unwrap();
        let eid = uuid::Uuid::new_v4().to_string();
        c.execute("INSERT INTO task_events (id,task_id,star_section,content,event_type,created_at) VALUES (?1,?2,'A','恢复工作','resume',?3)", rusqlite::params![eid, task_id, now]).unwrap();
        c.execute("UPDATE task_pauses SET resumed_at=?2 WHERE task_id=?1 AND resumed_at IS NULL", rusqlite::params![task_id, now]).unwrap();
        return Ok("null".into());
    }

    if method == "GET" && url.ends_with("/pause-stats") {
        let task_id = url.strip_prefix("/api/tasks/").and_then(|s| s.strip_suffix("/pause-stats")).unwrap_or("");
        let c = conn.lock().unwrap();
        let count: i64 = c.query_row("SELECT COUNT(*) FROM task_pauses WHERE task_id=?1", rusqlite::params![task_id], |r| r.get(0)).unwrap_or(0);
        let seconds: f64 = c.query_row("SELECT COALESCE(SUM( CASE WHEN resumed_at IS NOT NULL THEN (julianday(resumed_at)-julianday(paused_at))*86400 ELSE (julianday('now')-julianday(paused_at))*86400 END),0) FROM task_pauses WHERE task_id=?1",
            rusqlite::params![task_id], |r| r.get(0)).unwrap_or(0.0);
        return Ok(serde_json::to_string(&json!({"pause_count":count,"total_pause_seconds":seconds as i64,"is_paused_now":false,"current_pause_reason":null,"current_pause_since":null})).unwrap());
    }

    Err("not found".into())
}

fn compute_workload(rows: &[(String, String, i64)]) -> Vec<Value> {
    let mut bounds: Vec<chrono::DateTime<chrono::Utc>> = rows.iter().flat_map(|(s,e,_)| {
        [parse_utc(s), parse_utc(e)].into_iter().filter_map(|r| r.ok())
    }).collect();
    bounds.sort(); bounds.dedup();
    if bounds.len() < 2 { return vec![]; }
    bounds.windows(2).filter_map(|w| {
        if (w[1]-w[0]).num_minutes() < 1 { return None; }
        let total: i64 = rows.iter().filter(|(s,e,_)| {
            parse_utc(s).map(|ss| ss < w[1]).unwrap_or(false) && parse_utc(e).map(|ee| ee > w[0]).unwrap_or(false)
        }).map(|r| r.2).sum();
        let level = if total > 100 {"error"} else if total > 50 {"warning"} else {"ok"};
        Some(json!({"time":w[0].to_rfc3339(),"total_percent":total,"level":level,"task_ids":[]}))
    }).collect()
}

fn compute_conflicts(rows: &[(String, String, i64, String)]) -> Vec<Value> {
    let mut bounds: Vec<chrono::DateTime<chrono::Utc>> = rows.iter().flat_map(|(_,s,_,e)| {
        [parse_utc(s), parse_utc(e)].into_iter().filter_map(|r| r.ok())
    }).collect();
    bounds.sort(); bounds.dedup();
    if bounds.len() < 2 { return vec![]; }
    let slices: Vec<(chrono::DateTime<chrono::Utc>, chrono::DateTime<chrono::Utc>, i64, Vec<String>)> = bounds.windows(2).filter_map(|w| {
        if (w[1]-w[0]).num_minutes() < 1 { return None; }
        let total: i64 = rows.iter().filter(|(_,s,_,e)| {
            parse_utc(s).map(|ss| ss < w[1]).unwrap_or(false) && parse_utc(e).map(|ee| ee > w[0]).unwrap_or(false)
        }).map(|r| r.2).sum();
        if total <= 100 { return None; }
        let ids: Vec<String> = rows.iter().filter(|(_,s,_,e)| {
            parse_utc(s).map(|ss| ss < w[1]).unwrap_or(false) && parse_utc(e).map(|ee| ee > w[0]).unwrap_or(false)
        }).map(|r| r.0.clone()).collect();
        Some((w[0], w[1], total, ids))
    }).collect();

    if slices.is_empty() { return vec![]; }
    let mut merged = Vec::new();
    let mut i = 0;
    while i < slices.len() {
        let mut j = i;
        let mut max_total = slices[i].2;
        let mut all_ids: std::collections::BTreeSet<String> = slices[i].3.iter().cloned().collect();
        while j + 1 < slices.len() {
            let next_ids: std::collections::BTreeSet<String> = slices[j+1].3.iter().cloned().collect();
            if all_ids != next_ids { break; }
            j += 1;
            if slices[j].2 > max_total { max_total = slices[j].2; }
            for id in &slices[j].3 { all_ids.insert(id.clone()); }
        }
        let sev = if max_total > 150 { "error" } else { "warning" };
        merged.push(json!({
            "time_range": format!("{}/{}", slices[i].0.to_rfc3339(), slices[j].1.to_rfc3339()),
            "duration_minutes": (slices[j].1 - slices[i].0).num_minutes(),
            "total_percent": max_total, "task_count": all_ids.len(),
            "task_ids": all_ids.into_iter().collect::<Vec<_>>(),
            "severity": sev,
        }));
        i = j + 1;
    }
    merged.sort_by(|a,b| b["total_percent"].as_i64().cmp(&a["total_percent"].as_i64()));
    merged
}

fn map_task_row(r: &rusqlite::Row) -> rusqlite::Result<Value> {
    Ok(json!({"id":r.get::<_,String>(0)?,"title":r.get::<_,String>(1)?,"description":r.get::<_,String>(2)?,
        "priority":r.get::<_,i64>(3)?,"start_time":r.get::<_,String>(4)?,"end_time":r.get::<_,String>(5)?,
        "effort_percent":r.get::<_,i64>(6)?,"status":r.get::<_,String>(7)?,"category":r.get::<_,String>(8)?,
        "created_at":r.get::<_,String>(9)?,"updated_at":r.get::<_,String>(10)?}))
}

fn parse_utc(s: &str) -> Result<chrono::DateTime<chrono::Utc>, chrono::ParseError> {
    chrono::DateTime::parse_from_rfc3339(s).map(|d| d.with_timezone(&chrono::Utc))
}

fn read_body(req: &mut tiny_http::Request) -> Value {
    let mut buf = String::new();
    let _ = req.as_reader().read_to_string(&mut buf);
    serde_json::from_str(&buf).unwrap_or(Value::Null)
}

fn json_str(s: &str) -> String { s.to_string() }
