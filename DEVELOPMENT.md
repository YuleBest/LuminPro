# LuminPro 开发文档 (Development Guide)

欢迎回到 LuminPro 的开发！本指南旨在帮助开发者快速找回开发节奏，了解项目结构、构建流程以及如何进行本地调试。

> [!IMPORTANT]
> **无需本地环境全套配置**：本项目已配置完善的 GitHub Actions，每次推送代码到 `main` 分支或发布标签 (`v*`)，云端会自动完成前端编译、Rust 交叉编译及模块打包，并生成可直接刷入的 ZIP 包。

---

## 1. 项目架构概览

LuminPro 是一个基于 KernelSU WebUI 的 Android 亮度增强模块，结合了 Rust 底层监听与 Vue.js 前端控制。

- `webui/`: 基于 Vite + Vue 3 的前端源码。
- `rust/`: 负责底层文件监听的二进制程序 (`lumipro`) 源码。
- `bin/`: 存放预编译的二进制文件（如 `jq`, `lumipro`）。
- `script/`: 核心逻辑 shell 脚本（守护进程、逻辑触发等）。
- `webroot/`: WebUI 编译产物存放地，模块刷入后 KernelSU 会读取此处。
- `module.prop`: 模块基础信息。
- `build-module.js`: 模块自动化打包脚本。

---

## 2. 环境搭建 (本地)

如果你仅进行 WebUI 界面调整或脚本逻辑修改，只需安装 Node.js：

- **Node.js**: 推荐 v18+ (项目中使用 pnpm/npm)

如果你需要**在本地编译 Rust 程序**（通常不需要，建议交给云端），才需要安装以下工具：

- **Rust**: 需要安装 Android Target: `rustup target add aarch64-linux-android`
- **Android NDK**: 交叉编译所需 (推荐 r27c+)。
- **cargo-ndk**: 安装命令: `cargo install cargo-ndk`

---

## 3. WebUI 开发

WebUI 负责所有可视化配置与状态显示。

### 本地预览

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev
```

> [!TIP]
> 由于 WebUI 依赖 `kernelsu` JavaScript API，在普通浏览器中预览时，部分 API 调用（如 `exec`）会失效。建议配合 KernelSU 管理器的「自定义页面」功能进行实机调试。

### 编译前端

生成的静态文件会自动同步到根目录的 `webroot/`。

```bash
npm run build
```

---

## 4. 自动化构建 (推荐方式)

本项目依赖 GitHub Actions 进行稳定构建，避免本地环境差异导致的编译问题。

### 触发流程

1. **推送代码**：修改代码并 `git push` 后，GitHub 会自动启动 [Build & Package Module] 工作流。
2. **下载产物**：
   - 流程结束后，在 GitHub Actions 运行记录的 **Artifacts** 栏目中可下载编译好的 ZIP 模块。
   - 产物文件名格式为：`LuminPro_V2.x.x-shortsha.zip`。

---

## 5. Rust 底层开发 (可选)

`lumipro` 源码位于 `rust/`。通常修改逻辑后直接推送即可，若需本地测试编译：

```bash
cd rust
cargo ndk -t arm64-v8a --platform 26 build --release
cp target/aarch64-linux-android/release/lumipro ../bin/lumipro
```

---

## 6. 模块打包脚本

`build-module.js` 负责版本同步、生成校验和并打包。即便不在本地编译 Rust，你也可以用它临时打包当前目录文件：

```bash
# 自动执行：前端编译 + 模块打包
npm run build

# 仅打包（不重编前端）：
node build-module.js
```

---

## 7. 核心逻辑说明

- **service.sh**: 模块启动入口，负责拉起守护进程。
- **script/daemon.sh**: 持续监控 `lumipro` 进程，并处理亮度提升逻辑。
- **customize.sh**: 刷入时的安装逻辑，处理初次校准与文件权限。
- **action.sh**: 快捷操作逻辑（音量键或管理器按钮触发）。

---

## 8. 调试技巧

- **查看日志**: 在 WebUI 界面、日志页，或执行 `tail -f /data/adb/modules/luminpro/luminpro.log`。
- **手动触发逻辑**: 执行 `/data/adb/modules/luminpro/boost.sh`。
- **配置文件**: `/data/adb/modules/luminpro/config/config.json`。

---

祝你开发愉快！如有疑问，请查阅 [README.md](./README.md) 或提交 Issue。
