use serialport::{SerialPort};
use tokio::sync::Mutex;
use std::sync::Arc;
use std::vec::Vec;
use crate::config::SerialConfig;

pub struct SerialManager {
    port: Arc<Mutex<Option<Box<dyn SerialPort>>>>,
}

impl SerialManager {
    pub async fn new(config: SerialConfig) -> Result<Self, String> {
        let port = serialport::new(&config.port, config.baud_rate)
            .data_bits(serialport::DataBits::Eight)
            .stop_bits(serialport::StopBits::One)
            .parity(serialport::Parity::None)
            .timeout(std::time::Duration::from_millis(10))
            .open()
            .map_err(|e| e.to_string())?;
        
        Ok(Self {
            port: Arc::new(Mutex::new(Some(port))),
        })
    }
    
    pub async fn send(&self, data: &[u8]) -> Result<usize, String> {
        let mut port = self.port.lock().await;
        if let Some(port) = port.as_mut() {
            port.write(data).map_err(|e| e.to_string())
        } else {
            Err("Serial port not connected".to_string())
        }
    }
    
    pub async fn read(&self, buffer: &mut [u8]) -> Result<usize, String> {
        let mut port = self.port.lock().await;
        
        if let Some(port) = port.as_mut() {
            let read_bytes = port.read(buffer).map_err(|e| e.to_string())?;
            return Ok(read_bytes);
        } else {
            Err("Serial port not connected".to_string())
        }
    }
    
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