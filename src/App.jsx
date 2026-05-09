import { useState, useEffect } from 'react';
import { Card, Button, Select, message, Row, Col, Space, Tabs, Typography, Statistic, Progress } from 'antd';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import './App.css';
import './i18n';

const { Title, Text } = Typography;

function App() {
  // 翻译钩子
  const { t, i18n } = useTranslation();
  
  // 状态管理
  const [ports, setPorts] = useState([]);
  const [selectedPort, setSelectedPort] = useState('');
  const [baudRate, setBaudRate] = useState(9600);
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [theme, setTheme] = useState(localStorage.getItem('theme') || 'light');
  
  // 自定义名称状态
  const [keyNames, setKeyNames] = useState(Array(26).fill(''));
  const [adcNames, setAdcNames] = useState(Array(14).fill(''));
  const [ledNames, setLedNames] = useState(Array(20).fill(''));
  const [isEditingNames, setIsEditingNames] = useState(false);
  const [protocolVersion, setProtocolVersion] = useState('2.0');
  
  // 设备校准状态
  const [calibrationConfig, setCalibrationConfig] = useState({
    channelEnabled: true,
    channelNumber: 1,
    calibrationMode: 2, // 1:自动, 2:手动
    calibrationType: 2, // 1:中心点, 2:量程
    deviceType: 1, // 1:摇杆, 2:电位器, 3:按键
  });
  const [calibrationCommand, setCalibrationCommand] = useState('');
  
  // LED灯测试状态
  const [ledTestStatuses, setLedTestStatuses] = useState(Array(20).fill(false)); // 20个LED灯的状态数组，false: 关灯, true: 开灯
  const [ledTestCommand, setLedTestCommand] = useState(''); // 当前发送的指令
  
  // 固件升级状态
  const [firmwareFile, setFirmwareFile] = useState(null);
  const [firmwarePath, setFirmwarePath] = useState('');
  const [upgradeStatus, setUpgradeStatus] = useState('idle'); // idle, sending, upgrading, completed, error
  const [upgradeProgress, setUpgradeProgress] = useState(0);
  const [upgradeMessage, setUpgradeMessage] = useState('');
  
  // 数据解析状态
  const [parsedData, setParsedData] = useState({
    index: 0,
    keys: Array(26).fill(false),
    adc: Array(14).fill(0),
    leds: Array(20).fill(false),
    raw_data: [],
    valid: false
  });
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshInterval, setRefreshInterval] = useState(100); // 刷新间隔，毫秒
  const [refreshErrorCount, setRefreshErrorCount] = useState(0); // 刷新数据失败计数
  
  // 语言切换
  const toggleLanguage = () => {
    const newLanguage = i18n.language === 'zh' ? 'en' : 'zh';
    i18n.changeLanguage(newLanguage);
    localStorage.setItem('language', newLanguage);
  };
  
  // 主题切换
  const toggleTheme = () => {
    const newTheme = theme === 'light' ? 'dark' : 'light';
    setTheme(newTheme);
    localStorage.setItem('theme', newTheme);
    document.documentElement.className = newTheme;
  };
  
  // 初始化和更新主题
  useEffect(() => {
    document.documentElement.className = theme;
  }, [theme]);

  // 获取串口列表
  const refreshPorts = async () => {
    try {
      const portList = await invoke('list_serial_ports');
      setPorts(portList);
    } catch (err) {
      message.error(t('serial.refreshPortsError'));
    }
  };

  // 加载配置
  const loadConfig = async () => {
    try {
      const config = await invoke('get_config');
      setSelectedPort(config.serial_matrix.port);
      setBaudRate(config.serial_matrix.baud_rate);
      
      if (config.protocol_version) {
        setProtocolVersion(config.protocol_version);
      }
      
      if (config.key_names && config.key_names.length >= 24) {
        setKeyNames(config.key_names.length >= 26 
          ? config.key_names 
          : [...config.key_names, '按键 25', '按键 26']);
      }
      if (config.adc_names && config.adc_names.length === 14) {
        setAdcNames(config.adc_names);
      }
      if (config.led_names && config.led_names.length === 20) {
        setLedNames(config.led_names);
      }
    } catch (err) {
      message.error(t('serial.loadConfigError'));
    }
  };
  
  const handleVersionChange = async (version) => {
    setProtocolVersion(version);
    try {
      await invoke('set_protocol_version', { version });
    } catch (err) {
      message.error(`版本切换失败: ${err}`);
    }
  };
  
  // 保存自定义名称
  const saveCustomNames = async () => {
    try {
      const config = await invoke('get_config');
      await invoke('save_config', {
        newConfig: {
          ...config,
          key_names: keyNames,
          adc_names: adcNames,
          led_names: ledNames
        }
      });
      setIsEditingNames(false);
      message.success(t('naming.saveSuccess'));
    } catch (err) {
      message.error(t('naming.saveError', { error: err }));
    }
  };
  
  // 生成校准命令
  const generateCalibrationCommand = () => {
    // 帧头 命令字 数据长度 通道使能 ADC通道号 校验模式 校验类型 设备类型
    const frame = [
      0x81, // 帧头
      0x10, // 命令字
      0x05, // 数据长度
      calibrationConfig.channelEnabled ? 0x01 : 0x00, // 通道使能
      calibrationConfig.channelNumber, // ADC通道号
      calibrationConfig.calibrationMode, // 校验模式
      calibrationConfig.calibrationType, // 校验类型
      calibrationConfig.deviceType, // 设备类型
    ];
    
    // 计算CRC（帧头到数据段求和）
    const crc = frame.reduce((acc, val) => acc + val, 0) & 0xFF;
    
    // 完整命令：帧 + 固定字节0x00 + CRC
    const fullCommand = [...frame, 0x00, crc];
    
    // 转换为十六进制字符串
    const hexCommand = fullCommand.map(byte => byte.toString(16).padStart(2, '0').toUpperCase()).join(' ');
    setCalibrationCommand(hexCommand);
    
    return fullCommand;
  };
  
  // 发送校准命令
  const sendCalibrationCommand = async () => {
    try {
      const command = generateCalibrationCommand();
      await invoke('send_calibration_command', { command });
      message.success(t('calibration.sendSuccess'));
    } catch (err) {
      message.error(t('calibration.sendError', { error: err }));
    }
  };
  
  // 发送LED测试指令
  const sendLedTestCommand = async (index, stateByte) => {
    try {
      // LED编号从1开始，所以index+1
      const ledNumber = index + 1;
      // 准备指令：CC XX 状态 BF，其中XX是LED编号
      // 使用传入的stateByte，而不是从ledTestStatuses获取
      const command = [0xCC, ledNumber, stateByte, 0xBF];
      await invoke('send_calibration_command', { command });
      message.success(t('ledTest.sendSuccess'));
    } catch (err) {
      message.error(t('ledTest.sendError', { error: err }));
    }
  };
  
  // 切换LED灯状态
  const toggleLedStatus = (index) => {
    // LED编号从1开始，所以index+1
    const ledNumber = index + 1;
    
    // 获取当前状态
    const currentStatus = ledTestStatuses[index];
    // 计算新状态（当前状态的反）
    const newStatus = !currentStatus;
    
    // 发送指令：与最终要显示的状态一致，即显示"开"发送开码(01)，显示"关"发送关码(00)
    const stateByte = newStatus ? 0x01 : 0x00;
    const commandHex = `CC ${ledNumber.toString(16).padStart(2, '0').toUpperCase()} ${stateByte.toString(16).padStart(2, '0').toUpperCase()} BF`;
    setLedTestCommand(commandHex);
    
    // 更新状态
    const newStatuses = [...ledTestStatuses];
    newStatuses[index] = newStatus;
    setLedTestStatuses(newStatuses);
    
    // 发送指令，将stateByte作为参数传递
    sendLedTestCommand(index, stateByte);
  };
  
  // 渲染设备校准界面
  const renderCalibration = () => {
    return (
      <Card title={t('calibration.title')}>
        <Space direction="vertical" style={{ width: '100%', marginBottom: 16 }}>
          {/* 通道配置 */}
          <div>
            <h3 style={{ marginBottom: 16 }}>{t('calibration.channelConfig')}</h3>
            <Row gutter={[16, 16]}>
              <Col xs={24} sm={12} md={8} lg={6} xl={4}>
                <div style={{ marginBottom: 8 }}>{t('calibration.channelEnabled')}</div>
                <input
                  type="checkbox"
                  checked={calibrationConfig.channelEnabled}
                  onChange={(e) => {
                    setCalibrationConfig({
                      ...calibrationConfig,
                      channelEnabled: e.target.checked
                    });
                  }}
                  style={{ marginRight: 8 }}
                />
                {calibrationConfig.channelEnabled ? t('calibration.enabled') : t('calibration.disabled')}
              </Col>
              <Col xs={24} sm={12} md={8} lg={6} xl={4}>
                <div style={{ marginBottom: 8 }}>{t('calibration.channelNumber')}</div>
                <input
                  type="number"
                  min="1"
                  max="10"
                  value={calibrationConfig.channelNumber}
                  onChange={(e) => {
                    setCalibrationConfig({
                      ...calibrationConfig,
                      channelNumber: parseInt(e.target.value) || 1
                    });
                  }}
                  style={{
                    padding: '8px 12px',
                    borderRadius: '4px',
                    border: '1px solid #d9d9d9',
                    width: '100%'
                  }}
                />
              </Col>
            </Row>
          </div>
          
          {/* 校准模式 */}
          <div>
            <h3 style={{ marginBottom: 16 }}>{t('calibration.modeConfig')}</h3>
            <Row gutter={[16, 16]}>
              <Col xs={24} sm={12} md={8} lg={6} xl={4}>
                <div style={{ marginBottom: 8 }}>{t('calibration.calibrationMode')}</div>
                <select
                  value={calibrationConfig.calibrationMode}
                  onChange={(e) => {
                    setCalibrationConfig({
                      ...calibrationConfig,
                      calibrationMode: parseInt(e.target.value)
                    });
                  }}
                  style={{
                    padding: '8px 12px',
                    borderRadius: '4px',
                    border: '1px solid #d9d9d9',
                    width: '100%'
                  }}
                >
                  <option value={1}>{t('calibration.autoMode')}</option>
                  <option value={2}>{t('calibration.manualMode')}</option>
                </select>
              </Col>
              <Col xs={24} sm={12} md={8} lg={6} xl={4}>
                <div style={{ marginBottom: 8 }}>{t('calibration.calibrationType')}</div>
                <select
                  value={calibrationConfig.calibrationType}
                  onChange={(e) => {
                    setCalibrationConfig({
                      ...calibrationConfig,
                      calibrationType: parseInt(e.target.value)
                    });
                  }}
                  style={{
                    padding: '8px 12px',
                    borderRadius: '4px',
                    border: '1px solid #d9d9d9',
                    width: '100%'
                  }}
                >
                  <option value={1}>{t('calibration.centerCalibration')}</option>
                  <option value={2}>{t('calibration.rangeCalibration')}</option>
                </select>
              </Col>
              <Col xs={24} sm={12} md={8} lg={6} xl={4}>
                <div style={{ marginBottom: 8 }}>{t('calibration.deviceType')}</div>
                <select
                  value={calibrationConfig.deviceType}
                  onChange={(e) => {
                    setCalibrationConfig({
                      ...calibrationConfig,
                      deviceType: parseInt(e.target.value)
                    });
                  }}
                  style={{
                    padding: '8px 12px',
                    borderRadius: '4px',
                    border: '1px solid #d9d9d9',
                    width: '100%'
                  }}
                >
                  <option value={1}>{t('calibration.joystick')}</option>
                  <option value={2}>{t('calibration.potentiometer')}</option>
                  <option value={3}>{t('calibration.button')}</option>
                </select>
              </Col>
            </Row>
          </div>
          
          {/* 生成的命令 */}
          <div>
            <h3 style={{ marginBottom: 16 }}>{t('calibration.generatedCommand')}</h3>
            <div style={{
              padding: '12px',
              backgroundColor: '#fafafa',
              borderRadius: '4px',
              fontFamily: 'monospace',
              fontSize: '16px',
              fontWeight: 'bold',
              marginBottom: 16
            }}>
              {calibrationCommand || t('calibration.noCommand')}
            </div>
          </div>
          
          {/* 操作按钮 */}
          <div>
            <Space>
              <Button onClick={() => {
                navigator.clipboard.writeText(calibrationCommand)
                  .then(() => message.success(t('calibration.copySuccess')))
                  .catch(err => message.error(t('calibration.copyError', { error: err })));
              }} disabled={!calibrationCommand}>
                {t('calibration.copyCommand')}
              </Button>
              <Button type="primary" onClick={sendCalibrationCommand} disabled={!isConnected}>
                {t('calibration.startCalibration')}
              </Button>
            </Space>
          </div>
          
          {/* 校准说明 */}
          <div style={{ backgroundColor: '#f0f8ff', padding: '16px', borderRadius: '4px' }}>
            <h3 style={{ marginBottom: 16 }}>{t('calibration.instructionsTitle')}</h3>
            <ol style={{ marginLeft: 20, lineHeight: 1.6 }}>
              <li>{t('calibration.instruction1')}</li>
              <li>{t('calibration.instruction2')}</li>
              <li>{t('calibration.instruction3')}</li>
              <li>{t('calibration.instruction4')}</li>
            </ol>
          </div>
        </Space>
      </Card>
    );
  };
  
  // 渲染LED灯测试界面
  const renderLedTest = () => {
    return (
      <Card title={t('ledTest.title')}>
        <Space direction="vertical" style={{ width: '100%', marginBottom: 16 }}>
          {/* LED开关网格 */}
          <div style={{ margin: '16px 0' }}>
            <Row gutter={[16, 16]}>
              {ledTestStatuses.map((status, index) => (
                <Col key={index} xs={12} sm={8} md={6} lg={4} xl={2.4}>
                  <div 
                    className="led-switch-container"
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      padding: '12px',
                      borderRadius: '8px',
                      backgroundColor: '#fafafa',
                      cursor: 'pointer',
                      transition: 'all 0.3s ease',
                      border: '1px solid #d9d9d9'
                    }}
                  >
                    {/* LED名称 */}
                    <div style={{
                      marginBottom: '8px',
                      fontSize: '14px',
                      fontWeight: 'bold',
                      color: '#333',
                      textAlign: 'center'
                    }}>
                      {ledNames[index] || `LED${index + 1}`}
                    </div>
                    {/* LED开关 */}
                    <div 
                      onClick={() => toggleLedStatus(index)}
                      style={{
                        width: '60px',
                        height: '60px',
                        borderRadius: '50%',
                        backgroundColor: status ? '#52c41a' : '#f0f0f0',
                        display: 'flex',
                        justifyContent: 'center',
                        alignItems: 'center',
                        cursor: 'pointer',
                        transition: 'all 0.3s ease',
                        boxShadow: status ? '0 0 15px rgba(82, 196, 26, 0.6)' : '0 2px 4px rgba(0, 0, 0, 0.1)',
                        border: '2px solid #d9d9d9'
                      }}
                    >
                      <div style={{
                        fontSize: '12px',
                        fontWeight: 'bold',
                        color: status ? '#fff' : '#333'
                      }}>
                        {status ? t('ledTest.on') : t('ledTest.off')}
                      </div>
                    </div>
                  </div>
                </Col>
              ))}
            </Row>
          </div>
          
          {/* 指令显示 */}
          <div>
            <h3 style={{ marginBottom: 16 }}>{t('ledTest.command')}</h3>
            <div style={{
              padding: '12px',
              backgroundColor: '#fafafa',
              borderRadius: '4px',
              fontFamily: 'monospace',
              fontSize: '16px',
              fontWeight: 'bold',
              marginBottom: 16,
              textAlign: 'center'
            }}>
              {ledTestCommand || t('ledTest.noCommand')}
            </div>
          </div>
          
          {/* 操作说明 */}
          <div style={{ backgroundColor: '#f0f8ff', padding: '16px', borderRadius: '4px', marginTop: 16 }}>
            <h3 style={{ marginBottom: 16 }}>{t('ledTest.instructions')}</h3>
            <p>{t('ledTest.instruction1')}</p>
            <p>{t('ledTest.instruction2')}</p>
          </div>
        </Space>
      </Card>
    );
  };

  // 连接矩阵
  const connectMatrix = async () => {
    if (!selectedPort) {
      message.error(t('serial.selectPortError'));
      return;
    }

    setIsLoading(true);
    try {
      await invoke('connect_matrix', {
        port: selectedPort,
        baudRate: baudRate
      });
      setIsConnected(true);
      message.success(t('serial.connectSuccess'));
    } catch (err) {
      message.error(t('serial.connectError', { error: err }));
    } finally {
      setIsLoading(false);
    }
  };

  // 断开连接
  const disconnectMatrix = async () => {
    try {
      await invoke('disconnect_matrix');
      setIsConnected(false);
      message.success(t('serial.disconnectSuccess'));
    } catch (err) {
      message.error(t('serial.disconnectError', { error: err }));
    }
  };

  // 刷新数据
  const refreshData = async () => {
    if (!isConnected) return;

    setIsRefreshing(true);
    try {
      const data = await invoke('read_and_parse_data');
      setParsedData(data);
      // 成功读取数据，重置错误计数
      setRefreshErrorCount(0);
    } catch (err) {
      // 只在错误计数小于5时显示错误提示，最多显示5次
      if (refreshErrorCount < 5) {
        message.error(t('data.refreshError', { error: err }));
      }
      // 增加错误计数
      setRefreshErrorCount(prevCount => prevCount + 1);
    } finally {
      setIsRefreshing(false);
    }
  };

  // 组件挂载时初始化
  useEffect(() => {
    refreshPorts();
    loadConfig();
    
    // 连接状态变化时重置错误计数
    setRefreshErrorCount(0);
    
    // 定时刷新数据
    let interval;
    if (isConnected) {
      interval = setInterval(refreshData, refreshInterval);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isConnected, refreshInterval]);
  
  // 当校准配置变化时自动生成指令
  useEffect(() => {
    generateCalibrationCommand();
  }, [calibrationConfig]);

  // 渲染按键状态
  const renderKeys = () => {
    const keyCount = protocolVersion === '2.0' ? 26 : 24;
    return (
      <Card title={t('data.keysTitle')} style={{ marginBottom: 16 }}>
        <Row gutter={[16, 16]}>
          {parsedData.keys.slice(0, keyCount).map((key, index) => (
            <Col key={index} xs={12} sm={8} md={6} lg={4} xl={3}>
              <div 
                className={`key-indicator ${key ? 'active' : ''}`}
                style={{
                  padding: '12px',
                  borderRadius: '8px',
                  textAlign: 'center',
                  backgroundColor: key ? '#52c41a' : '#f0f0f0',
                  color: key ? '#fff' : '#333',
                  fontWeight: key ? 'bold' : 'normal',
                  transition: 'all 0.3s ease',
                  boxShadow: key ? '0 2px 8px rgba(82, 196, 26, 0.4)' : 'none'
                }}
              >
                <div>{keyNames[index] || `${t('data.key')} ${index + 1}`}</div>
                <div style={{ fontSize: '24px', margin: '8px 0' }}>
                  {key ? '●' : '○'}
                </div>
                <div style={{ fontSize: '12px' }}>
                  {key ? t('data.pressed') : t('data.released')}
                </div>
              </div>
            </Col>
          ))}
        </Row>
      </Card>
    );
  };

  // 渲染ADC数据
  const renderAdc = () => {
    return (
      <Card title={t('data.adcTitle')} style={{ marginBottom: 16 }}>
        <Row gutter={[16, 16]}>
          {parsedData.adc.map((value, index) => (
            <Col key={index} xs={24} sm={12} md={8} lg={6} xl={4}>
              <div style={{ padding: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <Text strong>{adcNames[index] || `${t('data.adc')} ${index + 1}`}</Text>
                  <Statistic 
                    value={value} 
                    suffix="/255" 
                    valueStyle={{ fontSize: '16px' }}
                  />
                </div>
                <Progress 
                  percent={Math.round((value / 255) * 100)} 
                  strokeColor={{
                    '0%': '#108ee9',
                    '100%': '#87d068',
                  }}
                  size="small"
                />
              </div>
            </Col>
          ))}
        </Row>
      </Card>
    );
  };

  // 渲染LED状态
  const renderLeds = () => {
    return (
      <Card title={t('data.ledsTitle')} style={{ marginBottom: 16 }}>
        <Row gutter={[16, 16]}>
          {parsedData.leds.map((led, index) => (
            <Col key={index} xs={12} sm={8} md={6} lg={4} xl={3}>
              <div 
                className={`led-indicator ${led ? 'active' : ''}`}
                style={{
                  padding: '12px',
                  borderRadius: '8px',
                  textAlign: 'center',
                  backgroundColor: led ? '#ff4d4f' : '#f0f0f0',
                  color: led ? '#fff' : '#333',
                  fontWeight: led ? 'bold' : 'normal',
                  transition: 'all 0.3s ease',
                  boxShadow: led ? '0 2px 8px rgba(255, 77, 79, 0.4)' : 'none'
                }}
              >
                <div>{ledNames[index] || `${t('data.led')} ${index + 1}`}</div>
                <div style={{ fontSize: '24px', margin: '8px 0' }}>
                  {led ? '●' : '○'}
                </div>
                <div style={{ fontSize: '12px' }}>
                  {led ? t('data.on') : t('data.off')}
                </div>
              </div>
            </Col>
          ))}
        </Row>
      </Card>
    );
  };

  // 渲染原始数据
  const renderRawData = () => {
    const frameLen = protocolVersion === '2.0' ? 25 : 24;
    const bytes = parsedData.raw_data.map(byte => byte.toString(16).padStart(2, '0').toUpperCase());
    let allGroups = [];
    
    for (let i = 0; i < bytes.length - (frameLen - 1); i += frameLen) {
      if (bytes[i] === 'AA') {
        const group = bytes.slice(i, i + frameLen).join(' ');
        allGroups.push(group);
      }
    }
    
    // 只显示最新的3行
    const recentGroups = allGroups.slice(-3);
    const rawHex = recentGroups.join('\n');
    
    return (
      <Card title={t('data.rawDataTitle')}>
        <div style={{ 
          padding: '16px', 
          backgroundColor: '#fafafa', 
          borderRadius: '8px',
          fontFamily: 'monospace',
          fontSize: '14px',
          lineHeight: '1.8',
          whiteSpace: 'pre-wrap',
          overflowX: 'auto',
          border: '1px solid #e8e8e8'
        }}>
          {rawHex || t('data.noData')}
        </div>
        <div style={{ marginTop: '16px' }}>
          <Space>
            <Statistic 
              title={t('data.frameIndex')} 
              value={parsedData.index} 
            />
            <Statistic 
              title={t('data.dataValid')} 
              value={parsedData.valid ? t('data.valid') : t('data.invalid')} 
              valueStyle={{ color: parsedData.valid ? '#52c41a' : '#ff4d4f' }}
            />
            <Statistic 
              title={t('data.totalFrames')} 
              value={allGroups.length} 
            />
          </Space>
        </div>
      </Card>
    );
  };
  
  // 渲染固件升级界面
  const renderFirmwareUpgrade = () => {
    // 发送特定串口码 F5 5F 01 AB BF
    const sendUpgradeCommand = async () => {
      if (!isConnected) {
        message.error(t('serial.notConnected'));
        return;
      }
      
      try {
        const command = [0xF5, 0x5F, 0x01, 0xAB, 0xBF];
        await invoke('send_calibration_command', { command });
        message.success(t('firmwareUpgrade.sendCommandSuccess'));
        setUpgradeStatus('sending');
      } catch (err) {
        message.error(t('firmwareUpgrade.sendCommandError', { error: err }));
        setUpgradeStatus('error');
      }
    };
    
    // 处理文件上传
    const handleFileUpload = (e) => {
      const file = e.target.files[0];
      if (file) {
        setFirmwareFile(file);
        setFirmwarePath(file.name);
        message.success(t('firmwareUpgrade.fileSelected', { fileName: file.name }));
      }
    };
    
    // 清除选中的文件
    const clearFile = () => {
      setFirmwareFile(null);
      setFirmwarePath('');
      document.getElementById('firmware-upload').value = '';
    };
    
    // 计算校验和（累加和，与Bootloader一致）
    const calculateChecksum = (data) => {
      let sum = 0;
      for (const byte of data) {
        sum = (sum + byte) & 0xFFFF; // 确保不会溢出
      }
      return sum;
    };
    
    // 计算CRC32（与Bootloader一致）
    const calculateCRC32 = (data) => {
      let crc = 0xFFFFFFFF;
      const polynomial = 0x04C11DB7;
      const wordCount = Math.ceil(data.length / 4);
      
      for (let i = 0; i < wordCount; i++) {
        const offset = i * 4;
        let word = 0;
        
        // 读取32位字（小端序）
        for (let j = 0; j < 4; j++) {
          if (offset + j < data.length) {
            word |= (data[offset + j] << (j * 8));
          }
        }
        
        // CRC32计算
        crc ^= word;
        for (let j = 0; j < 32; j++) {
          if (crc & 0x80000000) {
            crc = (crc << 1) ^ polynomial;
          } else {
            crc = crc << 1;
          }
          crc &= 0xFFFFFFFF; // 确保32位
        }
      }
      
      return ~crc & 0xFFFFFFFF;
    };
    
    // 构建协议帧
    const buildProtocolFrame = (deviceAddr, funcType, seq, data) => {
      const dataLen = data.length;
      const frame = new Uint8Array(4 + dataLen + 2);
      
      // [设备地址][功能码][序列号][数据长度]
      frame[0] = deviceAddr;
      frame[1] = funcType;
      frame[2] = seq;
      frame[3] = dataLen;
      
      // 数据内容
      frame.set(data, 4);
      
      // 计算校验和
      const checksum = calculateChecksum(frame.slice(0, 4 + dataLen));
      frame[4 + dataLen] = (checksum >> 8) & 0xFF; // 高字节
      frame[5 + dataLen] = checksum & 0xFF; // 低字节
      
      return frame;
    };
    
    // 发送数据帧
    const sendFrame = async (frame) => {
      await invoke('send_calibration_command', { command: Array.from(frame) });
    };
    
    // 接收响应（简化版）
    const receiveResponse = async () => {
      // 注意：当前前端没有直接的串口接收API，需要后端支持
      // 这里我们简化处理，假设发送成功
      return true;
    };
    
    // 固件升级
    const startUpgrade = async () => {
      if (!isConnected) {
        message.error(t('serial.notConnected'));
        return;
      }
      
      if (!firmwareFile) {
        message.error(t('firmwareUpgrade.noFileSelected'));
        return;
      }
      
      setUpgradeStatus('upgrading');
      setUpgradeProgress(0);
      setUpgradeMessage(t('firmwareUpgrade.starting'));
      
      try {
        // 常量定义
        const DEVICE_ADDR = 0x01;
        const FUNC_SEND_DATA = 0x01;
        const FUNC_SEND_CRC = 0x06;
        const MAX_DATA_LEN = 512; // 每次最大512字节
        
        // 1. 读取固件文件
        const arrayBuffer = await firmwareFile.arrayBuffer();
        const firmwareData = new Uint8Array(arrayBuffer);
        const totalSize = firmwareData.length;
        
        setUpgradeMessage(t('firmwareUpgrade.sendingFirmware'));
        
        // 2. 计算CRC32（可选，根据实际需求）
        const useCRC = false; // 可以根据需要设置为true
        let crc = null;
        
        if (useCRC) {
          crc = calculateCRC32(firmwareData);
          setUpgradeMessage(`CRC32: 0x${crc.toString(16).padStart(8, '0').toUpperCase()}`);
        }
        
        // 3. 分片发送固件数据
        let sent = 0;
        let sequence = 0;
        
        while (sent < totalSize) {
          const chunkSize = Math.min(totalSize - sent, MAX_DATA_LEN);
          const chunk = firmwareData.slice(sent, sent + chunkSize);
          
          // 构建数据帧
          const frame = buildProtocolFrame(
            DEVICE_ADDR,
            FUNC_SEND_DATA,
            sequence,
            chunk
          );
          
          // 发送数据帧
          await sendFrame(frame);
          
          // 接收响应（可选，根据实际需求）
          await receiveResponse();
          
          // 更新进度
          sent += chunkSize;
          const percent = Math.round((sent * 100) / totalSize);
          setUpgradeProgress(percent);
          setUpgradeMessage(`${t('firmwareUpgrade.sendingFirmware')} ${percent}%`);
          
          // 更新帧序列
          sequence = (sequence + 1) % 256;
          
          // 添加延迟，避免发送过快
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        
        // 4. 发送CRC值（如果启用）
        if (useCRC && crc !== null) {
          setUpgradeMessage(t('firmwareUpgrade.sendingCRC'));
          
          // 小端序：CRC32值的字节顺序
          const crcBytes = new Uint8Array([
            (crc & 0xFF),           // 低字节
            ((crc >> 8) & 0xFF),     // 次低字节
            ((crc >> 16) & 0xFF),    // 次高字节
            ((crc >> 24) & 0xFF),    // 高字节
          ]);
          
          // 构建CRC帧
          const crcFrame = buildProtocolFrame(
            DEVICE_ADDR,
            FUNC_SEND_CRC,
            sequence,
            crcBytes
          );
          
          // 发送CRC帧
          await sendFrame(crcFrame);
          await receiveResponse();
          
          // 更新帧序列
          sequence = (sequence + 1) % 256;
        }
        
        // 5. 发送结束标志
        setUpgradeMessage(t('firmwareUpgrade.sendingEndFlag'));
        
        // 构建结束帧
        const endFrame = buildProtocolFrame(
          DEVICE_ADDR,
          FUNC_SEND_DATA,
          sequence,
          new Uint8Array(0) // 数据长度为0
        );
        
        // 发送结束帧
        await sendFrame(endFrame);
        await receiveResponse();
        
        // 完成升级
        setUpgradeStatus('completed');
        setUpgradeProgress(100);
        setUpgradeMessage(t('firmwareUpgrade.completed'));
        message.success(t('firmwareUpgrade.upgradeSuccess'));
      } catch (err) {
        console.error('升级失败:', err);
        setUpgradeStatus('error');
        setUpgradeMessage(t('firmwareUpgrade.upgradeError', { error: err }));
        message.error(t('firmwareUpgrade.upgradeError', { error: err }));
      }
    };
    
    return (
      <Card title={t('firmwareUpgrade.title')}>
        <Space direction="vertical" style={{ width: '100%' }}>
          {/* 操作步骤 */}
          <div style={{ marginBottom: 24 }}>
            <h3>{t('firmwareUpgrade.instructions')}</h3>
            <ol style={{ marginLeft: 20, lineHeight: 1.6 }}>
              <li>{t('firmwareUpgrade.step1')}</li>
              <li>{t('firmwareUpgrade.step2')}</li>
              <li>{t('firmwareUpgrade.step3')}</li>
            </ol>
          </div>
          
          {/* 步骤1：发送升级命令 */}
          <div style={{ marginBottom: 24 }}>
            <h3>{t('firmwareUpgrade.step1Title')}</h3>
            <div style={{ backgroundColor: '#f0f8ff', padding: '16px', borderRadius: '4px', marginBottom: 16 }}>
              <code style={{ fontSize: '16px', fontWeight: 'bold' }}>F5 5F 01 AB BF</code>
            </div>
            <Button 
              type="primary" 
              onClick={sendUpgradeCommand} 
              disabled={!isConnected || upgradeStatus !== 'idle'}
            >
              {t('firmwareUpgrade.sendCommand')}
            </Button>
          </div>
          
          {/* 步骤2：上传固件 */}
          <div style={{ marginBottom: 24 }}>
            <h3>{t('firmwareUpgrade.step2Title')}</h3>
            <div style={{ marginBottom: 16 }}>
              <input 
                type="file" 
                id="firmware-upload" 
                accept=".bin" 
                style={{ display: 'none' }} 
                onChange={handleFileUpload}
              />
              <Button 
                onClick={() => document.getElementById('firmware-upload').click()} 
                disabled={upgradeStatus === 'upgrading'}
              >
                {t('firmwareUpgrade.uploadButton')}
              </Button>
              {firmwarePath && (
                <div style={{ display: 'flex', alignItems: 'center', marginTop: 8 }}>
                  <span style={{ marginRight: 12 }}>{firmwarePath}</span>
                  <Button size="small" danger onClick={clearFile}>
                    {t('common.delete')}
                  </Button>
                </div>
              )}
            </div>
          </div>
          
          {/* 步骤3：开始升级 */}
          <div style={{ marginBottom: 24 }}>
            <h3>{t('firmwareUpgrade.step3Title')}</h3>
            <Button 
              type="primary" 
              onClick={startUpgrade} 
              disabled={!isConnected || !firmwareFile || upgradeStatus === 'upgrading'}
            >
              {t('firmwareUpgrade.upgradeButton')}
            </Button>
          </div>
          
          {/* 升级状态和进度 */}
          <div style={{ marginTop: 24 }}>
            <h3>{t('firmwareUpgrade.status')}</h3>
            <div style={{ marginBottom: 16 }}>
              <Progress 
                percent={upgradeProgress} 
                status={upgradeStatus === 'completed' ? 'success' : upgradeStatus === 'error' ? 'exception' : 'active'}
              />
            </div>
            <div style={{ 
              padding: '16px', 
              backgroundColor: '#fafafa', 
              borderRadius: '4px',
              minHeight: '60px',
              display: 'flex',
              alignItems: 'center'
            }}>
              {upgradeStatus === 'idle' && t('firmwareUpgrade.statusIdle')}
              {upgradeStatus === 'sending' && t('firmwareUpgrade.statusSending')}
              {upgradeStatus === 'upgrading' && upgradeMessage}
              {upgradeStatus === 'completed' && t('firmwareUpgrade.statusCompleted')}
              {upgradeStatus === 'error' && upgradeMessage}
            </div>
          </div>
        </Space>
      </Card>
    );
  };
  
  // 渲染自定义名称编辑界面
  const renderCustomNames = () => {
    return (
      <Card title={t('naming.title')}>
        <Space direction="vertical" style={{ width: '100%', marginBottom: 16 }}>
          {/* 按键名称编辑 */}
          <div>
            <h3 style={{ marginBottom: 16 }}>{t('naming.keyTitle')}</h3>
            <Row gutter={[16, 16]}>
              {Array.from({ length: protocolVersion === '2.0' ? 26 : 24 }).map((_, index) => (
                <Col key={index} xs={24} sm={12} md={8} lg={6} xl={4}>
                  <input
                    type="text"
                    placeholder={`${t('data.key')} ${index + 1}`}
                    value={keyNames[index]}
                    onChange={(e) => {
                      const newNames = [...keyNames];
                      newNames[index] = e.target.value;
                      setKeyNames(newNames);
                    }}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      borderRadius: '4px',
                      border: '1px solid #d9d9d9',
                      fontSize: '14px'
                    }}
                  />
                </Col>
              ))}
            </Row>
          </div>
          
          {/* ADC名称编辑 */}
          <div>
            <h3 style={{ marginBottom: 16 }}>{t('naming.adcTitle')}</h3>
            <Row gutter={[16, 16]}>
              {Array.from({ length: 14 }).map((_, index) => (
                <Col key={index} xs={24} sm={12} md={8} lg={6} xl={4}>
                  <input
                    type="text"
                    placeholder={`${t('data.adc')} ${index + 1}`}
                    value={adcNames[index]}
                    onChange={(e) => {
                      const newNames = [...adcNames];
                      newNames[index] = e.target.value;
                      setAdcNames(newNames);
                    }}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      borderRadius: '4px',
                      border: '1px solid #d9d9d9',
                      fontSize: '14px'
                    }}
                  />
                </Col>
              ))}
            </Row>
          </div>
          
          {/* LED名称编辑 */}
          <div>
            <h3 style={{ marginBottom: 16 }}>{t('naming.ledTitle')}</h3>
            <Row gutter={[16, 16]}>
              {Array.from({ length: 20 }).map((_, index) => (
                <Col key={index} xs={24} sm={12} md={8} lg={6} xl={4}>
                  <input
                    type="text"
                    placeholder={`${t('data.led')} ${index + 1}`}
                    value={ledNames[index]}
                    onChange={(e) => {
                      const newNames = [...ledNames];
                      newNames[index] = e.target.value;
                      setLedNames(newNames);
                    }}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      borderRadius: '4px',
                      border: '1px solid #d9d9d9',
                      fontSize: '14px'
                    }}
                  />
                </Col>
              ))}
            </Row>
          </div>
        </Space>
        
        <Space>
          <Button onClick={() => setIsEditingNames(false)}>
            {t('common.cancel')}
          </Button>
          <Button type="primary" onClick={saveCustomNames}>
            {t('common.save')}
          </Button>
        </Space>
      </Card>
    );
  };

  return (
    <div className="app-container">
      <div className="header">
        <h1 className="app-title">{t('common.appTitle')}</h1>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button
            onClick={toggleTheme}
            className="bg-gray-100 dark:bg-base-200 hover:bg-gray-200 dark:hover:bg-base-100 flex items-center justify-center transition-colors px-4 py-2 rounded-md text-sm font-medium min-w-[80px]"
            title={theme === 'light' ? t('common.switchToDarkMode') : t('common.switchToLightMode')}
          >
            {theme === 'light' ? '🌙' : '☀️'}
          </button>
          <button
            onClick={toggleLanguage}
            className="bg-gray-100 dark:bg-base-200 hover:bg-gray-200 dark:hover:bg-base-100 flex items-center justify-center transition-colors px-4 py-2 rounded-md text-sm font-medium min-w-[80px]"
            style={{ textAlign: 'center' }}
          >
            {i18n.language === 'zh' ? 'EN' : '中文'}
          </button>
        </div>
      </div>
      
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        type="capsule"
        style={{ marginBottom: 16 }}
        items={[
          {
            key: 'dashboard',
            label: t('nav.dashboard'),
            children: (
              <div>
                <Row gutter={[16, 16]}>
                  <Col span={24}>
                    <Card title={t('serial.title')} className="config-card">
                      <Space size="middle">
                        <Select
                          style={{ width: 200 }}
                          placeholder={t('placeholder.selectPort')}
                          value={selectedPort}
                          onChange={setSelectedPort}
                        >
                          {ports.map(port => (
                            <Select.Option key={port} value={port}>{port}</Select.Option>
                          ))}
                        </Select>
                        <Select
                          style={{ width: 120 }}
                          value={baudRate}
                          onChange={setBaudRate}
                        >
                          <Select.Option value={9600}>9600</Select.Option>
                          <Select.Option value={115200}>115200</Select.Option>
                          <Select.Option value={57600}>57600</Select.Option>
                          <Select.Option value={38400}>38400</Select.Option>
                        </Select>
                        <Button onClick={refreshPorts}>{t('serial.refreshPorts')}</Button>
                        {!isConnected ? (
                          <Button type="primary" onClick={connectMatrix} loading={isLoading}>
                            {t('serial.connect')}
                          </Button>
                        ) : (
                          <Button danger onClick={disconnectMatrix}>
                            {t('serial.disconnect')}
                          </Button>
                        )}
                        <Button 
                          type="primary" 
                          onClick={refreshData} 
                          loading={isRefreshing} 
                          disabled={!isConnected}
                        >
                          {t('serial.refreshStatus')}
                        </Button>
                      </Space>
                    </Card>
                  </Col>
                </Row>
              </div>
            )
          },
          {
            key: 'dataParsing',
            label: t('nav.dataParsing'),
            children: (
              <div>
                <Card title={t('data.title')} style={{ marginBottom: 16 }}
                  extra={
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '14px', color: '#666' }}>{t('data.protocolVersion')}:</span>
                      <Select
                        value={protocolVersion}
                        onChange={handleVersionChange}
                        style={{ width: 180 }}
                        options={[
                          { value: '1.0', label: t('data.versionV1') },
                          { value: '2.0', label: t('data.versionV2') },
                        ]}
                      />
                    </div>
                  }
                >
                  <Space direction="vertical" style={{ width: '100%' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Title level={4}>{t('data.connectionStatus')}</Title>
                      <Statistic 
                value={isConnected ? t('serial.connected') : t('serial.disconnected')}
                valueStyle={{ color: isConnected ? '#52c41a' : '#ff4d4f' }}
              />
            </div>
            
            {isConnected ? (
              <>
                {renderKeys()}
                {renderAdc()}
                {renderLeds()}
                {renderRawData()}
              </>
            ) : (
              <div style={{ 
                padding: '40px', 
                textAlign: 'center', 
                backgroundColor: '#fafafa', 
                borderRadius: '8px' 
              }}>
                <Text type="secondary">{t('data.connectFirst')}</Text>
              </div>
            )}
          </Space>
        </Card>
              </div>
            )
          },
          {
            key: 'ledTest',
            label: t('nav.ledTest'),
            children: renderLedTest()
          },
          {
            key: 'calibration',
            label: t('nav.calibration'),
            children: renderCalibration()
          },
          {
            key: 'firmwareUpgrade',
            label: t('nav.firmwareUpgrade'),
            children: renderFirmwareUpgrade()
          },
          {
            key: 'naming',
            label: t('nav.naming'),
            children: renderCustomNames()
          }
        ]}
      />
    </div>
  );
}

export default App;