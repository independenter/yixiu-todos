// src/views/team.ts — 团队面板视图

import { invoke } from '@tauri-apps/api/core';

interface Employee {
  id: string; name: string; role: string; status: string;
}

interface EmpWorkload {
  employee_id: string; name: string; total_percent: number;
  active_tasks: number; avg_progress: number; alerts: string[];
}

export async function renderTeam(container: HTMLElement): Promise<void> {
  container.innerHTML = `
    <h2 style="font-size:20px;font-weight:700;margin-bottom:16px">👥 团队面板</h2>
    <button onclick="toggleEl('add-emp')" style="background:none;border:1px solid #e2e8f0;border-radius:8px;padding:10px 16px;cursor:pointer;font-size:14px;margin-bottom:12px;width:100%;text-align:center;color:#334155">➕ 添加员工</button>
    <div id="add-emp" style="display:none" class="card">
      <div class="inline-form">
        <input id="emp-name" placeholder="姓名">
        <input id="emp-role" placeholder="角色">
        <input id="emp-email" placeholder="邮箱">
        <button onclick="createEmployee()">保存</button>
      </div>
    </div>
    <div id="employees"></div>`;

  try {
    const employees = await invoke<Employee[]>('list_employees');
    const empDiv = document.getElementById('employees')!;

    if (employees.length === 0) {
      empDiv.innerHTML = '<div class="card"><p style="color:#94a3b8;padding:12px 0">暂无员工，请先添加</p></div>';
      return;
    }

    for (const emp of employees) {
      try {
        const wl = await invoke<EmpWorkload>('get_employee_workload', { employeeId: emp.id });
        const progressColor = wl.avg_progress > 80 ? '#22c55e' : wl.avg_progress > 50 ? '#f59e0b' : '#ef4444';
        empDiv.innerHTML += `
          <div class="card">
            <div style="display:flex;justify-content:space-between;align-items:center">
              <h3 style="font-size:15px;font-weight:600">${emp.name} <small style="color:#94a3b8;font-weight:400">${emp.role || ''}</small></h3>
              <span style="font-size:13px;color:${wl.total_percent > 100 ? '#ef4444' : '#64748b'}">⚡ ${wl.total_percent}%</span>
            </div>
            <div style="display:flex;gap:16px;margin-top:8px;font-size:13px;color:#64748b">
              <span>活跃: <strong>${wl.active_tasks}</strong></span>
              <span>进度: <strong style="color:${progressColor}">${wl.avg_progress}%</strong></span>
            </div>
            <div class="bar-bg" style="margin-top:8px">
              <div class="bar-fill" style="width:${wl.avg_progress}%;background:${progressColor}"></div>
            </div>
            ${wl.alerts.length > 0 ? `
              <div style="margin-top:8px;font-size:13px">
                ${wl.alerts.map(a => `<div style="color:#ef4444;padding:2px 0">⚠️ ${a}</div>`).join('')}
              </div>
            ` : ''}
            <button onclick="toggleEl('assign-${emp.id}')" style="background:none;border:1px solid #e2e8f0;border-radius:6px;padding:8px 12px;cursor:pointer;font-size:13px;margin-top:10px;color:#475569">📋 分配任务</button>
            <div id="assign-${emp.id}" style="display:none;margin-top:8px">
              <div class="inline-form">
                <input id="at-${emp.id}-title" placeholder="任务标题" style="flex:1">
                <input id="at-${emp.id}-effort" type="number" placeholder="精力%" value="50" style="width:70px">
                <input id="at-${emp.id}-start" type="datetime-local" style="width:160px">
                <input id="at-${emp.id}-end" type="datetime-local" style="width:160px">
                <button onclick="assignTask('${emp.id}')">分配</button>
              </div>
            </div>
          </div>`;
      } catch { /* skip failed load */ }
    }
  } catch (e) {
    container.innerHTML += `<div class="card" style="color:#ef4444"><h3>⚠️ 加载失败</h3><p style="font-size:14px">${e}</p></div>`;
  }
}
