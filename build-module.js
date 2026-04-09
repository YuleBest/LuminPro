import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import archiver from 'archiver';

// 读取版本信息用以命名
const propContent = fs.readFileSync('module.prop', 'utf-8');
const versionMatch = propContent.match(/^version=(.*)$/m);
const versionCodeMatch = propContent.match(/^versionCode=(.*)$/m);

const version = versionMatch ? versionMatch[1].trim() : 'Unknown';
const versionCodeStr = versionCodeMatch ? versionCodeMatch[1].trim() : '0000';
const versionCode = parseInt(versionCodeStr, 10);

const zipName = `LuminPro_${version}.zip`;

// --- 新增: 自动同步 update.json ---
const updateJsonPath = 'update.json';
if (fs.existsSync(updateJsonPath)) {
  try {
    const updateJson = JSON.parse(fs.readFileSync(updateJsonPath, 'utf-8'));
    updateJson.versionCode = versionCode;
    updateJson.version = version;
    updateJson.zipUrl = `https://share.yule.ink/magisk/mod/luminpro/module/${zipName}`;
    fs.writeFileSync(updateJsonPath, JSON.stringify(updateJson, null, 4), 'utf-8');
    console.log(`>>> [1/3] 已同步 update.json (版本: ${version}, Code: ${versionCode})`);
  } catch (e) {
    console.error(`[错误] 无法更新 update.json: ${e.message}`);
  }
}
// ---------------------------------

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
  'build.ps1',
  'build-module.js',
  'webui', // webui 目录已经构建到 webroot
  zipName
];

console.log(`\n>>> [2/3] 生成 SHA256SUMS...`);

// 计算可执行文件（所有 .sh 脚本 + bin/ 二进制）的 SHA256
function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function collectExecutables(dir, baseDir = dir) {
  const results = [];
  for (const dirent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, dirent.name);
    const rel  = path.relative(baseDir, full).replace(/\\/g, '/');
    if (dirent.isDirectory()) {
      results.push(...collectExecutables(full, baseDir));
    } else if (dirent.name.endsWith('.sh') || dir.endsWith('bin')) {
      results.push(rel);
    }
  }
  return results;
}

const execFiles = collectExecutables('.').filter(f => !excludes.some(e => f.startsWith(e)));
const sha256Lines = execFiles.sort().map(f => `${sha256File(f)}  ${f}`);
const sha256SumsPath = 'SHA256SUMS';
fs.writeFileSync(sha256SumsPath, sha256Lines.join('\n') + '\n', 'utf-8');
console.log(`已生成 ${sha256Lines.length} 条记录:\n${sha256Lines.join('\n')}`);

console.log(`\n>>> [3/3] 创建模块 ZIP 压缩包...`);

// 初始化归档器
const output = fs.createWriteStream(zipName);
const archive = archiver('zip', {
  zlib: { level: 9 } // 最高压缩等级
});

output.on('close', function () {
  console.log(`-----------------------------------`);
  console.log(`>>> [成功] 打包完成！`);
  console.log(`输出文件: ${zipName}`);
  console.log(`文件大小: ${(archive.pointer() / 1024 / 1024).toFixed(2)} MB`);
});

archive.on('warning', function (err) {
  if (err.code === 'ENOENT') {
    console.warn('[警告]', err);
  } else {
    throw err;
  }
});

archive.on('error', function (err) {
  throw err;
});

archive.pipe(output);

// 将所有 .sh 文件统一转换为 LF 换行符，防止 Windows 环境写入 CRLF 导致 ash 报错
function fixLineEndings(dir) {
  for (const dirent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, dirent.name);
    if (dirent.isDirectory() && !excludes.includes(dirent.name)) {
      fixLineEndings(full);
    } else if (dirent.name.endsWith('.sh')) {
      const content = fs.readFileSync(full, 'utf8');
      if (content.includes('\r\n')) {
        fs.writeFileSync(full, content.replace(/\r\n/g, '\n'), 'utf8');
      }
    }
  }
}
fixLineEndings('.');

// 将没在排除列表里的文件打进去
const dirContents = fs.readdirSync('.', { withFileTypes: true });

let addedItems = [];

for (const dirent of dirContents) {
  const name = dirent.name;
  // 排除黑名单文件夹，同时排除当前目录下已经打包生成的其它压缩包（避免俄罗斯套娃）
  if (!excludes.includes(name) && !name.endsWith('.zip')) {
    addedItems.push(name);
    if (dirent.isDirectory()) {
      archive.directory(name, name);
    } else {
      archive.file(name, { name: name });
    }
  }
}

console.log(`正在打包以下内容: \n${addedItems.join(', ')}\n`);

archive.finalize();
