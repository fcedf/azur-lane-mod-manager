/**
 * 数据库初始化：建表 + 写入种子数据
 * 运行: npm run init-db
 */
import bcrypt from 'bcryptjs';
import db from './index.js';

const SCHEMA = `
-- 用户表
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  nickname      TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user',   -- admin | user
  status        TEXT NOT NULL DEFAULT 'active', -- active | disabled
  storage_quota INTEGER NOT NULL DEFAULT 5368709120, -- 个人配额，默认 5GB
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- 分区表
CREATE TABLE IF NOT EXISTS spaces (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  type        TEXT NOT NULL DEFAULT 'personal', -- personal | shared | public
  description TEXT DEFAULT '',
  color       TEXT DEFAULT '#409eff',
  quota       INTEGER NOT NULL DEFAULT 0,        -- 0 表示不限
  owner_id    INTEGER NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (owner_id) REFERENCES users(id)
);

-- 空间成员表
CREATE TABLE IF NOT EXISTS space_members (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  space_id INTEGER NOT NULL,
  user_id  INTEGER NOT NULL,
  role     TEXT NOT NULL DEFAULT 'member', -- admin | member
  UNIQUE (space_id, user_id),
  FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 文件夹表
CREATE TABLE IF NOT EXISTS folders (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  space_id   INTEGER NOT NULL,
  parent_id  INTEGER,                          -- NULL 表示根目录
  name       TEXT NOT NULL,
  created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_id) REFERENCES folders(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_folders_parent ON folders(space_id, parent_id);

-- 文件表（逻辑删除：deleted=1 即回收站）
CREATE TABLE IF NOT EXISTS files (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  space_id      INTEGER NOT NULL,
  folder_id     INTEGER,
  name          TEXT NOT NULL,
  ext           TEXT DEFAULT '',
  mime_type     TEXT DEFAULT '',
  size          INTEGER NOT NULL DEFAULT 0,
  storage_path  TEXT NOT NULL,                 -- 物理文件相对路径
  file_hash     TEXT DEFAULT '',
  is_starred    INTEGER NOT NULL DEFAULT 0,
  origin_date   TEXT,                            -- 文件在本地的原始修改日期
  deleted       INTEGER NOT NULL DEFAULT 0,
  created_by    INTEGER NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  deleted_at    TEXT,
  tag_str       TEXT DEFAULT '',               -- 冗余标签串: 名称::颜色,名称::颜色
  FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE CASCADE,
  FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_files_folder ON files(space_id, folder_id, deleted);
CREATE INDEX IF NOT EXISTS idx_files_creator ON files(created_by, deleted);
CREATE INDEX IF NOT EXISTS idx_files_name ON files(name);

-- 分享表
CREATE TABLE IF NOT EXISTS shares (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id     INTEGER NOT NULL,
  created_by  INTEGER NOT NULL,
  code        TEXT NOT NULL UNIQUE,
  password    TEXT DEFAULT '',
  permission  TEXT NOT NULL DEFAULT 'preview', -- preview | download
  expire_at   TEXT,                            -- NULL 表示永久
  view_count  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
);

-- 操作日志表
CREATE TABLE IF NOT EXISTS operation_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER,
  username    TEXT DEFAULT '',
  action      TEXT NOT NULL,                  -- login | upload | download | delete | ...
  target_type TEXT DEFAULT 'file',
  target_id   INTEGER,
  detail      TEXT DEFAULT '',
  ip          TEXT DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_logs_user ON operation_logs(user_id);

-- 标签（分类）表
CREATE TABLE IF NOT EXISTS tags (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  color      TEXT NOT NULL DEFAULT '#409eff',
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (created_by) REFERENCES users(id)
);
`;

/** 老库增量迁移：补齐新增字段 */
function migrate() {
  const cols = db.prepare('PRAGMA table_info(files)').all().map((c) => c.name);
  if (!cols.includes('origin_date')) {
    db.exec('ALTER TABLE files ADD COLUMN origin_date TEXT');
    console.log('✅ 已添加字段 files.origin_date（文件原始日期）');
  }
  // 加密压缩包（WinZip AES 等）密码：按文件记住，成功后落盘
  db.exec(`CREATE TABLE IF NOT EXISTS archive_passwords (
    file_id    INTEGER PRIMARY KEY,
    password   TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
  );`);
}

/** 把文件 tag_str 中已存在的标签同步到独立 tags 表（幂等） */
function syncTagsFromFiles() {
  const rows = db.prepare("SELECT DISTINCT tag_str FROM files WHERE tag_str <> ''").all();
  const insert = db.prepare('INSERT OR IGNORE INTO tags (name, color, created_by) VALUES (?, ?, ?)');
  let n = 0;
  for (const row of rows) {
    for (const seg of String(row.tag_str).split(',').filter(Boolean)) {
      const [name, color] = seg.split('::');
      if (!name) continue;
      const info = insert.run(name, color || '#409eff', null);
      if (info.changes > 0) n += 1;
    }
  }
  if (n > 0) console.log(`✅ 已从历史文件迁移 ${n} 个标签`);
}

function seed() {
  const adminHash = bcrypt.hashSync('admin123', 10);
  const userHash = bcrypt.hashSync('user123', 10);

  const insertUser = db.prepare(
    `INSERT INTO users (username, password_hash, nickname, role, storage_quota)
     VALUES (?, ?, ?, ?, ?)`
  );

  const count = db.prepare('SELECT COUNT(*) AS c FROM users').get();
  if (count.c > 0) {
    console.log('✅ 检测到已有数据，跳过种子数据写入');
    return;
  }

  const adminInfo = insertUser.run('admin', adminHash, '系统管理员', 'admin', 0);
  const userInfo = insertUser.run('user', userHash, '普通用户', 'user', 5 * 1024 * 1024 * 1024);
  const adminId = adminInfo.lastInsertRowid;
  const userId = userInfo.lastInsertRowid;

  const insertSpace = db.prepare(
    `INSERT INTO spaces (name, type, description, color, owner_id)
     VALUES (?, ?, ?, ?, ?)`
  );
  const workId = insertSpace.run('工作文档', 'shared', '日常办公文档共享空间', '#409eff', adminId).lastInsertRowid;
  const projectId = insertSpace.run('项目资料', 'shared', '项目相关技术资料', '#67c23a', adminId).lastInsertRowid;
  const personalId = insertSpace.run('个人文件', 'personal', '我的个人空间', '#e6a23c', userId).lastInsertRowid;

  const insertMember = db.prepare(
    'INSERT OR IGNORE INTO space_members (space_id, user_id, role) VALUES (?, ?, ?)'
  );
  insertMember.run(workId, adminId, 'admin');
  insertMember.run(workId, userId, 'member');
  insertMember.run(projectId, adminId, 'admin');
  insertMember.run(projectId, userId, 'member');
  insertMember.run(personalId, userId, 'admin');

  const insertFolder = db.prepare(
    'INSERT INTO folders (space_id, parent_id, name, created_by) VALUES (?, ?, ?, ?)'
  );
  // 工作文档下的示例目录
  insertFolder.run(workId, null, '规章制度', adminId);
  insertFolder.run(workId, null, '会议纪要', adminId);
  insertFolder.run(workId, null, '报表数据', adminId);
  // 项目资料下的示例目录
  const docRoot = insertFolder.run(projectId, null, '需求文档', adminId).lastInsertRowid;
  insertFolder.run(projectId, docRoot, 'V1.0', adminId);
  insertFolder.run(projectId, null, '设计稿', adminId);
  // 个人空间示例
  insertFolder.run(personalId, null, '学习笔记', userId);

  console.log('✅ 种子数据写入完成');
}

// 执行
db.exec(SCHEMA);
migrate();
syncTagsFromFiles();
seed();

console.log('🎉 数据库初始化完成:', process.env.DB_PATH || 'data/fms.db');
console.log('   默认账号: admin / admin123 (管理员)');
console.log('             user  / user123  (普通用户)');
