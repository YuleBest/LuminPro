import { exec, moduleInfo } from 'kernelsu'
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
 * 启用 edge-to-edge：内容延伸至状态栏/手势条区域，insets.css 的
 * --window-inset-* / --safe-area-inset-* 随之生效。
 *
 * 注意：不能直接调用从 npm 包 import 的 enableEdgeToEdge——该绑定总是存在，
 * 不支持时是包内部调用 ksu 对象时抛错，会打断后续脚本（FontMM 踩过同样的坑）。
 * 这里改为探测全局 ksu 对象，并兼容 KernelSU-Next 的 enableInsets 命名。
 */
export function applyEdgeToEdge() {
  try {
    const ksuApi = globalThis.ksu
    if (!ksuApi) return
    const fn = ksuApi.enableEdgeToEdge ?? ksuApi.enableInsets
    if (typeof fn === 'function') fn.call(ksuApi, true)
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
