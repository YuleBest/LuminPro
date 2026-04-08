import { exec, listPackages, getPackagesInfo } from 'kernelsu';
import { createIcons, Sun, Settings, Settings2, Save, Activity, RefreshCw, FileText, Smartphone, MoreVertical, Eye, EyeOff, CheckSquare, CheckCheck, Square, Search, Sparkles, Plus, ShieldCheck, Moon, Play, RotateCcw, Monitor, Info, Code, User, BookOpen, X, Globe, Minus, Copy, Download } from 'lucide';
import MarkdownIt from 'markdown-it';
import PinyinMatch from 'pinyin-match';

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
let INOTIFY_EVENTS = 'c';

let cachedCurrentBri = null;
let cachedSysMaxBri = null;

// Web UI 配置
let statusLogRefreshInterval = 1000; // 状态/日志刷新间隔（默认1秒）
let configRefreshInterval = 5000; // 配置卡片刷新间隔（默认5秒）
let autoRefreshStatusLogTimer = null; // 状态/日志刷新定时器
let autoRefreshConfigTimer = null; // 配置刷新定时器
let uiZoom = 100; // 界面缩放百分比 (50-150)
let autoRefresh = true; // 自动刷新开关（默认开启）

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
    // 调试模式数据模拟
    console.warn(`[DEBUG] 执行命令失败 (可能是非 KSU 环境): ${cmd}`);
    
    // 基础配置模拟
    if (cmd.includes('cat') && cmd.includes('ui_max_bri.txt')) return { errno: 0, stdout: '4095', stderr: '' };
    if (cmd.includes('cat') && cmd.includes('max_bri.txt')) return { errno: 0, stdout: '3500', stderr: '' };
    if (cmd.includes('cat') && (cmd.includes('now_bri_file.txt') || cmd.includes('max_bri_file.txt'))) return { errno: 0, stdout: '/sys/mock/brightness', stderr: '' };
    if (cmd.includes('cat') && cmd.includes('inotify_events.txt')) return { errno: 0, stdout: 'c', stderr: '' };
    if (cmd.includes('cat') && cmd.includes('log_max_size.txt')) return { errno: 0, stdout: '1024', stderr: '' };
    if (cmd.includes('cat') && cmd.includes('steps_num.txt')) return { errno: 0, stdout: '100', stderr: '' };
    
    // 状态模拟
    if (cmd.includes('cat') && (cmd.includes('brightness') || cmd.includes('now_bri_file.txt'))) return { errno: 0, stdout: '1200', stderr: '' };
    if (cmd.includes('cat') && (cmd.includes('max_brightness') || cmd.includes('max_bri_file.txt'))) return { errno: 0, stdout: '4095', stderr: '' };
    if (cmd.includes('cat') && cmd.includes('inotifyd.pid')) return { errno: 0, stdout: '12345', stderr: '' };
    if (cmd.includes('settings get system screen_brightness_mode')) return { errno: 0, stdout: '1', stderr: '' };
    if (cmd.includes('[ -f') && cmd.includes('stop.flag')) return { errno: 0, stdout: '0', stderr: '' };
    
    // 日志模拟
    if (cmd.includes('tail') && cmd.includes('service.log')) {
      return { errno: 0, stdout: '[2026-04-07 15:40:01] [INFO] 服务启动成功\n[2026-04-07 15:41:05] [DEBUG] 亮度调整: 1200 -> 1250\n[2026-04-07 15:42:10] [INFO] 切换至峰值亮度模式\n[2026-04-07 15:43:22] [WARN] 检测到极低亮度设定', stderr: '' };
    }
    
    // 文档模拟
    if (cmd.includes('cat') && cmd.includes('.md')) return { errno: 0, stdout: '# 调试模式说明\n\n当前处于 **Web 调试模式**，显示的是模拟出的测试数据。\n\n- 状态卡片：全部固定为运行中。\n- 应用列表：预设了 150 个常用模拟应用。\n- 按钮：所有变更仅在当前页面生效，不会写入手机文件系统。', stderr: '' };
    if (cmd.includes('cat') && cmd.includes('.txt')) return { errno: 0, stdout: '这是 NOTE.txt 的模拟内容，用于测试纯文本渲染。', stderr: '' };

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
  const [pathNowRes, pathMaxRes, eventsRes] = await Promise.all([
    runCmd(`cat "${PATH_CONFIG_DIR}/now_bri_file.txt"`),
    runCmd(`cat "${PATH_CONFIG_DIR}/max_bri_file.txt"`),
    runCmd(`cat "${CONFIG_DIR}/inotify_events.txt"`)
  ]);

  if (pathNowRes.errno === 0) NOW_BRI_FILE = pathNowRes.stdout.trim();
  if (pathMaxRes.errno === 0) SYS_MAX_BRI_FILE = pathMaxRes.stdout.trim();
  if (eventsRes.errno === 0 && eventsRes.stdout.trim()) INOTIFY_EVENTS = eventsRes.stdout.trim();
  else INOTIFY_EVENTS = 'c';
  
  document.getElementById('input-inotify-events').value = INOTIFY_EVENTS;


  // 然后加载其他配置
  const [uiRes, maxRes, sleepRes, autoRes, stepsRes, logSizeRes, hdrSleepRes] = await Promise.all([
    runCmd(`cat "${CONFIG_DIR}/ui_max_bri.txt"`),
    runCmd(`cat "${CONFIG_DIR}/max_bri.txt"`),
    runCmd(`cat "${CONFIG_DIR}/sleep_time.txt"`),
    runCmd(`cat "${CONFIG_DIR}/auto_bri_sleep.txt"`),
    runCmd(`cat "${CONFIG_DIR}/steps_num.txt"`),
    runCmd(`cat "${CONFIG_DIR}/log_max_size.txt"`),
    runCmd(`cat "${CONFIG_DIR}/display_hdr_sleep.txt"`)
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
  if (hdrSleepRes.errno === 0) document.getElementById('input-display-hdr-sleep').checked = hdrSleepRes.stdout.trim() === '1';
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

  const savedAutoRefresh = localStorage.getItem('autoRefresh');
  if (savedAutoRefresh !== null) autoRefresh = savedAutoRefresh !== 'false';
  const autoRefreshToggle = document.getElementById('input-auto-refresh');
  if (autoRefreshToggle) {
    autoRefreshToggle.checked = autoRefresh;
    document.getElementById('item-status-refresh-interval').style.display = autoRefresh ? '' : 'none';
  }

  const uiZoomInput = document.getElementById('input-ui-zoom');
  if (uiZoomInput) uiZoomInput.value = uiZoom;
  applyUIZoom(uiZoom);
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
  const displayHdrSleep = document.getElementById('input-display-hdr-sleep').checked ? '1' : '0';
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
  await writeFile(`${CONFIG_DIR}/display_hdr_sleep.txt`, displayHdrSleep);
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

// 2.2 保存高级设置（设备路径及事件监听）
async function saveAdvancedConfig() {
  const nowBriFile = document.getElementById('input-now-bri-file').value || DEFAULT_NOW_BRI_FILE;
  const sysMaxBriFile = document.getElementById('input-sys-max-bri-file').value || DEFAULT_SYS_MAX_BRI_FILE;
  const eventsVal = document.getElementById('input-inotify-events').value || 'c';

  showToast('保存中...');
  
  // 保存设备路径配置
  const configChanged = (NOW_BRI_FILE !== nowBriFile) || (SYS_MAX_BRI_FILE !== sysMaxBriFile) || (INOTIFY_EVENTS !== eventsVal);
  await writeFile(`${PATH_CONFIG_DIR}/now_bri_file.txt`, nowBriFile);
  await writeFile(`${PATH_CONFIG_DIR}/max_bri_file.txt`, sysMaxBriFile);
  await writeFile(`${CONFIG_DIR}/inotify_events.txt`, eventsVal);
  
  if (configChanged) {
    INOTIFY_EVENTS = eventsVal;
    showToast('高级设置已修改，需要重启服务生效');
  } else {
    showToast('设置已保存');
  }
}

// 2.3 保存 Web UI 配置
function saveWebUIConfig() {
  const newAutoRefresh = document.getElementById('input-auto-refresh').checked;
  const statusRefresh = parseInt(document.getElementById('input-status-refresh-interval').value, 10) || 1000;
  const configRefresh = parseInt(document.getElementById('input-config-refresh-interval').value, 10) || 5000;
  const zoom = parseInt(document.getElementById('input-ui-zoom').value, 10) || 100;
  
  // 验证最小值
  if (newAutoRefresh && statusRefresh < 100) {
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
  localStorage.setItem('autoRefresh', newAutoRefresh);
  localStorage.setItem('statusLogRefreshInterval', statusRefresh);
  localStorage.setItem('configRefreshInterval', configRefresh);
  localStorage.setItem('uiZoom', zoom);
  
  // 更新全局变量
  autoRefresh = newAutoRefresh;
  statusLogRefreshInterval = statusRefresh;
  configRefreshInterval = configRefresh;
  uiZoom = zoom;
  
  // 重启刷新循环
  stopAutoRefresh();
  if (autoRefresh) startAutoRefresh();
  
  applyUIZoom(zoom);
  showToast('Web UI 配置已保存');
}

function applyUIZoom(zoom) {
  const z = parseInt(zoom, 10);
  if (isNaN(z) || z < 1) return;
  const scale = z / 100;
  // 仅在根元素 html 上设置 zoom 以免叠加，zoom 对 fixed 布局支持最佳
  document.documentElement.style.zoom = scale;
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

function updateSliderProgress(slider) {
  if (!slider) return;
  const sysMax = parseInt(slider.max, 10) || 255;
  const currVal = parseInt(slider.value, 10) || 0;
  
  // 获取前台最大亮度，用于划分危险区间
  const uiMaxInput = document.getElementById('input-ui-max-bri');
  const uiMax = uiMaxInput ? (parseInt(uiMaxInput.value, 10) || sysMax) : sysMax;
  
  const currPercent = (currVal / sysMax) * 100;
  const uiPercent = (uiMax / sysMax) * 100;
  
  // 颜色定义
  const primaryColor = '#a8c7fa'; // var(--md-sys-color-primary)
  const boostColor = '#fb8c00';   // 显眼的琥珀色 (Warning Color)
  const normalTrack = 'var(--md-sys-color-surface-container-high)';
  const boostTrack = 'rgba(251, 140, 0, 0.15)'; // 浅色的危险区背景
  
  let gradient = 'linear-gradient(to right, ';
  
  if (currPercent <= uiPercent) {
    // 进度在正常区间内
    gradient += `${primaryColor} 0%, ${primaryColor} ${currPercent}%, `;
    gradient += `${normalTrack} ${currPercent}%, ${normalTrack} ${uiPercent}%, `;
    gradient += `${boostTrack} ${uiPercent}%, ${boostTrack} 100%`;
  } else {
    // 进度进入了峰值/危险区间
    gradient += `${primaryColor} 0%, ${primaryColor} ${uiPercent}%, `;
    gradient += `${boostColor} ${uiPercent}%, ${boostColor} ${currPercent}%, `;
    gradient += `${boostTrack} ${currPercent}%, ${boostTrack} 100%`;
  }
  
  gradient += ')';
  slider.style.background = gradient;
}

// 3. 刷新实时状态
async function loadStatus(forceFull = false) {
  if (forceFull || cachedCurrentBri === null || cachedSysMaxBri === null) {
    const [cRes, sRes] = await Promise.all([
      runCmd(`cat "${NOW_BRI_FILE}"`),
      runCmd(`cat "${SYS_MAX_BRI_FILE}"`)
    ]);
    if (cRes.errno === 0) cachedCurrentBri = cRes.stdout.trim();
    else cachedCurrentBri = '0'; // 即使失败也不要让它保持 null 导致下次继续递归
    
    if (sRes.errno === 0) cachedSysMaxBri = sRes.stdout.trim();
    else cachedSysMaxBri = '255';
  }

  const [pidRes, stopRes, autoBriRes, hdrRes] = await Promise.all([
    runCmd(`cat "${PID_FILE}"`),
    runCmd(`[ -f "${STOP_FLAG_FILE}" ] && echo "1" || echo "0"`),
    runCmd(`settings get system screen_brightness_mode`),
    runCmd(`dumpsys display 2>/dev/null | sed -n 's/.*hdrSdrRatio \\([0-9.]*\\).*/\\1/p' | head -n 1`)
  ]);

  const isPaused = stopRes.errno === 0 && stopRes.stdout.trim() === '1';
  const running = pidRes.errno === 0 && pidRes.stdout.trim();

  // 获取 inotifyd 进程状态
  let inotifydState = '—';
  if (running) {
    const pid = pidRes.stdout.trim();
    const stateRes = await runCmd(`cat /proc/${pid}/status 2>/dev/null | grep "State:" | sed 's/.*(\(.*\))/\\1/'`);
    if (stateRes.errno === 0 && stateRes.stdout.trim()) {
      inotifydState = stateRes.stdout.trim();
    } else {
      inotifydState = '已退出';
    }
  } else {
    inotifydState = '离线';
  }
  
  const statusDot = document.querySelector('.header-status .status-dot');
  const statusText = document.querySelector('.header-status .status-text');
  const statusContainer = document.getElementById('module-status');
  const toggleBtn = document.getElementById('btn-toggle-service');

  if (isPaused) {
    statusDot.style.backgroundColor = 'var(--md-sys-color-error)';
    statusDot.style.boxShadow = '0 0 8px rgba(244, 67, 54, 0.5)';
    statusText.textContent = '已暂停';
    toggleBtn.textContent = '启用';
    statusContainer.classList.remove('status-running', 'status-loading');
    statusContainer.classList.add('status-paused');
  } else if (running) {
    statusDot.style.backgroundColor = '#4caf50';
    statusDot.style.boxShadow = '0 0 8px rgba(76, 175, 80, 0.6)';
    statusText.textContent = '运行中';
    toggleBtn.textContent = '暂停';
    statusContainer.classList.remove('status-paused', 'status-loading');
    statusContainer.classList.add('status-running');
  } else {
    statusDot.style.backgroundColor = 'var(--md-sys-color-error)';
    statusDot.style.boxShadow = '0 0 8px rgba(244, 67, 54, 0.5)';
    statusText.textContent = '未运行';
    toggleBtn.textContent = '暂停';
    statusContainer.classList.remove('status-running', 'status-paused');
    statusContainer.classList.add('status-loading');
  }

  // 填入数值
  const currentBri = cachedCurrentBri || '0';
  document.getElementById('status-current-bri').textContent = currentBri;
  document.getElementById('status-sys-max-bri').textContent = cachedSysMaxBri || '—';
  document.getElementById('status-inotifyd-pid').textContent = running ? pidRes.stdout.trim() : '离线';
  document.getElementById('status-inotifyd-state').textContent = inotifydState;

  // HDR/SDR 比率
  const hdrRaw = hdrRes.errno === 0 ? hdrRes.stdout.trim() : '';
  const hdrEl = document.getElementById('status-hdr-ratio');
  if (hdrRaw && /^\d+(\.\d+)?$/.test(hdrRaw)) {
    hdrEl.textContent = parseFloat(hdrRaw).toFixed(2);
  } else {
    hdrEl.textContent = '-';
  }

  // 更新亮度滑条
  const brightnessSlider = document.getElementById('brightness-slider');
  const sysMaxBri = cachedSysMaxBri ? parseInt(cachedSysMaxBri, 10) : 255;
  brightnessSlider.max = sysMaxBri;
  const currentBriValue = parseInt(currentBri, 10) || 0;
  brightnessSlider.value = currentBriValue;
  updateSliderProgress(brightnessSlider);
  
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
  await loadStatus(true);
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
    await loadStatus(true);
    btn.disabled = false;
  }, 1000);
}

let confirmedLowBri = false;

async function handleBrightnessChange(e) {
  try {
    const newBri = parseInt(e.target.value, 10);
    const brightnessSlider = document.getElementById('brightness-slider');
    const sysMaxBri = parseInt(brightnessSlider.max, 10);
    const percentage = Math.round((newBri / sysMaxBri) * 100);
    
    // 如果试图调低到 5% 以下且未确认过
    if (percentage < 5 && !confirmedLowBri) {
       const ok = confirm("⚠️ 警告：亮度低于 5% 可能会导致屏幕近似黑屏，存在操作困难且难以自动恢复的风险。\n\n确定要继续调整到该极低亮度吗？");
       if (ok) {
         confirmedLowBri = true;
       } else {
         // 回退到 5%
         const safeVal = Math.ceil(sysMaxBri * 0.05);
         e.target.value = safeVal;
         handleBrightnessChange(e); // 重新处理
         return;
       }
    }
    
    // 如果用户又回到了 5% 以上，重置确认状态，下次再低时再提醒
    if (percentage >= 5) {
      confirmedLowBri = false;
    }

    // 立即更新 UI（不等待文件 IO）
    document.getElementById('brightness-display').textContent = percentage + '%';
    cachedCurrentBri = String(newBri);
    updateSliderProgress(brightnessSlider);
    
    // 直接写入文件，无防抖
    const cmd = `echo -n '${newBri}' > '${NOW_BRI_FILE}' 2>/dev/null && echo 'OK'`;
    const res = await runCmd(cmd);
    
    if (!(res.errno === 0 && res.stdout.includes('OK'))) {
      showToast('亮度设置失败，已恢复');
      await loadStatus(true); // 恢复旧值
    }
  } catch (error) {
    showToast('设置亮度出错: ' + error.message);
    await loadStatus(true);
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
  if (!logEl) return;

  // 读取最后 100 行日志
  const res = await runCmd(`tail -n 100 "${LOG_FILE}"`);
  if (res.errno === 0) {
    fullLogContent = res.stdout.trim() || '暂无日志';
  } else {
    fullLogContent = '无法读取日志 (可能模块尚未产生日志文件)';
  }
  await applyLogFilter();
}

let clearLogsConfirming = false;
let clearLogsTimer = null;

async function handleClearLogs() {
  const btn = document.getElementById('btn-clear-logs');
  const btnSpan = btn ? btn.querySelector('span') : null;

  if (!clearLogsConfirming) {
    clearLogsConfirming = true;
    if (btnSpan) btnSpan.textContent = '确认清空？';
    if (btn) btn.classList.add('dropdown-item-danger');
    clearLogsTimer = setTimeout(() => {
      clearLogsConfirming = false;
      if (btnSpan) btnSpan.textContent = '清空日志';
      if (btn) btn.classList.remove('dropdown-item-danger');
    }, 5000);
    return;
  }

  clearLogsConfirming = false;
  if (btnSpan) btnSpan.textContent = '清空日志';
  if (btn) btn.classList.remove('dropdown-item-danger');
  clearTimeout(clearLogsTimer);

  showToast('正在清空日志...');
  const res = await runCmd(`> "${LOG_FILE}"`);
  if (res.errno === 0) {
    fullLogContent = '';
    showToast('日志已清空');
    await loadLogs();
  } else {
    showToast('清空失败: ' + (res.stderr || '未知错误'));
  }
}

async function handleCopyLog() {
  const res = await runCmd(`tail -n 50 "${LOG_FILE}"`);
  if (res.errno !== 0 || !res.stdout.trim()) {
    showToast('暂无日志内容');
    return;
  }
  const text = res.stdout.trim();
  try {
    await navigator.clipboard.writeText(text);
    showToast('已复制最新 50 条日志');
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showToast('已复制最新 50 条日志');
  }
}

async function handleExportLog() {
  showToast('正在导出...');
  const res = await runCmd(`cp "${LOG_FILE}" "/sdcard/LuminPro_$(date '+%Y%m%d_%H%M%S').log"`);
  if (res.errno === 0) {
    showToast('日志已导出到 /sdcard');
  } else {
    showToast('导出失败: ' + (res.stderr || '未知错误'));
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
  await Promise.all([loadStatus(true), loadLogs()]);
  
  if (!autoRefresh) return;
  
  // 启动定时刷新
  autoRefreshStatusLogTimer = setTimeout(startAutoRefreshStatusLog, statusLogRefreshInterval);
  autoRefreshConfigTimer = setTimeout(startAutoRefreshConfig, configRefreshInterval);
}

// ==========================
// 初始化
// ==========================

// 底栏导航逻辑
function setupNavbar() {
  const navbar = document.querySelector('.floating-navbar');
  const navbarBtns = document.querySelectorAll('.navbar-btn');
  const sections = document.querySelectorAll('.card');
  const navbarSlider = document.querySelector('.navbar-slider');

  let isDragging = false;
  let startX = 0;
  let currentActiveBtn = null;
  let startSliderX = 0;

  // 更新滑块位置 (带平滑过渡)
  function updateSliderPosition(activeBtn, useTransition = true) {
    if (!navbarSlider || !activeBtn) return;
    
    currentActiveBtn = activeBtn;
    const sliderLeft = activeBtn.offsetLeft;
    const sliderWidth = activeBtn.offsetWidth;
    
    if (useTransition) {
      navbarSlider.style.transition = 'transform 0.3s cubic-bezier(0.25, 1, 0.5, 1), width 0.3s ease';
    } else {
      navbarSlider.style.transition = 'none';
    }
    
    navbarSlider.style.pointerEvents = 'auto';
    navbarSlider.style.zIndex = '0';
    navbarSlider.style.cursor = 'grab';
    navbarSlider.style.border = '1px solid rgba(var(--md-sys-color-primary-rgb, 168, 199, 250), 0.4)';
    navbarSlider.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.1)';
    
    navbarSlider.style.width = sliderWidth + 'px';
    navbarSlider.style.transform = `translateX(${sliderLeft}px)`;
  }

  // 根据分组显示卡片
  function showGroup(groupName) {
    sections.forEach(section => {
      const sectionGroup = section.getAttribute('data-nav-group');
      if (sectionGroup) {
        if (sectionGroup === groupName) {
           section.style.display = 'flex';
           // 触发入场动画
           section.classList.remove('card-animate-in');
           void section.offsetWidth; // 强制重绘
           section.classList.add('card-animate-in');
        } else {
           section.style.display = 'none';
           section.classList.remove('card-animate-in');
        }
      }
    });
  }

  // 设置按钮状态
  function setActiveBtn(btn) {
    navbarBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    updateSliderPosition(btn);
  }

  let hasLoadedApps = false;

  // 拖拽逻辑实现
  if (navbarSlider && navbar) {
    let isActuallyDragging = false;

    navbar.addEventListener('pointerdown', (e) => {
      // 记录起始位置
      isDragging = true;
      isActuallyDragging = false;
      startX = e.clientX;
      startSliderX = currentActiveBtn ? currentActiveBtn.offsetLeft : 0;
      
      // 长按时略微放大滑块
      navbarSlider.style.transition = 'transform 0.2s cubic-bezier(0.2, 0, 0, 1), width 0.3s ease';
      const currentX = currentActiveBtn ? currentActiveBtn.offsetLeft : 0;
      navbarSlider.style.transform = `translateX(${currentX}px) scale(1.04)`;
    });

    navbar.addEventListener('pointermove', (e) => {
      if (!isDragging) return;
      const dx = e.clientX - startX;
      
      // 开启拖拽阈值判断 (防止点击时误触拖动)
      if (!isActuallyDragging && Math.abs(dx) > 10) {
        isActuallyDragging = true;
        // 赋予轻微阻尼感
        navbarSlider.style.transition = 'transform 0.1s cubic-bezier(0.2, 0, 0, 1), width 0.3s ease';
        navbar.setPointerCapture(e.pointerId);
      }
      
      if (!isActuallyDragging) return;
      
      const targetX = startSliderX + dx;
      
      // 区域边界限制与阻尼回弹 (Rubber Banding)
      const minX = navbarBtns[0].offsetLeft;
      const maxX = navbarBtns[navbarBtns.length - 1].offsetLeft;
      
      let clampedX = targetX;
      if (targetX < minX) {
        clampedX = minX + (targetX - minX) * 0.3;
      } else if (targetX > maxX) {
        clampedX = maxX + (targetX - maxX) * 0.3;
      }
      
      navbarSlider.style.transform = `translateX(${clampedX}px) scale(1.04)`;
    });

    navbar.addEventListener('pointerup', (e) => {
      if (!isDragging) return;
      const wasDragging = isActuallyDragging;
      isDragging = false;
      isActuallyDragging = false;
      
      // 恢复正常大小
      navbarSlider.style.transition = 'transform 0.3s cubic-bezier(0.25, 1, 0.5, 1), width 0.3s ease';
      
      if (wasDragging) {
        navbar.releasePointerCapture(e.pointerId);
        
        const sliderRect = navbarSlider.getBoundingClientRect();
        const navRect = navbar.getBoundingClientRect();
        const currentX = sliderRect.left - navRect.left;
        
        let closestBtn = navbarBtns[0];
        let minDist = Infinity;
        
        navbarBtns.forEach(btn => {
          const dist = Math.abs(btn.offsetLeft - currentX);
          if (dist < minDist) {
            minDist = dist;
            closestBtn = btn;
          }
        });
        
        closestBtn.click();
      } else if (currentActiveBtn) {
        // 如果没拖动，点击后滑块也会通过 setActiveBtn 正常回缩
        updateSliderPosition(currentActiveBtn);
      }
    });
  }

  // 为每个按钮添加点击监听
  navbarBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const groupName = btn.getAttribute('data-section');
      showGroup(groupName);
      setActiveBtn(btn);
      
      if (groupName === 'apps' && !hasLoadedApps) {
        hasLoadedApps = true;
        if (typeof loadApps === 'function') {
          loadApps();
        }
      }
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

let showingSystemApps = true;
let savedBlacklist = new Set();
let activityEntries = new Set(); // 活动级黑名单条目（格式：pkg/ActivityClass）

function updateUnsavedStyling() {
  const items = document.querySelectorAll('.app-list-item');
  items.forEach(item => {
    const cb = item.querySelector('.app-checkbox');
    const custom = item.querySelector('.app-checkbox-custom');
    if (!cb || !custom) return;
    const pkg = cb.dataset.pkg;
    const hasActivities = pkg && [...activityEntries].some(e => e.startsWith(pkg + '/'));
    // 部分选中：有活动条目但包名未完全选中
    if (!cb.checked && hasActivities) {
      custom.classList.add('partial');
    } else {
      custom.classList.remove('partial');
    }
    // 未保存高亮
    if (cb.checked && !savedBlacklist.has(pkg)) {
      cb.classList.add('unsaved');
    } else {
      cb.classList.remove('unsaved');
    }
    // 箭头可见性
    const chevron = item.querySelector('.app-activities-chevron');
    if (chevron) {
      chevron.style.display = hasActivities ? '' : 'none';
      if (!hasActivities) {
        const actList = item.querySelector('.app-activities-list');
        if (actList) { actList.classList.remove('show'); chevron.classList.remove('expanded'); }
      }
    }
  });
}

function reorderDOMApps() {
  const container = document.getElementById('app-list-container');
  if (!container) return;
  const items = Array.from(container.children);
  const getState = (item) => {
    const cb = item.querySelector('.app-checkbox');
    if (cb?.checked) return 2; // 完全选中
    const pkg = cb?.dataset.pkg;
    if (pkg && [...activityEntries].some(e => e.startsWith(pkg + '/'))) return 1; // 部分选中
    return 0;
  };
  items.sort((a, b) => getState(b) - getState(a));
  items.forEach(item => container.appendChild(item));
}

function renderActivityList(pkg, container) {
  const entries = [...activityEntries].filter(e => e.startsWith(pkg + '/'));
  container.innerHTML = '';
  entries.forEach(entry => {
    const entryDiv = document.createElement('div');
    entryDiv.className = 'activity-entry-item';
    const actPath = document.createElement('span');
    actPath.className = 'activity-entry-path';
    actPath.textContent = entry.slice(pkg.length + 1);
    const delBtn = document.createElement('button');
    delBtn.className = 'activity-entry-delete';
    delBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      activityEntries.delete(entry);
      renderActivityList(pkg, container);
      const actItem = container.closest('.app-list-item');
      if (actItem) {
        const chevron = actItem.querySelector('.app-activities-chevron');
        const remaining = [...activityEntries].filter(e => e.startsWith(pkg + '/'));
        if (chevron) chevron.style.display = remaining.length > 0 ? '' : 'none';
        if (remaining.length === 0) { container.classList.remove('show'); if (chevron) chevron.classList.remove('expanded'); }
      }
      updateUnsavedStyling();
      reorderDOMApps();
    });
    entryDiv.appendChild(actPath);
    entryDiv.appendChild(delBtn);
    container.appendChild(entryDiv);
  });
}

async function loadApps() {
  const container = document.getElementById('app-list-container');
  if (!container) return;
  container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--md-sys-color-on-surface-variant);">加载中...</div>';
  
  try {
    // 读取已保存的黑名单（包名条目 + 活动条目分开存储）
    const blRes = await runCmd(`cat "${CONFIG_DIR}/blacklist_apps.txt"`);
    const allSaved = blRes.errno === 0 ? blRes.stdout.trim().split('\n').filter(Boolean) : [];
    savedBlacklist = new Set(allSaved);
    const savedPkgEntries = new Set(allSaved.filter(e => !e.includes('/')));
    activityEntries = new Set(allSaved.filter(e => e.includes('/')));

    let infoList = [];
    try {
      const pkgs = await listPackages();
      if (pkgs && pkgs.length > 0) {
        infoList = await getPackagesInfo(pkgs);
      } else {
        throw new Error('No packages found');
      }
    } catch (_) {
      // 模拟 150 个应用包数据用于调试
      console.log("[DEBUG] 使用模拟应用列表数据");
      infoList = Array.from({ length: 150 }, (_, i) => ({
        packageName: `com.mock.app${i}`,
        appLabel: i % 10 === 0 ? `测试应用 ${i} (含抖音关键字)` : `模拟应用 ${i}`,
        isSystem: i % 5 === 0,
        uid: 10000 + i
      }));
    }
    
    // 过滤对应示例展示的系统应用状态
    if (!showingSystemApps) {
      infoList = infoList.filter(app => !app.isSystem);
    }

    container.innerHTML = '';
    
    // 排序：默认按是否包含系统应用及名称
    infoList.sort((a, b) => {
      if (a.isSystem !== b.isSystem) return a.isSystem ? 1 : -1;
      return (a.appLabel || "").localeCompare(b.appLabel || "");
    });

    if (infoList.length === 0) {
      // 在无数据时展示一些示例数据，方便在 PC/浏览器中预览样式
      infoList.push(
        { packageName: "com.example.app1", appLabel: "示例 1", isSystem: false, uid: 10123 },
        { packageName: "com.example.app2", appLabel: "示例 2", isSystem: false, uid: 10124 },
        { packageName: "com.example.sys1", appLabel: "系统示例 1", isSystem: true, uid: 1000 },
        { packageName: "com.example.sys2", appLabel: "系统示例 2", isSystem: true, uid: 1001 }
      );
      
      // 过滤对应示例展示的系统应用状态
      if (!showingSystemApps) {
        infoList = infoList.filter(app => !app.isSystem);
      }
    }

    // 根据 uid 去重处理
    const seenUids = new Set();
    infoList = infoList.filter(app => {
      if (app.uid === undefined || app.uid === null) return true;
      if (seenUids.has(app.uid)) return false;
      seenUids.add(app.uid);
      return true;
    });

    infoList.forEach(app => {
      const item = document.createElement('div');
      item.className = 'app-list-item';
      
      const checkboxLabel = document.createElement('label');
      checkboxLabel.className = 'app-checkbox-label';
      
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'app-checkbox';
      checkbox.dataset.pkg = app.packageName;
      
      // 依据已保存包名条目勾选（不含活动条目）
      checkbox.checked = savedPkgEntries.has(app.packageName);
      checkbox.addEventListener('change', () => {
        updateUnsavedStyling();
        reorderDOMApps();
      });

      const customCheckbox = document.createElement('span');
      customCheckbox.className = 'app-checkbox-custom';
      checkboxLabel.appendChild(checkbox);
      checkboxLabel.appendChild(customCheckbox);

      const infoDiv = document.createElement('div');
      infoDiv.className = 'app-info';
      
      const nameSpan = document.createElement('span');
      nameSpan.className = 'app-name';
      
      const nameNode = document.createTextNode(app.appLabel || 'Unknown');
      nameSpan.appendChild(nameNode);
      
      if (app.uid !== undefined) {
         const uidBadge = document.createElement('span');
         uidBadge.className = 'app-uid';
         uidBadge.textContent = String(app.uid);
         nameSpan.appendChild(uidBadge);
      }
      
      const pkgSpan = document.createElement('span');
      pkgSpan.className = 'app-pkg';
      pkgSpan.textContent = app.packageName || '';
      
      if (app.isSystem) {
         const sysBadge = document.createElement('span');
         sysBadge.className = 'app-badge';
         sysBadge.textContent = '系统';
         pkgSpan.appendChild(sysBadge);
      }
      
      infoDiv.appendChild(nameSpan);
      infoDiv.appendChild(pkgSpan);

      // 活动展开箭头
      const chevronBtn = document.createElement('button');
      chevronBtn.className = 'app-activities-chevron';
      chevronBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
      const pkgActivities = [...activityEntries].filter(e => e.startsWith(app.packageName + '/'));
      chevronBtn.style.display = pkgActivities.length > 0 ? '' : 'none';

      const mainRow = document.createElement('div');
      mainRow.className = 'app-item-main-row';
      mainRow.appendChild(checkboxLabel);
      mainRow.appendChild(infoDiv);
      mainRow.appendChild(chevronBtn);

      // 活动列表（初始折叠）
      const actListDiv = document.createElement('div');
      actListDiv.className = 'app-activities-list';
      actListDiv.dataset.pkg = app.packageName;
      renderActivityList(app.packageName, actListDiv);

      chevronBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        actListDiv.classList.toggle('show');
        chevronBtn.classList.toggle('expanded');
      });

      item.appendChild(mainRow);
      item.appendChild(actListDiv);
      container.appendChild(item);
    });

    // 渲染完毕后初始展示排版与状态
    updateUnsavedStyling();
    reorderDOMApps();
    
    // 更新数量统计
    const badge = document.getElementById('app-count-badge');
    if (badge) badge.textContent = infoList.length;
    
    if (infoList.length === 0) {
      container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--md-sys-color-on-surface-variant);">无应用</div>';
    }
  } catch (e) {
    container.innerHTML = `<div style="text-align:center;padding:20px;color:var(--md-sys-color-error);">加载失败: ${e.message || String(e)}</div>`;
  }
}

async function init() {
  // 优先应用保存在本地的缩放设置，避免初次加载时闪动
  try {
    const savedUIZoom = localStorage.getItem('uiZoom');
    if (savedUIZoom) {
      const z = parseInt(savedUIZoom, 10);
      if (!isNaN(z)) {
        uiZoom = Math.min(150, Math.max(50, z));
        applyUIZoom(uiZoom);
      }
    }
  } catch(e) {}

  // 初始化 Lucide 图标
  createIcons({
    icons: {
      Sun,
      Settings,
      Settings2,
      Save,
      Activity,
      RefreshCw,
      FileText,
      Smartphone,
      MoreVertical,
      Eye,
      EyeOff,
      CheckSquare,
      CheckCheck,
      Square,
      Search,
      Sparkles,
      Plus,
      ShieldCheck,
      Moon,
      Play,
      RotateCcw,
      Monitor,
      Info,
      Code, User, BookOpen, X, Globe, Minus
    }
  });

  // 初始化底栏导航
  setupNavbar();

  // 绑定事件
  document.getElementById('btn-refresh-status').addEventListener('click', async () => {
    showToast('刷新状态...');
    await loadStatus(true);
  });
  document.getElementById('btn-save').addEventListener('click', saveConfig);
  document.getElementById('btn-save-advanced').addEventListener('click', saveAdvancedConfig);
  document.getElementById('btn-save-webui-config').addEventListener('click', saveWebUIConfig);
  document.getElementById('input-auto-refresh').addEventListener('change', (e) => {
    document.getElementById('item-status-refresh-interval').style.display = e.target.checked ? '' : 'none';
  });
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
  const btnLogMenu = document.getElementById('btn-log-menu');
  const logDropdownMenu = document.getElementById('log-dropdown-menu');
  const btnCopyLog = document.getElementById('btn-copy-log');
  const btnExportLog = document.getElementById('btn-export-log');

  if (logLevelFilter) {
    logLevelFilter.addEventListener('change', async () => {
      await applyLogFilter();
    });
  }

  if (btnLogMenu && logDropdownMenu) {
    btnLogMenu.addEventListener('click', (e) => {
      e.stopPropagation();
      logDropdownMenu.classList.toggle('show');
    });
    document.addEventListener('click', (e) => {
      if (!btnLogMenu.contains(e.target) && !logDropdownMenu.contains(e.target)) {
        logDropdownMenu.classList.remove('show');
      }
    });
  }

  if (btnClearLogs) {
    btnClearLogs.addEventListener('click', (e) => {
      e.stopPropagation();
      handleClearLogs();
    });
  }

  if (btnCopyLog) {
    btnCopyLog.addEventListener('click', () => {
      logDropdownMenu && logDropdownMenu.classList.remove('show');
      handleCopyLog();
    });
  }

  if (btnExportLog) {
    btnExportLog.addEventListener('click', () => {
      logDropdownMenu && logDropdownMenu.classList.remove('show');
      handleExportLog();
    });
  }

  // 绑定查看支持事件按钮
  const btnInotifyHelp = document.getElementById('btn-view-inotifyd-help');
  if (btnInotifyHelp) {
    btnInotifyHelp.addEventListener('click', async () => {
      showToast('获取中...');
      const res = await runCmd('inotifyd --help');
      const output = (res.stderr || '') + (res.stdout || '');
      if (output) {
        alert(output.trim());
      } else {
        alert('无法获取该命令的帮助信息。');
      }
    });
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

  // Textarea 自适应高度
  document.querySelectorAll('.config-textarea').forEach(textarea => {
    const autoResize = () => {
      textarea.style.height = 'auto';
      textarea.style.height = Math.min(textarea.scrollHeight, 300) + 'px';
    };
    textarea.addEventListener('input', autoResize);
    textarea.addEventListener('change', autoResize);
    // 初始加载时调整高度
    setTimeout(autoResize, 0);
  });

  // 应用列表-下拉菜单控制
  const btnAppsMenu = document.getElementById('btn-apps-menu');
  const appsDropdownMenu = document.getElementById('apps-dropdown-menu');
  
  if (btnAppsMenu && appsDropdownMenu) {
    btnAppsMenu.addEventListener('click', (e) => {
      e.stopPropagation();
      appsDropdownMenu.classList.toggle('show');
    });
    
    // 点击外部隐藏菜单
    document.addEventListener('click', (e) => {
      if (!btnAppsMenu.contains(e.target) && !appsDropdownMenu.contains(e.target)) {
         appsDropdownMenu.classList.remove('show');
      }
    });
  }

  // 绑定应用列表控制事件
  const btnToggleSysApps = document.getElementById('btn-toggle-sys-apps');
  if (btnToggleSysApps) {
    btnToggleSysApps.addEventListener('click', () => {
      showingSystemApps = !showingSystemApps;
      
      const textSpan = document.getElementById('sys-apps-text');
      const iconWrap = document.getElementById('sys-apps-icon');
      
      if (textSpan) textSpan.textContent = showingSystemApps ? '隐藏系统应用' : '显示系统应用';
      
      // 更新 Lucide 图标
      if (iconWrap) {
        //重新创建图标
        const p = iconWrap.parentNode;
        const newIcon = document.createElement('i');
        newIcon.setAttribute('data-lucide', showingSystemApps ? 'eye-off' : 'eye');
        newIcon.id = 'sys-apps-icon';
        p.replaceChild(newIcon, iconWrap);
        createIcons({
          icons: {
             Eye,
             EyeOff
          },
          nameAttr: 'data-lucide'
        });
      }
      
      loadApps();
      appsDropdownMenu.classList.remove('show');
    });
  }

  // 智能选择功能
  const btnSmartSelect = document.getElementById('btn-smart-select');
  if (btnSmartSelect) {
    const smartKeywords = ["相册", "抖音", "快手", "视频", "哔哩哔哩", "bili", "pili", "netflix", "youtube", "tiktok", "x"];
    btnSmartSelect.addEventListener('click', () => {
      const items = document.querySelectorAll('.app-list-item');
      items.forEach(item => {
        const name = item.querySelector('.app-name').textContent.toLowerCase();
        const checkbox = item.querySelector('.app-checkbox');
        
        let match = false;
        for (const kw of smartKeywords) {
          // 对 x 采用更严格的匹配以防误伤字母 x 结尾的应用
          if (kw === 'x') {
            if (name === 'x' || name === 'x (twitter)') {
              match = true;
              break;
            }
          } else if (name.includes(kw)) {
             match = true;
             break;
          }
        }
        
        if (match) {
          checkbox.checked = true;
        }
      });
      updateUnsavedStyling();
      reorderDOMApps();
      appsDropdownMenu.classList.remove('show');
    });
  }

  // 手动添加包名功能
  const btnManualAdd = document.getElementById('btn-manual-add');
  if (btnManualAdd) {
    btnManualAdd.addEventListener('click', async () => {
      appsDropdownMenu.classList.remove('show');
      const pkg = prompt('请输入你要彻底屏蔽的完整应用包名（例如: com.example.app）：');
      if (!pkg || !pkg.trim()) return;
      
      const realPkg = pkg.trim();
      const existing = document.querySelector(`.app-checkbox[data-pkg="${realPkg}"]`);
      if (existing) {
         existing.checked = true;
         updateUnsavedStyling();
         reorderDOMApps();
         showToast('该应用已在列表中，已为你自动勾选并置顶');
         return;
      }
      
      showToast('正在尝试获取应用信息...');
      let appData = { packageName: realPkg, appLabel: '未知 (手动添加)', isSystem: false, uid: '自定义' };
      try {
        const info = await getPackagesInfo([realPkg]);
        if (info && info.length > 0) {
           appData = info[0];
        }
      } catch {
        // failed to fetch, use default
      }
      
      const container = document.getElementById('app-list-container');
      const item = document.createElement('div');
      item.className = 'app-list-item';

      const checkboxLabel = document.createElement('label');
      checkboxLabel.className = 'app-checkbox-label';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'app-checkbox';
      checkbox.dataset.pkg = realPkg;
      checkbox.checked = true;
      checkbox.addEventListener('change', () => { updateUnsavedStyling(); reorderDOMApps(); });

      const customCheckbox = document.createElement('span');
      customCheckbox.className = 'app-checkbox-custom';
      checkboxLabel.appendChild(checkbox);
      checkboxLabel.appendChild(customCheckbox);

      const infoDiv = document.createElement('div');
      infoDiv.className = 'app-info';

      const nameSpan = document.createElement('span');
      nameSpan.className = 'app-name';
      nameSpan.appendChild(document.createTextNode(appData.appLabel || 'Unknown'));

      if (appData.uid !== undefined) {
         const uidBadge = document.createElement('span');
         uidBadge.className = 'app-uid';
         uidBadge.textContent = String(appData.uid);
         nameSpan.appendChild(uidBadge);
      }

      const pkgSpan = document.createElement('span');
      pkgSpan.className = 'app-pkg';
      pkgSpan.textContent = realPkg;

      if (appData.isSystem) {
         const sysBadge = document.createElement('span');
         sysBadge.className = 'app-badge';
         sysBadge.textContent = '系统';
         pkgSpan.appendChild(sysBadge);
      }

      infoDiv.appendChild(nameSpan);
      infoDiv.appendChild(pkgSpan);

      const chevronBtn = document.createElement('button');
      chevronBtn.className = 'app-activities-chevron';
      chevronBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
      chevronBtn.style.display = 'none';

      const mainRow = document.createElement('div');
      mainRow.className = 'app-item-main-row';
      mainRow.appendChild(checkboxLabel);
      mainRow.appendChild(infoDiv);
      mainRow.appendChild(chevronBtn);

      const actListDiv = document.createElement('div');
      actListDiv.className = 'app-activities-list';
      actListDiv.dataset.pkg = realPkg;

      chevronBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        actListDiv.classList.toggle('show');
        chevronBtn.classList.toggle('expanded');
      });

      item.appendChild(mainRow);
      item.appendChild(actListDiv);
      container.appendChild(item);

      updateUnsavedStyling();
      reorderDOMApps();
      showToast('已成功添加并勾选');
    });
  }

  // 全选功能
  const btnSelectAll = document.getElementById('btn-select-all');
  if (btnSelectAll) {
    btnSelectAll.addEventListener('click', () => {
      const checkboxes = document.querySelectorAll('.app-checkbox');
      checkboxes.forEach(cb => {
        cb.checked = true;
      });
      updateUnsavedStyling();
      appsDropdownMenu.classList.remove('show');
    });
  }

  // 全不选功能
  const btnSelectNone = document.getElementById('btn-select-none');
  if (btnSelectNone) {
    btnSelectNone.addEventListener('click', () => {
      const checkboxes = document.querySelectorAll('.app-checkbox');
      checkboxes.forEach(cb => {
        cb.checked = false;
      });
      updateUnsavedStyling();
      appsDropdownMenu.classList.remove('show');
    });
  }

  // 反选功能
  const btnInvertSelection = document.getElementById('btn-invert-selection');
  if (btnInvertSelection) {
    btnInvertSelection.addEventListener('click', () => {
      const checkboxes = document.querySelectorAll('.app-checkbox');
      checkboxes.forEach(cb => {
        cb.checked = !cb.checked;
      });
      updateUnsavedStyling();
      appsDropdownMenu.classList.remove('show');
    });
  }

  // 刷新按钮 (重排应用，不保存)
  const btnAppsRefresh = document.getElementById('btn-apps-refresh');
  if (btnAppsRefresh) {
    btnAppsRefresh.addEventListener('click', () => {
      reorderDOMApps();
    });
  }

  // 保存黑名单
  const btnSaveBlacklist = document.getElementById('btn-save-blacklist');
  if (btnSaveBlacklist) {
    btnSaveBlacklist.addEventListener('click', async () => {
      showToast('保存中...');
      const checkboxes = document.querySelectorAll('.app-checkbox');
      const selectedPkgs = [];
      checkboxes.forEach(cb => { if (cb.checked) selectedPkgs.push(cb.dataset.pkg); });
      // 合并包名条目 + 活动条目
      const allEntries = [...selectedPkgs, ...activityEntries];
      const content = allEntries.join('\n');
      const res = await writeFile(`${CONFIG_DIR}/blacklist_apps.txt`, content);
      if (res.errno === 0 || res.stdout.includes('OK')) {
        showToast('黑名单保存成功');
        savedBlacklist = new Set(allEntries);
        updateUnsavedStyling();
        reorderDOMApps();
      } else {
        showToast('保存失败: ' + res.stderr);
      }
    });
  }

  // 按活动屏蔽
  const btnAddActivity = document.getElementById('btn-add-activity');
  const inputActivityEntry = document.getElementById('input-activity-entry');
  if (btnAddActivity && inputActivityEntry) {
    const doAddActivity = () => {
      const val = inputActivityEntry.value.trim();
      if (!val) return;
      const parts = val.split('/');
      if (parts.length !== 2 || !parts[0] || !parts[1]) {
        showToast('格式错误，请输入 包名/完整活动类名');
        return;
      }
      activityEntries.add(val);
      inputActivityEntry.value = '';
      const pkg = parts[0];
      document.querySelectorAll('.app-list-item').forEach(appItem => {
        const cb = appItem.querySelector('.app-checkbox');
        if (cb && cb.dataset.pkg === pkg) {
          const actList = appItem.querySelector('.app-activities-list');
          const chevron = appItem.querySelector('.app-activities-chevron');
          if (actList) { renderActivityList(pkg, actList); actList.classList.add('show'); }
          if (chevron) { chevron.style.display = ''; chevron.classList.add('expanded'); }
        }
      });
      updateUnsavedStyling();
      reorderDOMApps();
      showToast(`已添加: ${val}`);
    };
    btnAddActivity.addEventListener('click', doAddActivity);
    inputActivityEntry.addEventListener('keydown', (e) => { if (e.key === 'Enter') doAddActivity(); });
  }

  // 搜索功能
  const inputAppSearch = document.getElementById('input-app-search');
  if (inputAppSearch) {
    inputAppSearch.addEventListener('input', (e) => {
      const keyword = e.target.value.trim().toLowerCase();
      const items = document.querySelectorAll('.app-list-item');
      let visibleCount = 0;
      
      items.forEach(item => {
        const name = item.querySelector('.app-name').textContent;
        const pkg = item.querySelector('.app-pkg').textContent.toLowerCase();
        
        if (!keyword || pkg.includes(keyword) || PinyinMatch.match(name, keyword)) {
          item.style.display = 'flex';
          visibleCount++;
        } else {
          item.style.display = 'none';
        }
      });
      
      const badge = document.getElementById('app-count-badge');
      if (badge) badge.textContent = visibleCount;
    });
  }

  // 全局拦截链接点击，调用系统浏览器
  document.addEventListener('click', async (e) => {
    const link = e.target.closest('a');
    if (link && link.getAttribute('href')) {
      const url = link.getAttribute('href');
      // 只拦截外部网页链接
      if (url.startsWith('http')) {
        e.preventDefault();
        try {
          await runCmd(`am start -a android.intent.action.VIEW -d "${url}"`);
        } catch (error) {
          console.error('Failed to open link:', error);
          // 降级原样打开
          window.location.href = url;
        }
      }
    }
  });

  // 文档抽屉面板逻辑
  const md = new MarkdownIt({
    html: true,
    linkify: true,
    typographer: true
  });

  const docDrawer = document.getElementById('doc-drawer');
  const docBackdrop = document.getElementById('doc-drawer-backdrop');
  const btnCloseDrawer = document.getElementById('btn-close-drawer');
  const drawerTitle = document.getElementById('drawer-title');
  const drawerContent = document.getElementById('drawer-content');

  // 绑定文档列表项点击
  const docItems = document.querySelectorAll('.about-doc-item');
  docItems.forEach(item => {
    item.addEventListener('click', () => {
       const fileName = item.dataset.doc;
       const label = item.querySelector('span').textContent;
       if (drawerTitle) drawerTitle.textContent = label;
       openDrawer(fileName);
    });
  });

  if (btnCloseDrawer) {
    btnCloseDrawer.addEventListener('click', closeDrawer);
  }

  if (docBackdrop) {
    docBackdrop.addEventListener('click', closeDrawer);
  }

  function openDrawer(fileName) {
    if (!docDrawer) return;
    docDrawer.classList.add('show');
    if (docBackdrop) docBackdrop.classList.add('show');
    document.body.style.overflow = 'hidden'; // 禁止底层滚动
    loadDoc(fileName);
  }

  function closeDrawer() {
    if (!docDrawer) return;
    docDrawer.classList.remove('show');
    if (docBackdrop) docBackdrop.classList.remove('show');
    document.body.style.overflow = '';
  }

  async function loadDoc(fileName) {
    if (!drawerContent) return;
    drawerContent.innerHTML = '<div class="doc-loading">正在载入文档...</div>';
    
    try {
      const filePath = `/data/adb/modules/LuminPro/${fileName}`;
      const res = await runCmd(`cat "${filePath}"`);
      
      if (res.errno === 0) {
        let content = res.stdout;
        if (fileName.endsWith('.md')) {
           drawerContent.innerHTML = `<div class="markdown-body">${md.render(content)}</div>`;
        } else {
           drawerContent.innerHTML = `<pre style="font-family: inherit; white-space: pre-wrap; font-size: 0.8125rem; line-height: 1.6;">${content}</pre>`;
        }
        drawerContent.scrollTop = 0;
      } else {
        drawerContent.innerHTML = `<div class="doc-loading" style="color:var(--md-sys-color-error);">无法读取文件: ${fileName} <br/> (可能模块未安装在默认路径)</div>`;
      }
    } catch (e) {
      drawerContent.innerHTML = `<div class="doc-loading" style="color:var(--md-sys-color-error);">解析出错: ${e.message}</div>`;
    }
  }

  // 初始化导航
  setupNavbar();
  
  // 按照优先级顺序加载
  try {
    // 1. 先尝试快速刷新一下状态卡片
    await loadStatus(true);
    // 2. 然后加载配置详情
    await loadConfig();
    // 3. 最后读日志
    await loadLogs();
  } catch (e) {
    console.error('Core loading failed:', e);
  }

  // 开启自动刷新定时器
  startAutoRefresh();
  
  // 页面滚动监听：动态显示顶部模糊
  window.addEventListener('scroll', () => {
    const topBlur = document.querySelector('.top-blur');
    if (topBlur) {
      if (window.scrollY > 10) {
        topBlur.classList.add('scrolled');
      } else {
        topBlur.classList.remove('scrolled');
      }
    }
  }, { passive: true });
}

// DOM 加载完成后运行
document.addEventListener('DOMContentLoaded', init);
