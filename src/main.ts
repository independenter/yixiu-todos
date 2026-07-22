// src/main.ts — 前端入口，使用多视图路由
//
// 保留全局事件处理器供 HTML 内联交互及 STAR 面板使用。

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
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

// ─── 事件监听（导航/提醒）────────────────────────
try {
  listen<string>('navigate', (e) => {
    console.log('导航到', e.payload);
  });
} catch (e) {
  console.log('非 Tauri 环境，跳过事件监听');
}

// ─── 启动 ───────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  router.start();
  // 每 30 秒自动刷新当前视图
  setInterval(() => {
    if (location.hash) {
      router.navigate();
    }
  }, 30_000);
});

// ─── 全局事件处理器（供 HTML 内联 / STAR 面板使用）───

// 创建任务（由 create-task 表单调用）
(window as any).createTask = async () => {
  const title = (document.getElementById('task-title') as HTMLInputElement)?.value;
  const start = (document.getElementById('task-start') as HTMLInputElement)?.value;
  const end   = (document.getElementById('task-end') as HTMLInputElement)?.value;
  const effort = Number((document.getElementById('task-effort') as HTMLInputElement)?.value || 100);
  try {
    await invoke('create_task', {
      input: { title, description: '', priority: 2, start_time: start, end_time: end, effort_percent: effort, category: 'personal' }
    });
    // Refresh current view
    location.hash = location.hash || '#personal';
    location.reload();
  } catch (e) {
    console.error('创建任务失败', e);
    alert(`创建失败: ${e}`);
  }
};

// STAR 面板：添加事件
(window as any).addStarEvent = async (taskId: string, section: string) => {
  const input = document.getElementById(`star-input-${section}`) as HTMLInputElement;
  const typeSelect = document.getElementById(`star-type-${section}`) as HTMLSelectElement;
  const content = input?.value?.trim();
  if (!content) return;
  try {
    await invoke('add_star_event', {
      input: { taskId, starSection: section, content, eventType: typeSelect?.value || 'note' }
    });
    // If pause event, also update task status
    if (typeSelect?.value === 'pause') {
      await invoke('pause_task', { taskId, reason: content });
    }
    if (location.hash.startsWith('#task/')) {
      location.reload();
    }
  } catch (e) {
    alert(`添加失败: ${e}`);
  }
};

// STAR 面板：恢复暂停的任务
(window as any).resumeTask = async (taskId: string) => {
  try {
    await invoke('resume_task', { taskId });
    location.reload();
  } catch (e) {
    alert(`恢复失败: ${e}`);
  }
};
