const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const releaseDir = path.join(rootDir, 'src-tauri', 'target', 'release');
const distDir = path.join(rootDir, 'dist');
const portableDir = path.join(distDir, 'MoonPlayer-portable');
const zipFile = path.join(distDir, 'MoonPlayer_2.4.0_portable.zip');
const nsisSrc = path.join(releaseDir, 'bundle', 'nsis', 'MoonPlayer_2.4.0_x64-setup.exe');
const nsisDst = path.join(distDir, 'MoonPlayer_2.4.0_x64-setup.exe');

console.log('[Packaging] Preparing portable and installer distribution in dist/...');

if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
}

// 1. Copy NSIS installer to dist
if (fs.existsSync(nsisSrc)) {
    console.log('[Packaging] Copying installer to dist/MoonPlayer_2.4.0_x64-setup.exe...');
    fs.copyFileSync(nsisSrc, nsisDst);
}

// 2. Prepare portable directory
if (fs.existsSync(portableDir)) {
    fs.rmSync(portableDir, { recursive: true, force: true });
}
fs.mkdirSync(portableDir, { recursive: true });

// Copy executable and dll
const filesToCopy = ['moonplayer.exe', 'WebView2Loader.dll'];
for (const file of filesToCopy) {
    const src = path.join(releaseDir, file);
    if (fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(portableDir, file));
    }
}

// Copy server folder
const serverSrc = path.join(releaseDir, 'server');
const serverDst = path.join(portableDir, 'server');
if (fs.existsSync(serverSrc)) {
    console.log('[Packaging] Copying server directory to portable distribution...');
    fs.cpSync(serverSrc, serverDst, { recursive: true });
}

// 3. Create portable zip using Windows built-in tar (fast multi-threaded)
console.log('[Packaging] Creating portable zip archive...');
if (fs.existsSync(zipFile)) {
    fs.unlinkSync(zipFile);
}
try {
    execSync(`tar -a -cf "${zipFile}" -C "${distDir}" "MoonPlayer-portable"`, {
        stdio: 'inherit'
    });
    console.log('[Packaging] Created:', zipFile);
} catch (e) {
    console.warn('[Packaging] Failed to create zip with tar:', e.message);
}

console.log('[Packaging] Done! Distribution files are ready in dist/:');
if (fs.existsSync(nsisDst)) {
    console.log(' - Setup Installer:', nsisDst, `(${(fs.statSync(nsisDst).size / (1024 * 1024)).toFixed(1)} MB)`);
}
if (fs.existsSync(zipFile)) {
    console.log(' - Portable ZIP:   ', zipFile, `(${(fs.statSync(zipFile).size / (1024 * 1024)).toFixed(1)} MB)`);
}
