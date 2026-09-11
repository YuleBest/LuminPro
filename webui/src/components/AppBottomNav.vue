<script setup>
import { Activity, SlidersHorizontal, LayoutList, ScrollText, Info } from 'lucide-vue-next'

defineProps({
  modelValue: { type: String, required: true },
})
const emit = defineEmits(['update:modelValue'])

const tabs = [
  { key: 'status', label: '状态', icon: Activity },
  { key: 'config', label: '配置', icon: SlidersHorizontal },
  { key: 'apps', label: '黑名单', icon: LayoutList },
  { key: 'log', label: '日志', icon: ScrollText },
  { key: 'about', label: '关于', icon: Info },
]
</script>

<template>
  <nav class="bottom-nav">
    <md-navigation-bar>
      <md-navigation-tab
        v-for="tab in tabs"
        :key="tab.key"
        :label="tab.label"
        :active="modelValue === tab.key"
        @click="emit('update:modelValue', tab.key)"
      >
        <component :is="tab.icon" slot="active-icon" :size="24" />
        <component :is="tab.icon" slot="inactive-icon" :size="24" />
      </md-navigation-tab>
    </md-navigation-bar>
  </nav>
</template>
