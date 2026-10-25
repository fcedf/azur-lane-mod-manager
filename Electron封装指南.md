# 文件管理系统 Electron 桌面端封装指南

> 版本：v1.0
> 更新日期：2026-10-08
> 目标：把现有「Vue 前端 + Express 后端」封装成一个可双击安装运行的 Windows 软件（`.exe`）
> 特点：**最大化复用现有代码**，用户无需安装 Node、无需开终端、无需浏览器

---

## 一、封装后效果

- 一个 **`.exe` 安装包**，双击安装，桌面生成图标
- 双击图标直接打开应用窗口，**后端在程序内部自动后台运行，用户全程无感**
- 沿用现有数据：`D:\fms-files`（上传文件 + 数据库）
- 可扩展：系统托盘、开机自启、自动更新、文件关联
- 手机扫码分享功能可保留（连同一 WiFi）

---

## 二、整体架构

```
┌────────────────────────────────────┐
│   Electron 窗口                     │
│   （加载 Vue 打包后的静态页面）       │
│            │ 请求                    │
│            ▼                        │
│   程序内部自动启动的 Express 后端     │  ← 复用现有 server/src
│            │                        │
│            ▼                        │
│   D:\fms-files （uploads + fms.db） │  ← 沿用现有数据
└────────────────────────────────────┘
```

**启动流程**：双击图标 → 主进程 fork 出 Express 子进程 → 轮询健康检查确认就绪 → 创建窗口加载页面。

---

## 三、技术选型

| | **Electron（本方案采用）** | Tauri（备选） |
| --- | --- | --- |
| 安装包体积 | 约 90–130 MB | 约 5–15 MB |
| 与现有代码契合度 | ⭐⭐⭐⭐⭐ 直接内嵌 Express + Vue | 需把 Node 后端作为 sidecar |
| 环境要求 | 只需 Node（已有） | 额外安装 Rust 工具链 |
| 改造成本 | 低 | 中高 |
| 代表产品 | VS Code、Discord、Slack | — |

---

## 四、需要新增的文件

### 4.1 目录结构（改造后）

```
file-management-system/
├── package.json              # 【新增】桌面端根配置 + electron-builder
├── electron/                 # 【新增】Electron 主进程
│   ├── main.js
│   └── preload.js
├── server/                   # 现有后端（基本不动）
└── web/                      # 现有前端（改 3 处配置）
```

### 4.2 `electron/main.js`（主进程）

```js
import { app, BrowserWindow } from 'electron';
import { fork } from 'node:child_process';
import path from 'node:path';

let win = null;
let serverProc = null;

const PORT = 3199;
const SERVER_ENTRY = path.join(process.resourcesPath, 'server/src/server.js');

/** 启动内嵌 Express 后端 */
function startServer() {
  serverProc = fork(SERVER_ENTRY, [], {
    env: {
      ...process.env,
      PORT: String(PORT),
      HOST: '127.0.0.1',
      DB_PATH: 'D:/fms-files/fms.db',
      UPLOAD_DIR: 'D:/fms-files',
    },
    stdio: 'ignore',
  });
  serverProc.on('exit', () => { serverProc = null; });
}

/** 轮询健康检查，等待后端就绪 */
function waitForServer(retries = 30) {
  return new Promise((resolve, reject) => {
    const tick = async (left) => {
      try {
        const res = await fetch(`http://127.0.0.1:${PORT}/api/health`);
        if (res.ok) return resolve();
      } catch { /* 未就绪，重试 */ }
      if (left <= 0) return reject(new Error('后端启动超时'));
      setTimeout(() => tick(left - 1), 200);
    };
    tick(retries);
  });
}

/** 创建主窗口 */
async function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1000,
    minHeight: 680,
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'assets/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  await win.loadFile(path.join(process.resourcesPath, 'web/dist/index.html'));
}

app.whenReady().then(async () => {
  startServer();
  try {
    await waitForServer();
  } catch (e) {
    console.error(e.message);
  }
  await createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// 全部窗口关闭：退出（macOS 除外）
app.on('window-all-closed', () => {
  if (serverProc) { try { serverProc.kill(); } catch { /* ignore */ } }
  if (process.platform !== 'darwin') app.quit();
});
```

### 4.3 `electron/preload.js`（预加载，可先留空）

```js
// 如需向渲染进程暴露安全 API，可通过 contextBridge 在此声明
// contextBridge.exposeInMainWorld('desktop', { isDesktop: true });
export {};
```

### 4.4 根 `package.json`

```json
{
  "name": "fms-desktop",
  "version": "1.0.0",
  "private": true,
  "description": "文件管理系统桌面版",
  "main": "electron/main.js",
  "scripts": {
    "dev:electron": "electron .",
    "build:web": "npm --prefix web run build",
    "dist": "npm run build:web && electron-builder --win"
  },
  "devDependencies": {
    "electron": "^33.0.0",
    "electron-builder": "^25.0.0"
  },
  "build": {
    "appId": "com.yourname.fms",
    "productName": "文件管理系统",
    "directories": {
      "output": "release"
    },
    "files": [
      "electron/**/*"
    ],
    "extraResources": [
      { "from": "server/src", "to": "server/src" },
      { "from": "server/package.json", "to": "server/package.json" },
      { "from": "server/node_modules", "to": "server/node_modules" },
      { "from": "web/dist", "to": "web/dist" }
    ],
    "asarUnpack": [
      "server/node_modules/better-sqlite3/**/*"
    ],
    "win": {
      "target": "nsis",
      "icon": "electron/assets/icon.png"
    },
    "nsis": {
      "oneClick": false,
      "perMachine": false,
      "allowElevation": true,
      "allowToChangeInstallationDirectory": true,
      "createDesktopShortcut": true,
      "createStartMenuShortcut": true,
      "shortcutName": "文件管理系统"
    }
  }
}
```

> 说明：`files` 只打包 Electron 主进程；后端源码、依赖、前端产物通过 `extraResources` 复制到安装目录的 `resources/` 下，供主进程用 `process.resourcesPath` 读取。

---

## 五、前端必须改的 3 处（不改会白屏）

| # | 改动 | 文件 | 内容 |
| --- | --- | --- | --- |
| ① | 路由改 **Hash 模式** | `web/src/router/index.js` | `createWebHistory()` → `createWebHashHistory()` |
| ② | Vite 加 **相对路径** | `web/vite.config.js` | 增加 `base: './'` |
| ③ | API 指向内嵌服务 | `web/src/utils/request.js` | baseURL 改为 `http://127.0.0.1:3199/api` |

### 5.1 路由改动

```js
// web/src/router/index.js
import { createRouter, createWebHashHistory } from 'vue-router';
const router = createRouter({
  history: createWebHashHistory(), // 打包后 file:// 打开必须用 hash
  routes,
});
```

### 5.2 Vite 配置

```js
// web/vite.config.js
export default defineConfig({
  base: './',           // 新增：相对路径
  plugins: [vue()],
  server: { /* 开发配置保持不变 */ },
});
```

### 5.3 请求地址

```js
// web/src/utils/request.js
const request = axios.create({
  baseURL: 'http://127.0.0.1:3199/api', // 桌面端指向内嵌后端
  timeout: 30000,
});
```

> 💡 建议：把端口等做成可配置常量（开发用 Vite 代理、桌面用内嵌地址），通过环境变量 `import.meta.env` 区分，避免两套代码。

---

## 六、操作步骤（完整 8 步）

### 第 0 步：配置国内镜像（重要，否则下载极慢）

在终端中设置环境变量（Windows PowerShell）：

```powershell
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
$env:ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"
```

Git Bash：

```bash
export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
export ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/
```

### 第 1 步：在项目根安装依赖

```bash
cd file-management-system
npm i -D electron electron-builder
```

### 第 2 步：完成前端 3 处改动

见第五章（hash 路由 / base / API 地址）。

### 第 3 步：开发模式跑通

```bash
npx electron .
```

确认：窗口能打开、能登录、文件列表正常、上传下载正常。**务必先在此步验证完毕再打包。**

### 第 4 步：打包前端

```bash
npm run build:web
# 等价于 cd web && npm run build
```

确认 `web/dist/` 下生成 `index.html` 和 `assets/`。

### 第 5 步：打包安装包

```bash
npx electron-builder --win
```

### 第 6 步：获取产物

```
release/文件管理系统 Setup 1.0.0.exe
```

### 第 7 步：安装运行

双击 `Setup.exe` → 选择安装目录 → 桌面生成图标 → 双击即可使用。

---

## 七、必须注意的坑（本项目特有）

### ⚠️ 坑 1：`node:sqlite` 在 Electron 中可能不可用（最大风险）

- 现有后端使用 Node v22 内置的实验模块 `node:sqlite`
- Electron 自带的 Node 版本不一定包含该实验模块，会报 `Cannot find module 'node:sqlite'`

**应对方案**：改回 `better-sqlite3`

```bash
cd server
npm i better-sqlite3
```

```js
// server/src/db/index.js
import Database from 'better-sqlite3';
const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
export default db;
```

- electron-builder 会自动下载/重建预编译版本，**通常不需要安装 Visual Studio**
- 已在根 `package.json` 的 `asarUnpack` 中配置 `better-sqlite3` 解包（原生模块不能放在 asar 内）
- **动手第一件事：先验证当前 Electron 版本是否支持 `node:sqlite`，再决定是否切换**

### ⚠️ 坑 2：数据库和上传目录不能打包进程序内部

- 安装目录（`app.asar`）是只读的，运行时无法写入
- 解决：数据放到外部目录。本项目已配置 `D:\fms-files`，主进程通过环境变量 `DB_PATH` / `UPLOAD_DIR` 传给后端，直接沿用

### ⚠️ 坑 3：保留手机扫码分享

- 桌面端后端默认监听 `127.0.0.1`，手机无法访问
- 如需手机功能：让后端监听 `0.0.0.0`，并在 Windows 防火墙放行对应端口（如 3199）
- 链接 IP 仍通过 `/api/system/lan-ip` 获取

### 其他注意

- **未签名 exe**：可能被个别杀毒软件 SmartScreen 拦截/误报，个人使用可忽略；正式分发需购买代码签名证书
- **端口冲突**：固定端口 3199 有小概率被占用，稳妥做法是让后端自动选可用端口并回传给主进程
- **路径含中文/空格**：fork 与资源路径注意用 `path.join` 处理

---

## 八、打包前检查清单

- [ ] Electron 版本的 Node 是否支持 `node:sqlite`？不支持则已切换 `better-sqlite3`
- [ ] 前端路由已改为 `createWebHashHistory`
- [ ] Vite 已设置 `base: './'`
- [ ] API baseURL 已指向 `http://127.0.0.1:3199/api`
- [ ] `npx electron .` 开发模式下：登录 / 列表 / 上传 / 下载 / 搜索 / 回收站全部正常
- [ ] 数据目录 `D:\fms-files` 存在且可写
- [ ] `web/dist` 已重新构建
- [ ] （可选）已配置应用图标 `electron/assets/icon.png`（建议 256×256 以上 PNG）
- [ ] （可选）防火墙放行、托盘、自启等增强项

---

## 九、可选增强

| 功能 | 说明 |
| --- | --- |
| 系统托盘 | 关闭窗口最小化到托盘，后台运行 |
| 开机自启 | `app.setLoginItemSettings({ openAtLogin: true })` |
| 自动更新 | electron-updater + 静态服务器 / GitHub Releases |
| 文件关联 | 双击特定类型文件用本软件打开 |
| 单实例锁 | `app.requestSingleInstanceLock()`，防止多开启动多个后端 |
| 应用菜单 | 自定义菜单、快捷键 |

---

## 十、预计工作量

- 结构改造：约 2–3 小时
- 兼容性处理（SQLite 等）：1–3 小时
- 打包与调试安装包：1–2 小时
- **合计：顺利约大半天，遇环境问题约 1 天**

---

## 附：快速回滚

封装改造不影响现有网页版。若桌面版出问题：

- 前端改动可用 git 或手动还原（hash→history、删 base、还原 baseURL）
- 数据始终在 `D:\fms-files`，网页版 `npm run dev` 照常使用

---

*文档结束 —— 建议正式动手时，先做「坑 1」的 SQLite 兼容性验证，再逐步推进，每步可运行验证后再进入下一步。*
