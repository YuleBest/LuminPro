import { exec, moduleInfo, enableEdgeToEdge } from 'kernelsu'
import { devMock } from './devMock.js'

export const MODULE_DIR = '/data/adb/modules/LuminPro'
export const BIN = `${MODULE_DIR}/bin/luminpro`

/** 是否为 KernelSU 环境（exec 可用） */
let available = true

export function isKsuAvailable() {
  return available
}

/**
 * 执行 shell 命令。所有命令都是固定字符串或经 shellQuote 处理过的参数，
 * 不把未校验的用户输入直接拼进命令。
 */
export async function runCmd(command) {
  try {
    const res = await exec(command)
    available = true
    return {
      ok: res.errno === 0,
      errno: res.errno,
      stdout: res.stdout ?? '',
      stderr: res.stderr ?? '',
    }
  } catch (err) {
    available = false
    // 仅开发环境回退到模拟数据，真机上失败就是失败
    if (import.meta.env.DEV) {
      const mocked = devMock(command)
      if (mocked) return mocked
    }
    return { ok: false, errno: -1, stdout: '', stderr: String(err) }
  }
}

/** 把任意字符串安全地包成 shell 单引号参数 */
export function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`
}

/**
 * 启用 edge-to-edge：内容延伸至状态栏/手势条区域，
 * insets.css 的 --window-inset-* 随之生效，顶栏/底栏据此避让。
 * 不同 KernelSU 版本的命名不同，逐个尝试，全部不可用则忽略。
 */
export function applyEdgeToEdge() {
  try {
    enableEdgeToEdge(true)
  } catch {
    /* 老版本没有该 API：布局仍可用，只是安全区取 0 */
  }
}

/** 读取模块版本（module.prop 的 version） */
export function moduleVersion() {
  try {
    return JSON.parse(moduleInfo()).version || ''
  } catch {
    return import.meta.env.DEV ? 'V2.5.0-dev.0' : ''
  }
}
