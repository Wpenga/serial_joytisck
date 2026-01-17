use tauri::{menu::{Menu, MenuItem, PredefinedMenuItem}, tray::TrayIconBuilder, Manager, Runtime};

// 托盘文本配置
struct TrayTexts {
    show_window: String,
    quit: String,
}

impl Default for TrayTexts {
    fn default() -> Self {
        TrayTexts {
            show_window: "显示主窗口".to_string(),
            quit: "退出应用 (Exit)".to_string(),
        }
    }
}

pub fn create_tray<R: Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<()> {
    // 获取托盘文本（目前固定为中文）
    let texts = TrayTexts::default();

    // 定义菜单项
    let show_window = MenuItem::with_id(app, "show_window", &texts.show_window, true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", &texts.quit, true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;

    // 构建菜单
    let menu = Menu::with_items(app, &[
        &show_window,
        &separator,
        &quit,
    ])?;

    // 构建托盘图标
    let _ = TrayIconBuilder::with_id("main")
        .menu(&menu)
        .icon(app.default_window_icon().unwrap().clone())
        .on_menu_event(|app: &tauri::AppHandle<R>, event: tauri::menu::MenuEvent| match event.id().as_ref() {
            "show_window" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            // 只处理左键点击事件，保留右键菜单的默认行为
            if let tauri::tray::TrayIconEvent::Click { button, .. } = event {
                if let tauri::tray::MouseButton::Left = button {
                    if let Some(window) = tray.app_handle().get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
            }
        })
        .build(app)?;

    Ok(())
}