use serde::{Deserialize, Serialize};
use std::fs;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SerialConfig {
    pub port: String,
    pub baud_rate: u32,
    pub data_bits: u8,
    pub stop_bits: u8,
    pub parity: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SerialScreenConfig {
    pub enabled: bool,
    pub port: String,
    pub baud_rate: u32,
    pub data_bits: u8,
    pub stop_bits: u8,
    pub parity: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MatrixMapping {
    pub last_received: String,
    pub mute_status: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MatrixConfig {
    pub serial_matrix: SerialConfig,
    pub serial_screen: SerialScreenConfig,  // 屏幕串口配置
    pub key_names: Vec<String>,  // 按键名称
    pub adc_names: Vec<String>,  // ADC名称
    pub led_names: Vec<String>,  // LED名称
}

impl MatrixConfig {
    pub fn load() -> Self {
        // 从应用数据目录加载配置
        let config_path = Self::get_config_path();
        let config_str = fs::read_to_string(config_path)
            .unwrap_or_else(|_| "{}".to_string());
        serde_json::from_str(&config_str).unwrap_or_default()
    }
    
    pub fn save(&self) {
        // 保存配置到应用数据目录，使用安全的错误处理避免程序崩溃
        let config_path = Self::get_config_path();
        println!("Saving config to: {}", config_path);
        
        if let Ok(config_str) = serde_json::to_string_pretty(self) {
            println!("Config JSON: {}", config_str);
            if let Err(e) = fs::write(config_path, config_str) {
                // 仅记录错误，不导致程序崩溃
                eprintln!("Failed to write config file: {}", e);
            } else {
                println!("Config saved successfully");
            }
        } else {
            // 仅记录错误，不导致程序崩溃
            eprintln!("Failed to serialize config");
        }
    }
    
    // 获取配置文件的正确路径
    fn get_config_path() -> String {
        // 在Tauri应用中，我们需要考虑不同环境下的配置文件路径
        // 对于开发环境，我们使用项目根目录下的config.json
        // 对于生产环境，我们使用应用所在目录的config.json
        #[cfg(debug_assertions)]
        {
            // 开发环境：项目根目录
            "config.json".to_string()
        }
        #[cfg(not(debug_assertions))]
        {
            // 生产环境：应用所在目录
            let exe_path = std::env::current_exe().unwrap_or_default();
            let app_dir = exe_path.parent().unwrap_or_else(|| std::path::Path::new("."));
            let config_path = app_dir.join("config.json");
            config_path.to_str().unwrap_or("config.json").to_string()
        }
    }
}

impl Default for MatrixConfig {
    fn default() -> Self {
        Self {
            serial_matrix: SerialConfig {
                port: "COM1".to_string(),
                baud_rate: 9600,
                data_bits: 8,
                stop_bits: 1,
                parity: "None".to_string(),
            },
            serial_screen: SerialScreenConfig {
                enabled: false,
                port: "COM2".to_string(),
                baud_rate: 9600,
                data_bits: 8,
                stop_bits: 1,
                parity: "None".to_string(),
            },
            // 自定义名称配置
            key_names: (1..=24).map(|i| format!("按键 {}", i)).collect(),
            adc_names: (1..=14).map(|i| format!("ADC {}", i)).collect(),
            led_names: (1..=20).map(|i| format!("LED {}", i)).collect(),
        }
    }
}