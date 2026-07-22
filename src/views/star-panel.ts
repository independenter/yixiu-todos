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
  note: '○', research: '🔍', design: '🎨', coding: '💻',
  test: '🧪', review: '👀', doc: '📄', meeting: '🤝',
  blocker: '🔴', change: '🔄', decision: '✅',
  pause: '⏸️', resume: '▶️',
};

export async function renderStarPanel(container: HTMLElement, taskId: string, _taskStatus: string): Promise<void> {
  container.innerHTML = '<h3 style="font-size:15px;font-weight:600;margin-bottom:12px;color:#334155">📋 STAR 任务定义</h3>';

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
      <div style="background:#fef3c7;border:1px solid #f59e0b;border-radius:8px;padding:10px 14px;margin-bottom:12px;font-size:14px">
        ⏸️ 已暂停 — ${stats.current_pause_reason || '无原因'}
        <button class="btn-resume" onclick="resumeTask('${taskId}')">恢复</button>
      </div>`;
  }

  // Render each STAR section
  for (const section of ['S', 'T', 'A', 'R'] as const) {
    const label = SECTION_LABELS[section];
    const sectionEvents = grouped[section] || [];
    const isFirst = section === 'S';

    const bodyDisplay = isFirst ? 'block' : 'none';
    container.innerHTML += `
      <div class="star-section">
        <div class="star-header" onclick="
          const body = this.nextElementSibling;
          body.style.display = body.style.display === 'none' ? 'block' : 'none';
        ">
          <strong>[${section}] ${label.zh}</strong>
          <span style="color:#94a3b8;font-size:12px">${label.question}</span>
        </div>
        <div class="star-body" style="display:${bodyDisplay}">
          ${sectionEvents.length === 0 ? '<p style="color:#94a3b8;font-size:13px;padding:6px 0">暂无记录</p>' : ''}
          ${sectionEvents.map(e => `
            <div class="star-event" style="border-left-color:${e.event_type === 'blocker' ? '#ef4444' : '#e2e8f0'}">
              <span style="margin-right:6px">${EVENT_ICONS[e.event_type] || '○'}</span>
              <span style="flex:1">${e.content}</span>
              <span class="time">${e.created_at.slice(11, 19)}</span>
            </div>
          `).join('')}
          <div class="inline-form">
            <input id="star-input-${section}" placeholder="添加${label.zh}事件...">
            <select id="star-type-${section}">
              <option value="note">📝 普通</option>
              <option value="research">🔍 调研</option>
              <option value="design">🎨 设计</option>
              <option value="coding">💻 编码</option>
              <option value="test">🧪 测试</option>
              <option value="review">👀 审查</option>
              <option value="doc">📄 文档</option>
              <option value="meeting">🤝 会议</option>
              <option value="blocker">🔴 阻塞</option>
              <option value="change">🔄 变更</option>
              <option value="decision">✅ 决策</option>
              <option value="pause" ${section !== 'A' ? 'disabled' : ''}>⏸️ 暂停</option>
            </select>
            <button onclick="addStarEvent('${taskId}','${section}')">+</button>
          </div>
        </div>
      </div>`;
  }

  // Pause statistics
  if (stats.pause_count > 0) {
    const hrs = Math.floor(stats.total_pause_seconds / 3600);
    const mins = Math.floor((stats.total_pause_seconds % 3600) / 60);
    container.innerHTML += `
      <div style="font-size:13px;color:#94a3b8;text-align:right;padding:8px 4px">
        ⏸️ 暂停 ${stats.pause_count} 次，共 ${hrs}h${mins}min
      </div>`;
  }
}
