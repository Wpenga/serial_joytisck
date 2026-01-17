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
  const [keyNames, setKeyNames] = useState(Array(24).fill(''));
  const [adcNames, setAdcNames] = useState(Array(14).fill(''));
  const [ledNames, setLedNames] = useState(Array(20).fill(''));
  const [isEditingNames, setIsEditingNames] = useState(false);
  
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
  
  // 数据解析状态
  const [parsedData, setParsedData] = useState({
    index: 0,
    keys: Array(24).fill(false),
    adc: Array(14).fill(0),
    leds: Array(20).fill(false),
    raw_data: [],
    valid: false
  });
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshInterval, setRefreshInterval] = useState(1000); // 刷新间隔，毫秒
  
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
      
      // 加载自定义名称
      if (config.key_names && config.key_names.length === 24) {
        setKeyNames(config.key_names);
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
    } catch (err) {
      message.error(t('data.refreshError', { error: err }));
    } finally {
      setIsRefreshing(false);
    }
  };

  // 组件挂载时初始化
  useEffect(() => {
    refreshPorts();
    loadConfig();
    
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
    return (
      <Card title={t('data.keysTitle')} style={{ marginBottom: 16 }}>
        <Row gutter={[16, 16]}>
          {parsedData.keys.map((key, index) => (
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
    // 将原始数据按24字节分组，每组之间换行
    const bytes = parsedData.raw_data.map(byte => byte.toString(16).padStart(2, '0').toUpperCase());
    const groups = [];
    
    // 每24字节为一组
    for (let i = 0; i < bytes.length; i += 24) {
      const group = bytes.slice(i, i + 24).join(' ');
      groups.push(group);
    }
    
    const rawHex = groups.join('\n');
    
    return (
      <Card title={t('data.rawDataTitle')}>
        <div style={{ 
          padding: '16px', 
          backgroundColor: '#fafafa', 
          borderRadius: '8px',
          fontFamily: 'monospace',
          fontSize: '14px',
          lineHeight: '1.6',
          whiteSpace: 'pre-wrap',
          overflowX: 'auto'
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
          </Space>
        </div>
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
              {Array.from({ length: 24 }).map((_, index) => (
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
                <Card title={t('data.title')} style={{ marginBottom: 16 }}>
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