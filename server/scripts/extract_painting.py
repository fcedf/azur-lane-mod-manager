# -*- coding: utf-8 -*-
"""
压缩包内 Unity 贴图提取 Worker（通用递归版）
由 Node 后端通过子进程调用。

用法:
    python extract_painting.py <压缩包绝对路径> <缓存输出目录>

能力:
  - 支持 .zip / .rar / .7z（按文件头自动识别）
  - 资源目录可在【任意层级】（如 "伏波新年/painting/xxx"）
  - 自动【递归解压嵌套压缩包】（如 "肇和新年.rar" 内的 "肇和3.rar"）
  - 仅提取路径中含 painting / paintingface / herohrzicon / shipyardicon / squareicon 段的资源
  - 用"来源"区分嵌套包中的同名版本（普通版 / 遮眼版）

输出（stdout 最后一行）:
    JSON: {"ok": true, "images": [ {key,name,group,groupKey,source,width,height,size,thumb} ]}
    或    {"ok": false, "error": "..."}
"""
import os
import sys
import json
import shutil
import tempfile
import zipfile
import subprocess

import UnityPy
from UnityPy import config as _unity_config

# 碧蓝航线 AssetBundle 头部版本串是假的（player=5.x.x / engine=0.0.0），
# UnityPy 无法据此决定 flags 语义会报 UnityVersionFallbackError，被误当加密。
# 统一指定真实引擎版本，普通 LZ4 包即可正常解包（与 extract_dynamic.py 保持一致）。
_unity_config.FALLBACK_UNITY_VERSION = "2022.3.0f1"

from PIL import Image

THUMB_WIDTH = 360
MAX_DEPTH = 6  # 嵌套压缩包最大递归层数，防异常包

# 压缩包密码（WinZip AES / ZipCrypto / rar / 7z），由命令行第 3 个可选参数传入。
ARCHIVE_PASSWORD = None


class EncryptedArchiveError(RuntimeError):
    pass


def is_zip_encrypted(ab_path):
    try:
        with zipfile.ZipFile(ab_path) as zf:
            for info in zf.infolist():
                if info.is_dir():
                    continue
                if info.compress_type == 99 or (info.flag_bits & 0x1):
                    return True
    except Exception:
        return False
    return False


def fix_zip_name(name, flag_bits):
    """zip 未置 UTF8 标志位且名为中文时，Python 按 cp437 误解码；碧蓝包名实为 GBK。"""
    if name and not (flag_bits & 0x800):
        try:
            return name.encode("cp437").decode("gbk")
        except Exception:
            return name
    return name


def extract_zip_all(zf, dest):
    for info in zf.infolist():
        if info.is_dir():
            continue
        real = fix_zip_name(info.filename, info.flag_bits).replace("\\", "/")
        parts = [p for p in real.split("/") if p not in ("", ".", "..")]
        target = os.path.join(dest, *parts)
        os.makedirs(os.path.dirname(target), exist_ok=True)
        with zf.open(info) as src, open(target, "wb") as out:
            shutil.copyfileobj(src, out)


def open_zip(ab_path):
    if ARCHIVE_PASSWORD:
        try:
            import pyzipper
            zf = pyzipper.AESZipFile(ab_path)
            zf.setpassword(ARCHIVE_PASSWORD.encode("utf-8"))
            return zf
        except Exception:
            zf = zipfile.ZipFile(ab_path)
            zf.setpassword(ARCHIVE_PASSWORD.encode("utf-8"))
            return zf
    return zipfile.ZipFile(ab_path)

# 目标目录段 → (中文名, 排序)
GROUP_META = {
    "painting":     ("主立绘", 0),
    "paintingface": ("表情差分", 1),
    "herohrzicon":  ("横版头像", 2),
    "shipyardicon": ("船舵头像", 3),
    "squareicon":   ("方形头像", 4),
}

BSDtar = os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "System32", "tar.exe")

# 强制 UTF-8 输出，避免中文 Windows 默认 GBK 导致 Node 读取乱码
try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass


def emit(payload):
    print(json.dumps(payload, ensure_ascii=False))
    sys.stdout.flush()


def detect_kind(ab_path):
    """按文件头识别压缩格式，无法识别返回 None。"""
    try:
        with open(ab_path, "rb") as f:
            head = f.read(6)
    except Exception:
        return None
    if head[:4] == b"PK\x03\x04" or head[:2] == b"PK":
        return "zip"
    if head[:7] == b"Rar!\x1a\x07":
        return "rar"
    if head[:6] == b"7z\xbc\xaf\x27\x1c":
        return "7z"
    return None


def extract_archive(ab_path, kind, dest):
    """解压单个压缩包到 dest。"""
    os.makedirs(dest, exist_ok=True)
    if kind == "zip":
        if not ARCHIVE_PASSWORD and is_zip_encrypted(ab_path):
            raise EncryptedArchiveError("压缩包已加密，需要密码")
        with open_zip(ab_path) as zf:
            try:
                extract_zip_all(zf, dest)
            except (RuntimeError, zipfile.BadZipFile) as e:
                msg = str(e)
                if "password" in msg.lower() or "bad password" in msg.lower() or "mac" in msg.lower():
                    raise EncryptedArchiveError("压缩包密码错误或已加密: " + msg[:80])
                raise
        return
    if not os.path.isfile(BSDtar):
        raise RuntimeError("未找到系统 bsdtar: " + BSDtar)
    cmd = [BSDtar, "-xf", ab_path, "-C", dest]
    env = dict(os.environ)
    if ARCHIVE_PASSWORD:
        cmd = [BSDtar, "--passphrase", ARCHIVE_PASSWORD, "-xf", ab_path, "-C", dest]
        env["LIBARCHIVE_PASSPHRASE"] = ARCHIVE_PASSWORD
    proc = subprocess.run(cmd, capture_output=True, env=env)
    if proc.returncode != 0:
        err = proc.stderr.decode("utf-8", "replace") or proc.stdout.decode("utf-8", "replace")
        low = err.lower()
        if any(k in low for k in ("passphrase", "password", "wrong password", "encrypted", "enter password")):
            raise EncryptedArchiveError("压缩包密码错误或已加密: " + err[:120])
        raise RuntimeError("bsdtar 解压失败: " + err)


def walk_for_resources(archive, work_root, source, depth, found):
    """
    解压 archive，递归收集资源 AssetBundle。
    found: [{"ab_path","rel","group","source"}]
    """
    dest = tempfile.mkdtemp(prefix="lvl_", dir=work_root)
    extract_archive(archive, detect_kind(archive), dest)

    for root, _dirs, files in os.walk(dest):
        for fn in files:
            full = os.path.join(root, fn)
            rel = os.path.relpath(full, dest).replace(os.sep, "/")

            nested_kind = detect_kind(full)
            if nested_kind and depth > 0:
                # 嵌套压缩包：以其文件名（去扩展名）作为来源标识
                stem = os.path.splitext(os.path.basename(rel))[0]
                nested_source = (source + "/" if source else "") + stem
                walk_for_resources(full, work_root, nested_source, depth - 1, found)
                continue

            # 普通文件：路径段中是否含目标目录
            parts = rel.split("/")
            for g in GROUP_META:
                if g in parts:
                    idx = parts.index(g)
                    norm_rel = "/".join(parts[idx:])  # 从目标段开始的规范路径
                    found.append({
                        "ab_path": full,
                        "rel": norm_rel,
                        "group": g,
                        "source": source,
                    })
                    break


def export_bundle(item, out_dir, counters):
    """解析一个资源 AssetBundle，导出其中所有 Texture2D（原图+缩略图）。"""
    env = UnityPy.load(item["ab_path"])
    tex_list = []
    for obj in env.objects:
        if obj.type.name != "Texture2D":
            continue
        try:
            data = obj.read()
        except Exception:
            continue
        nm = getattr(data, "m_Name", "") or getattr(data, "name", "") or ""
        tex_list.append((nm, data))

    # 贴图名按数字/名字排序
    def sk(t):
        try:
            return (0, int(t[0]))
        except (ValueError, TypeError):
            return (1, t[0])
    tex_list.sort(key=sk)

    group = item["group"]
    source = item["source"] or ""
    results = []

    for tex_name, data in tex_list:
        try:
            img = data.image.convert("RGBA")
        except Exception:
            continue

        # key 按 (group, source) 计数，保证唯一且无来源时兼容旧命名 painting_0
        ck = group + "|" + source
        idx = counters.get(ck, 0)
        counters[ck] = idx + 1
        if source:
            key = "%s_%s_%d" % (group, source.replace("/", "_"), idx)
        else:
            key = "%s_%d" % (group, idx)

        full_path = os.path.join(out_dir, key + ".png")
        thumb_path = os.path.join(out_dir, key + "_thumb.jpg")
        img.save(full_path, "PNG")  # 原图保留透明通道

        # 缩略图为 JPEG（不支持透明）：把透明区合成到白底，避免出现黑底
        thumb = img.copy()
        if thumb.width > THUMB_WIDTH:
            ratio = THUMB_WIDTH / thumb.width
            thumb = thumb.resize(
                (THUMB_WIDTH, max(1, int(thumb.height * ratio))), Image.LANCZOS
            )
        rgba = thumb if thumb.mode == "RGBA" else thumb.convert("RGBA")
        white = Image.new("RGB", rgba.size, (255, 255, 255))
        white.paste(rgba, mask=rgba.getchannel("A"))
        white.save(thumb_path, "JPEG", quality=82)

        gname, gorder = GROUP_META[group]
        results.append({
            "key": key,
            "name": tex_name or key,
            "group": gname,
            "groupKey": group,
            "source": source,
            "groupOrder": gorder,
            "width": img.width,
            "height": img.height,
            "size": os.path.getsize(full_path),
            "thumb": key + "_thumb.jpg",
        })
    return results


def main():
    global ARCHIVE_PASSWORD
    if len(sys.argv) < 3:
        emit({"ok": False, "error": "参数不足"})
        return

    archive = sys.argv[1]
    out_dir = sys.argv[2]
    if len(sys.argv) >= 4 and sys.argv[3]:
        ARCHIVE_PASSWORD = sys.argv[3]
    if not os.path.isfile(archive) or not detect_kind(archive):
        emit({"ok": False, "error": "不是受支持的压缩包"})
        return

    if detect_kind(archive) == "zip" and not ARCHIVE_PASSWORD and is_zip_encrypted(archive):
        emit({"ok": False, "code": "ARCHIVE_PASSWORD_REQUIRED", "error": "压缩包已加密，需要密码"})
        return

    os.makedirs(out_dir, exist_ok=True)
    work_root = tempfile.mkdtemp(prefix="fms_ab_")
    images = []
    try:
        found = []
        try:
            walk_for_resources(archive, work_root, "", MAX_DEPTH, found)
        except EncryptedArchiveError as e:
            emit({"ok": False, "code": "ARCHIVE_PASSWORD_REQUIRED", "error": str(e)})
            return

        counters = {}
        for item in found:
            try:
                images.extend(export_bundle(item, out_dir, counters))
            except Exception:
                continue
    finally:
        shutil.rmtree(work_root, ignore_errors=True)

    images.sort(key=lambda x: (x["groupOrder"], x["source"], x["key"]))
    for im in images:
        im.pop("groupOrder", None)

    emit({"ok": True, "images": images})


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        emit({"ok": False, "error": "%s: %s" % (type(e).__name__, e)})
