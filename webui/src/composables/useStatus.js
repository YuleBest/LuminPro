import { ref, computed } from 'vue';
import {
  runCmd, readConfig,
  PID_FILE, STOP_FLAG_FILE,
  DEFAULT_NOW_BRI_FILE, DEFAULT_SYS_MAX_BRI_FILE,
} from '../utils.js';

export function useStatus() {
  // 亮度
  const currentBri = ref(null);
  const sysMaxBri = ref(null);

  // 服务状态
  const inotifydPid = ref('—');
  const inotifydState = ref('—');
  const isRunning = ref(false);
  const isPaused = ref(false);
  const statusClass = computed(() => {
    if (isPaused.value) return 'status-paused';
    if (isRunning.value) return 'status-running';
    return 'status-loading';
  });
  const statusText = computed(() => {
    if (isPaused.value) return '已暂停';
    if (isRunning.value) return '运行中';
    return '未运行';
  });

  // HDR / 睡眠状态
  const hdrRatio = ref('—');
  const sleepStatus = ref('—');

  // 自动亮度
  const autoBriMode = ref(false);

  // 缓存配置字段（避免每次刷新都 readConfig）
  let _nowBriFile = null;
  let _sysMaxBriFile = null;
  let _sleepTime = null;

  async function _ensurePaths() {
    if (_nowBriFile && _sysMaxBriFile) return;
    const cfg = await readConfig();
    _nowBriFile  = cfg.now_bri_file  || DEFAULT_NOW_BRI_FILE;
    _sysMaxBriFile = cfg.max_bri_file || DEFAULT_SYS_MAX_BRI_FILE;
    _sleepTime   = cfg.sleep_time    || '';
  }

  function invalidatePaths() {
    _nowBriFile = null;
    _sysMaxBriFile = null;
    _sleepTime = null;
  }

  async function load(forceFull = false) {
    await _ensurePaths();

    const needBri = forceFull || currentBri.value === null || sysMaxBri.value === null;

    // 所有 Shell 命令一次并发，消除多轮顺序等待
    // PID + 进程状态合并为一条命令以减少 exec 次数
    const [pidStateRes, stopRes, autoBriRes, hdrRes, cBriRes, sBriRes] = await Promise.all([
      runCmd(`PID=$(cat "${PID_FILE}" 2>/dev/null || true); printf '%s\\n' "$PID"; [ -n "$PID" ] && grep '^State:' "/proc/$PID/status" 2>/dev/null | awk '{print $2}' || true`),
      runCmd(`[ -f "${STOP_FLAG_FILE}" ] && echo "1" || echo "0"`),
      runCmd(`settings get system screen_brightness_mode`),
      runCmd(`dumpsys display 2>/dev/null | sed -n 's/.*hdrSdrRatio \\([0-9.]*\\).*/\\1/p' | head -n 1`),
      needBri ? runCmd(`cat "${_nowBriFile}"`)    : Promise.resolve({ errno: -1, stdout: '' }),
      needBri ? runCmd(`cat "${_sysMaxBriFile}"`) : Promise.resolve({ errno: -1, stdout: '' }),
    ]);

    if (needBri) {
      currentBri.value = cBriRes.errno === 0 ? cBriRes.stdout.trim() : '0';
      sysMaxBri.value  = sBriRes.errno === 0 ? sBriRes.stdout.trim() : '255';
    }

    const psLines   = (pidStateRes.errno === 0 ? pidStateRes.stdout : '').split('\n');
    const pidStr    = psLines[0]?.trim() || '';
    const stateChar = psLines[1]?.trim() || '';

    isPaused.value      = stopRes.errno === 0 && stopRes.stdout.trim() === '1';
    isRunning.value     = !isPaused.value && !!pidStr;
    inotifydPid.value   = pidStr || '离线';
    inotifydState.value = isRunning.value ? (stateChar || '已退出') : '离线';

    autoBriMode.value = autoBriRes.errno === 0 && parseInt(autoBriRes.stdout.trim(), 10) === 1;

    const hdrRaw = hdrRes.errno === 0 ? hdrRes.stdout.trim() : '';
    hdrRatio.value = (hdrRaw && /^\d+(\.\d+)?$/.test(hdrRaw)) ? parseFloat(hdrRaw).toFixed(2) : '-';

    sleepStatus.value = _calcSleep(_sleepTime);
  }

  function _calcSleep(sleepTime) {
    if (!sleepTime || !sleepTime.includes('-')) return '非休眠';
    const [s, e] = sleepTime.split('-');
    if (s.length !== 4 || e.length !== 4) return '非休眠';
    const now = new Date();
    const nV = now.getHours() * 100 + now.getMinutes();
    const sNum = parseInt(s.slice(0, 2), 10) * 100 + parseInt(s.slice(2), 10);
    const eNum = parseInt(e.slice(0, 2), 10) * 100 + parseInt(e.slice(2), 10);
    if (sNum > eNum) {
      return (nV >= sNum || nV < eNum) ? '休眠中' : '非休眠';
    }
    return (nV >= sNum && nV < eNum) ? '休眠中' : '非休眠';
  }

  async function toggleService(toast) {
    const res = await runCmd(`sh /data/adb/modules/LuminPro/action.sh`);
    toast(res.errno === 0 ? (res.stdout.trim() || '状态已切换') : ('操作失败: ' + res.stderr));
    await load(true);
  }

  async function restartService(toast) {
    toast('正在重启服务...');
    const res = await runCmd(`sh /data/adb/modules/LuminPro/script/restart.sh`);
    setTimeout(async () => { await load(true); }, 1000);
    toast(res.errno === 0 ? '服务已成功重启' : ('重启失败: ' + res.stderr));
  }

  async function setBrightness(newBri, toast) {
    currentBri.value = String(newBri);
    const cmd = `echo -n '${newBri}' > '${_nowBriFile}' 2>/dev/null && echo 'OK'`;
    const res = await runCmd(cmd);
    if (!(res.errno === 0 && res.stdout.includes('OK'))) {
      toast('亮度设置失败，已恢复');
      await load(true);
    }
  }

  async function setAutoBrightness(enabled, toast) {
    const mode = enabled ? 1 : 0;
    const res = await runCmd(`settings put system screen_brightness_mode ${mode}`);
    if (res.errno === 0) {
      autoBriMode.value = enabled;
      toast(enabled ? '自动亮度已启用' : '手动亮度已启用');
    } else {
      toast('设置失败: ' + (res.stderr || '未知错误'));
    }
  }

  return {
    currentBri, sysMaxBri,
    inotifydPid, inotifydState,
    isRunning, isPaused,
    statusClass, statusText,
    hdrRatio, sleepStatus,
    autoBriMode,
    load, invalidatePaths,
    toggleService, restartService,
    setBrightness, setAutoBrightness,
  };
}
