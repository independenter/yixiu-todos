// src/views/star-panel.ts — STAR 任务定义面板

import { invoke } from '@tauri-apps/api/core';

interface StarEvent {
  id: string; task_id: string; star_section: string;
  content: string; event_type: string; created_at: string;
}

interface PauseStats {
  task_id: string; pause_count: number; total_pause_seconds: number;
  is_paused_now: boolean; current_pause_reason: string | null;
  current_pause_since: string | null;
}

const SECTION_LABELS: Record<string, { en: string; zh: string; question: string }> = {
  S: { en: 'Situation', zh: '背景', question: '当时是什么场景？约束是什么？' },
  T: { en: 'Task', zh: '任务', question: '你被要求做什么？目标是什么？' },
  A: { en: 'Action', zh: '行动', question: '你具体做了什么？（不是"我们"）' },
  R: { en: 'Result', zh: '结果', question: '产生了什么可衡量的结果？' },
};

const EVENT_ICONS: Record<string, string> = {
  note: '○', blocker: '🔴', pause: '⏸️', resume: '▶️',
};

export async function renderStarPanel(container: HTMLElement, taskId: string, _taskStatus: string): Promise<void> {
  container.innerHTML = '<h3 style="margin-bottom:12px">📋 STAR 任务定义</h3>';

  // Load all events and stats
  const [events, stats] = await Promise.all([
    invoke<StarEvent[]>('get_star_events', { taskId }),
    invoke<PauseStats>('get_task_pause_stats', { taskId }),
  ]);

  // Group by section
  const grouped: Record<string, StarEvent[]> = { S: [], T: [], A: [], R: [] };
  for (const e of events) {
    if (grouped[e.star_section]) grouped[e.star_section].push(e);
  }

  // Pause status bar (if paused now)
  if (stats.is_paused_now) {
    container.innerHTML += `
      <div style="background:#fef3c7;border:1px solid #f59e0b;border-radius:6px;padding:8px 12px;margin-bottom:12px">
        ⏸️ 已暂停 — ${stats.current_pause_reason || '无原因'}
        <button onclick="resumeTask('${taskId}')" style="margin-left:8px;padding:4px 12px;background:#3b82f6;color:#fff;border:none;border-radius:4px;cursor:pointer">恢复</button>
      </div>`;
  }

  // Render each STAR section
  for (const section of ['S', 'T', 'A', 'R'] as const) {
    const label = SECTION_LABELS[section];
    const sectionEvents = grouped[section] || [];
    const sectionHtml = `
      <div style="background:#fff;border-radius:8px;margin-bottom:8px;overflow:hidden">
        <div onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display==='none'?'block':'none'"
             style="padding:10px 14px;cursor:pointer;display:flex;justify-content:space-between;border-bottom:1px solid #f1f5f9">
          <strong>[${section}] ${label.zh}</strong>
          <span style="color:#64748b;font-size:13px">${label.question}</span>
        </div>
        <div style="padding:8px 14px">
          ${sectionEvents.length === 0 ? '<p style="color:#94a3b8;font-size:13px">暂无记录</p>' : ''}
          ${sectionEvents.map(e => `
            <div style="display:flex;align-items:baseline;padding:4px 0;border-left:2px solid ${e.event_type === 'blocker' ? '#ef4444' : '#e2e8f0'};padding-left:10px;margin:4px 0">
              <span style="margin-right:6px">${EVENT_ICONS[e.event_type] || '○'}</span>
              <span style="flex:1">${e.content}</span>
              <small style="color:#94a3b8;font-size:12px">${e.created_at.slice(11, 19)}</small>
            </div>
          `).join('')}
          <div style="margin-top:6px;display:flex;gap:4px">
            <input id="star-input-${section}" placeholder="添加${label.zh}事件..." style="flex:1;padding:6px 8px;border:1px solid #e2e8f0;border-radius:4px;font-size:13px">
            <select id="star-type-${section}" style="padding:6px;border:1px solid #e2e8f0;border-radius:4px;font-size:13px">
              <option value="note">普通</option>
              <option value="blocker">🔴 阻碍</option>
              <option value="pause" ${section !== 'A' ? 'disabled' : ''}>⏸️ 暂停</option>
            </select>
            <button onclick="addStarEvent('${taskId}','${section}')" style="padding:6px 12px;background:#3b82f6;color:#fff;border:none;border-radius:4px;cursor:pointer">+</button>
          </div>
        </div>
      </div>`;
    container.innerHTML += sectionHtml;
  }

  // Pause statistics
  if (stats.pause_count > 0) {
    const hrs = Math.floor(stats.total_pause_seconds / 3600);
    const mins = Math.floor((stats.total_pause_seconds % 3600) / 60);
    container.innerHTML += `
      <div style="font-size:13px;color:#64748b;text-align:right;padding:8px">
        暂停 ${stats.pause_count} 次，共 ${hrs}h${mins}min
      </div>`;
  }
}
