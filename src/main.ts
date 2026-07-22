// src/main.ts — 前端入口，使用多视图路由
//
// 保留全局事件处理器供 HTML 内联交互及 STAR 面板使用。

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Router, Route } from './router';
import { renderPersonal } from './views/personal';
import { renderTeam } from './views/team';
import { renderTaskDetail } from './views/task-detail';
import { renderSettings } from './views/settings';

const router = new Router(async (container: HTMLElement, route: Route) => {
  switch (route.name) {
    case 'personal':
      await renderPersonal(container);
      break;
    case 'team':
      await renderTeam(container);
      break;
    case 'settings':
      await renderSettings(container);
      break;
    case 'task-detail':
      await renderTaskDetail(container, route.taskId);
      break;
    default:
      container.innerHTML = '<h2>404</h2><p>页面不存在</p>';
  }
});

// ─── 事件监听（导航/提醒）────────────────────────
(async () => {
  try {
    await listen<string>('navigate', (e) => {
      console.log('导航到', e.payload);
    });
  } catch (e) {
    console.log('非 Tauri 环境，跳过事件监听');
  }
})();

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

// ─── 强制规则管理 ───────────────────────────────
(window as any).addForceRule = async () => {
  const app = (document.getElementById('fr-app') as HTMLInputElement)?.value?.trim();
  const interval = Number((document.getElementById('fr-interval') as HTMLInputElement)?.value || 300);
  if (!app) return alert('请输入应用名称');
  try {
    await invoke('set_force_rule', { input: { appName: app, remindIntervalSec: interval } });
    location.reload();
  } catch (e) { alert(`添加失败: ${e}`); }
};

(window as any).deleteForceRule = async (appName: string) => {
  if (!confirm(`删除规则「${appName}」？`)) return;
  try {
    await invoke('clear_force_rule', { appName });
    location.reload();
  } catch (e) { alert(`删除失败: ${e}`); }
};

// ─── 数据库维护 ─────────────────────────────────
(window as any).vacuumDb = async (days?: number) => {
  try {
    await invoke('vacuum_db', { deleteDoneOlderThanDays: days || null });
    const el = document.getElementById('db-result');
    if (el) el.textContent = '✅ 数据库优化完成' + (days ? `（已删除${days}天前的已完成任务）` : '');
  } catch (e) { alert(`清理失败: ${e}`); }
};

(window as any).exportReport = async (format: string) => {
  const from = new Date(Date.now() - 30*86400000).toISOString().slice(0,10);
  const to = new Date().toISOString().slice(0,10);
  try {
    const data = await invoke<string>('export_time_report', { from, to, format });
    const blob = new Blob([data], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `tasks-export.${format}`; a.click();
    URL.revokeObjectURL(url);
    const el = document.getElementById('db-result');
    if (el) el.textContent = `✅ 已导出 ${format.toUpperCase()} 文件`;
  } catch (e) { alert(`导出失败: ${e}`); }
};

(window as any).testNotification = async () => {
  const title = (document.getElementById('rem-title') as HTMLInputElement)?.value || '测试';
  const body = (document.getElementById('rem-body') as HTMLInputElement)?.value || '测试通知';
  const urgency = (document.getElementById('rem-urgency') as HTMLSelectElement)?.value || 'normal';
  try {
    await invoke('send_notification', { title, body, urgency });
    alert('✅ 通知已发送（桌面端可见）');
  } catch (e) { alert(`发送失败: ${e}`); }
};

// ─── 团队面板：员工管理 ───────────────────────────

(window as any).toggleEl = (id: string) => {
  const el = document.getElementById(id);
  if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
};

(window as any).createEmployee = async () => {
  const name = (document.getElementById('emp-name') as HTMLInputElement)?.value?.trim();
  const role = (document.getElementById('emp-role') as HTMLInputElement)?.value?.trim();
  const email = (document.getElementById('emp-email') as HTMLInputElement)?.value?.trim();
  if (!name) return alert('请输入姓名');
  try {
    await invoke('create_employee', { input: { name, role, email } });
    location.reload();
  } catch (e) { alert(`创建失败: ${e}`); }
};

(window as any).assignTask = async (empId: string) => {
  const title = (document.getElementById(`at-${empId}-title`) as HTMLInputElement)?.value?.trim();
  const effort = Number((document.getElementById(`at-${empId}-effort`) as HTMLInputElement)?.value || 50);
  const start = (document.getElementById(`at-${empId}-start`) as HTMLInputElement)?.value;
  const end = (document.getElementById(`at-${empId}-end`) as HTMLInputElement)?.value;
  if (!title) return alert('请输入任务标题');
  if (!start || !end) return alert('请选择起止时间');
  try {
    await invoke('assign_task_to_employee', {
      input: { employeeId: empId, title, effortPercent: effort, startTime: new Date(start).toISOString(), endTime: new Date(end).toISOString() }
    });
    location.reload();
  } catch (e) { alert(`分配失败: ${e}`); }
};
