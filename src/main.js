import { exec } from 'kernelsu';
import { createIcons, Sun, Settings, Save, Activity, RefreshCw, FileText } from 'lucide';

const CONFIG_DIR = '/data/adb/modules/LuminPro/config';
const BACKUP_DIR = '/data/adb/modules/LuminPro/config/.backup';
const PID_FILE = '/data/adb/modules/LuminPro/pid/inotifyd.pid';
const FLAG_FILE = '/data/adb/modules/LuminPro/pid/up.flag';
const LOG_FILE = '/data/adb/modules/LuminPro/service.log';
const NOW_BRI_FILE = '/sys/class/backlight/panel0-backlight/brightness';
const SYS_MAX_BRI_FILE = '/sys/class/backlight/panel0-backlight/max_brightness';

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
  const [curRes, sysRes, pidRes] = await Promise.all([
    runCmd(`cat "${NOW_BRI_FILE}"`),
    runCmd(`cat "${SYS_MAX_BRI_FILE}"`),
    runCmd(`cat "${PID_FILE}"`)
  ]);

  document.getElementById('status-current-bri').textContent = curRes.errno === 0 ? curRes.stdout.trim() : 'N/A';
  document.getElementById('status-sys-max-bri').textContent = sysRes.errno === 0 ? sysRes.stdout.trim() : 'N/A';
  
  const pid = pidRes.errno === 0 ? pidRes.stdout.trim() : '';
  const pidEl = document.getElementById('status-inotifyd-pid');
  const dotEl = document.querySelector('.status-dot');
  const statusText = document.querySelector('.status-text');

  if (pid) {
    pidEl.textContent = pid;
    dotEl.style.backgroundColor = '#4caf50'; // 绿色
    statusText.textContent = '运行中';
  } else {
    pidEl.textContent = '未运行';
    dotEl.style.backgroundColor = 'var(--md-sys-color-error)';
    statusText.textContent = '已停止';
  }

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

// 5. 重启服务
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
async function loadLogs() {
  const logEl = document.getElementById('log-output');
  // 读取最后 50 行日志
  const res = await runCmd(`tail -n 50 "${LOG_FILE}"`);
  if (res.errno === 0 && res.stdout) {
    logEl.textContent = res.stdout;
  } else {
    logEl.textContent = '暂无日志或读取失败';
  }
  // 滚动到底部
  logEl.scrollTop = logEl.scrollHeight;
}

// ==========================
// 初始化
// ==========================
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

  // 绑定事件
  document.getElementById('btn-save').addEventListener('click', saveConfig);
  document.getElementById('btn-reset').addEventListener('click', handleReset);
  document.getElementById('btn-restart-service').addEventListener('click', restartService);
  document.getElementById('btn-refresh-status').addEventListener('click', loadStatus);
  document.getElementById('btn-refresh-log').addEventListener('click', loadLogs);

  // 定时休眠折叠逻辑
  document.getElementById('input-sleep-mode').addEventListener('change', (e) => {
    const expandArea = document.getElementById('sleep-time-expand');
    if (e.target.checked) {
      expandArea.classList.add('show');
    } else {
      expandArea.classList.remove('show');
    }
  });

  // 初次加载数据
  await loadConfig();
  await loadStatus();
  await loadLogs();
}

// DOM 加载完成后运行
document.addEventListener('DOMContentLoaded', init);
