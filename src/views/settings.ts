import { invoke } from '@tauri-apps/api/core';

interface ForceRule {
  id: number;
  app_name: string;
  enabled: boolean;
  remind_interval_sec: number;
  created_at: string;
}

export async function renderSettings(container: HTMLElement): Promise<void> {
  container.innerHTML = '<h2 style="font-size:20px;font-weight:700;margin-bottom:16px">⚙️ 设置</h2><div id="force-rules" class="card"></div>';

  try {
    const rules = await invoke<ForceRule[]>('list_force_rules');
    const div = document.getElementById('force-rules')!;

    // Add rule form
    div.innerHTML = `
      <h3>📋 强制录入规则</h3>
      <p style="font-size:13px;color:#64748b;margin-bottom:10px">设置哪些应用启动前必须先录入任务</p>
      <div class="inline-form" style="margin-bottom:12px">
        <input id="fr-app" placeholder="应用名称 (如 wechat)" style="flex:1">
        <input id="fr-interval" type="number" placeholder="提醒间隔(秒)" value="300" style="width:130px">
        <button onclick="addForceRule()">➕ 添加</button>
      </div>
      <div id="fr-list"></div>`;

    // Rules list
    const list = document.getElementById('fr-list')!;
    if (rules.length === 0) {
      list.innerHTML = '<p style="color:#94a3b8;padding:8px 0">暂无规则</p>';
    } else {
      list.innerHTML = rules.map(r => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;background:#f8fafc;border-radius:6px;margin:4px 0">
          <span><strong>${r.app_name}</strong> <span style="color:#94a3b8;font-size:13px">每 ${r.remind_interval_sec}s</span></span>
          <button onclick="deleteForceRule('${r.app_name}')" style="padding:4px 10px;background:#fee2e2;color:#dc2626;border:none;border-radius:4px;cursor:pointer">删除</button>
        </div>
      `).join('');
    }

    // 🗄️ 数据库维护
    container.innerHTML += `
      <div id="db-maintenance" class="card" style="margin-top:16px">
        <h3>🗄️ 数据库维护</h3>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
          <button onclick="vacuumDb()" style="padding:8px 16px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;cursor:pointer">🧹 清理并优化</button>
          <button onclick="vacuumDb(7)" style="padding:8px 16px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;cursor:pointer">🗑️ 删除7天前已完成任务</button>
          <button onclick="exportReport('json')" style="padding:8px 16px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;cursor:pointer">📤 导出 JSON</button>
          <button onclick="exportReport('csv')" style="padding:8px 16px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;cursor:pointer">📤 导出 CSV</button>
        </div>
        <div id="db-result" style="margin-top:8px;font-size:13px;color:#64748b"></div>
      </div>`;

    // 🔔 提醒测试
    container.innerHTML += `
      <div id="reminder-test" class="card" style="margin-top:16px">
        <h3>🔔 提醒测试</h3>
        <div class="inline-form" style="margin-top:8px">
          <input id="rem-title" placeholder="提醒标题" value="一修Todo 测试" style="flex:1">
          <input id="rem-body" placeholder="提醒内容" value="这是一条测试通知" style="flex:2">
          <select id="rem-urgency" style="width:100px">
            <option value="normal">普通</option>
            <option value="low">低</option>
            <option value="critical">紧急</option>
          </select>
          <button onclick="testNotification()">发送</button>
        </div>
      </div>`;
  } catch (e) {
    container.innerHTML += `<div class="card" style="color:#ef4444">加载失败: ${e}</div>`;
  }
}
