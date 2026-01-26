# 固件升级协议说明

## 1. 固件接收流程概述

Bootloader固件升级的整体流程如下：

1. **进入升级模式**：设备重启后，Bootloader检测到升级标志（0x5A5A5A5A），进入升级模式
2. **上位机连接**：上位机通过串口连接设备，准备发送固件
3. **数据传输**：上位机将固件分成多个数据包发送给设备
4. **数据接收**：Bootloader接收数据并缓存，当缓存满时写入Flash
5. **传输完成**：上位机发送结束标志，Bootloader完成最后一次写入
6. **跳转执行**：Bootloader清除升级标志，跳转到新固件执行

## 2. 通信协议详解

### 2.1 协议结构

| 字段 | 长度（字节） | 描述 |
|------|-------------|------|
| 设备地址 | 1 | 固定为0x01 |
| 功能类型 | 1 | 0x01：文件数据<br>0x05：查询设备信息 |
| 帧序列 | 1 | 与接收的帧序列一致 |
| 数据长度 | 1 | 数据段的长度，最大256字节 |
| 数据 | 可变 | 固件数据，长度由数据长度字段指定 |
| 校验和 | 2 | 帧头到数据段的求和校验 |

### 2.2 功能类型定义

| 功能类型 | 描述 |
|----------|------|
| 0x01 | 文件数据传输 |
| 0x05 | 查询设备信息 |

### 2.3 数据传输格式

- **最大数据包大小**：256字节（数据段长度）
- **建议数据包大小**：512字节（Bootloader内部缓存大小）
- **结束标志**：数据长度为0的数据包

## 3. 数据传输细节

### 3.1 一次发送多少字节

- **推荐数据包大小**：512字节
- **原因**：Bootloader内部缓存大小为512字节（`IAP_BUFFER_SIZE = 512`）
- **实际传输**：上位机每次发送的数据会被协议封装，因此：
  - 协议头：6字节（设备地址1 + 功能类型1 + 帧序列1 + 数据长度1 + 校验和2）
  - 数据段：最大256字节
  - 每包总长度：最大262字节

### 3.2 发送频率

- Bootloader每10ms处理一次串口数据
- 上位机可以连续发送数据包，不需要等待响应
- 但建议在上位机中实现简单的流量控制，确保数据不会丢失

## 4. 上位机校验要求

### 4.1 校验方式

- **校验类型**：求和校验
- **校验范围**：从设备地址到数据段的所有字节
- **计算方法**：将所有参与校验的字节相加，结果作为校验和

### 4.2 校验和计算示例

```python
def calculate_checksum(data):
    """计算校验和"""
    checksum = 0
    for byte in data:
        checksum += byte
    return checksum & 0xFFFF  # 取低16位
```

## 5. 完整上位机开发流程

### 5.1 开发步骤

1. **准备工作**
   - 打开串口连接（波特率：115200，8N1）
   - 准备固件文件
   - 计算固件大小

2. **发送固件**
   - 打开固件文件并读取数据
   - 将固件数据分成多个数据包
   - 为每个数据包添加协议头和校验和
   - 按顺序发送所有数据包
   - 发送结束标志（数据长度为0的数据包）

3. **接收响应**
   - 每个数据包发送后，Bootloader会返回一个响应包
   - 响应包的功能类型与发送包相同
   - 响应包的数据长度为0

4. **错误处理**
   - 超时处理：如果超过5秒没有收到响应，重发数据包
   - 校验错误：如果收到校验错误响应，重发数据包
   - 传输中断：如果传输中断，重新开始传输

### 5.2 上位机伪代码

```python
import serial
import time

def send_firmware(port, baudrate, firmware_path):
    # 打开串口
    ser = serial.Serial(port, baudrate, timeout=5)
    
    # 打开固件文件
    with open(firmware_path, 'rb') as f:
        firmware_data = f.read()
    
    firmware_size = len(firmware_data)
    print(f"固件大小：{firmware_size} 字节")
    
    # 分块发送
    block_size = 256  # 每包数据大小
    sequence = 0
    
    for i in range(0, firmware_size, block_size):
        # 计算当前块大小
        current_block_size = min(block_size, firmware_size - i)
        
        # 提取当前块数据
        block_data = firmware_data[i:i+current_block_size]
        
        # 构建数据包
        packet = bytearray()
        packet.append(0x01)  # 设备地址
        packet.append(0x01)  # 功能类型：文件数据
        packet.append(sequence)  # 帧序列
        packet.append(current_block_size)  # 数据长度
        packet.extend(block_data)  # 数据
        
        # 计算校验和
        checksum = sum(packet) & 0xFFFF
        packet.append(checksum & 0xFF)  # 校验和低字节
        packet.append((checksum >> 8) & 0xFF)  # 校验和高字节
        
        # 发送数据包
        ser.write(packet)
        print(f"发送块 {i//block_size + 1}/{(firmware_size + block_size - 1)//block_size}")
        
        # 接收响应
        response = ser.read(6)  # 响应包最小长度
        if len(response) < 6:
            print("超时未收到响应，重发数据包")
            continue
        
        # 增加帧序列
        sequence = (sequence + 1) % 256
        
        # 短暂延迟，确保Bootloader有时间处理
        time.sleep(0.01)
    
    # 发送结束标志
    end_packet = bytearray()
    end_packet.append(0x01)  # 设备地址
    end_packet.append(0x01)  # 功能类型：文件数据
    end_packet.append(sequence)  # 帧序列
    end_packet.append(0x00)  # 数据长度为0
    
    # 计算校验和
    checksum = sum(end_packet) & 0xFFFF
    end_packet.append(checksum & 0xFF)  # 校验和低字节
    end_packet.append((checksum >> 8) & 0xFF)  # 校验和高字节
    
    # 发送结束标志
    ser.write(end_packet)
    print("发送结束标志")
    
    # 接收响应
    response = ser.read(6)
    if len(response) >= 6:
        print("固件传输完成")
    else:
        print("传输结束标志发送失败")
    
    # 关闭串口
    ser.close()

# 使用示例
send_firmware('COM3', 115200, 'firmware.bin')
```

## 6. Bootloader处理流程

### 6.1 接收数据

1. **协议解析**：解析接收到的数据包，验证校验和
2. **数据缓存**：将数据存入内部缓存
3. **缓存满处理**：当缓存满时，写入Flash

### 6.2 写入Flash

1. **地址计算**：从`FIRMWARE_START_ADDR`开始，逐步增加
2. **数据写入**：每次写入128个32位字（512字节）
3. **结束处理**：当接收到数据长度为0的数据包时，完成最后一次写入

### 6.3 跳转执行

1. **清除升级标志**：将升级标志设置为0xFFFFFFFF
2. **验证固件**：检查应用程序栈顶地址是否合法
3. **跳转到应用程序**：设置新的栈顶指针，跳转到应用程序入口

## 7. 常见问题处理

### 7.1 传输失败

- **原因**：串口通信错误、校验错误、设备重启
- **处理**：重新开始传输，Bootloader会从起始地址重新写入

### 7.2 固件大小差异

- **问题**：新固件与旧固件大小不同
- **处理**：Bootloader会覆盖旧固件的对应区域，不影响新固件运行

### 7.3 超时处理

- **建议**：上位机实现5秒超时机制，超时后重发数据包
- **注意**：Bootloader没有超时机制，会一直等待数据

## 8. 测试建议

1. **功能测试**：使用不同大小的固件进行测试
2. **稳定性测试**：在不同波特率下测试传输稳定性
3. **异常测试**：模拟传输中断，测试重传功能
4. **兼容性测试**：测试不同版本固件的升级兼容性

## 9. 总结

- **传输协议**：简单的求和校验协议
- **数据包大小**：推荐512字节
- **结束标志**：数据长度为0的数据包
- **校验方式**：帧头到数据段的求和校验
- **流程**：进入升级模式 → 发送固件 → 发送结束标志 → 跳转到应用程序

通过以上协议，上位机可以可靠地向Bootloader传输固件，实现设备的远程升级。