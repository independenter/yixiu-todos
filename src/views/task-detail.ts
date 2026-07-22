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
