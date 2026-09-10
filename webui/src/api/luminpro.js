/**
 * Go 侧 JSON API 客户端。所有读写都经由 `luminpro` 子命令：
 * 一次调用拿回结构化数据，避免前端拼多条 shell 命令与字符串转义。
 */
import { BIN, MODULE_DIR, runCmd, shellQuote } from './ksu.js'

/** 调用返回 JSON 的子命令 */
async function callJSON(subcommand, args = []) {
  const command = [BIN, subcommand, ...args.map(shellQuote)].join(' ')
  const res = await runCmd(command)
  if (!res.ok) {
    throw new Error(res.stderr.trim() || `命令执行失败: luminpro ${subcommand}`)
  }
  try {
    return JSON.parse(res.stdout)
  } catch {
    throw new Error(`输出不是合法 JSON: luminpro ${subcommand}`)
  }
}

/** 聚合状态；display=false 时跳过 dumpsys/settings 读取 */
export function fetchStatus({ display = true } = {}) {
  return callJSON('status', display ? [] : ['--no-display'])
}

/** 操作锁状态（轻量，供高频轮询） */
export function fetchOplock() {
  return callJSON('oplock')
}

/** 当前前台 Activity（活动抓取向导用） */
export function fetchFocus() {
  return callJSON('focus')
}

/** 设置亮度 */
export function setBrightness(value) {
  return callJSON('brightness', ['set', String(value)])
}

/** 读取完整配置 */
export function fetchConfig() {
  return callJSON('config', ['read'])
}

/** 浅合并写入配置（只传变化字段） */
export function patchConfig(patch) {
  return callJSON('config', ['patch', JSON.stringify(patch)])
}

/** 读取日志 */
export function fetchLog(lines = 200) {
  return callJSON('log', ['tail', '-n', String(lines)])
}

/** 清空日志 */
export function clearLog() {
  return callJSON('log', ['clear'])
}

/** 导出日志到 /sdcard */
export function exportLog(dir = '/sdcard') {
  return callJSON('log', ['export', dir])
}

/** 一键提升 / 恢复 */
export function boost() {
  return runCmd(`${BIN} boost`)
}

/** 重启模块 */
export function restart() {
  return runCmd(`${BIN} restart`)
}

/** 启停切换（沿用 action.sh，管理器「操作」按钮与之共用同一实现） */
export function toggleService() {
  return runCmd(`sh ${MODULE_DIR}/action.sh`)
}

/** 模块文档内容（关于页） */
export async function readModuleFile(name) {
  const res = await runCmd(`cat ${shellQuote(`${MODULE_DIR}/${name}`)} 2>/dev/null`)
  return res.ok ? res.stdout : ''
}
