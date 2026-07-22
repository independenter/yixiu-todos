// src/views/team.ts — 团队面板视图（布局外壳）

import { invoke } from '@tauri-apps/api/core';
import { renderProjects } from './team-projects';
import { renderProjectTasks } from './team-tasks';
import { renderWorkload } from './team-workload';

// ─── 模块级状态 ───────────────────────────────
let selectedProjectId: string | null = null;
let currentContainer: HTMLElement | null = null;
let teamRange = 'all'; // '3day' | 'week' | 'month' | 'quarter' | 'all'

// ─── 导出供 main.ts 访问 ──────────────────────
export function setSelectedProjectId(id: string | null): void {
  selectedProjectId = id;
}
export function getSelectedProjectId(): string | null {
  return selectedProjectId;
}
export function getCurrentContainer(): HTMLElement | null {
  return currentContainer;
}
export function getTeamRange(): string {
  return teamRange;
}
export function setTeamRange(r: string): void {
  teamRange = r;
}

// ─── 时间范围工具 ─────────────────────────────
const RANGE_LABELS: Record<string, string> = {
  '3day': '近3天',
  'week': '本周',
  'month': '本月',
  'quarter': '本季度',
  'all': '全部',
};

function rangeBtnHtml(current: string): string {
  const keys = ['3day', 'week', 'month', 'quarter', 'all'];
  return keys.map(k => {
    const active = k === current;
    return `<button onclick="setTeamRangeHandler('${k}')" style="padding:4px 10px;border:none;border-radius:5px;cursor:pointer;font-size:12px;font-weight:500;${active ? 'background:#3b82f6;color:#fff' : 'background:#f1f5f9;color:#64748b'}">${RANGE_LABELS[k]}</button>`;
  }).join('');
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ─── 员工管理（容纳在底部 <details> 内） ───────
async function renderEmployeeSection(container: HTMLElement): Promise<void> {
  try {
    const employees = await invoke<any[]>('list_employees');
    let html = '<h3 style="font-size:15px;font-weight:600;margin-bottom:10px">👤 员工管理</h3>';

    // 添加员工按钮 + 表单
    html += `
      <button onclick="toggleEl('add-emp-section')" style="background:none;border:1px solid #e2e8f0;border-radius:8px;padding:8px 14px;cursor:pointer;font-size:13px;margin-bottom:10px;color:#475569;width:100%;text-align:center">➕ 添加员工</button>
      <div id="add-emp-section" style="display:none" class="card">
        <div class="inline-form">
          <input id="emp-name" placeholder="姓名">
          <input id="emp-role" placeholder="角色">
          <input id="emp-email" placeholder="邮箱">
          <button onclick="createEmployee()">保存</button>
        </div>
      </div>`;

    if (employees.length === 0) {
      html += '<p style="color:#94a3b8;font-size:13px;padding:8px 0">暂无员工，请先添加</p>';
    } else {
      for (const emp of employees) {
        html += `
          <div class="card" style="margin-bottom:6px;padding:12px 16px">
            <div style="display:flex;justify-content:space-between;align-items:center">
              <div>
                <span style="font-weight:600;font-size:14px">${escHtml(emp.name)}</span>
                ${emp.role ? `<span style="color:#94a3b8;font-size:12px;margin-left:6px">${escHtml(emp.role)}</span>` : ''}
              </div>
              <span style="font-size:12px;color:#64748b">${emp.email || ''}</span>
            </div>
          </div>`;
      }
    }

    container.innerHTML = html;
  } catch (e) {
    container.innerHTML = `<p style="color:#ef4444;font-size:13px">⚠️ 加载失败: ${e}</p>`;
  }
}

// ─── 主渲染入口 ───────────────────────────────
export async function renderTeam(container: HTMLElement): Promise<void> {
  currentContainer = container;

  // 布局骨架
  container.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:16px">
      <h2 style="font-size:20px;font-weight:700;margin:0">👥 团队面板</h2>
      <div style="display:flex;gap:4px">
        ${rangeBtnHtml(teamRange)}
      </div>
    </div>

    <div id="team-projects" class="card"></div>

    <div id="team-project-detail" style="display:none" class="card"></div>

    <div id="team-workload" class="card"></div>

    <details style="margin-top:8px">
      <summary style="cursor:pointer;padding:8px 0;font-size:14px;font-weight:600;color:#64748b;user-select:none">
        👤 员工管理
      </summary>
      <div id="team-employees"></div>
    </details>`;

  // 并行加载各区
  try {
    await Promise.all([
      renderProjects(document.getElementById('team-projects')!, selectedProjectId),
      renderWorkload(document.getElementById('team-workload')!),
      renderEmployeeSection(document.getElementById('team-employees')!),
    ]);

    // 如果有选中的项目，渲染详情
    if (selectedProjectId) {
      const detailEl = document.getElementById('team-project-detail')!;
      detailEl.style.display = '';
      detailEl.dataset.projectId = selectedProjectId;
      await renderProjectTasks(detailEl, selectedProjectId);
    }
  } catch (e) {
    console.error('团队面板渲染失败', e);
  }
}
