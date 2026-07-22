// src/views/team-workload.ts — 个人精力占用概览

import { invoke } from '@tauri-apps/api/core';

interface Employee {
  id: string;
  name: string;
  role: string;
  email: string;
  status: string;
}

interface EmpWorkload {
  employee_id: string;
  name: string;
  total_percent: number;
  active_tasks: number;
  avg_progress: number;
  alerts: string[];
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** 根据精力百分比返回颜色 */
function workloadColor(pct: number): string {
  if (pct >= 100) return '#ef4444';   // 过载 - 红色
  if (pct >= 80) return '#f59e0b';    // 接近上限 - 黄色
  return '#22c55e';                    // 正常 - 绿色
}

export async function renderWorkload(container: HTMLElement): Promise<void> {
  try {
    const employees = await invoke<Employee[]>('list_employees');

    if (employees.length === 0) {
      container.innerHTML = `
        <h3>⚡ 个人精力占用</h3>
        <p style="color:#94a3b8;font-size:14px;padding:12px 0">暂无员工，请在底部添加</p>`;
      return;
    }

    let html = '<h3>⚡ 个人精力占用</h3>';

    for (const emp of employees) {
      try {
        const wl = await invoke<EmpWorkload>('get_employee_workload', { employeeId: emp.id });
        const color = workloadColor(wl.total_percent);
        const barWidth = Math.min(wl.total_percent, 150); // 最大显示 150%
        const statusIcon = wl.total_percent >= 100 ? '⚠️' : wl.total_percent >= 80 ? '⚡' : '✅';
        const progressColor = wl.avg_progress > 80 ? '#22c55e' : wl.avg_progress > 50 ? '#f59e0b' : '#ef4444';

        html += `
          <div class="card" style="margin-bottom:8px">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
              <div>
                <span style="font-weight:600;font-size:14px">${escHtml(wl.name)}</span>
                ${emp.role ? `<span style="color:#94a3b8;font-size:12px;margin-left:6px">${escHtml(emp.role)}</span>` : ''}
              </div>
              <div style="display:flex;align-items:center;gap:8px">
                <span style="font-size:12px;color:#64748b">${wl.active_tasks} 项任务</span>
                <span style="font-size:13px;font-weight:700;color:${color}">
                  ${statusIcon} ${wl.total_percent}%
                </span>
              </div>
            </div>
            <div class="bar-bg" style="height:16px;margin-bottom:4px">
              <div class="bar-fill" style="width:${barWidth}%;background:${color};height:16px;border-radius:6px"></div>
            </div>
            <div style="display:flex;justify-content:space-between;font-size:11px;color:#94a3b8;margin-bottom:4px">
              <span>进度</span>
              <span style="color:${progressColor};font-weight:600">${wl.avg_progress}%</span>
            </div>
            <div class="bar-bg" style="height:6px">
              <div class="bar-fill" style="width:${wl.avg_progress}%;background:${progressColor};height:6px;border-radius:6px"></div>
            </div>
            ${wl.alerts.length > 0 ? `
              <div style="margin-top:6px;font-size:12px">
                ${wl.alerts.map(a => `<div style="color:#ef4444;padding:2px 0">⚠️ ${escHtml(a)}</div>`).join('')}
              </div>
            ` : ''}
          </div>`;
      } catch {
        // 单个员工加载失败则跳过
        html += `
          <div class="card" style="color:#94a3b8">
            <span style="font-weight:600;font-size:14px">${escHtml(emp.name)}</span>
            <span style="font-size:12px;margin-left:8px">数据加载失败</span>
          </div>`;
      }
    }

    container.innerHTML = html;
  } catch (e) {
    container.innerHTML = `<div class="card"><h3>⚠️ 加载失败</h3><p style="font-size:14px;color:#ef4444">${e}</p></div>`;
  }
}
