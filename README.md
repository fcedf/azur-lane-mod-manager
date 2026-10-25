# 文件管理系统（File Management System）

一个以 **标签即分类** 为核心理念的文件管理系统，支持 **彩色分类 · 真名归档 · 全局搜索 · 批量操作 · 二维码分享**，并提供 **网页版** 和 **Windows 桌面版** 两种形态。

> 物理文件按 `分类名/真实文件名` 直接归档到磁盘，在资源管理器里就能直观查看。

---

## ⬇️ 下载安装（普通用户）

Windows 用户无需安装 Node / Python，直接到 **[Releases](https://github.com/fcedf/azur-lane-mod-manager/releases)** 下载最新版：

- `AzurLaneModManager-Setup-x.y.z.exe`：NSIS 安装包，双击安装，创建桌面/开始菜单快捷方式，可自选安装目录，支持覆盖升级（数据不丢）。
- 首次启动可选择**文件存储目录**（默认用程序旁的 `data` 文件夹）；之后也能在托盘菜单「更改文件存储位置…」修改。

桌面版特性：启动时后端在后台自动运行（端口 3200），关闭窗口默认最小化到系统托盘；托盘右键可「打开 / 开机自启开关 / 更改文件存储位置 / 退出」。默认账号见文末。

> 安装包/免安装绿色版通过 GitHub Release 发布，**不包含在 git 仓库中**；仓库 `release/`、`runtime/` 目录已被 `.gitignore` 忽略。

---

## 一、功能特性

### 🏷️ 标签即分类

- 每个标签就是一个分类，支持自定义颜色与文件计数
- 一个文件可同时属于多个分类；物理文件只存一份（放入第一个/主分类）
- 重命名/删除分类时自动同步所有关联文件（删除分类不删文件，变为"未分类"）

### 📂 文件管理

- 点击/拖拽上传，带实时进度；上传时自动归入当前分类
- 记录文件**原始修改日期**（区别于上传时间），中文文件名不乱码
- 文件收藏，收藏文件始终置顶
- 回收站：还原 / 彻底删除 / 清空，删除有二次确认

### ⚡ 批量操作

- **批量标签**：勾选多个文件一次归类，支持「追加（去重）」和「覆盖」两种模式
- **批量删除**：勾选多个文件一次放入回收站
- **扫描文件夹压缩包**：递归扫描本地文件夹，自动识别 `.zip .rar .7z .tar .gz .bz2 .xz .iso`，列表确认后批量上传

### 🔍 查找与排序

- 全局搜索：按文件名 + 标签，多关键词（空格 AND）
- 文件类型筛选：文档 / 图片 / 视频 / 音频 / 压缩包
- 排序：名称 / 大小 / 上传日期 / 原始日期，独立的升降序按钮（中文拼音、数字自然排序）

### 🔗 分享

- 生成分享链接，可设提取密码、有效期（1/7/30 天/永久）、权限（预览/下载）
- 弹窗显示**二维码**，手机连同一 WiFi 扫码即可下载
- "我的分享"统一管理，可随时取消

### 👑 管理后台（仅管理员）

- 数据看板：用户 / 文件 / 存储总量 / 分类用量排行
- 用户管理：新建、启禁用、角色切换、重置密码
- 操作日志：全量审计，按类型 / 用户筛选，含 IP

---

## 二、技术栈

| 层级 | 技术 |
| --- | --- |
| 前端 | Vue 3 + Vite 6 + Element Plus + Pinia + Vue Router + Axios |
| 后端 | Node.js + Express 4 + JWT + Multer |
| 数据库 | SQLite（Node 内置 `node:sqlite`，免安装免编译） |
| 桌面封装 | Electron 34 + electron-builder（NSIS 安装包） |

---

## 三、桌面版使用（普通用户）

无需安装 Node、无需开终端：请到 **[Releases](https://github.com/fcedf/azur-lane-mod-manager/releases)** 下载最新 `Setup .exe` 安装包，双击安装即可（详见文首「下载安装」）。

桌面版特性：

- 启动时后端在后台自动运行（端口 3200），关闭窗口默认**最小化到系统托盘**
- 托盘图标：双击打开窗口；右键菜单可「打开 / 开机自启开关 / 更改文件存储位置 / 退出」
- 默认开启开机自启，可在托盘菜单关闭
- 全新数据库首次启动会**自动建表**并创建默认账号，无需手动 init-db

---

## 四、网页版开发启动

### 环境要求

- **Node.js ≥ 22**（需要内置 `node:sqlite`，用 `node -v` 检查）

### 第 1 步：启动后端（终端 1，端口 3000）

```bash
cd server
npm install        # 首次
npm run init-db    # 首次：建表 + 写入默认账号
npm run dev        # 热重载；或 npm start
```

### 第 2 步：启动前端（终端 2，端口 5173）

```bash
cd web
npm install        # 首次
npm run dev
```

### 第 3 步

浏览器打开 **http://localhost:5173**

> 前端通过环境自动区分：开发走 Vite 代理（history 路由），打包后指向内嵌后端（hash 路由）。

---

## 五、打包桌面版

需要自备两份内嵌运行时放到根目录 `runtime/`（因体积大、协议原因不进 git 仓库）：

```bash
# 1. 内嵌 Node（需 Node ≥22，内置 node:sqlite）
mkdir -p runtime
cp "$(which node)" runtime/node.exe          # Windows 取 node 安装目录下的 node.exe

# 2. 内嵌 Python（立绘/动态解析用）：把便携版 Python 放到 runtime/python/
#    并安装依赖：python -m pip install Pillow

# 3. 一键打包（构建前端 + 生成安装包）
npm run dist
# 或分步：npm run build:web && npx electron-builder --win
```

产物：

```
release/文件管理系统 Setup x.y.z.exe     # NSIS 安装包（随 GitHub Release 发布）
release/win-unpacked/                    # 免安装绿色版
```

> 详见 [`Electron封装指南.md`](./Electron封装指南.md)。国内网络已在根 `.npmrc` 配置 Electron 镜像。打包前请先关闭正在运行的免安装版（占用 win-unpacked 文件会导致打包失败）。

---

## 六、默认账号

| 角色 | 用户名 | 密码 |
| --- | --- | --- |
| 系统管理员 | `admin` | `admin123` |
| 普通用户 | `user` | `user123` |

> ⚠️ 生产环境请修改默认密码和 `.env` 中的 `JWT_SECRET`。

---

## 七、数据与存储结构

当前存储根目录：**`D:\fms-files`**

```
D:\fms-files\
├── fms.db              # SQLite 数据库（网页版/桌面端/脚本统一使用）
├── 德芙\
│   └── z9.zip          # 分类名/真实文件名
├── 碧蓝航线\
│   └── xxx.rar
└── 未分类\             # 未打标签的文件
    └── yyy.7z
```

| 场景 | 物理文件 |
| --- | --- |
| 上传到分类 | 直接存入 `分类/真实文件名` |
| 改分类 | 物理文件自动移动 |
| 同名 | 自动加序号：`报告.zip`、`报告(1).zip` |
| 移除标签 | 自动移回 `未分类\` |

---

## 八、目录结构

```
file-management-system/
├── package.json            # 桌面端根配置 + electron-builder
├── .npmrc                  # Electron 国内镜像
├── electron/               # 主进程 main.cjs / preload.cjs / 图标
├── runtime/
│   └── node.exe            # 内嵌 Node 22 运行时
├── server/                 # Express 后端
│   ├── .env                # 端口 / UPLOAD_DIR / DB_PATH
│   └── src/
│       ├── server.js / app.js
│       ├── config/  db/  middleware/
│       ├── routes/         # auth, spaces, folders, files, tags,
│       │                   # search, shares, publicShare, admin, system
│       └── utils/          # storage-path, file-type, datetime, logger...
├── web/                    # Vue 前端
│   └── src/{api,router,stores,layouts,components,views}
└── release/                # 打包产物
```

---

## 九、API 接口一览

统一响应：`{ "code": 0, "message": "ok", "data": {} }`（code = 0 成功）

| 模块 | 方法 | 路径 | 说明 |
| --- | --- | --- | --- |
| 认证 | POST | `/api/auth/login` | 登录 |
| 认证 | GET | `/api/auth/profile` | 当前用户 |
| 认证 | PUT | `/api/auth/password` | 改密码 |
| 分类 | GET | `/api/tags` | 分类列表（计数） |
| 分类 | POST/PUT/DELETE | `/api/tags[/:id]` | 分类增改删 |
| 文件 | GET | `/api/files/browse?tag=` | 按分类/全部浏览 |
| 文件 | GET | `/api/files` | 按空间/文件夹（兼容） |
| 文件 | POST | `/api/files/upload` | 上传（可带 tag） |
| 文件 | POST | `/api/files/upload-batch` | 批量上传 |
| 文件 | PUT | `/api/files/:id/tags` | 设置标签（迁移物理文件） |
| 文件 | POST | `/api/files/batch-tags` | 批量标签（append/replace） |
| 文件 | POST | `/api/files/batch-delete` | 批量删除 |
| 文件 | GET | `/api/files/:id/download` | 下载 |
| 文件 | PUT | `/api/files/:id/rename` `/star` `/move` | 重命名/收藏/移动 |
| 文件 | DELETE/POST | `/api/files/:id` `/restore` `/permanent` | 删除/还原/彻底删除 |
| 文件 | GET | `/api/files/recycle/list` | 回收站 |
| 搜索 | GET | `/api/search?q=` `/search/tags` | 搜索 / 标签云 |
| 分享 | POST/GET/DELETE | `/api/shares[/mine/:id]` | 分享管理 |
| 公开 | GET | `/api/public/share/:code[/download]` | 免登录访问 |
| 系统 | GET | `/api/system/lan-ip` | 局域网 IP |
| 后台 | GET | `/api/admin/stats` `/users` `/logs` | 看板/用户/日志 |
| 后台 | POST/PUT | `/api/admin/users[/:id/reset-password]` | 用户维护 |

---

## 十、配置（server/.env）

```ini
PORT=3000
JWT_SECRET=请修改为随机字符串
JWT_EXPIRES=7d
MAX_FILE_SIZE=2147483648      # 单文件上限 2GB
UPLOAD_DIR=D:/fms-files        # 文件（含数据库）存储根目录
DB_PATH=D:/fms-files/fms.db    # 数据库路径（统一，避免多库分叉）
```

> 桌面端的端口与路径由 `electron/main.cjs` 注入（端口 3200），与此处开发配置相互独立。

---

## 十一、常见问题

**Q1：启动报 `Cannot find module 'node:sqlite'`？**
Node 版本过低，升级到 v22.5+。

**Q2：桌面版双击没反应 / 端口被占？**
检查是否已有实例在运行（托盘）；本软件有单实例锁，重复点击只会聚焦已有窗口。

**Q3：文件在资源管理器里改名/移动后打不开？**
物理路径与数据库记录一一对应，改名会导致失配。请通过软件界面归类，不要直接操作磁盘文件。

**Q4：手机扫码打不开？**
确认手机连的是**同一个 WiFi**；Windows 防火墙可能拦截，需放行 Node / 对应端口。外网无法访问局域网链接。

**Q5：想重置数据？**
备份后停止服务，删除 `D:/fms-files/fms.db` 并重新 `npm run init-db`（注意配置的 DB_PATH）。

---

## 十二、后续可迭代方向

- [ ] 文件在线预览（图片 / PDF / Office / 文本）
- [ ] 分片上传 / 断点续传 / 秒传
- [ ] 文档全文检索（Meilisearch / Elasticsearch）
- [ ] 文件版本管理
- [ ] 缩略图视图、自定义应用图标
- [ ] AI 智能分类 / 语义搜索
