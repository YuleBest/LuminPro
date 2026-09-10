<script setup>
import { inject, ref, computed, onUnmounted, nextTick } from 'vue'
import { useVirtualizer } from '@tanstack/vue-virtual'
import {
  Search,
  Save,
  X,
  ChevronDown,
  ScanSearch,
  ChevronLeft,
  Monitor,
  Clock,
  CircleCheck,
  Check,
} from 'lucide-vue-next'
import ActionMenu from '../components/ActionMenu.vue'
import AppTextField from '../components/AppTextField.vue'
import PromptDialog from '../components/PromptDialog.vue'
import { fetchFocus } from '../api/luminpro.js'

const appsApi = inject('apps')
const status = inject('status')
const snackbar = inject('snackbar')

const locked = computed(() => status.oplock.value.locked)

const menuItems = computed(() => [
  {
    key: 'toggle-system',
    label: appsApi.showingSystemApps.value ? '隐藏系统应用' : '显示系统应用',
  },
  { key: 'smart', label: '智能选择' },
  { key: 'manual', label: '手动添加包名' },
  { key: 'all', label: '全选' },
  { key: 'none', label: '全不选' },
  { key: 'invert', label: '反选' },
])

const filteredApps = computed(() => appsApi.getFilteredApps())
const appCount = computed(() => filteredApps.value.length)

function onMenuSelect(key) {
  switch (key) {
    case 'toggle-system':
      appsApi.toggleSystemApps()
      break
    case 'smart':
      appsApi.smartSelect(snackbar)
      break
    case 'manual':
      manualOpen.value = true
      break
    case 'all':
      appsApi.selectAll()
      break
    case 'none':
      appsApi.selectNone()
      break
    case 'invert':
      appsApi.invertSelection()
      break
  }
}

// ── 手动添加包名 ───────────────────────────────────────────────────
const manualOpen = ref(false)

async function onManualAdd(pkg) {
  manualOpen.value = false
  if (!pkg) return
  const existing = appsApi.apps.value.find((a) => a.packageName === pkg)
  if (existing) {
    existing.checked = true
    appsApi.reorder()
    snackbar('已为你自动勾选并置顶')
    return
  }
  appsApi.apps.value.unshift({
    packageName: pkg,
    appLabel: '未知 (手动添加)',
    isSystem: false,
    uid: '自定义',
    checked: true,
    expanded: false,
  })
  appsApi.reorder()
  snackbar('已添加到列表顶部')
}

// ── 虚拟滚动 ───────────────────────────────────────────────────────
const listEl = ref(null)
const rowVirtualizer = useVirtualizer(
  computed(() => ({
    count: filteredApps.value.length,
    getScrollElement: () => listEl.value,
    estimateSize: () => 64,
    overscan: 6,
  })),
)
const virtualRows = computed(() =>
  rowVirtualizer.value.getVirtualItems().map((row) => ({
    ...row,
    app: filteredApps.value[row.index],
  })),
)
const totalListHeight = computed(() => rowVirtualizer.value.getTotalSize())

function measureElement(el) {
  if (el) rowVirtualizer.value.measureElement(el)
}

// ── 按活动屏蔽 ─────────────────────────────────────────────────────
const activityInput = ref('')

function addActivityEntry() {
  const value = activityInput.value.trim()
  const parts = value.split('/')
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    snackbar('格式错误，请输入 包名/完整活动类名')
    return
  }
  appsApi.addActivity(value)
  activityInput.value = ''
  snackbar(`已添加: ${value}`)
}

// ── 活动抓取（扫描当前前台 Activity）────────────────────────────────
const pickerOpen = ref(false)
const pickerStep = ref(1)
const pickerStatus = ref('等待中...')
const pickerPolling = ref(false)
const pickerResult = ref('')
const pickerDialog = ref(null)
let pollingTimer = null

async function openPicker() {
  pickerStep.value = 1
  pickerStatus.value = '等待中...'
  pickerResult.value = ''
  pickerPolling.value = false
  pickerOpen.value = true
  await nextTick()
  pickerDialog.value?.show()
}

function closePicker() {
  stopPolling()
  pickerOpen.value = false
  pickerDialog.value?.close()
}

function stopPolling() {
  if (pollingTimer) {
    clearInterval(pollingTimer)
    pollingTimer = null
  }
}

function startPolling() {
  pickerPolling.value = true
  pickerStatus.value = '检测中，请切换到目标界面...'
  stopPolling()
  pollingTimer = setInterval(async () => {
    try {
      const res = await fetchFocus()
      const activity = (res.focus || '').trim()
      if (!activity || activity.toLowerCase().includes('webui')) return
      stopPolling()
      pickerPolling.value = false
      pickerResult.value = activity
      pickerStep.value = 3
    } catch {
      /* 忽略单次失败，继续轮询 */
    }
  }, 600)
}

function confirmPicker() {
  if (!pickerResult.value) return
  appsApi.addActivity(pickerResult.value)
  snackbar(`已添加: ${pickerResult.value}`)
  closePicker()
}

onUnmounted(stopPolling)
</script>

<template>
  <section class="section">
    <div class="section-header">
      <h2 class="section-title ts-title-md">黑名单</h2>
      <span
        v-if="appsApi.unsavedCount.value"
        class="state-badge is-unsaved"
      >未保存</span>
      <ActionMenu :items="menuItems" :disabled="locked" @select="onMenuSelect" />
    </div>

    <p class="ts-body-sm supporting">
      被选中的应用在前台时不执行亮度提升。<br />
      推荐选择视频类、相册等需要展示 HDR 内容的应用。
    </p>

    <!-- 按活动屏蔽 -->
    <div class="activity-block">
      <div class="activity-block__header">
        <span class="ts-title-sm">按活动屏蔽</span>
        <md-text-button @click="openPicker">
          <ScanSearch :size="14" /> 扫描获取
        </md-text-button>
      </div>
      <div class="activity-block__row">
        <AppTextField
          v-model="activityInput"
          label="com.pkg/com.pkg.ActivityClass"
          @keydown.enter="addActivityEntry"
        />
        <md-filled-button :disabled="locked" @click="addActivityEntry">确认</md-filled-button>
      </div>
    </div>

    <!-- 搜索 -->
    <div class="search-row">
      <md-outlined-text-field
        :value="appsApi.searchKeyword.value"
        label="应用名称或包名"
        autocomplete="off"
        spellcheck="false"
        @input="appsApi.searchKeyword.value = $event.target.value"
      >
        <Search slot="leading-icon" :size="18" />
      </md-outlined-text-field>
      <md-filled-button :disabled="locked" @click="appsApi.save(snackbar)">
        <Save :size="16" /> 保存
      </md-filled-button>
    </div>

    <div class="count-row ts-body-sm supporting">
      <span>共 {{ appCount }} 个应用</span>
      <span v-if="appsApi.isLoading.value">加载中…</span>
    </div>

    <!-- 应用列表（虚拟滚动） -->
    <div ref="listEl" class="app-list scroll-area">
      <div v-if="appsApi.isLoading.value" class="empty-state">加载中…</div>
      <div v-else-if="appsApi.loadError.value" class="empty-state error">
        加载失败: {{ appsApi.loadError.value }}
      </div>
      <div v-else-if="appCount === 0" class="empty-state">没有匹配的应用</div>
      <div
        v-else
        class="app-virtual-spacer"
        :style="{ height: `${totalListHeight}px` }"
      >
        <div
          v-for="row in virtualRows"
          :key="row.app.packageName"
          :ref="measureElement"
          :data-index="row.index"
          class="app-virtual-item"
          :style="{ transform: `translateY(${row.start}px)` }"
        >
          <div class="app-row">
            <div class="app-row__main">
              <md-checkbox
                :checked="row.app.checked"
                :class="{
                  'is-unsaved':
                    row.app.checked && !appsApi.savedBlacklist.value.has(row.app.packageName),
                }"
                @change="row.app.checked = $event.target.checked; appsApi.reorder()"
              ></md-checkbox>
              <div class="app-row__text" @click="row.app.checked = !row.app.checked; appsApi.reorder()">
                <span class="app-row__name">
                  {{ row.app.appLabel }}
                  <span class="app-row__uid ts-body-sm supporting">{{ row.app.uid }}</span>
                </span>
                <span class="app-row__pkg ts-body-sm supporting">
                  {{ row.app.packageName }}
                  <span v-if="row.app.isSystem" class="app-row__badge">系统</span>
                </span>
              </div>
              <md-icon-button
                v-if="appsApi.hasActivity(row.app.packageName)"
                :title="row.app.expanded ? '收起活动' : '展开活动'"
                @click="row.app.expanded = !row.app.expanded"
              >
                <ChevronDown :size="18" :class="['chevron', { open: row.app.expanded }]" />
              </md-icon-button>
            </div>

            <div v-if="appsApi.hasActivity(row.app.packageName)" class="app-row__activities" :class="{ open: row.app.expanded }">
              <div
                v-for="entry in appsApi.getActivities(row.app.packageName)"
                :key="entry"
                class="activity-entry"
              >
                <span class="activity-entry__path ts-body-sm mono">
                  {{ entry.slice(row.app.packageName.length + 1) }}
                </span>
                <md-icon-button title="移除" @click="appsApi.removeActivity(entry)">
                  <X :size="16" />
                </md-icon-button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>

  <PromptDialog
    :open="manualOpen"
    headline="手动添加包名"
    label="应用包名"
    description="例如 com.example.app；若该应用不在列表中，将直接加入黑名单。"
    confirm-text="添加"
    @confirm="onManualAdd"
    @cancel="manualOpen = false"
  />

  <!-- 活动抓取向导 -->
  <md-dialog ref="pickerDialog" @closed="pickerOpen = false">
    <div slot="headline">
      <span class="picker-headline">
        <md-icon-button @click="closePicker"><ChevronLeft :size="20" /></md-icon-button>
        获取活动名
      </span>
    </div>
    <div slot="content" class="picker-content">
      <div v-if="pickerStep === 1" class="picker-step">
        <Monitor :size="48" :stroke-width="1.5" />
        <h3 class="ts-title-md">将 Web UI 挂为小窗</h3>
        <p class="ts-body supporting">
          开始之前先把当前 Web UI 切到小窗模式，这样后续可以一边操作目标应用，一边看到这里的反馈。
        </p>
        <md-filled-button @click="pickerStep = 2">已挂小窗，下一步</md-filled-button>
      </div>

      <div v-else-if="pickerStep === 2" class="picker-step">
        <Clock :size="48" :stroke-width="1.5" />
        <h3 class="ts-title-md">切换到目标界面</h3>
        <p class="ts-body supporting">
          切换到需要屏蔽的应用界面，然后点击「开始获取」。检测到非 Web UI 界面后会自动停止。
        </p>
        <p class="ts-body" :class="{ 'pulse-text': pickerPolling }">{{ pickerStatus }}</p>
        <md-filled-button :disabled="pickerPolling" @click="startPolling">开始获取</md-filled-button>
      </div>

      <div v-else class="picker-step">
        <CircleCheck :size="48" :stroke-width="1.5" />
        <h3 class="ts-title-md">检测到活动</h3>
        <p class="ts-body supporting">以下活动将被添加到按活动屏蔽列表：</p>
        <code class="picker-result ts-body mono">{{ pickerResult }}</code>
      </div>
    </div>
    <div slot="actions">
      <md-text-button v-if="pickerStep === 3" @click="pickerStep = 2; pickerPolling = false">
        重试
      </md-text-button>
      <md-filled-button v-if="pickerStep === 3" @click="confirmPicker">
        <Check :size="16" /> 确认添加
      </md-filled-button>
    </div>
  </md-dialog>
</template>

<style scoped>
.activity-block {
  display: flex;
  flex-direction: column;
  gap: var(--md-sys-spacing-2);
  padding: var(--md-sys-spacing-3);
  border-radius: var(--md-sys-shape-corner-medium);
  background-color: var(--md-sys-color-surface-container);
}

.activity-block__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--md-sys-spacing-2);
}

.activity-block__row,
.search-row {
  display: flex;
  align-items: flex-start;
  gap: var(--md-sys-spacing-2);
}

.activity-block__row > :first-child,
.search-row > :first-child {
  flex: 1;
}

.activity-block__row > md-filled-button,
.search-row > md-filled-button {
  flex: 0 0 auto;
  margin-top: 4px;
}

.count-row {
  display: flex;
  justify-content: space-between;
}

.app-list {
  max-height: 60vh;
  overflow-y: auto;
  border-radius: var(--md-sys-shape-corner-medium);
}

.app-virtual-spacer {
  position: relative;
  width: 100%;
}

.app-virtual-item {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  padding-bottom: var(--md-sys-spacing-2);
}

.app-row {
  display: flex;
  flex-direction: column;
  border-radius: var(--md-sys-shape-corner-medium);
  background-color: var(--md-sys-color-surface-container);
  overflow: hidden;
}

.app-row__main {
  display: flex;
  align-items: center;
  gap: var(--md-sys-spacing-2);
  padding: var(--md-sys-spacing-2) var(--md-sys-spacing-3);
  min-height: 64px;
}

/* 选中但尚未保存：绿色提示；保存后回到默认主色 */
md-checkbox.is-unsaved {
  --md-checkbox-selected-container-color: var(--lp-color-success);
  --md-checkbox-selected-hover-container-color: var(--lp-color-success);
  --md-checkbox-selected-focus-container-color: var(--lp-color-success);
  --md-checkbox-selected-pressed-container-color: var(--lp-color-success);
  --md-checkbox-selected-hover-state-layer-color: var(--lp-color-success);
  --md-checkbox-selected-pressed-state-layer-color: var(--lp-color-success);
  --md-checkbox-selected-icon-color: var(--md-sys-color-surface);
  --md-checkbox-selected-hover-icon-color: var(--md-sys-color-surface);
  --md-checkbox-selected-focus-icon-color: var(--md-sys-color-surface);
  --md-checkbox-selected-pressed-icon-color: var(--md-sys-color-surface);
}

/* 名称/包名区域也可点击切换（复选框本身只有 18px，触控偏小） */
.app-row__text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  cursor: pointer;
  padding: var(--md-sys-spacing-1) 0;
}

.app-row__name {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--md-sys-color-on-surface);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.app-row__uid {
  flex: 0 0 auto;
}

.app-row__pkg {
  display: flex;
  align-items: center;
  gap: 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.app-row__badge {
  flex: 0 0 auto;
  padding: 1px 6px;
  border-radius: var(--md-sys-shape-corner-full);
  background-color: var(--md-sys-color-surface-container-highest);
  font-size: var(--md-sys-typescale-label-small-size);
}

.chevron {
  transition: transform var(--md-sys-motion-duration-short4)
    var(--md-sys-motion-easing-standard);
}

.chevron.open {
  transform: rotate(180deg);
}

.app-row__activities {
  max-height: 0;
  overflow: hidden;
  transition: max-height var(--md-sys-motion-duration-medium2)
    var(--md-sys-motion-easing-emphasized);
}

.app-row__activities.open {
  max-height: 320px;
  overflow-y: auto;
}

.activity-entry {
  display: flex;
  align-items: center;
  gap: var(--md-sys-spacing-2);
  padding: 2px var(--md-sys-spacing-2) 2px var(--md-sys-spacing-4);
  border-top: 1px solid var(--md-sys-color-outline-variant);
}

.activity-entry__path {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--md-sys-color-on-surface-variant);
}

.picker-headline {
  display: flex;
  align-items: center;
  gap: var(--md-sys-spacing-2);
}

.picker-content {
  min-width: min(320px, 76vw);
}

.picker-step {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--md-sys-spacing-3);
  text-align: center;
}

.picker-step h3 {
  margin: 0;
}

.picker-step p {
  margin: 0;
}

.picker-result {
  display: block;
  width: 100%;
  padding: var(--md-sys-spacing-3);
  border-radius: var(--md-sys-shape-corner-small);
  background-color: var(--md-sys-color-surface-container-high);
  word-break: break-all;
  text-align: left;
}
</style>
