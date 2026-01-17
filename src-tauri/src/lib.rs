mod config;
mod serial;
mod matrix;
mod tray;

use tauri::Manager;
use tokio::sync::Mutex;
use crate::config::{MatrixConfig, SerialConfig};
use crate::matrix::{DataParser, ParsedData};
use crate::serial::SerialManager;

// 应用状态
struct AppState {
    parser: Mutex<DataParser>,
    config: Mutex<MatrixConfig>,
}

#[tauri::command]
async fn list_serial_ports() -> Result<Vec<String>, String> {
    Ok(SerialManager::list_ports())
}

#[tauri::command]
async fn connect_matrix(
    state: tauri::State<'_, AppState>,
    port: String,
    baud_rate: u32,
) -> Result<(), String> {
    let mut parser = state.parser.lock().await;
    let mut config = state.config.lock().await;
    
    // 更新配置
    config.serial_matrix.port = port.clone();
    config.serial_matrix.baud_rate = baud_rate;
    config.save();
    
    // 连接串口
    let serial = SerialManager::new(SerialConfig {
        port,
        baud_rate,
        data_bits: 8,
        stop_bits: 1,
        parity: "None".to_string(),
    }).await?;
    
    parser.connect(serial).await;
    
    Ok(())
}

#[tauri::command]
async fn disconnect_matrix(
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let mut parser = state.parser.lock().await;
    parser.disconnect().await;
    Ok(())
}

#[tauri::command]
async fn read_and_parse_data(
    state: tauri::State<'_, AppState>,
) -> Result<ParsedData, String> {
    let mut parser = state.parser.lock().await;
    parser.read_and_parse().await?;
    let data = parser.get_parsed_data().await;
    Ok(data)
}

#[tauri::command]
async fn get_parsed_data(
    state: tauri::State<'_, AppState>,
) -> Result<ParsedData, String> {
    let parser = state.parser.lock().await;
    let data = parser.get_parsed_data().await;
    Ok(data)
}

#[tauri::command]
async fn get_config(
    state: tauri::State<'_, AppState>,
) -> Result<MatrixConfig, String> {
    let config = state.config.lock().await;
    Ok(config.clone())
}

#[tauri::command]
async fn save_config(
    state: tauri::State<'_, AppState>,
    new_config: MatrixConfig,
) -> Result<(), String> {
    let mut config = state.config.lock().await;
    *config = new_config;
    config.save();
    Ok(())
}

#[tauri::command]
async fn send_calibration_command(
    state: tauri::State<'_, AppState>,
    command: Vec<u8>,
) -> Result<(), String> {
    let parser = state.parser.lock().await;
    parser.send_command(&command).await?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            // 当检测到新实例启动时，显示已存在的窗口
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .manage(AppState {
            parser: Mutex::new(DataParser::new(MatrixConfig::load())),
            config: Mutex::new(MatrixConfig::load()),
        })
        .invoke_handler(tauri::generate_handler![
            list_serial_ports,
            connect_matrix,
            disconnect_matrix,
            read_and_parse_data,
            get_parsed_data,
            get_config,
            save_config,
            send_calibration_command,
        ])
        .setup(|app| {
            // 创建系统托盘
            crate::tray::create_tray(app.handle())?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // 隐藏窗口而不是关闭应用程序
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
