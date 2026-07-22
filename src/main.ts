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
listen<string>('navigate', (e) => {
  console.log('导航到', e.payload);
  // 这里可以切 tab / 路由
});

// ─── 启动 ───────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => router.start());

// ─── 全局事件处理器（供 HTML 内联 / STAR 面板使用）───

// 创建任务（由 create-task 表单调用）
(window as any).createTask = async () => {
  const title = (document.getElementById('task-title') as HTMLInputElement).value;
  const start = (document.getElementById('task-start') as HTMLInputElement).value;
  const end   = (document.getElementById('task-end')   as HTMLInputElement).value;
  const effort = Number((document.getElementById('task-effort') as HTMLInputElement).value || 100);
  await invoke('create_task', {
    input: { title, description: '', priority: 2, start_time: start, end_time: end, effort_percent: effort, category: 'personal' }
  });
  // 刷新当前视图
  router.navigate();
};

// STAR 面板：记录精力事件（Task 4 实现完整逻辑）
(window as any).addStarEvent = async (taskId: string, eventType: string, note: string) => {
  await invoke('record_star_event', { taskId, eventType, note });
  router.navigate();
};

// STAR 面板：恢复暂停的任务（Task 4 实现完整逻辑）
(window as any).resumeTask = async (taskId: string) => {
  await invoke('resume_task', { taskId });
  router.navigate();
};
