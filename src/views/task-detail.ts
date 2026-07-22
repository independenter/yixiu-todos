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
