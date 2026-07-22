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
  container.innerHTML = '<h2>👥 团队面板</h2><div id="employees"></div>';

  try {
    const employees = await invoke<Employee[]>('list_employees');
    const empDiv = document.getElementById('employees')!;

    for (const emp of employees) {
      try {
        const wl = await invoke<EmpWorkload>('get_employee_workload', { employeeId: emp.id });
        empDiv.innerHTML += `<div style="background:#fff;border-radius:8px;padding:12px;margin:8px 0">
          <h3>${emp.name} <small style="color:#64748b">${emp.role}</small></h3>
          <p>精力占用: <strong>${wl.total_percent}%</strong> | 活跃: ${wl.active_tasks} | 平均进度: ${wl.avg_progress}%</p>
          ${wl.alerts.map(a => `<p style="color:#ef4444;font-size:14px">⚠️ ${a}</p>`).join('')}
        </div>`;
      } catch { /* skip failed load */ }
    }
  } catch (e) {
    container.innerHTML += `<p style="color:#ef4444">加载失败: ${e}</p>`;
  }
}
