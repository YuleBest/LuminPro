# LuminPro 开发文档 (Development Guide)

欢迎回到 LuminPro 的开发！本指南旨在帮助开发者快速找回开发节奏，了解项目结构、构建流程以及如何进行本地调试。

> [!IMPORTANT]
> **无需本地环境全套配置**：本项目已配置完善的 GitHub Actions，每次推送代码到 `main` 分支或发布标签 (`v*`)，云端会自动完成前端编译、Go 交叉编译、单元测试及模块打包，并生成可直接刷入的 ZIP 包。

---

## 1. 项目架构概览

LuminPro 是一个基于 KernelSU WebUI 的 Android 亮度增强模块，底层为 Go 常驻守护进程，前端为 Vue 3。

- `go/`: Go 源码。`cmd/luminpro` 是入口，`internal/` 下按职责分包（见第 5 节）。
- `webui/`: 基于 Vite + Vue 3 的前端源码。
- `bin/`: 编译产物 `luminpro`（CI 生成，不进版本库）。
- `script/`: 仅保留 `restart.sh` 等转发脚本。
- `webroot/`: WebUI 编译产物存放地，模块刷入后 KernelSU 会读取此处。
- `module.prop`: 模块基础信息。
- `build-module.js`: 模块自动化打包脚本。

---

## 2. 环境搭建 (本地)

- **Node.js**: 推荐 v18+ (项目中使用 pnpm/npm)，用于 WebUI 与打包。
- **Go**: 1.26+，用于守护进程开发与测试（交叉编译到 Android 无需 NDK）。

```bash
cd go
go vet ./... && go test ./...          # 全部逻辑均可在 host 上测试
CGO_ENABLED=0 GOOS=android GOARCH=arm64 go build -trimpath -ldflags="-s -w" -o ../bin/luminpro ./cmd/luminpro
```

守护进程支持 `LUMINPRO_MODDIR` 环境变量覆盖模块目录，配合自定义 `now_bri_file` 即可在电脑上直接跑通全流程（详见第 8 节）。

---

## 3. WebUI 开发

WebUI 是 Vue 3 + Vite 单页应用，UI 基于 **Material Design 3**（`@material/web` 组件 + 自有 MD3 token）。

### 目录结构

```
webui/src/
  mwc.js              @material/web 按需引入清单（唯一入口，勿在别处 import）
  theme/tokens.css    MD3 令牌：颜色全角色 / 字阶 / 形状 / 动效 / 状态层
  theme/base.css      字体、重置、insets、缩放、排版与表面工具类
  theme/components.css 跨视图模式（设置行、状态徽标、折叠区、状态网格、列表行）
  theme/app.css       壳层布局（顶栏、页面轨、导航栏、操作锁横幅、snackbar）
  api/ksu.js          exec 封装 + shellQuote + 开发环境 mock
  api/luminpro.js     Go JSON API 客户端
  composables/        useStatus / useConfig / useLog / useApps / useSnackbar
  components/         顶栏、导航栏、对话框、菜单、snackbar、操作锁横幅
  views/              状态 / 配置 / 黑名单 / 日志 / 关于（样式写在各自的 <style scoped>）
```

### 数据层规则

- 所有模块读写都走 Go 的 JSON API（`luminpro status|oplock|brightness|config|log|focus`），
  **不要新增 `cat` / `echo >` / `printf >` 这类直接读写文件的命令**——参数校验与原子写都在 Go 侧
- 传给 Go 的参数一律用 `shellQuote()` 包装，禁止把未校验输入直接拼进命令
- 模块状态放 `config.json`（由 Go 管理）；`localStorage` 只放主题、缩放、刷新频率等纯前端偏好

### 本地预览

```bash
pnpm install
pnpm dev
```

> [!TIP]
> 普通浏览器没有 KernelSU bridge，`exec` 会失败；此时 `api/devMock.js` 会返回模拟数据（仅 DEV 构建），
> 界面可以正常调试。真机行为请在 KernelSU 管理器的「自定义页面」中验证。

### 编译前端

生成的静态文件会自动同步到根目录的 `webroot/`。

```bash
pnpm build:webui   # 仅编译前端
pnpm build         # 前端 + 模块打包（需要 bin/luminpro 已存在）
```

---

## 4. 分支与发布通道

| 分支 | 通道 | 包内 `updateJson` | 说明 |
| --- | --- | --- | --- |
| `dev` | 开发 | 无 | 日常开发；产物为 Actions artifact，手动刷入 |
| `beta` | 预览 | `beta/update-beta.json` | 预发布版，GitHub Release 标记为 prerelease |
| `main` | 正式 | `main/update.json` | 正式版 |

通道由**刷入的包**决定：KernelSU 只读取已安装模块 `module.prop` 里的 `updateJson`，
所以正式版用户永远不会收到 beta 包，反之亦然。`zipUrl` 必须指向 GitHub Release 资产
（或 raw），不再使用第三方镜像。

### 版本号规范

`version` 采用语义化命名（不含 versionCode），`versionCode` 单独维护：

```
versionCode = 基础号 × 100 + 段位
基础号     = 主版本 × 10000 + 次版本 × 100 + 修订
```

以 `V2.5.0` 为例，基础号为 `20500`，末两位即段位：

| 段位 | 段位值 | version 示例 | versionCode |
| --- | --- | --- | --- |
| dev | `01–49` | `V2.5.0-dev.1` | `2050001` |
| beta | `51–59` | `V2.5.0-beta.1` | `2050051` |
| 正式 | `90`（9x） | `V2.5.0` | `2050090` |

末两位约定：**`5x` 表示 beta，`9x` 表示正式版**。排序恒为
`dev < beta < 同周期正式版`：dev 测试者可平滑收到 beta，beta 用户会平滑收到同周期的
正式版。只有从 beta/dev 回退到已发布的正式版才需要手动刷包（管理器不支持降级）。

tag 名 = version 的小写形式（如 `v2.5.0-beta.1`），Release 资产名为
`LuminPro_<version>.zip`。

### 发布流程

```bash
# 1) 在对应分支改 module.prop 的 version / versionCode
# 2) 生成更新清单（会写入 update.json / update-beta.json，需一并提交）
node build-module.js --channel=stable   # main 分支
node build-module.js --channel=beta     # beta 分支
# 3) 提交后打 tag（tag 名 = 版本号小写），推送即触发 CI 建 Release
git tag v2.5.0-beta.1 && git push origin v2.5.0-beta.1
```

CI 会依次：跑 Go 单测 → 交叉编译 → 按通道打包 → 建 GitHub Release 并上传
`LuminPro_<version>.zip`（beta 自动标记 prerelease）。更新清单里的 `zipUrl` 精确指向该
资产，所以**版本号与资产文件名必须一致**。

分支推送（非 tag）只产出带短哈希的 artifact，不建 Release；默认通道是 `dev`，本地
`node build-module.js` 不会改动任何清单文件。

---

## 5. Go 守护进程开发

`go/` 下按职责分包，判定逻辑与 IO 分离，便于在电脑上测试：

| 包 | 职责 |
| --- | --- |
| `cmd/luminpro` | 子命令入口：`daemon` / `boost` / `restart` / `config` |
| `internal/inotify` | 原始 inotify 封装（事件字母与 toybox 兼容，含防抖与事件排空） |
| `internal/policy` | 纯判定逻辑：休眠时段、阈值、黑名单、HDR 迟滞状态机 |
| `internal/brightness` | 亮度节点读写与渐变序列计算 |
| `internal/system` | `dumpsys` / `settings` 调用，接口化以便注入假实现 |
| `internal/config` | config.json 读写、补默认值、旧配置迁移（安装脚本用它替代 jq） |
| `internal/logging` | service.log 写入（格式与 WebUI 过滤兼容） |
| `internal/api` | WebUI 的 JSON API：状态聚合、操作锁、daemon 状态文件、日志解析 |
| `internal/daemon` | 主循环、操作锁、boost / restart 实现 |

WebUI 使用的子命令（全部输出 JSON）：

| 子命令 | 用途 |
| --- | --- |
| `status [--no-display]` | 聚合状态；`--no-display` 跳过 dumpsys/settings 供高频刷新 |
| `oplock` | 操作锁状态（含类型文案，供横幅显示） |
| `focus` | 当前前台 Activity（黑名单的活动抓取向导） |
| `brightness set <值>` | 设置亮度（校验范围后持锁写入） |
| `config read \| patch <json>` | 读取 / 浅合并写入配置（patch 走 argv 或 stdin，严格校验类型） |
| `log tail [-n N] [--raw] \| clear \| export [目录]` | 日志读取与导出 |

```bash
cd go
go test ./...                # 全部单测（含真 inotify 集成测试）
go test ./internal/policy/ -v   # 只跑判定逻辑
```

---

## 6. 模块打包脚本

`build-module.js` 负责版本同步、生成校验和并打包。打包前需要先有 `bin/luminpro`：

```bash
# 自动执行：前端编译 + 模块打包（不含 Go 编译）
npm run build

# 完整本地构建：
cd go && CGO_ENABLED=0 GOOS=android GOARCH=arm64 go build -trimpath -ldflags="-s -w" -o ../bin/luminpro ./cmd/luminpro && cd ..
node build-module.js
```

---

## 7. 核心逻辑说明

- **service.sh**: 开机入口，等待系统就绪后拉起 `luminpro daemon`。
- **luminpro daemon**: 常驻进程，负责监听、判定、渐变写入、状态文件维护。
- **luminpro boost** / **boost.sh**: 一键提升至峰值亮度 / 恢复原亮度。
- **luminpro restart** / **script/restart.sh**: 通知守护进程重建监听；未运行时按需拉起。
- **customize.sh**: 刷入时的安装逻辑（校准向导、旧配置迁移），配置读写全部调用
  `luminpro config ...`，模块内不再需要 jq。
- **action.sh**: 快捷启停（管理器操作按钮），仅切换 `pid/stop.flag`。

### 操作锁 (oplock)

`pid/oplock` 是守护进程与 WebUI 之间的约定文件，内容是 JSON：
`{"pid":…,"kind":"ramp|boost|restart|manual","startedAt":…}`。

任何会写亮度节点或重建监听的操作（渐变期间、`boost` 全程、`restart` 全程、WebUI 手动设置亮度）
都会在开始时写入、结束时删除。WebUI 通过 `luminpro oplock` 查询，锁定时暂停状态刷新并禁用
写操作入口（配置保存、黑名单保存、亮度滑条、重启模块），顶部按 `kind` 显示具体提示。

- 查询约定：文件存在且其中的 PID 在 `/proc` 中存活 → 锁定中；否则视为遗留锁，由查询方
  就地清理（避免进程被 SIGKILL 后 WebUI 永久卡在锁定态）。
- 兼容旧版裸 PID 格式的锁文件。
- `service.sh` 开机时清理该文件；WebUI 侧的实现见 `webui/src/composables/useOplock.js`。

---

## 8. 调试技巧

- **查看日志**: WebUI 日志页，或 `tail -f /data/adb/modules/LuminPro/service.log`。
- **手动触发**: `/data/adb/modules/LuminPro/boost.sh`。
- **配置文件**: `/data/adb/modules/LuminPro/config/config.json`。
- **在电脑上跑守护进程**（无需真机）：

```bash
mkdir -p /tmp/lp/{config,pid} && printf 1200 > /tmp/lp/brightness
cp bin/luminpro /tmp/lp/   # 或用 go build 出的 host 版二进制
LUMINPRO_MODDIR=/tmp/lp ./luminpro config init
LUMINPRO_MODDIR=/tmp/lp ./luminpro config set now_bri_file=/tmp/lp/brightness ui_max_bri=1000 max_bri=3000
LUMINPRO_MODDIR=/tmp/lp ./luminpro daemon &
printf 1500 > /tmp/lp/brightness   # 模拟用户调高亮度，观察日志与节点变化
```

`dumpsys` / `settings` 在电脑上不存在时按「无数据」降级，不影响验证监听与渐变主流程。

---

祝你开发愉快！如有疑问，请查阅 [README.md](./README.md) 或提交 Issue。
