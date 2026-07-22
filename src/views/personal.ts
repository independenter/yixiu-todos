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
