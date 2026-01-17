fn main() {
    // 用户提供的精确数据帧
    let data = vec![
        0xAA, 0x47, 0x00, 0x00, 0x03,  // 帧头、序号、按键
        0x80, 0x80, 0x80, 0x80, 0x00, 0x00, 0x00, 0x80, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,  // ADC数据
        0x00, 0x00, 0x00,  // LED状态
        0x6E, 0xBF  // 校验和、帧尾
    ];
    
    println!("数据长度: {}", data.len());
    println!("帧头: 0x{:02X}", data[0]);
    println!("帧尾: 0x{:02X}", data[data.len() - 1]);
    
    // 计算异或校验值（包括帧头）
    let checksum = data[22];
    let mut calculated_checksum = 0u8;
    
    println!("\n计算异或校验（包括帧头）:");
    for i in 0..22 {
        calculated_checksum ^= data[i];
        println!("  索引 {} (0x{:02X}) - 累计: 0x{:02X}", i, data[i], calculated_checksum);
    }
    
    println!("\n校验结果:");
    println!("  数据中的校验值: 0x{:02X}", checksum);
    println!("  计算得到的校验值: 0x{:02X}", calculated_checksum);
    println!("  校验是否通过: {}", calculated_checksum == checksum);
}