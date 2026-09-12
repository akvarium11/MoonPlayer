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
