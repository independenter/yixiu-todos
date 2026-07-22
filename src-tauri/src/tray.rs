// tray.rs — 系统托盘图标 + 菜单
//
// 托盘提供：
//   • 左/右键菜单：显示主窗口、快速查看今日待办、退出
//   • 点击图标：切换主窗口显隐
//   • Tooltip 显示当前精力占用状态

use tauri::{
    AppHandle, Emitter, Manager,
    menu::{Menu, MenuItem},
    tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
};

/// 构建托盘图标（在 setup 或 lib.rs 调用）
pub fn build_tray(app: &AppHandle) -> anyhow::Result<()> {
    let show_id = "show_main";
    let today_id = "show_today";
    let quit_id  = "quit";

    let show_item  = MenuItem::with_id(app, show_id,  "显示主窗口", true, None::<&str>)?;
    let today_item = MenuItem::with_id(app, today_id,  "查看今日待办", true, None::<&str>)?;
    let quit_item  = MenuItem::with_id(app, quit_id,  "退出", true, None::<&str>)?;

    let menu = Menu::with_items(app, &[&show_item, &today_item, &quit_item])?;

    TrayIconBuilder::new()
        .menu(&menu)
        .show_menu_on_left_click(true)
        .tooltip("一修Todo — 点击查看待办")
        .on_menu_event(move |app, event| {
            match event.id.as_ref() {
                id if id == show_id => {
                    if let Some(w) = app.get_webview_window("main") {
                        let _ = w.show();
                        let _ = w.set_focus();
                    }
                }
                id if id == today_id => {
                    // 给前端发事件，让它切到"今日"视图
                    if let Some(w) = app.get_webview_window("main") {
                        let _ = w.show();
                        let _ = w.emit("navigate", "today");
                    }
                }
                id if id == quit_id => {
                    app.exit(0);
                }
                _ => {}
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, .. } = event {
                // 左键：切换主窗口
                if let Some(w) = tray.app_handle().get_webview_window("main") {
                    let visible = w.is_visible().unwrap_or(false);
                    if visible { let _ = w.hide(); } else { let _ = w.show(); let _ = w.set_focus(); }
                }
            }
        })
        .build(app)?;

    Ok(())
}

/// 更新托盘 tooltip（调度器/冲突检测可调用）
pub fn set_tooltip(app: &AppHandle, text: &str) {
    if let Some(tray) = app.tray_by_id("main-tray") {
        let _ = tray.set_tooltip(Some(text));
    }
}
