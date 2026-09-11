const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');

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
const CONFIG_FILE = path.join(DATA_DIR, 'soundcloud_config.json');
const DOWNLOADS_FILE = path.join(DATA_DIR, 'soundcloud_downloads.json');

class SoundCloudService {
    constructor() {
        this.config = this.loadConfig();
        this.downloads = this.loadDownloads();
        this.streamCache = new Map(); // id -> { url, expiresAt }
        this.trackCache = new Map();  // id -> trackObject
        this.transcodingsCache = new Map(); // id -> transcodings array
        this.inFlightStreamUrls = new Map(); // id -> Promise<string>
        this.currentUser = null;

        if (this.config.enabled && this.config.oauthToken) {
            this.verifyToken(this.config.oauthToken).catch(err => {
                console.error('[SoundCloud] Initial token verification failed:', err.message);
            });
        }
    }

    loadConfig() {
        try {
            if (fs.existsSync(CONFIG_FILE)) {
                return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
            }
        } catch (e) {
            console.error('[SoundCloud] Error reading config:', e);
        }
        return {
            enabled: false,
            oauthToken: '',
            user: null
        };
    }

    saveConfig(cfg) {
        this.config = { ...this.config, ...cfg };
        try {
            if (!fs.existsSync(DATA_DIR)) {
                fs.mkdirSync(DATA_DIR, { recursive: true });
            }
            fs.writeFileSync(CONFIG_FILE, JSON.stringify(this.config, null, 2), 'utf8');
        } catch (e) {
            console.error('[SoundCloud] Error saving config:', e);
        }
        return this.config;
    }

    loadDownloads() {
        try {
            if (fs.existsSync(DOWNLOADS_FILE)) {
                return JSON.parse(fs.readFileSync(DOWNLOADS_FILE, 'utf8'));
            }
        } catch (e) {
            console.error('[SoundCloud] Error reading downloads:', e);
        }
        return [];
    }

    saveDownloads(downloadsList) {
        this.downloads = downloadsList;
        try {
            if (!fs.existsSync(DATA_DIR)) {
                fs.mkdirSync(DATA_DIR, { recursive: true });
            }
            fs.writeFileSync(DOWNLOADS_FILE, JSON.stringify(this.downloads, null, 2), 'utf8');
        } catch (e) {
            console.error('[SoundCloud] Error saving downloads:', e);
        }
    }

    isDownloadedPath(filePath) {
        if (!filePath) return false;
        const norm = path.resolve(filePath).toLowerCase();
        return this.downloads.some(d => d.path && path.resolve(d.path).toLowerCase() === norm);
    }

    getAuthHeader() {
        const token = (this.config.oauthToken || '').trim();
        if (!token) return {};
        return { 'Authorization': `OAuth ${token}` };
    }

    async verifyToken(token) {
        if (!token || typeof token !== 'string') {
            throw new Error('OAuth token is required');
        }
        const cleanToken = token.trim();
        const resp = await fetch('https://api-v2.soundcloud.com/me', {
            headers: { 'Authorization': `OAuth ${cleanToken}` }
        });

        if (!resp.ok) {
            const errText = await resp.text().catch(() => '');
            throw new Error(`SoundCloud API error (${resp.status}): ${errText || 'Invalid token'}`);
        }

        const data = await resp.json();
        const user = {
            id: data.id,
            urn: data.urn,
            username: data.username,
            full_name: data.full_name || '',
            avatar_url: data.avatar_url || '',
            permalink_url: data.permalink_url || '',
            likes_count: data.likes_count || 0,
            playlist_count: data.playlist_count || 0,
            track_count: data.track_count || 0
        };

        this.currentUser = user;
        this.saveConfig({ user });
        return user;
    }

    formatTrack(rawTrack, fallbackCover = null, albumTitle = null) {
        if (!rawTrack) return null;
        const t = rawTrack.track || rawTrack;
        if (!t || !t.id) return null;

        // If this is a bare unresolved stub with no title and no media and no permalink, exclude it
        if (!t.title && !t.permalink_url && !t.media && !t.stream_url) return null;

        const highResCover = t.artwork_url
            ? t.artwork_url.replace('-large', '-t500x500')
            : (fallbackCover || (t.user && t.user.avatar_url ? t.user.avatar_url.replace('-large', '-t500x500') : '/assets/icon.png'));

        const durationSec = Math.round((t.duration || t.full_duration || 0) / 1000);
        const artist = t.user ? (t.user.username || t.user.full_name || 'SoundCloud Artist') : 'SoundCloud Artist';

        const finalAlbum = albumTitle || (t.publisher_metadata && t.publisher_metadata.album_title) || 'SoundCloud';
        const finalAlbumKey = albumTitle
            ? ('sc_album_' + albumTitle.toLowerCase().replace(/[^a-z0-9]/g, '_'))
            : ('sc_track_' + t.id);

        const trackObj = {
            id: t.id,
            title: t.title || 'Untitled',
            artist: artist,
            album: finalAlbum,
            albumKey: finalAlbumKey,
            year: (t.created_at || '').substring(0, 4),
            cover: highResCover,
            duration: durationSec,
            path: `soundcloud:${t.id}`,
            src: `/api/soundcloud/stream/${t.id}`,
            url: `/api/soundcloud/stream/${t.id}`,
            format: 'soundcloud',
            isSoundCloud: true,
            permalink_url: t.permalink_url || '',
            likes_count: t.likes_count || 0,
            genre: t.genre || ''
        };

        this.trackCache.set(String(t.id), trackObj);

        if (t.media && Array.isArray(t.media.transcodings) && t.media.transcodings.length > 0) {
            this.transcodingsCache.set(String(t.id), t.media.transcodings);
        }

        return trackObj;
    }

    formatPlaylist(p) {
        if (!p || !p.id) return null;
        const cover = p.artwork_url
            ? p.artwork_url.replace('-large', '-t500x500')
            : (p.user && p.user.avatar_url ? p.user.avatar_url.replace('-large', '-t500x500') : '/assets/icon.png');
        const artist = p.user ? (p.user.username || p.user.full_name || 'SoundCloud Artist') : 'SoundCloud Artist';
        const isAlbum = !!(p.is_album || p.set_type === 'album' || p.set_type === 'ep');
        const playlistTitle = p.title || (isAlbum ? 'Untitled Album' : 'Untitled Playlist');

        const tracks = (p.tracks || []).map(t => this.formatTrack(t, cover, playlistTitle)).filter(Boolean);

        return {
            id: p.id,
            type: isAlbum ? 'album' : 'playlist',
            isAlbum: isAlbum,
            title: playlistTitle,
            artist: artist,
            user: artist,
            userId: p.user ? p.user.id : null,
            trackCount: p.track_count || tracks.length,
            duration: p.duration ? Math.round(p.duration / 1000) : 0,
            year: (p.release_date || p.created_at || '').substring(0, 4),
            cover: cover,
            artwork_url: cover,
            permalink_url: p.permalink_url || '',
            likes_count: p.likes_count || 0,
            genre: p.genre || '',
            description: p.description || '',
            tracks: tracks
        };
    }

    formatArtist(u) {
        if (!u || !u.id) return null;
        const avatar = u.avatar_url
            ? u.avatar_url.replace('-large', '-t500x500')
            : '/assets/icon.png';
        const name = u.username || u.full_name || 'SoundCloud Artist';

        return {
            id: u.id,
            type: 'artist',
            name: name,
            username: u.username || '',
            fullName: u.full_name || '',
            avatar: avatar,
            cover: avatar,
            followersCount: u.followers_count || 0,
            trackCount: u.track_count || 0,
            playlistCount: u.playlist_count || 0,
            description: u.description || '',
            city: u.city || '',
            country: u.country_code || '',
            verified: !!u.verified,
            permalink_url: u.permalink_url || ''
        };
    }

    async search(query, limit = 30) {
        return this.searchTracks(query, limit);
    }

    async searchTracks(query, limit = 30) {
        if (!this.config.enabled || !this.config.oauthToken) {
            throw new Error('SoundCloud is disabled or OAuth token is not configured');
        }
        const q = (query || '').trim();
        if (!q) return [];

        // Check if query is a SoundCloud URL
        if (q.includes('soundcloud.com/')) {
            const resolved = await this.resolve(q);
            if (resolved) {
                if (resolved.type === 'track') return [resolved.track];
                if (resolved.type === 'playlist' || resolved.type === 'album') return resolved.playlist?.tracks || [];
            }
        }

        const url = `https://api-v2.soundcloud.com/search/tracks?q=${encodeURIComponent(q)}&limit=${limit}`;
        const resp = await fetch(url, { headers: this.getAuthHeader() });
        if (!resp.ok) {
            throw new Error(`SoundCloud search failed with status ${resp.status}`);
        }

        const data = await resp.json();
        const collection = data.collection || [];
        return collection.map(item => this.formatTrack(item)).filter(Boolean);
    }

    async searchAlbums(query, limit = 20) {
        if (!this.config.enabled || !this.config.oauthToken) {
            throw new Error('SoundCloud is disabled or OAuth token is not configured');
        }
        const q = (query || '').trim();
        if (!q) return [];

        const url = `https://api-v2.soundcloud.com/search/albums?q=${encodeURIComponent(q)}&limit=${limit}`;
        const resp = await fetch(url, { headers: this.getAuthHeader() });
        if (!resp.ok) {
            throw new Error(`SoundCloud search albums failed (${resp.status})`);
        }

        const data = await resp.json();
        const collection = data.collection || [];
        return collection.map(item => this.formatPlaylist(item)).filter(Boolean);
    }

    async searchPlaylists(query, limit = 20) {
        if (!this.config.enabled || !this.config.oauthToken) {
            throw new Error('SoundCloud is disabled or OAuth token is not configured');
        }
        const q = (query || '').trim();
        if (!q) return [];

        let url = `https://api-v2.soundcloud.com/search/playlists_without_albums?q=${encodeURIComponent(q)}&limit=${limit}`;
        let resp = await fetch(url, { headers: this.getAuthHeader() });
        if (!resp.ok) {
            url = `https://api-v2.soundcloud.com/search/playlists?q=${encodeURIComponent(q)}&limit=${limit}`;
            resp = await fetch(url, { headers: this.getAuthHeader() });
        }
        if (!resp.ok) {
            throw new Error(`SoundCloud search playlists failed (${resp.status})`);
        }

        const data = await resp.json();
        const collection = data.collection || [];
        return collection.map(item => this.formatPlaylist(item)).filter(Boolean);
    }

    async searchArtists(query, limit = 20) {
        if (!this.config.enabled || !this.config.oauthToken) {
            throw new Error('SoundCloud is disabled or OAuth token is not configured');
        }
        const q = (query || '').trim();
        if (!q) return [];

        const url = `https://api-v2.soundcloud.com/search/users?q=${encodeURIComponent(q)}&limit=${limit}`;
        const resp = await fetch(url, { headers: this.getAuthHeader() });
        if (!resp.ok) {
            throw new Error(`SoundCloud search artists failed (${resp.status})`);
        }

        const data = await resp.json();
        const collection = data.collection || [];
        return collection.map(item => this.formatArtist(item)).filter(Boolean);
    }

    async searchAll(query, limit = 15) {
        const q = (query || '').trim();
        if (!q) return { tracks: [], albums: [], playlists: [], artists: [] };

        const [tracksRes, albumsRes, playlistsRes, artistsRes] = await Promise.allSettled([
            this.searchTracks(q, limit),
            this.searchAlbums(q, Math.min(limit, 8)),
            this.searchPlaylists(q, Math.min(limit, 8)),
            this.searchArtists(q, Math.min(limit, 8))
        ]);

        return {
            tracks: tracksRes.status === 'fulfilled' ? tracksRes.value : [],
            albums: albumsRes.status === 'fulfilled' ? albumsRes.value : [],
            playlists: playlistsRes.status === 'fulfilled' ? playlistsRes.value : [],
            artists: artistsRes.status === 'fulfilled' ? artistsRes.value : []
        };
    }

    async resolvePlaylistStubs(data) {
        if (!data || !Array.isArray(data.tracks)) return;
        const stubs = data.tracks.filter(t => t && t.id && (!t.title || !t.media));
        if (stubs.length === 0) return;

        const chunkSize = 50;
        const chunks = [];
        for (let i = 0; i < stubs.length; i += chunkSize) {
            chunks.push(stubs.slice(i, i + chunkSize).map(t => t.id));
        }

        try {
            const results = await Promise.all(chunks.map(async (batchIds) => {
                const tracksResp = await fetch(`https://api-v2.soundcloud.com/tracks?ids=${batchIds.join(',')}`, {
                    headers: this.getAuthHeader()
                });
                if (tracksResp.ok) {
                    return await tracksResp.json();
                }
                return [];
            }));
            const fullMap = new Map();
            for (const batch of results) {
                if (Array.isArray(batch)) {
                    for (const ft of batch) {
                        if (ft && ft.id) fullMap.set(ft.id, ft);
                    }
                }
            }
            data.tracks = data.tracks.map(t => fullMap.get(t.id) || t);
        } catch (e) {
            console.error('[SoundCloud] Error fetching stub tracks:', e.message);
        }
    }

    async getPlaylist(playlistId) {
        if (!this.config.enabled || !this.config.oauthToken) {
            throw new Error('SoundCloud is disabled or OAuth token is not configured');
        }
        const pUrl = `https://api-v2.soundcloud.com/playlists/${playlistId}`;
        const resp = await fetch(pUrl, { headers: this.getAuthHeader() });
        if (!resp.ok) {
            throw new Error(`Playlist ${playlistId} not found (${resp.status})`);
        }

        const data = await resp.json();
        await this.resolvePlaylistStubs(data);

        const formatted = this.formatPlaylist(data);
        if (formatted) {
            formatted.isFullyLoaded = true;
        }
        return formatted;
    }

    async getTrack(trackId) {
        if (!trackId) return null;
        const idStr = String(trackId).replace(/^soundcloud:/i, '').trim();
        let track = this.trackCache.get(idStr);
        if (track) return track;

        if (!this.config.enabled || !this.config.oauthToken) {
            throw new Error('SoundCloud is disabled or OAuth token is not configured');
        }

        const trackUrl = `https://api-v2.soundcloud.com/tracks/${idStr}`;
        const resp = await fetch(trackUrl, { headers: this.getAuthHeader() });
        if (!resp.ok) {
            throw new Error(`Track ${idStr} not found (${resp.status})`);
        }
        const data = await resp.json();
        return this.formatTrack(data);
    }

    async getTrackStation(trackId) {
        if (!this.config.enabled || !this.config.oauthToken) {
            throw new Error('SoundCloud is disabled or OAuth token is not configured');
        }
        const cleanId = String(trackId).replace(/^soundcloud:/i, '').trim();
        let rawTracks = [];

        try {
            const stationUrl = `https://api-v2.soundcloud.com/stations/soundcloud:track-stations:${cleanId}/tracks`;
            const resp = await fetch(stationUrl, { headers: this.getAuthHeader() });
            if (resp.ok) {
                const data = await resp.json();
                rawTracks = Array.isArray(data) ? data : (data.collection || []);
            }
        } catch (e) {
            console.warn(`[SoundCloud] Failed to fetch station for ${cleanId}:`, e.message);
        }

        if (!rawTracks || rawTracks.length === 0) {
            try {
                const relatedUrl = `https://api-v2.soundcloud.com/tracks/${cleanId}/related?limit=30`;
                const resp = await fetch(relatedUrl, { headers: this.getAuthHeader() });
                if (resp.ok) {
                    const data = await resp.json();
                    rawTracks = Array.isArray(data) ? data : (data.collection || []);
                }
            } catch (e) {
                console.warn(`[SoundCloud] Failed to fetch related tracks for ${cleanId}:`, e.message);
            }
        }

        const dummyContainer = { tracks: rawTracks };
        await this.resolvePlaylistStubs(dummyContainer);

        return (dummyContainer.tracks || [])
            .map(t => this.formatTrack(t))
            .filter(Boolean);
    }

    async getArtist(artistId) {
        if (!this.config.enabled || !this.config.oauthToken) {
            throw new Error('SoundCloud is disabled or OAuth token is not configured');
        }
        const userUrl = `https://api-v2.soundcloud.com/users/${artistId}`;
        const resp = await fetch(userUrl, { headers: this.getAuthHeader() });
        if (!resp.ok) {
            throw new Error(`Artist ${artistId} not found (${resp.status})`);
        }

        const userData = await resp.json();
        const artist = this.formatArtist(userData);

        // Fetch artist tracks, albums, playlists in parallel
        const [tracksRes, albumsRes, playlistsRes] = await Promise.allSettled([
            fetch(`https://api-v2.soundcloud.com/users/${artistId}/tracks?limit=30`, { headers: this.getAuthHeader() }).then(r => r.ok ? r.json() : { collection: [] }),
            fetch(`https://api-v2.soundcloud.com/users/${artistId}/albums?limit=15`, { headers: this.getAuthHeader() }).then(r => r.ok ? r.json() : { collection: [] }),
            fetch(`https://api-v2.soundcloud.com/users/${artistId}/playlists?limit=15`, { headers: this.getAuthHeader() }).then(r => r.ok ? r.json() : { collection: [] })
        ]);

        const rawTracks = tracksRes.status === 'fulfilled' ? (tracksRes.value.collection || tracksRes.value || []) : [];
        const rawAlbums = albumsRes.status === 'fulfilled' ? (albumsRes.value.collection || albumsRes.value || []) : [];
        const rawPlaylists = playlistsRes.status === 'fulfilled' ? (playlistsRes.value.collection || playlistsRes.value || []) : [];

        artist.tracks = rawTracks.map(t => this.formatTrack(t, artist.avatar)).filter(Boolean);
        artist.albums = rawAlbums.map(a => this.formatPlaylist(a)).filter(Boolean);
        artist.playlists = rawPlaylists.map(p => this.formatPlaylist(p)).filter(Boolean);

        return artist;
    }

    async resolve(targetUrl) {
        if (!this.config.enabled || !this.config.oauthToken) {
            throw new Error('SoundCloud is disabled or OAuth token is not configured');
        }
        const cleanUrl = (targetUrl || '').trim();
        const url = `https://api-v2.soundcloud.com/resolve?url=${encodeURIComponent(cleanUrl)}`;
        const resp = await fetch(url, { headers: this.getAuthHeader() });
        if (!resp.ok) {
            throw new Error(`Failed to resolve SoundCloud URL (${resp.status})`);
        }

        const data = await resp.json();
        if (data.kind === 'track') {
            return {
                type: 'track',
                track: this.formatTrack(data)
            };
        } else if (data.kind === 'playlist') {
            await this.resolvePlaylistStubs(data);
            const pl = this.formatPlaylist(data);
            return {
                type: pl.isAlbum ? 'album' : 'playlist',
                playlist: pl
            };
        } else if (data.kind === 'user') {
            return {
                type: 'artist',
                artist: this.formatArtist(data)
            };
        }

        return null;
    }

    async getUserLikes(limit = 50, offset = 0) {
        if (!this.config.enabled || !this.config.oauthToken) {
            throw new Error('SoundCloud is disabled or OAuth token is not configured');
        }
        if (!this.currentUser) {
            await this.verifyToken(this.config.oauthToken);
        }

        const userId = this.currentUser.id;
        let url = `https://api-v2.soundcloud.com/users/${userId}/likes?limit=${limit}`;
        if (offset > 0) {
            url += `&offset=${offset}`;
        }

        const resp = await fetch(url, { headers: this.getAuthHeader() });
        if (!resp.ok) {
            throw new Error(`SoundCloud get likes failed (${resp.status})`);
        }

        const data = await resp.json();
        const collection = data.collection || [];
        const tracks = [];

        for (const item of collection) {
            if (item.track) {
                const formatted = this.formatTrack(item.track);
                if (formatted) tracks.push(formatted);
            } else if (item.kind === 'track') {
                const formatted = this.formatTrack(item);
                if (formatted) tracks.push(formatted);
            }
        }

        return {
            tracks,
            next_href: data.next_href || null,
            total: this.currentUser.likes_count || tracks.length
        };
    }

    async getUserPlaylists() {
        if (!this.config.enabled || !this.config.oauthToken) {
            throw new Error('SoundCloud is disabled or OAuth token is not configured');
        }
        if (!this.currentUser) {
            await this.verifyToken(this.config.oauthToken);
        }

        const userId = this.currentUser.id;
        const url = `https://api-v2.soundcloud.com/users/${userId}/playlists`;
        const resp = await fetch(url, { headers: this.getAuthHeader() });
        if (!resp.ok) {
            throw new Error(`SoundCloud get playlists failed (${resp.status})`);
        }

        const data = await resp.json();
        const playlists = Array.isArray(data) ? data : (data.collection || []);
        return playlists.map(p => this.formatPlaylist(p)).filter(Boolean);
    }

    async getTrackMediaStreamUrl(trackId, forceFresh = false) {
        const idStr = String(trackId);
        if (forceFresh) {
            this.streamCache.delete(idStr);
        } else {
            const cached = this.streamCache.get(idStr);
            if (cached && cached.expiresAt > Date.now()) {
                return cached.url;
            }
        }

        if (this.inFlightStreamUrls.has(idStr)) {
            return await this.inFlightStreamUrls.get(idStr);
        }

        const fetchPromise = (async () => {
            let transcodings = this.transcodingsCache.get(idStr);

            if (forceFresh || !transcodings || transcodings.length === 0) {
                // Fetch track metadata only if transcodings are not already cached or forceFresh is requested
                const trackUrl = `https://api-v2.soundcloud.com/tracks/${idStr}`;
                const resp = await fetch(trackUrl, { headers: this.getAuthHeader() });
                if (!resp.ok) {
                    throw new Error(`Track ${trackId} not found (${resp.status})`);
                }

                const trackData = await resp.json();
                this.formatTrack(trackData);
                transcodings = this.transcodingsCache.get(idStr) || (trackData.media && trackData.media.transcodings ? trackData.media.transcodings : []);
            }

            if (!transcodings || transcodings.length === 0) {
                throw new Error('No audio transcodings found for this track');
            }

            // Find best stream: prefer progressive mp3
            let targetTranscoding = transcodings.find(t => 
                t.format && t.format.protocol === 'progressive' && t.format.mime_type && t.format.mime_type.includes('mpeg')
            );

            if (!targetTranscoding) {
                targetTranscoding = transcodings.find(t => t.format && t.format.protocol === 'progressive');
            }

            if (!targetTranscoding) {
                targetTranscoding = transcodings.find(t => t.format && t.format.protocol === 'hls' && t.preset && t.preset.includes('mp3'));
            }

            if (!targetTranscoding) {
                targetTranscoding = transcodings[0];
            }

            const streamResp = await fetch(targetTranscoding.url, { headers: this.getAuthHeader() });
            if (!streamResp.ok) {
                throw new Error(`Failed to obtain stream URL (${streamResp.status})`);
            }

            const streamData = await streamResp.json();
            if (!streamData.url) {
                throw new Error('Stream URL missing in SoundCloud response');
            }

            // Cache stream URL for 2.5 minutes (CloudFront signed URLs expire in ~5 min)
            this.streamCache.set(idStr, {
                url: streamData.url,
                expiresAt: Date.now() + 150 * 1000
            });

            return streamData.url;
        })();

        this.inFlightStreamUrls.set(idStr, fetchPromise);
        try {
            return await fetchPromise;
        } finally {
            this.inFlightStreamUrls.delete(idStr);
        }
    }

    async pipeStream(trackId, reqHeaders, res) {
        if (res.destroyed || res.writableEnded) return;

        const abortCtrl = new AbortController();
        let nodeStream = null;

        const onClose = () => {
            abortCtrl.abort();
            if (nodeStream) {
                try { nodeStream.destroy(); } catch (e) {}
                nodeStream = null;
            }
        };
        res.on('close', onClose);

        try {
            let streamUrl = await this.getTrackMediaStreamUrl(trackId);
            if (res.destroyed || res.writableEnded) return;

            const headers = {};
            if (reqHeaders.range) {
                headers['Range'] = reqHeaders.range;
            }

            let cdnResp = await fetch(streamUrl, {
                headers,
                signal: abortCtrl.signal
            });

            // If CloudFront signed URL expired (401/403/410/404), refresh stream URL and retry once
            if ((cdnResp.status === 401 || cdnResp.status === 403 || cdnResp.status === 410 || cdnResp.status === 404) && !res.destroyed && !res.writableEnded) {
                console.warn(`[SoundCloud] Stream URL for track ${trackId} returned ${cdnResp.status}, refreshing stream URL...`);
                this.streamCache.delete(String(trackId));
                streamUrl = await this.getTrackMediaStreamUrl(trackId, true);
                cdnResp = await fetch(streamUrl, {
                    headers,
                    signal: abortCtrl.signal
                });
            }

            if (res.destroyed || res.writableEnded) return;
            
            res.status(cdnResp.status);
            res.setHeader('Content-Type', cdnResp.headers.get('content-type') || 'audio/mpeg');
            res.setHeader('Accept-Ranges', 'bytes');
            res.setHeader('Access-Control-Allow-Origin', '*');

            const contentRange = cdnResp.headers.get('content-range');
            if (contentRange) res.setHeader('Content-Range', contentRange);

            const contentLength = cdnResp.headers.get('content-length');
            if (contentLength) res.setHeader('Content-Length', contentLength);

            nodeStream = Readable.fromWeb(cdnResp.body);
            nodeStream.on('error', (err) => {
                if (err.name !== 'AbortError') {
                    console.warn(`[SoundCloud] Stream body error for track ${trackId}:`, err.message);
                }
            });

            res.on('finish', () => {
                res.removeListener('close', onClose);
            });

            nodeStream.pipe(res);
        } catch (e) {
            res.removeListener('close', onClose);
            if (e.name === 'AbortError') return;
            console.error(`[SoundCloud] Stream pipe error for track ${trackId}:`, e.message);
            if (!res.headersSent && !res.destroyed && !res.writableEnded) {
                res.status(500).json({ error: e.message });
            }
        }
    }

    sanitizeFilename(name) {
        return (name || 'track')
            .replace(/[/\\?%*:|"<>]/g, '_')
            .replace(/\s+/g, ' ')
            .trim();
    }

    createId3Tag(title, artist, album, year, coverBuffer = null) {
        const frames = [];

        const makeFrame = (id, text) => {
            if (!text) return null;
            const textBuf = Buffer.from('\uFEFF' + text, 'utf16le');
            const content = Buffer.concat([Buffer.from([1]), textBuf]);
            const sizeBuf = Buffer.alloc(4);
            sizeBuf.writeUInt32BE(content.length, 0);
            return Buffer.concat([Buffer.from(id, 'ascii'), sizeBuf, Buffer.alloc(2), content]);
        };

        if (title) frames.push(makeFrame('TIT2', title));
        if (artist) frames.push(makeFrame('TPE1', artist));
        if (album) frames.push(makeFrame('TALB', album));
        if (year) frames.push(makeFrame('TYER', year));

        // APIC (Attached picture)
        if (coverBuffer && coverBuffer.length > 0) {
            const mime = Buffer.from('image/jpeg\0', 'ascii');
            const picType = Buffer.from([3]); // Cover (front)
            const desc = Buffer.from([0, 0]); // empty UTF-16 description
            const content = Buffer.concat([Buffer.from([1]), mime, picType, desc, coverBuffer]);
            const sizeBuf = Buffer.alloc(4);
            sizeBuf.writeUInt32BE(content.length, 0);
            frames.push(Buffer.concat([Buffer.from('APIC', 'ascii'), sizeBuf, Buffer.alloc(2), content]));
        }

        const validFrames = frames.filter(Boolean);
        if (validFrames.length === 0) return Buffer.alloc(0);

        const framesBuf = Buffer.concat(validFrames);
        const tagSize = framesBuf.length;

        // 4-byte synchsafe integer
        const synchsafeSize = Buffer.from([
            (tagSize >> 21) & 0x7F,
            (tagSize >> 14) & 0x7F,
            (tagSize >> 7) & 0x7F,
            tagSize & 0x7F
        ]);

        const header = Buffer.concat([
            Buffer.from('ID3', 'ascii'),
            Buffer.from([3, 0]), // ID3v2.3
            Buffer.from([0]),    // flags
            synchsafeSize
        ]);

        return Buffer.concat([header, framesBuf]);
    }

    async downloadTrackToLibrary(trackId, targetDir = null) {
        const idStr = String(trackId);
        let track = this.trackCache.get(idStr);
        if (!track) {
            // Fetch track details first
            const trackUrl = `https://api-v2.soundcloud.com/tracks/${idStr}`;
            const resp = await fetch(trackUrl, { headers: this.getAuthHeader() });
            if (!resp.ok) throw new Error(`Track ${trackId} not found`);
            track = this.formatTrack(await resp.json());
        }

        const streamUrl = await this.getTrackMediaStreamUrl(idStr);

        // Determine destination folder
        let destFolder = targetDir;
        if (!destFolder) {
            destFolder = path.join(DATA_DIR, 'SoundCloud');
        }
        if (!fs.existsSync(destFolder)) {
            fs.mkdirSync(destFolder, { recursive: true });
        }

        const baseFileName = this.sanitizeFilename(`${track.artist} - ${track.title}`);
        const mp3FilePath = path.join(destFolder, `${baseFileName}.mp3`);
        const coverFilePath = path.join(destFolder, `${baseFileName}.jpg`);

        // Fetch audio stream
        const audioResp = await fetch(streamUrl);
        if (!audioResp.ok) throw new Error(`Failed to download audio data (${audioResp.status})`);
        const audioArrayBuffer = await audioResp.arrayBuffer();
        const audioBuffer = Buffer.from(audioArrayBuffer);

        // Fetch cover artwork if present
        let coverBuffer = null;
        if (track.cover && track.cover.startsWith('http')) {
            try {
                const coverResp = await fetch(track.cover);
                if (coverResp.ok) {
                    const coverArr = await coverResp.arrayBuffer();
                    coverBuffer = Buffer.from(coverArr);
                    fs.writeFileSync(coverFilePath, coverBuffer);
                }
            } catch (err) {
                console.warn('[SoundCloud] Failed to fetch cover for download:', err.message);
            }
        }

        // Create ID3v2 tag
        const id3Tag = this.createId3Tag(track.title, track.artist, track.album, track.year, coverBuffer);
        const finalBuffer = Buffer.concat([id3Tag, audioBuffer]);

        fs.writeFileSync(mp3FilePath, finalBuffer);

        // Record in downloads
        const downloadRecord = {
            id: track.id,
            path: mp3FilePath,
            title: track.title,
            artist: track.artist,
            coverPath: fs.existsSync(coverFilePath) ? coverFilePath : null,
            downloadedAt: new Date().toISOString()
        };

        const existingIdx = this.downloads.findIndex(d => d.path === mp3FilePath || d.id === track.id);
        if (existingIdx !== -1) {
            this.downloads[existingIdx] = downloadRecord;
        } else {
            this.downloads.push(downloadRecord);
        }
        this.saveDownloads(this.downloads);

        return {
            success: true,
            filePath: mp3FilePath,
            coverPath: downloadRecord.coverPath,
            track
        };
    }
}

module.exports = new SoundCloudService();
