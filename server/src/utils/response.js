/**
 * 统一响应工具
 * 成功: { code: 0, message: 'ok', data }
 * 失败: { code: 非0, message, data: null }
 */

export function success(res, data = null, message = 'ok') {
  return res.json({ code: 0, message, data });
}

export function fail(res, message = '请求失败', status = 400, code = null) {
  return res.status(status).json({ code: code ?? status, message, data: null });
}

/** 业务异常，可被全局错误中间件捕获 */
export class BizError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'BizError';
    this.status = status;
  }
}

/** 把数据库中的 tag_str("名称:颜色,名称:颜色") 解析为标签数组 */
export function parseTagStr(tagStr) {
  if (!tagStr) return [];
  return String(tagStr)
    .split(',')
    .filter(Boolean)
    .map((seg) => {
      const [name, color] = seg.split('::');
      return { name, color: color || '#409eff' };
    });
}

/** 给文件记录附加 tags 数组 */
export function withTags(row) {
  if (!row) return row;
  const { tag_str: tagStr, ...rest } = row;
  return { ...rest, tags: parseTagStr(tagStr) };
}
