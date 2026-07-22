// yixiu-todos — Tauri 2 后端入口
// 功能：个人待办、精力占用面板、时间冲突告警、员工任务管理、强制录入规则、定时提醒

#![cfg_attr(mobile, tauri::mobile_entry_point)]

// ─── 模块声明 ───────────────────────────────────────────────
mod db;
mod task;
mod conflict;
mod scheduler;
mod reminder;
mod tray;
mod employee;
mod rules;
mod task_star;
mod error;

// ─── 用到的类型 ─────────────────────────────────────────────
use std::sync::Arc;
use tokio::sync::Mutex as AsyncMutex;
use parking_lot::Mutex as PlMutex;

use tauri::Manager;

// ─── 启动 ─────────────────────────────────────────────────
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 初始化日志
    env_logger::init_from_env(env_logger::Env::default().default_filter_or("info"));

    tauri::Builder::default()
        // 1. 数据库状态（同步 Mutex，rusqlite 是同步 API）
        .setup(|app| {
            let handle = app.handle().clone();
            tauri::async_runtime::block_on(async move {
                let db_state = db::init_db(&handle).expect("数据库初始化失败");
                handle.manage(db_state);
                log::info!("数据库初始化完成");
            });

            // 构建系统托盘
            let _ = tray::build_tray(app.handle());

            // 启动后台调度器（定时扫描 + 提醒）
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                scheduler::start(handle).await;
            });

            Ok(())
        })

        // 2. 注册所有命令
        .invoke_handler(tauri::generate_handler![
            // 任务 CRUD
            task::create_task,
            task::list_tasks,
            task::update_task,
            task::delete_task,
            task::complete_task,
            task::postpone_task,

            // 精力占用
            task::get_workload_panel,
            task::get_conflict_report,

            // 员工管理
            employee::create_employee,
            employee::list_employees,
            employee::assign_task_to_employee,
            employee::get_employee_workload,
            employee::update_employee_progress,

            // 规则
            rules::check_force_rule,
            rules::set_force_rule,
            rules::clear_force_rule,
            rules::list_force_rules,
            rules::record_force_response,

            // 提醒
            reminder::send_notification,
            reminder::schedule_reminder,
            reminder::cancel_reminder,

            // STAR 任务事件
            task_star::add_star_event,
            task_star::get_star_events,
            task_star::update_star_event,
            task_star::delete_star_event,
            task_star::pause_task,
            task_star::resume_task,
            task_star::get_task_pause_stats,

            // 数据库维护
            task::vacuum_db,
            task::export_time_report,
        ])

        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

// ─── 应用状态总结构 ───────────────────────────────────────
// 放在 lib.rs 方便全局访问
pub struct AppState {
    /// 已调度的提醒任务集合（task_id -> 取消句柄）
    pub reminders: Arc<AsyncMutex<std::collections::HashMap<String, tokio::task::AbortHandle>>>,
    /// 强制录入规则缓存
    pub force_rules: Arc<PlMutex<Vec<rules::ForceRule>>>,
}
