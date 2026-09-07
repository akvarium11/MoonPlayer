const DiscordRPC = require('discord-rpc');
const fs = require('fs');
const path = require('path');

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
const CONFIG_FILE = path.join(DATA_DIR, 'discord_config.json');
const CACHE_FILE = path.join(DATA_DIR, 'cover_cache.json');
const DEFAULT_CLIENT_ID = '1543154845958275114';
const DEFAULT_ICON_URL = 'https://raw.githubusercontent.com/akvarium11/MoonPlayer/main/assets/icon.png';
const DEFAULT_LASTFM_API_KEY = 'b25b959554ed76058ac220b7b2e0a026';

function normalizeForComparison(str) {
    if (!str || typeof str !== 'string') return '';
    return str
        .toLowerCase()
        .replace(/\.[a-zA-Z0-9]+$/, '')
        .replace(/\[.*?\]|\(.*?\)/g, '')
        .replace(/[^a-z0-9\u0400-\u04FF\u3040-\u30FF\u4E00-\u9FFF]/gi, '')
        .trim();
}

function stringsFuzzyMatch(a, b) {
    const normA = normalizeForComparison(a);
    const normB = normalizeForComparison(b);
    if (!normA || !normB) return false;
    if (normA === normB) return true;
    if (normA.includes(normB) || normB.includes(normA)) return true;
    return false;
}

function isValidCoverUrl(url) {
    if (!url || typeof url !== 'string') return false;
    url = url.trim();
    if (!url.startsWith('http://') && !url.startsWith('https://')) return false;
    if (url.includes('2a96cbd8b46e442fc41c2b86b821562f')) return false;
    if (url.includes('default_album')) return false;
    return true;
}

function extractLastFmImage(images) {
    if (!Array.isArray(images) || images.length === 0) return null;
    for (const size of ['mega', 'extralarge', 'large', 'medium', 'small']) {
        const found = images.find(img => img.size === size);
        if (found && isValidCoverUrl(found['#text'])) {
            let imgUrl = found['#text'].trim();
            imgUrl = imgUrl.replace(/\/300x300\//, '/770x0/').replace(/\/174s\//, '/770x0/');
            return imgUrl;
        }
    }
    const any = images.find(img => isValidCoverUrl(img['#text']));
    return any ? any['#text'].trim() : null;
}

function cleanRpcString(str, fallback, maxLength = 60) {
    if (!str || typeof str !== 'string') str = fallback || 'MoonPlayer';
    str = str.trim();
    if (str.length > maxLength) {
        str = str.substring(0, maxLength - 3).trim() + '...';
    }
    if (str.length < 2) {
        str = str ? str + ' ' : (fallback || 'MoonPlayer');
        if (str.length < 2) str = fallback || 'MoonPlayer';
    }
    return str.substring(0, 127);
}

class DiscordPresenceManager {
    constructor() {
        this.config = this.loadConfig();
        this.coverCache = this.loadCoverCache();
        this.client = null;
        this.isConnected = false;
        this.isConnecting = false;
        this.reconnectTimer = null;
        this.currentActivity = null;
        this.user = null;

        // Auto-initialize if enabled
        if (this.config.enabled) {
            this.connect();
        }
    }

    loadConfig() {
        const defaults = {
            enabled: true,
            clientId: DEFAULT_CLIENT_ID,
            showPaused: true,
            showButtons: true,
            lastFmApiKey: ''
        };

        if (fs.existsSync(CONFIG_FILE)) {
            try {
                const data = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
                const config = { ...defaults, ...data };
                if (!config.clientId || config.clientId === '1198273645839204352') {
                    config.clientId = DEFAULT_CLIENT_ID;
                }
                return config;
            } catch (e) {
                console.error('[Discord RPC] Error reading config file:', e.message);
            }
        } else {
            const fallback = path.join(__dirname, 'discord_config.json');
            if (CONFIG_FILE !== fallback && fs.existsSync(fallback)) {
                try {
                    const data = JSON.parse(fs.readFileSync(fallback, 'utf8'));
                    const config = { ...defaults, ...data };
                    if (!config.clientId || config.clientId === '1198273645839204352') {
                        config.clientId = DEFAULT_CLIENT_ID;
                    }
                    return config;
                } catch (e) {}
            }
        }
        return defaults;
    }

    saveConfig() {
        try {
            if (!fs.existsSync(DATA_DIR)) {
                fs.mkdirSync(DATA_DIR, { recursive: true });
            }
            fs.writeFileSync(CONFIG_FILE, JSON.stringify(this.config, null, 2), 'utf8');
        } catch (e) {
            console.error('[Discord RPC] Error saving config file:', e.message);
        }
    }

    loadCoverCache() {
        if (fs.existsSync(CACHE_FILE)) {
            try {
                return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
            } catch (e) {
                console.error('[Discord RPC] Error reading cover cache:', e.message);
            }
        } else {
            const fallback = path.join(__dirname, 'cover_cache.json');
            if (CACHE_FILE !== fallback && fs.existsSync(fallback)) {
                try {
                    return JSON.parse(fs.readFileSync(fallback, 'utf8'));
                } catch (e) {}
            }
        }
        return {};
    }

    saveCoverCache() {
        try {
            if (!fs.existsSync(DATA_DIR)) {
                fs.mkdirSync(DATA_DIR, { recursive: true });
            }
            // Keep cache at max 1000 items
            const keys = Object.keys(this.coverCache);
            if (keys.length > 1000) {
                for (let i = 0; i < keys.length - 1000; i++) {
                    delete this.coverCache[keys[i]];
                }
            }
            fs.writeFileSync(CACHE_FILE, JSON.stringify(this.coverCache, null, 2), 'utf8');
        } catch (e) {
            console.error('[Discord RPC] Error saving cover cache:', e.message);
        }
    }

    async resolveCover(title, artist, album) {
        if (!title && !artist && !album) {
            return DEFAULT_ICON_URL;
        }

        // Clean query terms
        const cleanTitle = (title || '').replace(/\.[a-zA-Z0-9]+$/, '').replace(/\(.*?offici.*?\)/gi, '').trim();
        const cleanArtist = (artist || '').replace(/\(.*?offici.*?\)/gi, '').trim();
        const cleanAlbum = (album || '').replace(/\[.*?\]/g, '').trim();

        // 3) Rule 3: If only title matches, or artist is unknown/missing -> DO NOT SHOW COVER
        const isArtistUnknown = !cleanArtist || 
            cleanArtist.toLowerCase() === 'unknown artist' || 
            cleanArtist.toLowerCase() === 'unknown' || 
            cleanArtist.toLowerCase() === 'various artists' ||
            cleanArtist.toLowerCase() === 'various';

        if (isArtistUnknown || !cleanTitle) {
            return DEFAULT_ICON_URL;
        }

        const isAlbumMeaningful = cleanAlbum && 
            cleanAlbum.toLowerCase() !== 'unknown album' && 
            cleanAlbum.toLowerCase() !== 'unknown' && 
            cleanAlbum.toLowerCase() !== 'various' &&
            cleanAlbum.toLowerCase() !== cleanTitle.toLowerCase();

        const cacheKey = `${cleanArtist} - ${isAlbumMeaningful ? cleanAlbum + ' - ' : ''}${cleanTitle}`.toLowerCase().trim();
        if (this.coverCache[cacheKey]) {
            return this.coverCache[cacheKey];
        }

        const lastFmKey = (this.config.lastFmApiKey && this.config.lastFmApiKey.trim()) || DEFAULT_LASTFM_API_KEY;

        // =========================================================================
        // PRIORITY 1: Match Title AND Artist AND Album
        // =========================================================================
        if (isAlbumMeaningful) {
            // 1.1 Last.fm (Priority 1)
            if (lastFmKey) {
                // A) Last.fm track.getInfo (checks if track's album matches cleanAlbum)
                try {
                    const lfmUrl = `https://ws.audioscrobbler.com/2.0/?method=track.getInfo&api_key=${encodeURIComponent(lastFmKey)}&artist=${encodeURIComponent(cleanArtist)}&track=${encodeURIComponent(cleanTitle)}&format=json`;
                    const lfmRes = await fetch(lfmUrl, { signal: AbortSignal.timeout(3500) });
                    if (lfmRes.ok) {
                        const data = await lfmRes.json();
                        if (data.track && stringsFuzzyMatch(data.track.name, cleanTitle) && stringsFuzzyMatch(data.track.artist?.name, cleanArtist)) {
                            if (data.track.album && stringsFuzzyMatch(data.track.album.title, cleanAlbum)) {
                                const cover = extractLastFmImage(data.track.album.image);
                                if (cover) {
                                    this.coverCache[cacheKey] = cover;
                                    this.saveCoverCache();
                                    return cover;
                                }
                            }
                        }
                    }
                } catch (e) {}

                // B) Last.fm album.getInfo (checks if album has cleanTitle among its tracks)
                try {
                    const lfmAlbumUrl = `https://ws.audioscrobbler.com/2.0/?method=album.getInfo&api_key=${encodeURIComponent(lastFmKey)}&artist=${encodeURIComponent(cleanArtist)}&album=${encodeURIComponent(cleanAlbum)}&format=json`;
                    const lfmRes = await fetch(lfmAlbumUrl, { signal: AbortSignal.timeout(3500) });
                    if (lfmRes.ok) {
                        const data = await lfmRes.json();
                        if (data.album && stringsFuzzyMatch(data.album.artist, cleanArtist) && stringsFuzzyMatch(data.album.name, cleanAlbum)) {
                            const tracks = data.album.tracks?.track || [];
                            const trackList = Array.isArray(tracks) ? tracks : [tracks];
                            const hasTrack = trackList.some(t => stringsFuzzyMatch(t.name, cleanTitle));
                            if (hasTrack) {
                                const cover = extractLastFmImage(data.album.image);
                                if (cover) {
                                    this.coverCache[cacheKey] = cover;
                                    this.saveCoverCache();
                                    return cover;
                                }
                            }
                        }
                    }
                } catch (e) {}
            }

            // 1.2 Deezer (Priority 1 Fallback)
            try {
                const deezerQuery = `${cleanArtist} ${cleanAlbum}`;
                const deezerRes = await fetch(`https://api.deezer.com/search?q=${encodeURIComponent(deezerQuery)}&limit=5`, {
                    headers: { 'User-Agent': 'MoonPlayer/1.0' },
                    signal: AbortSignal.timeout(3000)
                });
                if (deezerRes.ok) {
                    const data = await deezerRes.json();
                    if (data.data && data.data.length > 0) {
                        const match = data.data.find(item => 
                            stringsFuzzyMatch(item.artist?.name, cleanArtist) &&
                            stringsFuzzyMatch(item.title, cleanTitle) &&
                            stringsFuzzyMatch(item.album?.title, cleanAlbum)
                        );
                        if (match && match.album) {
                            const cover = match.album.cover_xl || match.album.cover_big || match.album.cover_medium;
                            if (cover && isValidCoverUrl(cover)) {
                                this.coverCache[cacheKey] = cover;
                                this.saveCoverCache();
                                return cover;
                            }
                        }
                    }
                }
            } catch (e) {}

            // 1.3 iTunes (Priority 1 Fallback)
            try {
                const itunesQuery = `${cleanArtist} ${cleanAlbum} ${cleanTitle}`;
                const itunesRes = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(itunesQuery)}&entity=song&limit=5`, {
                    headers: { 'User-Agent': 'MoonPlayer/1.0' },
                    signal: AbortSignal.timeout(3000)
                });
                if (itunesRes.ok) {
                    const data = await itunesRes.json();
                    if (data.results && data.results.length > 0) {
                        const match = data.results.find(item =>
                            stringsFuzzyMatch(item.artistName, cleanArtist) &&
                            stringsFuzzyMatch(item.trackName, cleanTitle) &&
                            stringsFuzzyMatch(item.collectionName, cleanAlbum)
                        );
                        if (match && match.artworkUrl100) {
                            const cover = match.artworkUrl100.replace('100x100bb', '600x600bb');
                            this.coverCache[cacheKey] = cover;
                            this.saveCoverCache();
                            return cover;
                        }
                    }
                }
            } catch (e) {}
        }

        // =========================================================================
        // PRIORITY 2: Match Title AND Artist
        // =========================================================================

        // 2.1 Last.fm (Priority 2)
        if (lastFmKey) {
            try {
                const lfmUrl = `https://ws.audioscrobbler.com/2.0/?method=track.getInfo&api_key=${encodeURIComponent(lastFmKey)}&artist=${encodeURIComponent(cleanArtist)}&track=${encodeURIComponent(cleanTitle)}&format=json`;
                const lfmRes = await fetch(lfmUrl, { signal: AbortSignal.timeout(3500) });
                if (lfmRes.ok) {
                    const data = await lfmRes.json();
                    if (data.track && stringsFuzzyMatch(data.track.name, cleanTitle) && stringsFuzzyMatch(data.track.artist?.name, cleanArtist)) {
                        if (data.track.album) {
                            const cover = extractLastFmImage(data.track.album.image);
                            if (cover) {
                                this.coverCache[cacheKey] = cover;
                                this.saveCoverCache();
                                return cover;
                            }
                        }
                    }
                }
            } catch (e) {}
        }

        // 2.2 Deezer (Priority 2 Fallback)
        try {
            const deezerQuery = `${cleanArtist} ${cleanTitle}`;
            const deezerRes = await fetch(`https://api.deezer.com/search?q=${encodeURIComponent(deezerQuery)}&limit=5`, {
                headers: { 'User-Agent': 'MoonPlayer/1.0' },
                signal: AbortSignal.timeout(3000)
            });
            if (deezerRes.ok) {
                const data = await deezerRes.json();
                if (data.data && data.data.length > 0) {
                    // MUST match BOTH artist and title (Rule 3: never match title alone)
                    const match = data.data.find(item =>
                        stringsFuzzyMatch(item.artist?.name, cleanArtist) &&
                        stringsFuzzyMatch(item.title, cleanTitle)
                    );
                    if (match && match.album) {
                        const cover = match.album.cover_xl || match.album.cover_big || match.album.cover_medium;
                        if (cover && isValidCoverUrl(cover)) {
                            this.coverCache[cacheKey] = cover;
                            this.saveCoverCache();
                            return cover;
                        }
                    }
                }
            }
        } catch (e) {}

        // 2.3 iTunes (Priority 2 Fallback)
        try {
            const itunesQuery = `${cleanArtist} ${cleanTitle}`;
            const itunesRes = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(itunesQuery)}&entity=song&limit=5`, {
                headers: { 'User-Agent': 'MoonPlayer/1.0' },
                signal: AbortSignal.timeout(3000)
            });
            if (itunesRes.ok) {
                const data = await itunesRes.json();
                if (data.results && data.results.length > 0) {
                    // MUST match BOTH artist and title (Rule 3: never match title alone)
                    const match = data.results.find(item =>
                        stringsFuzzyMatch(item.artistName, cleanArtist) &&
                        stringsFuzzyMatch(item.trackName, cleanTitle)
                    );
                    if (match && match.artworkUrl100) {
                        const cover = match.artworkUrl100.replace('100x100bb', '600x600bb');
                        this.coverCache[cacheKey] = cover;
                        this.saveCoverCache();
                        return cover;
                    }
                }
            }
        } catch (e) {}

        // =========================================================================
        // 3) RULE 3: If only title matches (or nothing matched) -> DO NOT SHOW COVER
        // =========================================================================
        this.coverCache[cacheKey] = DEFAULT_ICON_URL;
        this.saveCoverCache();
        return DEFAULT_ICON_URL;
    }

    connect() {
        if (!this.config.enabled || this.isConnected || this.isConnecting) {
            return;
        }

        this.isConnecting = true;
        const clientId = this.config.clientId || DEFAULT_CLIENT_ID;

        try {
            this.client = new DiscordRPC.Client({ transport: 'ipc' });

            this.client.on('ready', () => {
                this.isConnected = true;
                this.isConnecting = false;
                this.user = this.client.user ? {
                    username: this.client.user.username,
                    discriminator: this.client.user.discriminator,
                    id: this.client.user.id
                } : null;

                console.log(`[Discord RPC] Connected as ${this.user ? this.user.username : 'User'}`);

                if (this.reconnectTimer) {
                    clearTimeout(this.reconnectTimer);
                    this.reconnectTimer = null;
                }

                // If activity is queued, update it
                if (this.currentActivity) {
                    this.updateActivity(this.currentActivity);
                }
            });

            this.client.on('error', (err) => {
                // Suppress unhandled error crashes
                this.handleDisconnect();
            });

            this.client.on('close', () => {
                this.handleDisconnect();
            });

            this.client.login({ clientId }).catch((err) => {
                this.handleDisconnect();
            });
        } catch (e) {
            this.handleDisconnect();
        }
    }

    handleDisconnect() {
        this.isConnected = false;
        this.isConnecting = false;
        this.user = null;
        if (this.client) {
            try {
                this.client.destroy().catch(() => {});
            } catch (e) {}
            this.client = null;
        }
        this.scheduleReconnect();
    }

    scheduleReconnect() {
        if (this.reconnectTimer || !this.config.enabled) return;
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            if (this.config.enabled && !this.isConnected) {
                this.connect();
            }
        }, 15000); // Retry every 15s
    }

    async updateActivity(activityData) {
        if (!activityData) {
            return this.clearActivity();
        }

        this.currentActivity = { ...activityData };

        if (!this.config.enabled) {
            return;
        }

        if (!this.isConnected) {
            this.connect();
            return;
        }

        const { title, artist, album, duration, currentTime, isPlaying } = activityData;

        // If paused and showPaused is disabled, clear presence
        if (!isPlaying && !this.config.showPaused) {
            return this.clearActivity(false);
        }

        try {
            let coverUrl = null;
            if (isValidCoverUrl(activityData.coverUrl)) {
                let directCover = activityData.coverUrl.trim();
                // Upgrade SoundCloud artwork to highest resolution t500x500
                if (directCover.includes('sndcdn.com')) {
                    directCover = directCover.replace(/-large\./, '-t500x500.').replace(/-t[0-9]+x[0-9]+\./, '-t500x500.');
                }
                coverUrl = directCover;
                const cleanTitle = (title || '').replace(/\.[a-zA-Z0-9]+$/, '').trim();
                const cleanArtist = (artist || '').trim();
                if (cleanTitle && cleanArtist) {
                    const cacheKey = `${cleanArtist} - ${cleanTitle}`.toLowerCase().trim();
                    this.coverCache[cacheKey] = directCover;
                }
            } else {
                coverUrl = await this.resolveCover(title, artist, album);
            }

            const details = cleanRpcString(title, 'MoonPlayer', 50);
            const state = cleanRpcString(artist, 'Unknown Artist', 50);
            const largeImageText = cleanRpcString(album || title, 'MoonPlayer', 50);
            const smallImageText = cleanRpcString(isPlaying ? 'Listening' : 'Paused', 'MoonPlayer', 25);

            const now = Date.now();
            const curSec = Math.max(0, Number(currentTime) || 0);

            const activity = {
                type: 2, // 2 = LISTENING
                details: details,
                state: state,
                assets: {
                    large_image: (typeof coverUrl === 'string' && coverUrl.startsWith('http')) ? coverUrl : DEFAULT_ICON_URL,
                    large_text: largeImageText,
                    small_image: DEFAULT_ICON_URL,
                    small_text: smallImageText
                },
                instance: false
            };

            // Set elapsed time (counts upwards from the current elapsed second)
            if (isPlaying) {
                activity.timestamps = {
                    start: Math.floor(now - (curSec * 1000))
                };
            }

            if (this.config.showButtons) {
                activity.buttons = [
                    { label: 'MoonPlayer App', url: 'https://github.com/akvarium11/MoonPlayer' }
                ];
                if (activityData.permalink && typeof activityData.permalink === 'string' && activityData.permalink.startsWith('https://soundcloud.com/')) {
                    activity.buttons.push({ label: 'SoundCloud Track', url: activityData.permalink });
                }
            }

            if (this.client && this.isConnected) {
                await this.client.request('SET_ACTIVITY', {
                    pid: process.pid,
                    activity: activity
                });
                console.log(`[Discord RPC] Activity set (Listening): "${details}" by ${state}`);
            }
        } catch (err) {
            console.error('[Discord RPC] Error setting activity:', err.message);
        }
    }

    async clearActivity(clearSaved = true) {
        if (clearSaved) {
            this.currentActivity = null;
        }
        if (this.client && this.isConnected) {
            try {
                await this.client.clearActivity();
            } catch (e) {}
        }
    }

    getStatus() {
        return {
            enabled: this.config.enabled,
            isConnected: this.isConnected,
            isConnecting: this.isConnecting,
            user: this.user,
            clientId: this.config.clientId || DEFAULT_CLIENT_ID,
            showPaused: this.config.showPaused !== false,
            showButtons: this.config.showButtons !== false,
            lastFmApiKey: this.config.lastFmApiKey || ''
        };
    }

    updateConfig(newConfig) {
        const oldEnabled = this.config.enabled;
        const oldClientId = this.config.clientId;

        this.config = {
            ...this.config,
            ...newConfig
        };
        if (!this.config.clientId || this.config.clientId === '1198273645839204352') {
            this.config.clientId = DEFAULT_CLIENT_ID;
        }
        this.saveConfig();

        if (oldClientId !== this.config.clientId || oldEnabled !== this.config.enabled) {
            if (this.client) {
                try {
                    this.client.destroy().catch(() => {});
                } catch (e) {}
                this.client = null;
            }
            this.isConnected = false;
            this.isConnecting = false;
            this.user = null;

            if (this.config.enabled) {
                this.connect();
            } else {
                if (this.reconnectTimer) {
                    clearTimeout(this.reconnectTimer);
                    this.reconnectTimer = null;
                }
            }
        } else if (this.isConnected && this.currentActivity) {
            this.updateActivity(this.currentActivity);
        }

        return this.getStatus();
    }
}

module.exports = new DiscordPresenceManager();
