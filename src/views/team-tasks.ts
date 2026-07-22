// src/views/team-tasks.ts — 项目任务列表（可拖拽 + 分配表单）

import { invoke } from '@tauri-apps/api/core';

interface ProjectTaskRow {
  id: string;
  employee_id: string;
  employee_name: string;
  title: string;
  priority: number;
  global_priority: number;
  project_priority: number;
  start_time: string;
  end_time: string;
  effort_percent: number;
  progress: number;
  status: string;
}

const PRIORITY_BADGE: Record<number, string> = {
  1: '🔥 紧急',
  2: '⚡ 高',
  3: '📋 中',
  4: '📎 低',
};

const PRIORITY_COLOR: Record<number, string> = {
  1: '#ef4444',
  2: '#f59e0b',
  3: '#3b82f6',
  4: '#64748b',
};

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** 时间 `HH:MM` 或完整 ISO 的简短显示 */
function timeLabel(t: string): string {
  if (!t) return '--:--';
  return t.length >= 16 ? t.slice(11, 16) : t;
}

export async function renderProjectTasks(container: HTMLElement, projectId: string): Promise<void> {
  let tasks: ProjectTaskRow[] = [];
  try {
    tasks = await invoke<ProjectTaskRow[]>('list_project_tasks', { projectId });
  } catch (e) {
    container.innerHTML = `<div class="card" style="color:#ef4444"><h3>⚠️ 加载失败</h3><p>${e}</p></div>`;
    return;
  }

  // 格式化时间范围
  const timeRange = (t: ProjectTaskRow): string => {
    const s = timeLabel(t.start_time);
    const e = timeLabel(t.end_time);
    return `${s} → ${e}`;
  };

  const doneCount = tasks.filter(t => t.status === 'done').length;

  let html = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">';
  html += `<h3 style="margin:0">📌 项目任务 <span style="font-weight:400;font-size:13px;color:#94a3b8">(${tasks.length} 项，${doneCount} 已完成)</span></h3>`;
  html += `<button onclick="showAssignForm('${projectId}')" style="padding:6px 14px;background:#3b82f6;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:500;font-size:13px">📋 分配任务</button>`;
  html += '</div>';

  // 分配表单（默认隐藏）
  html += `
    <div id="assign-form-${projectId}" style="display:none;margin-bottom:10px">
      <div class="card" style="border:1px solid #3b82f6">
        <h3>📋 分配新任务</h3>
        <div class="inline-form">
          <input id="at-title-${projectId}" placeholder="任务标题" style="flex:2">
          <input id="at-employee-${projectId}" placeholder="员工ID（输入人员ID）" style="flex:1">
        </div>
        <div class="inline-form">
          <input id="at-effort-${projectId}" type="number" placeholder="精力%" value="50" style="width:80px">
          <label style="font-size:12px;color:#64748b;display:flex;align-items:center;gap:4px">
            开始
            <input id="at-start-${projectId}" type="datetime-local" style="padding:6px 8px;border:1px solid #e2e8f0;border-radius:6px">
          </label>
          <label style="font-size:12px;color:#64748b;display:flex;align-items:center;gap:4px">
            结束
            <input id="at-end-${projectId}" type="datetime-local" style="padding:6px 8px;border:1px solid #e2e8f0;border-radius:6px">
          </label>
          <button onclick="confirmAssign('${projectId}')">分配</button>
          <button onclick="document.getElementById('assign-form-${projectId}').style.display='none'" style="background:#e2e8f0;color:#64748b">取消</button>
        </div>
      </div>
    </div>`;

  if (tasks.length === 0) {
    html += '<p style="color:#94a3b8;font-size:14px;padding:12px 0">暂无任务，点击上方按钮分配任务</p>';
  } else {
    for (const t of tasks) {
      const badgeLabel = PRIORITY_BADGE[t.priority] || `P${t.priority}`;
      const badgeColor = PRIORITY_COLOR[t.priority] || '#64748b';
      const statusLabel = t.status === 'done' ? '✅' : t.status === 'active' ? '▶️' : '⏳';

      html += `
        <div class="task-row" draggable="true"
             data-task-id="${t.id}"
             data-priority="${t.global_priority}"
             ondragstart="onDragStart(event)"
             ondragover="onDragOver(event)"
             ondrop="onDrop(event)"
             ondragend="onDragEnd(event)"
             style="cursor:grab;border-left-color:${badgeColor};user-select:none">
          <span style="cursor:grab;font-size:16px;margin-right:10px;opacity:0.5" title="拖拽排序">⠿</span>
          <div style="flex:1;min-width:0">
            <div style="font-weight:500;font-size:14px">${escHtml(t.title)}</div>
            <div style="font-size:12px;color:#94a3b8;margin-top:2px">
              👤 ${escHtml(t.employee_name)} · ⏱ ${t.effort_percent}% · 🕐 ${timeRange(t)}
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:8px;margin-left:12px">
            <span class="badge" style="background:#f1f5f9;color:${badgeColor}">${badgeLabel}</span>
            <span style="font-size:13px;color:#64748b">${statusLabel}</span>
          </div>
        </div>`;
    }
  }

  container.innerHTML = html;
}

// ─── 全局拖拽处理器 ───────────────────────────────
// 注册为全局 window 函数，由内联 HTML 事件调用

(window as any).dragSourceId = null as string | null;
(window as any).dragSourceEl = null as HTMLElement | null;

(window as any).onDragStart = (e: DragEvent) => {
  const row = (e.target as HTMLElement).closest('.task-row') as HTMLElement;
  if (!row) return;
  (window as any).dragSourceId = row.dataset.taskId;
  (window as any).dragSourceEl = row;
  row.style.opacity = '0.5';
  e.dataTransfer?.setData('text/plain', row.dataset.taskId || '');
};

(window as any).onDragOver = (e: DragEvent) => {
  e.preventDefault();
  const row = (e.target as HTMLElement).closest('.task-row') as HTMLElement;
  if (!row || row === (window as any).dragSourceEl) return;
  row.style.borderTop = '2px solid #3b82f6';
};

(window as any).onDrop = async (e: DragEvent) => {
  e.preventDefault();
  document.querySelectorAll('.task-row').forEach(el => (el as HTMLElement).style.borderTop = '');
  const targetRow = (e.target as HTMLElement).closest('.task-row') as HTMLElement;
  const sourceId = (window as any).dragSourceId;
  if (!targetRow || !sourceId || sourceId === targetRow.dataset.taskId) return;

  const parent = targetRow.parentElement;
  if (!parent) return;

  const rows = [...parent.querySelectorAll('.task-row')];
  const sourceIdx = rows.findIndex(r => r.dataset.taskId === sourceId);
  const targetIdx = rows.findIndex(r => r === targetRow);
  if (sourceIdx === -1 || targetIdx === -1) return;

  try {
    await invoke('update_task_priority', { taskId: sourceId, newGlobalPriority: targetIdx });
    // 重新渲染（通过外部队列）
    const container = document.getElementById('team-project-detail');
    if (container && container.dataset.projectId) {
      await renderProjectTasks(container, container.dataset.projectId);
    }
  } catch (err) {
    console.error('拖拽排序失败', err);
  }
};

(window as any).onDragEnd = (e: DragEvent) => {
  const row = (e.target as HTMLElement).closest('.task-row') as HTMLElement;
  if (row) row.style.opacity = '';
  document.querySelectorAll('.task-row').forEach(el => (el as HTMLElement).style.borderTop = '');
  (window as any).dragSourceId = null;
  (window as any).dragSourceEl = null;
};
