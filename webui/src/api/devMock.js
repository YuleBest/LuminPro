/**
 * 开发环境（浏览器直开、无 KernelSU bridge）下返回模拟数据，
 * 便于在电脑上调试界面。真机永远不会走到这里。
 */

const mockStatus = (display) => ({
  module: { id: 'LuminPro', name: 'LuminPro', version: 'V2.5.0-beta.2', versionCode: 2050052, channel: 'beta' },
  daemon: { pid: 12345, running: true, state: 'S', mode: 'event', paused: false, uptimeSec: 3620 },
  brightness: { current: 1200, max: 4095, percent: 29, node: '/sys/mock/brightness', maxNode: '/sys/mock/max_brightness' },
  display: display
    ? { hdrRatio: 1.02, hdrKnown: true, hdrStale: false, hdrSleep: false, autoBrightness: false }
    : undefined,
  sleep: { window: '2300-0700', active: false },
  oplock: { locked: false, seconds: 0 },
  config: {
    uiMaxBri: 1000,
    maxBri: 3500,
    stepsNum: 50,
    sleepTime: '2300-0700',
    autoBriSleep: 1,
    displayHdrSleep: 0,
    hdrEnterRatio: 1.15,
    hdrExitRatio: 1.05,
    compatibilityMode: 0,
    logLevel: 'info',
    logMaxSize: 512,
    debugMode: 0,
    nowBriFile: '/sys/class/backlight/panel0-backlight/brightness',
    maxBriFile: '/sys/class/backlight/panel0-backlight/max_brightness',
    blacklistCount: 3,
  },
  log: { path: '/data/adb/modules/LuminPro/service.log', sizeKB: 12 },
})

const mockConfig = () => ({
  ui_max_bri: 1000,
  max_bri: 3500,
  steps_num: 50,
  log_max_size: 512,
  auto_bri_sleep: 1,
  display_hdr_sleep: 0,
  hdr_enter_ratio: 1.15,
  hdr_exit_ratio: 1.05,
  compatibility_mode: 0,
  sleep_time: '2300-0700',
  inotify_events: 'c',
  now_bri_file: '/sys/mock/brightness',
  max_bri_file: '/sys/mock/max_brightness',
  log_level: 'info',
  debug_mode: 0,
  blacklist_apps: ['com.example.video'],
})

const mockLogEntries = [
  { time: '09-10 12:00:01', tag: 'luminpro', level: 'INFO', message: '守护进程已启动' },
  { time: '09-10 12:00:03', tag: 'luminpro', level: 'INFO', message: '正在监听: /sys/mock/brightness, 事件: c' },
  { time: '09-10 12:01:12', tag: 'luminpro', level: 'INFO', message: '触发提升: 当前亮度 1200 ≥ 阈值 1000，目标 3500' },
  { time: '09-10 12:01:12', tag: 'luminpro', level: 'WARN', message: 'HDR 比率读取为空，使用缓存值: 1.02' },
  { time: '09-10 12:01:13', tag: 'luminpro', level: 'SUCCESS', message: '亮度提升完成 (3500)' },
]

const ok = (obj) => ({ ok: true, errno: 0, stdout: JSON.stringify(obj), stderr: '' })

/** 依据命令内容返回模拟响应；无法识别时返回 null */
export function devMock(command) {
  // 参数经 shellQuote 包装过，比较前先去掉单引号
  const plain = command.replace(/'/g, '')
  if (plain.includes(' config read')) return ok(mockConfig())
  if (plain.includes(' config patch') || plain.includes(' config set')) return ok({ ok: true })
  if (plain.includes(' status')) return ok(mockStatus(!plain.includes('--no-display')))
  if (plain.includes(' oplock')) return ok({ locked: false, seconds: 0 })
  if (plain.includes(' focus')) return ok({ focus: 'com.example.video/.MainActivity' })
  if (plain.includes(' brightness set')) return ok({ ok: true, value: 2000 })
  if (plain.includes(' log tail')) {
    return ok({ entries: mockLogEntries, sizeKB: 12, total: mockLogEntries.length })
  }
  if (plain.includes(' log clear') || plain.includes(' log export')) return ok({ ok: true })
  if (plain.includes('boost') || plain.includes('restart') || plain.includes('action.sh')) {
    return { ok: true, errno: 0, stdout: 'LuminPro: 服务已启用', stderr: '' }
  }
  return null
}
