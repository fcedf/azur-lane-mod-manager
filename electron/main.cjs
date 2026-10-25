const { app, BrowserWindow, Tray, Menu, dialog, ipcMain } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const PORT = 3200;
let win = null;
let tray = null;
let serverProc = null;
let isQuitting = false; // 区分“真正退出”与“关闭时最小化到托盘”

const RES = process.resourcesPath;
const isPackaged = app.isPackaged;

/* ---------------- 存储目录配置 ---------------- */
// 配置保存在 Electron 用户数据目录下的 storage.json，记录用户选择的存储根目录。
// 后端的 UPLOAD_DIR / DB_PATH 都基于它；缓存目录由后端自动跟随该根目录。
function storageConfigPath() {
  return path.join(app.getPath('userData'), 'storage.json');
}
// 默认建议目录：优先“文档\文件管理系统”；不可用时逐级回退，保证一定能建出来
function defaultStorageDir() {
  // 打包后：默认数据目录 = 程序所在目录旁的 data（软件与数据放一起，自包含、好备份）。
  // 开发态：用文档\文件管理系统，避免污染源码目录。
  const candidates = isPackaged
    ? [
        () => path.join(path.dirname(app.getPath('exe')), 'data'),
        () => path.join(app.getPath('documents'), '文件管理系统'),
        () => path.join(app.getPath('userData'), 'storage'),
      ]
    : [
        () => path.join(app.getPath('documents'), '文件管理系统'),
        () => path.join(app.getPath('userData'), 'storage'),
      ];
  for (const make of candidates) {
    try {
      const dir = make();
      if (dir && path.isAbsolute(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        return dir;
      }
    } catch { /* 尝试下一个 */ }
  }
  // 最后兑底：用户数据目录下 storage
  const fallback = path.join(app.getPath('userData'), 'storage');
  fs.mkdirSync(fallback, { recursive: true });
  return fallback;
}
function readStorageConfig() {
  try {
    return JSON.parse(fs.readFileSync(storageConfigPath(), 'utf-8'));
  } catch {
    return null;
  }
}
// 写配置并确保目录存在；若给定目录无法创建，回退到默认目录
function writeStorageConfig(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.accessSync(dir, fs.constants.W_OK);
  } catch {
    dir = defaultStorageDir();
  }
  try {
    fs.writeFileSync(storageConfigPath(), JSON.stringify({ storageDir: dir }, null, 2), 'utf-8');
  } catch { /* 配置写不进也不阻塞启动 */ }
  return dir;
}

/**
 * 首次启动：弹窗让用户选存储目录；取消则用默认目录。
 * 返回最终存储根目录绝对路径。
 */
async function ensureStorageDir(forceChoose = false) {
  let fallback = defaultStorageDir();
  try {
    const cfg = readStorageConfig();
    if (!forceChoose && cfg && cfg.storageDir && fs.existsSync(cfg.storageDir)) {
      return cfg.storageDir;
    }
    const choice = await dialog.showOpenDialog({
      title: cfg && cfg.storageDir ? '更改文件存储位置' : '请选择文件存储位置',
      defaultPath: cfg?.storageDir || fallback,
      properties: ['openDirectory', 'createDirectory'],
      buttonLabel: '选择此文件夹',
    });
    if (choice.canceled || !choice.filePaths?.length) {
      // 首次使用取消：使用默认目录并记住，避免反复弹窗
      return writeStorageConfig(fallback);
    }
    return writeStorageConfig(choice.filePaths[0]);
  } catch {
    return fallback;
  }
}

const SERVER_ENTRY = isPackaged
  ? path.join(RES, 'server/src/server.js')
  : path.join(__dirname, '../server/src/server.js');

// 后端必须用 Node >= 22（依赖内置 node:sqlite）
const NODE_EXE = isPackaged
  ? path.join(RES, 'runtime/node.exe')
  : 'C:/Program Files/nodejs/node.exe';

const TRAY_ICON = path.join(__dirname, 'assets/tray.png');

/** 启动后端子进程，storageDir 为用户选择的存储根目录 */
function startServer(storageDir) {
  const dir = storageDir.replace(/\\/g, '/');
  const env = {
    ...process.env,
    PORT: String(PORT),
    UPLOAD_DIR: dir,
    DB_PATH: `${dir}/fms.db`,
  };
  if (isPackaged) {
    // 打包后使用安装包内嵌的 Python 运行时与脚本，避免读到开发机的环境变量
    delete env.PYTHON_PATH;
    env.SCRIPTS_DIR = path.join(RES, 'server', 'scripts');
  }
  serverProc = spawn(NODE_EXE, [SERVER_ENTRY], { env, stdio: 'ignore' });
  serverProc.on('exit', () => { serverProc = null; });
}

/** 轮询健康检查，等待后端就绪 */
function waitForServer(retries = 50) {
  return new Promise((resolve, reject) => {
    const tick = async (left) => {
      try {
        const res = await fetch(`http://127.0.0.1:${PORT}/api/health`);
        if (res.ok) return resolve();
      } catch {
        /* 未就绪 */
      }
      if (left <= 0) return reject(new Error('后端启动超时'));
      setTimeout(() => tick(left - 1), 200);
    };
    tick(retries);
  });
}

/** 读取开机自启状态 */
function getOpenAtLogin() {
  return app.getLoginItemSettings().openAtLogin;
}

/** 切换开机自启 */
function setOpenAtLogin(enabled) {
  app.setLoginItemSettings({ openAtLogin: enabled });
}

/** 构建托盘上下文菜单 */
function buildTrayMenu() {
  return Menu.buildFromTemplate([
    { label: '打开文件管理系统', click: () => showWindow() },
    {
      label: '开机自动启动',
      type: 'checkbox',
      checked: getOpenAtLogin(),
      click: (item) => setOpenAtLogin(item.checked),
    },
    { type: 'separator' },
    {
      label: '更改文件存储位置…',
      click: () => changeStorageLocation(),
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
}

/** 更改存储位置：选目录 → 写配置 → 重启后端进程生效（不重启 App）*/
async function changeStorageLocation() {
  const cur = readStorageConfig()?.storageDir || defaultStorageDir();
  const choice = await dialog.showMessageBox(win,
    {
      type: 'info',
      buttons: ['选择新位置', '取消'],
      defaultId: 0,
      cancelId: 1,
      title: '更改文件存储位置',
      message: '更改后，新上传的文件会保存到新位置。\n注意：已有文件不会被移动，仍在原位置。建议保持同一位置。\n是否继续？',
    }
  );
  if (choice.response !== 0) return;

  const pick = await dialog.showOpenDialog(win, {
    title: '选择新的文件存储位置',
    defaultPath: cur,
    properties: ['openDirectory', 'createDirectory'],
    buttonLabel: '使用此文件夹',
  });
  if (pick.canceled || !pick.filePaths?.length) return;
  const dir = writeStorageConfig(pick.filePaths[0]);

  // 重启后端子进程
  if (serverProc) {
    try { serverProc.kill(); } catch { /* ignore */ }
    serverProc = null;
  }
  startServer(dir);
  try {
    await waitForServer();
  } catch { /* 忽略，窗口仍可重试 */ }
  dialog.showMessageBox(win,
    {
      type: 'info',
      buttons: ['确定'],
      title: '已切换',
      message: `存储位置已切换到：\n${dir}`,
    }
  );
}

/** 创建系统托盘 */
function createTray() {
  tray = new Tray(TRAY_ICON);
  tray.setToolTip('文件管理系统（正在运行）');
  tray.setContextMenu(buildTrayMenu());
  // Windows：双击托盘图标显示窗口
  tray.on('double-click', () => showWindow());
}

/** 显示并聚焦主窗口 */
function showWindow() {
  if (!win) return;
  win.show();
  win.focus();
}

/** 创建主窗口 */
async function createWindow() {
  win = new BrowserWindow({
    width: 1320,
    height: 840,
    minWidth: 1024,
    minHeight: 680,
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isPackaged) {
    await win.loadFile(path.join(RES, 'web/dist/index.html'));
  } else {
    await win.loadURL('http://localhost:5173');
  }
  win.show();

  // 拦截关闭：Windows/Linux 点关闭隐藏到托盘；macOS 保持默认行为
  win.on('close', (e) => {
    if (!isQuitting && process.platform !== 'darwin') {
      e.preventDefault();
      win.hide();
    }
  });
}

// 单实例锁，防止多开
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());

  app.whenReady().then(async () => {
    // 默认开启开机自启（用户可在托盘菜单关闭）
    if (!getOpenAtLogin()) setOpenAtLogin(true);

    // 首次启动弹窗选存储目录；之后用记住的目录
    const storageDir = await ensureStorageDir(false);
    startServer(storageDir);
    try {
      await waitForServer();
    } catch (e) {
      console.error(e.message);
    }
    createTray();
    await createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

// 真正退出前：先标记，再停止后端
app.on('before-quit', () => {
  isQuitting = true;
});

app.on('window-all-closed', () => {
  // 注意：关闭窗口已改为隐藏到托盘，正常不会触发真正退出；
  // 仅在无托盘平台等情况下兜底
  if (process.platform !== 'darwin') {
    // 不主动退出，让托盘保持运行
  }
});

// 应用退出时清理后端子进程
app.on('will-quit', () => {
  if (serverProc) {
    try { serverProc.kill(); } catch { /* ignore */ }
  }
});
