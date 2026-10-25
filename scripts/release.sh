#!/usr/bin/env bash
# =============================================================================
# 一键发版脚本：改版本号 -> 构建前端 -> 打包 Electron -> 提交推送源码 -> 创建 GitHub Release
#
# 用法（在项目根目录的 Git Bash 里执行）：
#   bash scripts/release.sh                      # 交互：提示输入新版本号
#   bash scripts/release.sh 1.1.3                # 指定版本号
#   bash scripts/release.sh patch                # 自动 1.1.2 -> 1.1.3
#   bash scripts/release.sh minor                # 自动 1.1.2 -> 1.2.0
#   bash scripts/release.sh major                # 自动 1.1.2 -> 2.0.0
#
# 可选：
#   bash scripts/release.sh 1.1.3 --notes-file docs/rel-1.1.3.md   # 用指定文件作为 Release 说明
#   bash scripts/release.sh 1.1.3 -m "本次更新内容"                 # 直接传 Release 说明
#   bash scripts/release.sh --push-only                            # 只提交推送代码，不打包/不发 Release
#   bash scripts/release.sh --no-tag                               # 打包+推送，但不创建 GitHub Release
#
# 环境要求：Node.js >= 22（node:sqlite）、已安装并登录 gh CLI（gh auth status 可查）、
#           runtime/node.exe 与 runtime/python 已就位（打包桌面端用）。
# =============================================================================
set -euo pipefail

# 统一 UTF-8 输出，避免中文乱码
export LANG=en_US.UTF-8 2>/dev/null || true

# ---- 定位项目根目录（scripts/ 的上一级）----
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
info()  { echo -e "${BLUE}▶${NC} $*"; }
ok()    { echo -e "${GREEN}✔${NC} $*"; }
warn()  { echo -e "${YELLOW}⚠${NC} $*"; }
die()   { echo -e "${RED}✘ $*${NC}" >&2; exit 1; }

REPO="fcedf/azur-lane-mod-manager"
SETUP_GLOB="AzurLaneModManager-Setup-*.exe"

# ---------------- 解析参数 ----------------
MODE="full"          # full | push-only | no-tag
NOTES_FILE=""
NOTES_INLINE=""
VERSION_ARG=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --push-only)    MODE="push-only"; shift ;;
    --no-tag)       MODE="no-tag"; shift ;;
    --notes-file)   NOTES_FILE="$2"; shift 2 ;;
    -m|--message)   NOTES_INLINE="$2"; shift 2 ;;
    -h|--help)      grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *)              VERSION_ARG="$1"; shift ;;
  esac
done

# ---------------- 环境检查 ----------------
command -v node >/dev/null || die "未找到 node，请先安装 Node.js >= 22"
command -v git  >/dev/null || die "未找到 git"
[[ -d .git ]] || die "当前目录不是 git 仓库：$ROOT_DIR"

if [[ "$MODE" != "push-only" ]]; then
  command -v gh >/dev/null || die "未找到 gh CLI（已安装需重开终端让 PATH 生效）"
  gh auth status >/dev/null 2>&1 || die "gh 未登录，请先执行：gh auth login"
  [[ -f runtime/node.exe ]] || warn "未找到 runtime/node.exe，打包可能失败（需 Node>=22 的 node.exe）"
  command -v python >/dev/null 2>&1 || warn "未在 PATH 找到 python（仅影响解析脚本，内嵌 runtime/python 存在即可）"
fi

# ---------------- push-only：只提交推送 ----------------
if [[ "$MODE" == "push-only" ]]; then
  info "模式：仅提交并推送源码"
  git add -A
  if git diff --cached --quiet; then
    warn "没有待提交的改动"
  else
    MSG="${NOTES_INLINE:-chore: 同步代码 $(date +%Y-%m-%d)}"
    git commit -m "$MSG"
  fi
  git push
  ok "已推送到 GitHub：https://github.com/$REPO"
  exit 0
fi

# ---------------- 确定新版本号 ----------------
CURRENT="$(node -p "require('./package.json').version")"
bump() {  # $1=当前版本 $2=patch|minor|major
  local v="$1" part="$2" major minor patch
  major="${v%%.*}"; rest="${v#*.}"; minor="${rest%%.*}"; patch="${rest#*.}"
  case "$part" in
    major) major=$((major+1)); minor=0; patch=0 ;;
    minor) minor=$((minor+1)); patch=0 ;;
    *)     patch=$((patch+1)) ;;
  esac
  echo "${major}.${minor}.${patch}"
}

if [[ -z "$VERSION_ARG" ]]; then
  echo "当前版本：$CURRENT"
  read -r -p "输入新版本号（如 1.1.3，或直接回车=patch 升级到 $(bump "$CURRENT" patch)）：" VERSION_ARG
  VERSION_ARG="${VERSION_ARG:-patch}"
fi
if [[ "$VERSION_ARG" =~ ^(patch|minor|major)$ ]]; then
  VERSION="$(bump "$CURRENT" "$VERSION_ARG")"
else
  VERSION="$VERSION_ARG"
fi
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "版本号格式不正确：$VERSION（应为 x.y.z）"

TAG="v$VERSION"
SETUP="release/AzurLaneModManager-Setup-$VERSION.exe"

echo ""
echo -e "将发布：${GREEN}$REPO $TAG${NC}"
echo -e "版本号：$CURRENT -> ${GREEN}$VERSION${NC}"
read -r -p "确认继续？(y/N) " yn
[[ "$yn" =~ ^[Yy]$ ]] || die "已取消"

# ---------------- 1) 改版本号 ----------------
info "更新 package.json 版本号 -> $VERSION"
node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json','utf8'));p.version='$VERSION';fs.writeFileSync('package.json',JSON.stringify(p,null,2)+'\n')"

# ---------------- 2) 关闭可能占用产物的免安装版 ----------------
info "关闭可能正在运行、占用 release 目录的程序（避免打包文件被占用）"
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { \$_.ExecutablePath -like '*file-management-system*release*win-unpacked*' } | ForEach-Object { Stop-Process -Id \$_.ProcessId -Force -ErrorAction SilentlyContinue }" 2>/dev/null || true
sleep 1

# ---------------- 3) 构建前端 + 打包 ----------------
info "构建前端并打包 Electron（可能需要几分钟）…"
npm run dist

[[ -f "$SETUP" ]] || die "未找到安装包：$SETUP（请检查 package.json 中 build.nsis.artifactName）"
SIZE_MB="$(du -m "$SETUP" | cut -f1)"
[[ "$SIZE_MB" -ge 50 ]] || warn "安装包只有 ${SIZE_MB}MB，体积异常，请确认打包是否完整"
ok "安装包就绪：$SETUP（${SIZE_MB} MB）"

# ---------------- 4) 提交推送源码 ----------------
info "提交并推送源码"
git add -A
if git diff --cached --quiet; then
  warn "没有代码改动需要提交（仅版本发布）"
else
  git commit -m "chore(release): 发布 v$VERSION"
fi
git push

# --no-tag：到此为止
if [[ "$MODE" == "no-tag" ]]; then
  ok "已完成打包与代码推送（未创建 Release）。安装包：$SETUP"
  exit 0
fi

# ---------------- 5) 生成 Release 说明 ----------------
NOTES_TMP=""
if [[ -n "$NOTES_FILE" ]]; then
  [[ -f "$NOTES_FILE" ]] || die "指定的 Release 说明文件不存在：$NOTES_FILE"
  NOTES_TMP="$NOTES_FILE"
elif [[ -n "$NOTES_INLINE" ]]; then
  NOTES_TMP="$(mktemp)"
  printf '%s\n' "$NOTES_INLINE" > "$NOTES_TMP"
else
  NOTES_TMP="$(mktemp)"
  cat > "$NOTES_TMP" <<EOF
# 文件管理系统 v$VERSION（Windows 桌面版）

碧蓝航线 MOD / 立绘文件管理系统：按多标签分区管理 MOD 压缩包，自动解析静态立绘 / Spine / Live2D，并可向 MuMu 模拟器或安卓真机一键注入 / 还原。

## 安装
- 下载下方 \`AzurLaneModManager-Setup-$VERSION.exe\`，双击安装（NSIS，x64，Windows 10/11）。
- 安装包未做代码签名；如出现 SmartScreen 提示，点「更多信息 → 仍要运行」。
- 支持覆盖升级，数据不受影响。默认账号：admin / admin123（登录后请修改）。

## 更新内容
- （在此补充本次更新；或下次用 --notes-file / -m 传入）
EOF
  echo ""
  warn "使用了默认 Release 说明模板，可在 GitHub 页面继续编辑。"
fi

# ---------------- 6) 创建 GitHub Release 并上传 ----------------
if gh release view "$TAG" --repo "$REPO" >/dev/null 2>&1; then
  die "Release $TAG 已存在，如需替换附件请手动处理或先删除该 Release"
fi
info "创建 GitHub Release $TAG 并上传安装包（文件较大，请耐心等待）…"
gh release create "$TAG" "$SETUP" \
  --repo "$REPO" \
  --title "文件管理系统 v$VERSION（Windows 桌面版）" \
  --notes-file "$NOTES_TMP"

# 清理临时说明文件（若为脚本生成）
if [[ -z "$NOTES_FILE" ]]; then rm -f "$NOTES_TMP"; fi

echo ""
ok "发布完成 🎉"
echo -e "  Release：${BLUE}https://github.com/$REPO/releases/tag/$TAG${NC}"
echo -e "  下载直链：${BLUE}https://github.com/$REPO/releases/download/$TAG/AzurLaneModManager-Setup-$VERSION.exe${NC}"
