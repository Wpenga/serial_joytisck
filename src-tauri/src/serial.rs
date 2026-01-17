use serialport::{SerialPort};
use tokio::sync::Mutex;
use std::sync::Arc;
use std::vec::Vec;
use crate::config::SerialConfig;

pub struct SerialManager {
    port: Arc<Mutex<Option<Box<dyn SerialPort>>>>,
    buffer: Arc<Mutex<Vec<u8>>>,  // 用于存储未处理的串口数据
}

impl SerialManager {
    pub async fn new(config: SerialConfig) -> Result<Self, String> {
        let port = serialport::new(&config.port, config.baud_rate)
            .data_bits(serialport::DataBits::Eight)
            .stop_bits(serialport::StopBits::One)
            .parity(serialport::Parity::None)
            .timeout(std::time::Duration::from_millis(500))
            .open()
            .map_err(|e| e.to_string())?;
        
        Ok(Self {
            port: Arc::new(Mutex::new(Some(port))),
            buffer: Arc::new(Mutex::new(Vec::new())),
        })
    }
    
    pub async fn send(&self, data: &[u8]) -> Result<usize, String> {
        let mut port = self.port.lock().await;
        if let Some(port) = port.as_mut() {
            port.write(data).map_err(|e| e.to_string())
        } else {
            Err("串口未连接".to_string())
        }
    }
    
    // 新的数据读取函数，支持解析AA开头的自定义格式
    pub async fn read(&self, buffer: &mut [u8]) -> Result<usize, String> {
        let mut port = self.port.lock().await;
        let mut buffer_guard = self.buffer.lock().await;
        
        if let Some(port) = port.as_mut() {
            // 先读取所有可用数据到缓冲区
            let mut temp_buffer = [0u8; 1024];
            let read_bytes = port.read(&mut temp_buffer).unwrap_or(0);
            
            if read_bytes > 0 {
                buffer_guard.extend_from_slice(&temp_buffer[0..read_bytes]);
            }
            
            // 从缓冲区中查找完整的数据包
            // 数据包格式：AA ... BF，固定24字节
            let mut packet_found = false;
            let mut packet_start = 0;
            
            // 寻找完整的24字节数据包
            let mut i = 0;
            while i <= buffer_guard.len() - 24 {
                if buffer_guard[i] == 0xAA && buffer_guard[i + 23] == 0xBF {
                    packet_start = i;
                    packet_found = true;
                    break;
                }
                i += 1;
            }
            
            if packet_found {
                // 复制数据包到输出缓冲区
                buffer[0..24].copy_from_slice(&buffer_guard[packet_start..packet_start + 24]);
                
                // 移除已读取的数据包（包括前面的无效数据）
                buffer_guard.drain(0..packet_start + 24);
                return Ok(24);
            }
            
            // 保留缓冲区数据，不要清空，继续累积
            // 只在缓冲区过大时（超过1024字节）才进行清理，避免内存泄漏
            if buffer_guard.len() > 1024 {
                // 从最后一次出现AA的位置开始保留数据
                let mut last_aa_pos = 0;
                for (i, &byte) in buffer_guard.iter().enumerate().rev() {
                    if byte == 0xAA {
                        last_aa_pos = i;
                        break;
                    }
                }
                
                // 保留从最后一个AA开始的数据
                if last_aa_pos > 0 {
                    let new_buffer = buffer_guard[last_aa_pos..].to_vec();
                    *buffer_guard = new_buffer;
                } else {
                    // 如果没有找到AA，清空缓冲区
                    buffer_guard.clear();
                }
            }
            
            // 如果没有找到完整的数据包，返回Ok(0)表示没有读取到数据
            return Ok(0);
        } else {
            Err("串口未连接".to_string())
        }
    }
    
    // 列出可用串口
    pub fn list_ports() -> Vec<String> {
        serialport::available_ports()
            .unwrap_or_default()
            .into_iter()
            .map(|p| p.port_name)
            .collect()
    }
    
    pub async fn close(&self) {
        let mut port = self.port.lock().await;
        *port = None;
    }
}