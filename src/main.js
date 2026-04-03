import { exec } from 'kernelsu';
import { createIcons, Sun, Settings, Save, Activity, RefreshCw, FileText } from 'lucide';

// ==========================
// 调试与配置区
// ==========================
// 在电脑端浏览器调试时设置为 true，会使用虚拟数据
const IS_DEBUG = !window.navigator.userAgent.includes('KernelSU');

const CONFIG_DIR = '/data/adb/modules/LuminPro/config';
const PID_FILE = '/data/adb/modules/LuminPro/pid/inotifyd.pid';
const FLAG_FILE = '/data/adb/modules/LuminPro/pid/up.flag';
const LOG_FILE = '/data/adb/modules/LuminPro/service.log';
const NOW_BRI_FILE = '/sys/class/backlight/panel0-backlight/brightness';
const SYS_MAX_BRI_FILE = '/sys/class/backlight/panel0-backlight/max_brightness';

// ==========================
// 虚拟数据 (Debug Mode)
// ==========================
const mockData = {
  ui_max_bri: '3515',
  max_bri: '4094',
  sleep_time: '1900-0600',
  current_bri: '2000',
  sys_max_bri: '4094',
  inotifyd_pid: '12345',
  logs: '[25 10:00:00.000] [service] LuminPro 已启动\n[25 10:00:00.050] [service.up] 亮度被调整...\n'
};

// ==========================
// 工具函数
// ==========================
function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3000);
}

// 封装的 exec，按需返回真实执行结果或虚拟数据
async function runCmd(cmd) {
  if (IS_DEBUG) {
    console.log(`[Mock CMD Exec]: ${cmd}`);
    // 简单的命令模拟
    if (cmd.includes('ui_max_bri.txt')) return { errno: 0, stdout: mockData.ui_max_bri, stderr: '' };
    if (cmd.includes('config/max_bri.txt')) return { errno: 0, stdout: mockData.max_bri, stderr: '' };
    if (cmd.includes('sleep_time.txt')) return { errno: 0, stdout: mockData.sleep_time, stderr: '' };
    if (cmd.includes(NOW_BRI_FILE)) return { errno: 0, stdout: mockData.current_bri, stderr: '' };
    if (cmd.includes(SYS_MAX_BRI_FILE)) return { errno: 0, stdout: mockData.sys_max_bri, stderr: '' };
    if (cmd.includes('cat ' + PID_FILE)) return { errno: 0, stdout: mockData.inotifyd_pid, stderr: '' };
    if (cmd.includes('tail -n')) return { errno: 0, stdout: mockData.logs, stderr: '' };
    if (cmd.includes('kill')) return { errno: 0, stdout: '', stderr: '' };
    if (cmd.includes('ehco -n')) return { errno: 0, stdout: '', stderr: '' };
    return { errno: 0, stdout: '', stderr: '' };
  } else {
    try {
      const res = await exec(cmd);
      return res;
    } catch (e) {
      console.error(e);
      return { errno: -1, stdout: '', stderr: String(e) };
    }
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
  const [uiRes, maxRes, sleepRes] = await Promise.all([
    runCmd(`cat "${CONFIG_DIR}/ui_max_bri.txt"`),
    runCmd(`cat "${CONFIG_DIR}/max_bri.txt"`),
    runCmd(`cat "${CONFIG_DIR}/sleep_time.txt"`)
  ]);

  if (uiRes.errno === 0) document.getElementById('input-ui-max-bri').value = uiRes.stdout.trim();
  if (maxRes.errno === 0) document.getElementById('input-max-bri').value = maxRes.stdout.trim();
  if (sleepRes.errno === 0) document.getElementById('input-sleep-time').value = sleepRes.stdout.trim();
}

// 2. 保存配置并重启服务
async function saveConfig() {
  const uiMax = document.getElementById('input-ui-max-bri').value;
  const maxBri = document.getElementById('input-max-bri').value;
  const sleepTime = document.getElementById('input-sleep-time').value;

  if (!uiMax || !maxBri) {
    showToast('亮度值不能为空');
    return;
  }

  showToast('保存中...');
  
  // 保存到文件 (若不存在则可能失败，前提是模块已经建立 config 目录)
  await writeFile(`${CONFIG_DIR}/ui_max_bri.txt`, uiMax);
  await writeFile(`${CONFIG_DIR}/max_bri.txt`, maxBri);
  await writeFile(`${CONFIG_DIR}/sleep_time.txt`, sleepTime);

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
  const sleepInput = document.getElementById('input-sleep-time').value;
  let isSleep = false;
  if(sleepInput && sleepInput.includes('-')) {
     const [start, end] = sleepInput.split('-');
     const d = new Date();
     const now = d.getHours() * 100 + d.getMinutes();
     const s = parseInt(start, 10);
     const e = parseInt(end, 10);
     if (s > e) {
        if(now >= s || now < e) isSleep = true;
     } else if (s < e) {
        if(now >= s && now < e) isSleep = true;
     }
  }
  document.getElementById('status-sleep').textContent = isSleep ? '休眠中' : '非休眠';
}

// 4. 加载日志
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
  if (!IS_DEBUG) {
    // 启用全屏或者沉浸式如果需要
    // enableInsets(true); // 开启内边距适配
  }

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
  document.getElementById('btn-refresh-status').addEventListener('click', loadStatus);
  document.getElementById('btn-refresh-log').addEventListener('click', loadLogs);

  // 初次加载数据
  await loadConfig();
  await loadStatus();
  await loadLogs();
}

// DOM 加载完成后运行
document.addEventListener('DOMContentLoaded', init);
