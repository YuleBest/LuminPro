<script setup>
import { inject, computed, ref } from 'vue'
import Button from '@/components/ui/Button.vue'
import Switch from '@/components/ui/Switch.vue'
import Badge from '@/components/ui/Badge.vue'
import {
  RefreshCw,
  Play,
  RotateCcw,
  SunMedium,
  Smartphone,
  Activity,
  Clock,
  Moon,
  Layers,
} from 'lucide-vue-next'

const status = inject('status')
const showToast = inject('showToast')
const config = inject('config')

const confirmedLowBri = ref(false)

// --------- 亮度滑条渐变 ----------
const sliderStyle = computed(() => {
  const sysMax = parseInt(status.sysMaxBri.value) || 255
  const curr = parseInt(status.currentBri.value) || 0
  const uiMax = parseInt(config.uiMaxBri.value) || sysMax
  const c = (curr / sysMax) * 100
  const u = (uiMax / sysMax) * 100
  const pri = '#a8c7fa'
  const bst = '#fb8c00'
  const trk = 'var(--md-sys-color-surface-container-high)'
  const btrk = 'rgba(251,140,0,0.15)'
  if (c <= u) {
    return `background: linear-gradient(to right, ${pri} 0%, ${pri} ${c}%, ${trk} ${c}%, ${trk} ${u}%, ${btrk} ${u}%, ${btrk} 100%)`
  }
  return `background: linear-gradient(to right, ${pri} 0%, ${pri} ${u}%, ${bst} ${u}%, ${bst} ${c}%, ${btrk} ${c}%, ${btrk} 100%)`
})

const brightnessPercent = computed(() => {
  const sysMax = parseInt(status.sysMaxBri.value) || 255
  const curr = parseInt(status.currentBri.value) || 0
  return Math.round((curr / sysMax) * 100) + '%'
})

async function onSliderChange(e) {
  const newBri = parseInt(e.target.value, 10)
  const sysMax = parseInt(status.sysMaxBri.value) || 255
  const pct = Math.round((newBri / sysMax) * 100)
  if (pct < 5 && !confirmedLowBri.value) {
    const ok = confirm('⚠️ 警告：亮度低于 5% 可能导致屏幕近似黑屏。\n\n确定要继续吗？')
    if (!ok) {
      const safe = Math.ceil(sysMax * 0.05)
      e.target.value = safe
      return
    }
    confirmedLowBri.value = true
  }
  if (pct >= 5) confirmedLowBri.value = false
  await status.setBrightness(newBri, showToast)
}

const statusItems = computed(() => [
  { label: '当前亮度', value: status.currentBri.value || '—', icon: SunMedium },
  { label: '系统最大亮度', value: status.sysMaxBri.value || '—', icon: Smartphone },
  { label: 'lumipro PID', value: status.inotifydPid.value, icon: Activity },
  { label: 'lumipro 状态', value: status.inotifydState.value, icon: Clock },
  { label: '休眠状态', value: status.sleepStatus.value, icon: Moon },
  { label: 'HDR/SDR 比率', value: status.hdrRatio.value, icon: Layers },
])
</script>

<template>
  <section class="card" id="status-section" data-nav-group="status">
    <div class="card-header">
      <h2>实时状态</h2>
      <Button variant="ghost" size="icon" @click="status.load(true)">
        <RefreshCw :size="18" />
      </Button>
    </div>

    <!-- 状态网格 -->
    <div class="status-grid">
      <div v-for="item in statusItems" :key="item.label" class="status-item">
        <div class="status-item-header">
          <component :is="item.icon" :size="14" aria-hidden="true" />
          <span class="status-label">{{ item.label }}</span>
        </div>
        <span class="status-value">{{ item.value }}</span>
      </div>
    </div>

    <!-- 亮度控制 -->
    <div class="brightness-section">
      <div class="brightness-header">
        <span class="brightness-title">亮度</span>
        <span class="brightness-percent">{{ brightnessPercent }}</span>
      </div>
      <div class="brightness-container">
        <span class="brightness-label">0%</span>
        <input
          type="range"
          class="brightness-slider"
          min="0"
          :max="status.sysMaxBri.value || 255"
          :value="status.currentBri.value || 0"
          :style="sliderStyle"
          @change="onSliderChange"
        />
        <span class="brightness-label">100%</span>
      </div>
      <div class="auto-brightness-row">
        <span class="auto-brightness-label">自动亮度调节</span>
        <Switch
          :model-value="status.autoBriMode.value"
          @update:model-value="status.setAutoBrightness($event, showToast)"
        />
      </div>
    </div>
  </section>
</template>
