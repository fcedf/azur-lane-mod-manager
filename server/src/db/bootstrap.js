/**
 * 运行时数据库自举（重要）
 *
 * 历史上建表只在 db/init.js（需手动 npm run init-db），导致安装到全新主机、
 * 使用空数据目录时，服务一启动就因“表不存在”崩溃。
 * 此模块在 db 连接建立后立即幂等执行：基础表不存在则建；无任何用户时创建默认 admin。
 * 后续新增列/附属表仍由各业务模块自己幂等迁移（storage-roots、tag-tree、archive-password 等）。
 */
import bcrypt from 'bcryptjs';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  nickname      TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user',
  status        TEXT NOT NULL DEFAULT 'active',
  storage_quota INTEGER NOT NULL DEFAULT 5368709120,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS spaces (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  type        TEXT NOT NULL DEFAULT 'personal',
  description TEXT DEFAULT '',
  color       TEXT DEFAULT '#409eff',
  quota       INTEGER NOT NULL DEFAULT 0,
  owner_id    INTEGER NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (owner_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS space_members (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  space_id INTEGER NOT NULL,
  user_id  INTEGER NOT NULL,
  role     TEXT NOT NULL DEFAULT 'member',
  UNIQUE (space_id, user_id),
  FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS folders (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  space_id   INTEGER NOT NULL,
  parent_id  INTEGER,
  name       TEXT NOT NULL,
  created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_id) REFERENCES folders(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_folders_parent ON folders(space_id, parent_id);
CREATE TABLE IF NOT EXISTS files (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  space_id      INTEGER NOT NULL,
  folder_id     INTEGER,
  name          TEXT NOT NULL,
  ext           TEXT DEFAULT '',
  mime_type     TEXT DEFAULT '',
  size          INTEGER NOT NULL DEFAULT 0,
  storage_path  TEXT NOT NULL,
  file_hash     TEXT DEFAULT '',
  is_starred    INTEGER NOT NULL DEFAULT 0,
  origin_date   TEXT,
  deleted       INTEGER NOT NULL DEFAULT 0,
  created_by    INTEGER,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  deleted_at    TEXT,
  tag_str       TEXT DEFAULT '',
  FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE CASCADE,
  FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_files_folder ON files(space_id, folder_id, deleted);
CREATE INDEX IF NOT EXISTS idx_files_creator ON files(created_by, deleted);
CREATE INDEX IF NOT EXISTS idx_files_name ON files(name);
CREATE TABLE IF NOT EXISTS shares (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id     INTEGER NOT NULL,
  created_by  INTEGER NOT NULL,
  code        TEXT NOT NULL UNIQUE,
  password    TEXT DEFAULT '',
  permission  TEXT NOT NULL DEFAULT 'preview',
  expire_at   TEXT,
  view_count  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS operation_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER,
  username    TEXT DEFAULT '',
  action      TEXT NOT NULL,
  target_type TEXT DEFAULT 'file',
  target_id   INTEGER,
  detail      TEXT DEFAULT '',
  ip          TEXT DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_logs_user ON operation_logs(user_id);
CREATE TABLE IF NOT EXISTS tags (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  color      TEXT NOT NULL DEFAULT '#409eff',
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (created_by) REFERENCES users(id)
);
`;

export function bootstrapDatabase(db) {
  db.exec(SCHEMA);

  // 全新库：创建默认管理员及其个人空间，保证装完即可登录
  const userCount = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  if (userCount === 0) {
    const hash = bcrypt.hashSync('admin123', 10);
    const info = db
      .prepare("INSERT INTO users (username, password_hash, nickname, role, storage_quota) VALUES ('admin', ?, '系统管理员', 'admin', 0)")
      .run(hash);
    const adminId = info.lastInsertRowid;
    const space = db
      .prepare("INSERT INTO spaces (name, type, description, owner_id) VALUES ('我的文件', 'personal', '默认个人空间', ?)")
      .run(adminId);
    db.prepare('INSERT INTO space_members (space_id, user_id, role) VALUES (?, ?, ?)').run(
      space.lastInsertRowid, adminId, 'admin'
    );
    console.log('✅ 已初始化数据库：默认账号 admin / admin123');
  }
}
