const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
const version = pkg.version || '2.5.0';

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
    let src = path.join(releaseDir, file);
    if (!fs.existsSync(src)) {
        src = path.join(rootDir, 'bin', file);
    }
    if (fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(portableDir, file));
    }
}

// Copy server folder
let serverSrc = path.join(releaseDir, 'server');
if (!fs.existsSync(serverSrc)) {
    serverSrc = path.join(releaseDir, 'resources', 'server');
}
const serverDst = path.join(portableDir, 'server');
if (fs.existsSync(serverSrc)) {
    console.log('[Packaging] Copying server directory to portable distribution...');
    fs.cpSync(serverSrc, serverDst, { recursive: true });
} else {
    console.log('[Packaging] Assembling server directory from project files...');
    fs.mkdirSync(serverDst, { recursive: true });
    const serverFiles = ['server.js', 'soundcloud_service.js', 'discord_presence.js', 'discord_config.json', 'package.json'];
    for (const f of serverFiles) {
        const srcF = path.join(rootDir, f);
        if (fs.existsSync(srcF)) {
            fs.copyFileSync(srcF, path.join(serverDst, f));
        }
    }
    fs.cpSync(path.join(rootDir, 'public'), path.join(serverDst, 'public'), { recursive: true });
    fs.cpSync(path.join(rootDir, 'assets'), path.join(serverDst, 'assets'), { recursive: true });
    if (fs.existsSync(path.join(rootDir, 'node_modules'))) {
        fs.cpSync(path.join(rootDir, 'node_modules'), path.join(serverDst, 'node_modules'), { recursive: true });
    }
    const binDst = path.join(serverDst, 'bin');
    fs.mkdirSync(binDst, { recursive: true });
    if (fs.existsSync(path.join(rootDir, 'bin', 'node.exe'))) {
        fs.copyFileSync(path.join(rootDir, 'bin', 'node.exe'), path.join(binDst, 'node.exe'));
    }
}

// Prune devDependencies from packaged server
const devModulesToRemove = ['electron', 'electron-builder', '@tauri-apps', 'app-builder-bin', 'app-builder-lib', 'dmg-builder'];
for (const mod of devModulesToRemove) {
    const modPath = path.join(serverDst, 'node_modules', mod);
    if (fs.existsSync(modPath)) {
        console.log(`[Packaging] Pruning devDependency ${mod}...`);
        fs.rmSync(modPath, { recursive: true, force: true });
    }
}

// Ensure server/bin/node.exe exists
const packagedNode = path.join(serverDst, 'bin', 'node.exe');
if (!fs.existsSync(packagedNode) && fs.existsSync(path.join(rootDir, 'bin', 'node.exe'))) {
    fs.mkdirSync(path.dirname(packagedNode), { recursive: true });
    fs.copyFileSync(path.join(rootDir, 'bin', 'node.exe'), packagedNode);
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
