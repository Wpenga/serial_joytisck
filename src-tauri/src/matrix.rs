use crate::serial::SerialManager;
use tokio::sync::Mutex;
use std::sync::Arc;

#[derive(Clone, serde::Serialize)]
pub struct ParsedData {
    pub index: u8,
    pub keys: [bool; 26],
    pub adc: [u8; 14],
    pub leds: [bool; 20],
    pub raw_data: Vec<u8>,
    pub valid: bool,
}

impl Default for ParsedData {
    fn default() -> Self {
        Self {
            index: 0,
            keys: [false; 26],
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
    error_count: Arc<Mutex<u8>>,
    protocol_version: Arc<Mutex<String>>,
}

impl DataParser {
    pub fn new(protocol_version: String) -> Self {
        Self {
            serial: Arc::new(Mutex::new(None)),
            parsed_data: Arc::new(Mutex::new(ParsedData::default())),
            error_count: Arc::new(Mutex::new(0)),
            protocol_version: Arc::new(Mutex::new(protocol_version)),
        }
    }

    pub async fn set_protocol_version(&self, version: String) {
        let mut guard = self.protocol_version.lock().await;
        *guard = version;
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
                let mut error_guard = self.error_count.lock().await;
                *error_guard = 0;
                len
            },
            Err(e) => {
                let mut error_guard = self.error_count.lock().await;
                if *error_guard < 5 {
                    *error_guard += 1;
                    return Err(e);
                } else {
                    0
                }
            }
        };
        
        let mut data_guard = self.parsed_data.lock().await;
        let version = self.protocol_version.lock().await.clone();
        
        if read_len > 0 {
            let new_parsed_data = self.parse_data(&buffer[0..read_len], &version);
            
            if new_parsed_data.valid {
                *data_guard = new_parsed_data;
            } else {
                data_guard.raw_data = buffer[0..read_len].to_vec();
                data_guard.valid = false;
            }
        }
        
        Ok(())
    }
    
    fn parse_data(&self, data: &[u8], version: &str) -> ParsedData {
        let mut parsed = ParsedData::default();
        parsed.raw_data = data.to_vec();

        let (frame_len, key_count, _key_bytes, adc_offset, led_offset, checksum_offset) =
            if version == "2.0" {
                (25, 26, 4, 6, 20, 23)
            } else {
                (24, 24, 3, 5, 19, 22)
            };

        let tail_offset = frame_len - 1;

        for i in (0..data.len().saturating_sub(frame_len - 1)).rev() {
            if data[i] == 0xAA {
                let end = i + tail_offset;
                if end < data.len() && data[end] == 0xBF {
                    let frame = &data[i..=end];

                    if frame.len() == frame_len {
                        let checksum = frame[checksum_offset];
                        let mut calculated_checksum = 0u8;
                        for j in 0..checksum_offset {
                            calculated_checksum ^= frame[j];
                        }

                        if calculated_checksum == checksum {
                            parsed.index = frame[1];

                            for k in 0..key_count {
                                let byte_idx = 2 + k / 8;
                                let bit_idx = k % 8;
                                parsed.keys[k] = (frame[byte_idx] & (1 << bit_idx)) != 0;
                            }

                            for k in 0..14 {
                                parsed.adc[k] = frame[adc_offset + k];
                            }

                            for k in 0..20 {
                                let byte_idx = led_offset + k / 8;
                                let bit_idx = k % 8;
                                parsed.leds[k] = (frame[byte_idx] & (1 << bit_idx)) != 0;
                            }

                            parsed.valid = true;
                            return parsed;
                        }
                    }
                }
            }
        }

        for i in (0..data.len().saturating_sub(frame_len - 1)).rev() {
            if data[i] == 0xAA {
                let end = i + tail_offset;
                if end < data.len() && data[end] == 0xBF {
                    let frame = &data[i..=end];

                    if frame.len() == frame_len {
                        parsed.index = frame[1];

                        for k in 0..key_count {
                            let byte_idx = 2 + k / 8;
                            let bit_idx = k % 8;
                            parsed.keys[k] = (frame[byte_idx] & (1 << bit_idx)) != 0;
                        }

                        for k in 0..14 {
                            parsed.adc[k] = frame[adc_offset + k];
                        }

                        for k in 0..20 {
                            let byte_idx = led_offset + k / 8;
                            let bit_idx = k % 8;
                            parsed.leds[k] = (frame[byte_idx] & (1 << bit_idx)) != 0;
                        }

                        parsed.valid = false;
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

    pub async fn send_command(&self, command: &[u8]) -> Result<usize, String> {
        let mut serial_guard = self.serial.lock().await;
        if let Some(serial) = serial_guard.as_mut() {
            serial.send(command).await
        } else {
            Err("Serial port not connected".to_string())
        }
    }
}