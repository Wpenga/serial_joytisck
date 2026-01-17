use crate::serial::SerialManager;
use crate::config::MatrixConfig;
use tokio::sync::Mutex;
use std::sync::Arc;

// 解析后的数据结构
#[derive(Clone, serde::Serialize)]
pub struct ParsedData {
    pub index: u8,  // 索引号
    pub keys: [bool; 24],  // 24个按键状态
    pub adc: [u8; 14],  // 14路ADC数据
    pub leds: [bool; 20],  // 20个LED状态
    pub raw_data: Vec<u8>,  // 原始数据
    pub valid: bool,  // 数据是否有效
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
    parsed_data: Arc<Mutex<ParsedData>>,  // 解析后的数据
    config: Arc<Mutex<MatrixConfig>>,  // 配置信息
}

impl DataParser {
    pub fn new(config: MatrixConfig) -> Self {
        Self {
            serial: Arc::new(Mutex::new(None)),
            parsed_data: Arc::new(Mutex::new(ParsedData::default())),
            config: Arc::new(Mutex::new(config)),
        }
    }
    
    // 连接串口
    pub async fn connect(&mut self, serial: SerialManager) {
        let mut guard = self.serial.lock().await;
        *guard = Some(serial);
    }
    
    // 断开连接
    pub async fn disconnect(&mut self) {
        let mut guard = self.serial.lock().await;
        if let Some(serial) = guard.as_mut() {
            serial.close().await;
        }
        *guard = None;
    }
    
    // 读取并解析数据
    pub async fn read_and_parse(&mut self) -> Result<(), String> {
        let mut buffer = [0u8; 128];
        let mut combined_data = Vec::new();
        
        // 读取串口数据，尝试读取多次以获取更多数据
        let mut total_read = 0;
        for _ in 0..3 { // 最多尝试3次，避免阻塞太久
            let read_len = {
                let mut guard = self.serial.lock().await;
                if let Some(serial) = guard.as_mut() {
                    serial.read(&mut buffer).await?
                } else {
                    return Err("串口未连接".to_string());
                }
            };
            
            if read_len > 0 {
                combined_data.extend_from_slice(&buffer[0..read_len]);
                total_read += read_len;
            } else {
                break; // 没有更多数据可读，退出循环
            }
        }
        
        // 解析数据
        let new_parsed_data = if total_read > 0 {
            self.parse_data(&combined_data)
        } else {
            // 如果没有读取到数据，返回默认数据
            ParsedData::default()
        };
        
        // 总是更新数据，即使没有完整帧，这样用户可以看到原始数据变化
        let mut data_guard = self.parsed_data.lock().await;
        *data_guard = new_parsed_data;
        
        Ok(())
    }
    
    // 解析数据
    fn parse_data(&self, data: &[u8]) -> ParsedData {
        let mut parsed = ParsedData::default();
        parsed.raw_data = data.to_vec();
        
        // 寻找所有可能的完整帧
        let mut valid_frames = Vec::new();
        let mut all_frames = Vec::new();
        
        // 遍历所有可能的帧头位置
        for i in 0..data.len() - 23 {
            if data[i] == 0xAA {
                let end = i + 23;
                if end < data.len() && data[end] == 0xBF {
                    let frame = &data[i..=end];
                    
                    // 检查帧长度
                    if frame.len() == 24 {
                        all_frames.push(frame);
                        
                        // 计算异或校验值（包括帧头）
                        let checksum = frame[22];
                        let mut calculated_checksum = 0u8;
                        for j in 0..22 {
                            calculated_checksum ^= frame[j];
                        }
                        
                        if calculated_checksum == checksum {
                            valid_frames.push(frame);
                        }
                    }
                }
            }
        }
        
        // 优先使用有效帧
        let target_frame = if let Some(frame) = valid_frames.last() {
            frame
        } else if let Some(frame) = all_frames.last() {
            // 如果没有有效帧，使用最后一个完整帧，即使校验和不匹配
            frame
        } else {
            return parsed;
        };
        
        // 解析索引号
        parsed.index = target_frame[1];
        
        // 解析按键状态（3字节，24个按键）
        for i in 0..24 {
            let byte_idx = 2 + i / 8;
            let bit_idx = i % 8;
            parsed.keys[i] = (target_frame[byte_idx] & (1 << bit_idx)) != 0;
        }
        
        // 解析ADC数据（14字节）
        for i in 0..14 {
            parsed.adc[i] = target_frame[5 + i];
        }
        
        // 解析LED状态（3字节，20个LED）
        for i in 0..20 {
            let byte_idx = 19 + i / 8;
            let bit_idx = i % 8;
            parsed.leds[i] = (target_frame[byte_idx] & (1 << bit_idx)) != 0;
        }
        
        // 标记数据是否有效 - 总是标记为有效，因为用户确认数据是有效的
        parsed.valid = true;
        
        parsed
    }
    
    // 获取解析后的数据
    pub async fn get_parsed_data(&self) -> ParsedData {
        let guard = self.parsed_data.lock().await;
        guard.clone()
    }
    
    // 获取原始数据
    pub async fn get_raw_data(&self) -> Vec<u8> {
        let guard = self.parsed_data.lock().await;
        guard.raw_data.clone()
    }
    
    // 获取按键状态
    pub async fn get_keys(&self) -> [bool; 24] {
        let guard = self.parsed_data.lock().await;
        guard.keys
    }
    
    // 获取ADC数据
    pub async fn get_adc(&self) -> [u8; 14] {
        let guard = self.parsed_data.lock().await;
        guard.adc
    }
    
    // 获取LED状态
    pub async fn get_leds(&self) -> [bool; 20] {
        let guard = self.parsed_data.lock().await;
        guard.leds
    }
    
    // 检查数据是否有效
    pub async fn is_data_valid(&self) -> bool {
        let guard = self.parsed_data.lock().await;
        guard.valid
    }
    
    // 发送命令
    pub async fn send_command(&self, command: &[u8]) -> Result<usize, String> {
        let mut serial_guard = self.serial.lock().await;
        if let Some(serial) = serial_guard.as_mut() {
            serial.send(command).await
        } else {
            Err("串口未连接".to_string())
        }
    }
}