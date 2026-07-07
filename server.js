const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 7644;

// Middleware to parse JSON bodies
app.use(express.json());

// Config file path
const CONFIG_FILE = path.join(__dirname, 'music_folders.json');

// Helper to read configured folders
function getFolders() {
    if (!fs.existsSync(CONFIG_FILE)) {
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
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(folders, null, 2), 'utf8');
    } catch (e) {
        console.error("Failed to save config file:", e);
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
                    fileList.push({
                        path: filePath,
                        name: file,
                        url: `/api/stream/${encodeURIComponent(file)}?path=${encodeURIComponent(filePath)}`,
                        folderCoverUrl: folderCoverUrl
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

// Serve index.html for root path
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`MoonPlayer server is running on port ${PORT}`);
    console.log(`Local URL: http://localhost:${PORT}`);
});

