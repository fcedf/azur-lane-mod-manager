import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { authRequired } from './middleware/auth.js';
import { notFound, errorHandler } from './middleware/error.js';

import authRoutes from './routes/auth.js';
import spaceRoutes from './routes/spaces.js';
import folderRoutes from './routes/folders.js';
import fileRoutes from './routes/files.js';
import paintingRoutes from './routes/paintings.js';
import dynamicRoutes from './routes/dynamic.js';
import tagRoutes from './routes/tags.js';
import searchRoutes from './routes/search.js';
import shareRoutes from './routes/shares.js';
import publicShareRoutes from './routes/publicShare.js';
import systemRoutes from './routes/system.js';
import adminRoutes from './routes/admin.js';
import modRoutes from './routes/mods.js';
import storageRoutes from './routes/storage.js';

const app = express();

// 基础中间件
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

// 健康检查
app.get('/api/health', (req, res) => res.json({ code: 0, message: 'ok', data: { status: 'up' } }));

// 公开路由（登录、分享公开访问）
app.use('/api/auth', authRoutes);
app.use('/api/public/share', publicShareRoutes);
app.use('/api/system', systemRoutes);

// 需要登录的路由
app.use('/api/spaces', authRequired, spaceRoutes);
app.use('/api/folders', authRequired, folderRoutes);
app.use('/api/files', authRequired, paintingRoutes);
app.use('/api/files', authRequired, dynamicRoutes);
app.use('/api/files', authRequired, fileRoutes);
app.use('/api/tags', authRequired, tagRoutes);
app.use('/api/search', authRequired, searchRoutes);
app.use('/api/shares', authRequired, shareRoutes);
app.use('/api/admin', authRequired, adminRoutes);
app.use('/api', modRoutes);
app.use('/api/storage', authRequired, storageRoutes);

// 兜底
app.use(notFound);
app.use(errorHandler);

export default app;
