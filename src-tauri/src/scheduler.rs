// scheduler.rs — 后台调度器
//
// 职责：
//  1. 每 30 秒扫描一次"即将开始"的任务 → 触发提醒
//  2. 每分钟重算精力占用 / 冲突（防止外部改库后状态不一致）
//  3. 管理已调度提醒的取消/重调度

use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Manager, State};
use tokio::sync::Mutex as AsyncMutex;
use crate::db::DbState;
use crate::task;
use crate::reminder;

/// 启动后台调度循环（在 setup 中 spawn）
pub async fn start(app: AppHandle) {
    let app = Arc::new(app);
    let tick = app.clone();

    // ─── 主循环：每 30 秒一次 ───────────────────────
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(30));
        interval.tick().await; // 跳过第一次立即触发
        loop {
            interval.tick().await;
            let _ = run_once(&tick).await;
        }
    });

    // ─── 启动时的"启动即检查" ───────────────────────
    let _ = run_once(&app).await;
}

/// 单次扫描：发现该提醒的任务 → 派发 reminder
async fn run_once(app: &Arc<AppHandle>) -> anyhow::Result<()> {
    let state: State<'_, DbState> = app.state();
    let now = chrono::Utc::now();

    // 1. 找"5 分钟内即将开始"的任务
    let soon = now + chrono::Duration::minutes(5);
    let upcoming = task::list_tasks_internal(
        &state,
        Some("pending".into()),
        None,
        Some(now.to_rfc3339()),
        Some(soon.to_rfc3339()),
    ).map_err(|e| anyhow::anyhow!(e))?;

    for t in upcoming {
        // 计算剩余秒数
        if let Ok(target) = chrono::DateTime::parse_from_rfc3339(&t.start_time) {
            let secs = (target.with_timezone(&chrono::Utc) - now).num_seconds();
            if secs > 0 && secs <= 300 {
                // 调度一次性提醒
                let _ = reminder::schedule_in(app, &t.id, secs as u64, &format!(
                    "即将开始：{}\n优先级 {}，占用 {}%", t.title, t.priority, t.effort_percent
                )).await;
            }
        }
    }

    // 2. 重算冲突（保持 workload 面板新鲜）
    let _ = crate::conflict::recompute_all(state.inner());

    Ok(())
}
