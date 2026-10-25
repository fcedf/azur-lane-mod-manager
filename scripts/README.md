# 发版脚本

把「改版本号 → 打包 → 提交推送 → 创建 GitHub Release 并上传安装包」一键完成。

## 文件

| 文件 | 用途 |
| --- | --- |
| `release.sh` | 发版主脚本（Git Bash 运行） |
| `release.bat` | Windows 双击包装，自动找 Git Bash 并调用 `release.sh` |

## 前置条件

1. **Node.js ≥ 22**（用到内置 `node:sqlite`）。
2. 已安装 **GitHub CLI** 并登录：
   ```bash
   winget install --id GitHub.cli -e --source winget
   gh auth login      # 选 GitHub.com → HTTPS → 浏览器设备码授权
   ```
   用 `gh auth status` 确认已登录。
3. 打包桌面端需要内嵌运行时（不进 git 仓库，需自备在项目根目录 `runtime/`）：
   - `runtime/node.exe`（Node ≥22）
   - `runtime/python/`（便携 Python，装好 Pillow：`python -m pip install Pillow`）
   只发网页版/只推代码可不需要。
4. 打包前请**关闭正在运行的免安装版**（`release/win-unpacked` 里的程序会占用文件导致打包失败）；脚本也会尝试自动关闭。

## 用法

在**项目根目录**打开 Git Bash：

```bash
# 交互式（会提示输入版本号，直接回车 = 补丁号 +1）
bash scripts/release.sh

# 指定版本号
bash scripts/release.sh 1.1.3

# 自动按语义化版本递增：patch=1.1.2→1.1.3，minor→1.2.0，major→2.0.0
bash scripts/release.sh patch

# 附带 Release 说明（Markdown 文件）
bash scripts/release.sh 1.1.3 --notes-file docs/rel-1.1.3.md

# 直接给一句更新说明
bash scripts/release.sh 1.1.3 -m "修复若干问题，优化下载体验"

# 只提交推送代码，不打包、不发 Release
bash scripts/release.sh --push-only

# 打包 + 推送，但先不创建 Release（想稍后手动发）
bash scripts/release.sh 1.1.3 --no-tag
```

或者在资源管理器里**双击 `release.bat`**，按提示输入版本号即可。

## 脚本做了什么

1. 检查 node / git / gh / 登录状态 / runtime 是否就位；
2. 校验并更新 `package.json` 里的 `version`；
3. 尝试关闭占用 `release/win-unpacked` 的运行中程序；
4. `npm run dist`（构建前端 + electron-builder 打 NSIS 安装包）；
5. 校验安装包存在且体积正常；
6. `git add/commit/push` 推送源码；
7. 生成（或使用你提供的）Release 说明，`gh release create vX.Y.Z` 创建发布并上传安装包；
8. 输出版本页与下载直链。

## 产物命名

- NSIS 安装包由 `package.json` 的 `build.nsis.artifactName` 控制，直接输出英文名：
  `release/AzurLaneModManager-Setup-x.y.z.exe`（GitHub Release 友好，避免中文被自动改名）。
- 免安装版目录 `release/win-unpacked/` 内程序名仍为中文「文件管理系统.exe」。
- `release/` 整个目录被 `.gitignore` 忽略，安装包只通过 GitHub Release 分发，不进仓库。

## 注意

- Release 标签已存在时脚本会中止，避免误覆盖；要重发请先在 GitHub 删除该 Release（或删本地 tag）。
- 大安装包通过手机热点等慢网络上传可能较久，属正常现象，请勿中断。
