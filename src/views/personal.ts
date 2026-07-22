// src/views/personal.ts — 个人看板视图

import { invoke } from '@tauri-apps/api/core';

interface Task {
  id: string; title: string; description?: string; priority: number;
  start_time: string; end_time: string;
  effort_percent: number; status: string; category: string;
}

interface WorkloadPoint {
  time: string; total_percent: number; level: string; task_ids: string[];
}

interface ConflictItem {
  task_a_id: string;
  task_b_id: string;
  overlap_minutes: number;
  severity: 'warning' | 'error';
  time_range: string;
}

const STATUS_LABEL: Record<string, string> = {
  done: '已完成', active: '进行中', pending: '待处理', paused: '已暂停', postponed: '已延后',
};

let editingId: string | null = null;
let currentContainer: HTMLElement | null = null;
let taskMap: Record<string, Task> = {};

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function getFormHtml(): string {
  return `
    <div id="task-form" class="card" style="display:none;margin-bottom:12px;border:1px solid #3b82f6">
      <h3 id="form-title">📝 新建任务</h3>
      <input id="tf-title" placeholder="任务标题" style="width:100%;padding:7px 10px;border:1px solid #e2e8f0;border-radius:6px;outline:none;margin-bottom:8px">
      <textarea id="tf-desc" placeholder="描述" style="width:100%;padding:7px 10px;border:1px solid #e2e8f0;border-radius:6px;outline:none;margin-bottom:8px;resize:vertical;min-height:60px;font-family:inherit;font-size:13px"></textarea>
      <div style="display:flex;gap:8px;margin-bottom:8px">
        <select id="tf-priority" style="padding:7px 8px;border:1px solid #e2e8f0;border-radius:6px;background:#fff">
          <option value="1">🔥紧急</option>
          <option value="2" selected>⚡高</option>
          <option value="3">📋中</option>
          <option value="4">📎低</option>
        </select>
        <input id="tf-effort" type="number" placeholder="精力%" value="100" style="width:80px;padding:7px 10px;border:1px solid #e2e8f0;border-radius:6px;outline:none">
        <input id="tf-category" placeholder="类别" value="personal" style="width:120px;padding:7px 10px;border:1px solid #e2e8f0;border-radius:6px;outline:none">
      </div>
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:10px;flex-wrap:wrap">
        <span style="font-size:13px;color:#64748b">开始</span>
        <input id="tf-start-date" placeholder="2026-07-22" style="flex:1;min-width:110px;padding:7px 10px;border:1px solid #e2e8f0;border-radius:6px;outline:none;font-size:13px">
        <input id="tf-start-time" placeholder="09:00" value="" style="width:90px;padding:7px 10px;border:1px solid #e2e8f0;border-radius:6px;outline:none;font-size:13px">
        <span style="color:#94a3b8">→</span>
        <span style="font-size:13px;color:#64748b">结束</span>
        <input id="tf-end-date" placeholder="2026-07-22" style="flex:1;min-width:110px;padding:7px 10px;border:1px solid #e2e8f0;border-radius:6px;outline:none;font-size:13px">
        <input id="tf-end-time" placeholder="10:00" value="" style="width:90px;padding:7px 10px;border:1px solid #e2e8f0;border-radius:6px;outline:none;font-size:13px">
      </div>
      <div style="display:flex;gap:8px">
        <button id="tf-save" style="padding:7px 14px;background:#3b82f6;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:500">保存</button>
        <button id="tf-cancel" style="padding:7px 14px;background:#e2e8f0;color:#64748b;border:none;border-radius:6px;cursor:pointer">取消</button>
      </div>
    </div>`;
}

function showForm(mode: 'create' | 'edit', task?: Task): void {
  const form = document.getElementById('task-form') as HTMLElement;
  const titleEl = document.getElementById('form-title')!;
  const titleInput = document.getElementById('tf-title') as HTMLInputElement;
  const descInput = document.getElementById('tf-desc') as HTMLTextAreaElement;
  const prioritySelect = document.getElementById('tf-priority') as HTMLSelectElement;
  const effortInput = document.getElementById('tf-effort') as HTMLInputElement;
  const categoryInput = document.getElementById('tf-category') as HTMLInputElement;
  const startDate = document.getElementById('tf-start-date') as HTMLInputElement;
  const startTime = document.getElementById('tf-start-time') as HTMLInputElement;
  const endDate = document.getElementById('tf-end-date') as HTMLInputElement;
  const endTime = document.getElementById('tf-end-time') as HTMLInputElement;

  if (mode === 'edit' && task) {
    editingId = task.id;
    titleEl.textContent = '✏️ 编辑任务';
    titleInput.value = task.title;
    descInput.value = task.description || '';
    prioritySelect.value = String(task.priority);
    effortInput.value = String(task.effort_percent);
    categoryInput.value = task.category || '';
    if (task.start_time) {
      startDate.value = task.start_time.slice(0, 10);
      startTime.value = task.start_time.slice(11, 16);
    }
    if (task.end_time) {
      endDate.value = task.end_time.slice(0, 10);
      endTime.value = task.end_time.slice(11, 16);
    }
  } else {
    editingId = null;
    titleEl.textContent = '📝 新建任务';
    titleInput.value = '';
    descInput.value = '';
    prioritySelect.value = '2';
    effortInput.value = '100';
    categoryInput.value = 'personal';
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    startDate.value = now.toISOString().slice(0, 10);
    startTime.value = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    const soon = new Date(now.getTime() + 3600000);
    endDate.value = soon.toISOString().slice(0, 10);
    endTime.value = `${pad(soon.getHours())}:${pad(soon.getMinutes())}`;
  }
  form.style.display = '';
}

function bindFormEvents(): void {
  const form = document.getElementById('task-form') as HTMLElement;
  const newBtn = document.getElementById('btn-new-task');

  newBtn?.addEventListener('click', () => showForm('create'));

  document.getElementById('tf-cancel')?.addEventListener('click', () => {
    form.style.display = 'none';
  });

  document.getElementById('tf-save')?.addEventListener('click', async () => {
    const title = (document.getElementById('tf-title') as HTMLInputElement).value.trim();
    if (!title) { alert('⚠️ 请输入任务标题'); return; }

    const description = (document.getElementById('tf-desc') as HTMLTextAreaElement).value.trim();
    const priority = parseInt((document.getElementById('tf-priority') as HTMLSelectElement).value);
    const effort_percent = parseInt((document.getElementById('tf-effort') as HTMLInputElement).value) || 100;
    if (effort_percent < 0 || effort_percent > 200) { alert('⚠️ 精力占用必须在 0-200 之间'); return; }
    const category = (document.getElementById('tf-category') as HTMLInputElement).value.trim() || 'personal';
    const startDate = (document.getElementById('tf-start-date') as HTMLInputElement).value;
    const startTime = (document.getElementById('tf-start-time') as HTMLInputElement).value;
    const endDate = (document.getElementById('tf-end-date') as HTMLInputElement).value;
    const endTime = (document.getElementById('tf-end-time') as HTMLInputElement).value;

    // 日期格式校验
    const dateRe = /^\d{4}-\d{2}-\d{2}$/;
    const timeRe = /^\d{2}:\d{2}$/;
    if (!dateRe.test(startDate) || !timeRe.test(startTime)) { alert('⚠️ 开始时间格式不正确，请使用 YYYY-MM-DD HH:MM'); return; }
    if (!dateRe.test(endDate) || !timeRe.test(endTime)) { alert('⚠️ 结束时间格式不正确，请使用 YYYY-MM-DD HH:MM'); return; }

    const startDt = new Date(`${startDate}T${startTime}`);
    const endDt = new Date(`${endDate}T${endTime}`);
    if (isNaN(startDt.getTime())) { alert('⚠️ 开始时间无效'); return; }
    if (isNaN(endDt.getTime())) { alert('⚠️ 结束时间无效'); return; }
    if (endDt <= startDt) { alert('⚠️ 结束时间必须晚于开始时间'); return; }

    const start_time = startDt.toISOString();
    const end_time = endDt.toISOString();

    try {
      if (editingId) {
        await invoke('update_task', { id: editingId, patch: { title, description, priority, start_time, end_time, effort_percent, category } });
      } else {
        await invoke('create_task', { input: { title, description, priority, start_time, end_time, effort_percent, category } });
      }
      form.style.display = 'none';
      if (currentContainer) renderPersonal(currentContainer);
    } catch (e) {
      alert('❌ 操作失败: ' + e);
    }
  });
}

function bindTaskActions(tl: HTMLElement): void {
  // Edit
  tl.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('.edit-btn') as HTMLElement;
    if (!btn) return;
    e.stopPropagation();
    const id = btn.dataset.editId;
    if (id && taskMap[id]) showForm('edit', taskMap[id]);
  });

  // Delete
  tl.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('.delete-btn') as HTMLElement;
    if (!btn) return;
    e.stopPropagation();
    const id = btn.dataset.deleteId;
    if (!id || !taskMap[id]) return;
    const task = taskMap[id];
    if (confirm(`确定删除任务 "${task.title}"？`)) {
      invoke('delete_task', { id }).then(() => {
        if (currentContainer) renderPersonal(currentContainer);
      }).catch((err) => alert('删除失败: ' + err));
    }
  });

  // Complete checkbox
  tl.addEventListener('change', (e) => {
    const cb = (e.target as HTMLElement).closest('.complete-cb') as HTMLInputElement;
    if (!cb) return;
    e.stopPropagation();
    const id = cb.dataset.completeId;
    if (!id) return;
    invoke('complete_task', { id }).then(() => {
      if (currentContainer) renderPersonal(currentContainer);
    }).catch((err) => {
      alert('操作失败: ' + err);
      if (currentContainer) renderPersonal(currentContainer);
    });
  });
}

export async function renderPersonal(container: HTMLElement): Promise<void> {
  currentContainer = container;
  container.innerHTML = '<h2 style="font-size:20px;font-weight:700;margin-bottom:16px">📋 个人看板</h2><div id="workload" class="card"></div><div id="tasks" class="card"></div><div id="conflicts" class="card"></div>';

  try {
    const [tasks, workload, conflicts] = await Promise.all([
      invoke<Task[]>('list_tasks', { status: null, category: null, from: null, to: null }),
      invoke<WorkloadPoint[]>('get_workload_panel', { from: null, to: null }),
      invoke<ConflictItem[]>('get_conflict_report'),
    ]);

    // Build task lookup map
    taskMap = {};
    for (const t of tasks) { taskMap[t.id] = t; }

    // ─── 精力柱状图 ─────────────────────────
    const wl = document.getElementById('workload')!;
    const maxPercent = Math.max(...workload.map(p => p.total_percent), 100);
    let wlHtml = '<h3>⏱️ 精力占用</h3><div style="margin-top:10px">';
    for (const p of workload) {
      const color = p.level === 'error' ? '#ef4444' : p.level === 'warning' ? '#f59e0b' : '#22c55e';
      const barWidth = Math.round((p.total_percent / maxPercent) * 100);
      wlHtml += `
        <div style="margin-bottom:7px">
          <div style="display:flex;justify-content:space-between;font-size:12px;color:#64748b;margin-bottom:3px">
            <span>${p.time.slice(11, 16)}</span>
            <span style="color:${color};font-weight:700">${p.total_percent}%</span>
          </div>
          <div class="bar-bg">
            <div class="bar-fill" style="width:${barWidth}%;background:${color}"></div>
          </div>
        </div>`;
    }
    if (workload.length === 0) wlHtml += '<p style="color:#94a3b8;font-size:14px;padding:12px 0">暂无任务，开始添加吧</p>';
    wl.innerHTML = wlHtml;

    // ─── 任务列表 ────────────────────────────
    const tl = document.getElementById('tasks')!;
    let tlHtml = '<h3>📌 任务列表 <span style="font-weight:400;font-size:13px;color:#94a3b8">(' + tasks.length + ')</span></h3>';
    tlHtml += '<button id="btn-new-task" style="padding:6px 14px;background:#3b82f6;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:500;font-size:13px;margin-bottom:10px">➕ 新建任务</button>';
    tlHtml += getFormHtml();

    for (const t of tasks) {
      const badgeClass = `badge badge-${t.status === 'done' ? 'done' : t.status === 'paused' ? 'paused' : t.status === 'active' ? 'active' : 'pending'}`;
      const borderColor = t.status === 'done' ? '#22c55e' : t.status === 'paused' ? '#f59e0b' : t.status === 'active' ? '#3b82f6' : '#e2e8f0';
      const isDone = t.status === 'done';
      tlHtml += `
        <div class="task-row" onclick="location.hash='#task/${t.id}'" style="border-left-color:${borderColor}">
          <input type="checkbox" ${isDone ? 'checked' : ''} class="complete-cb" data-complete-id="${t.id}" style="margin-right:10px;cursor:pointer" ${isDone ? 'disabled' : ''}>
          <div class="title" style="${isDone ? 'text-decoration:line-through;color:#94a3b8' : ''}">${escHtml(t.title)}</div>
          <div style="display:flex;align-items:center;gap:10px">
            <span class="meta">${t.start_time.slice(11,16)}→${t.end_time.slice(11,16)}</span>
            <span class="effort" style="color:${t.effort_percent > 100 ? '#ef4444' : t.effort_percent > 80 ? '#f59e0b' : '#22c55e'}">${t.effort_percent}%</span>
            <span class="badge ${badgeClass}">${STATUS_LABEL[t.status] || t.status}</span>
            <span style="cursor:pointer;font-size:16px;opacity:0.6" class="edit-btn" data-edit-id="${t.id}" title="编辑">✏️</span>
            <span style="cursor:pointer;font-size:16px;opacity:0.6" class="delete-btn" data-delete-id="${t.id}" title="删除">🗑️</span>
          </div>
        </div>`;
    }
    if (tasks.length === 0) tlHtml += '<p style="color:#94a3b8;font-size:14px;padding:12px 0">还没有任务，快去创建吧 ✨</p>';
    tl.innerHTML = tlHtml;

    // ─── 冲突报告 ────────────────────────────
    const cl = document.getElementById('conflicts')!;
    if (conflicts.length === 0) {
      cl.innerHTML = '<h3>⚠️ 时间冲突</h3><p style="color:#22c55e;font-size:14px;padding:12px 0">✅ 当前无时间冲突</p>';
    } else {
      let clHtml = '<h3>⚠️ 时间冲突 <span style="font-weight:400;font-size:13px;color:#94a3b8">(' + conflicts.length + ')</span></h3>';
      for (const c of conflicts) {
        const icon = c.severity === 'error' ? '🔴' : '🟡';
        const titleA = taskMap[c.task_a_id]?.title || '(已删除)';
        const titleB = taskMap[c.task_b_id]?.title || '(已删除)';
        clHtml += `
        <div style="display:flex;align-items:flex-start;gap:10px;padding:10px 0;border-bottom:1px solid #f1f5f9">
          <span style="font-size:18px;line-height:1.4">${icon}</span>
          <div style="flex:1;min-width:0">
            <div style="font-size:14px;font-weight:500;color:#1e293b">${escHtml(titleA)} ↔ ${escHtml(titleB)}</div>
            <div style="font-size:12px;color:#ef4444;margin-top:3px">重叠 ${c.overlap_minutes} 分钟</div>
          </div>
        </div>`;
      }
      cl.innerHTML = clHtml;
    }

    // ─── 事件绑定 ────────────────────────────
    bindFormEvents();
    bindTaskActions(tl);

  } catch (e) {
    container.innerHTML += `<div class="card" style="color:#ef4444"><h3>⚠️ 加载失败</h3><p style="font-size:14px">${e}</p><p style="font-size:12px;color:#94a3b8;margin-top:8px">请确保应用已通过 <code>npm run tauri dev</code> 启动</p></div>`;
  }
}
