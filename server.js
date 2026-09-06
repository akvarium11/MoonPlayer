const express = require('express');
const path = require('path');
const fs = require('fs');
const discordPresence = require('./discord_presence');

const app = express();
const PORT = process.env.PORT || 7644;

// Middleware to parse JSON bodies
app.use(express.json());

// Resolve writable data directory (portable exe or appData or local directory)
function getWritableDir() {
    if (process.env.PORTABLE_EXECUTABLE_DIR) {
        return process.env.PORTABLE_EXECUTABLE_DIR;
    }
    try {
        const electron = require('electron');
        const app = electron.app || (electron.remote && electron.remote.app);
        if (app && app.getPath) {
            return app.getPath('userData');
        }
    } catch (e) {}
    return __dirname;
}

const DATA_DIR = getWritableDir();
const CONFIG_FILE = path.join(DATA_DIR, 'music_folders.json');

// Helper to read configured folders
function getFolders() {
    if (!fs.existsSync(CONFIG_FILE)) {
        const fallback = path.join(__dirname, 'music_folders.json');
        if (CONFIG_FILE !== fallback && fs.existsSync(fallback)) {
            try {
                const data = fs.readFileSync(fallback, 'utf8');
                return JSON.parse(data);
            } catch (e) {}
        }
        return [];
    }
    try {
        const data = fs.readFileSync(CONFIG_FILE, 'utf8');
        return JSON.parse(data);
    } catch (e) {
        console.error("Failed to read config file:", e);
        return [];
    }
}

// Helper to save configured folders
function saveFolders(folders) {
    try {
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
        }
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(folders, null, 2), 'utf8');
    } catch (e) {
        console.error("Failed to save config file:", e);
    }
}

// Native FLAC metadata and picture parser (blazing fast, no external dependencies)
function parseFlacMetadata(filePath, readPicture = false) {
    let fd;
    try {
        fd = fs.openSync(filePath, 'r');
        const header = Buffer.alloc(4);
        if (fs.readSync(fd, header, 0, 4, 0) !== 4 || header.toString() !== 'fLaC') {
            return null;
        }

        let offset = 4;
        let isLast = false;
        const meta = { comments: {}, hasPicture: false, picture: null };

        while (!isLast) {
            const blockHeader = Buffer.alloc(4);
            if (fs.readSync(fd, blockHeader, 0, 4, offset) !== 4) break;
            offset += 4;

            const headerVal = blockHeader.readUInt32BE(0);
            isLast = (headerVal & 0x80000000) !== 0;
            const blockType = (headerVal >>> 24) & 0x7F;
            const blockLen = headerVal & 0x00FFFFFF;

            if (blockType === 4) { // VORBIS_COMMENT
                const commentBuf = Buffer.alloc(blockLen);
                fs.readSync(fd, commentBuf, 0, blockLen, offset);
                let p = 0;
                if (blockLen >= 4) {
                    const vendorLen = commentBuf.readUInt32LE(p); p += 4 + vendorLen;
                    if (p + 4 <= blockLen) {
                        const numComments = commentBuf.readUInt32LE(p); p += 4;
                        for (let i = 0; i < numComments && p + 4 <= blockLen; i++) {
                            const len = commentBuf.readUInt32LE(p); p += 4;
                            if (p + len <= blockLen) {
                                const str = commentBuf.toString('utf8', p, p + len);
                                p += len;
                                const eqIdx = str.indexOf('=');
                                if (eqIdx !== -1) {
                                    const key = str.slice(0, eqIdx).toUpperCase();
                                    const val = str.slice(eqIdx + 1);
                                    if (!meta.comments[key]) meta.comments[key] = val;
                                }
                            }
                        }
                    }
                }
            } else if (blockType === 6) { // PICTURE
                meta.hasPicture = true;
                if (readPicture) {
                    const picBuf = Buffer.alloc(blockLen);
                    fs.readSync(fd, picBuf, 0, blockLen, offset);
                    if (blockLen >= 32) {
                        let p = 4; // skip pic type
                        const mimeLen = picBuf.readUInt32BE(p); p += 4;
                        if (p + mimeLen <= blockLen) {
                            const mime = picBuf.toString('ascii', p, p + mimeLen); p += mimeLen;
                            if (p + 4 <= blockLen) {
                                const descLen = picBuf.readUInt32BE(p); p += 4 + descLen;
                                p += 16; // width, height, depth, colors
                                if (p + 4 <= blockLen) {
                                    const dataLen = picBuf.readUInt32BE(p); p += 4;
                                    if (p + dataLen <= blockLen) {
                                        meta.picture = {
                                            mime: mime || 'image/jpeg',
                                            data: picBuf.subarray(p, p + dataLen)
                                        };
                                    }
                                }
                            }
                        }
                    }
                }
            }

            offset += blockLen;
        }
        return meta;
    } catch (e) {
        return null;
    } finally {
        if (fd !== undefined) {
            try { fs.closeSync(fd); } catch (e) {}
        }
    }
}

// Audio file extensions to scan for
const AUDIO_EXTENSIONS = ['.mp3', '.flac', '.ogg', '.wav', '.m4a', '.aac', '.webm', '.opus'];

// Recursive folder scanning function
function scanDirectory(dirPath, fileList = []) {
    try {
        if (!fs.existsSync(dirPath)) return fileList;
        const stat = fs.statSync(dirPath);
        if (!stat.isDirectory()) return fileList;

        const files = fs.readdirSync(dirPath);
        
        // Find cover image in the current directory
        const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
        const COVER_KEYWORDS = ['cover', 'folder', 'front', 'album', 'art', 'default'];
        let coverImageFile = null;
        for (const file of files) {
            const ext = path.extname(file).toLowerCase();
            if (IMAGE_EXTENSIONS.includes(ext)) {
                const nameWithoutExt = path.basename(file, ext).toLowerCase();
                if (COVER_KEYWORDS.some(kw => nameWithoutExt.includes(kw))) {
                    coverImageFile = file;
                    break;
                }
            }
        }
        
        // Fallback: if no cover keyword match, take the first image file if any exist
        if (!coverImageFile) {
            for (const file of files) {
                const ext = path.extname(file).toLowerCase();
                if (IMAGE_EXTENSIONS.includes(ext)) {
                    coverImageFile = file;
                    break;
                }
            }
        }

        const folderCoverUrl = coverImageFile 
            ? `/api/stream/${encodeURIComponent(coverImageFile)}?path=${encodeURIComponent(path.join(dirPath, coverImageFile))}`
            : null;

        for (const file of files) {
            const filePath = path.join(dirPath, file);
            let fileStat;
            try {
                fileStat = fs.statSync(filePath);
            } catch (err) {
                continue; // Skip files that error out (e.g. permission issues)
            }

            if (fileStat.isDirectory()) {
                scanDirectory(filePath, fileList);
            } else {
                const ext = path.extname(file).toLowerCase();
                if (AUDIO_EXTENSIONS.includes(ext)) {
                    let title;
                    let artist;
                    let album;
                    let year;
                    let itemCoverUrl = folderCoverUrl;

                    if (ext === '.flac') {
                        const flacMeta = parseFlacMetadata(filePath, false);
                        if (flacMeta) {
                            if (flacMeta.comments.TITLE) title = flacMeta.comments.TITLE.trim();
                            if (flacMeta.comments.ARTIST) artist = flacMeta.comments.ARTIST.trim();
                            if (flacMeta.comments.ALBUM) album = flacMeta.comments.ALBUM.trim();
                            if (flacMeta.comments.DATE) year = flacMeta.comments.DATE.trim().substring(0, 4);
                            if (flacMeta.hasPicture) {
                                itemCoverUrl = `/api/flac-cover?path=${encodeURIComponent(filePath)}`;
                            }
                        }
                    }

                    fileList.push({
                        path: filePath,
                        name: file,
                        format: ext.replace('.', ''),
                        url: `/api/stream/${encodeURIComponent(file)}?path=${encodeURIComponent(filePath)}`,
                        folderCoverUrl: itemCoverUrl,
                        title: title || undefined,
                        artist: artist || undefined,
                        album: album || undefined,
                        year: year || undefined
                    });
                }
            }
        }
    } catch (e) {
        console.error(`Error scanning directory: ${dirPath}`, e);
    }
    return fileList;
}

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));
app.use('/assets', express.static(path.join(__dirname, 'assets')));

// API: Get all folders
app.get('/api/folders', (req, res) => {
    res.json(getFolders());
});

// API: Add a folder
app.post('/api/folders', (req, res) => {
    let { folderPath } = req.body;
    if (!folderPath) {
        return res.status(400).json({ error: 'Folder path is required' });
    }

    // Resolve path and verify it exists
    const resolvedPath = path.resolve(folderPath);
    if (!fs.existsSync(resolvedPath)) {
        return res.status(404).json({ error: 'Folder path does not exist on server' });
    }

    try {
        const stat = fs.statSync(resolvedPath);
        if (!stat.isDirectory()) {
            return res.status(400).json({ error: 'Path is not a directory' });
        }
    } catch (e) {
        return res.status(500).json({ error: 'Could not access the folder path' });
    }

    const folders = getFolders();
    const alreadyExists = folders.some(f => path.resolve(f).toLowerCase() === resolvedPath.toLowerCase());
    if (alreadyExists) {
        return res.json({ success: true, folders, message: 'Folder already added' });
    }

    folders.push(resolvedPath);
    saveFolders(folders);
    res.json({ success: true, folders });
});

// API: Delete a folder
app.delete('/api/folders', (req, res) => {
    const { folderPath } = req.query;
    if (!folderPath) {
        return res.status(400).json({ error: 'Folder path is required' });
    }

    const resolvedPath = path.resolve(folderPath);
    let folders = getFolders();
    const originalLength = folders.length;
    folders = folders.filter(f => path.resolve(f) !== resolvedPath);

    if (folders.length === originalLength) {
        return res.status(404).json({ error: 'Folder path not found in config' });
    }

    saveFolders(folders);
    res.json({ success: true, folders });
});

// API: Clear all folders
app.post('/api/folders/clear', (req, res) => {
    saveFolders([]);
    res.json({ success: true, folders: [] });
});

// Heuristic to detect and fix inverted Title and Artist metadata
const GENERIC_TITLES = new Set([
    'intro', 'outro', 'interlude', 'skit', 'untitled', 'bonus track', 
    'track', 'audio', 'instrumental', 'prelude', 'intermission', 'track 1', 'track 2'
]);

function detectAndFixInvertedSongs(songs) {
    if (!Array.isArray(songs) || songs.length < 2) return songs;

    const folderGroups = new Map();
    songs.forEach(song => {
        const p = song.path || '';
        const lastSlash = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
        const dir = (lastSlash !== -1 ? p.substring(0, lastSlash) : (song.album || 'default')).toLowerCase();
        if (!folderGroups.has(dir)) folderGroups.set(dir, []);
        folderGroups.get(dir).push(song);
    });

    folderGroups.forEach((groupSongs) => {
        if (groupSongs.length < 2) return;

        const titleMap = new Map();
        groupSongs.forEach(song => {
            const rawTitle = (song.title || '').trim();
            const normTitle = rawTitle.toLowerCase();
            if (normTitle && !GENERIC_TITLES.has(normTitle)) {
                if (!titleMap.has(normTitle)) titleMap.set(normTitle, []);
                titleMap.get(normTitle).push(song);
            }
        });

        titleMap.forEach((matchingSongs) => {
            if (matchingSongs.length >= 2) {
                const artistsList = matchingSongs.map(s => (s.artist || '').trim()).filter(a => {
                    const l = a.toLowerCase();
                    return l && l !== 'unknown artist' && l !== 'unknown';
                });
                const distinctArtists = new Set(artistsList.map(a => a.toLowerCase()));

                const isSwapped = (distinctArtists.size >= 2 && distinctArtists.size >= matchingSongs.length * 0.7) ||
                                  (distinctArtists.size >= 2 && matchingSongs.length === groupSongs.length) ||
                                  (matchingSongs.length >= 3 && distinctArtists.size >= 2);

                if (isSwapped) {
                    matchingSongs.forEach(song => {
                        const oldTitle = song.title;
                        const oldArtist = song.artist;
                        if (oldArtist && oldArtist.toLowerCase() !== 'unknown artist') {
                            song.title = oldArtist;
                            song.artist = oldTitle;
                            song._invertedFixed = true;
                        }
                    });
                }
            }
        });
    });

    return songs;
}

// API: Get all songs from all folders
app.get('/api/songs', (req, res) => {
    const folders = getFolders();
    let allSongs = [];
    for (const folder of folders) {
        scanDirectory(folder, allSongs);
    }
    
    // Deduplicate songs by absolute file path
    const uniqueSongs = [];
    const seenPaths = new Set();
    for (const song of allSongs) {
        const normPath = path.resolve(song.path).toLowerCase();
        if (!seenPaths.has(normPath)) {
            seenPaths.add(normPath);
            uniqueSongs.push(song);
        }
    }
    detectAndFixInvertedSongs(uniqueSongs);
    res.json(uniqueSongs);
});

// API: Stream audio file
app.get(['/api/stream', '/api/stream/:filename'], (req, res) => {
    const filePath = req.query.path;
    if (!filePath) {
        return res.status(400).send('Path is required');
    }

    const resolvedPath = path.resolve(filePath);
    const folders = getFolders();

    // Security check: ensure path is within one of the registered folders
    const isAllowed = folders.some(folder => {
        const resolvedFolder = path.resolve(folder);
        const relative = path.relative(resolvedFolder, resolvedPath);
        return relative && !relative.startsWith('..') && !path.isAbsolute(relative);
    });

    if (!isAllowed) {
        return res.status(403).send('Access denied: File is outside of configured music directories');
    }

    res.sendFile(resolvedPath);
});

// API: Stream embedded FLAC cover art
app.get('/api/flac-cover', (req, res) => {
    const filePath = req.query.path;
    if (!filePath) {
        return res.status(400).send('Path is required');
    }

    const resolvedPath = path.resolve(filePath);
    const folders = getFolders();

    const isAllowed = folders.some(folder => {
        const resolvedFolder = path.resolve(folder);
        const relative = path.relative(resolvedFolder, resolvedPath);
        return relative && !relative.startsWith('..') && !path.isAbsolute(relative);
    });

    if (!isAllowed) {
        return res.status(403).send('Access denied');
    }

    const meta = parseFlacMetadata(resolvedPath, true);
    if (meta && meta.picture && meta.picture.data) {
        res.setHeader('Content-Type', meta.picture.mime || 'image/jpeg');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        return res.send(meta.picture.data);
    }

    res.status(404).send('No embedded cover found');
});

// API: Discord RPC Status
app.get('/api/discord-rpc/status', (req, res) => {
    res.json(discordPresence.getStatus());
});

// API: Discord RPC Update Config
app.post('/api/discord-rpc/config', (req, res) => {
    const updated = discordPresence.updateConfig(req.body);
    res.json({ success: true, config: updated });
});

// API: Discord RPC Update Activity
app.post('/api/discord-rpc/activity', (req, res) => {
    discordPresence.updateActivity(req.body);
    res.json({ success: true });
});

// API: Discord RPC Clear Activity
app.post('/api/discord-rpc/clear', (req, res) => {
    discordPresence.clearActivity();
    res.json({ success: true });
});

// API: Search & Resolve Cover Art
app.get('/api/cover-art', async (req, res) => {
    const { title, artist, album } = req.query;
    try {
        const coverUrl = await discordPresence.resolveCover(title, artist, album);
        res.json({ success: true, coverUrl });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Last.fm Info Cache & Endpoints
const INFO_CACHE_FILE = path.join(DATA_DIR, 'lastfm_info_cache.json');
let lastFmInfoCache = {};
try {
    if (fs.existsSync(INFO_CACHE_FILE)) {
        lastFmInfoCache = JSON.parse(fs.readFileSync(INFO_CACHE_FILE, 'utf8'));
    }
} catch (e) {}

function saveLastFmInfoCache() {
    try {
        if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
        const keys = Object.keys(lastFmInfoCache);
        if (keys.length > 500) {
            for (let i = 0; i < keys.length - 500; i++) {
                delete lastFmInfoCache[keys[i]];
            }
        }
        fs.writeFileSync(INFO_CACHE_FILE, JSON.stringify(lastFmInfoCache, null, 2), 'utf8');
    } catch (e) {}
}

// API: Last.fm Artist Info (bio, tags, listeners, playcount)
app.get('/api/artist-info', async (req, res) => {
    const { artist } = req.query;
    if (!artist) return res.status(400).json({ error: 'Artist is required' });
    const cleanArtist = artist.trim();
    const config = discordPresence.getStatus();
    const apiKey = (config.lastFmApiKey && config.lastFmApiKey.trim()) || 'b25b959554ed76058ac220b7b2e0a026';

    const cacheKey = `artist_${cleanArtist.toLowerCase()}`;
    if (lastFmInfoCache[cacheKey]) {
        return res.json({ success: true, ...lastFmInfoCache[cacheKey] });
    }

    try {
        const url = `https://ws.audioscrobbler.com/2.0/?method=artist.getInfo&artist=${encodeURIComponent(cleanArtist)}&api_key=${encodeURIComponent(apiKey)}&format=json`;
        const resp = await fetch(url, { signal: AbortSignal.timeout(4000) });
        if (!resp.ok) {
            return res.json({ success: false, message: 'Last.fm request failed' });
        }
        const data = await resp.json();
        if (data.error || !data.artist) {
            return res.json({ success: false, message: data.message || 'Artist not found' });
        }

        const rawBio = data.artist.bio?.summary || '';
        const tags = (data.artist.tags?.tag || []).map(t => typeof t === 'string' ? t : t.name).filter(Boolean);
        const listeners = data.artist.stats?.listeners || null;
        const playcount = data.artist.stats?.playcount || null;

        const info = {
            name: data.artist.name || cleanArtist,
            bio: rawBio,
            tags: tags.slice(0, 8),
            listeners: listeners ? Number(listeners).toLocaleString() : null,
            playcount: playcount ? Number(playcount).toLocaleString() : null,
            url: data.artist.url || null
        };

        lastFmInfoCache[cacheKey] = info;
        saveLastFmInfoCache();
        res.json({ success: true, ...info });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// API: Last.fm Album Info (wiki, tags, listeners, playcount)
app.get('/api/album-info', async (req, res) => {
    const { artist, album } = req.query;
    if (!album) return res.status(400).json({ error: 'Album is required' });
    const cleanArtist = (artist || '').trim();
    const cleanAlbum = album.trim();
    const config = discordPresence.getStatus();
    const apiKey = (config.lastFmApiKey && config.lastFmApiKey.trim()) || 'b25b959554ed76058ac220b7b2e0a026';

    const cacheKey = `album_${cleanArtist.toLowerCase()}_${cleanAlbum.toLowerCase()}`;
    if (lastFmInfoCache[cacheKey]) {
        return res.json({ success: true, ...lastFmInfoCache[cacheKey] });
    }

    try {
        const url = `https://ws.audioscrobbler.com/2.0/?method=album.getInfo&artist=${encodeURIComponent(cleanArtist)}&album=${encodeURIComponent(cleanAlbum)}&api_key=${encodeURIComponent(apiKey)}&format=json`;
        const resp = await fetch(url, { signal: AbortSignal.timeout(4000) });
        if (!resp.ok) {
            return res.json({ success: false, message: 'Last.fm request failed' });
        }
        const data = await resp.json();
        if (data.error || !data.album) {
            return res.json({ success: false, message: data.message || 'Album not found' });
        }

        const rawWiki = data.album.wiki?.summary || '';
        const tags = (data.album.tags?.tag || []).map(t => typeof t === 'string' ? t : t.name).filter(Boolean);
        const listeners = data.album.listeners || null;
        const playcount = data.album.playcount || null;

        const info = {
            title: data.album.name || cleanAlbum,
            artist: data.album.artist || cleanArtist,
            wiki: rawWiki,
            tags: tags.slice(0, 8),
            listeners: listeners ? Number(listeners).toLocaleString() : null,
            playcount: playcount ? Number(playcount).toLocaleString() : null,
            url: data.album.url || null
        };

        lastFmInfoCache[cacheKey] = info;
        saveLastFmInfoCache();
        res.json({ success: true, ...info });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Serve index.html for root path
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`MoonPlayer server is running on port ${PORT}`);
    console.log(`Local URL: http://localhost:${PORT}`);
});
