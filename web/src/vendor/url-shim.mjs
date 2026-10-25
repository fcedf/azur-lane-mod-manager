/**
 * 浏览器端 Node `url` 模块垫片。
 *
 * 背景：pixi-live2d-display@0.4（为 pixi@6 编写）使用 `@pixi/utils` 的
 * `url.resolve(base, path)` 把 model3.json 里的相对引用（moc3 / 贴图 / physics）
 * 解析成可请求地址。pixi@7 的 utils 又去 import Node 的 "url" 包，其浏览器 polyfill
 * 没有 ESM 具名导出（resolve/format/parse），Vite 打包直接报错。
 *
 * 本系统所有动态资源都经同一个接口分发：
 *   /api/files/:id/dynamic/asset?name=<文件名>&access_token=...
 * 而 model3.json 里写的是裸文件名（如 live2d_xxx.moc3）。标准 url.resolve 会把
 * `asset` 当成目录、丢掉 query，拼出错误路径。因此这里针对该接口做“替换 name 参数”
 * 的解析，保留 endpoint 与 token；其它情况退回标准相对路径语义。
 */

const ASSET_RE = /^(.*\/dynamic\/asset)(\?.*)?$/;

function ensureToken(href) {
  const qIndex = href.indexOf('?');
  const query = qIndex >= 0 ? href.slice(qIndex + 1) : '';
  if (/[?&]access_token=/.test('?' + query)) return href;
  const tk = localStorage.getItem('fms_token');
  if (!tk) return href;
  return href + (query ? '&' : '?') + 'access_token=' + encodeURIComponent(tk);
}

export function resolve(base, path) {
  try {
    if (typeof base === 'string') {
      const m = ASSET_RE.exec(base);
      if (m) {
        // 统一走 asset 接口：用引用文件名替换 name 参数，保留 token
        const endpoint = m[1];
        const file = String(path).split('/').pop().split('?')[0];
        let token = '';
        try {
          const u = new URL(base, window.location.origin);
          token = u.searchParams.get('access_token') || localStorage.getItem('fms_token') || '';
        } catch {
          token = localStorage.getItem('fms_token') || '';
        }
        let href = endpoint + '?name=' + encodeURIComponent(file);
        if (token) href += '&access_token=' + encodeURIComponent(token);
        return href; // 相对路径，dev 走 Vite 代理；Electron 下 base 本身是绝对地址
      }
    }
    // 通用兜底：用原生 URL 做相对解析（base 相对时基于当前 origin）
    return ensureToken(new URL(path, new URL(base, window.location.origin)).href);
  } catch {
    return path;
  }
}

export function format(urlObj) {
  if (typeof urlObj === 'string') return urlObj;
  try {
    return new URL(urlObj.href || `${urlObj.protocol || ''}//${urlObj.host || ''}${urlObj.pathname || ''}`).href;
  } catch {
    return String(urlObj);
  }
}

export function parse(urlStr) {
  try {
    const u = new URL(urlStr, window.location.origin);
    return {
      protocol: u.protocol,
      host: u.host,
      hostname: u.hostname,
      port: u.port,
      pathname: u.pathname,
      search: u.search,
      hash: u.hash,
      query: u.search,
      href: u.href,
    };
  } catch {
    return { href: urlStr, pathname: urlStr };
  }
}

export default { resolve, format, parse };
