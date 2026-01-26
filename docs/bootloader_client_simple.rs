// STM32 Bootloader 固件发送核心逻辑
// Rust Tauri 上位机 - 简化版本

use std::fs::File;
use std::io::Read;
use std::path::Path;
use std::time::Duration;
use serialport::{SerialPort, SerialPortSettings};
use anyhow::{Result, Context};

// ========== 协议定义 ==========

const DEVICE_ADDR: u8 = 0x01;
const FUNC_SEND_DATA: u8 = 0x01;
const FUNC_SEND_CRC: u8 = 0x06;
const MAX_DATA_LEN: usize = 512;  // 每次最大512字节

// ========== 协议帧 ==========

struct ProtocolFrame {
    device_addr: u8,
    func_type: u8,
    seq: u8,
    data: Vec<u8>,
}

impl ProtocolFrame {
    fn new(device_addr: u8, func_type: u8, seq: u8, data: Vec<u8>) -> Self {
        Self {
            device_addr,
            func_type,
            seq,
            data,
        }
    }

    // 打包成字节数组
    fn to_bytes(&self) -> Vec<u8> {
        let data_len = self.data.len() as u8;
        let mut frame = Vec::with_capacity(4 + self.data.len() + 2);

        // [设备地址][功能码][序列号][数据长度]
        frame.push(self.device_addr);
        frame.push(self.func_type);
        frame.push(self.seq);
        frame.push(data_len);

        // 数据内容
        frame.extend(&self.data);

        // 计算校验和（累加和）
        let checksum = calc_checksum(&frame);
        frame.push((checksum >> 8) as u8);  // 高字节
        frame.push(checksum as u8);         // 低字节

        frame
    }
}

// ========== 校验函数 ==========

// 计算校验和（累加和，与Bootloader一致）
fn calc_checksum(data: &[u8]) -> u16 {
    let mut sum: u16 = 0;
    for &byte in data {
        sum = sum.wrapping_add(byte as u16);
    }
    (256 - (sum % 256)) & 0x00FF
}

// 计算CRC32（与Bootloader一致）
fn calc_crc32(data: &[u8]) -> u32 {
    let mut crc: u32 = 0xFFFFFFFF;
    let word_count = (data.len() + 3) / 4;

    for i in 0..word_count {
        let offset = i * 4;
        let mut word: u32 = 0;

        // 读取32位字（小端序）
        for j in 0..4 {
            if offset + j < data.len() {
                word |= (data[offset + j] as u32) << (j * 8);
            }
        }

        // CRC32计算
        crc ^= word;
        for _ in 0..32 {
            if crc & 0x80000000 != 0 {
                crc = (crc << 1) ^ 0x04C11DB7;
            } else {
                crc = crc << 1;
            }
        }
    }

    !crc
}

// ========== Bootloader客户端 ==========

pub struct BootloaderClient {
    port: Box<dyn SerialPort>,
    seq: u8,
    use_crc: bool,
}

impl BootloaderClient {
    // 创建客户端
    pub fn new(port_name: &str, use_crc: bool) -> Result<Self> {
        let settings = SerialPortSettings {
            baud_rate: 115200,
            data_bits: serialport::DataBits::Eight,
            flow_control: serialport::FlowControl::None,
            parity: serialport::Parity::None,
            stop_bits: serialport::StopBits::One,
            timeout: Duration::from_millis(1000),
        };

        let port = serialport::open_with_settings(port_name, &settings)
            .with_context(|| format!("无法打开串口: {}", port_name))?;

        Ok(Self {
            port,
            seq: 0,
            use_crc,
        })
    }

    // 发送数据帧
    fn send(&mut self, frame: &ProtocolFrame) -> Result<()> {
        let bytes = frame.to_bytes();
        self.port.write_all(&bytes)
            .with_context(|| "发送数据失败")?;
        Ok(())
    }

    // 接收响应（简化版）
    fn recv(&mut self) -> Result<Vec<u8>> {
        let mut buf = vec![0u8; 1024];
        let n = self.port.read(&mut buf)
            .with_context(|| "接收数据失败")?;
        buf.truncate(n);
        Ok(buf)
    }

    // 发送固件数据块
    fn send_data_chunk(&mut self, chunk: &[u8]) -> Result<()> {
        let frame = ProtocolFrame::new(
            DEVICE_ADDR,
            FUNC_SEND_DATA,
            self.next_seq(),
            chunk.to_vec(),
        );
        self.send(&frame)?;
        Ok(())
    }

    // 发送CRC值
    fn send_crc(&mut self, crc: u32) -> Result<()> {
        // 小端序：CRC32值的字节顺序
        let crc_bytes = vec![
            (crc & 0xFF) as u8,           // 低字节
            ((crc >> 8) & 0xFF) as u8,     // 次低字节
            ((crc >> 16) & 0xFF) as u8,    // 次高字节
            ((crc >> 24) & 0xFF) as u8,    // 高字节
        ];

        let frame = ProtocolFrame::new(
            DEVICE_ADDR,
            FUNC_SEND_CRC,
            self.next_seq(),
            crc_bytes,
        );
        self.send(&frame)?;
        Ok(())
    }

    // 发送结束标志
    fn send_end(&mut self) -> Result<()> {
        let frame = ProtocolFrame::new(
            DEVICE_ADDR,
            FUNC_SEND_DATA,
            self.next_seq(),
            vec![],  // 数据长度为0
        );
        self.send(&frame)?;
        Ok(())
    }

    // 获取下一个序列号
    fn next_seq(&mut self) -> u8 {
        let s = self.seq;
        self.seq = self.seq.wrapping_add(1);
        s
    }

    // ========== 核心函数：下载固件 ==========

    pub fn download_firmware(&mut self, file_path: &Path) -> Result<()> {
        println!("========================================");
        println!("开始下载固件");
        println!("文件路径: {:?}", file_path);
        println!("CRC校验: {}", if self.use_crc { "启用" } else { "禁用" });
        println!("========================================");

        // 1. 读取固件文件
        let mut file = File::open(file_path)
            .with_context(|| "无法打开固件文件")?;

        let mut firmware = Vec::new();
        file.read_to_end(&mut firmware)
            .with_context(|| "读取固件文件失败")?;

        let total_size = firmware.len();
        println!("固件大小: {} 字节", total_size);

        // 2. 计算CRC32（如果启用）
        let crc_opt = if self.use_crc {
            let crc = calc_crc32(&firmware);
            println!("固件CRC32: 0x{:08X}", crc);
            Some(crc)
        } else {
            None
        };

        // 3. 分片发送固件数据
        println!("开始发送固件数据...");
        let mut sent = 0;

        while sent < total_size {
            let chunk_size = std::cmp::min(total_size - sent, MAX_DATA_LEN);
            let chunk = &firmware[sent..sent + chunk_size];

            // 发送数据块
            self.send_data_chunk(chunk)?;

            // 接收响应（可选，根据实际需求）
            match self.recv() {
                Ok(resp) => {
                    if resp.len() >= 4 {
                        // 检查响应功能码
                        if resp[1] == FUNC_SEND_DATA {
                            let percent = (sent + chunk_size) * 100 / total_size;
                            println!("进度: {}/{} 字节 ({}%)",
                                sent + chunk_size, total_size, percent);
                        }
                    }
                }
                Err(e) => {
                    println!("接收响应失败: {}", e);
                    // 可以选择继续或重试
                }
            }

            sent += chunk_size;

            // 添加延迟，避免发送过快
            std::thread::sleep(Duration::from_millis(50));
        }

        println!("固件数据发送完成");

        // 4. 发送CRC值（如果启用）
        if let Some(crc) = crc_opt {
            println!("发送CRC值: 0x{:08X}", crc);
            self.send_crc(crc)?;

            // 接收CRC响应
            match self.recv() {
                Ok(_) => println!("CRC值发送成功"),
                Err(e) => println!("CRC值响应失败: {}", e),
            }
        }

        // 5. 发送结束标志
        println!("发送结束标志...");
        self.send_end()?;

        // 接收结束响应
        match self.recv() {
            Ok(_) => println!("========================================"),
            Err(e) => println!("结束标志响应失败: {}", e),
        }

        println!("固件下载完成！");
        println!("========================================");

        Ok(())
    }
}

// ========== Tauri命令 ==========

#[tauri::command]
pub async fn bootloader_download(
    file_path: String,
    port_name: String,
    use_crc: bool,
) -> Result<String, String> {
    let path = Path::new(&file_path);

    println!("Tauri命令: bootloader_download");
    println!("文件: {}", file_path);
    println!("串口: {}", port_name);
    println!("CRC: {}", use_crc);

    // 创建Bootloader客户端
    let mut client = match BootloaderClient::new(&port_name, use_crc) {
        Ok(c) => {
            println!("串口打开成功");
            c
        }
        Err(e) => {
            return Err(format!("无法打开串口: {}", e));
        }
    };

    // 下载固件
    match client.download_firmware(&path) {
        Ok(_) => Ok("固件下载成功".to_string()),
        Err(e) => Err(format!("固件下载失败: {}", e)),
    }
}

// ========== 使用示例 ==========

fn main() {
    println!("STM32 Bootloader 固件下载工具");

    let firmware_path = "path/to/firmware.bin";
    let port_name = "COM3";  // Windows
    // let port_name = "/dev/ttyUSB0";  // Linux
    let enable_crc = true;  // 根据Bootloader配置

    match BootloaderClient::new(port_name, enable_crc) {
        Ok(mut client) => {
            if let Err(e) = client.download_firmware(Path::new(firmware_path)) {
                eprintln!("下载失败: {}", e);
            }
        }
        Err(e) => {
            eprintln!("无法打开串口: {}", e);
        }
    }
}

// ========== Cargo.toml 依赖 ==========

/*
[dependencies]
tauri = { version = "1.0", features = ["api-all"] }
serialport = "4.0"
anyhow = "1.0"

[build-dependencies]
tauri-build = { version = "1.0", features = [] }
*/

// ========== 前端调用示例（JavaScript/TypeScript）==========

/*
// 在Tauri前端调用

import { invoke } from '@tauri-apps/api/tauri';

// 下载固件
async function downloadFirmware() {
    try {
        const result = await invoke('bootloader_download', {
            filePath: '/path/to/firmware.bin',
            portName: 'COM3',
            useCrc: true
        });
        console.log('下载结果:', result);
    } catch (error) {
        console.error('下载失败:', error);
    }
}

// React示例
function FirmwareDownloader() {
    const [progress, setProgress] = useState(0);
    const [status, setStatus] = useState('');

    const handleDownload = async () => {
        setStatus('下载中...');
        try {
            const result = await invoke('bootloader_download', {
                filePath: selectedFile,
                portName: selectedPort,
                useCrc: true
            });
            setStatus('下载完成');
        } catch (error) {
            setStatus('下载失败: ' + error);
        }
    };

    return (
        <div>
            <button onClick={handleDownload}>开始下载</button>
            <p>{status}</p>
        </div>
    );
}
*/
