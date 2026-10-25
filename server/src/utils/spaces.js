import db from '../db/index.js';

/**
 * 获取用户可访问的全部空间 id
 * - 管理员：所有空间
 * - 普通用户：自己拥有的 + 加入的 + 公共空间
 */
export function accessibleSpaceIds(user) {
  if (user.role === 'admin') {
    return db.prepare('SELECT id FROM spaces').all().map((r) => r.id);
  }
  return db
    .prepare(
      `SELECT DISTINCT s.id FROM spaces s
       LEFT JOIN space_members m ON m.space_id = s.id
       WHERE s.owner_id = ? OR m.user_id = ? OR s.type = 'public'`
    )
    .all(user.id, user.id)
    .map((r) => r.id);
}

/** 判定用户在某个空间中的角色：admin | member | null */
export function getSpaceRole(user, space) {
  if (user.role === 'admin') return 'admin';
  if (space.owner_id === user.id) return 'admin';
  if (space.type === 'public') return 'member';
  const m = db
    .prepare('SELECT role FROM space_members WHERE space_id = ? AND user_id = ?')
    .get(space.id, user.id);
  return m?.role || null;
}

/** 获取或创建当前用户的默认个人空间（上传时无需关心存到哪个空间） */
export function ensureDefaultSpace(userId) {
  const existing = db
    .prepare("SELECT * FROM spaces WHERE owner_id = ? AND type = 'personal' ORDER BY id LIMIT 1")
    .get(userId);
  if (existing) return existing;

  const info = db
    .prepare("INSERT INTO spaces (name, type, description, owner_id) VALUES ('我的文件', 'personal', '默认个人空间', ?)")
    .run(userId);
  db.prepare('INSERT INTO space_members (space_id, user_id, role) VALUES (?, ?, ?)').run(
    info.lastInsertRowid,
    userId,
    'admin'
  );
  return db.prepare('SELECT * FROM spaces WHERE id = ?').get(info.lastInsertRowid);
}
