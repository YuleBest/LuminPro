<script setup>
import { ref, onMounted, onUnmounted, watch } from 'vue';
import {
  Activity as IconActivity,
  Settings as IconSettings,
  AppWindow as IconApps,
  ScrollText as IconLog,
  Info as IconInfo,
} from 'lucide-vue-next';

const props = defineProps({ modelValue: { type: String, default: 'status' } });
const emit = defineEmits(['update:modelValue']);

const navItems = [
  { key: 'status', label: '状态', icon: IconActivity },
  { key: 'config', label: '配置', icon: IconSettings },
  { key: 'apps',   label: '黑名单', icon: IconApps },
  { key: 'log',    label: '日志', icon: IconLog },
  { key: 'about',  label: '关于', icon: IconInfo },
];

const navbarEl = ref(null);
const sliderEl = ref(null);
const btnRefs = ref([]);

function updateSlider(key, animate = true) {
  const idx = navItems.findIndex(n => n.key === key);
  if (idx < 0) return;
  const btn = btnRefs.value[idx];
  if (!btn || !sliderEl.value) return;
  if (!animate) sliderEl.value.style.transition = 'none';
  sliderEl.value.style.width = btn.offsetWidth + 'px';
  sliderEl.value.style.transform = `translateX(${btn.offsetLeft}px)`;
  if (!animate) requestAnimationFrame(() => { if (sliderEl.value) sliderEl.value.style.transition = ''; });
}

function select(key) {
  emit('update:modelValue', key);
}

watch(() => props.modelValue, v => updateSlider(v));

// ---- 拖拽逻辑 ----
let isDragging = false;
let isActuallyDragging = false;
let startX = 0;
let startSliderX = 0;

function onPointerDown(e) {
  isDragging = true;
  isActuallyDragging = false;
  startX = e.clientX;
  const idx = navItems.findIndex(n => n.key === props.modelValue);
  startSliderX = idx >= 0 && btnRefs.value[idx] ? btnRefs.value[idx].offsetLeft : 0;
}

function onPointerMove(e) {
  if (!isDragging) return;
  const dx = e.clientX - startX;
  if (!isActuallyDragging && Math.abs(dx) > 10) {
    isActuallyDragging = true;
    navbarEl.value?.setPointerCapture(e.pointerId);
  }
  if (!isActuallyDragging || !sliderEl.value) return;
  const first = btnRefs.value[0];
  const last = btnRefs.value[btnRefs.value.length - 1];
  const minX = first ? first.offsetLeft : 0;
  const maxX = last ? last.offsetLeft : 0;
  let tx = startSliderX + dx;
  if (tx < minX) tx = minX + (tx - minX) * 0.3;
  if (tx > maxX) tx = maxX + (tx - maxX) * 0.3;
  sliderEl.value.style.transition = 'none';
  sliderEl.value.style.transform = `translateX(${tx}px)`;
}

function onPointerUp(e) {
  if (!isDragging) return;
  const wasDragging = isActuallyDragging;
  isDragging = false;
  isActuallyDragging = false;
  navbarEl.value?.releasePointerCapture(e.pointerId);

  if (wasDragging && sliderEl.value) {
    const sliderRect = sliderEl.value.getBoundingClientRect();
    const navRect = navbarEl.value?.getBoundingClientRect();
    const currentX = navRect ? sliderRect.left - navRect.left : 0;
    let closest = navItems[0].key;
    let minDist = Infinity;
    btnRefs.value.forEach((btn, i) => {
      if (!btn) return;
      const dist = Math.abs(btn.offsetLeft - currentX);
      if (dist < minDist) { minDist = dist; closest = navItems[i].key; }
    });
    select(closest);
  } else {
    updateSlider(props.modelValue);
  }
}

function onResize() { updateSlider(props.modelValue, false); }

onMounted(() => {
  updateSlider(props.modelValue, false);
  window.addEventListener('resize', onResize);
});
onUnmounted(() => {
  window.removeEventListener('resize', onResize);
});
</script>

<template>
  <nav
    class="floating-navbar"
    ref="navbarEl"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
  >
    <div class="navbar-slider" ref="sliderEl"></div>

    <button
      v-for="(item, i) in navItems"
      :key="item.key"
      :ref="el => btnRefs[i] = el"
      class="navbar-btn"
      :class="{ active: modelValue === item.key }"
      :data-section="item.key"
      @click="select(item.key)"
    >
      <component :is="item.icon" :size="20" :stroke-width="1.75" />
      <span>{{ item.label }}</span>
    </button>
  </nav>
</template>
