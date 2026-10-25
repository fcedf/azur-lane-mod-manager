const { app } = require('electron');
console.log('Node:', process.versions.node);
console.log('Electron:', process.versions.electron);
try {
  require('node:sqlite');
  console.log('结果: node:sqlite [可用]');
} catch (e) {
  console.log('结果: node:sqlite [不可用] ->', e.code || e.message);
}
app.exit(0);
