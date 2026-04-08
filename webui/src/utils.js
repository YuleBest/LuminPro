import { exec } from 'kernelsu';

export const CONFIG_DIR = '/data/adb/modules/LuminPro/config';
export const PATH_CONFIG_DIR = '/data/adb/modules/LuminPro/config/path';
export const BACKUP_DIR = '/data/adb/modules/LuminPro/config/.backup';
export const PID_FILE = '/data/adb/modules/LuminPro/pid/inotifyd.pid';
export const FLAG_FILE = '/data/adb/modules/LuminPro/pid/up.flag';
export const STOP_FLAG_FILE = '/data/adb/modules/LuminPro/pid/stop.flag';
export const LOG_FILE = '/data/adb/modules/LuminPro/service.log';
export const DEFAULT_NOW_BRI_FILE = '/sys/class/backlight/panel0-backlight/brightness';
export const DEFAULT_SYS_MAX_BRI_FILE = '/sys/class/backlight/panel0-backlight/max_brightness';

export function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3000);
}

export async function runCmd(cmd) {
  try {
    const res = await exec(cmd);
    return res;
  } catch (e) {
    // 调试模式数据模拟
    console.warn(`[DEBUG] 执行命令失败 (可能是非 KSU 环境): ${cmd}`);

    // 基础配置模拟
    if (cmd.includes('cat') && cmd.includes('ui_max_bri.txt')) return { errno: 0, stdout: '4095', stderr: '' };
    if (cmd.includes('cat') && cmd.includes('max_bri.txt')) return { errno: 0, stdout: '3500', stderr: '' };
    if (cmd.includes('cat') && (cmd.includes('now_bri_file.txt') || cmd.includes('max_bri_file.txt'))) return { errno: 0, stdout: '/sys/mock/brightness', stderr: '' };
    if (cmd.includes('cat') && cmd.includes('inotify_events.txt')) return { errno: 0, stdout: 'c', stderr: '' };
    if (cmd.includes('cat') && cmd.includes('log_max_size.txt')) return { errno: 0, stdout: '1024', stderr: '' };
    if (cmd.includes('cat') && cmd.includes('steps_num.txt')) return { errno: 0, stdout: '100', stderr: '' };

    // 状态模拟
    if (cmd.includes('cat') && (cmd.includes('brightness') || cmd.includes('now_bri_file.txt'))) return { errno: 0, stdout: '1200', stderr: '' };
    if (cmd.includes('cat') && (cmd.includes('max_brightness') || cmd.includes('max_bri_file.txt'))) return { errno: 0, stdout: '4095', stderr: '' };
    if (cmd.includes('cat') && cmd.includes('inotifyd.pid')) return { errno: 0, stdout: '12345', stderr: '' };
    if (cmd.includes('settings get system screen_brightness_mode')) return { errno: 0, stdout: '1', stderr: '' };
    if (cmd.includes('[ -f') && cmd.includes('stop.flag')) return { errno: 0, stdout: '0', stderr: '' };

    // 日志模拟
    if (cmd.includes('tail') && cmd.includes('service.log')) {
      return { errno: 0, stdout: '[2026-04-07 15:40:01] [INFO] 服务启动成功\n[2026-04-07 15:41:05] [DEBUG] 亮度调整: 1200 -> 1250\n[2026-04-07 15:42:10] [INFO] 切换至峰值亮度模式\n[2026-04-07 15:43:22] [WARN] 检测到极低亮度设定', stderr: '' };
    }

    // 文档模拟
    if (cmd.includes('cat') && cmd.includes('.md')) return { errno: 0, stdout: '# 调试模式说明\n\n当前处于 **Web 调试模式**，显示的是模拟出的测试数据。\n\n- 状态卡片：全部固定为运行中。\n- 应用列表：预设了 150 个常用模拟应用。\n- 按钮：所有变更仅在当前页面生效，不会写入手机文件系统。', stderr: '' };
    if (cmd.includes('cat') && cmd.includes('.txt')) return { errno: 0, stdout: '这是 NOTE.txt 的模拟内容，用于测试纯文本渲染。', stderr: '' };

    return { errno: -1, stdout: '', stderr: String(e) };
  }
}

export async function writeFile(path, content) {
  const safeContent = String(content).replace(/'/g, "'\\''");
  return runCmd(`echo -n '${safeContent}' > "${path}"`);
}
