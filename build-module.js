import fs from 'fs'
import path from 'path'
import os from 'os'
import crypto from 'crypto'
import archiver from 'archiver'

const REPO = 'YuleBest/LuminPro'

// ---------------------------------
// 发布通道: --channel=dev(默认) | beta | stable
//   dev    不写更新清单，包内 module.prop 去掉 updateJson（不参与自动更新）
//   beta   写 update-beta.json，包内 module.prop 指向 beta 分支清单
//   stable 写 update.json，包内 module.prop 指向 main 分支清单
// 通道由「刷入的包」决定：KernelSU 只读取已安装模块 module.prop 里的 updateJson。
// ---------------------------------
const CHANNELS = {
  dev: { manifest: null, jsonBranch: 'dev', nameSuffix: ' (Dev)' },
  beta: { manifest: 'update-beta.json', jsonBranch: 'beta', nameSuffix: ' (Beta)' },
  stable: { manifest: 'update.json', jsonBranch: 'main', nameSuffix: '' },
}

const channelArg = process.argv.slice(2).find((arg) => arg.startsWith('--channel='))
const channel = channelArg ? channelArg.split('=')[1] : 'dev'
if (!CHANNELS[channel]) {
  console.error(`[错误] 未知通道: ${channel}（可选 dev / beta / stable）`)
  process.exit(1)
}
const { manifest, jsonBranch, nameSuffix } = CHANNELS[channel]

// 读取版本信息用以命名
const propContent = fs.readFileSync('module.prop', 'utf-8')
const versionMatch = propContent.match(/^version=(.*)$/m)
const versionCodeMatch = propContent.match(/^versionCode=(.*)$/m)

const version = versionMatch ? versionMatch[1].trim() : 'Unknown'
const versionCodeStr = versionCodeMatch ? versionCodeMatch[1].trim() : '0000'
const versionCode = parseInt(versionCodeStr, 10)

const zipName = `LuminPro_${version}.zip`
// 发布 tag 约定为版本号小写，Release 资产文件名即 zipName
const tag = version.toLowerCase()
const zipUrl = `https://github.com/${REPO}/releases/download/${tag}/${zipName}`

console.log(`\n>>> 通道: ${channel} | 版本: ${version} (${versionCode})`)

// --- 同步更新清单（仅 stable / beta）---
if (manifest) {
  const payload = {
    versionCode,
    version,
    zipUrl,
    changelog: `https://raw.githubusercontent.com/${REPO}/${jsonBranch}/changelog.md`,
  }
  fs.writeFileSync(manifest, JSON.stringify(payload, null, 4) + '\n', 'utf-8')
  console.log(`>>> [1/3] 已写入 ${manifest}`)
  console.log(`          zipUrl: ${zipUrl}`)
} else {
  console.log('>>> [1/3] dev 通道不生成更新清单')
}

// --- 生成通道专用的 module.prop（不改动仓库内文件）---
const propEntries = []
for (const line of propContent.split('\n')) {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) continue
  const idx = trimmed.indexOf('=')
  if (idx > 0) propEntries.push([trimmed.slice(0, idx), trimmed.slice(idx + 1)])
}
const setProp = (key, value) => {
  const found = propEntries.find(([k]) => k === key)
  if (found) found[1] = value
  else propEntries.push([key, value])
}

if (nameSuffix) {
  const nameEntry = propEntries.find(([k]) => k === 'name')
  setProp('name', `${nameEntry ? nameEntry[1] : 'LuminPro'}${nameSuffix}`)
}
if (channel === 'dev') {
  const idx = propEntries.findIndex(([k]) => k === 'updateJson')
  if (idx >= 0) propEntries.splice(idx, 1)
} else {
  setProp('updateJson', `https://raw.githubusercontent.com/${REPO}/${jsonBranch}/${manifest}`)
}

const generatedProp = propEntries.map(([k, v]) => `${k}=${v}`).join('\n') + '\n'
const propTmpPath = path.join(os.tmpdir(), `luminpro-module-${process.pid}.prop`)
fs.writeFileSync(propTmpPath, generatedProp, 'utf-8')

// 明确需要忽略的文件清单
const excludes = [
  'docs',
  'node_modules',
  'package-lock.json',
  'package.json',
  'pnpm-lock.yaml',
  '.vscode',
  '.git',
  '.gitignore',
  '.github',
  '.oxfmtrc.json',
  '.oxlintrc.json',
  'build.ps1',
  'build-module.js',
  'webui', // webui 目录已经构建到 webroot
  'go', // Go 源码，编译产物已复制到 bin/
  'dist', // 本地下载的构建产物
  '.zcode', // 编辑器/会话临时文件
  zipName,
]

console.log(`\n>>> [2/3] 生成 SHA256SUMS...`)

// 计算可执行文件（所有 .sh 脚本 + bin/ 二进制）的 SHA256
function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

function collectExecutables(dir, baseDir = dir) {
  const results = []
  for (const dirent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, dirent.name)
    const rel = path.relative(baseDir, full).replace(/\\/g, '/')
    if (dirent.isDirectory()) {
      results.push(...collectExecutables(full, baseDir))
    } else if (dirent.name.endsWith('.sh') || dir.endsWith('bin')) {
      results.push(rel)
    }
  }
  return results
}

const execFiles = collectExecutables('.').filter((f) => !excludes.some((e) => f.startsWith(e)))
const sha256Lines = execFiles.sort().map((f) => `${sha256File(f)}  ${f}`)
const sha256SumsPath = 'SHA256SUMS'
fs.writeFileSync(sha256SumsPath, sha256Lines.join('\n') + '\n', 'utf-8')
console.log(`已生成 ${sha256Lines.length} 条记录:\n${sha256Lines.join('\n')}`)

console.log(`\n>>> [3/3] 创建模块 ZIP 压缩包...`)

// 初始化归档器
const output = fs.createWriteStream(zipName)
const archive = archiver('zip', {
  zlib: { level: 9 }, // 最高压缩等级
})

output.on('close', function () {
  fs.rmSync(propTmpPath, { force: true })
  console.log(`-----------------------------------`)
  console.log(`>>> [成功] 打包完成！`)
  console.log(`输出文件: ${zipName}`)
  console.log(`文件大小: ${(archive.pointer() / 1024 / 1024).toFixed(2)} MB`)
})

archive.on('warning', function (err) {
  if (err.code === 'ENOENT') {
    console.warn('[警告]', err)
  } else {
    throw err
  }
})

archive.on('error', function (err) {
  fs.rmSync(propTmpPath, { force: true })
  throw err
})

archive.pipe(output)

// 将所有 .sh 文件统一转换为 LF 换行符，防止 Windows 环境写入 CRLF 导致 ash 报错
function fixLineEndings(dir) {
  for (const dirent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, dirent.name)
    if (dirent.isDirectory() && !excludes.includes(dirent.name)) {
      fixLineEndings(full)
    } else if (dirent.name.endsWith('.sh')) {
      const content = fs.readFileSync(full, 'utf8')
      if (content.includes('\r\n')) {
        fs.writeFileSync(full, content.replace(/\r\n/g, '\n'), 'utf8')
      }
    }
  }
}
fixLineEndings('.')

// 将没在排除列表里的文件打进去
const dirContents = fs.readdirSync('.', { withFileTypes: true })

let addedItems = []

for (const dirent of dirContents) {
  const name = dirent.name
  // module.prop 用通道专用副本替代，跳过仓库内的原文件
  if (name === 'module.prop') {
    continue
  }
  // 排除黑名单文件夹，同时排除当前目录下已经打包生成的其它压缩包（避免俄罗斯套娃）
  if (!excludes.includes(name) && !name.endsWith('.zip')) {
    addedItems.push(name)
    if (dirent.isDirectory()) {
      archive.directory(name, name)
    } else {
      archive.file(name, { name: name })
    }
  }
}

archive.file(propTmpPath, { name: 'module.prop' })
addedItems.push('module.prop')

console.log(`正在打包以下内容: \n${addedItems.join(', ')}\n`)

archive.finalize()
