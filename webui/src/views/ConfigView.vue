<script setup>
import { inject, ref } from 'vue'
import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import Textarea from '@/components/ui/Textarea.vue'
import Switch from '@/components/ui/Switch.vue'
import Label from '@/components/ui/Label.vue'
import {
  Save,
  Settings2,
  ShieldCheck,
  FileText,
  Settings,
  Monitor,
  HelpCircle,
} from 'lucide-vue-next'
import { runCmd } from '../utils.js'

const config = inject('config')
const showToast = inject('showToast')
const restartRefresh = inject('restartRefresh')

// 恢复默认二次确认
const resetConfirming = ref(false)
let resetTimer = null
function handleReset() {
  if (!resetConfirming.value) {
    resetConfirming.value = true
    resetTimer = setTimeout(() => {
      resetConfirming.value = false
    }, 5000)
    return
  }
  clearTimeout(resetTimer)
  resetConfirming.value = false
  config.resetToDefaults(showToast)
}

function setTheme(v) {
  config.themeMode.value = v
  config.applyTheme(v)
}

async function viewInotifyHelp() {
  const msg = `支持的事件字母 (toybox inotifyd 兼容):
  a = accessed       读取
  c = modified       内容修改 (亮度节点推荐用此)
  e = metadata change 属性变更
  w = closed (writable)   写入后关闭
  0 = closed (unwritable) 查看后关闭
  r = opened         打开
  n = created        创建
  d = deleted        删除(目录内)
  D = deleted (self) 自身被删除
  M = moved (self)   自身被移动
  m = moved in       移入目录
  y = moved out      移出目录
  u = unmounted      挂载卷卸载
  * = all events

提示: sysfs 亮度节点使用 c (MODIFY)，这也是默认值`
  alert(msg)
}

function handleSaveWebUI() {
  config.saveWebUIConfig(
    showToast,
    config.autoRefresh.value,
    config.statusRefreshInterval.value,
    config.uiZoom.value,
    config.themeMode.value,
    restartRefresh,
  )
}
</script>

<template>
  <div style="display: contents">
    <!-- === 亮度配置 === -->
    <section class="card" id="config-section" data-nav-group="config">
      <div class="card-header"><h2>亮度配置</h2></div>

      <div class="config-group">
        <h3 class="group-title"><Settings2 :size="16" /> 亮度调节</h3>

        <div class="config-item">
          <div class="config-label">
            <span class="config-name">前台最大亮度</span>
            <span class="config-desc">触发亮度提升的阈值</span>
          </div>
          <Input v-model="config.uiMaxBri.value" type="number" min="0" class="config-input" />
        </div>

        <div class="config-item">
          <div class="config-label">
            <span class="config-name">峰值最大亮度</span>
            <span class="config-desc">亮度提升的目标值</span>
          </div>
          <Input v-model="config.maxBri.value" type="number" min="0" class="config-input" />
        </div>

        <div class="config-item">
          <div class="config-label">
            <span class="config-name">亮度提升步数</span>
            <span class="config-desc">约 0.02 秒 / 步</span>
          </div>
          <Input
            v-model="config.stepsNum.value"
            type="number"
            min="1"
            max="500"
            class="config-input"
          />
        </div>
      </div>

      <div class="config-group">
        <h3 class="group-title"><ShieldCheck :size="16" /> 执行策略</h3>

        <div class="config-item">
          <div class="config-label">
            <span class="config-name">自动亮度时休眠</span>
            <span class="config-desc">开启自动亮度时不提升</span>
          </div>
          <Switch v-model="config.autoBriSleep.value" />
        </div>

        <div class="config-item">
          <div class="config-label">
            <span class="config-name">显示 HDR 内容时休眠</span>
            <span class="config-desc">HDR/SDR 比率 &gt; 1 时不提升</span>
            <span class="config-desc" style="color: var(--color-warning)"
              >建议配合去温控使用。出现闪屏时可改用黑名单功能</span
            >
          </div>
          <Switch v-model="config.displayHdrSleep.value" />
        </div>

        <div class="config-item">
          <div class="config-label">
            <span class="config-name">定时休眠</span>
            <span class="config-desc">设定时段内不提升亮度</span>
          </div>
          <Switch v-model="config.sleepMode.value" />
        </div>

        <div class="config-item-expand" :class="{ show: config.sleepMode.value }">
          <div class="custom-time-picker">
            <div class="time-unit">
              <input
                type="number"
                v-model="config.sleepStartH.value"
                class="time-input"
                min="0"
                max="23"
                placeholder="00"
              />
              <span>:</span>
              <input
                type="number"
                v-model="config.sleepStartM.value"
                class="time-input"
                min="0"
                max="59"
                placeholder="00"
              />
            </div>
            <span class="time-sep">至</span>
            <div class="time-unit">
              <input
                type="number"
                v-model="config.sleepEndH.value"
                class="time-input"
                min="0"
                max="23"
                placeholder="00"
              />
              <span>:</span>
              <input
                type="number"
                v-model="config.sleepEndM.value"
                class="time-input"
                min="0"
                max="59"
                placeholder="00"
              />
            </div>
          </div>
        </div>
      </div>

      <div class="config-group">
        <h3 class="group-title"><FileText :size="16" /> 系统管理</h3>
        <div class="config-item">
          <div class="config-label">
            <span class="config-name">日志大小限制</span>
            <span class="config-desc">单位: KB</span>
          </div>
          <Input
            v-model="config.logMaxSize.value"
            type="number"
            min="1"
            max="10240"
            class="config-input"
          />
        </div>
      </div>

      <div class="card-actions">
        <Button
          variant="outline"
          @click="handleReset"
          :class="resetConfirming ? 'border-destructive text-destructive' : ''"
        >
          {{ resetConfirming ? '确认恢复？' : '恢复默认' }}
        </Button>
        <Button @click="config.save(showToast)"> <Save :size="15" /> 保存配置 </Button>
      </div>
    </section>

    <!-- === 高级设置 === -->
    <section class="card" id="advanced-section" data-nav-group="config">
      <div class="card-header"><h2>高级设置</h2></div>

      <div class="config-group">
        <h3 class="group-title"><Settings :size="16" /> 运行环境</h3>

        <div class="config-item">
          <div class="config-label">
            <span class="config-name">调试模式</span>
            <span class="config-desc">将每个 inotify 事件及防抖触发信息写入日志</span>
            <span class="config-desc" style="color: var(--color-warning)"
              >开启后需重启服务，日志量增大。诊断完成后请关闭</span
            >
          </div>
          <Switch v-model="config.debugMode.value" />
        </div>

        <div class="config-item">
          <div class="config-label">
            <span class="config-name">lumipro 监听事件</span>
            <span class="config-desc">默认 c（sysfs MODIFY）。修改需重启服务</span>
            <span class="config-desc" style="color: var(--color-warning)"
              >修改为 c 以外时建议关闭自动刷新</span
            >
            <button
              class="btn-text-s"
              style="margin-top: 6px; padding: 2px 6px"
              @click="viewInotifyHelp"
            >
              查看支持事件
            </button>
          </div>
          <Input
            v-model="config.inotifyEvents.value"
            type="text"
            placeholder="c"
            class="config-input"
          />
        </div>

        <div class="config-item" id="advanced-section">
          <div class="config-label">
            <span class="config-name">当前亮度节点</span>
            <span class="config-desc">修改需重启服务</span>
          </div>
          <Textarea v-model="config.nowBriFile.value" class="config-textarea" />
        </div>

        <div class="config-item">
          <div class="config-label">
            <span class="config-name">最大亮度节点</span>
            <span class="config-desc">修改需重启服务</span>
          </div>
          <Textarea v-model="config.sysMaxBriFile.value" class="config-textarea" />
        </div>
      </div>

      <div class="card-actions">
        <Button @click="config.saveAdvanced(showToast, () => {})">
          <Save :size="15" /> 保存设置
        </Button>
      </div>
    </section>

    <!-- === Web UI 配置 === -->
    <section class="card" id="webui-config-section" data-nav-group="config">
      <div class="card-header"><h2>Web UI 配置</h2></div>

      <div class="config-group">
        <h3 class="group-title"><Monitor :size="16" /> 界面设置</h3>

        <div class="config-item">
          <div class="config-label">
            <span class="config-name">自动刷新</span>
            <span class="config-desc">定时刷新状态和日志。监听非 c 事件时建议关闭</span>
          </div>
          <Switch v-model="config.autoRefresh.value" />
        </div>

        <div class="config-item" v-show="config.autoRefresh.value">
          <div class="config-label">
            <span class="config-name">状态/日志刷新间隔</span>
            <span class="config-desc">单位: 毫秒 (最小100ms)</span>
          </div>
          <Input
            v-model="config.statusRefreshInterval.value"
            type="number"
            min="100"
            class="config-input"
          />
        </div>

        <div class="config-item">
          <div class="config-label">
            <span class="config-name">外观主题</span>
            <span class="config-desc">深色 / 浅色 / 跟随系统</span>
          </div>
          <div class="theme-seg">
            <button
              v-for="opt in [
                { v: 'system', l: '系统' },
                { v: 'light', l: '浅色' },
                { v: 'dark', l: '深色' },
              ]"
              :key="opt.v"
              class="theme-seg-btn"
              :class="{ active: config.themeMode.value === opt.v }"
              @click="setTheme(opt.v)"
            >
              {{ opt.l }}
            </button>
          </div>
        </div>

        <div class="config-item">
          <div class="config-label">
            <span class="config-name">界面缩放</span>
            <span class="config-desc">50% - 150%（立即生效）</span>
          </div>
          <Input
            v-model="config.uiZoom.value"
            type="number"
            min="50"
            max="150"
            class="config-input"
          />
        </div>
      </div>

      <div class="card-actions">
        <Button @click="handleSaveWebUI"> <Save :size="15" /> 保存配置 </Button>
      </div>
    </section>
  </div>
</template>
