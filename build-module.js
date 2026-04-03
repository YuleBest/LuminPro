import fs from 'fs';
import archiver from 'archiver';

// 读取版本信息用以命名
const propContent = fs.readFileSync('module.prop', 'utf-8');
const versionMatch = propContent.match(/^version=(.*)$/m);
const versionCodeMatch = propContent.match(/^versionCode=(.*)$/m);

const version = versionMatch ? versionMatch[1].trim() : 'Unknown';
const versionCode = versionCodeMatch ? versionCodeMatch[1].trim() : '0000';

const zipName = `LuminPro_${version}-${versionCode}.zip`;

console.log(`\n>>> [2/2] 创建模块 ZIP 压缩包...`);

// 明确需要忽略的文件清单
const excludes = [
  'docs',
  'node_modules',
  'package-lock.json',
  'package.json',
  'pnpm-lock.yaml',
  'vite.config.js',
  'src',
  'public',
  '.vscode',
  '.git',
  '.gitignore',
  'build.ps1',
  'build-module.js',
  'index.html', // 根目录的 html 已构建至 webroot
  zipName
];

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
