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

const STATUS_LABEL: Record<string, string> = {
  done: '已完成', active: '进行中', pending: '待处理', paused: '已暂停', postponed: '已延后',
};

export async function renderPersonal(container: HTMLElement): Promise<void> {
  container.innerHTML = '<h2 style="font-size:20px;font-weight:700;margin-bottom:16px">📋 个人看板</h2><div id="workload" class="card"></div><div id="tasks" class="card"></div>';

  try {
    const [tasks, workload] = await Promise.all([
      invoke<Task[]>('list_tasks', { status: null, category: null, from: null, to: null }),
      invoke<WorkloadPoint[]>('get_workload_panel', { from: null, to: null }),
    ]);

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
    for (const t of tasks) {
      const badgeClass = `badge badge-${t.status === 'done' ? 'done' : t.status === 'paused' ? 'paused' : t.status === 'active' ? 'active' : 'pending'}`;
      const borderColor = t.status === 'done' ? '#22c55e' : t.status === 'paused' ? '#f59e0b' : t.status === 'active' ? '#3b82f6' : '#e2e8f0';
      tlHtml += `
        <div class="task-row" onclick="location.hash='#task/${t.id}'" style="border-left-color:${borderColor}">
          <div class="title">${t.title}</div>
          <div style="display:flex;align-items:center;gap:10px">
            <span class="meta">${t.start_time.slice(11,16)}→${t.end_time.slice(11,16)}</span>
            <span class="effort" style="color:${t.effort_percent > 100 ? '#ef4444' : t.effort_percent > 80 ? '#f59e0b' : '#22c55e'}">${t.effort_percent}%</span>
            <span class="badge ${badgeClass}">${STATUS_LABEL[t.status] || t.status}</span>
          </div>
        </div>`;
    }
    if (tasks.length === 0) tlHtml += '<p style="color:#94a3b8;font-size:14px;padding:12px 0">还没有任务，快去创建吧 ✨</p>';
    tl.innerHTML = tlHtml;
  } catch (e) {
    container.innerHTML += `<div class="card" style="color:#ef4444"><h3>⚠️ 加载失败</h3><p style="font-size:14px">${e}</p><p style="font-size:12px;color:#94a3b8;margin-top:8px">请确保应用已通过 <code>npm run tauri dev</code> 启动</p></div>`;
  }
}
