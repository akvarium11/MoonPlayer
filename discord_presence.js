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
        const cleanAlbum = (album || '').trim();

        const cacheKey = `${cleanArtist} - ${cleanTitle || cleanAlbum}`.toLowerCase().trim();
        if (this.coverCache[cacheKey]) {
            return this.coverCache[cacheKey];
        }

        const searchQueries = [];
        if (cleanArtist && cleanTitle) searchQueries.push(`${cleanArtist} ${cleanTitle}`);
        if (cleanArtist && cleanAlbum && cleanAlbum !== cleanTitle) searchQueries.push(`${cleanArtist} ${cleanAlbum}`);
        if (cleanTitle) searchQueries.push(cleanTitle);

        for (const query of searchQueries) {
            // 1. Try Deezer Search API
            try {
                const deezerRes = await fetch(`https://api.deezer.com/search?q=${encodeURIComponent(query)}&limit=1`, {
                    headers: { 'User-Agent': 'MoonPlayer/1.0' },
                    signal: AbortSignal.timeout(3000)
                });
                if (deezerRes.ok) {
                    const data = await deezerRes.json();
                    if (data.data && data.data.length > 0 && data.data[0].album) {
                        const cover = data.data[0].album.cover_xl || data.data[0].album.cover_big || data.data[0].album.cover_medium;
                        if (cover) {
                            this.coverCache[cacheKey] = cover;
                            this.saveCoverCache();
                            return cover;
                        }
                    }
                }
            } catch (e) {
                // Silently try next fallback
            }

            // 2. Try iTunes Search API
            try {
                const itunesRes = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=song&limit=1`, {
                    headers: { 'User-Agent': 'MoonPlayer/1.0' },
                    signal: AbortSignal.timeout(3000)
                });
                if (itunesRes.ok) {
                    const data = await itunesRes.json();
                    if (data.results && data.results.length > 0 && data.results[0].artworkUrl100) {
                        const cover = data.results[0].artworkUrl100.replace('100x100bb', '600x600bb');
                        this.coverCache[cacheKey] = cover;
                        this.saveCoverCache();
                        return cover;
                    }
                }
            } catch (e) {
                // Silently try next fallback
            }

            // 3. Try Last.fm API if API key configured
            if (this.config.lastFmApiKey && cleanArtist && cleanTitle) {
                try {
                    const lfmUrl = `https://ws.audioscrobbler.com/2.0/?method=track.getInfo&api_key=${encodeURIComponent(this.config.lastFmApiKey)}&artist=${encodeURIComponent(cleanArtist)}&track=${encodeURIComponent(cleanTitle)}&format=json`;
                    const lfmRes = await fetch(lfmUrl, { signal: AbortSignal.timeout(3000) });
                    if (lfmRes.ok) {
                        const data = await lfmRes.json();
                        if (data.track && data.track.album && data.track.album.image) {
                            const images = data.track.album.image;
                            const extImg = images.find(img => img.size === 'extralarge' || img.size === 'large');
                            if (extImg && extImg['#text']) {
                                const cover = extImg['#text'];
                                this.coverCache[cacheKey] = cover;
                                this.saveCoverCache();
                                return cover;
                            }
                        }
                    }
                } catch (e) {}
            }
        }

        // Cache fallback so we don't spam APIs on every update
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
            const coverUrl = await this.resolveCover(title, artist, album);

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
