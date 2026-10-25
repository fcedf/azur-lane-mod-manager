# -*- coding: utf-8 -*-
"""
Mod 原样解压 Worker（通用递归版）
由 Node 后端通过子进程调用。

用途: 把压缩包内需要注入游戏的 AssetBundle【原样】解压到暂存目录
      （二进制原样，不做 PNG 转换，注入游戏必须是原始 UnityFS 包）。

用法:
    python mod_files.py <压缩包绝对路径> <暂存输出目录>

能力:
  - .zip / .rar / .7z（按文件头自动识别）
  - 资源可在【任意目录层级】（如 "伏波新年/painting/fubo_2_rw_tex"）
  - 自动【递归解压嵌套压缩包】（如 肇和新年.rar 内的 肇和3.rar / 肇和3遮眼.rar）
  - 只收集 painting / paintingface / herohrzicon / shipyardicon / squareicon
  - 多版本嵌套包用 source(来源) 区分；设置环境变量 MOD_SOURCE 可只导出指定来源

输出（stdout 最后一行）:
    {
      "ok": true,
      "sources": [""] 或 ["肇和3","肇和3遮眼"],
      "files": [ {"rel","file","size","md5","source"} ... ]
    }
    rel  = 设备目标相对路径（从目标目录段开始，如 painting/zhaohe_3_rw_tex）
    file = 暂存目录内的唯一文件名（用于 Node 读取 push）
"""
import os
import sys
import json
import shutil
import tempfile
import zipfile
import subprocess
import hashlib

MAX_DEPTH = 6
# 可注入游戏 AssetBundles 的目标目录：静态五类 + 动态 spinepainting
TARGET_DIRS = ("painting", "paintingface", "herohrzicon", "shipyardicon",
               "squareicon", "spinepainting")

BSDtar = os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "System32", "tar.exe")

# 只导出指定来源（来自嵌套包文件名，如 "肇和3遮眼"）；空串=默认来源
ONLY_SOURCE = os.environ.get("MOD_SOURCE", None)
# 压缩包密码（WinZip AES / 标准 ZipCrypto，内外层默认同一密码）
PASSWORD = os.environ.get("ARCHIVE_PASSWORD", None)
PASSWORD_B = PASSWORD.encode("utf-8") if PASSWORD else None

# 加密 zip 用 pyzipper（支持 WinZip AES）；未安装时回退标准库（仅 ZipCrypto）
try:
    import pyzipper
except Exception:
    pyzipper = None


class PasswordRequired(RuntimeError):
    """压缩包需要密码 / 密码错误"""
    pass


def fix_zip_name(info):
    """修复 GBK 文件名被当成 CP437 误解码的问题（未置 UTF-8 标志位时）。"""
    name = info.filename
    if info.flag_bits & 0x800:
        return name
    try:
        return name.encode("cp437").decode("gbk")
    except Exception:
        return name


def open_zip(ab_path):
    """优先 pyzipper（AES），回退标准库；统一注入密码。"""
    cls = pyzipper.AESZipFile if pyzipper is not None else zipfile.ZipFile
    zf = cls(ab_path)
    if PASSWORD_B:
        zf.setpassword(PASSWORD_B)
    return zf


def _zip_needs_password(zf):
    for info in zf.infolist():
        if info.flag_bits & 0x1 or getattr(info, "compress_type", 0) == 99:
            return True
    return False


def extract_zip_safely(ab_path, dest):
    """解压 zip，处理 AES/密码、GBK 文件名，校验密码是否正确。"""
    zf = open_zip(ab_path)
    try:
        if _zip_needs_password(zf) and not PASSWORD_B:
            raise PasswordRequired("压缩包已加密，需要密码")
        os.makedirs(dest, exist_ok=True)
        for info in zf.infolist():
            if info.is_dir():
                continue
            real = fix_zip_name(info)
            target = os.path.normpath(os.path.join(dest, real))
            if not os.path.abspath(target).startswith(os.path.abspath(dest)):
                continue  # 防 zip slip
            os.makedirs(os.path.dirname(target), exist_ok=True)
            try:
                data = zf.read(info)
            except RuntimeError as e:
                msg = str(e)
                if "password" in msg.lower() or "encrypted" in msg.lower():
                    raise PasswordRequired("密码错误或压缩包已加密")
                raise
            with open(target, "wb") as out:
                out.write(data)
    finally:
        zf.close()

try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass


def emit(payload):
    print(json.dumps(payload, ensure_ascii=False))
    sys.stdout.flush()


def detect_kind(ab_path):
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
    os.makedirs(dest, exist_ok=True)
    if kind == "zip":
        extract_zip_safely(ab_path, dest)
        return
    if not os.path.isfile(BSDtar):
        raise RuntimeError("未找到系统 bsdtar: " + BSDtar)
    cmd = [BSDtar, "-xf", ab_path, "-C", dest]
    env = dict(os.environ)
    if PASSWORD:
        cmd += ["--passphrase", PASSWORD]
        env["LIBARCHIVE_PASSPHRASE"] = PASSWORD
    proc = subprocess.run(cmd, capture_output=True, env=env)
    if proc.returncode != 0:
        err = proc.stderr.decode("utf-8", "replace") or proc.stdout.decode("utf-8", "replace")
        low = err.lower()
        if "passphrase" in low or "encrypted" in low or "aes" in low or "wrong" in low:
            raise PasswordRequired("压缩包已加密，需要密码或密码错误")
        raise RuntimeError("bsdtar 解压失败: " + err)


def md5_of(path):
    h = hashlib.md5()
    with open(path, "rb") as fp:
        for chunk in iter(lambda: fp.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def walk_collect(archive, work_root, source, depth, found):
    """递归解压，收集 {full, rel, source}。rel 为从目标目录段开始的规范路径。"""
    dest = tempfile.mkdtemp(prefix="lvl_", dir=work_root)
    extract_archive(archive, detect_kind(archive), dest)

    for root, _dirs, files in os.walk(dest):
        for fn in files:
            full = os.path.join(root, fn)
            rel = os.path.relpath(full, dest).replace(os.sep, "/")

            if detect_kind(full) and depth > 0:
                stem = os.path.splitext(os.path.basename(rel))[0]
                nested_source = (source + "/" if source else "") + stem
                walk_collect(full, work_root, nested_source, depth - 1, found)
                continue

            parts = rel.split("/")
            matched_idx = -1
            matched_group = None
            for i, seg in enumerate(parts):
                seg_low = seg.lower()
                # spinepainting 常被包一层中文名（如 “放spinepainting文件夹”），用包含匹配；
                # 其余五类保持精确目录名。
                if seg_low == "spinepainting" or "spinepainting" in seg_low:
                    matched_idx, matched_group = i, "spinepainting"
                    break
                if seg in TARGET_DIRS:
                    matched_idx, matched_group = i, seg
                    break
            if matched_idx >= 0:
                # 注入时设备相对目录统一为规范名 spinepainting（去掉“放…文件夹”包装）
                tail = "/".join(parts[matched_idx + 1:])
                rel_out = (matched_group + "/" + tail) if tail else matched_group + "/" + parts[matched_idx]

                # 同一嵌套包内用【目录】区分版本时（如 内层zip里的 1加强版/2素版），
                # 取目标目录段之前、嵌套包内的有效上层目录追加到 source，使多版本能被区分。
                extra = []
                for seg in parts[:matched_idx]:
                    seg_low = seg.lower()
                    # 跳过目标目录包装段（“放spinepainting文件夹”等）
                    if any(g in seg_low for g in ("spinepainting", "paintingface",
                                                 "herohrzicon", "shipyardicon", "squareicon")):
                        continue
                        # “【B版】”这类总包装对所有版本相同，不参与区分
                    if seg.startswith("【") and seg.endswith("】"):
                        continue
                    extra.append(seg)
                if extra:
                    # 包内有明确版本目录（如 1加强版/2素版）时，版本标签以这些目录为准；
                    # 嵌套 zip 文件名（常是冗余的外层名，如 JERRY兴登堡原皮）不再拼接。
                    final_source = "/".join(extra)
                else:
                    final_source = source

                found.append({
                    "full": full,
                    "rel": rel_out,
                    "source": final_source,
                })


def build_zip(archive, zip_path):
    """递归收集后，按设备 AssetBundles 相对路径(rel)直接打成一个 zip。
    供手机端下载后用 MT 管理器解压粘贴；多版本用 MOD_SOURCE 过滤。"""
    work_root = tempfile.mkdtemp(prefix="fms_modzip_")
    try:
        found = []
        walk_collect(archive, work_root, "", MAX_DEPTH, found)

        sources = []
        for it in found:
            if it["source"] not in sources:
                sources.append(it["source"])

        chosen = found
        if ONLY_SOURCE is not None:
            chosen = [it for it in found if it["source"] == ONLY_SOURCE]

        files_out = []
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
            for it in chosen:
                # zip 内路径即设备相对路径（painting/xxx），MT 管理器解压到 AssetBundles 即可
                zf.write(it["full"], it["rel"].replace("\\", "/"))
                files_out.append({
                    "rel": it["rel"],
                    "file": it["rel"],
                    "size": os.path.getsize(it["full"]),
                    "md5": md5_of(it["full"]),
                    "source": it["source"] or "",
                })
    finally:
        shutil.rmtree(work_root, ignore_errors=True)

    files_out.sort(key=lambda x: (x["rel"], x["source"]))
    return {"sources": sources, "files": files_out}


def main():
    if len(sys.argv) < 3:
        emit({"ok": False, "error": "参数不足"})
        return

    archive = sys.argv[1]
    out_path = sys.argv[2]
    if not os.path.isfile(archive) or not detect_kind(archive):
        emit({"ok": False, "error": "不是受支持的压缩包"})
        return

    # 模式二：第二个参数以 .zip 结尾 → 直接导出“设备目录结构”zip
    if out_path.lower().endswith(".zip"):
        os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
        r = build_zip(archive, out_path)
        emit({"ok": True, "mode": "zip", "zip": out_path,
              "sources": r["sources"], "files": r["files"]})
        return

    # 模式一：原样解压到暂存目录（供 adb push）
    stage_dir = out_path
    os.makedirs(stage_dir, exist_ok=True)
    work_root = tempfile.mkdtemp(prefix="fms_mod_")
    files_out = []
    sources = []
    try:
        found = []
        walk_collect(archive, work_root, "", MAX_DEPTH, found)

        # 来源去重（保序）
        for it in found:
            if it["source"] not in sources:
                sources.append(it["source"])

        # 多版本时按环境变量过滤来源
        chosen = found
        if ONLY_SOURCE is not None:
            chosen = [it for it in found if it["source"] == ONLY_SOURCE]

        # 复制到暂存目录，用 (group,source) 计数生成唯一文件名
        counters = {}
        for it in chosen:
            group = it["rel"].split("/", 1)[0]
            source = it["source"] or ""
            ck = group + "|" + source
            idx = counters.get(ck, 0)
            counters[ck] = idx + 1
            uniq = ("%s_%s_%d" % (group, source.replace("/", "_"), idx)) if source \
                else "%s_%d" % (group, idx)

            dst = os.path.join(stage_dir, uniq)
            shutil.copy2(it["full"], dst)
            files_out.append({
                "rel": it["rel"],
                "file": uniq,
                "size": os.path.getsize(dst),
                "md5": md5_of(dst),
                "source": source,
            })
    finally:
        shutil.rmtree(work_root, ignore_errors=True)

    files_out.sort(key=lambda x: (x["rel"], x["source"]))
    emit({"ok": True, "sources": sources, "files": files_out})


if __name__ == "__main__":
    try:
        main()
    except PasswordRequired as e:
        emit({"ok": False, "code": "ARCHIVE_PASSWORD_REQUIRED",
              "needPassword": True, "error": "%s" % e})
    except Exception as e:
        emit({"ok": False, "error": "%s: %s" % (type(e).__name__, e)})
