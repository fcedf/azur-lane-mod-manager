import { BizError, fail } from '../utils/response.js';

/** 404 处理 */
export function notFound(req, res) {
  return fail(res, `接口不存在: ${req.method} ${req.path}`, 404);
}

/** 全局错误处理（必须保留 4 个参数） */
export function errorHandler(err, req, res, _next) {
  if (err instanceof BizError) {
    return fail(res, err.message, err.status);
  }
  // Multer 等错误
  if (err?.code === 'LIMIT_FILE_SIZE') {
    return fail(res, '文件大小超出限制', 413);
  }
  console.error('[ERROR]', err);
  return fail(res, '服务器内部错误', 500);
}
