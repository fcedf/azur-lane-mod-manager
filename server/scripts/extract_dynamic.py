# -*- coding: utf-8 -*-
"""
压缩包内【动态立绘】提取 Worker（Spine 龙骨 / Live2D）
由 Node 后端通过子进程调用。

用法:
    python extract_dynamic.py <压缩包绝对路径> <缓存输出目录>

能力:
  - 支持 .zip / .rar / .7z（按文件头自动识别），递归进入嵌套压缩包
  - 识别 spinepainting / live2d 目录下的 Unity AssetBundle
  - 自动检测 bundle 是否为碧蓝“0.0.0 加密包”，加密则标记 encrypted=true（本脚本不解密）
  - Spine：从配对的 <名>_res 包提取标准三件套  skel / atlas / png
  - Live2D：从 CubismMoc._bytes 提取 moc3、导出贴图、导出 physics3.json
           （不做 AnimationClip→motion3 动作转换；模型可在网页直接显示+物理交互）

输出（stdout 最后一行）:
    {"ok": true, "encrypted": [...], "items": [ {kind, key, name, source, files:{...}, ...} ]}
    或 {"ok": false, "error": "..."}
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
from PIL import Image

# 碧蓝的 AssetBundle 把 UnityFS 的版本字符串改成了假值（玩家版本 5.x.x、引擎版本 0.0.0），
# 导致 UnityPy 无法判定 flags 语义（0x200 在旧版是加密、新版是对齐填充）而报错。
# 这些包实际上是普通 LZ4 压缩、并未加密。给一个 fallback 引擎版本（2019.4/2022 均验证可解），
# UnityPy 即可正常读取。只有设置 fallback 后仍无法加载的，才认为是真加密包。
_unity_config.FALLBACK_UNITY_VERSION = "2022.3.0f1"

MAX_DEPTH = 6
THUMB_WIDTH = 480

# 压缩包密码（WinZip AES / ZipCrypto / rar / 7z）。由命令行第 3 个可选参数传入。
ARCHIVE_PASSWORD = None

# 标记：压缩包本身加密（需要密码），区别于 Unity AssetBundle 加密。
class EncryptedArchiveError(RuntimeError):
    pass


def is_zip_encrypted(ab_path):
    """检测 zip 内是否存在加密条目（传统 ZipCrypto flag 或 WinZip AES compress_type=99）。"""
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
    """zip 未置 UTF8 标志位(0x800)且文件名是中文时，Python 会按 cp437 误解码；
    碧蓝这类包文件名实为 GBK，重新还原。"""
    if name and not (flag_bits & 0x800):
        try:
            return name.encode("cp437").decode("gbk")
        except Exception:
            return name
    return name


def extract_zip_all(zf, dest):
    """逐个解压并修正中文文件名（标准 ZipFile 与 pyzipper 通用）。"""
    for info in zf.infolist():
        if info.is_dir():
            continue
        real = fix_zip_name(info.filename, info.flag_bits).replace("\\", "/")
        target = os.path.join(dest, *[_p for _p in real.split("/") if _p not in ("", ".", "..")])
        os.makedirs(os.path.dirname(target), exist_ok=True)
        with zf.open(info) as src, open(target, "wb") as out:
            shutil.copyfileobj(src, out)


def open_zip(ab_path):
    """按是否需要密码返回 ZipFile（优先 pyzipper 以支持 WinZip AES）。"""
    if ARCHIVE_PASSWORD:
        try:
            import pyzipper
            zf = pyzipper.AESZipFile(ab_path)
            zf.setpassword(ARCHIVE_PASSWORD.encode("utf-8"))
            return zf
        except Exception:
            # pyzipper 不可用时退回标准库（只能解 ZipCrypto）
            zf = zipfile.ZipFile(ab_path)
            zf.setpassword(ARCHIVE_PASSWORD.encode("utf-8"))
            return zf
    return zipfile.ZipFile(ab_path)

# 动态资源目录段 → 类型
KIND_SPINE = "spine"
KIND_LIVE2D = "live2d"
KIND_UNKNOWN = "unknown"  # 加密后读不到类型特征，统一标记待解密
DIR_KIND = {
    "spinepainting": KIND_SPINE,
    "live2d": KIND_LIVE2D,
}

BSDtar = os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "System32", "tar.exe")

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
            head = f.read(16)
    except Exception:
        return None
    if head[:4] == b"PK\x03\x04" or head[:2] == b"PK":
        return "zip"
    if head[:7] == b"Rar!\x1a\x07":
        return "rar"
    if head[:6] == b"7z\xbc\xaf\x27\x1c":
        return "7z"
    if head[:7] == b"UnityFS":
        return "bundle"
    return None


def is_unityfs(ab_path):
    try:
        with open(ab_path, "rb") as f:
            return f.read(7) == b"UnityFS"
    except Exception:
        return False


def _version_is_placeholder(ab_path):
    """旧判据：碧蓝部分加密包 UnityFS 版本串被改成 0.0.0。"""
    try:
        with open(ab_path, "rb") as f:
            head = f.read(40)
    except Exception:
        return False
    if head[:6] != b"UnityFS":
        return False
    seg = head[0x0C:0x28].split(b"\x00")[0]
    try:
        ver = seg.decode("ascii", "ignore")
    except Exception:
        return False
    return ver.strip().startswith("0.0.0")


def _unitypy_loadable(ab_path):
    """用 UnityPy 试加载（已设 fallback 版本）：能打开即未加密；仍抛异常才认为是真加密。"""
    try:
        env = UnityPy.load(ab_path)
        # 真正读一次对象，确保不只是头部可解析
        _ = len(env.objects)
        return True
    except Exception:
        return False


def is_encrypted_bundle(ab_path):
    """真加密判据：设置 fallback 版本后 UnityPy【仍】无法加载才是真加密。
    注意：版本串为 0.0.0/5.x.x 只是碧蓝改的假版本号，本身不等于加密。"""
    if not is_unityfs(ab_path):
        return False
    return not _unitypy_loadable(ab_path)


def extract_archive(ab_path, kind, dest):
    os.makedirs(dest, exist_ok=True)
    if kind == "zip":
        # 未提供密码但包是加密的：提前抛出可识别错误，避免深层异常
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
    # bsdtar/libarchive 读密码（rar/7z/加密tar）：优先 --passphrase，并用环境变量兜底
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


def classify_bundle(rel_path):
    """按压缩包内相对路径的目录段判断动态资源类型；无特征返回 None。"""
    parts = rel_path.replace(os.sep, "/").split("/")
    for seg, k in DIR_KIND.items():
        if seg in parts:
            return k
    return None


def detect_kind_by_content(ab_path):
    """无路径特征时，按包内对象内容判定动态类型。
    Live2D：某 TextAsset/MonoBehaviour 的 _bytes 以 MOC3 开头；
    Spine：TextAsset 名含 skel 或内容以 Spine 二进制 hash 开头。
    """
    try:
        env = UnityPy.load(ab_path)
    except Exception:
        return None
    has_spine = False
    for o in env.objects:
        if o.type.name == "TextAsset":
            try:
                d = o.read()
            except Exception:
                continue
            nm = (getattr(d, "m_Name", "") or "").lower()
            raw = text_asset_bytes(getattr(d, "m_Script", b""))
            if raw[:4] == b"MOC3":
                return KIND_LIVE2D
            if nm.endswith(".skel") or nm.endswith("skeleton") or "skel" in nm:
                has_spine = True
        elif o.type.name == "MonoBehaviour":
            try:
                tree = o.read_typetree()
            except Exception:
                continue
            arr = tree.get("_bytes")
            if isinstance(arr, (list, bytes, bytearray)) and len(arr) >= 4:
                head = bytes(list(arr)[:4]) if isinstance(arr, list) else bytes(arr[:4])
                if head == b"MOC3":
                    return KIND_LIVE2D
    return KIND_SPINE if has_spine else None


def collect_bundle(full, rel, source, found, encrypted):
    """处理单个 UnityFS bundle：路径特征 → 内容探测；真加密归入加密列表。"""
    base = os.path.basename(rel)
    kind = classify_bundle(rel)
    enc = is_encrypted_bundle(full)
    if enc:
        # 真加密：能按路径归类就标类型，否则 unknown
        encrypted.append({"kind": kind or KIND_UNKNOWN, "name": base, "source": source})
        return
    if kind is None:
        # 裸 bundle / 压缩包内无 live2d/spinepainting 路径段：按内容判定
        kind = detect_kind_by_content(full)
        if kind is None:
            return  # 非动态资源（如 icon/painting 等），忽略
    found.append({
        "path": full,
        "kind": kind,
        "base": base,
        "source": source,
        "is_res": base.endswith("_res"),
        "encrypted": False,
    })


def walk_bundles(archive, work_root, source, depth, found, encrypted):
    """递归解压，收集动态 bundle。archive 可能是压缩包或裸 UnityFS bundle。"""
    top_kind = detect_kind(archive)
    if top_kind == "bundle":
        collect_bundle(archive, os.path.basename(archive), source, found, encrypted)
        return
    if top_kind is None:
        return

    dest = tempfile.mkdtemp(prefix="lvl_", dir=work_root)
    extract_archive(archive, top_kind, dest)

    for root, _dirs, files in os.walk(dest):
        for fn in files:
            full = os.path.join(root, fn)
            rel = os.path.relpath(full, dest).replace(os.sep, "/")
            sub_kind = detect_kind(full)

            if sub_kind == "bundle":
                # source 用 bundle 所在的相对目录（含版本/皮肤名，如
                # 一形态【B版】/A加强版 或 二形态【B版】/放spinepainting/A纯爱版），
                # 以区分同一包内多个同名 bundle（多版本）。
                parent = os.path.dirname(rel)
                nested_source = (source + "/" if source else "") + parent if parent else source
                collect_bundle(full, rel, nested_source, found, encrypted)
                continue

            if sub_kind and depth > 0:
                # 嵌套压缩包：递归
                stem = os.path.splitext(os.path.basename(rel))[0]
                nested_source = (source + "/" if source else "") + stem
                walk_bundles(full, work_root, nested_source, depth - 1, found, encrypted)


def safe_name(s):
    return "".join(c if c.isalnum() or c in "._-" else "_" for c in str(s))


def text_asset_bytes(value):
    """
    UnityPy 把 TextAsset.m_Script（本应是字节数组）按 UTF-8 用 surrogateescape
    解码成了 str。对【二进制】资源（skel/moc3）必须用 surrogateescape 无损还原原始
    字节；直接 .encode('latin1') 会破坏所有 >=0x80 的字节（skel 约 1/4 字节）。
    """
    if value is None:
        return b""
    if isinstance(value, bytes):
        return value
    return value.encode("utf-8", "surrogateescape")


def text_asset_str(value):
    """文本资源（atlas/physics3）还原为字符串。"""
    if value is None:
        return ""
    if isinstance(value, bytes):
        return value.decode("utf-8", "replace")
    return value


def save_thumb(img, out_path):
    thumb = img.copy()
    if thumb.mode == "RGBA":
        bg = Image.new("RGB", thumb.size, (255, 255, 255))
        bg.paste(thumb, mask=thumb.getchannel("A"))
        thumb = bg
    else:
        thumb = thumb.convert("RGB")
    if thumb.width > THUMB_WIDTH:
        ratio = THUMB_WIDTH / thumb.width
        thumb = thumb.resize((THUMB_WIDTH, max(1, int(thumb.height * ratio))), Image.LANCZOS)
    thumb.save(out_path, "JPEG", quality=85)


# ---------------- Spine ----------------
def _parse_atlas_pages(atlas_text):
    """解析 Spine atlas 文本，返回 [(line_index, page_name), ...]（按页出现顺序）。

    鲁棒点：兼容开头 BOM/空行、CRLF/LF；页块特征是“非缩进行 + 紧随其后的 size: 行”，
    region 行一律以空格/tab 缩进。不依赖页之间必须有空行。
    """
    # 去 BOM，按物理行切（保留各自内容用于判断）
    if atlas_text.startswith("\ufeff"):
        atlas_text = atlas_text[1:]
    lines = atlas_text.splitlines()
    n = len(lines)
    pages = []
    i = 0
    while i < n and not lines[i].strip():
        i += 1
    while i < n:
        ln = lines[i]
        name = ln.strip()
        nxt = lines[i + 1] if i + 1 < n else ""
        is_decl = (
            name
            and ln[:1] not in (" ", "\t")  # 页名非缩进
            and nxt[:1] not in (" ", "\t")  # size: 也必须顶格（region 的 size 是缩进的）
            and nxt.lower().startswith("size:")
        )
        if is_decl:
            pages.append((i, name))
        i += 1
        # 跳过本页块的缩进行，直到遇到下一个非缩进非空行
        while i < n:
            cur = lines[i]
            if cur.strip() == "":
                i += 1
                continue
            if cur[:1] in (" ", "\t"):
                i += 1
                continue
            break
    return pages


def _tex_stem(page_file_name):
    """把 atlas 页名规整为可与 Texture2D.m_Name 比较的 stem：
    去查询串、去目录、去扩展名、去空白、转小写。"""
    name = page_file_name.strip().split("?", 1)[0].split("#", 1)[0]
    name = name.replace("\\", "/").split("/")[-1]
    stem = os.path.splitext(name)[0]
    return stem.strip().lower()


def export_spine(res_item, out_dir, counters):
    env = UnityPy.load(res_item["path"])
    skel_bytes = None
    atlas_bytes = None
    # 收集 bundle 内全部贴图（多页 spine，如安土 antu_3 含 antu_3.png + antu_32.png）。
    # 只取第一张会丢掉位于其它页的眼睛/眉等部件。
    tex_map = {}
    tex_order = []

    for o in env.objects:
        if o.type.name == "TextAsset":
            try:
                d = o.read()
            except Exception:
                continue
            nm = d.m_Name or ""
            low = nm.lower()
            if low.endswith("atlas"):
                atlas_bytes = text_asset_bytes(d.m_Script)
            elif low.endswith(".skel") or low.endswith("skeleton") or "skel" in low:
                skel_bytes = text_asset_bytes(d.m_Script)
        elif o.type.name == "Texture2D":
            try:
                d = o.read()
                tname = (d.m_Name or "texture").replace("/", "_").strip()
                if tname and tname not in tex_map:
                    tex_map[tname] = d.image.convert("RGBA")
                    tex_order.append(tname)
            except Exception:
                pass

    if skel_bytes is None or not tex_map:
        return None

    base = res_item["base"][:-4] if res_item["base"].endswith("_res") else res_item["base"]
    source = res_item["source"] or ""
    key = "spine_" + (safe_name(base) if not source else safe_name(source.replace("/", "_") + "_" + base))

    os.makedirs(out_dir, exist_ok=True)
    skel_path = key + ".skel"
    thumb_path = key + "_thumb.jpg"
    with open(os.path.join(out_dir, skel_path), "wb") as f:
        f.write(skel_bytes)

    files = {"skel": skel_path, "thumb": thumb_path}
    warnings = []
    primary_name = tex_order[0]
    primary_img = tex_map[primary_name]
    cover_tex = primary_img

    # stem(小写) -> 贴图对象名，供宽松匹配
    stem_to_name = {}
    for tn in tex_order:
        stem_to_name.setdefault(_tex_stem(tn), tn)

    def match_tex(page_file_name):
        stem = _tex_stem(page_file_name)
        if stem in stem_to_name:
            return stem_to_name[stem]
        # 再做一层去空格/下划线差异的兜底
        def norm(x):
            return x.replace(" ", "").replace("_", "").replace("-", "")
        nstem = norm(stem)
        for tn in tex_order:
            if norm(_tex_stem(tn)) == nstem:
                return tn
        return None

    page_files = []
    if atlas_bytes is not None:
        try:
            atlas_text = text_asset_str(atlas_bytes)
            decls = _parse_atlas_pages(atlas_text)

            if decls:
                if len(decls) != len(tex_order):
                    warnings.append(
                        "atlas 声明 %d 张贴图页，资源包内有 %d 张 Texture2D" % (len(decls), len(tex_order))
                    )
                raw_lines = atlas_text.splitlines(keepends=True)
                # 输出时统一重新编号（避免不同源页名风格导致的文件名冲突）
                single = len(decls) == 1
                matched_tex = []
                for pi, (_idx, pname) in enumerate(decls):
                    tn = match_tex(pname)
                    if tn is None:
                        warnings.append("贴图页 `%s` 未在资源包内找到，已回退用第一张" % pname)
                        tn = primary_name
                    matched_tex.append(tn)
                    out_png = (key if single else ("%s_p%d" % (key, pi))) + ".png"
                    tex_map[tn].save(os.path.join(out_dir, out_png), "PNG")
                    page_files.append(out_png)
                    if pi == 0:
                        cover_tex = tex_map[tn]
                    # 仅替换“页声明行”，不用全局 replace（避免误伤同名 region/重复子串）
                    old = raw_lines[_idx]
                    tail = "\r\n" if old.endswith("\r\n") else ("\n" if old.endswith("\n") else "")
                    raw_lines[_idx] = out_png + tail
                atlas_text = "".join(raw_lines)
            else:
                # atlas 解析不出任何页（格式异常）：退回单图并替换第一个非空行
                out_png = key + ".png"
                primary_img.save(os.path.join(out_dir, out_png), "PNG")
                page_files = [out_png]
                if len(tex_order) > 1:
                    warnings.append("未能从 atlas 解析出贴图页，多张贴图仅使用了第一张")
                lines2 = atlas_text.splitlines(keepends=True)
                for i, ln in enumerate(lines2):
                    if ln.strip():
                        tail = "\r\n" if ln.endswith("\r\n") else ("\n" if ln.endswith("\n") else "")
                        lines2[i] = out_png + tail
                        break
                atlas_text = "".join(lines2)

            atlas_path = key + ".atlas.txt"
            with open(os.path.join(out_dir, atlas_path), "w", encoding="utf-8", newline="") as f:
                f.write(atlas_text)
            files["atlas"] = atlas_path
            files["texture"] = page_files[0]
            files["pages"] = page_files
        except Exception as e:
            warnings.append("atlas 处理失败：%s" % str(e)[:100])

    if "pages" not in files:
        # 没有 atlas：把每张贴图都导出（前端按 pages 多页加载）
        if len(tex_order) == 1:
            out_png = key + ".png"
            primary_img.save(os.path.join(out_dir, out_png), "PNG")
            files["texture"] = out_png
            files["pages"] = [out_png]
            warnings.append("缺少 atlas，仅按单张贴图加载")
        else:
            pp = []
            for pi, tn in enumerate(tex_order):
                out_png = "%s_p%d.png" % (key, pi)
                tex_map[tn].save(os.path.join(out_dir, out_png), "PNG")
                pp.append(out_png)
            files["texture"] = pp[0]
            files["pages"] = pp
            warnings.append("缺少 atlas，已按 %d 张贴图顺序导出（部件归页可能不准确）" % len(pp))
        cover_tex = primary_img

    save_thumb(cover_tex, os.path.join(out_dir, thumb_path))

    result = {
        "kind": KIND_SPINE,
        "key": key,
        "name": base,
        "source": source,
        "encrypted": False,
        "files": files,
        "width": cover_tex.width,
        "height": cover_tex.height,
    }
    if warnings:
        result["warnings"] = warnings
    return result


# ---------------- Live2D ----------------
def export_live2d(item, out_dir, counters):
    env = UnityPy.load(item["path"])

    moc_bytes = None
    physics_text = None
    textures = []

    for o in env.objects:
        t = o.type.name
        try:
            if t == "MonoBehaviour" and moc_bytes is None:
                d = o.read()
                # CubismMoc 的 typetree 含 _bytes（int 数组，每元素一个字节）
                try:
                    tt = o.read_typetree()
                    arr = tt.get("_bytes")
                    if isinstance(arr, list) and len(arr) > 1000:
                        b = bytes((int(x) & 0xFF) for x in arr)
                        if b[:4] == b"MOC3":
                            moc_bytes = b
                except Exception:
                    pass
            elif t == "TextAsset" and physics_text is None:
                d = o.read()
                nm = (d.m_Name or "").lower()
                if "physics3" in nm:
                    physics_text = text_asset_str(d.m_Script)
            elif t == "Texture2D":
                d = o.read()
                textures.append((d.m_Name or ("texture_%d" % len(textures)), d.image.convert("RGBA")))
        except Exception:
            continue

    if moc_bytes is None:
        return None

    base = item["base"]
    source = item["source"] or ""
    key = "live2d_" + (safe_name(source.replace("/", "_") + "_") if source else "") + safe_name(base)
    os.makedirs(out_dir, exist_ok=True)

    files = {}
    moc_path = key + ".moc3"
    with open(os.path.join(out_dir, moc_path), "wb") as f:
        f.write(moc_bytes)
    files["moc"] = moc_path

    tex_files = []
    thumb_img = None
    # 贴图按名字排序，保证 texture_00.. 顺序稳定
    textures.sort(key=lambda x: x[0])
    for i, (tn, im) in enumerate(textures):
        tn_safe = "texture_%02d" % i
        tp = key + "_" + tn_safe + ".png"
        im.save(os.path.join(out_dir, tp), "PNG")
        tex_files.append(tp)
        if thumb_img is None:
            thumb_img = im
    files["textures"] = tex_files

    if physics_text:
        pp = key + ".physics3.json"
        with open(os.path.join(out_dir, pp), "w", encoding="utf-8") as f:
            f.write(physics_text)
        files["physics"] = pp

    thumb_path = None
    if thumb_img is not None:
        thumb_path = key + "_thumb.jpg"
        save_thumb(thumb_img, os.path.join(out_dir, thumb_path))
        files["thumb"] = thumb_path

    # 生成最小 model3.json（pixi-live2d-display 可直接加载 moc，model3 用于声明贴图/物理）
    model3 = {
        "Version": 3,
        "FileReferences": {
            "Moc": moc_path,
            "Textures": tex_files,
        },
    }
    if physics_text:
        model3["FileReferences"]["Physics"] = files["physics"]
    m3path = key + ".model3.json"
    with open(os.path.join(out_dir, m3path), "w", encoding="utf-8") as f:
        json.dump(model3, f, ensure_ascii=False, indent=1)
    files["model3"] = m3path

    return {
        "kind": KIND_LIVE2D,
        "key": key,
        "name": base,
        "source": source,
        "encrypted": False,
        "files": files,
        "textureCount": len(tex_files),
        "mocVersion": moc_bytes[:8].decode("latin1", "replace"),
    }


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

    # 压缩包本身加密（WinZip AES 等）：提前给出可识别标记，由上层弹密码框
    if detect_kind(archive) == "zip" and not ARCHIVE_PASSWORD and is_zip_encrypted(archive):
        emit({"ok": False, "code": "ARCHIVE_PASSWORD_REQUIRED", "error": "压缩包已加密，需要密码"})
        return

    os.makedirs(out_dir, exist_ok=True)
    work_root = tempfile.mkdtemp(prefix="fms_dyn_")
    items = []
    encrypted = []
    try:
        found = []
        try:
            walk_bundles(archive, work_root, "", MAX_DEPTH, found, encrypted)
        except EncryptedArchiveError as e:
            emit({"ok": False, "code": "ARCHIVE_PASSWORD_REQUIRED", "error": str(e)})
            return

        # Spine：若存在配对的 *_res 包则只用 res（壳无数据）；否则单包数据直接在内就用自身。
        spine_all = [x for x in found if x["kind"] == KIND_SPINE and not x["encrypted"]]
        spine_res_any = any(x["is_res"] for x in spine_all)
        if spine_res_any:
            spine_targets = [x for x in spine_all if x["is_res"]]
        else:
            spine_targets = spine_all
        l2d = [x for x in found if x["kind"] == KIND_LIVE2D and not x["encrypted"]]

        counters = {}
        for it in spine_targets:
            try:
                r = export_spine(it, out_dir, counters)
                if r:
                    items.append(r)
            except Exception as e:
                encrypted_note = {"kind": KIND_SPINE, "name": it["base"], "source": it["source"], "error": str(e)[:120]}
                encrypted.append(encrypted_note)
        for it in l2d:
            try:
                r = export_live2d(it, out_dir, counters)
                if r:
                    items.append(r)
            except Exception as e:
                encrypted.append({"kind": KIND_LIVE2D, "name": it["base"], "source": it["source"], "error": str(e)[:120]})
    finally:
        shutil.rmtree(work_root, ignore_errors=True)

    # 加密项去重（同名同源可能经裸文件与压缩包两条路径收集）
    seen = set()
    uniq_enc = []
    for e in encrypted:
        k = (e.get("kind"), e.get("name"), e.get("source"))
        if k in seen:
            continue
        seen.add(k)
        uniq_enc.append(e)

    items.sort(key=lambda x: (x["kind"], x["source"], x["name"]))
    emit({"ok": True, "encrypted": uniq_enc, "items": items})


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        emit({"ok": False, "error": "%s: %s" % (type(e).__name__, e)})
