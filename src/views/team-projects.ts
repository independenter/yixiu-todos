// src/views/team-projects.ts — 项目概览卡片

import { invoke } from '@tauri-apps/api/core';

interface ProjectWithStats {
  id: string;
  name: string;
  description: string;
  priority: number;
  status: string;
  member_count: number;
  task_total: number;
  task_done: number;
  overload_count: number;
}

const PRIORITY_LABEL: Record<number, string> = {
  1: '🔥 紧急',
  2: '⚡ 高',
  3: '📋 中',
  4: '📎 低',
};

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export async function renderProjects(
  container: HTMLElement,
  selectedProjectId: string | null,
): Promise<void> {
  try {
    const projects = await invoke<ProjectWithStats[]>('list_projects');

    let html = '<h3>📁 项目概览</h3>';
    html += '<div style="display:flex;gap:10px;overflow-x:auto;padding-bottom:8px">';

    // 新建项目卡片
    html += `
      <div onclick="showNewProjectForm()" style="flex:0 0 180px;min-height:120px;border:2px dashed #cbd5e1;border-radius:10px;display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;background:#fafbfc;transition:all 0.15s"
           onmouseover="this.style.borderColor='#3b82f6';this.style.background='#eff6ff'"
           onmouseout="this.style.borderColor='#cbd5e1';this.style.background='#fafbfc'">
        <span style="font-size:24px;margin-bottom:4px">➕</span>
        <span style="font-size:13px;color:#64748b;font-weight:500">新建项目</span>
      </div>`;

    for (const p of projects) {
      const isSelected = p.id === selectedProjectId;
      const doneRatio = p.task_total > 0 ? Math.round((p.task_done / p.task_total) * 100) : 0;
      const priorityLabel = PRIORITY_LABEL[p.priority] || `P${p.priority}`;
      const borderColor = isSelected ? '3px solid #3b82f6' : '1px solid #eef2f6';
      const bgColor = isSelected ? '#eff6ff' : '#fff';

      html += `
        <div onclick="selectProject('${p.id}')" style="flex:0 0 220px;background:${bgColor};border-radius:10px;padding:14px 16px;border:${borderColor};cursor:pointer;transition:all 0.15s"
             onmouseover="this.style.boxShadow='0 2px 8px rgba(0,0,0,0.08)'"
             onmouseout="this.style.boxShadow='none'">
          <div style="font-size:15px;font-weight:600;margin-bottom:6px">${escHtml(p.name)}</div>
          <div style="font-size:12px;color:#64748b;margin-bottom:8px">
            ${p.member_count}人 · ${p.task_done}/${p.task_total}完成
          </div>
          <div class="bar-bg" style="height:6px;margin-bottom:8px">
            <div class="bar-fill" style="width:${doneRatio}%;background:${doneRatio === 100 ? '#22c55e' : '#3b82f6'};height:6px;border-radius:6px"></div>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center">
            <span style="font-size:12px;font-weight:500;padding:2px 8px;border-radius:4px;background:#f1f5f9;color:#475569">
              ${priorityLabel}
            </span>
            ${p.overload_count > 0 ? `<span style="font-size:12px;color:#ef4444">⚠️ ${p.overload_count}人超载</span>` : ''}
          </div>
        </div>`;
    }

    html += '</div>';

    // 新建项目表单（默认隐藏）
    html += `
      <div id="new-project-form" style="display:none;margin-top:8px">
        <div class="card" style="border:1px solid #3b82f6">
          <h3>📁 新建项目</h3>
          <div class="inline-form">
            <input id="np-name" placeholder="项目名称">
            <input id="np-desc" placeholder="描述（可选）">
            <select id="np-priority" style="padding:7px 8px;border:1px solid #e2e8f0;border-radius:6px;background:#fff">
              <option value="2">⚡ 高</option>
              <option value="3">📋 中</option>
              <option value="4">📎 低</option>
              <option value="1">🔥 紧急</option>
            </select>
            <button onclick="createProject()">创建</button>
            <button onclick="document.getElementById('new-project-form').style.display='none'" style="background:#e2e8f0;color:#64748b">取消</button>
          </div>
        </div>
      </div>`;

    container.innerHTML = html;
  } catch (e) {
    container.innerHTML = `<div class="card"><h3>⚠️ 加载失败</h3><p style="font-size:14px;color:#ef4444">${e}</p></div>`;
  }
}
