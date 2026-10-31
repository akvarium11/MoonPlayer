const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
const version = pkg.version || '3.0.0';

const releaseDir = path.join(rootDir, 'src-tauri', 'target', 'release');
const distDir = path.join(rootDir, 'dist');
const portableDir = path.join(distDir, 'MoonPlayer-portable');
const zipFile = path.join(distDir, `MoonPlayer_${version}_portable.zip`);
const nsisDir = path.join(releaseDir, 'bundle', 'nsis');
const nsisDst = path.join(distDir, `MoonPlayer_${version}_x64-setup.exe`);

console.log(`[Packaging] Preparing portable and installer distribution for v${version} in dist/...`);

if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
}

// 1. Copy NSIS installer to dist
if (fs.existsSync(nsisDir)) {
    const setupFiles = fs.readdirSync(nsisDir)
        .filter(f => f.endsWith('-setup.exe'))
        .map(f => ({ name: f, mtime: fs.statSync(path.join(nsisDir, f)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime);
    if (setupFiles.length > 0) {
        const nsisSrc = path.join(nsisDir, setupFiles[0].name);
        console.log(`[Packaging] Copying installer to dist/${path.basename(nsisDst)}...`);
        fs.copyFileSync(nsisSrc, nsisDst);
    }
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
    // Use Windows' own bsdtar: the GNU tar from Git for Windows ignores "-a"
    // for .zip and silently writes a plain tar, and it reads an absolute
    // "G:\..." archive path as a remote host ("Cannot connect to G: resolve
    // failed"). Run from dist/ with relative names and verify the signature.
    const sysTar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
    const tarBin = fs.existsSync(sysTar) ? `"${sysTar}"` : 'tar';
    execSync(`${tarBin} -a -cf "${path.basename(zipFile)}" "${path.basename(portableDir)}"`, {
        cwd: distDir,
        stdio: 'inherit'
    });
    const signature = fs.readFileSync(zipFile).subarray(0, 2).toString('latin1');
    if (signature !== 'PK') {
        throw new Error(`archive is not a zip (signature: ${JSON.stringify(signature)})`);
    }
    console.log('[Packaging] Created:', zipFile);
} catch (e) {
    console.warn('[Packaging] Failed to create zip with tar:', e.message);
    try {
        console.log('[Packaging] Retrying with Compress-Archive...');
        execSync(
            `powershell -NoProfile -Command "Compress-Archive -Path '${portableDir}' -DestinationPath '${zipFile}' -Force"`,
            { stdio: 'inherit' }
        );
        console.log('[Packaging] Created:', zipFile);
    } catch (e2) {
        console.warn('[Packaging] Failed to create zip with Compress-Archive:', e2.message);
    }
}

console.log('[Packaging] Done! Distribution files are ready in dist/:');
if (fs.existsSync(nsisDst)) {
    console.log(' - Setup Installer:', nsisDst, `(${(fs.statSync(nsisDst).size / (1024 * 1024)).toFixed(1)} MB)`);
}
if (fs.existsSync(zipFile)) {
    console.log(' - Portable ZIP:   ', zipFile, `(${(fs.statSync(zipFile).size / (1024 * 1024)).toFixed(1)} MB)`);
}
