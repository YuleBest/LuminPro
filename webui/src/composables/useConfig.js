import { ref } from 'vue';
import {
  runCmd, writeFile,
  CONFIG_DIR, PATH_CONFIG_DIR, BACKUP_DIR, PID_FILE, FLAG_FILE,
  DEFAULT_NOW_BRI_FILE, DEFAULT_SYS_MAX_BRI_FILE,
} from '../utils.js';

export function useConfig() {
  // 亮度配置
  const uiMaxBri = ref('');
  const maxBri = ref('');
  const stepsNum = ref('50');
  const logMaxSize = ref('500');

  // 执行策略
  const autoBriSleep = ref(false);
  const displayHdrSleep = ref(false);
  const sleepMode = ref(false);
  const sleepStartH = ref('19');
  const sleepStartM = ref('00');
  const sleepEndH = ref('06');
  const sleepEndM = ref('00');

  // 高级设置
  const nowBriFile = ref(DEFAULT_NOW_BRI_FILE);
  const sysMaxBriFile = ref(DEFAULT_SYS_MAX_BRI_FILE);
  const inotifyEvents = ref('c');

  // Web UI 配置 (localStorage 持久化)
  const autoRefresh = ref(localStorage.getItem('autoRefresh') !== 'false');
  const statusRefreshInterval = ref(
    Math.max(100, parseInt(localStorage.getItem('statusLogRefreshInterval') || '1000', 10))
  );
  const uiZoom = ref(
    Math.min(150, Math.max(50, parseInt(localStorage.getItem('uiZoom') || '100', 10)))
  );
  const themeMode = ref(localStorage.getItem('themeMode') || 'system');

  async function load() {
    const [pathNowRes, pathMaxRes, eventsRes] = await Promise.all([
      runCmd(`cat "${PATH_CONFIG_DIR}/now_bri_file.txt"`),
      runCmd(`cat "${PATH_CONFIG_DIR}/max_bri_file.txt"`),
      runCmd(`cat "${CONFIG_DIR}/inotify_events.txt"`),
    ]);
    if (pathNowRes.errno === 0 && pathNowRes.stdout.trim()) nowBriFile.value = pathNowRes.stdout.trim();
    if (pathMaxRes.errno === 0 && pathMaxRes.stdout.trim()) sysMaxBriFile.value = pathMaxRes.stdout.trim();
    inotifyEvents.value = (eventsRes.errno === 0 && eventsRes.stdout.trim()) ? eventsRes.stdout.trim() : 'c';

    const [uiRes, maxRes, sleepRes, autoRes, stepsRes, logSizeRes, hdrRes] = await Promise.all([
      runCmd(`cat "${CONFIG_DIR}/ui_max_bri.txt"`),
      runCmd(`cat "${CONFIG_DIR}/max_bri.txt"`),
      runCmd(`cat "${CONFIG_DIR}/sleep_time.txt"`),
      runCmd(`cat "${CONFIG_DIR}/auto_bri_sleep.txt"`),
      runCmd(`cat "${CONFIG_DIR}/steps_num.txt"`),
      runCmd(`cat "${CONFIG_DIR}/log_max_size.txt"`),
      runCmd(`cat "${CONFIG_DIR}/display_hdr_sleep.txt"`),
    ]);

    if (uiRes.errno === 0) uiMaxBri.value = uiRes.stdout.trim();
    if (maxRes.errno === 0) maxBri.value = maxRes.stdout.trim();
    if (autoRes.errno === 0) autoBriSleep.value = autoRes.stdout.trim() === '1';
    if (hdrRes.errno === 0) displayHdrSleep.value = hdrRes.stdout.trim() === '1';
    stepsNum.value = (stepsRes.errno === 0 && stepsRes.stdout.trim()) ? stepsRes.stdout.trim() : '50';
    logMaxSize.value = (logSizeRes.errno === 0 && logSizeRes.stdout.trim()) ? logSizeRes.stdout.trim() : '500';

    if (sleepRes.errno === 0) {
      const tv = sleepRes.stdout.trim();
      if (tv && tv.includes('-')) {
        sleepMode.value = true;
        const [s, e] = tv.split('-');
        if (s.length === 4) { sleepStartH.value = s.slice(0, 2); sleepStartM.value = s.slice(2); }
        if (e.length === 4) { sleepEndH.value = e.slice(0, 2); sleepEndM.value = e.slice(2); }
      } else {
        sleepMode.value = false;
      }
    }
  }

  function getSleepTimeStr() {
    if (!sleepMode.value) return '';
    const pad = v => String(v).padStart(2, '0');
    return `${pad(sleepStartH.value)}${pad(sleepStartM.value)}-${pad(sleepEndH.value)}${pad(sleepEndM.value)}`;
  }

  async function save(toast) {
    if (!uiMaxBri.value || !maxBri.value) { toast('亮度值不能为空'); return; }
    toast('保存中...');
    await Promise.all([
      writeFile(`${CONFIG_DIR}/ui_max_bri.txt`, uiMaxBri.value),
      writeFile(`${CONFIG_DIR}/max_bri.txt`, maxBri.value),
      writeFile(`${CONFIG_DIR}/sleep_time.txt`, getSleepTimeStr()),
      writeFile(`${CONFIG_DIR}/auto_bri_sleep.txt`, autoBriSleep.value ? '1' : '0'),
      writeFile(`${CONFIG_DIR}/display_hdr_sleep.txt`, displayHdrSleep.value ? '1' : '0'),
      writeFile(`${CONFIG_DIR}/steps_num.txt`, stepsNum.value || '50'),
      writeFile(`${CONFIG_DIR}/log_max_size.txt`, logMaxSize.value || '500'),
    ]);
    await runCmd(`rm -f "${FLAG_FILE}"`);
    const pidRes = await runCmd(`cat "${PID_FILE}"`);
    toast(pidRes.errno === 0 && pidRes.stdout.trim() ? '配置已保存 (下次调整时生效)' : '配置已保存 (服务未运行)');
  }

  async function saveAdvanced(toast, onPathsChanged) {
    const nowV = nowBriFile.value || DEFAULT_NOW_BRI_FILE;
    const maxV = sysMaxBriFile.value || DEFAULT_SYS_MAX_BRI_FILE;
    const evtV = inotifyEvents.value || 'c';
    toast('保存中...');
    await Promise.all([
      writeFile(`${PATH_CONFIG_DIR}/now_bri_file.txt`, nowV),
      writeFile(`${PATH_CONFIG_DIR}/max_bri_file.txt`, maxV),
      writeFile(`${CONFIG_DIR}/inotify_events.txt`, evtV),
    ]);
    onPathsChanged?.();
    toast('高级设置已保存，需重启服务生效');
  }

  async function resetToDefaults(toast) {
    toast('正在恢复默认配置...');
    const [uiRes, maxRes, sleepRes, autoRes, stepsRes, logSizeRes] = await Promise.all([
      runCmd(`cat "${BACKUP_DIR}/ui_max_bri.txt"`),
      runCmd(`cat "${BACKUP_DIR}/max_bri.txt"`),
      runCmd(`cat "${BACKUP_DIR}/sleep_time.txt"`),
      runCmd(`cat "${BACKUP_DIR}/auto_bri_sleep.txt"`),
      runCmd(`cat "${BACKUP_DIR}/steps_num.txt"`),
      runCmd(`cat "${BACKUP_DIR}/log_max_size.txt"`),
    ]);
    if (uiRes.errno === 0) uiMaxBri.value = uiRes.stdout.trim();
    if (maxRes.errno === 0) maxBri.value = maxRes.stdout.trim();
    autoBriSleep.value = autoRes.errno === 0 ? autoRes.stdout.trim() === '1' : true;
    stepsNum.value = stepsRes.errno === 0 ? stepsRes.stdout.trim() : '50';
    logMaxSize.value = logSizeRes.errno === 0 ? logSizeRes.stdout.trim() : '500';
    if (sleepRes.errno === 0 && sleepRes.stdout.trim().includes('-')) {
      sleepMode.value = true;
      const [s, e] = sleepRes.stdout.trim().split('-');
      if (s.length === 4) { sleepStartH.value = s.slice(0, 2); sleepStartM.value = s.slice(2); }
      if (e.length === 4) { sleepEndH.value = e.slice(0, 2); sleepEndM.value = e.slice(2); }
    } else {
      sleepMode.value = true;
      sleepStartH.value = '19'; sleepStartM.value = '00';
      sleepEndH.value = '06'; sleepEndM.value = '00';
    }
    await save(toast);
  }

  function saveWebUIConfig(toast, newAutoRefresh, newInterval, newZoom, newTheme, onRestart) {
    const interval = Math.max(100, parseInt(newInterval, 10) || 1000);
    const zoom = Math.min(150, Math.max(50, parseInt(newZoom, 10) || 100));
    localStorage.setItem('autoRefresh', newAutoRefresh);
    localStorage.setItem('statusLogRefreshInterval', interval);
    localStorage.setItem('uiZoom', zoom);
    localStorage.setItem('themeMode', newTheme);
    autoRefresh.value = newAutoRefresh;
    statusRefreshInterval.value = interval;
    uiZoom.value = zoom;
    themeMode.value = newTheme;
    document.documentElement.style.zoom = zoom / 100;
    applyTheme(newTheme);
    onRestart?.(newAutoRefresh, interval);
    toast('Web UI 配置已保存');
  }

  function applyZoom() {
    document.documentElement.style.zoom = uiZoom.value / 100;
  }

  function applyTheme(mode) {
    const html = document.documentElement;
    html.classList.remove('light', 'dark');
    if (mode === 'light') html.classList.add('light');
    else if (mode === 'dark') html.classList.add('dark');
    // 'system': no class, CSS @media handles it
  }

  return {
    uiMaxBri, maxBri, stepsNum, logMaxSize,
    autoBriSleep, displayHdrSleep,
    sleepMode, sleepStartH, sleepStartM, sleepEndH, sleepEndM,
    nowBriFile, sysMaxBriFile, inotifyEvents,
    autoRefresh, statusRefreshInterval, uiZoom, themeMode,
    load, save, saveAdvanced, resetToDefaults,
    saveWebUIConfig, applyZoom, applyTheme,
  };
}
