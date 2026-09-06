const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const http = require('http');

// Enforce single instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
    app.quit();
    process.exit(0);
}

let mainWindow = null;
const PORT = process.env.PORT || 7644;
const SERVER_URL = `http://localhost:${PORT}`;

function createMainWindow() {
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 820,
        minWidth: 900,
        minHeight: 600,
        title: 'MoonPlayer',
        icon: path.join(__dirname, 'assets', 'icon.png'),
        backgroundColor: '#070708',
        autoHideMenuBar: true,
        show: false,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            webSecurity: true
        }
    });

    // Show window once ready to avoid blank white flash
    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
    });

    // Open external links in user's default browser
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith('http:') || url.startsWith('https:')) {
            shell.openExternal(url);
        }
        return { action: 'deny' };
    });

    // Prevent navigating away if files are dragged into the window
    mainWindow.webContents.on('will-navigate', (event, url) => {
        if (!url.startsWith(SERVER_URL)) {
            event.preventDefault();
        }
    });

    // Load the internal server URL once
    let hasLoaded = false;
    function loadApp() {
        if (hasLoaded || !mainWindow) return;
        hasLoaded = true;
        mainWindow.loadURL(SERVER_URL);
    }

    // Auto-retry if server took a fraction of a second to bind
    mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
        console.warn(`[Load Warning] ${errorCode} (${errorDescription}). Retrying...`);
        hasLoaded = false;
        setTimeout(loadApp, 300);
    });

    // Load after internal server bind
    setTimeout(loadApp, 250);

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

// When second instance is launched, focus the existing main window
app.on('second-instance', () => {
    if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
    }
});

// App lifecycle
app.whenReady().then(() => {
    // 1. Start the internal Express server
    try {
        require('./server.js');
    } catch (err) {
        console.error('Failed to start internal server:', err);
    }

    // 2. Open the desktop UI window
    createMainWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createMainWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
