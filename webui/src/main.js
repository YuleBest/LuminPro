import { exec } from 'kernelsu';
import { createIcons, Sun, Settings, Save, Activity, RefreshCw, FileText } from 'lucide';

const CONFIG_DIR = '/data/adb/modules/LuminPro/config';
const PATH_CONFIG_DIR = '/data/adb/modules/LuminPro/config/path';
const BACKUP_DIR = '/data/adb/modules/LuminPro/config/.backup';
const PID_FILE = '/data/adb/modules/LuminPro/pid/inotifyd.pid';
const FLAG_FILE = '/data/adb/modules/LuminPro/pid/up.flag';
const STOP_FLAG_FILE = '/data/adb/modules/LuminPro/pid/stop.flag';
const LOG_FILE = '/data/adb/modules/LuminPro/service.log';
const DEFAULT_NOW_BRI_FILE = '/sys/class/backlight/panel0-backlight/brightness';
const DEFAULT_SYS_MAX_BRI_FILE = '/sys/class/backlight/panel0-backlight/max_brightness';

let NOW_BRI_FILE = DEFAULT_NOW_BRI_FILE;
let SYS_MAX_BRI_FILE = DEFAULT_SYS_MAX_BRI_FILE;

// Web UI 配置
let statusLogRefreshInterval = 1000; // 状态/日志刷新间隔（默认1秒）
let configRefreshInterval = 5000; // 配置卡片刷新间隔（默认5秒）
let autoRefreshStatusLogTimer = null; // 状态/日志刷新定时器
let autoRefreshConfigTimer = null; // 配置刷新定时器

// ==========================
// 工具函数
// ==========================
function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3000);
}

// 封装的 exec，按需返回真实执行结果
async function runCmd(cmd) {
  try {
    const res = await exec(cmd);
    return res;
  } catch (e) {
    console.error(e);
    return { errno: -1, stdout: '', stderr: String(e) };
  }
}

// 写入文件
async function writeFile(path, content) {
  const safeContent = String(content).replace(/'/g, "'\\''");
  return runCmd(`echo -n '${safeContent}' > "${path}"`);
}

// ==========================
// 业务逻辑
// ==========================

// 1. 加载配置
async function loadConfig() {
  // 首先加载设备路径配置
  const [pathNowRes, pathMaxRes] = await Promise.all([
    runCmd(`cat "${PATH_CONFIG_DIR}/now_bri_file.txt"`),
    runCmd(`cat "${PATH_CONFIG_DIR}/max_bri_file.txt"`)
  ]);

  if (pathNowRes.errno === 0) NOW_BRI_FILE = pathNowRes.stdout.trim();
  if (pathMaxRes.errno === 0) SYS_MAX_BRI_FILE = pathMaxRes.stdout.trim();

  // 然后加载其他配置
  const [uiRes, maxRes, sleepRes, autoRes, stepsRes, logSizeRes] = await Promise.all([
    runCmd(`cat "${CONFIG_DIR}/ui_max_bri.txt"`),
    runCmd(`cat "${CONFIG_DIR}/max_bri.txt"`),
    runCmd(`cat "${CONFIG_DIR}/sleep_time.txt"`),
    runCmd(`cat "${CONFIG_DIR}/auto_bri_sleep.txt"`),
    runCmd(`cat "${CONFIG_DIR}/steps_num.txt"`),
    runCmd(`cat "${CONFIG_DIR}/log_max_size.txt"`)
  ]);

  if (uiRes.errno === 0) document.getElementById('input-ui-max-bri').value = uiRes.stdout.trim();
  if (maxRes.errno === 0) document.getElementById('input-max-bri').value = maxRes.stdout.trim();
  
  // 加载高级设置中的设备路径
  document.getElementById('input-now-bri-file').value = NOW_BRI_FILE;
  document.getElementById('input-sys-max-bri-file').value = SYS_MAX_BRI_FILE;
  
  if (sleepRes.errno === 0) {
    const timeVal = sleepRes.stdout.trim();
    const modeSwitch = document.getElementById('input-sleep-mode');
    const expandArea = document.getElementById('sleep-time-expand');

    if(timeVal && timeVal.includes('-')) {
      modeSwitch.checked = true;
      expandArea.classList.add('show');
      const [start, end] = timeVal.split('-');
      if(start.length === 4) {
        document.getElementById('input-sleep-start-h').value = start.slice(0, 2);
        document.getElementById('input-sleep-start-m').value = start.slice(2);
      }
      if(end.length === 4) {
        document.getElementById('input-sleep-end-h').value = end.slice(0, 2);
        document.getElementById('input-sleep-end-m').value = end.slice(2);
      }
    } else {
      modeSwitch.checked = false;
      expandArea.classList.remove('show');
      // 给个可感知的默认显示值
      document.getElementById('input-sleep-start-h').value = '19';
      document.getElementById('input-sleep-start-m').value = '00';
      document.getElementById('input-sleep-end-h').value = '06';
      document.getElementById('input-sleep-end-m').value = '00';
    }
  }

  if (autoRes.errno === 0) document.getElementById('input-auto-bri-sleep').checked = autoRes.stdout.trim() === '1';
  if (stepsRes.errno === 0) {
     const v = stepsRes.stdout.trim();
     document.getElementById('input-steps-num').value = v ? v : '50';
  } else {
     document.getElementById('input-steps-num').value = '50';
  }
  if (logSizeRes.errno === 0) {
     const v = logSizeRes.stdout.trim();
     document.getElementById('input-log-max-size').value = v ? v : '500';
  } else {
     document.getElementById('input-log-max-size').value = '500';
  }

  // 加载 Web UI 配置（从 localStorage）
  const savedStatusRefresh = localStorage.getItem('statusLogRefreshInterval');
  const savedConfigRefresh = localStorage.getItem('configRefreshInterval');
  
  if (savedStatusRefresh && !isNaN(parseInt(savedStatusRefresh, 10))) {
    statusLogRefreshInterval = Math.max(100, parseInt(savedStatusRefresh, 10));
  }
  if (savedConfigRefresh && !isNaN(parseInt(savedConfigRefresh, 10))) {
    configRefreshInterval = Math.max(1000, parseInt(savedConfigRefresh, 10));
  }
  
  document.getElementById('input-status-refresh-interval').value = statusLogRefreshInterval;
  document.getElementById('input-config-refresh-interval').value = configRefreshInterval;
}

// 2. 保存配置并重启服务
async function saveConfig() {
  const uiMax = document.getElementById('input-ui-max-bri').value;
  const maxBri = document.getElementById('input-max-bri').value;
  
  const pad = (v) => String(v).padStart(2, '0');
  const sleepMode = document.getElementById('input-sleep-mode').checked;
  let sleepTime = "";
  
  if (sleepMode) {
    const sH = pad(document.getElementById('input-sleep-start-h').value);
    const sM = pad(document.getElementById('input-sleep-start-m').value);
    const eH = pad(document.getElementById('input-sleep-end-h').value);
    const eM = pad(document.getElementById('input-sleep-end-m').value);
    sleepTime = `${sH}${sM}-${eH}${eM}`;
  }
  
  const autoBriSleep = document.getElementById('input-auto-bri-sleep').checked ? '1' : '0';
  const stepsNum = document.getElementById('input-steps-num').value || '50';
  const logMaxSize = document.getElementById('input-log-max-size').value || '500';

  if (!uiMax || !maxBri) {
    showToast('亮度值不能为空');
    return;
  }

  showToast('保存中...');
  
  // 保存到文件 (若不存在则可能失败，前提是模块已经建立 config 目录)
  await writeFile(`${CONFIG_DIR}/ui_max_bri.txt`, uiMax);
  await writeFile(`${CONFIG_DIR}/max_bri.txt`, maxBri);
  await writeFile(`${CONFIG_DIR}/sleep_time.txt`, sleepTime);
  await writeFile(`${CONFIG_DIR}/auto_bri_sleep.txt`, autoBriSleep);
  await writeFile(`${CONFIG_DIR}/steps_num.txt`, stepsNum);
  await writeFile(`${CONFIG_DIR}/log_max_size.txt`, logMaxSize);

  // 通过写亮度节点一个无变化的值，强制触发 inotifyd 执行 up.sh 以重新读取配置
  // 注意：需要先清除 flag 以防 up.sh 挂起
  await runCmd(`rm -f "${FLAG_FILE}"`);
  
  // 或者最干脆的办法，直接杀掉 inotifyd，然后用模块本来的启动逻辑。
  // 但是 up.sh 本来就没有后台重启机制，它是通过 inotifyd 重启自己的。
  // 稳妥起见：
  const pidRes = await runCmd(`cat "${PID_FILE}"`);
  if (pidRes.errno === 0 && pidRes.stdout.trim()) {
      showToast('配置已保存 (可能需要在下次调整时生效)');
  } else {
      showToast('配置已保存 (服务未运行)');
  }
}

// 2.2 保存高级设置（设备路径）
async function saveAdvancedConfig() {
  const nowBriFile = document.getElementById('input-now-bri-file').value || DEFAULT_NOW_BRI_FILE;
  const sysMaxBriFile = document.getElementById('input-sys-max-bri-file').value || DEFAULT_SYS_MAX_BRI_FILE;

  showToast('保存中...');
  
  // 保存设备路径配置
  const pathChanged = (NOW_BRI_FILE !== nowBriFile) || (SYS_MAX_BRI_FILE !== sysMaxBriFile);
  await writeFile(`${PATH_CONFIG_DIR}/now_bri_file.txt`, nowBriFile);
  await writeFile(`${PATH_CONFIG_DIR}/max_bri_file.txt`, sysMaxBriFile);
  
  if (pathChanged) {
    showToast('设备路径已修改，需要重启服务生效');
  } else {
    showToast('设置已保存');
  }
}

// 2.3 保存 Web UI 配置
function saveWebUIConfig() {
  const statusRefresh = parseInt(document.getElementById('input-status-refresh-interval').value, 10) || 1000;
  const configRefresh = parseInt(document.getElementById('input-config-refresh-interval').value, 10) || 5000;
  
  // 验证最小值
  if (statusRefresh < 100) {
    showToast('状态/日志刷新间隔最小为100ms');
    document.getElementById('input-status-refresh-interval').value = 100;
    return;
  }
  if (configRefresh < 1000) {
    showToast('配置刷新间隔最小为1000ms');
    document.getElementById('input-config-refresh-interval').value = 1000;
    return;
  }
  
  // 保存到 localStorage
  localStorage.setItem('statusLogRefreshInterval', statusRefresh);
  localStorage.setItem('configRefreshInterval', configRefresh);
  
  // 更新全局变量
  statusLogRefreshInterval = statusRefresh;
  configRefreshInterval = configRefresh;
  
  // 重启刷新循环
  stopAutoRefresh();
  startAutoRefresh();
  
  showToast('Web UI 配置已保存，刷新间隔已更新');
}

// 2.5 恢复默认
let isResetConfirming = false;
let resetTimer = null;

function resetRestoreButton() {
  const btn = document.getElementById('btn-reset');
  btn.textContent = '恢复默认';
  btn.classList.remove('btn-danger');
  isResetConfirming = false;
  if(resetTimer) clearTimeout(resetTimer);
}

async function handleReset() {
  const btn = document.getElementById('btn-reset');
  
  if (!isResetConfirming) {
    // 进入确认状态
    isResetConfirming = true;
    btn.textContent = '确认';
    btn.classList.add('btn-danger');
    
    // 5秒后自动重置回原来状态
    resetTimer = setTimeout(resetRestoreButton, 5000);
    return;
  }

  // 执行恢复动作
  showToast('正在恢复默认配置...');
  resetRestoreButton();

  // 读取备份 (或者回退到默认逻辑)
  const [uiRes, maxRes, sleepRes, autoRes, stepsRes, logSizeRes] = await Promise.all([
    runCmd(`cat "${BACKUP_DIR}/ui_max_bri.txt"`),
    runCmd(`cat "${BACKUP_DIR}/max_bri.txt"`),
    runCmd(`cat "${BACKUP_DIR}/sleep_time.txt"`),
    runCmd(`cat "${BACKUP_DIR}/auto_bri_sleep.txt"`),
    runCmd(`cat "${BACKUP_DIR}/steps_num.txt"`),
    runCmd(`cat "${BACKUP_DIR}/log_max_size.txt"`)
  ]);

  // 填入值
  if (uiRes.errno === 0) document.getElementById('input-ui-max-bri').value = uiRes.stdout.trim();
  if (maxRes.errno === 0) document.getElementById('input-max-bri').value = maxRes.stdout.trim();
  
  if (sleepRes.errno === 0) {
    const tV = sleepRes.stdout.trim();
    const modeSwitch = document.getElementById('input-sleep-mode');
    const expandArea = document.getElementById('sleep-time-expand');

    if(tV.includes('-')) {
      modeSwitch.checked = true;
      expandArea.classList.add('show');
      const [s, e] = tV.split('-');
      if(s.length === 4) {
        document.getElementById('input-sleep-start-h').value = s.slice(0, 2);
        document.getElementById('input-sleep-start-m').value = s.slice(2);
      }
      if(e.length === 4) {
        document.getElementById('input-sleep-end-h').value = e.slice(0, 2);
        document.getElementById('input-sleep-end-m').value = e.slice(2);
      }
    }
  } else {
    document.getElementById('input-sleep-mode').checked = true;
    document.getElementById('sleep-time-expand').classList.add('show');
    document.getElementById('input-sleep-start-h').value = '19';
    document.getElementById('input-sleep-start-m').value = '00';
    document.getElementById('input-sleep-end-h').value = '06';
    document.getElementById('input-sleep-end-m').value = '00';
  }

  document.getElementById('input-auto-bri-sleep').checked = (autoRes.errno === 0) ? (autoRes.stdout.trim() === '1') : true;
  document.getElementById('input-steps-num').value = (stepsRes.errno === 0) ? stepsRes.stdout.trim() : '50';
  document.getElementById('input-log-max-size').value = (logSizeRes.errno === 0) ? logSizeRes.stdout.trim() : '500';

  // 直接触发保存
  await saveConfig();
}

// 3. 刷新实时状态
async function loadStatus() {
  const [curRes, sysRes, pidRes, stopRes, autoBriRes] = await Promise.all([
    runCmd(`cat "${NOW_BRI_FILE}"`),
    runCmd(`cat "${SYS_MAX_BRI_FILE}"`),
    runCmd(`cat "${PID_FILE}"`),
    runCmd(`[ -f "${STOP_FLAG_FILE}" ] && echo "1" || echo "0"`),
    runCmd(`settings get system screen_brightness_mode`)
  ]);

  const isPaused = stopRes.stdout.trim() === '1';
  const running = pidRes.errno === 0 && pidRes.stdout.trim();
  
  const statusDot = document.querySelector('.header-status .status-dot');
  const statusText = document.querySelector('.header-status .status-text');
  const toggleBtn = document.getElementById('btn-toggle-service');

  if (isPaused) {
    statusDot.style.backgroundColor = 'var(--md-sys-color-error)';
    statusText.textContent = '已暂停';
    toggleBtn.textContent = '启用';
  } else if (running) {
    statusDot.style.backgroundColor = '#4caf50';
    statusText.textContent = '运行中';
    toggleBtn.textContent = '暂停';
  } else {
    statusDot.style.backgroundColor = 'var(--md-sys-color-error)';
    statusText.textContent = '未运行';
    toggleBtn.textContent = '暂停';
  }

  // 填入数值
  const currentBri = curRes.errno === 0 ? curRes.stdout.trim() : '0';
  document.getElementById('status-current-bri').textContent = currentBri;
  document.getElementById('status-sys-max-bri').textContent = sysRes.errno === 0 ? sysRes.stdout.trim() : '—';
  document.getElementById('status-inotifyd-pid').textContent = running ? pidRes.stdout.trim() : '离线';

  // 更新亮度滑条
  const brightnessSlider = document.getElementById('brightness-slider');
  const sysMaxBri = sysRes.errno === 0 ? parseInt(sysRes.stdout.trim(), 10) : 255;
  brightnessSlider.max = sysMaxBri;
  const currentBriValue = parseInt(currentBri, 10) || 0;
  brightnessSlider.value = currentBriValue;
  
  // 显示为百分比
  const percentage = Math.round((currentBriValue / sysMaxBri) * 100);
  document.getElementById('brightness-display').textContent = percentage + '%';

  // 更新自动亮度开关
  const autoBriMode = autoBriRes.errno === 0 ? parseInt(autoBriRes.stdout.trim(), 10) : 0;
  const autoBriToggle = document.getElementById('auto-brightness-toggle');
  autoBriToggle.checked = autoBriMode === 1;

  // 简易判断当前休眠状态 (只为了前端展示，不影响后端核心)
  const isEnabled = document.getElementById('input-sleep-mode').checked;
  const sH = document.getElementById('input-sleep-start-h').value;
  const sM = document.getElementById('input-sleep-start-m').value;
  const eH = document.getElementById('input-sleep-end-h').value;
  const eM = document.getElementById('input-sleep-end-m').value;
  let isSleep = false;
  
  if(isEnabled && sH && sM && eH && eM) {
     const now = new Date();
     const nV = now.getHours() * 100 + now.getMinutes();
     const sNum = parseInt(sH, 10) * 100 + parseInt(sM, 10);
     const eNum = parseInt(eH, 10) * 100 + parseInt(eM, 10);
     if (sNum > eNum) {
        if(nV >= sNum || nV < eNum) isSleep = true;
     } else if (sNum < eNum) {
        if(nV >= sNum && nV < eNum) isSleep = true;
     }
  }
  document.getElementById('status-sleep').textContent = isSleep ? '休眠中' : '非休眠';
}

// 6. 暂停/启用服务
async function toggleService() {
  const res = await runCmd(`sh /data/adb/modules/LuminPro/action.sh`);
  if (res.errno === 0) {
    showToast(res.stdout.trim() || '状态已切换');
  } else {
    showToast('操作失败: ' + res.stderr);
  }
  await loadStatus();
}
async function restartService() {
  const btn = document.getElementById('btn-restart-service');
  
  showToast('正在重启服务...');
  btn.disabled = true;

  // 执行重启脚本
  const res = await runCmd(`sh /data/adb/modules/LuminPro/script/restart.sh`);
  
  if (res.errno === 0) {
    showToast('服务已成功重启');
  } else {
    showToast('重启失败: ' + res.stderr);
  }

  // 延迟刷新状态以确保 PID 文件已写入
  setTimeout(async () => {
    await loadStatus();
    btn.disabled = false;
  }, 1000);
}

let brightnessChangeTimer = null;

async function handleBrightnessChange(e) {
  try {
    const newBri = parseInt(e.target.value, 10);
    const percentage = Math.round((newBri / 255) * 100);
    
    // 立即更新 UI（不等待文件 IO）
    document.getElementById('brightness-display').textContent = percentage + '%';
    
    // 清除之前的定时器
    if (brightnessChangeTimer) {
      clearTimeout(brightnessChangeTimer);
    }
    
    // 防抖：300ms 后才真正写入文件
    brightnessChangeTimer = setTimeout(async () => {
      const cmd = `echo -n '${newBri}' > '${NOW_BRI_FILE}' 2>/dev/null && echo 'OK'`;
      const res = await runCmd(cmd);
      
      if (!(res.errno === 0 && res.stdout.includes('OK'))) {
        showToast('亮度设置失败，已恢复');
        await loadStatus(); // 恢复旧值
      }
    }, 300);
  } catch (error) {
    showToast('设置亮度出错: ' + error.message);
    await loadStatus();
  }
}

async function handleAutoBrightnessToggle(e) {
  try {
    const mode = e.target.checked ? 1 : 0;
    const cmd = `settings put system screen_brightness_mode ${mode}`;
    const res = await runCmd(cmd);
    
    if (res.errno === 0) {
      const msg = mode === 1 ? '自动亮度已启用' : '手动亮度已启用';
      showToast(msg);
    } else {
      showToast('设置失败: ' + (res.stderr || '未知错误'));
      e.target.checked = !e.target.checked; // 恢复旧值
    }
  } catch (error) {
    showToast('设置自动亮度出错: ' + error.message);
    e.target.checked = !e.target.checked;
  }
}

// 保存所有原始日志内容
let fullLogContent = '';

async function applyLogFilter() {
  // 快速应用日志筛选，不重新读取文件
  const logEl = document.getElementById('log-output');
  const filterLevel = document.getElementById('log-level-filter').value;

  if (!fullLogContent) {
    logEl.textContent = '暂无日志';
    return;
  }

  let displayLog = fullLogContent;
  if (filterLevel) {
    const lines = fullLogContent.split('\n');
    const filteredLines = lines.filter(line => line.includes(`[${filterLevel}]`));
    displayLog = filteredLines.length > 0 ? filteredLines.join('\n') : `暂无 [${filterLevel}] 等级的日志`;
  }

  if (logEl.textContent !== displayLog) {
    logEl.textContent = displayLog;
    logEl.scrollTop = logEl.scrollHeight;
  }
}

async function loadLogs() {
  const logEl = document.getElementById('log-output');
  const filterLevel = document.getElementById('log-level-filter').value;

  // 读取最后 50 行日志
  const res = await runCmd(`tail -n 50 "${LOG_FILE}"`);
  if (res.errno === 0) {
    const rawLog = res.stdout.trim() || '暂无日志';
    fullLogContent = rawLog;

    // 应用筛选
    await applyLogFilter();
  }
}

let clearLogsConfirming = false;
let clearLogsTimer = null;

async function handleClearLogs() {
  const btn = document.getElementById('btn-clear-logs');
  
  if (!clearLogsConfirming) {
    // 进入确认状态
    clearLogsConfirming = true;
    btn.textContent = '确认清空';
    btn.classList.add('btn-danger');
    
    // 5秒后自动重置回原来状态
    clearLogsTimer = setTimeout(() => {
      clearLogsConfirming = false;
      btn.textContent = '清空日志';
      btn.classList.remove('btn-danger');
    }, 5000);
    return;
  }

  // 执行清空动作
  clearLogsConfirming = false;
  btn.textContent = '清空日志';
  btn.classList.remove('btn-danger');
  clearTimeout(clearLogsTimer);

  showToast('正在清空日志...');
  const res = await runCmd(`> "${LOG_FILE}"`);
  
  if (res.errno === 0) {
    fullLogContent = '';
    showToast('日志已清空');
    await loadLogs(); // 刷新显示
  } else {
    showToast('清空失败: ' + (res.stderr || '未知错误'));
  }
}

// 自动刷新循环
function stopAutoRefresh() {
  if (autoRefreshStatusLogTimer) {
    clearTimeout(autoRefreshStatusLogTimer);
    autoRefreshStatusLogTimer = null;
  }
  if (autoRefreshConfigTimer) {
    clearTimeout(autoRefreshConfigTimer);
    autoRefreshConfigTimer = null;
  }
}

async function startAutoRefreshStatusLog() {
  try {
    await Promise.all([loadStatus(), loadLogs()]);
  } catch (error) {
    console.error('Error refreshing status/logs:', error);
  }
  autoRefreshStatusLogTimer = setTimeout(startAutoRefreshStatusLog, statusLogRefreshInterval);
}

async function startAutoRefreshConfig() {
  try {
    // 刷新配置相关卡片 (这里可以添加配置相关的刷新逻辑)
    // 目前配置不需要定时读取，但保留这个函数以便后续扩展
  } catch (error) {
    console.error('Error refreshing config:', error);
  }
  autoRefreshConfigTimer = setTimeout(startAutoRefreshConfig, configRefreshInterval);
}

async function startAutoRefresh() {
  // 立即执行一次状态/日志刷新
  await Promise.all([loadStatus(), loadLogs()]);
  
  // 启动定时刷新
  autoRefreshStatusLogTimer = setTimeout(startAutoRefreshStatusLog, statusLogRefreshInterval);
  autoRefreshConfigTimer = setTimeout(startAutoRefreshConfig, configRefreshInterval);
}

// ==========================
// 初始化
// ==========================

// 底栏导航逻辑
function setupNavbar() {
  const navbarBtns = document.querySelectorAll('.navbar-btn');
  const sections = document.querySelectorAll('.card');
  const navbarSlider = document.querySelector('.navbar-slider');

  // 更新滑块位置
  function updateSliderPosition(activeBtn) {
    if (!navbarSlider || !activeBtn) return;
    
    const navbarRect = activeBtn.closest('.floating-navbar').getBoundingClientRect();
    const btnRect = activeBtn.getBoundingClientRect();
    
    const sliderLeft = btnRect.left - navbarRect.left;
    const sliderWidth = btnRect.width;
    
    navbarSlider.style.left = sliderLeft + 'px';
    navbarSlider.style.width = sliderWidth + 'px';
  }

  // 根据分组显示卡片
  function showGroup(groupName) {
    sections.forEach(section => {
      const sectionGroup = section.getAttribute('data-nav-group');
      section.style.display = sectionGroup === groupName ? 'block' : 'none';
    });
  }

  // 设置按钮状态
  function setActiveBtn(btn) {
    navbarBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    updateSliderPosition(btn);
  }

  // 为每个按钮添加点击监听
  navbarBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const groupName = btn.getAttribute('data-section');
      showGroup(groupName);
      setActiveBtn(btn);
    });
  });

  // 初始化：显示第一个分组
  if (navbarBtns.length > 0) {
    const firstGroup = navbarBtns[0].getAttribute('data-section');
    showGroup(firstGroup);
    updateSliderPosition(navbarBtns[0]);
  }

  // 监听窗口大小变化以更新滑块位置
  window.addEventListener('resize', () => {
    const activeBtn = document.querySelector('.navbar-btn.active');
    if (activeBtn) updateSliderPosition(activeBtn);
  });
}

async function init() {

  // 初始化 Lucide 图标
  createIcons({
    icons: {
      Sun,
      Settings,
      Save,
      Activity,
      RefreshCw,
      FileText
    }
  });

  // 初始化底栏导航
  setupNavbar();

  // 绑定事件
  document.getElementById('btn-save').addEventListener('click', saveConfig);
  document.getElementById('btn-save-advanced').addEventListener('click', saveAdvancedConfig);
  document.getElementById('btn-save-webui-config').addEventListener('click', saveWebUIConfig);
  document.getElementById('btn-reset').addEventListener('click', handleReset);
  document.getElementById('btn-toggle-service').addEventListener('click', toggleService);
  document.getElementById('btn-restart-service').addEventListener('click', restartService);

  // 绑定亮度和自动亮度控件事件
  const brightnessSlider = document.getElementById('brightness-slider');
  const autoBrightnessToggle = document.getElementById('auto-brightness-toggle');
  
  if (brightnessSlider) {
    brightnessSlider.addEventListener('input', handleBrightnessChange);
  }
  
  if (autoBrightnessToggle) {
    autoBrightnessToggle.addEventListener('change', handleAutoBrightnessToggle);
  }

  // 绑定日志控件事件
  const logLevelFilter = document.getElementById('log-level-filter');
  const btnClearLogs = document.getElementById('btn-clear-logs');
  
  if (logLevelFilter) {
    logLevelFilter.addEventListener('change', async () => {
      await applyLogFilter(); // 改变筛选等级时应用筛选
    });
  }
  
  if (btnClearLogs) {
    btnClearLogs.addEventListener('click', handleClearLogs);
  }

  // 定时休眠折叠逻辑
  document.getElementById('input-sleep-mode').addEventListener('change', (e) => {
    const expandArea = document.getElementById('sleep-time-expand');
    if (e.target.checked) {
      expandArea.classList.add('show');
    } else {
      expandArea.classList.remove('show');
    }
  });

  // 初次加载配置
  await loadConfig();
  // 开启自动刷新状态和日志 (内置了已包含 loadStatus 和 loadLogs)
  startAutoRefresh();
}

// DOM 加载完成后运行
document.addEventListener('DOMContentLoaded', init);
