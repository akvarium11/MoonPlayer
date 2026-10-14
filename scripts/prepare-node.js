const fs = require('fs');
const path = require('path');

const targetDir = path.join(__dirname, '..', 'bin');
const targetFile = path.join(targetDir, 'node.exe');

if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
}

if (!fs.existsSync(targetFile)) {
    console.log('[Prepare] Copying node.exe to bin/node.exe...');
    try {
        fs.copyFileSync(process.execPath, targetFile);
        console.log('[Prepare] Successfully bundled node.exe.');
    } catch (e) {
        console.warn('[Prepare] Could not copy node.exe:', e.message);
    }
} else {
    console.log('[Prepare] bin/node.exe is ready.');
}

const webviewDll = path.join(targetDir, 'WebView2Loader.dll');
if (!fs.existsSync(webviewDll)) {
    // Search common location if not yet in bin
    const candidates = [
        path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'TeamsMeetingAdd-in', '1.25.24601', 'x64', 'runtimes', 'win-x64', 'native', 'WebView2Loader.dll')
    ];
    for (const cand of candidates) {
        if (fs.existsSync(cand)) {
            try {
                fs.copyFileSync(cand, webviewDll);
                console.log('[Prepare] Successfully bundled WebView2Loader.dll.');
                break;
            } catch (e) {
                console.warn('[Prepare] Failed to copy WebView2Loader.dll:', e.message);
            }
        }
    }
}

