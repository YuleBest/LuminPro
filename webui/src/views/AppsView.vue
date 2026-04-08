<script setup>
import { inject, ref, computed, onMounted, reactive } from "vue";
import { getPackagesInfo } from "kernelsu";
import { useApps } from "@/composables/useApps.js";
import { runCmd } from "../utils.js";
import Button from "@/components/ui/Button.vue";
import {
  RefreshCw, Eye, EyeOff, Sparkles, Plus, CheckCheck, Square,
  CheckSquare, Search, X, Check, ChevronDown, ScanSearch,
  ChevronLeft, Monitor, Clock, CircleCheck,
} from "lucide-vue-next";

const showToast = inject("showToast");
const appsMenuOpen = ref(false);

const {
  apps, isLoading, loadError, searchKeyword, showingSystemApps,
  savedBlacklist, activityEntries,
  load, save,
  hasActivity, getActivities, addActivity, removeActivity,
  onCheckboxChange,
  toggleSystemApps, selectAll, selectNone, invertSelection, smartSelect,
  getFilteredApps,
} = useApps();

const filteredApps = computed(() => getFilteredApps());
const appCount = computed(() => filteredApps.value.length);

onMounted(() => load());

// 关闭下拉菜单 (点击外部)
function handleBodyClick() { appsMenuOpen.value = false; }

// 按活动屏蔽
const activityInput = ref("");
function doAddActivity() {
  const val = activityInput.value.trim();
  if (!val) return;
  const parts = val.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    showToast("格式错误，请输入 包名/完整活动类名");
    return;
  }
  addActivity(val);
  activityInput.value = "";
  showToast(`已添加: ${val}`);
}

// 手动添加包名
async function handleManualAdd() {
  appsMenuOpen.value = false;
  const pkg = prompt("请输入完整应用包名（例如: com.example.app）：");
  if (!pkg?.trim()) return;
  const realPkg = pkg.trim();
  const existing = apps.value.find((a) => a.packageName === realPkg);
  if (existing) {
    existing.checked = true;
    onCheckboxChange();
    showToast("已为你自动勾选并置顶");
    return;
  }
  showToast("正在获取应用信息...");
  let appData = {
    packageName: realPkg,
    appLabel: "未知 (手动添加)",
    isSystem: false,
    uid: "自定义",
  };
  try {
    const info = await getPackagesInfo([realPkg]);
    if (info?.length > 0) appData = info[0];
  } catch {}
  apps.value.unshift(reactive({ ...appData, checked: true, expanded: false }));
  onCheckboxChange();
  showToast("已添加到列表顶部");
}

// Activity Picker
const pickerVisible = ref(false);
const pickerStep = ref(1);
const pickerStatusText = ref("等待中...");
const pickerPolling = ref(false);
const pickerResult = ref("");
let pollingTimer = null;

function openPicker() {
  stopPolling();
  pickerStep.value = 1;
  pickerStatusText.value = "等待中...";
  pickerResult.value = "";
  pickerPolling.value = false;
  pickerVisible.value = true;
}
function closePicker() {
  stopPolling();
  pickerVisible.value = false;
}
function stopPolling() {
  if (pollingTimer) {
    clearInterval(pollingTimer);
    pollingTimer = null;
  }
}
function startPolling() {
  pickerPolling.value = true;
  pickerStatusText.value = "检测中，请切换到目标界面...";
  stopPolling();
  pollingTimer = setInterval(async () => {
    try {
      const res = await runCmd(
        `dumpsys window 2>/dev/null | grep mCurrentFocus | sed 's/.*u0 \\(.*\\)}/\\1/'`
      );
      if (res.errno !== 0) return;
      const activity = res.stdout.trim();
      if (!activity || activity.toLowerCase().includes("webui")) return;
      stopPolling();
      pickerPolling.value = false;
      pickerResult.value = activity;
      pickerStep.value = 3;
    } catch {}
  }, 600);
}
function confirmPicker() {
  if (!pickerResult.value) return;
  addActivity(pickerResult.value);
  showToast(`已添加: ${pickerResult.value}`);
  closePicker();
}
</script>

<template>
  <div style="display:contents">
  <section class="card" id="apps-section">
    <div class="card-header" style="margin-bottom: 8px">
      <h2>黑名单</h2>
      <div class="header-actions dropdown-container">
        <Button variant="ghost" size="icon" @click="load">
          <RefreshCw :size="18" />
        </Button>
        <Button variant="ghost" size="icon" @click="appsMenuOpen = !appsMenuOpen">
          <span class="sr-only">更多</span>
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="1" /><circle cx="12" cy="5" r="1" /><circle cx="12" cy="19" r="1" />
          </svg>
        </Button>
        <div class="dropdown-menu" :class="{ show: appsMenuOpen }" @click.stop>
          <div class="dropdown-item" @click="toggleSystemApps(); appsMenuOpen = false">
            <component :is="showingSystemApps ? EyeOff : Eye" :size="18" />
            <span>{{ showingSystemApps ? "隐藏系统应用" : "显示系统应用" }}</span>
          </div>
          <div class="dropdown-item" @click="smartSelect(); appsMenuOpen = false">
            <Sparkles :size="18" /><span>智能选择</span>
          </div>
          <div class="dropdown-item" @click="handleManualAdd">
            <Plus :size="18" /><span>手动添加包名</span>
          </div>
          <div class="dropdown-item" @click="selectAll(); appsMenuOpen = false">
            <CheckCheck :size="18" /><span>全选</span>
          </div>
          <div class="dropdown-item" @click="selectNone(); appsMenuOpen = false">
            <Square :size="18" /><span>全不选</span>
          </div>
          <div class="dropdown-item" @click="invertSelection(); appsMenuOpen = false">
            <CheckSquare :size="18" /><span>反选</span>
          </div>
        </div>
      </div>
    </div>

    <p class="app-list-hint">
      被选中的应用将不生效本模块<br />推荐选择视频类、相册等需展示 HDR 内容的应用
    </p>

    <!-- 按活动屏蔽 -->
    <div class="activity-block-card">
      <div class="activity-block-header">
        <span class="activity-block-label">按活动屏蔽</span>
        <button class="btn-picker-trigger" @click="openPicker">
          <ScanSearch :size="12" /> 扫描获取
        </button>
      </div>
      <div class="activity-block-row">
        <input
          v-model="activityInput"
          type="text"
          class="activity-block-input"
          placeholder="com.pkg/com.pkg.ActivityClass"
          autocomplete="off"
          spellcheck="false"
          @keydown.enter="doAddActivity"
        />
        <Button
          style="padding: 0 14px; border-radius: var(--border-radius-s); font-size: 0.8125rem; white-space: nowrap; flex-shrink: 0"
          @click="doAddActivity"
          >确认</Button
        >
      </div>
    </div>

    <!-- 搜索栏 + 保存 -->
    <div style="display: flex; gap: 8px; align-items: stretch; margin-bottom: var(--spacing-m)">
      <div class="app-search-container" style="flex: 1; margin-bottom: 0">
        <Search :size="18" class="search-icon" />
        <input
          v-model="searchKeyword"
          type="text"
          class="app-search-input"
          placeholder="应用名称或包名"
          autocomplete="off"
          spellcheck="false"
        />
        <span class="count-badge">{{ appCount }}</span>
      </div>
      <Button
        style="padding: 0 16px; border-radius: var(--border-radius-s); font-size: 0.8125rem; white-space: nowrap; flex-shrink: 0"
        @click="save(showToast)"
        >保存</Button
      >
    </div>

    <!-- 应用列表 -->
    <div class="app-list-container" id="app-list-container">
      <div
        v-if="isLoading"
        style="text-align: center; padding: 20px; color: var(--md-sys-color-on-surface-variant)"
      >
        加载中...
      </div>
      <div
        v-else-if="loadError"
        style="text-align: center; padding: 20px; color: var(--md-sys-color-error)"
      >
        加载失败: {{ loadError }}
      </div>
      <div v-else v-for="app in filteredApps" :key="app.packageName" class="app-list-item">
        <div class="app-item-main-row">
          <label class="app-checkbox-label">
            <input
              type="checkbox"
              class="app-checkbox"
              :class="{ unsaved: app.checked && !savedBlacklist?.has(app.packageName) }"
              :data-pkg="app.packageName"
              v-model="app.checked"
              @change="onCheckboxChange"
            />
            <span
              class="app-checkbox-custom"
              :class="{ partial: !app.checked && hasActivity(app.packageName) }"
            ></span>
          </label>
          <div class="app-info">
            <span class="app-name">
              {{ app.appLabel }}
              <span class="app-uid">{{ app.uid }}</span>
            </span>
            <span class="app-pkg">
              {{ app.packageName }}
              <span v-if="app.isSystem" class="app-badge">系统</span>
            </span>
          </div>
          <button
            v-if="hasActivity(app.packageName)"
            class="app-activities-chevron"
            :class="{ expanded: app.expanded }"
            @click.stop="app.expanded = !app.expanded"
          >
            <ChevronDown :size="16" />
          </button>
        </div>
        <!-- 活动列表 -->
        <div
          v-if="hasActivity(app.packageName)"
          class="app-activities-list"
          :class="{ show: app.expanded }"
        >
          <div
            v-for="entry in getActivities(app.packageName)"
            :key="entry"
            class="activity-entry-item"
          >
            <span class="activity-entry-path">{{
              entry.slice(app.packageName.length + 1)
            }}</span>
            <button class="activity-entry-delete" @click="removeActivity(entry)">
              <X :size="14" />
            </button>
          </div>
        </div>
      </div>
    </div>
  </section>

  <!-- Activity Picker 覆盖层 -->
  <Teleport to="body">
    <div
      class="activity-picker-overlay"
      :class="{ show: pickerVisible }"
      id="activity-picker-overlay"
    >
      <div class="activity-picker-header">
        <button class="picker-back-btn" @click="closePicker">
          <ChevronLeft :size="20" />
        </button>
        <span class="picker-title">获取活动名</span>
      </div>
      <div class="picker-steps-indicator">
        <div
          v-for="n in 3"
          :key="n"
          class="picker-step-dot"
          :class="{ active: pickerStep === n }"
        ></div>
      </div>
      <div class="activity-picker-body">
        <!-- 步骤 1 -->
        <div class="picker-step" v-show="pickerStep === 1">
          <div class="picker-step-icon"><Monitor :size="52" stroke-width="1.5" /></div>
          <h3 class="picker-step-title">将 Web UI 挂小窗</h3>
          <p class="picker-step-desc">
            在开始获取前，请先将当前 Web UI 调整为<strong>小窗模式</strong>。<br /><br />
            这样在后续步骤中，你可以同时操作目标应用并看到 Web UI 的反馈。
          </p>
          <Button class="picker-action-btn" @click="pickerStep = 2">已挂小窗，下一步</Button>
        </div>
        <!-- 步骤 2 -->
        <div class="picker-step" v-show="pickerStep === 2">
          <div class="picker-step-icon"><Clock :size="52" stroke-width="1.5" /></div>
          <h3 class="picker-step-title">切换到目标界面</h3>
          <p class="picker-step-desc">
            点击「开始获取」后，切换到需要屏蔽的应用界面。<br /><br />
            检测到非 Web UI 界面后将<strong>自动停止</strong>。<br /><br />
            <span class="picker-status-text" :class="{ polling: pickerPolling }">{{
              pickerStatusText
            }}</span>
          </p>
          <Button class="picker-action-btn" :disabled="pickerPolling" @click="startPolling"
            >开始获取</Button
          >
        </div>
        <!-- 步骤 3 -->
        <div class="picker-step" v-show="pickerStep === 3">
          <div class="picker-step-icon">
            <CircleCheck :size="52" stroke-width="1.5" />
          </div>
          <h3 class="picker-step-title">检测到活动</h3>
          <p class="picker-step-desc">以下活动将被添加到按活动屏蔽列表：</p>
          <div class="picker-result-box">{{ pickerResult }}</div>
          <div class="picker-result-actions">
            <Button
              variant="secondary"
              @click="pickerStep = 2; pickerPolling = false; stopPolling()"
              >重试</Button
            >
            <Button @click="confirmPicker"><Check :size="15" /> 确认添加</Button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
  </div>
</template>
