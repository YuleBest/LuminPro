<script setup>
import { inject, ref, computed, nextTick } from 'vue'
import { BookOpen, ScrollText, StickyNote, Github, ExternalLink } from 'lucide-vue-next'
import { readModuleFile } from '../api/luminpro.js'
import { runCmd, shellQuote } from '../api/ksu.js'

const status = inject('status')
const snackbar = inject('snackbar')

/** markdown-it 体积较大且只有文档页用得到，打开文档时再按需加载 */
let renderMarkdown = null
async function ensureMarkdown() {
  if (renderMarkdown) return renderMarkdown
  const { default: MarkdownIt } = await import('markdown-it')
  // README 使用了 HTML 与 GitHub 提示块（> [!TIP]），需要一并支持
  const md = new MarkdownIt({ html: true, linkify: true, breaks: true })

  md.core.ruler.push('github-alerts', (state) => {
    const tokens = state.tokens
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i]
      if (token.type !== 'blockquote_open') continue
      const inline = tokens[i + 2]
      if (!inline || inline.type !== 'inline') continue
      const match = /^\[!([A-Z]+)\]\s*/.exec(inline.content)
      if (!match) continue
      const kind = match[1].toLowerCase()
      const label = ALERT_LABELS[kind]
      if (!label) continue
      token.attrJoin('class', `md-alert md-alert--${kind}`)
      inline.content = inline.content.replace(match[0], '')
      inline.children[0].content = inline.children[0].content.replace(match[0], '')
      const marker = new state.Token('html_block', '', 0)
      marker.content = `<p class="md-alert__title">${label}</p>`
      const closeIdx = findBlockquoteClose(tokens, i)
      if (closeIdx > 0) tokens.splice(closeIdx, 0, marker)
    }
    return true
  })

  renderMarkdown = (text) => md.render(text)
  return renderMarkdown
}

/** GitHub 提示块的标题文案 */
const ALERT_LABELS = {
  note: '备注',
  tip: '提示',
  important: '重要',
  warning: '警告',
  caution: '注意',
}

/** 找到与 openIdx 配对的 blockquote_close 下标 */
function findBlockquoteClose(tokens, openIdx) {
  let depth = 0
  for (let i = openIdx; i < tokens.length; i++) {
    if (tokens[i].type === 'blockquote_open') depth++
    else if (tokens[i].type === 'blockquote_close') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

const docs = [
  { key: 'README.md', label: '模块说明', icon: BookOpen },
  { key: 'changelog.md', label: '更新日志', icon: ScrollText },
  { key: 'NOTE.txt', label: '注意事项', icon: StickyNote },
]

const docOpen = ref(false)
const docTitle = ref('')
const docHtml = ref('')
const docDialog = ref(null)
const loading = ref(false)

const module = computed(() => status.moduleInfo.value)
const version = computed(() => module.value.version || '—')
const channel = computed(() => {
  const value = module.value.channel
  if (!value || value === 'stable') return ''
  return value === 'beta' ? 'Beta' : 'Dev'
})

async function openDoc(doc) {
  loading.value = true
  docTitle.value = doc.label
  docHtml.value = ''
  docOpen.value = true
  await nextTick()
  docDialog.value?.show()

  const text = await readModuleFile(doc.key)
  loading.value = false
  if (!text.trim()) {
    docHtml.value = '<p>无法读取该文档。</p>'
    return
  }
  docHtml.value = doc.key.endsWith('.md')
    ? (await ensureMarkdown())(text)
    : `<pre class="plain">${text.replace(/</g, '&lt;')}</pre>`
}

function closeDoc() {
  docOpen.value = false
  docDialog.value?.close()
}

async function openLink(url) {
  const res = await runCmd(`am start -a android.intent.action.VIEW -d ${shellQuote(url)}`)
  if (!res.ok) snackbar('无法打开链接')
}
</script>

<template>
  <section class="section">
    <div class="section-header">
      <h2 class="section-title ts-title-md">关于 LuminPro</h2>
      <span v-if="channel" class="channel-badge">{{ channel }}</span>
    </div>

    <div class="about-meta">
      <div class="about-meta__item">
        <span class="ts-body-sm supporting">版本</span>
        <span class="ts-body mono">{{ version }}</span>
      </div>
      <div class="about-meta__item">
        <span class="ts-body-sm supporting">作者</span>
        <span class="ts-body">酷安 @于乐yule</span>
      </div>
      <div class="about-meta__item">
        <span class="ts-body-sm supporting">状态</span>
        <span class="ts-body">{{ status.statusText.value }}</span>
      </div>
    </div>

    <p class="ts-body-sm supporting">
      模块在亮度达到设定阈值时平滑提升到硬件峰值亮度，并支持休眠时段、应用黑名单与 HDR 内容避让。
    </p>
  </section>

  <section class="section">
    <h2 class="section-title ts-title-md">文档</h2>
    <div class="list">
      <button
        v-for="doc in docs"
        :key="doc.key"
        class="list-item state-layer"
        @click="openDoc(doc)"
      >
        <component :is="doc.icon" :size="18" />
        <span class="ts-body">{{ doc.label }}</span>
      </button>
    </div>
  </section>

  <section class="section">
    <h2 class="section-title ts-title-md">链接</h2>
    <div class="list">
      <button
        class="list-item state-layer"
        @click="openLink('https://github.com/YuleBest/LuminPro')"
      >
        <Github :size="18" />
        <span class="ts-body">GitHub 仓库</span>
        <ExternalLink :size="16" class="link-trail" />
      </button>
      <button
        class="list-item state-layer"
        @click="openLink('https://github.com/YuleBest/LuminPro/releases')"
      >
        <ExternalLink :size="18" />
        <span class="ts-body">版本发布与更新通道</span>
        <ExternalLink :size="16" class="link-trail" />
      </button>
    </div>
  </section>

  <md-dialog ref="docDialog" @closed="docOpen = false">
    <div slot="headline">{{ docTitle }}</div>
    <div slot="content" class="doc-content">
      <div v-if="loading" class="ts-body supporting">加载中…</div>
      <div v-else class="markdown" v-html="docHtml"></div>
    </div>
    <div slot="actions">
      <md-filled-button @click="closeDoc">关闭</md-filled-button>
    </div>
  </md-dialog>
</template>

<style scoped>
/* GitHub 提示块（> [!TIP] 等） */
.markdown :deep(.md-alert) {
  margin: 0 0 var(--md-sys-spacing-3);
  padding: var(--md-sys-spacing-3);
  border-radius: var(--md-sys-shape-corner-small);
  border-inline-start: 4px solid var(--md-sys-color-primary);
  background-color: var(--md-sys-color-surface-container);
}

.markdown :deep(.md-alert__title) {
  margin: 0 0 4px;
  font-weight: 600;
  color: var(--md-sys-color-primary);
}

.markdown :deep(.md-alert--tip) {
  border-inline-start-color: var(--lp-color-success);
}

.markdown :deep(.md-alert--tip .md-alert__title) {
  color: var(--lp-color-success);
}

.markdown :deep(.md-alert--warning),
.markdown :deep(.md-alert--caution) {
  border-inline-start-color: var(--lp-color-warning);
}

.markdown :deep(.md-alert--warning .md-alert__title),
.markdown :deep(.md-alert--caution .md-alert__title) {
  color: var(--lp-color-warning);
}

.markdown :deep(.md-alert--important) {
  border-inline-start-color: var(--md-sys-color-error);
}

.markdown :deep(.md-alert--important .md-alert__title) {
  color: var(--md-sys-color-error);
}

/* README 的居中容器与徽章 */
.markdown :deep([align='center']) {
  text-align: center;
}

.markdown :deep(img) {
  max-width: 100%;
  height: auto;
}

.about-meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--md-sys-spacing-4);
}

.about-meta__item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.list-item {
  border: 0;
  text-align: left;
  font: inherit;
  width: 100%;
}

.link-trail {
  margin-left: auto;
  color: var(--md-sys-color-on-surface-variant);
}

.doc-content {
  max-height: 60vh;
  overflow-y: auto;
  min-width: min(360px, 78vw);
}

.markdown {
  color: var(--md-sys-color-on-surface);
  font-size: var(--md-sys-typescale-body-medium-size);
  line-height: 1.7;
}

.markdown :deep(h1),
.markdown :deep(h2),
.markdown :deep(h3) {
  font-size: var(--md-sys-typescale-title-medium-size);
  line-height: var(--md-sys-typescale-title-medium-line-height);
  margin: var(--md-sys-spacing-4) 0 var(--md-sys-spacing-2);
}

.markdown :deep(h1) {
  font-size: var(--md-sys-typescale-title-large-size);
}

.markdown :deep(p),
.markdown :deep(li) {
  margin: 0 0 var(--md-sys-spacing-2);
}

.markdown :deep(code) {
  font-family: var(--md-sys-typescale-font-mono);
  background-color: var(--md-sys-color-surface-container-high);
  padding: 1px 4px;
  border-radius: var(--md-sys-shape-corner-extra-small);
}

.markdown :deep(pre) {
  background-color: var(--md-sys-color-surface-container-high);
  padding: var(--md-sys-spacing-3);
  border-radius: var(--md-sys-shape-corner-small);
  overflow-x: auto;
}

.markdown :deep(a) {
  color: var(--md-sys-color-primary);
}

.markdown :deep(.plain) {
  white-space: pre-wrap;
}

.markdown :deep(table) {
  border-collapse: collapse;
  width: 100%;
}

.markdown :deep(th),
.markdown :deep(td) {
  border-bottom: 1px solid var(--md-sys-color-outline-variant);
  padding: 6px 8px;
  text-align: left;
}
</style>
