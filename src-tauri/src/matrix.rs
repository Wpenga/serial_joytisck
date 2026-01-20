use crate::serial::SerialManager;
use crate::config::MatrixConfig;
use tokio::sync::Mutex;
use std::sync::Arc;

#[derive(Clone, serde::Serialize)]
pub struct ParsedData {
    pub index: u8,
    pub keys: [bool; 24],
    pub adc: [u8; 14],
    pub leds: [bool; 20],
    pub raw_data: Vec<u8>,
    pub valid: bool,
}

impl Default for ParsedData {
    fn default() -> Self {
        Self {
            index: 0,
            keys: [false; 24],
            adc: [0; 14],
            leds: [false; 20],
            raw_data: Vec::new(),
            valid: false,
        }
    }
}

pub struct DataParser {
    serial: Arc<Mutex<Option<SerialManager>>>,
    parsed_data: Arc<Mutex<ParsedData>>,
    config: Arc<Mutex<MatrixConfig>>,
    error_count: Arc<Mutex<u8>>, // 错误计数，最多返回5次错误
}

impl DataParser {
    pub fn new(config: MatrixConfig) -> Self {
        Self {
            serial: Arc::new(Mutex::new(None)),
            parsed_data: Arc::new(Mutex::new(ParsedData::default())),
            config: Arc::new(Mutex::new(config)),
            error_count: Arc::new(Mutex::new(0)),
        }
    }
    
    pub async fn connect(&mut self, serial: SerialManager) {
        let mut guard = self.serial.lock().await;
        *guard = Some(serial);
        // 连接时重置错误计数
        let mut error_guard = self.error_count.lock().await;
        *error_guard = 0;
    }
    
    pub async fn disconnect(&mut self) {
        let mut guard = self.serial.lock().await;
        if let Some(serial) = guard.as_mut() {
            serial.close().await;
        }
        *guard = None;
        // 断开连接时重置错误计数
        let mut error_guard = self.error_count.lock().await;
        *error_guard = 0;
    }
    
    pub async fn read_and_parse(&mut self) -> Result<(), String> {
        let mut buffer = [0u8; 128];
        
        // 读取一次数据，获取最新的串口数据
        let read_result = {
            let mut guard = self.serial.lock().await;
            if let Some(serial) = guard.as_mut() {
                serial.read(&mut buffer).await
            } else {
                return Err("Serial port not connected".to_string());
            }
        };
        
        let read_len = match read_result {
            Ok(len) => {
                // 成功读取数据，重置错误计数
                let mut error_guard = self.error_count.lock().await;
                *error_guard = 0;
                len
            },
            Err(e) => {
                // 读取失败，检查错误计数
                let mut error_guard = self.error_count.lock().await;
                if *error_guard < 5 {
                    // 错误计数小于5，返回错误并增加计数
                    *error_guard += 1;
                    return Err(e);
                } else {
                    // 错误计数大于等于5，不返回错误，返回0字节读取
                    0
                }
            }
        };
        
        let mut data_guard = self.parsed_data.lock().await;
        
        if read_len > 0 {
            // 只处理最新读取的数据，不累积
            let new_parsed_data = self.parse_data(&buffer[0..read_len]);
            
            if new_parsed_data.valid {
                *data_guard = new_parsed_data;
            } else {
                data_guard.raw_data = buffer[0..read_len].to_vec();
                data_guard.valid = false;
            }
        }
        
        Ok(())
    }
    
    fn parse_data(&self, data: &[u8]) -> ParsedData {
        let mut parsed = ParsedData::default();
        parsed.raw_data = data.to_vec();
        
        // 查找最新的有效帧（从后往前搜索）
        // 从数据末尾开始搜索，确保只处理最新的一帧
        for i in (0..data.len() - 23).rev() {
            if data[i] == 0xAA {
                let end = i + 23;
                if end < data.len() && data[end] == 0xBF {
                    let frame = &data[i..=end];
                    
                    if frame.len() == 24 {
                        // 计算校验和
                        let checksum = frame[22];
                        let mut calculated_checksum = 0u8;
                        for j in 0..22 {
                            calculated_checksum ^= frame[j];
                        }
                        
                        // 如果校验通过，直接处理此帧并返回
                        if calculated_checksum == checksum {
                            parsed.index = frame[1];
                            
                            // 解析按键数据
                            for i in 0..24 {
                                let byte_idx = 2 + i / 8;
                                let bit_idx = i % 8;
                                parsed.keys[i] = (frame[byte_idx] & (1 << bit_idx)) != 0;
                            }
                            
                            // 解析ADC数据
                            for i in 0..14 {
                                parsed.adc[i] = frame[5 + i];
                            }
                            
                            // 解析LED状态
                            for i in 0..20 {
                                let byte_idx = 19 + i / 8;
                                let bit_idx = i % 8;
                                parsed.leds[i] = (frame[byte_idx] & (1 << bit_idx)) != 0;
                            }
                            
                            parsed.valid = true;
                            return parsed;
                        }
                    }
                }
            }
        }
        
        // 如果没有找到有效帧，尝试找到最后一个帧（即使无效）
        for i in (0..data.len() - 23).rev() {
            if data[i] == 0xAA {
                let end = i + 23;
                if end < data.len() && data[end] == 0xBF {
                    let frame = &data[i..=end];
                    
                    if frame.len() == 24 {
                        parsed.index = frame[1];
                        
                        // 解析按键数据
                        for i in 0..24 {
                            let byte_idx = 2 + i / 8;
                            let bit_idx = i % 8;
                            parsed.keys[i] = (frame[byte_idx] & (1 << bit_idx)) != 0;
                        }
                        
                        // 解析ADC数据
                        for i in 0..14 {
                            parsed.adc[i] = frame[5 + i];
                        }
                        
                        // 解析LED状态
                        for i in 0..20 {
                            let byte_idx = 19 + i / 8;
                            let bit_idx = i % 8;
                            parsed.leds[i] = (frame[byte_idx] & (1 << bit_idx)) != 0;
                        }
                        
                        parsed.valid = false; // 标记为无效
                        return parsed;
                    }
                }
            }
        }
        
        parsed
    }
    
    pub async fn get_parsed_data(&self) -> ParsedData {
        let guard = self.parsed_data.lock().await;
        guard.clone()
    }
    
    pub async fn get_raw_data(&self) -> Vec<u8> {
        let guard = self.parsed_data.lock().await;
        guard.raw_data.clone()
    }
    
    pub async fn get_keys(&self) -> [bool; 24] {
        let guard = self.parsed_data.lock().await;
        guard.keys
    }
    
    pub async fn get_adc(&self) -> [u8; 14] {
        let guard = self.parsed_data.lock().await;
        guard.adc
    }
    
    pub async fn get_leds(&self) -> [bool; 20] {
        let guard = self.parsed_data.lock().await;
        guard.leds
    }
    
    pub async fn is_data_valid(&self) -> bool {
        let guard = self.parsed_data.lock().await;
        guard.valid
    }
    
    pub async fn send_command(&self, command: &[u8]) -> Result<usize, String> {
        let mut serial_guard = self.serial.lock().await;
        if let Some(serial) = serial_guard.as_mut() {
            serial.send(command).await
        } else {
            Err("Serial port not connected".to_string())
        }
    }
}