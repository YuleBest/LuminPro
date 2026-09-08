import { ref } from 'vue'
import { runCmd, OPLOCK_FILE } from '../utils.js'

/**
 * 操作锁：后台脚本 (up.sh 渐变 / boost.sh 峰值 / restart.sh 重启) 写亮度节点期间
 * 会创建 oplock 并写入自身 PID。WebUI 据此暂停刷新、禁用写操作。
 * 锁文件中的 PID 不存在时视为遗留锁，就地清理并放行。
 */
export function useOplock() {
  const isLocked = ref(false)

  async function refresh() {
    const res = await runCmd(
      `F="${OPLOCK_FILE}"; if [ -f "$F" ]; then P="$(cat "$F" 2>/dev/null)"; ` +
        `if [ -n "$P" ] && [ -d "/proc/$P" ]; then echo locked; ` +
        `else rm -f "$F"; echo free; fi; else echo free; fi`,
    )
    isLocked.value = res.errno === 0 && res.stdout.trim() === 'locked'
    return isLocked.value
  }

  return { isLocked, refresh }
}
