// reminder.rs — 桌面通知 + 定时提醒
//
// 依赖：notify-rust（Linux/macOS/Windows 桌面通知）
// Tauri 端命令供前端调用

use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Manager, State};
use tokio::time::sleep;
use crate::AppState;

/// 立即发送一条桌面通知
#[tauri::command]
pub async fn send_notification(
    _app: AppHandle,
    title: String,
    body: String,
    urgency: Option<String>, // "low" | "normal" | "critical"
) -> Result<String, String> {
    // 优先用 notify-rust 直接弹系统通知
    use notify_rust::Notification;
    let mut n = Notification::new();
    n.summary(&title).body(&body);

    // urgency 仅 Linux D-Bus 支持，macOS/Windows 静默忽略
    #[cfg(target_os = "linux")]
    match urgency.as_deref() {
        Some("critical") => { let _ = n.urgency(notify_rust::Urgency::Critical); }
        Some("low")      => { let _ = n.urgency(notify_rust::Urgency::Low); }
        _                  => { let _ = n.urgency(notify_rust::Urgency::Normal); }
    }
    #[cfg(not(target_os = "linux"))]
    let _ = urgency;

    match n.show() {
        Ok(_) => {
            log::info!("通知已发送：{}", title);
            Ok("sent".into())
        }
        Err(e) => {
            log::warn!("notify-rust 失败：{}", e);
            Ok("failed".into())
        }
    }
}

/// 在指定秒数后发送提醒（异步，不阻塞调用方）
#[tauri::command]
pub async fn schedule_reminder(
    app: AppHandle,
    task_id: String,
    title: String,
    body: String,
    delay_seconds: u64,
) -> Result<String, String> {
    let app_state: State<'_, AppState> = app.state();
    let mut map = app_state.reminders.lock().await;

    // 如果已存在该任务的提醒，先取消
    if let Some(handle) = map.remove(&task_id) {
        handle.abort();
    }

    let tid_clone = task_id.clone();
    // 克隆用于异步任务
    let task = tokio::spawn(async move {
        sleep(Duration::from_secs(delay_seconds)).await;
        let _ = send_notification_impl(&task_id, &title, &body, "normal").await;
    });

    map.insert(tid_clone, task.abort_handle());
    Ok(format!("scheduled:{delay_seconds}s"))
}

/// 取消已调度的提醒
#[tauri::command]
pub async fn cancel_reminder(
    app: AppHandle,
    task_id: String,
) -> Result<(), String> {
    let app_state: State<'_, AppState> = app.state();
    let mut map = app_state.reminders.lock().await;
    if let Some(handle) = map.remove(&task_id) {
        handle.abort();
    }
    Ok(())
}

/// 内部：不依赖 Tauri State 的纯发送
async fn send_notification_impl(
    _task_id: &str,
    title: &str,
    body: &str,
    urgency: &str,
) -> Result<(), String> {
    use notify_rust::Notification;
    let mut n = Notification::new();
    n.summary(title).body(body);
    #[cfg(target_os = "linux")]
    match urgency {
        "critical" => { let _ = n.urgency(notify_rust::Urgency::Critical); }
        "low"      => { let _ = n.urgency(notify_rust::Urgency::Low); }
        _            => { let _ = n.urgency(notify_rust::Urgency::Normal); }
    }
    #[cfg(not(target_os = "linux"))]
    let _ = urgency;

    n.show().map_err(|e| e.to_string())?;
    Ok(())
}

/// 启动一个一次性提醒（scheduler 内部用）
pub async fn schedule_in(
    _app: &Arc<AppHandle>,
    task_id: &str,
    seconds: u64,
    body: &str,
) {
    let task_id = task_id.to_string();
    let body = body.to_string();
    let title = "⏰ 一修Todo 提醒".to_string();
    tokio::spawn(async move {
        sleep(Duration::from_secs(seconds)).await;
        let _ = send_notification_impl(&task_id, &title, &body, "normal").await;
    });
}
