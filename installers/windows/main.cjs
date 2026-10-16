const { app, BrowserWindow, Menu, dialog, shell } = require('electron');

const APP_URL = process.env.URBATRAME_URL || 'https://freemap-5j3b1xjtp-freemind25-2831s-projects.vercel.app';
const APP_ORIGIN = new URL(APP_URL).origin;
let mainWindow;

function openExternal(url) {
  try {
    const parsed = new URL(url);
    if (['https:', 'mailto:'].includes(parsed.protocol)) void shell.openExternal(url);
  } catch {
    // Ignore malformed and non-web navigation targets.
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 900,
    minHeight: 640,
    show: false,
    title: 'UrbaTrame',
    backgroundColor: '#f6f7f4',
    autoHideMenuBar: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      if (new URL(url).origin === APP_ORIGIN) return { action: 'allow' };
    } catch {}
    openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    try {
      if (new URL(url).origin === APP_ORIGIN) return;
    } catch {}
    event.preventDefault();
    openExternal(url);
  });
  mainWindow.webContents.on('will-attach-webview', event => event.preventDefault());
  mainWindow.webContents.on('did-fail-load', async (_event, code, description, _url, isMainFrame) => {
    if (!isMainFrame || code === -3 || mainWindow?.isDestroyed()) return;
    const result = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      title: 'UrbaTrame — connexion indisponible',
      message: 'UrbaTrame a besoin d’une connexion Internet pour ouvrir le service en ligne.',
      detail: description || 'Vérifiez votre connexion puis réessayez.',
      buttons: ['Réessayer', 'Ouvrir dans le navigateur', 'Fermer'],
      defaultId: 0,
      cancelId: 2,
      noLink: true
    });
    if (mainWindow?.isDestroyed()) return;
    if (result.response === 0) void mainWindow.loadURL(APP_URL);
    else if (result.response === 1) openExternal(APP_URL);
  });
  mainWindow.on('closed', () => { mainWindow = null; });
  void mainWindow.loadURL(APP_URL);
}

app.setName('UrbaTrame');
app.setAppUserModelId('com.urbatrame.desktop');

app.whenReady().then(() => {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: 'Fichier',
      submenu: [
        { label: 'Recharger UrbaTrame', accelerator: 'F5', click: () => mainWindow?.webContents.reload() },
        { type: 'separator' },
        { label: 'Quitter', accelerator: 'Alt+F4', role: 'quit' }
      ]
    },
    {
      label: 'Aide',
      submenu: [
        { label: 'Ouvrir UrbaTrame dans le navigateur', click: () => openExternal(APP_URL) }
      ]
    }
  ]));
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
