---
title: 模块 WebUI - API 文档
shortTitle: WebUI API 文档
description: 介绍 KernelSU 模块 WebUI 的 API
isOriginal: true
author: KernelSU
date: 2026-01-25

category: ["笔记"]
tag: ["安卓", "KernelSU", "前端"]
excerpt: 这是 KernelSU 的 WebUI API 文档，由 Yule 将其翻译为中文，并新增了部分内容，方便阅读
---

> 这是 KernelSU 的 WebUI API 文档，[原文链接（英文）](https://www.npmjs.com/package/kernelsu?activeTab=readme)，由 Yule 将其翻译为中文，并新增了部分内容，方便阅读。参见：[模块 WebUI](./webui)。

---

## 安装

::: code-tabs

@tab npm

```bash
npm i kernelsu
```

@tab pnpm

```bash
pnpm add kernelsu
```

@tab yarn

```bash
yarn add kernelsu
```

:::

---

## API

### `exec`

在 **root** shell 中启动一个 shell 并运行命令。返回一个 Promise，在执行完成后返回 `stdout`（标准输出）和 `stderr`（标准错误）。

- `command <string>`：要运行的命令，参数以空格分隔。
- `options <Object`>`：
  - `cwd`：子进程的当前工作目录。
  - `env`：环境变量键值对。

```js
import { exec } from "kernelsu";

const { errno, stdout, stderr } = await exec("ls -l", { cwd: "/tmp" });
if (errno === 0) {
  // 成功时
  console.log(stdout);
}
```

### `spawn`

在 root shell 中使用给定的命令产生一个新进程，参数通过 `args` 数组传递。如果省略，`args` 默认为空数组。

返回一个 `ChildProcess` 实例，代表已启动的子进程。

- `command <string>`：要运行的命令。
- `args <string[]>`：字符串参数列表。
- `options <Object>`：
  - `cwd <string>`：子进程的工作目录。
  - `env <Object>`：环境变量。

示例：运行 `ls -lh /data` 并捕获输出和退出码：

```js
import { spawn } from "kernelsu";

const ls = spawn("ls", ["-lh", "/data"]);

ls.stdout.on("data", (data) => {
  console.log(`输出: ${data}`);
});

ls.stderr.on("data", (data) => {
  console.log(`错误: ${data}`);
});

ls.on("exit", (code) => {
  console.log(`子进程退出，退出码: ${code}`);
});
```

### `ChildProcess` (子进程类)

#### `Event 'exit'`

- `code <number>`：子进程自主退出时的退出码。

当进程结束时触发。如果进程正常退出，code 为退出码；否则为 `null`。

#### `Event 'error'`

- `err <Error>`：错误对象。

当进程无法启动或无法被杀死时触发。

#### `stdout`

表示子进程**标准输出**的数据流。

```js
const subprocess = spawn("ls");

subprocess.stdout.on("data", (data) => {
  console.log(`数据：${data}`);
});
```

#### `stderr`

表示子进程**标准错误**的数据流。

#### `fullScreen`

请求 WebView 进入或退出全屏模式。

```js
import { fullScreen } from "kernelsu";
fullScreen(true); // 进入全屏
```

#### `enableInsets`

请求 WebView 设置内边距为 0 或适配系统状态栏/导航栏的缩进（Insets）。

- 提示：此功能默认禁用。但如果你引用了 internal/insets.css 资源，它会自动启用。

- 你可以通过以下方式自动获取 Insets 值并启用：
  - 在 CSS 中添加：`@import "https://mui.kernelsu.org/internal/insets.css";`
  - 或者在 HTML 中添加：`<link rel="stylesheet" type="text/css" href="/internal/insets.css" />`

```js
import { enableInsets } from "kernelsu";
enableInsets(true);
```

#### `toast`

显示一个系统级气泡消息（Toast）。

```js
import { toast } from "kernelsu";
toast("你好，世界！");
```

#### `moduleInfo`

获取当前模块的信息。

```js
import { moduleInfo } from "kernelsu";
// 在控制台打印模块 ID
console.log(moduleInfo());
```

#### `listPackages`

列出已安装的应用包名。返回一个包名数组。

- `type <string>`：要列出的包类型："user" (用户应用), "system" (系统应用), 或 "all" (全部)。

```js
import { listPackages } from "kernelsu";
// 列出用户应用
const packages = listPackages("user");
```

- 提示：当此 API 可用时，你可以使用 `ksu://icon/{packageName}` 来获取应用图标。

```js
img.src = "ksu://icon/" + packageName;
```

#### `getPackagesInfo`

获取指定包名的详细信息。返回 PackagesInfo 对象数组。

- `packages <string[]>`：包名列表。

```js
import { getPackagesInfo } from "kernelsu";
const info = getPackagesInfo(["com.android.settings", "com.android.shell"]);
```

#### `PackagesInfo` (应用信息对象)

包含以下字段：

- `packageName <string>`：应用包名。
- `versionName <string>`：应用版本号名称。
- `versionCode <number>`：应用版本代码。
- `appLabel <string>`：应用的显示名称。
- `isSystem <boolean>`：是否为系统应用。
- `uid <number>`：应用的 UID。
