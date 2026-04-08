<script setup>
import { ref, onMounted } from "vue";
import Button from "@/components/ui/Button.vue";
import { ExternalLink, FileText, BookOpen, ScrollText, StickyNote, X, Github } from "lucide-vue-next";
import { moduleInfo } from "kernelsu";
import { runCmd } from "../utils.js";

const MODULE_DIR = '/data/adb/modules/LuminPro';

const moduleVersion = ref("");
const sheetOpen = ref(false);
const sheetTitle = ref("");
const sheetContent = ref("");
const sheetLoading = ref(false);

onMounted(() => {
  try {
    const info = JSON.parse(moduleInfo());
    moduleVersion.value = info.version || '';
  } catch {
    moduleVersion.value = '[debug]';
  }
});

// 通过 KernelSU runCmd 读取模块本地文件
const moduleDocs = [
  { title: "README",        file: `${MODULE_DIR}/README.md`,    icon: BookOpen,    md: true  },
  { title: "README (EN)",   file: `${MODULE_DIR}/README_en.md`, icon: BookOpen,    md: true  },
  { title: "更新日志",       file: `${MODULE_DIR}/changelog.md`, icon: ScrollText,  md: true  },
  { title: "NOTE",          file: `${MODULE_DIR}/NOTE.txt`,     icon: StickyNote,  md: false },
];

// 通过 fetch 读取 webroot/docs/
const webDocs = [
  { title: "Web UI 使用文档", path: "/docs/webui.md",     icon: FileText },
  { title: "Web UI API 文档", path: "/docs/webui-api.md", icon: FileText },
];

function mdToHtml(text) {
  return text
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm,  "<h2>$1</h2>")
    .replace(/^# (.+)$/gm,   "<h1>$1</h1>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\n/g, "<br>");
}

async function openModuleDoc(doc) {
  sheetTitle.value = doc.title;
  sheetContent.value = "";
  sheetLoading.value = true;
  sheetOpen.value = true;
  try {
    const res = await runCmd(`cat "${doc.file}" 2>/dev/null`);
    if (res.errno !== 0 || !res.stdout.trim()) throw new Error('文件不存在或为空');
    sheetContent.value = doc.md ? mdToHtml(res.stdout) : res.stdout.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
  } catch (e) {
    sheetContent.value = `加载失败: ${e.message}`;
  } finally {
    sheetLoading.value = false;
  }
}

async function openWebDoc(doc) {
  sheetTitle.value = doc.title;
  sheetContent.value = "";
  sheetLoading.value = true;
  sheetOpen.value = true;
  try {
    const res = await fetch(doc.path);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    sheetContent.value = mdToHtml(await res.text());
  } catch (e) {
    sheetContent.value = `加载失败: ${e.message}`;
  } finally {
    sheetLoading.value = false;
  }
}

function closeSheet() {
  sheetOpen.value = false;
}
</script>

<template>
  <div style="display:contents">
  <section class="card" id="about-section">
    <!-- 项目信息 -->
    <div class="about-hero">
      <div class="about-logo">
        <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>
        </svg>
      </div>
      <h2 class="about-name">LuminPro</h2>
      <p class="about-desc">日用屏幕亮度强化</p>
      <span class="about-version-badge">{{ moduleVersion ? `v${moduleVersion}` : "V2.2" }}</span>
    </div>

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
        <ExternalLink :size="14" class="about-list-chevron" />
      </button>
    </div>

    <!-- Web UI 文档 -->
    <div class="about-section-title">Web UI 文档</div>
    <div class="about-list">
      <button
        v-for="doc in webDocs"
        :key="doc.path"
        class="about-list-item"
        @click="openWebDoc(doc)"
      >
        <component :is="doc.icon" :size="18" class="about-list-icon" />
        <span>{{ doc.title }}</span>
        <ExternalLink :size="14" class="about-list-chevron" />
      </button>
    </div>

    <!-- 链接列表 -->
    <div class="about-section-title">链接</div>
    <div class="about-list">
      <a
        class="about-list-item"
        href="https://github.com/YuleBest/LuminPro"
        target="_blank"
        rel="noopener"
      >
        <Github :size="18" class="about-list-icon" />
        <span>GitHub 项目主页</span>
        <ExternalLink :size="14" class="about-list-chevron" />
      </a>
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
