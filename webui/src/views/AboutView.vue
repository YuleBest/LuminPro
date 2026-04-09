<script setup>
import { ref } from 'vue'
import Button from '@/components/ui/Button.vue'
import { BookOpen, ScrollText, StickyNote, X, Github } from 'lucide-vue-next'
import { runCmd } from '../utils.js'

const MODULE_DIR = '/data/adb/modules/LuminPro'

const sheetOpen = ref(false)
const sheetTitle = ref('')
const sheetContent = ref('')
const sheetLoading = ref(false)

const moduleDocs = [
  { title: 'README', file: `${MODULE_DIR}/README.md`, icon: BookOpen, md: true },
  { title: 'README (EN)', file: `${MODULE_DIR}/README_en.md`, icon: BookOpen, md: true },
  { title: '更新日志', file: `${MODULE_DIR}/changelog.md`, icon: ScrollText, md: true },
  { title: 'NOTE', file: `${MODULE_DIR}/NOTE.txt`, icon: StickyNote, md: false },
]

function mdToHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br>')
}

async function openModuleDoc(doc) {
  sheetTitle.value = doc.title
  sheetContent.value = ''
  sheetLoading.value = true
  sheetOpen.value = true
  try {
    const res = await runCmd(`cat "${doc.file}" 2>/dev/null`)
    if (res.errno !== 0 || !res.stdout.trim()) throw new Error('文件不存在或为空')
    sheetContent.value = doc.md
      ? mdToHtml(res.stdout)
      : res.stdout
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/\n/g, '<br>')
  } catch (e) {
    sheetContent.value = `加载失败: ${e.message}`
  } finally {
    sheetLoading.value = false
  }
}

function closeSheet() {
  sheetOpen.value = false
}
</script>

<template>
  <div style="display: contents">
    <section class="card" id="about-section">
      <!-- 模块文档 -->
      <div class="about-section-title">模块文档</div>
      <div class="about-list">
        <button
          v-for="doc in moduleDocs"
          :key="doc.file"
          class="about-list-item"
          @click="openModuleDoc(doc)"
        >
          <component :is="doc.icon" :size="18" class="about-list-icon" />
          <span>{{ doc.title }}</span>
        </button>
      </div>

      <!-- 链接列表 -->
      <div class="about-section-title">链接</div>
      <div class="about-list">
        <button
          class="about-list-item"
          @click="
            runCmd(
              'am start -a android.intent.action.VIEW -d \'https://github.com/YuleBest/LuminPro\'',
            )
          "
        >
          <Github :size="18" class="about-list-icon" />
          <span>GitHub 项目主页</span>
        </button>
      </div>

      <p class="about-footer">Made with ❤ by Yule</p>
    </section>

    <!-- 文档底部弹出抽屉 -->
    <Teleport to="body">
      <div class="doc-sheet-backdrop" :class="{ show: sheetOpen }" @click="closeSheet"></div>
      <div class="doc-sheet" :class="{ show: sheetOpen }">
        <div class="doc-sheet-header">
          <span class="doc-sheet-title">{{ sheetTitle }}</span>
          <button class="doc-sheet-close" @click="closeSheet">
            <X :size="20" />
          </button>
        </div>
        <div class="doc-sheet-body">
          <div v-if="sheetLoading" class="doc-sheet-loading">加载中...</div>
          <!-- eslint-disable-next-line vue/no-v-html -->
          <div v-else class="doc-sheet-content" v-html="sheetContent"></div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
