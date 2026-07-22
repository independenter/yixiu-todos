// src/main.ts — 前端入口（轻量 TS，可平滑迁移到 React/Vue）
//
// 本文件只做"骨架 + Tauri 命令调用示例"。
// 真正的 UI 建议用 React/Vue + Tailwind，本骨架保持框架无关。

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

// ─── 类型（与 Rust DTO 对齐）──────────────────────
interface Task {
  id: string;
  title: string;
  description: string;
  priority: number;
  start_time: string;
  end_time: string;
  effort_percent: number;
  status: 'pending' | 'active' | 'done' | 'postponed';
  category: string;
  created_at: string;
  updated_at: string;
}

interface WorkloadPoint {
  time: string;
  total_percent: number;
  level: 'ok' | 'warning' | 'error';
  task_ids: string[];
}

interface ConflictItem {
  task_a_id: string;
  task_b_id: string;
  overlap_minutes: number;
  severity: 'warning' | 'error';
  time_range: string;
}

// ─── 渲染函数（用原生 DOM 演示，方便你换框架）──
function el(tag: string, attrs: Record<string,string> = {}, children: (Node|string)[] = []): HTMLElement {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) (e as any)[k] = v;
  for (const c of children) e.append(typeof c === 'string' ? document.createTextNode(c) : c);
  return e;
}

function renderWorkload(points: WorkloadPoint[]) {
  const root = document.getElementById('workload')!;
  root.innerHTML = '';
  for (const p of points) {
    const color = p.level === 'error' ? '#ef4444' : p.level === 'warning' ? '#f59e0b' : '#22c55e';
    root.append(el('div', { className: 'row', style: `border-left:4px solid ${color};padding:6px 10px;margin:4px 0;background:#f8fafc` }, [
      el('strong', {}, [p.time]),
      el('span', { style: `margin-left:8px;color:${color}` }, [`${p.total_percent}%`]),
      el('small', { style: 'display:block;color:#64748b' }, [p.level]),
    ]));
  }
}

function renderConflicts(items: ConflictItem[]) {
  const root = document.getElementById('conflicts')!;
  root.innerHTML = '';
  if (items.length === 0) { root.append(el('p', {}, ['✅ 当前无时间冲突'])); return; }
  for (const c of items) {
    const color = c.severity === 'error' ? '#ef4444' : '#f59e0b';
    root.append(el('div', { className: 'row', style: `color:${color};padding:4px 0` }, [
      `${c.time_range}  ${c.task_a_id.slice(0,6)} ↔ ${c.task_b_id.slice(0,6)}  (${c.overlap_minutes}min)`,
    ]));
  }
}

// ─── 数据加载 ────────────────────────────────────────
async function loadAll() {
  try {
    const tasks = await invoke<Task[]>('list_tasks', { status: null, category: null, from: null, to: null });
    const workload = await invoke<WorkloadPoint[]>('get_workload_panel', { from: null, to: null });
    const conflicts = await invoke<ConflictItem[]>('get_conflict_report');

    // 渲染任务列表
    const list = document.getElementById('tasks')!;
    list.innerHTML = '';
    for (const t of tasks) {
      list.append(el('div', { className: 'task', style: 'padding:6px;border-bottom:1px solid #e2e8f0' }, [
        el('strong', {}, [t.title]),
        el('small', { style: 'display:block;color:#64748b' }, [
          `${t.start_time} → ${t.end_time}  | 占用 ${t.effort_percent}%  | 优先级 ${t.priority}`
        ]),
      ]));
    }

    renderWorkload(workload);
    renderConflicts(conflicts);
  } catch (e) {
    console.error('加载失败', e);
  }
}

// ─── 强制规则演示 ───────────────────────────────────
async function checkForce(appName: string) {
  const r = await invoke<any>('check_force_rule', { appName });
  if (r.required) {
    alert(`⚠️ ${r.message}\n请先录入关联任务后再使用 ${r.app_name}。`);
  }
}

// ─── 事件监听（导航/提醒）────────────────────────
listen<string>('navigate', (e) => {
  console.log('导航到', e.payload);
  // 这里可以切 tab / 路由
});

// ─── 启动 ───────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadAll();
  // 每 30 秒自动刷新面板
  setInterval(loadAll, 30_000);

  // 示例：检测用户是否打开了"微信"（演示强制规则）
  // 真实场景里由 Rust 端通过进程扫描触发
  // checkForce('wechat.exe');
});

// 暴露给 HTML 内联事件
(window as any).createTask = async () => {
  const title = (document.getElementById('task-title') as HTMLInputElement).value;
  const start = (document.getElementById('task-start') as HTMLInputElement).value;
  const end   = (document.getElementById('task-end')   as HTMLInputElement).value;
  const effort = Number((document.getElementById('task-effort') as HTMLInputElement).value || 100);
  await invoke('create_task', {
    input: { title, description: '', priority: 2, start_time: start, end_time: end, effort_percent: effort, category: 'personal' }
  });
  loadAll();
};
