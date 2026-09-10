<script setup>
import { inject, ref, computed, nextTick } from 'vue'
import { Save, RotateCcw, Settings2, ShieldCheck, Wrench, Palette, ChevronDown, ListTree } from 'lucide-vue-next'
import AppTextField from '../components/AppTextField.vue'
import AppSwitch from '../components/AppSwitch.vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'

const config = inject('config')
const prefs = inject('prefs')
const status = inject('status')
const snackbar = inject('snackbar')

const form = config.form
const locked = computed(() => status.oplock.value.locked)

const advancedOpen = ref(false)
const webuiOpen = ref(false)
const resetOpen = ref(false)
const helpOpen = ref(false)
const helpDialog = ref(null)

const INOTIFY_HELP = `支持的事件字母（与 toybox inotifyd 兼容）:
  a = accessed        读取
  c = modified        内容修改（亮度节点推荐用此，默认值）
  e = metadata change 属性变更
  w = closed (writable)   写入后关闭
  0 = closed (unwritable) 只读打开后关闭
  r = opened          打开
  n = created         创建
  d = deleted         删除（目录内）
  D = deleted (self)  自身被删除
  M = moved (self)    自身被移动
  m = moved in        移入目录
  y = moved out       移出目录
  u = unmounted       挂载卷卸载
  * = all events      全部事件`

async function openHelp() {
  helpOpen.value = true
  await nextTick()
  helpDialog.value?.show()
}

// ── 定时休眠：HHMM 起止时间 ────────────────────────────────────────
const sleepStart = computed(() => config.sleepParts.value[0] + config.sleepParts.value[1])
const sleepEnd = computed(() => config.sleepParts.value[2] + config.sleepParts.value[3])

function updateSleep(which, value) {
  const digits = String(value).replace(/\D/g, '').slice(0, 4)
  const parts = [...config.sleepParts.value]
  if (which === 'start') {
    parts[0] = digits.slice(0, 2)
    parts[1] = digits.slice(2)
  } else {
    parts[2] = digits.slice(0, 2)
    parts[3] = digits.slice(2)
  }
  form.sleep_time = `${parts[0].padEnd(2, '0')}${parts[1].padEnd(2, '0')}-${parts[2].padEnd(2, '0')}${parts[3].padEnd(2, '0')}`
}

// ── Web UI 偏好（localStorage，不写模块配置）────────────────────────
const webuiForm = ref({
  autoRefresh: prefs.autoRefresh.value,
  refreshInterval: String(prefs.refreshInterval.value),
  zoom: String(prefs.zoom.value),
  themeMode: prefs.themeMode.value,
})

const webuiDirty = computed(
  () =>
    webuiForm.value.autoRefresh !== prefs.autoRefresh.value ||
    Number(webuiForm.value.refreshInterval) !== prefs.refreshInterval.value ||
    Number(webuiForm.value.zoom) !== prefs.zoom.value ||
    webuiForm.value.themeMode !== prefs.themeMode.value,
)

function saveWebUI() {
  prefs.save(webuiForm.value)
  webuiForm.value.refreshInterval = String(prefs.refreshInterval.value)
  webuiForm.value.zoom = String(prefs.zoom.value)
  snackbar('Web UI 配置已保存')
}

async function confirmReset() {
  resetOpen.value = false
  await config.restoreBackup(snackbar)
}
</script>

<template>
  <!-- ── 亮度配置 ─────────────────────────────────────────────── -->
  <section class="section">
    <div class="section-header">
      <h2 class="section-title ts-title-md">亮度配置</h2>
      <span class="state-badge" :class="config.dirtyMain.value ? 'is-unsaved' : 'is-saved'">
        {{ config.dirtyMain.value ? '未保存' : '已保存' }}
      </span>
    </div>

    <div class="group-title ts-title-sm supporting">
      <Settings2 :size="16" aria-hidden="true" /> 亮度调节
    </div>
    <AppTextField v-model="form.ui_max_bri" type="number" min="0" label="前台最大亮度"
      supporting-text="触发亮度提升的阈值" />
    <AppTextField v-model="form.max_bri" type="number" min="0" label="峰值最大亮度"
      supporting-text="亮度提升的目标值" />
    <AppTextField v-model="form.steps_num" type="number" min="1" max="500" label="亮度提升步数"
      supporting-text="每步约 0.02 秒" />

    <md-divider></md-divider>

    <div class="group-title ts-title-sm supporting">
      <ShieldCheck :size="16" aria-hidden="true" /> 执行策略
    </div>
    <AppSwitch v-model="config.sleepEnabled.value" name="定时休眠" support="设定时段内不提升亮度" />
    <div class="collapse collapse--gap" :class="{ open: config.sleepEnabled.value }">
      <div class="sleep-row">
        <AppTextField
          :model-value="sleepStart"
          label="开始 (HHMM)"
          @update:model-value="updateSleep('start', $event)"
        />
        <AppTextField
          :model-value="sleepEnd"
          label="结束 (HHMM)"
          @update:model-value="updateSleep('end', $event)"
        />
      </div>
    </div>
    <AppSwitch v-model="config.autoBriSleep.value" name="自动亮度时休眠" support="系统自动亮度开启时不提升" />
    <AppSwitch
      v-model="config.displayHdrSleep.value"
      name="显示 HDR 内容时休眠"
      support="比率 ≥ 进入阈值休眠，≤ 退出阈值恢复"
    />
    <div class="collapse collapse--gap" :class="{ open: config.displayHdrSleep.value }">
      <div class="sleep-row">
        <AppTextField
          v-model="form.hdr_enter_ratio"
          type="number"
          step="0.01"
          min="1"
          max="5"
          label="进入阈值"
          supporting-text="≥ 该比率时休眠"
        />
        <AppTextField
          v-model="form.hdr_exit_ratio"
          type="number"
          step="0.01"
          min="1"
          max="5"
          label="退出阈值"
          supporting-text="≤ 该比率时恢复"
        />
      </div>
    </div>
    <AppSwitch
      v-model="config.compatibilityMode.value"
      name="兼容模式（轮询驱动）"
      support="不使用事件监听，改为 2 秒一次轮询"
      warning="仅在事件驱动失效时开启，会略微增加耗电"
    />

    <div class="actions">
      <md-outlined-button :disabled="locked" @click="resetOpen = true">
        <RotateCcw :size="16" /> 恢复默认
      </md-outlined-button>
      <md-filled-button
        :disabled="locked || !config.dirtyMain.value"
        @click="config.saveMain(snackbar)"
      >
        <Save :size="16" /> 保存配置
      </md-filled-button>
    </div>
  </section>

  <!-- ── 高级设置 ─────────────────────────────────────────────── -->
  <section class="section">
    <button class="section-header toggle" @click="advancedOpen = !advancedOpen">
      <h2 class="section-title ts-title-md">高级设置</h2>
      <span class="state-badge" :class="config.dirtyAdvanced.value ? 'is-unsaved' : 'is-saved'">
        {{ config.dirtyAdvanced.value ? '未保存' : '已保存' }}
      </span>
      <ChevronDown :size="18" class="chevron" :class="{ open: advancedOpen }" />
    </button>

    <div class="collapse collapse--gap" :class="{ open: advancedOpen }">
      <div class="collapse-inner">
        <div class="group-title ts-title-sm supporting">
          <Wrench :size="16" aria-hidden="true" /> 运行环境
        </div>
        <AppSwitch
          v-model="config.debugMode.value"
          name="调试模式"
          support="记录详细事件到日志"
          warning="需重启模块生效，用完请关闭"
        />
        <div class="field-row">
          <AppTextField
            v-model="form.inotify_events"
            label="监听事件"
            supporting-text="默认 c，改后需重启模块"
          />
          <md-text-button @click="openHelp">
            <ListTree :size="16" /> 支持的事件
          </md-text-button>
        </div>
        <AppTextField
          v-model="form.now_bri_file"
          label="当前亮度节点"
          supporting-text="改后需重启模块"
        />
        <AppTextField
          v-model="form.max_bri_file"
          label="最大亮度节点"
          supporting-text="改后需重启模块"
        />

        <md-divider></md-divider>

        <div class="group-title ts-title-sm supporting">
          <Settings2 :size="16" aria-hidden="true" /> 系统管理
        </div>
        <AppTextField
          v-model="form.log_max_size"
          type="number"
          min="1"
          max="10240"
          label="日志大小限制 (KB)"
        />
        <md-outlined-select
          label="日志等级"
          supporting-text="低于此级别不写入日志"
          :value="form.log_level"
          @change="form.log_level = $event.target.value"
        >
          <md-select-option value="off"><div slot="headline">关闭</div></md-select-option>
          <md-select-option value="error"><div slot="headline">仅错误</div></md-select-option>
          <md-select-option value="warn"><div slot="headline">警告+</div></md-select-option>
          <md-select-option value="info"><div slot="headline">全部</div></md-select-option>
        </md-outlined-select>

        <div class="actions">
          <md-filled-button
            :disabled="locked || !config.dirtyAdvanced.value"
            @click="config.saveAdvanced(snackbar)"
          >
            <Save :size="16" /> 保存设置
          </md-filled-button>
        </div>
      </div>
    </div>
  </section>

  <!-- ── Web UI 配置 ──────────────────────────────────────────── -->
  <section class="section">
    <button class="section-header toggle" @click="webuiOpen = !webuiOpen">
      <h2 class="section-title ts-title-md">Web UI 配置</h2>
      <span class="state-badge" :class="webuiDirty ? 'is-unsaved' : 'is-saved'">
        {{ webuiDirty ? '未保存' : '已保存' }}
      </span>
      <ChevronDown :size="18" class="chevron" :class="{ open: webuiOpen }" />
    </button>

    <div class="collapse collapse--gap" :class="{ open: webuiOpen }">
      <div class="collapse-inner">
        <div class="group-title ts-title-sm supporting">
          <Palette :size="16" aria-hidden="true" /> 界面设置
        </div>
        <AppSwitch v-model="webuiForm.autoRefresh" name="自动刷新" support="定时拉取状态与日志" />
        <AppTextField
          v-model="webuiForm.refreshInterval"
          type="number"
          min="100"
          label="刷新间隔 (ms)"
          supporting-text="最小 100"
        />
        <md-outlined-select
          label="外观主题"
          :value="webuiForm.themeMode"
          @change="webuiForm.themeMode = $event.target.value"
        >
          <md-select-option value="system"><div slot="headline">跟随系统</div></md-select-option>
          <md-select-option value="light"><div slot="headline">浅色</div></md-select-option>
          <md-select-option value="dark"><div slot="headline">深色</div></md-select-option>
        </md-outlined-select>
        <AppTextField
          v-model="webuiForm.zoom"
          type="number"
          min="50"
          max="150"
          label="界面缩放 (%)"
          supporting-text="50–150，立即生效"
        />

        <div class="actions">
          <md-filled-button :disabled="!webuiDirty" @click="saveWebUI">
            <Save :size="16" /> 保存配置
          </md-filled-button>
        </div>
      </div>
    </div>
  </section>

  <ConfirmDialog
    :open="resetOpen"
    headline="恢复默认配置"
    description="将载入安装时备份的配置到表单，需再点击保存才会写入。确定继续吗？"
    confirm-text="载入备份"
    @confirm="confirmReset"
    @cancel="resetOpen = false"
  />

  <md-dialog ref="helpDialog" @closed="helpOpen = false">
    <div slot="headline">支持的事件字母</div>
    <pre slot="content" class="help-text">{{ INOTIFY_HELP }}</pre>
    <div slot="actions">
      <md-filled-button @click="helpOpen = false">知道了</md-filled-button>
    </div>
  </md-dialog>
</template>

<style scoped>
.group-title {
  display: flex;
  align-items: center;
  gap: var(--md-sys-spacing-2);
  margin-top: var(--md-sys-spacing-2);
}

.section-header.toggle {
  width: 100%;
  background: none;
  border: 0;
  padding: 0;
  cursor: pointer;
  text-align: left;
}

.chevron {
  transition: transform var(--md-sys-motion-duration-medium2)
    var(--md-sys-motion-easing-emphasized);
  color: var(--md-sys-color-on-surface-variant);
}

.chevron.open {
  transform: rotate(180deg);
}

.collapse-inner {
  display: flex;
  flex-direction: column;
  gap: var(--md-sys-spacing-3);
}

.sleep-row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--md-sys-spacing-2);
}

.field-row {
  display: flex;
  align-items: center;
  gap: var(--md-sys-spacing-2);
}

.field-row > :first-child {
  flex: 1;
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--md-sys-spacing-2);
  padding-top: var(--md-sys-spacing-2);
}

.help-text {
  margin: 0;
  white-space: pre-wrap;
  font-family: var(--md-sys-typescale-font-mono);
  font-size: var(--md-sys-typescale-body-small-size);
  line-height: 1.6;
}
</style>
