import app from './app.js';
import config from './config/index.js';

app.listen(config.port, () => {
  console.log('');
  console.log('🚀 文件管理系统后端已启动');
  console.log(`   本地地址:  http://localhost:${config.port}`);
  console.log(`   健康检查:  http://localhost:${config.port}/api/health`);
  console.log(`   文件目录:  ${config.uploadDir}`);
  console.log('');
});
