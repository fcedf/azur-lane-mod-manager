import { Router } from 'express';
import db from '../db/index.js';
import { success } from '../utils/response.js';
import { getFileType } from '../utils/file-type.js';
import { withTags } from '../utils/response.js';

const router = Router();

/**
 * GET /api/search?q=&spaceId=
 * 搜索范围：文件名、标签、备注；按可访问空间过滤
 * 支持多关键词（空格分隔，AND 匹配）
 */
router.get('/', (req, res, next) => {
  try {
    const q = (req.query.q || '').trim();
    const spaceId = req.query.spaceId ? Number(req.query.spaceId) : null;
    const keywords = q.split(/\s+/).filter(Boolean);

    let spaces = db
      .prepare(
        `SELECT DISTINCT s.id FROM spaces s
         LEFT JOIN space_members m ON m.space_id = s.id
         WHERE s.owner_id = ? OR m.user_id = ? OR s.type = 'public'
               OR ? = (SELECT role FROM users WHERE id = ?)`
      )
      .all(req.user.id, req.user.id, 'admin', req.user.id)
      .map((s) => s.id);

    if (!spaces.length) return success(res, []);
    if (spaceId) spaces = spaces.includes(spaceId) ? [spaceId] : [];

    const conditions = ['f.deleted = 0', `f.space_id IN (${spaces.map(() => '?').join(',')})`];
    const params = [...spaces];

    if (keywords.length) {
      const likeParts = [];
      for (const kw of keywords) {
        likeParts.push('(f.name LIKE ? OR f.tag_str LIKE ?)');
        params.push(`%${kw}%`, `%${kw}%`);
      }
      conditions.push(likeParts.join(' AND '));
    }

    const rows = db
      .prepare(
        `SELECT f.*, s.name AS space_name, u.nickname AS creator_name,
                COALESCE(fm.enabled, 0) AS mod_enabled
         FROM files f
         JOIN spaces s ON s.id = f.space_id
         LEFT JOIN users u ON u.id = f.created_by
         LEFT JOIN file_mods fm ON fm.file_id = f.id
         WHERE ${conditions.join(' AND ')}
         ORDER BY f.updated_at DESC LIMIT 200`
      )
      .all(...params);

    const result = rows.map((r) => ({
      ...withTags(r),
      type: getFileType(r.name),
    }));
    return success(res, result);
  } catch (e) {
    next(e);
  }
});

/** GET /api/search/tags —— 我的全部标签（标签云） */
router.get('/tags', (req, res, next) => {
  try {
    const rows = db
      .prepare(
        `SELECT f.tag_str FROM files f
         LEFT JOIN space_members m ON m.space_id = f.space_id
         WHERE f.deleted = 0 AND
           (f.created_by = ? OR m.user_id = ? OR f.space_id IN
              (SELECT id FROM spaces WHERE type='public' OR owner_id = ?))`
      )
      .all(req.user.id, req.user.id, req.user.id);

    const map = new Map();
    for (const row of rows) {
      for (const seg of String(row.tag_str || '').split(',').filter(Boolean)) {
        const [name, color] = seg.split('::');
        if (!map.has(name)) map.set(name, { name, color: color || '#909399', count: 0 });
        map.get(name).count += 1;
      }
    }
    return success(res, [...map.values()].sort((a, b) => b.count - a.count));
  } catch (e) {
    next(e);
  }
});

export default router;
