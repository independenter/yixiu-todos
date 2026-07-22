# Team Panel Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task.

**Goal:** Redesign the team panel from employee-centric cards to a project-centered view with dual-priority task management, drag-and-drop sorting, and individual workload overview.

**Architecture:** New `projects` SQLite table with `employee_tasks` extended columns. Rust backend adds project CRUD commands and priority sync logic. Frontend rewritten as three-section layout: Project Overview → Project Detail (draggable tasks) → Individual Workload.

**Tech Stack:** Rust + Tauri 2, rusqlite (SQLite), Vanilla TypeScript + HTML5 Drag & Drop API

**Design Doc:** `docs/superpowers/specs/2026-07-22-team-panel-redesign.md`

## Global Constraints

- All Rust commands return `Result<T, String>` for Tauri IPC compatibility
- Database schema changes are additive (ALTER TABLE ADD COLUMN, CREATE TABLE IF NOT EXISTS) — never drop existing columns
- Frontend uses native DOM APIs (no framework dependency)
- New Rust modules must be declared in `lib.rs` and commands registered in `invoke_handler`
- Drag-and-drop uses native HTML5 DnD API, no third-party libraries
- Dual priority sync: update `global_priority` → auto-recalculate `project_priority` and vice versa
- Employee management moves to a collapsible secondary section

---

## Phase 0: Database + Backend Foundation

### Task 1: Add `projects` table and migrate `employee_tasks`

**Files:**
- Modify: `src-tauri/src/db.rs`
- Modify: `src-tauri/src/employee.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Produces: `projects` table, expanded `employee_tasks` with `project_id`, `global_priority`, `project_priority`

- [ ] **Step 1: Add `projects` table to db.rs**

In `db.rs`, add a new section after the employee tables:

```rust
    // ─── 项目表 ──────────────────────────────────────────
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS projects (
            id          TEXT PRIMARY KEY,
            name        TEXT NOT NULL,
            description TEXT DEFAULT '',
            priority    INTEGER NOT NULL DEFAULT 2,
            status      TEXT NOT NULL DEFAULT 'active',
            created_at  TEXT NOT NULL,
            updated_at  TEXT NOT NULL
        );
        "#,
    )?;

    // 为旧 employee_tasks 添加扩展列
    let _ = conn.execute("ALTER TABLE employee_tasks ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE SET NULL", []);
    let _ = conn.execute("ALTER TABLE employee_tasks ADD COLUMN global_priority INTEGER NOT NULL DEFAULT 0", []);
    let _ = conn.execute("ALTER TABLE employee_tasks ADD COLUMN project_priority INTEGER NOT NULL DEFAULT 0", []);
```

- [ ] **Step 2: Update `EmpTaskInput` to include project_id**

In `employee.rs`, add `project_id` to EmpTaskInput:
```rust
#[derive(Debug, Serialize, Deserialize)]
pub struct EmpTaskInput {
    pub employee_id: String,
    pub title: String,
    pub description: Option<String>,
    pub priority: Option<i64>,
    pub start_time: String,
    pub end_time: String,
    pub effort_percent: Option<i64>,
    pub project_id: Option<String>,  // NEW
}
```

Update the INSERT in `assign_task_to_employee`:
```rust
// Change from:
"INSERT INTO employee_tasks (id,employee_id,title,description,priority,start_time,end_time,effort_percent,progress,status,created_at,updated_at)"
// To:
"INSERT INTO employee_tasks (id,employee_id,title,description,priority,start_time,end_time,effort_percent,project_id,progress,status,created_at,updated_at)"

// Add project_id to params:
input.project_id.unwrap_or_default(),
```

Also add `project_id` and `global_priority` to `EmpTaskRow`:
```rust
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
    pub project_id: Option<String>,    // NEW
    pub global_priority: i64,          // NEW
}
```

- [ ] **Step 3: Verify build**

Run: `cargo build` — expect 0 errors, 0 warnings

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(db): add projects table, extend employee_tasks with project_id and priorities"
```

---

### Task 2: Add project CRUD commands

**Files:**
- Create: `src-tauri/src/project.rs`
- Modify: `src-tauri/src/lib.rs` (register module + commands)

**Interfaces:**
- Produces: Tauri commands `create_project`, `list_projects`, `update_project`, `delete_project`
- Produces: Tauri command `list_project_tasks` — returns tasks grouped by project

- [ ] **Step 1: Create `project.rs` with DTOs and commands**

```rust
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
            created_at: r.get(5)?, updated_at: r.get(6)?,
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
```

- [ ] **Step 2: Register in lib.rs**

```rust
// Add after `mod employee;`:
mod project;

// Add commands in invoke_handler:
            project::create_project,
            project::list_projects,
            project::update_project,
            project::delete_project,
            project::list_project_tasks,
            project::update_task_priority,
```

- [ ] **Step 3: Verify build**

Run: `cargo build` — expect 0 errors

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(project): add project CRUD and dual-priority task management"
```

---

## Phase 1: Frontend — Team Panel Rewrite

### Task 3: Create project overview section

**Files:**
- Create: `src/views/team-projects.ts` — project cards grid
- Modify: `src/views/team.ts` — new layout shell

**Interfaces:**
- Consumes: `list_projects` → `ProjectWithStats[]`, `list_project_tasks(projectId)` → `ProjectTaskRow[]`
- Produces: Top section: project cards with stats (member count, task completion, overload)

- [ ] **Step 1: Rewrite `team.ts` as layout shell**

```typescript
// src/views/team.ts — 团队面板（项目中心布局）

import { invoke } from '@tauri-apps/api/core';
import { renderProjectOverview } from './team-projects';
import { renderProjectDetail } from './team-tasks';
import { renderWorkloadOverview } from './team-workload';

let selectedProjectId: string | null = null;

export async function renderTeam(container: HTMLElement): Promise<void> {
  container.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:16px">
      <h2 style="font-size:20px;font-weight:700">👥 团队面板</h2>
      <div id="team-range" style="display:flex;gap:4px"></div>
    </div>
    <div id="team-projects" class="card"></div>
    <div id="team-project-detail"></div>
    <div id="team-workload" class="card" style="margin-top:12px"></div>
    <details style="margin-top:12px;opacity:0.7">
      <summary style="cursor:pointer;font-size:13px;color:#64748b;padding:4px 0">⚙️ 员工管理</summary>
      <div id="team-employees" style="margin-top:8px"></div>
    </details>`;

  await renderProjectOverview(container);
  await renderProjectDetail(container, selectedProjectId);
  await renderWorkloadOverview(container);
}
```

- [ ] **Step 2: Update `main.ts` to use the new renderTeam**

The team view already switches correctly — no change needed to router.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(ui): restructure team panel layout shell"
```

---

### Task 4: Build project overview cards

**Files:**
- Create: `src/views/team-projects.ts`

- [ ] **Step 1: Create `team-projects.ts`**

```typescript
// src/views/team-projects.ts — 项目总览卡片

import { invoke } from '@tauri-apps/api/core';

interface ProjectStats {
  id: string; name: string; description: string; priority: number;
  status: string; member_count: number; task_total: number;
  task_done: number; overload_count: number;
}

export async function renderProjectOverview(container: HTMLElement): Promise<void> {
  const div = document.getElementById('team-projects')!;
  try {
    const projects = await invoke<ProjectStats[]>('list_projects');
    let html = '<div style="display:flex;gap:10px;overflow-x:auto;padding-bottom:4px">';
    html += `<div onclick="showNewProjectForm()" style="min-width:140px;padding:16px;border:2px dashed #e2e8f0;border-radius:10px;cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;color:#94a3b8">
      <span style="font-size:24px">➕</span><span style="font-size:13px">新建项目</span>
    </div>`;
    for (const p of projects) {
      const rate = p.task_total > 0 ? Math.round(p.task_done / p.task_total * 100) : 0;
      const color = p.overload_count > 0 ? '#ef4444' : rate > 80 ? '#22c55e' : '#3b82f6';
      html += `<div onclick="selectProject('${p.id}')" style="min-width:180px;padding:14px;background:#f8fafc;border-radius:10px;cursor:pointer;border:1px solid #eef2f6">
        <div style="font-weight:600;font-size:14px">${p.name}</div>
        <div style="font-size:12px;color:#64748b;margin-top:4px">${p.member_count}人 · ${p.task_done}/${p.task_total}完成</div>
        <div class="bar-bg" style="margin-top:6px;height:6px">
          <div class="bar-fill" style="width:${rate}%;background:${color};height:6px"></div>
        </div>
        <div style="font-size:11px;color:#94a3b8;margin-top:4px">优先级 P${p.priority}</div>
      </div>`;
    }
    html += '</div>';
    div.innerHTML = html;
  } catch (e) {
    div.innerHTML = `<p style="color:#ef4444">加载失败: ${e}</p>`;
  }
}
```

- [ ] **Step 2: Add global handlers**

In `main.ts`, add:
```typescript
(window as any).selectProject = (id: string) => {
  selectedProjectId = selectedProjectId === id ? null : id;
  if (currentTeamContainer) renderTeam(currentTeamContainer);
};
```

Note: need to add `let currentTeamContainer: HTMLElement | null = null;` and set it in `renderTeam`.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(ui): add project overview cards"
```

---

### Task 5: Build project detail with drag-and-drop task list

**Files:**
- Create: `src/views/team-tasks.ts`

- [ ] **Step 1: Create `team-tasks.ts` with draggable task list**

```typescript
// src/views/team-tasks.ts — 项目内任务列表（可拖拽排序）

import { invoke } from '@tauri-apps/api/core';

interface ProjectTask {
  id: string; employee_id: string; employee_name: string;
  title: string; priority: number; global_priority: number;
  project_priority: number; start_time: string; end_time: string;
  effort_percent: number; progress: number; status: string;
}

export async function renderProjectDetail(container: HTMLElement, projectId: string | null): Promise<void> {
  const div = document.getElementById('team-project-detail')!;
  if (!projectId) { div.innerHTML = ''; return; }

  try {
    const tasks = await invoke<ProjectTask[]>('list_project_tasks', { projectId });
    let html = '<div class="card"><h3 style="font-size:15px;font-weight:600;margin-bottom:10px">📋 项目任务</h3>';
    if (tasks.length === 0) {
      html += '<p style="color:#94a3b8;font-size:14px;padding:8px 0">暂无任务，点击分配</p>';
    } else {
      for (const t of tasks) {
        const total = tasks.reduce((s, t) => s + t.effort_percent, 0);
        const warn = t.effort_percent > 100 ? '🔴' : t.effort_percent > 80 ? '🟡' : '🟢';
        html += `
        <div draggable="true" class="task-row" data-task-id="${t.id}" style="border-left-color:${t.status === 'done' ? '#22c55e' : '#e2e8f0'};cursor:grab"
             ondragstart="onDragStart(event, '${t.id}')" ondragover="onDragOver(event)" ondrop="onDrop(event)" ondragend="onDragEnd(event)">
          <div style="flex:1">
            <div style="font-weight:500;font-size:14px">${escHtml(t.title)}</div>
            <div style="font-size:12px;color:#64748b;margin-top:2px">
              👤 ${t.employee_name} · ${warn} ${t.effort_percent}% · ${t.start_time.slice(11,16)}→${t.end_time.slice(11,16)}
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:6px">
            <span style="font-size:12px;color:#94a3b8">P${t.priority}</span>
            <span style="cursor:grab;color:#94a3b8">⠿</span>
          </div>
        </div>`;
      }
    }
    html += `<button onclick="showAssignForm('${projectId}')" style="margin-top:8px;padding:8px 14px;background:#3b82f6;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px">📋 分配任务</button>`;
    html += '</div>';
    div.innerHTML = html;
  } catch (e) {
    div.innerHTML = `<p style="color:#ef4444">${e}</p>`;
  }
}

// Drag & Drop handlers (added to window)
(window as any).onDragStart = (e: DragEvent, taskId: string) => {
  e.dataTransfer?.setData('text/plain', taskId);
  (e.target as HTMLElement).style.opacity = '0.5';
};
(window as any).onDragOver = (e: DragEvent) => {
  e.preventDefault();
  const el = e.target as HTMLElement;
  const row = el.closest('.task-row') as HTMLElement;
  if (row) row.style.borderTop = '2px solid #3b82f6';
};
(window as any).onDrop = async (e: DragEvent) => {
  e.preventDefault();
  const taskId = e.dataTransfer?.getData('text/plain');
  const targetRow = (e.target as HTMLElement).closest('.task-row') as HTMLElement;
  if (!taskId || !targetRow) return;
  // Reorder: get current list, find new position, update global_priority
  const container = document.getElementById('team-project-detail');
  const rows = [...(container?.querySelectorAll('.task-row') || [])];
  const newIndex = rows.indexOf(targetRow);
  try {
    await invoke('update_task_priority', { taskId, newGlobalPriority: newIndex });
    // Refresh the view
    const teamContainer = document.getElementById('app');
    if (teamContainer) {
      const { renderTeam } = await import('./views/team');
      await renderTeam(teamContainer);
    }
  } catch (err) { alert('排序失败: ' + err); }
};
(window as any).onDragEnd = (e: DragEvent) => {
  (e.target as HTMLElement).style.opacity = '1';
  document.querySelectorAll('.task-row').forEach(r => (r as HTMLElement).style.borderTop = '');
};

function escHtml(s: string): string { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
```

- [ ] **Step 2: Commit**

```bash
git add -A && git commit -m "feat(ui): add draggable project task list with priority sync"
```

---

### Task 6: Build individual workload overview

**Files:**
- Create: `src/views/team-workload.ts`

- [ ] **Step 1: Create `team-workload.ts`**

```typescript
// src/views/team-workload.ts — 个人投入概览

import { invoke } from '@tauri-apps/api/core';

interface Employee {
  id: string; name: string; role: string;
}

interface EmpWorkload {
  employee_id: string; name: string; total_percent: number;
  active_tasks: number; avg_progress: number; alerts: string[];
}

export async function renderWorkloadOverview(container: HTMLElement): Promise<void> {
  const div = document.getElementById('team-workload')!;
  try {
    const employees = await invoke<Employee[]>('list_employees');
    if (employees.length === 0) {
      div.innerHTML = '<h3 style="font-size:15px;font-weight:600;margin-bottom:8px">👤 个人投入</h3><p style="color:#94a3b8;font-size:13px">暂无员工</p>';
      return;
    }
    let html = '<h3 style="font-size:15px;font-weight:600;margin-bottom:10px">👤 个人投入 <span style="font-weight:400;font-size:12px;color:#94a3b8">跨项目精力总和</span></h3>';
    for (const emp of employees) {
      try {
        const wl = await invoke<EmpWorkload>('get_employee_workload', { employeeId: emp.id });
        const color = wl.total_percent > 100 ? '#ef4444' : wl.total_percent > 80 ? '#f59e0b' : '#22c55e';
        const barWidth = Math.min(wl.total_percent, 200);
        html += `
        <div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid #f1f5f9">
          <span style="font-weight:500;font-size:14px;min-width:60px">${emp.name}</span>
          <div class="bar-bg" style="flex:1;height:16px">
            <div class="bar-fill" style="width:${barWidth}%;background:${color};height:16px"></div>
          </div>
          <span style="font-size:13px;font-weight:600;color:${color};min-width:50px;text-align:right">${wl.total_percent}%</span>
          <span style="font-size:11px;color:#94a3b8;min-width:50px">${wl.active_tasks}项</span>
        </div>`;
      } catch {}
    }
    div.innerHTML = html;
  } catch (e) {
    div.innerHTML = `<p style="color:#ef4444">${e}</p>`;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add -A && git commit -m "feat(ui): add individual workload overview section"
```

---

## Plan Summary

| Phase | Task | Description | Files |
|-------|------|-------------|-------|
| 0 | 1 | Add projects table + migrate employee_tasks | `db.rs`, `employee.rs` |
| 0 | 2 | Project CRUD + priority commands | `project.rs`, `lib.rs` |
| 1 | 3 | Team panel layout shell | `team.ts` |
| 1 | 4 | Project overview cards | `team-projects.ts` |
| 1 | 5 | Draggable task list + DnD | `team-tasks.ts` |
| 1 | 6 | Individual workload overview | `team-workload.ts` |

**Dependency graph:**
```
Task 1 (DB) → Task 2 (Backend) → Task 3 (Layout) → Task 4 (Projects)
                                                    → Task 5 (Tasks)
                                                    → Task 6 (Workload)
```
