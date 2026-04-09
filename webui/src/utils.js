import { exec } from 'kernelsu'

export const MODULE_DIR = '/data/adb/modules/LuminPro'
export const CONFIG_DIR = `${MODULE_DIR}/config`
export const CONFIG_FILE = `${MODULE_DIR}/config/config.json`
export const BACKUP_CONFIG_FILE = `${MODULE_DIR}/config/.backup/config.json`
export const PID_FILE = `${MODULE_DIR}/pid/inotifyd.pid`
export const FLAG_FILE = `${MODULE_DIR}/pid/up.flag`
export const STOP_FLAG_FILE = `${MODULE_DIR}/pid/stop.flag`
export const LOG_FILE = `${MODULE_DIR}/service.log`
export const DEFAULT_NOW_BRI_FILE = '/sys/class/backlight/panel0-backlight/brightness'
export const DEFAULT_SYS_MAX_BRI_FILE = '/sys/class/backlight/panel0-backlight/max_brightness'

export function showToast(msg) {
  const toast = document.getElementById('toast')
  toast.textContent = msg
  toast.classList.add('show')
  setTimeout(() => toast.classList.remove('show'), 3000)
}

export async function runCmd(cmd) {
  try {
    const res = await exec(cmd)
    return res
  } catch (e) {
    console.warn(`[DEBUG] 执行命令失败 (可能是非 KSU 环境): ${cmd}`)

    // JSON 配置模拟
    if (cmd.includes('cat') && cmd.includes('config.json')) {
      return {
        errno: 0,
        stdout: JSON.stringify({
          ui_max_bri: 4095,
          max_bri: 3500,
          steps_num: 100,
          log_max_size: 1024,
          auto_bri_sleep: 1,
          display_hdr_sleep: 0,
          sleep_time: '1900-0600',
          inotify_events: 'c',
          now_bri_file: '/sys/mock/brightness',
          max_bri_file: '/sys/mock/max_brightness',
          blacklist_apps: ['com.example.app'],
        }),
        stderr: '',
      }
    }

    // 状态模拟
    if (cmd.includes('cat') && cmd.includes('inotifyd.pid'))
      return { errno: 0, stdout: '12345', stderr: '' }
    if (cmd.includes('settings get system screen_brightness_mode'))
      return { errno: 0, stdout: '1', stderr: '' }
    if (cmd.includes('[ -f') && cmd.includes('stop.flag'))
      return { errno: 0, stdout: '0', stderr: '' }
    if (cmd.includes('cat') && (cmd.includes('brightness') || cmd.includes('now_bri')))
      return { errno: 0, stdout: '1200', stderr: '' }
    if (cmd.includes('cat') && (cmd.includes('max_brightness') || cmd.includes('max_bri')))
      return { errno: 0, stdout: '4095', stderr: '' }

    // 日志模拟
    if (cmd.includes('tail') && cmd.includes('service.log')) {
      return {
        errno: 0,
        stdout:
          '[04-07 15:40:01] [service] [INFO    ] LuminPro 服务启动\n[04-07 15:41:05] [up] [INFO    ] 触发提升: 当前亮度 1200 ≥ 阈値 1000\n[04-07 15:42:10] [up] [SUCCESS ] 亮度提升完成 (3500)',
        stderr: '',
      }
    }

    // 文档模拟
    if (cmd.includes('cat') && cmd.includes('.md'))
      return {
        errno: 0,
        stdout: '# 调试模式\n\n当前处于 **Web 调试模式**，显示的是模拟测试数据。',
        stderr: '',
      }
    if (cmd.includes('cat') && cmd.includes('.txt'))
      return { errno: 0, stdout: '这是 NOTE.txt 的模拟内容。', stderr: '' }

    return { errno: -1, stdout: '', stderr: String(e) }
  }
}

// 读取完整 JSON 配置
export async function readConfig() {
  const res = await runCmd(`cat "${CONFIG_FILE}"`)
  if (res.errno !== 0 || !res.stdout.trim()) return {}
  try {
    return JSON.parse(res.stdout)
  } catch {
    return {}
  }
}

// 写入完整 JSON 配置
export async function writeConfig(obj) {
  const content = JSON.stringify(obj).replace(/'/g, "'\\''")
  return runCmd(`printf '%s' '${content}' > "${CONFIG_FILE}"`)
}

// 合并更新 JSON 配置（保留其他字段）
export async function updateConfig(updates) {
  const current = await readConfig()
  return writeConfig({ ...current, ...updates })
}

// 将文件内容写入指定路径
export async function writeFile(path, content) {
  const safeContent = String(content).replace(/'/g, "'\\''")
  return runCmd(`printf '%s' '${safeContent}' > "${path}"`)
}
