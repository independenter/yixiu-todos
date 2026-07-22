# yixiu-todos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the MVP skeleton into a working app with STAR task management, multi-view routing, and improved workload visualization.

**Architecture:** Rust Tauri 2 backend with modular command handlers, Vanilla TS frontend with hash-based routing for multi-view support. New `task_star.rs` module handles STAR event CRUD; frontend uses a simple router to switch between Personal, Team, and Task Detail views.

**Tech Stack:** Rust + Tauri 2, rusqlite (SQLite), Vanilla TypeScript + Vite

**Design Doc:** `docs/superpowers/specs/2026-07-22-yixiu-todos-design.md`

## Global Constraints

- All Rust commands return `Result<T, String>` for Tauri IPC compatibility
- Database schema changes must be additive (CREATE IF NOT EXISTS) — never drop/modify existing columns
- Frontend uses native DOM APIs (no framework dependency)
- Frontend hash-based routing: `#personal`, `#team`, `#task/<id>`
- New Rust modules must be declared in `lib.rs` and commands registered in `invoke_handler`
- Every commit message follows conventional commits format

---

## Phase 0: Codebase Cleanup

### Task 0.1: Fix Rust warnings across all source files

**Files:**
- Modify: `src-tauri/src/task.rs`
- Modify: `src-tauri/src/conflict.rs`
- Modify: `src-tauri/src/scheduler.rs`
- Modify: `src-tauri/src/employee.rs`
- Modify: `src-tauri/src/rules.rs`
- Modify: `src-tauri/src/reminder.rs`
- Modify: `src-tauri/src/tray.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/error.rs`

**Interfaces:** No public API changes. Pure cleanup — all signatures unchanged.

- [ ] **Step 1: Fix task.rs — remove unused imports and vars**

Current warnings:
- unused `use std::sync::Mutex;`
- unused `use rusqlite::Connection;`
- unused `use chrono::Duration as ChronoDuration;`
- unused `use anyhow::Context;`
- unused variable `from` in `get_workload_panel`
- unused variable `to` in `get_workload_panel`
- `ids` doesn't need `mut`

Changes:

Remove from imports:
```rust
// Delete these lines:
use std::sync::Mutex;
// In the rusqlite line: Connection
// In the chrono line: Duration as ChronoDuration,
// In the anyhow line: Context,
```

Prefix unused params with `_` in `get_workload_panel`:
```rust
pub fn get_workload_panel(
    state: State<'_, DbState>,
    _from: Option<String>,
    _to: Option<String>,
) -> Result<Vec<WorkloadPoint>, String> {
```

Remove `mut` from `ids`:
```rust
let ids: Vec<String> = Vec::new();
```

- [ ] **Step 2: Run cargo build to verify task.rs warnings gone**

Run: `cargo build 2>&1 | grep "task.rs"` — expect 0 warnings

- [ ] **Step 3: Fix conflict.rs — remove unused imports**

```rust
// Delete these lines:
use std::sync::Mutex;
// In crate::task import: remove TaskRow (keep ConflictItem)
```

- [ ] **Step 4: Fix scheduler.rs — remove unused import**

```rust
// Delete:
use tokio::sync::Mutex as AsyncMutex;
```

- [ ] **Step 5: Fix employee.rs — remove unused imports**

```rust
// Delete:
use std::sync::Mutex;
// In rusqlite import: remove Connection (keep params)
```

- [ ] **Step 6: Fix rules.rs — remove unused imports**

```rust
// Delete:
use std::sync::Mutex;
// In rusqlite import: remove Connection (keep params, OptionalExtension)
```

- [ ] **Step 7: Fix reminder.rs — add underscore prefix, remove dead code**

```rust
// Change function signature:
pub async fn send_notification(
    _app: AppHandle,       // prefix with _
    title: String,
    body: String,
    urgency: Option<String>,
) -> Result<String, String> {

// In schedule_in function:
pub async fn schedule_in(
    _app: &Arc<AppHandle>,  // prefix with _
    task_id: &str,
    seconds: u64,
    body: &str,
) {
    // Delete the line: let app = app.clone();
    let task_id = task_id.to_string();
    let body = body.to_string();
    let title = "⏰ 一修Todo 提醒".to_string();
    tokio::spawn(async move {
        sleep(Duration::from_secs(seconds)).await;
        let _ = send_notification_impl(&task_id, &title, &body, "normal").await;
    });
```

- [ ] **Step 8: Fix lib.rs — remove unused import**

```rust
// Delete:
use db::DbState;
```

- [ ] **Step 9: Fix error.rs + tray.rs + conflict.rs — suppress dead_code**

In error.rs, the `AppError` enum and `Result` alias are kept for future STAR module usage:
```rust
#[allow(dead_code)]
pub enum AppError {
    // ... unchanged
}

#[allow(dead_code)]
pub type Result<T> = std::result::Result<T, AppError>;
```

In conflict.rs, keep functions that will be used later:
```rust
#[allow(dead_code)]
pub fn list(conn: &Connection) -> rusqlite::Result<Vec<ConflictItem>> {

#[allow(dead_code)]
pub fn check_one_against_existing(
```

In tray.rs:
```rust
#[allow(dead_code)]
pub fn set_tooltip(app: &AppHandle, text: &str) {
```

- [ ] **Step 10: Final verification**

Run: `cargo build 2>&1 | grep "^warning:"` — expect 0 results

- [ ] **Step 11: Commit**

```bash
git add src-tauri/src/
git commit -m "chore: fix all Rust compiler warnings"
```

---

## Phase 1: STAR Task Definition System — Backend

### Task 1: Add STAR schema tables

**Files:**
- Modify: `src-tauri/src/db.rs`

**Interfaces:**
- Produces: Two new SQLite tables `task_events` and `task_pauses`
- Consumes: Existing `tasks` table (foreign key references)

- [ ] **Step 1: Add CREATE TABLE IF NOT EXISTS for task_events and task_pauses**

In `db.rs`, inside the `create_schema` function, add after the employee_tasks section:

```rust
    // ─── STAR 任务事件表 ────────────────────────────────────
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS task_events (
            id            TEXT PRIMARY KEY,
            task_id       TEXT NOT NULL,
            star_section  TEXT NOT NULL CHECK(star_section IN ('S','T','A','R')),
            content       TEXT NOT NULL,
            event_type    TEXT NOT NULL DEFAULT 'note'
                          CHECK(event_type IN ('note','blocker','pause','resume')),
            created_at    TEXT NOT NULL,
            FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_task_events_task ON task_events(task_id);
        CREATE INDEX IF NOT EXISTS idx_task_events_section ON task_events(task_id, star_section);

        -- 暂停记录
        CREATE TABLE IF NOT EXISTS task_pauses (
            id        INTEGER PRIMARY KEY AUTOINCREMENT,
            task_id   TEXT NOT NULL,
            paused_at TEXT NOT NULL,
            resumed_at TEXT,
            reason    TEXT,
            FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_task_pauses_task ON task_pauses(task_id);
        "#,
    )?;
```

- [ ] **Step 2: Verify build**

Run: `cargo build` — expect 0 errors, 0 warnings

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/db.rs
git commit -m "feat(db): add task_events and task_pauses tables for STAR system"
```

---

### Task 2: Create task_star.rs module

**Files:**
- Create: `src-tauri/src/task_star.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod task_star;` + register commands)

**Interfaces:**
- Consumes: `crate::db::DbState` (via `State<'_, DbState>`)
- Produces: Tauri commands `add_star_event`, `get_star_events`, `update_star_event`, `delete_star_event`, `pause_task`, `resume_task`, `get_task_pause_stats`

- [ ] **Step 1: Create task_star.rs with DTOs**

```rust
// task_star.rs — STAR 任务定义事件管理
//
// 每个任务按 S/Situation / T/Task / A/Action / R/Result 分解，
// 每段可记录多条事件（note/blocker/pause/resume）。

use tauri::State;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use crate::db::DbState;

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
```

- [ ] **Step 2: Add command `add_star_event`**

```rust
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
```

- [ ] **Step 3: Add command `get_star_events`**

```rust
#[tauri::command]
pub fn get_star_events(
    state: State<'_, DbState>,
    task_id: String,
    star_section: Option<String>,  // filter by section if provided
) -> Result<Vec<StarEventRow>, String> {
    let conn = state.personal.lock().unwrap();

    let (sql, section_filter) = if let Some(ref sec) = star_section {
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

    let rows = if section_filter {
        stmt.query_map(params![task_id, star_section.unwrap()], |r| {
            Ok(StarEventRow {
                id: r.get(0)?, task_id: r.get(1)?,
                star_section: r.get(2)?, content: r.get(3)?,
                event_type: r.get(4)?, created_at: r.get(5)?,
            })
        }).map_err(|e| e.to_string())?
    } else {
        stmt.query_map(params![task_id], |r| {
            Ok(StarEventRow {
                id: r.get(0)?, task_id: r.get(1)?,
                star_section: r.get(2)?, content: r.get(3)?,
                event_type: r.get(4)?, created_at: r.get(5)?,
            })
        }).map_err(|e| e.to_string())?
    };

    let mut out = Vec::new();
    for r in rows { out.push(r.map_err(|e| e.to_string())?); }
    Ok(out)
}
```

- [ ] **Step 4: Add command `update_star_event`**

```rust
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
```

- [ ] **Step 5: Add command `delete_star_event`**

```rust
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
```

- [ ] **Step 6: Add command `pause_task`**

```rust
#[tauri::command]
pub fn pause_task(
    state: State<'_, DbState>,
    task_id: String,
    reason: Option<String>,
) -> Result<(), String> {
    let conn = state.personal.lock().unwrap();
    let now = chrono::Utc::now().to_rfc3339();

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
        params![event_id, task_id, reason.unwrap_or_default(), now],
    ).map_err(|e| e.to_string())?;

    // Insert into task_pauses
    conn.execute(
        "INSERT INTO task_pauses (task_id, paused_at, reason) VALUES (?1, ?2, ?3)",
        params![task_id, now, reason.unwrap_or_default()],
    ).map_err(|e| e.to_string())?;

    Ok(())
}
```

- [ ] **Step 7: Add command `resume_task`**

```rust
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
```

- [ ] **Step 8: Add command `get_task_pause_stats`**

```rust
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
```

- [ ] **Step 9: Register module and commands in lib.rs**

In lib.rs, add the module declaration:
```rust
// After `mod rules;` add:
mod task_star;
```

In the invoke_handler array, add the new commands:
```rust
// After reminder commands:
            // STAR 任务事件
            task_star::add_star_event,
            task_star::get_star_events,
            task_star::update_star_event,
            task_star::delete_star_event,
            task_star::pause_task,
            task_star::resume_task,
            task_star::get_task_pause_stats,
```

- [ ] **Step 10: Update workload panel to skip paused tasks**

In task.rs `get_workload_panel`, update the SQL query to exclude paused tasks:
```rust
// Change line:
"SELECT start_time, end_time, effort_percent FROM tasks WHERE status='pending' OR status='active'"
// To:
"SELECT start_time, end_time, effort_percent FROM tasks WHERE status IN ('pending','active')"
```

Also update conflict.rs `recompute_with_conn` — the existing query already uses `IN ('pending','active')` so it should be fine. Verify:
```rust
// In conflict.rs line 28, confirm it says:
"WHERE status IN ('pending','active')"
```
If it says `('pending','active')` — already correct. No change needed.

- [ ] **Step 11: Verify build**

Run: `cargo build` — expect 0 errors, 0 warnings

- [ ] **Step 12: Commit**

```bash
git add src-tauri/src/task_star.rs src-tauri/src/lib.rs src-tauri/src/task.rs
git commit -m "feat(star): add STAR task event management backend

New task_star.rs module with CRUD commands for S/T/A/R events,
pause/resume lifecycle, and pause statistics.
Adds task_events and task_pauses DB tables.
Excludes paused tasks from workload panel calculation."
```

---

## Phase 2: Multi-View Frontend Routing

### Task 3: Set up hash-based router and view skeleton

**Files:**
- Create: `src/views/personal.ts`
- Create: `src/views/team.ts`
- Create: `src/views/task-detail.ts`
- Create: `src/router.ts`
- Modify: `src/main.ts`
- Modify: `index.html`

**Interfaces:**
- Produces: Router that resolves `#personal`, `#team`, `#task/<id>` and renders corresponding views
- Consumes: Existing `invoke` calls for task/employee data

- [ ] **Step 1: Update index.html with navigation shell**

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>一修Todo — 精力占用面板</title>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body { font-family: system-ui, -apple-system, sans-serif; background: #f1f5f9; color: #1e293b; }
      .app-shell { display: flex; flex-direction: column; height: 100vh; }
      nav { display: flex; gap: 4px; background: #fff; padding: 8px 16px; border-bottom: 1px solid #e2e8f0; }
      nav a { padding: 8px 16px; text-decoration: none; color: #64748b; border-radius: 6px; cursor: pointer; }
      nav a:hover { background: #f1f5f9; }
      nav a.active { background: #3b82f6; color: #fff; }
      .content { flex: 1; overflow-y: auto; padding: 16px; }
    </style>
  </head>
  <body>
    <div class="app-shell">
      <nav id="nav">
        <a href="#personal" class="active">📋 个人看板</a>
        <a href="#team">👥 团队面板</a>
      </nav>
      <div class="content" id="app"></div>
    </div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

- [ ] **Step 2: Create src/router.ts**

```typescript
// src/router.ts — 基于 hash 的简单路由

export type Route =
  | { name: 'personal' }
  | { name: 'team' }
  | { name: 'task-detail'; taskId: string }
  | { name: 'not-found' };

export function parseRoute(hash: string): Route {
  const h = hash.replace(/^#/, '');
  if (h === 'personal' || h === '' || !h) return { name: 'personal' };
  if (h === 'team') return { name: 'team' };
  const taskMatch = h.match(/^task\/(.+)$/);
  if (taskMatch) return { name: 'task-detail', taskId: decodeURIComponent(taskMatch[1]) };
  return { name: 'not-found' };
}

export type ViewRenderer = (container: HTMLElement, route: Route) => void | Promise<void>;

export class Router {
  private currentRoute: Route = { name: 'personal' };
  private renderer: ViewRenderer;

  constructor(renderer: ViewRenderer) {
    this.renderer = renderer;
    window.addEventListener('hashchange', () => this.navigate());
  }

  navigate(): void {
    this.currentRoute = parseRoute(location.hash);
    this.updateNav();
    const app = document.getElementById('app');
    if (app) {
      app.innerHTML = '';
      Promise.resolve(this.renderer(app, this.currentRoute)).catch(console.error);
    }
  }

  private updateNav(): void {
    document.querySelectorAll('nav a').forEach(a => {
      const href = a.getAttribute('href') || '';
      a.classList.toggle('active', href === `#${this.currentRoute.name === 'personal' ? 'personal' : this.currentRoute.name}`);
    });
  }

  start(): void {
    if (!location.hash) location.hash = '#personal';
    this.navigate();
  }
}
```

- [ ] **Step 3: Create src/views/personal.ts**

```typescript
// src/views/personal.ts — 个人看板视图

import { invoke } from '@tauri-apps/api/core';

interface Task {
  id: string; title: string; priority: number;
  start_time: string; end_time: string;
  effort_percent: number; status: string; category: string;
}

interface WorkloadPoint {
  time: string; total_percent: number; level: string; task_ids: string[];
}

export async function renderPersonal(container: HTMLElement): Promise<void> {
  container.innerHTML = '<h2>📋 个人看板</h2><div id="workload"></div><div id="tasks"></div><div id="conflicts"></div>';

  try {
    const tasks = await invoke<Task[]>('list_tasks', { status: null, category: null, from: null, to: null });
    const workload = await invoke<WorkloadPoint[]>('get_workload_panel', { from: null, to: null });

    // Render workload summary
    const wl = document.getElementById('workload')!;
    wl.innerHTML = '<h3>精力占用</h3>';
    for (const p of workload) {
      const color = p.level === 'error' ? '#ef4444' : p.level === 'warning' ? '#f59e0b' : '#22c55e';
      wl.innerHTML += `<div style="border-left:4px solid ${color};padding:6px 10px;margin:4px 0;background:#fff;border-radius:4px">
        <strong>${p.time.slice(11, 16)}</strong>
        <span style="margin-left:8px;color:${color};font-weight:bold">${p.total_percent}%</span>
        <small style="display:block;color:#64748b">${p.level}</small>
      </div>`;
    }

    // Render task list
    const tl = document.getElementById('tasks')!;
    tl.innerHTML = '<h3 style="margin-top:16px">任务列表</h3>';
    for (const t of tasks) {
      const statusColor = t.status === 'done' ? '#22c55e' : t.status === 'paused' ? '#f59e0b' : '#3b82f6';
      const link = `<a href="#task/${t.id}" style="text-decoration:none;color:inherit">${t.title}</a>`;
      tl.innerHTML += `<div style="padding:8px;margin:4px 0;background:#fff;border-radius:4px;border-left:3px solid ${statusColor}">
        <strong>${link}</strong>
        <span style="float:right;font-size:12px;color:#64748b">${t.status}</span>
        <small style="display:block;color:#64748b">${t.start_time.slice(11,16)} → ${t.end_time.slice(11,16)} | ${t.effort_percent}% | 优先级${t.priority}</small>
      </div>`;
    }
  } catch (e) {
    container.innerHTML += `<p style="color:#ef4444">加载失败: ${e}</p>`;
  }
}
```

- [ ] **Step 4: Create src/views/team.ts**

```typescript
// src/views/team.ts — 团队面板视图

import { invoke } from '@tauri-apps/api/core';

interface Employee {
  id: string; name: string; role: string; status: string;
}

interface EmpWorkload {
  employee_id: string; name: string; total_percent: number;
  active_tasks: number; avg_progress: number; alerts: string[];
}

export async function renderTeam(container: HTMLElement): Promise<void> {
  container.innerHTML = '<h2>👥 团队面板</h2><div id="employees"></div>';

  try {
    const employees = await invoke<Employee[]>('list_employees');
    const empDiv = document.getElementById('employees')!;

    for (const emp of employees) {
      try {
        const wl = await invoke<EmpWorkload>('get_employee_workload', { employeeId: emp.id });
        empDiv.innerHTML += `<div style="background:#fff;border-radius:8px;padding:12px;margin:8px 0">
          <h3>${emp.name} <small style="color:#64748b">${emp.role}</small></h3>
          <p>精力占用: <strong>${wl.total_percent}%</strong> | 活跃: ${wl.active_tasks} | 平均进度: ${wl.avg_progress}%</p>
          ${wl.alerts.map(a => `<p style="color:#ef4444;font-size:14px">⚠️ ${a}</p>`).join('')}
        </div>`;
      } catch { /* skip failed load */ }
    }
  } catch (e) {
    container.innerHTML += `<p style="color:#ef4444">加载失败: ${e}</p>`;
  }
}
```

- [ ] **Step 5: Update src/main.ts to use the router**

```typescript
// src/main.ts — 前端入口，使用多视图路由

import { Router, Route } from './router';
import { renderPersonal } from './views/personal';
import { renderTeam } from './views/team';
import { renderTaskDetail } from './views/task-detail';

const router = new Router(async (container: HTMLElement, route: Route) => {
  switch (route.name) {
    case 'personal':
      await renderPersonal(container);
      break;
    case 'team':
      await renderTeam(container);
      break;
    case 'task-detail':
      await renderTaskDetail(container, route.taskId);
      break;
    default:
      container.innerHTML = '<h2>404</h2><p>页面不存在</p>';
  }
});

document.addEventListener('DOMContentLoaded', () => router.start());
```

- [ ] **Step 6: Create src/views/task-detail.ts (skeleton)**

```typescript
// src/views/task-detail.ts — 任务详情视图（骨架，STAR 面板下一步实现）

import { invoke } from '@tauri-apps/api/core';

interface Task {
  id: string; title: string; description: string; priority: number;
  start_time: string; end_time: string; effort_percent: number;
  status: string; category: string;
}

export async function renderTaskDetail(container: HTMLElement, taskId: string): Promise<void> {
  container.innerHTML = `<h2>📄 任务详情</h2><div id="task-info"></div><div id="star-panel"><p style="color:#64748b;padding:20px;text-align:center">STAR 面板加载中...</p></div>`;

  try {
    const tasks = await invoke<Task[]>('list_tasks', { status: null, category: null, from: null, to: null });
    const task = tasks.find(t => t.id === taskId);
    if (!task) { container.innerHTML = '<h2>任务未找到</h2>'; return; }

    const info = document.getElementById('task-info')!;
    info.innerHTML = `
      <div style="background:#fff;border-radius:8px;padding:16px;margin-bottom:16px">
        <h3>${task.title}</h3>
        <p style="color:#64748b">${task.description || '无描述'}</p>
        <p>优先级: ${task.priority} | 精力: ${task.effort_percent}% | 状态: ${task.status}</p>
        <p>${task.start_time.slice(0,16)} → ${task.end_time.slice(0,16)}</p>
      </div>`;
  } catch (e) {
    container.innerHTML = `<h2>加载失败</h2><p>${e}</p>`;
  }
}
```

- [ ] **Step 7: Verify frontend builds**

Run: `npm run build` — expect 0 errors

- [ ] **Step 8: Commit**

```bash
git add src/ index.html
git commit -m "feat(ui): add multi-view routing and view skeletons

Hash-based router (#personal, #team, #task/<id>)
Personal dashboard view, Team panel view, Task detail view"
```

---

## Phase 3: STAR Frontend Panel

### Task 4: Build STAR panel component

**Files:**
- Modify: `src/views/task-detail.ts`
- Create: `src/views/star-panel.ts`

**Interfaces:**
- Consumes: `add_star_event`, `get_star_events`, `pause_task`, `resume_task`, `get_task_pause_stats` Rust commands
- Produces: Renders S/T/A/R collapsible sections with event timeline

- [ ] **Step 1: Create src/views/star-panel.ts**

```typescript
// src/views/star-panel.ts — STAR 任务定义面板

import { invoke } from '@tauri-apps/api/core';

interface StarEvent {
  id: string; task_id: string; star_section: string;
  content: string; event_type: string; created_at: string;
}

interface PauseStats {
  task_id: string; pause_count: number; total_pause_seconds: number;
  is_paused_now: boolean; current_pause_reason: string | null;
  current_pause_since: string | null;
}

const SECTION_LABELS: Record<string, { en: string; zh: string; question: string }> = {
  S: { en: 'Situation', zh: '背景', question: '当时是什么场景？约束是什么？' },
  T: { en: 'Task', zh: '任务', question: '你被要求做什么？目标是什么？' },
  A: { en: 'Action', zh: '行动', question: '你具体做了什么？（不是"我们"）' },
  R: { en: 'Result', zh: '结果', question: '产生了什么可衡量的结果？' },
};

const EVENT_ICONS: Record<string, string> = {
  note: '○', blocker: '🔴', pause: '⏸️', resume: '▶️',
};

export async function renderStarPanel(container: HTMLElement, taskId: string, taskStatus: string): Promise<void> {
  container.innerHTML = '<h3 style="margin-bottom:12px">📋 STAR 任务定义</h3>';

  // Load all events and stats
  const [events, stats] = await Promise.all([
    invoke<StarEvent[]>('get_star_events', { taskId }),
    invoke<PauseStats>('get_task_pause_stats', { taskId }),
  ]);

  // Group by section
  const grouped: Record<string, StarEvent[]> = { S: [], T: [], A: [], R: [] };
  for (const e of events) {
    if (grouped[e.star_section]) grouped[e.star_section].push(e);
  }

  // Pause status bar (if paused now)
  if (stats.is_paused_now) {
    container.innerHTML += `
      <div style="background:#fef3c7;border:1px solid #f59e0b;border-radius:6px;padding:8px 12px;margin-bottom:12px">
        ⏸️ 已暂停 — ${stats.current_pause_reason || '无原因'}
        <button onclick="resumeTask('${taskId}')" style="margin-left:8px;padding:4px 12px;background:#3b82f6;color:#fff;border:none;border-radius:4px;cursor:pointer">恢复</button>
      </div>`;
  }

  // Render each STAR section
  for (const section of ['S', 'T', 'A', 'R'] as const) {
    const label = SECTION_LABELS[section];
    const sectionEvents = grouped[section] || [];
    const sectionHtml = `
      <div style="background:#fff;border-radius:8px;margin-bottom:8px;overflow:hidden">
        <div onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display==='none'?'block':'none'"
             style="padding:10px 14px;cursor:pointer;display:flex;justify-content:space-between;border-bottom:1px solid #f1f5f9">
          <strong>[${section}] ${label.zh}</strong>
          <span style="color:#64748b;font-size:13px">${label.question}</span>
        </div>
        <div style="padding:8px 14px">
          ${sectionEvents.length === 0 ? '<p style="color:#94a3b8;font-size:13px">暂无记录</p>' : ''}
          ${sectionEvents.map(e => `
            <div style="display:flex;align-items:baseline;padding:4px 0;border-left:2px solid ${e.event_type === 'blocker' ? '#ef4444' : '#e2e8f0'};padding-left:10px;margin:4px 0">
              <span style="margin-right:6px">${EVENT_ICONS[e.event_type] || '○'}</span>
              <span style="flex:1">${e.content}</span>
              <small style="color:#94a3b8;font-size:12px">${e.created_at.slice(11, 19)}</small>
            </div>
          `).join('')}
          <div style="margin-top:6px;display:flex;gap:4px">
            <input id="star-input-${section}" placeholder="添加${label.zh}事件..." style="flex:1;padding:6px 8px;border:1px solid #e2e8f0;border-radius:4px;font-size:13px">
            <select id="star-type-${section}" style="padding:6px;border:1px solid #e2e8f0;border-radius:4px;font-size:13px">
              <option value="note">普通</option>
              <option value="blocker">🔴 阻碍</option>
              <option value="pause" ${section !== 'A' ? 'disabled' : ''}>⏸️ 暂停</option>
            </select>
            <button onclick="addStarEvent('${taskId}','${section}')" style="padding:6px 12px;background:#3b82f6;color:#fff;border:none;border-radius:4px;cursor:pointer">+</button>
          </div>
        </div>
      </div>`;
    container.innerHTML += sectionHtml;
  }

  // Pause statistics
  if (stats.pause_count > 0) {
    const hrs = Math.floor(stats.total_pause_seconds / 3600);
    const mins = Math.floor((stats.total_pause_seconds % 3600) / 60);
    container.innerHTML += `
      <div style="font-size:13px;color:#64748b;text-align:right;padding:8px">
        暂停 ${stats.pause_count} 次，共 ${hrs}h${mins}min
      </div>`;
  }
}
```

- [ ] **Step 2: Add global event handler functions to index.html**

Add inline scripts before `</body>` or add to main.ts. Since the STAR panel uses `onclick` attributes, add these as global functions:

Add to `src/main.ts` (at the bottom, before DOMContentLoaded listener):
```typescript
// ─── 全局事件处理（供 STAR 面板 onclick 使用）────────

(window as any).addStarEvent = async (taskId: string, section: string) => {
  const input = document.getElementById(`star-input-${section}`) as HTMLInputElement;
  const typeSelect = document.getElementById(`star-type-${section}`) as HTMLSelectElement;
  const content = input.value.trim();
  if (!content) return;
  try {
    await invoke('add_star_event', {
      input: { taskId, starSection: section, content, eventType: typeSelect.value }
    });
    // If pause event type, update task status to paused
    if (typeSelect.value === 'pause') {
      await invoke('pause_task', { taskId, reason: content });
    }
    // Refresh the view
    if (location.hash.startsWith('#task/')) {
      location.reload(); // simple reload to refresh
    }
  } catch (e) {
    alert(`添加失败: ${e}`);
  }
};

(window as any).resumeTask = async (taskId: string) => {
  try {
    await invoke('resume_task', { taskId });
    location.reload();
  } catch (e) {
    alert(`恢复失败: ${e}`);
  }
};
```

- [ ] **Step 3: Integrate STAR panel into task-detail.ts**

Replace the existing `renderTaskDetail` in `src/views/task-detail.ts` to call `renderStarPanel`:

```typescript
// src/views/task-detail.ts — 任务详情 + STAR 面板

import { invoke } from '@tauri-apps/api/core';
import { renderStarPanel } from './star-panel';

interface Task {
  id: string; title: string; description: string; priority: number;
  start_time: string; end_time: string; effort_percent: number;
  status: string; category: string;
}

export async function renderTaskDetail(container: HTMLElement, taskId: string): Promise<void> {
  container.innerHTML = '<h2>📄 任务详情</h2>';

  try {
    const tasks = await invoke<Task[]>('list_tasks', { status: null, category: null, from: null, to: null });
    const task = tasks.find(t => t.id === taskId);
    if (!task) { container.innerHTML = '<h2>任务未找到</h2>'; return; }

    // Task info header
    container.innerHTML += `
      <div style="background:#fff;border-radius:8px;padding:16px;margin-bottom:16px">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <h3>${task.title}</h3>
          <span style="padding:4px 10px;border-radius:12px;font-size:12px;background:${task.status === 'done' ? '#dcfce7' : task.status === 'paused' ? '#fef3c7' : '#dbeafe'};color:${task.status === 'done' ? '#16a34a' : task.status === 'paused' ? '#d97706' : '#2563eb'}">${task.status}</span>
        </div>
        <p style="color:#64748b;margin-top:8px">${task.description || '无描述'}</p>
        <div style="display:flex;gap:16px;margin-top:8px;font-size:14px;color:#475569">
          <span>优先级: ${task.priority}</span>
          <span>精力: ${task.effort_percent}%</span>
          <span>${task.start_time.slice(0,16)} → ${task.end_time.slice(0,16)}</span>
        </div>
        <a href="#personal" style="display:inline-block;margin-top:8px;color:#3b82f6;text-decoration:none">← 返回看板</a>
      </div>
      <div id="star-panel"></div>`;

    // Render STAR panel
    const starContainer = document.getElementById('star-panel')!;
    await renderStarPanel(starContainer, taskId, task.status);

  } catch (e) {
    container.innerHTML = `<h2>加载失败</h2><p style="color:#ef4444">${e}</p>`;
  }
}
```

- [ ] **Step 4: Verify frontend builds**

Run: `npm run build` — expect 0 errors

- [ ] **Step 5: Commit**

```bash
git add src/views/star-panel.ts src/views/task-detail.ts src/main.ts
git commit -m "feat(star): add STAR frontend panel with collapsible sections

S/T/A/R collapsible sections with event timeline, inline add,
pause/resume buttons, blocker markers, and pause statistics display."
```

---

## Phase 4: Workload Panel Visualization

### Task 5: Improve workload panel with chart-like visualization

**Files:**
- Modify: `src/views/personal.ts`

**Interfaces:**
- Consumes: Same `get_workload_panel` and `get_conflict_report` commands
- Produces: Better visual representation of workload data

- [ ] **Step 1: Enhance workload rendering in personal.ts**

Replace the existing workload rendering loop with a visual bar chart:

```typescript
// In src/views/personal.ts, replace the workload rendering section:

// Render workload as horizontal bar chart
wl.innerHTML = '<h3>精力占用</h3><div style="margin-top:8px">';

const maxPercent = Math.max(...workload.map(p => p.total_percent), 100);
for (const p of workload) {
  const color = p.level === 'error' ? '#ef4444' : p.level === 'warning' ? '#f59e0b' : '#22c55e';
  const barWidth = Math.round((p.total_percent / maxPercent) * 100);
  wl.innerHTML += `
    <div style="margin-bottom:6px">
      <div style="display:flex;justify-content:space-between;font-size:12px;color:#64748b">
        <span>${p.time.slice(11, 16)}</span>
        <span style="color:${color};font-weight:bold">${p.total_percent}%</span>
      </div>
      <div style="background:#e2e8f0;border-radius:4px;height:20px;overflow:hidden">
        <div style="width:${barWidth}%;height:100%;background:${color};border-radius:4px;transition:width 0.3s"></div>
      </div>
    </div>`;
}
```

- [ ] **Step 2: Verify frontend builds**

Run: `npm run build` — expect 0 errors

- [ ] **Step 3: Commit**

```bash
git add src/views/personal.ts
git commit -m "feat(ui): improve workload panel with bar chart visualization"
```

---

## Plan Summary

| Phase | Task | Description | Files |
|-------|------|-------------|-------|
| 0 | 0.1 | Fix 22 Rust warnings | 9 files |
| 1 | 1 | Add STAR DB tables | `db.rs` |
| 1 | 2 | Create task_star.rs module | `task_star.rs`, `lib.rs`, `task.rs` |
| 2 | 3 | Multi-view routing | `router.ts`, `index.html`, `main.ts`, `views/*` |
| 3 | 4 | STAR frontend panel | `star-panel.ts`, `task-detail.ts`, `main.ts` |
| 4 | 5 | Workload visualization | `personal.ts` |

**Dependency graph:**
```
Phase 0 (Cleanup) → Phase 1 (STAR backend) → Phase 3 (STAR frontend)
                                               ↘
Phase 0 → Phase 2 (Routing) → Phase 3 (needs routing infra)
                                Phase 4 (independent of STAR)
```
