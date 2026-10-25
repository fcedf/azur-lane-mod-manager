// 使用 Node v22 内置的 node:sqlite（无需安装/编译原生模块）
import { DatabaseSync } from 'node:sqlite';
import config from '../config/index.js';
import { bootstrapDatabase } from './bootstrap.js';

const db = new DatabaseSync(config.dbPath);

// 基础优化（node:sqlite 用 exec 执行 PRAGMA）
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

// 运行时幂等建表 + 全新库默认管理员（必须在任何业务模块使用表之前执行）
bootstrapDatabase(db);

export default db;
