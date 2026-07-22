// src/views/task-detail.ts — 任务详情 + STAR 面板

import { invoke } from '@tauri-apps/api/core';
import { renderStarPanel } from './star-panel';

interface Task {
  id: string; title: string; description: string; priority: number;
  start_time: string; end_time: string; effort_percent: number;
  status: string; category: string;
}

const STATUS_LABEL: Record<string, string> = {
  done: '已完成', active: '进行中', pending: '待处理', paused: '已暂停', postponed: '已延后',
};
const STATUS_BADGE: Record<string, string> = {
  done: 'badge-done', active: 'badge-active', pending: 'badge-pending', paused: 'badge-paused', postponed: 'badge-pending',
};

export async function renderTaskDetail(container: HTMLElement, taskId: string): Promise<void> {
  container.innerHTML = '';

  try {
    const tasks = await invoke<Task[]>('list_tasks', { status: null, category: null, from: null, to: null });
    const task = tasks.find(t => t.id === taskId);
    if (!task) {
      container.innerHTML = '<div class="card"><h3>任务未找到</h3><a href="#personal" style="color:#3b82f6;text-decoration:none">← 返回看板</a></div>';
      return;
    }

    container.innerHTML = `
      <div id="task-info" class="card">
        <div style="display:flex;justify-content:space-between;align-items:flex-start">
          <div>
            <h2 style="font-size:18px;font-weight:700">${task.title}</h2>
            <p style="color:#64748b;margin-top:4px;font-size:14px">${task.description || '暂无描述'}</p>
          </div>
          <span class="badge ${STATUS_BADGE[task.status] || 'badge-pending'}">${STATUS_LABEL[task.status] || task.status}</span>
        </div>
        <div style="display:flex;gap:16px;margin-top:10px;font-size:13px;color:#64748b">
          <span>优先级: ${'⭐'.repeat(Math.max(0, 5 - task.priority))}${'☆'.repeat(Math.min(4, task.priority - 1))}</span>
          <span>精力: <strong style="color:${task.effort_percent > 100 ? '#ef4444' : '#3b82f6'}">${task.effort_percent}%</strong></span>
          <span>类别: ${task.category}</span>
        </div>
        <div style="font-size:13px;color:#64748b;margin-top:4px">
          🕐 ${task.start_time.slice(0,16)} → ${task.end_time.slice(0,16)}
        </div>
        <a href="#personal" style="display:inline-block;margin-top:10px;color:#3b82f6;text-decoration:none;font-size:13px">← 返回看板</a>
      </div>
      <div id="star-panel"></div>`;

    const starContainer = document.getElementById('star-panel')!;
    await renderStarPanel(starContainer, taskId, task.status);

  } catch (e) {
    container.innerHTML = `<div class="card" style="color:#ef4444"><h3>⚠️ 加载失败</h3><p>${e}</p><a href="#personal" style="color:#3b82f6;text-decoration:none">← 返回看板</a></div>`;
  }
}
