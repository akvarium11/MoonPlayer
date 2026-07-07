document.addEventListener('DOMContentLoaded', () => {
    // ==========================================
    // 1. SNOWFLAKE BACKGROUND ANIMATION
    // ==========================================
    const snowContainer = document.getElementById('snow-container');
    const snowflakeCount = 25;
    let isSnowEnabled = localStorage.getItem('moonplayer_snow') !== 'false';

    if (isSnowEnabled) {
        for (let i = 0; i < snowflakeCount; i++) {
            createSnowflake();
        }
    }

    function createSnowflake() {
        if (!snowContainer || !isSnowEnabled) return;
        const snowflake = document.createElement('div');
        snowflake.classList.add('snowflake');

        const startLeft = Math.random() * 100;
        const animationDuration = 8 + Math.random() * 12;
        const animationDelay = Math.random() * 6;
        const size = Math.random() * 5 + 3;
        const blurAmount = Math.random() * 2 + 1;
        const opacity = Math.random() * 0.4 + 0.2;

        snowflake.style.left = `${startLeft}vw`;
        snowflake.style.animationDuration = `${animationDuration}s`;
        snowflake.style.animationDelay = `${animationDelay}s`;
        snowflake.style.width = `${size}px`;
        snowflake.style.height = `${size}px`;
        snowflake.style.filter = `blur(${blurAmount}px)`;
        snowflake.style.backgroundColor = `rgba(255, 255, 255, ${opacity})`;
        snowflake.style.opacity = opacity;

        snowContainer.appendChild(snowflake);

        snowflake.addEventListener('animationend', () => {
            snowflake.remove();
            createSnowflake();
        });
    }

    // ==========================================
    // 2. SETTINGS STATE & 3D TILT EFFECT
    // ==========================================
    let isTiltEnabled = localStorage.getItem('moonplayer_tilt') !== 'false';
    let isGlowEnabled = localStorage.getItem('moonplayer_glow') !== 'false';
    let accentColor = localStorage.getItem('moonplayer_accent') || '#ffffff';

    const playerCard = document.querySelector('.player-card');
    const cardShine = document.getElementById('card-shine');

    // Initial settings application
    if (!isGlowEnabled && playerCard) {
        playerCard.classList.add('glow-disabled');
    }
    updateAccentColor(accentColor);

    document.addEventListener('mousemove', (e) => {
        if (!playerCard) return;

        const rect = playerCard.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        if (isGlowEnabled) {
            playerCard.style.setProperty('--mouse-x', `${x}px`);
            playerCard.style.setProperty('--mouse-y', `${y}px`);
        }

        if (!isTiltEnabled || window.innerWidth <= 900) return;

        // Reset transitions during hover for absolute responsiveness
        playerCard.style.transition = 'transform 0.1s ease-out';
        
        // Tilt calculations (mild and premium)
        const xAxis = (window.innerWidth / 2 - e.clientX) / 80;
        const yAxis = (window.innerHeight / 2 - e.clientY) / 60;
        playerCard.style.transform = `perspective(1200px) rotateY(${xAxis}deg) rotateX(${yAxis}deg)`;
    });

    document.addEventListener('mouseleave', () => {
        if (!playerCard || window.innerWidth <= 900) return;
        playerCard.style.transition = 'transform 0.8s cubic-bezier(0.16, 1, 0.3, 1)';
        playerCard.style.transform = 'perspective(1200px) rotateY(0deg) rotateX(0deg)';
    });

    // Helper: Update CSS variable for accent color in real-time
    function updateAccentColor(color) {
        document.documentElement.style.setProperty('--accent', color);
        // Parse color for glow effect
        let r = 255, g = 255, b = 255;
        if (color.startsWith('#')) {
            const hex = color.substring(1);
            if (hex.length === 3) {
                r = parseInt(hex[0] + hex[0], 16);
                g = parseInt(hex[1] + hex[1], 16);
                b = parseInt(hex[2] + hex[2], 16);
            } else if (hex.length === 6) {
                r = parseInt(hex.substring(0, 2), 16);
                g = parseInt(hex.substring(2, 4), 16);
                b = parseInt(hex.substring(4, 6), 16);
            }
        }
        document.documentElement.style.setProperty('--accent-glow', `rgba(${r}, ${g}, ${b}, 0.25)`);
    }

    // ==========================================
    // 3. PRELOADER & DIRECT LOAD
    // ==========================================
    const preloaderOverlay = document.getElementById('preloader-overlay');
    const mainContainer = document.querySelector('.main-container');
    const islandContainer = document.querySelector('.dynamic-island-container');
    const preloaderContainer = document.getElementById('preloader-container');
    const progressBar = document.getElementById('progress-bar');

    // Simulate entry animation
    let loadingPct = 0;
    const interval = setInterval(() => {
        loadingPct += Math.floor(Math.random() * 15) + 5;
        if (loadingPct >= 100) {
            loadingPct = 100;
            clearInterval(interval);
            setTimeout(() => {
                // Load directly
                if (preloaderOverlay) preloaderOverlay.classList.add('hidden');
                mainContainer.classList.add('visible');
                if (islandContainer) {
                    islandContainer.classList.add('visible');
                }
            }, 300);
        }
        progressBar.style.width = `${loadingPct}%`;
    }, 100);

    // Resume AudioContext on first user click anywhere on the page
    document.addEventListener('click', () => {
        initAudioContext();
        if (audioContext && audioContext.state === 'suspended') {
            audioContext.resume();
        }
    }, { once: true });

    // ==========================================
    // 4. MUSIC LIBRARY DATA STRUCTURES
    // ==========================================
    let allSongs = [];   // Flattened list of all tracks
    let albums = [];     // Grouped by Album Name
    let artists = [];    // Grouped by Artist Name
    let currentPlaylist = []; // Songs currently shown in the right panel
    let currentlyPlayingIndex = -1; // Index within allSongs
    let isPlaying = false;
    let isShuffle = false;
    let isLoop = 'none'; // 'none', 'all', 'one'

    // Playback Queue & Navigation index
    let playQueue = [];
    let playQueueIndex = -1;
    let originalQueue = []; // Keeps original order when shuffle is active

    // Search Mode State & Lazy Loading Results Panel
    let searchType = 'album'; // 'album', 'artist', or 'song'
    let fuse = null; // Fuse.js instance
    let activeResults = []; // stores all currently filtered results
    let renderedResultsCount = 0;
    const RESULTS_BATCH_SIZE = 30;

    // Lazy Loading Right Playlist
    let renderedSongsCount = 0;
    const SONGS_BATCH_SIZE = 40;

    // Default Cover
    const DEFAULT_COVER = '/assets/icon.png';

    // ==========================================
    // 5. AUDIO ENGINE & WEB AUDIO API VISUALIZER
    // ==========================================
    const bgAudio = document.getElementById('bg-audio');
    const playBtn = document.getElementById('play-btn');
    const playIcon = playBtn.querySelector('i');
    
    const progressSlider = document.getElementById('progress-slider');
    const currentTimeEl = document.getElementById('current-time');
    const totalTimeEl = document.getElementById('total-time');

    const prevBtn = document.getElementById('prev-btn');
    const nextBtn = document.getElementById('next-btn');
    const shuffleBtn = document.getElementById('shuffle-btn');
    const loopBtn = document.getElementById('loop-btn');

    const volumeSlider = document.getElementById('volume-slider');
    const muteBtn = document.getElementById('mute-btn');
    const muteIcon = muteBtn.querySelector('i');

    let audioContext = null;
    let analyser = null;
    let dataArray = null;
    let sourceNode = null;
    let visualizerAnimationId = null;

    function initAudioContext() {
        if (audioContext) return;
        try {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            analyser = audioContext.createAnalyser();
            analyser.fftSize = 64; // 32 frequency bins

            sourceNode = audioContext.createMediaElementSource(bgAudio);
            sourceNode.connect(analyser);
            analyser.connect(audioContext.destination);

            const bufferLength = analyser.frequencyBinCount;
            dataArray = new Uint8Array(bufferLength);
            
            // Start Visualizer loop
            drawVisualizer();
        } catch (e) {
            console.error("Web Audio API not supported / blocked:", e);
        }
    }

    // Web Audio Canvas Visualizer
    const canvas = document.getElementById('visualizer');
    const ctx = canvas.getContext('2d');

    function resizeCanvas() {
        if (!canvas) return;
        canvas.width = canvas.parentElement.clientWidth * window.devicePixelRatio;
        canvas.height = canvas.parentElement.clientHeight * window.devicePixelRatio;
    }
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    const barCount = 32;
    const bars = [];
    for (let i = 0; i < barCount; i++) {
        bars.push({
            currentHeight: 1,
            targetHeight: 1,
            speed: 0.12 + Math.random() * 0.08
        });
    }

    function drawVisualizer() {
        visualizerAnimationId = requestAnimationFrame(drawVisualizer);

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const w = canvas.width;
        const h = canvas.height;
        const barWidth = (w / barCount) * 0.7;
        const gap = (w / barCount) * 0.3;

        let hasRealData = false;
        if (isPlaying && analyser && dataArray) {
            analyser.getByteFrequencyData(dataArray);
            let sum = 0;
            for (let i = 0; i < dataArray.length; i++) {
                sum += dataArray[i];
            }
            if (sum > 0) hasRealData = true;
        }

        for (let i = 0; i < barCount; i++) {
            const bar = bars[i];

            if (isPlaying) {
                if (hasRealData) {
                    const val = dataArray[i] || 0;
                    let frequencyBoost = 1.0;
                    if (i > 16) frequencyBoost = 1.3;
                    if (i > 24) frequencyBoost = 1.6;
                    bar.targetHeight = Math.max(1, (val / 255) * h * 1.2 * frequencyBoost);
                } else {
                    // Fallback visualizer oscillation when loaded but not fully analyzed yet
                    const time = Date.now() * 0.0035;
                    const wave1 = Math.sin(time + i * 0.35) * 0.45 + 0.55;
                    const wave2 = Math.cos(time * 0.65 - i * 0.4) * 0.35 + 0.45;
                    const randomNoise = Math.random() * 0.15;

                    let freqMultiplier = 0.85;
                    if (i < 6) freqMultiplier = 0.45 + i * 0.08;
                    else if (i > 25) freqMultiplier = 1.0 - (i - 25) * 0.1;

                    const factor = (wave1 * 0.65 + wave2 * 0.35 + randomNoise * 0.1) * freqMultiplier;
                    bar.targetHeight = Math.max(1, factor * h * 0.95);
                }
            } else {
                bar.targetHeight = 1;
            }

            bar.currentHeight += (bar.targetHeight - bar.currentHeight) * bar.speed;

            const x = i * (barWidth + gap) + gap / 2;
            const y = h - bar.currentHeight;

            ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#ffffff';
            ctx.beginPath();
            ctx.rect(x, y, barWidth, bar.currentHeight);
            ctx.fill();
        }
    }

    // ==========================================
    // 6. DYNAMIC ISLAND & SPINNING CONTROLS
    // ==========================================
    const dynamicIsland = document.getElementById('dynamic-island');
    const islandExpanded = document.querySelector('.island-expanded');

    if (dynamicIsland) {
        if (islandExpanded) {
            islandExpanded.addEventListener('click', (e) => {
                e.stopPropagation();
            });
        }

        // Expand dynamic island on hover (Desktop)
        dynamicIsland.addEventListener('mouseenter', () => {
            if (window.innerWidth > 480) {
                dynamicIsland.classList.add('expanded');
            }
        });

        dynamicIsland.addEventListener('mouseleave', () => {
            if (window.innerWidth > 480 && !dynamicIsland.classList.contains('locked')) {
                dynamicIsland.classList.remove('expanded');
            }
        });

        // Toggle expand on click
        dynamicIsland.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!dynamicIsland.classList.contains('expanded')) {
                dynamicIsland.classList.add('expanded');
                dynamicIsland.classList.add('locked');
            } else {
                dynamicIsland.classList.remove('expanded');
                dynamicIsland.classList.remove('locked');
            }
        });

        // Collapse when clicking elsewhere
        document.addEventListener('click', () => {
            if (dynamicIsland.classList.contains('expanded')) {
                dynamicIsland.classList.remove('expanded');
                dynamicIsland.classList.remove('locked');
            }
        });
    }

    // Cover Spinning State
    function setCoverAnimationState(playing) {
        const miniCover = document.getElementById('mini-cover');
        const miniWaveform = document.getElementById('mini-waveform');
        const trackCover = document.getElementById('track-cover');
        
        if (playing) {
            trackCover.classList.add('spinning');
            trackCover.classList.remove('paused');
            if (miniCover) {
                miniCover.classList.add('spinning');
                miniCover.classList.remove('paused');
            }
            if (miniWaveform) {
                miniWaveform.classList.add('playing');
            }
        } else {
            trackCover.classList.add('paused');
            if (miniCover) {
                miniCover.classList.add('paused');
            }
            if (miniWaveform) {
                miniWaveform.classList.remove('playing');
            }
        }
    }

    // ==========================================
    // 7. FOLDER PROCESSING & METADATA PARSING
    // ==========================================
    const folderPickBtn = document.getElementById('folder-pick-btn');
    const folderInput = document.getElementById('folder-input');
    const searchResults = document.getElementById('search-results');

    if (folderPickBtn) {
        folderPickBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            folderInput.click();
        });
    }

    folderInput.addEventListener('change', async (e) => {
        const files = Array.from(e.target.files);
        if (files.length === 0) return;

        // Filter valid audio extensions
        const validExtensions = ['.mp3', '.flac', '.ogg', '.wav', '.m4a', '.aac', '.webm', '.opus'];
        const audioFiles = files.filter(file => {
            const name = file.name.toLowerCase();
            return validExtensions.some(ext => name.endsWith(ext));
        });

        if (audioFiles.length === 0) {
            searchResults.innerHTML = `
                <div class="empty-state">
                    <i class="fa-solid fa-triangle-exclamation"></i>
                    <p>No audio files found</p>
                    <span>Please choose a folder containing valid files (.mp3, .flac, etc.)</span>
                </div>
            `;
            return;
        }

        // Display scanning status
        searchResults.innerHTML = `
            <div class="empty-state">
                <i class="fa-solid fa-spinner fa-spin"></i>
                <p>Scanning Folder...</p>
                <span id="scan-progress">Processed: 0 / ${audioFiles.length} files</span>
            </div>
        `;

        allSongs = [];
        let processedCount = 0;

        // Processing in concurrency batches
        const concurrency = 6;
        const progressSpan = document.getElementById('scan-progress');

        const processFile = async (file) => {
            try {
                const metadata = await parseFileMetadata(file);
                allSongs.push(metadata);
            } catch (err) {
                console.error("Failed parsing metadata, using fallback:", file.name, err);
                // Fail-safe manual fallback
                allSongs.push(generateFallbackMetadata(file));
            } finally {
                processedCount++;
                if (progressSpan) {
                    progressSpan.textContent = `Processed: ${processedCount} / ${audioFiles.length} files`;
                }
            }
        };

        // Batch execution
        for (let i = 0; i < audioFiles.length; i += concurrency) {
            const batch = audioFiles.slice(i, i + concurrency);
            await Promise.all(batch.map(file => processFile(file)));
        }

        // Process libraries (Group into Albums & Artists)
        buildLibraries();

        // Initialize Fuzzy Search Index
        setupFuseSearch();

        // Render initially
        renderLibraryPanel();

        // Select the first album or song by default if available
        if (albums.length > 0) {
            selectAlbum(albums[0].albumKey);
        } else if (allSongs.length > 0) {
            // No albums? Load list of songs
            currentPlaylist = [...allSongs];
            renderPlaylistView("All Tracks", "Indexed Local Audio", "Various", null);
        }
    });

    // Parse metadata using jsmediatags, wrapped in Promise
    function parseFileMetadata(file) {
        return new Promise((resolve) => {
            // Set 5-second timeout in case parsing freezes
            const timeoutId = setTimeout(() => {
                resolve(generateFallbackMetadata(file));
            }, 5000);

            window.jsmediatags.read(file, {
                onSuccess: function (tag) {
                    clearTimeout(timeoutId);
                    
                    const tags = tag.tags || {};
                    let title = tags.title ? tags.title.trim() : "";
                    let artist = tags.artist ? tags.artist.trim() : "";
                    let album = tags.album ? tags.album.trim() : "";
                    let year = tags.year ? tags.year.trim() : "";
                    let cover = DEFAULT_COVER;

                    // Fallback to filename parsing if metadata is missing
                    if (!title) {
                        const filenameInfo = parseFilename(file.name);
                        title = filenameInfo.title;
                        if (!artist) artist = filenameInfo.artist;
                    }

                    if (!artist) {
                        // Fallback to directory structure
                        const pathInfo = parseRelativePath(file.webkitRelativePath);
                        artist = pathInfo.artist || "Unknown Artist";
                    }

                    if (!album) {
                        const pathInfo = parseRelativePath(file.webkitRelativePath);
                        album = pathInfo.album || "Unknown Album";
                    }

                    // Parse embedded picture
                    if (tags.picture) {
                        try {
                            const pic = tags.picture;
                            const bytes = new Uint8Array(pic.data);
                            let binary = "";
                            const len = bytes.byteLength;
                            const chunk = 8192;
                            for (let i = 0; i < len; i += chunk) {
                                binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
                            }
                            cover = `data:${pic.format};base64,${window.btoa(binary)}`;
                        } catch (imgErr) {
                            console.error("Error reading cover art:", imgErr);
                        }
                    }

                    resolve({
                        file: file,
                        src: URL.createObjectURL(file),
                        title: title || file.name,
                        artist: artist,
                        album: album,
                        year: year,
                        cover: cover
                    });
                },
                onError: function () {
                    clearTimeout(timeoutId);
                    resolve(generateFallbackMetadata(file));
                }
            });
        });
    }

    // Helper: Filename parsing ("Artist - Title.mp3")
    function parseFilename(name) {
        const withoutExt = name.substring(0, name.lastIndexOf('.')) || name;
        const separatorIndex = withoutExt.indexOf(' - ');
        if (separatorIndex !== -1) {
            return {
                artist: withoutExt.substring(0, separatorIndex).trim(),
                title: withoutExt.substring(separatorIndex + 3).trim()
            };
        }
        return {
            artist: "",
            title: withoutExt.trim()
        };
    }

    // Helper: Relative path parsing (returns artist/album based on subfolders)
    function parseRelativePath(relPath) {
        if (!relPath) return { artist: "", album: "" };
        const parts = relPath.replace(/\\/g, '/').split('/');
        // Length 3+: ["Music", "Beatles", "Abbey Road", "song.mp3"] -> Beatles (Artist), Abbey Road (Album)
        if (parts.length >= 4) {
            return {
                album: parts[parts.length - 2],
                artist: parts[parts.length - 3]
            };
        }
        // Length 2: ["Abbey Road", "song.mp3"] -> Abbey Road (Album)
        if (parts.length >= 3) {
            return {
                album: parts[parts.length - 2],
                artist: ""
            };
        }
        return { artist: "", album: "" };
    }

    // Helper: Manual fallback generator
    function generateFallbackMetadata(file) {
        const pathInfo = parseRelativePath(file.webkitRelativePath);
        const fileInfo = parseFilename(file.name);

        return {
            file: file,
            src: URL.createObjectURL(file),
            title: fileInfo.title || file.name,
            artist: fileInfo.artist || pathInfo.artist || "Unknown Artist",
            album: pathInfo.album || "Unknown Album",
            year: "",
            cover: DEFAULT_COVER
        };
    }

    // ==========================================
    // 8. DATA LIBRARY BUILDERS & GROUPERS
    // ==========================================
    function getSongAlbumKey(song) {
        if (song.path) {
            // Server song: get directory from path
            const lastSlash = Math.max(song.path.lastIndexOf('/'), song.path.lastIndexOf('\\'));
            if (lastSlash !== -1) {
                return song.path.substring(0, lastSlash).toLowerCase();
            }
            return song.album.toLowerCase();
        } else if (song.file && song.file.webkitRelativePath) {
            // Client file: get directory from webkitRelativePath
            const lastSlash = song.file.webkitRelativePath.lastIndexOf('/');
            if (lastSlash !== -1) {
                return song.file.webkitRelativePath.substring(0, lastSlash).toLowerCase();
            }
            return song.album.toLowerCase();
        }
        return song.album.toLowerCase();
    }

    function buildLibraries() {
        const albumsMap = {};
        const artistsMap = {};

        allSongs.forEach((song, idx) => {
            // Store reference index in allSongs for global queue control
            song.globalIndex = idx;

            // Group by Album (using directory path or fallback title)
            const albumKey = getSongAlbumKey(song);
            song.albumKey = albumKey;
            
            if (!albumsMap[albumKey]) {
                albumsMap[albumKey] = {
                    albumKey: albumKey,
                    title: song.album || "Unknown Album",
                    artist: song.artist || "Unknown Artist",
                    year: song.year || "",
                    cover: song.cover !== DEFAULT_COVER ? song.cover : "",
                    tracks: []
                };
            }
            albumsMap[albumKey].tracks.push(song);

            // Group by Artist
            const artistKey = song.artist ? song.artist.toLowerCase() : "unknown artist";
            if (!artistsMap[artistKey]) {
                artistsMap[artistKey] = {
                    artistKey: artistKey,
                    name: song.artist || "Unknown Artist",
                    tracks: []
                };
            }
            artistsMap[artistKey].tracks.push(song);
        });

        // Convert Maps to sorted arrays
        albums = Object.values(albumsMap).map(album => {
            // If it's a split/compilation album, set artist to "Various Artists"
            if (album.tracks.length > 0) {
                const firstArtist = album.tracks[0].artist;
                const allSameArtist = album.tracks.every(t => t.artist === firstArtist);
                if (!allSameArtist) {
                    album.artist = "Various Artists";
                }
            }

            // If album has no custom cover, find the first track that does
            if (!album.cover) {
                const coverTrack = album.tracks.find(t => t.cover !== DEFAULT_COVER);
                album.cover = coverTrack ? coverTrack.cover : DEFAULT_COVER;
            }
            return album;
        }).sort((a, b) => a.title.localeCompare(b.title));

        artists = Object.values(artistsMap).sort((a, b) => a.name.localeCompare(b.name));
    }

    // ==========================================
    // 9. FUZZY SEARCH (FUSE.JS) INITIALIZATION
    // ==========================================
    function setupFuseSearch() {
        // Fuse instances depend on search category
        // Album Search:
        window.albumSearchFuse = new Fuse(albums, {
            keys: ['title', 'artist'],
            threshold: 0.45,
            keysWeight: { title: 0.7, artist: 0.3 }
        });

        // Artist Search:
        window.artistSearchFuse = new Fuse(artists, {
            keys: ['name'],
            threshold: 0.45
        });

        // Songs Search:
        window.songSearchFuse = new Fuse(allSongs, {
            keys: ['title', 'artist', 'album'],
            threshold: 0.45,
            keysWeight: { title: 0.6, artist: 0.3, album: 0.1 }
        });
    }

    // ==========================================
    // 10. RENDERING & UI EVENT HANDLERS
    // ==========================================
    const searchTypeDropdown = document.getElementById('search-type-dropdown');
    const selectedTypeText = document.getElementById('selected-type-text');
    const dropdownOptionsList = document.getElementById('dropdown-options-list');
    const searchInput = document.getElementById('search-input');

    // Toggle Dropdown List
    searchTypeDropdown.addEventListener('click', (e) => {
        e.stopPropagation();
        searchTypeDropdown.classList.toggle('open');
    });

    document.addEventListener('click', () => {
        searchTypeDropdown.classList.remove('open');
    });

    // Dropdown Option Select
    document.querySelectorAll('.dropdown-option').forEach(option => {
        option.addEventListener('click', (e) => {
            e.stopPropagation();
            const val = option.getAttribute('data-value');
            searchType = val;
            selectedTypeText.textContent = `▼ ${option.textContent}`;
            searchTypeDropdown.classList.remove('open');
            searchInput.placeholder = `Search by ${option.textContent.toLowerCase()}...`;
            
            // Clear search field and refresh panel
            searchInput.value = "";
            renderLibraryPanel();
        });
    });

    // Real-time Fuzzy Search
    searchInput.addEventListener('input', () => {
        renderLibraryPanel();
    });

    // Render left library panel (Fuzzy filtered if searchInput has value)
    function renderLibraryPanel() {
        const query = searchInput.value.trim();
        searchResults.innerHTML = "";

        if (allSongs.length === 0) {
            searchResults.innerHTML = `
                <div class="empty-state">
                    <i class="fa-solid fa-music"></i>
                    <p>No folder loaded yet</p>
                    <span>Go to SETTINGS to configure music folders on the server.</span>
                </div>
            `;
            return;
        }

        activeResults = [];
        renderedResultsCount = 0;

        if (searchType === 'album') {
            let filteredAlbums = albums;
            if (query && window.albumSearchFuse) {
                const results = window.albumSearchFuse.search(query);
                filteredAlbums = results.map(r => r.item);
            }
            activeResults = filteredAlbums;
        } else if (searchType === 'artist') {
            let filteredArtists = artists;
            if (query && window.artistSearchFuse) {
                const results = window.artistSearchFuse.search(query);
                filteredArtists = results.map(r => r.item);
            }
            activeResults = filteredArtists;
        } else if (searchType === 'song') {
            let filteredSongs = allSongs;
            if (query && window.songSearchFuse) {
                const results = window.songSearchFuse.search(query);
                filteredSongs = results.map(r => r.item);
            }
            activeResults = filteredSongs;
        }

        if (activeResults.length === 0) {
            renderNoResults();
            return;
        }

        // Render first batch
        appendMoreResults();
    }

    function appendMoreResults() {
        if (renderedResultsCount >= activeResults.length) return;

        const nextBatch = activeResults.slice(renderedResultsCount, renderedResultsCount + RESULTS_BATCH_SIZE);
        
        nextBatch.forEach(item => {
            const div = document.createElement('div');
            div.className = 'result-item';

            if (searchType === 'album') {
                div.innerHTML = `
                    <div class="result-img-wrapper">
                        <img src="${item.cover || DEFAULT_COVER}" class="result-img" alt="${item.title}">
                    </div>
                    <div class="result-info">
                        <div class="result-title">${item.title}</div>
                        <div class="result-subtitle">${item.artist} • ${item.tracks.length} tracks</div>
                    </div>
                `;
                div.addEventListener('click', () => {
                    document.querySelectorAll('.result-item').forEach(el => el.classList.remove('active'));
                    div.classList.add('active');
                    selectAlbum(item.albumKey);
                });
            } else if (searchType === 'artist') {
                const artistCover = item.tracks[0]?.cover || DEFAULT_COVER;
                div.innerHTML = `
                    <div class="result-img-wrapper" style="border-radius: 50%;">
                        <img src="${artistCover}" class="result-img" alt="${item.name}">
                    </div>
                    <div class="result-info">
                        <div class="result-title">${item.name}</div>
                        <div class="result-subtitle">${item.tracks.length} songs</div>
                    </div>
                `;
                div.addEventListener('click', () => {
                    document.querySelectorAll('.result-item').forEach(el => el.classList.remove('active'));
                    div.classList.add('active');
                    selectArtist(item.artistKey);
                });
            } else if (searchType === 'song') {
                if (currentlyPlayingIndex === item.globalIndex) {
                    div.classList.add('active');
                }
                div.innerHTML = `
                    <div class="result-img-wrapper">
                        <img src="${item.cover || DEFAULT_COVER}" class="result-img" alt="${item.title}">
                    </div>
                    <div class="result-info">
                        <div class="result-title">${item.title}</div>
                        <div class="result-subtitle">${item.artist} • ${item.album}</div>
                    </div>
                `;
                div.addEventListener('click', () => {
                    document.querySelectorAll('.result-item').forEach(el => el.classList.remove('active'));
                    div.classList.add('active');
                    const albumKey = item.albumKey;
                    selectAlbum(albumKey);

                    if (isShuffle) {
                        originalQueue = [...currentPlaylist];
                        const clickedIdx = currentPlaylist.findIndex(s => s.globalIndex === item.globalIndex);
                        const clickedSong = currentPlaylist[clickedIdx];
                        const remainingSongs = currentPlaylist.filter((_, idx) => idx !== clickedIdx);
                        shuffleArray(remainingSongs);
                        playQueue = [clickedSong, ...remainingSongs];
                        playQueueIndex = 0;
                    } else {
                        originalQueue = [];
                        playQueue = [...currentPlaylist];
                        playQueueIndex = playQueue.findIndex(s => s.globalIndex === item.globalIndex);
                    }
                    playTrack(item.globalIndex);
                });
            }

            searchResults.appendChild(div);
        });

        renderedResultsCount += nextBatch.length;
    }

    // Scroll listener for left results panel
    if (searchResults) {
        searchResults.addEventListener('scroll', () => {
            if (searchResults.scrollHeight - searchResults.scrollTop - searchResults.clientHeight < 60) {
                appendMoreResults();
            }
        });
    }

    function renderNoResults() {
        searchResults.innerHTML = `
            <div class="empty-state">
                <i class="fa-solid fa-magnifying-glass-blur"></i>
                <p>No matches found</p>
                <span>Try searching for something else or check spelling.</span>
            </div>
        `;
    }

    // Group Selection Helpers
    function selectAlbum(albumKey) {
        const album = albums.find(a => a.albumKey === albumKey);
        if (!album) return;

        // Reset cover border radius to default (rounded square)
        if (detailCover) detailCover.style.borderRadius = '';

        // Make artist clickable
        if (detailArtist) {
            detailArtist.classList.add('clickable-artist');
        }

        // Toggle visibility
        if (albumsGridContainer) albumsGridContainer.classList.add('hidden');
        if (songListContainer) songListContainer.classList.remove('hidden');

        currentPlaylist = [...album.tracks];
        renderPlaylistView(album.title, album.artist, album.year, album.cover);
    }

    function selectArtist(artistKey) {
        const artist = artists.find(a => a.artistKey === artistKey);
        if (!artist) return;

        // Group tracks by album to find unique albums
        const artistAlbums = [];
        const seenAlbums = new Set();
        artist.tracks.forEach(track => {
            const albumKey = track.albumKey;
            if (!seenAlbums.has(albumKey)) {
                seenAlbums.add(albumKey);
                const alb = albums.find(a => a.albumKey === albumKey);
                if (alb) {
                    artistAlbums.push(alb);
                }
            }
        });

        // Set artist header details
        detailTitle.textContent = artist.name;
        detailArtist.textContent = "Artist Profile";
        detailArtist.classList.remove('clickable-artist');
        const albumCount = artistAlbums.length;
        detailMeta.textContent = `${albumCount} Album${albumCount !== 1 ? 's' : ''} • ${artist.tracks.length} Song${artist.tracks.length !== 1 ? 's' : ''}`;
        const artistCover = artist.tracks[0]?.cover || DEFAULT_COVER;
        detailCover.src = artistCover;
        detailCover.style.borderRadius = '50%'; // circular cover for artist profiles

        // Toggle visibility
        if (songListContainer) songListContainer.classList.add('hidden');
        if (albumsGridContainer) albumsGridContainer.classList.remove('hidden');

        // Render Albums Grid
        albumsGridContainer.innerHTML = "";
        artistAlbums.forEach(album => {
            const card = document.createElement('div');
            card.className = 'grid-album-card';
            card.innerHTML = `
                <div class="grid-album-cover-wrapper">
                    <img src="${album.cover || DEFAULT_COVER}" class="grid-album-cover" alt="${album.title}">
                </div>
                <div class="grid-album-info">
                    <div class="grid-album-title">${album.title}</div>
                    <div class="grid-album-meta">${album.year ? album.year + ' • ' : ''}${album.tracks.length} tracks</div>
                </div>
            `;
            card.addEventListener('click', () => {
                selectAlbum(album.albumKey);
            });
            albumsGridContainer.appendChild(card);
        });
    }

    // Render right panel playlist
    const detailCover = document.getElementById('detail-cover');
    const detailTitle = document.getElementById('detail-title');
    const detailArtist = document.getElementById('detail-artist');
    const detailMeta = document.getElementById('detail-meta');
    const songListContainer = document.getElementById('song-list');
    const albumsGridContainer = document.getElementById('albums-grid');

    function renderPlaylistView(title, artist, metaText, coverUrl) {
        detailTitle.textContent = title;
        detailArtist.textContent = artist;
        detailMeta.textContent = metaText || "";
        detailCover.src = coverUrl || DEFAULT_COVER;

        songListContainer.innerHTML = "";
        renderedSongsCount = 0;

        if (currentPlaylist.length === 0) {
            songListContainer.innerHTML = `
                <div class="empty-playlist">
                    <p>No songs in this list</p>
                </div>
              `;
            return;
        }

        // Render first batch of songs
        appendMoreSongs();
    }

    function appendMoreSongs() {
        if (renderedSongsCount >= currentPlaylist.length) return;

        const nextBatch = currentPlaylist.slice(renderedSongsCount, renderedSongsCount + SONGS_BATCH_SIZE);

        nextBatch.forEach((song, batchIdx) => {
            const absoluteIdx = renderedSongsCount + batchIdx;
            const isTrackPlaying = (currentlyPlayingIndex === song.globalIndex);
            const songDiv = document.createElement('div');
            songDiv.className = `song-item ${isTrackPlaying ? 'playing' : ''}`;
            
            songDiv.innerHTML = `
                <div class="song-index">
                    <span class="song-index-num">${absoluteIdx + 1}</span>
                    <span class="song-index-play"><i class="fa-solid ${isTrackPlaying && isPlaying ? 'fa-volume-high' : 'fa-play'}"></i></span>
                </div>
                <div class="song-main-info">
                    <div class="song-title clickable-artist">${song.title}</div>
                    <div class="song-artist clickable-artist">${song.artist}</div>
                </div>
                <div class="song-album clickable-artist">${song.album}</div>
                <div class="song-duration" id="duration-${song.globalIndex}">--:--</div>
            `;

            // Play track on click, but NOT if clicking the artist/album/title links!
            songDiv.addEventListener('click', (e) => {
                if (e.target.classList.contains('clickable-artist')) return;
                
                if (isShuffle) {
                    originalQueue = [...currentPlaylist];
                    const clickedSong = currentPlaylist[absoluteIdx];
                    const remainingSongs = currentPlaylist.filter((_, idx) => idx !== absoluteIdx);
                    shuffleArray(remainingSongs);
                    playQueue = [clickedSong, ...remainingSongs];
                    playQueueIndex = 0;
                } else {
                    originalQueue = [];
                    playQueue = [...currentPlaylist];
                    playQueueIndex = absoluteIdx;
                }
                playTrack(song.globalIndex);
            });

            // Bind click for artist link
            const artistEl = songDiv.querySelector('.song-artist');
            if (artistEl) {
                artistEl.addEventListener('click', (e) => {
                    e.stopPropagation();
                    selectArtistByName(song.artist);
                });
            }

            // Bind click for title link to see the album
            const titleEl = songDiv.querySelector('.song-title');
            if (titleEl) {
                titleEl.addEventListener('click', (e) => {
                    e.stopPropagation();
                    selectAlbumByNameAndArtist(song.album, song.artist, song.albumKey);
                });
            }

            // Bind click for album link to see the album
            const albumEl = songDiv.querySelector('.song-album');
            if (albumEl) {
                albumEl.addEventListener('click', (e) => {
                    e.stopPropagation();
                    selectAlbumByNameAndArtist(song.album, song.artist, song.albumKey);
                });
            }

            songListContainer.appendChild(songDiv);
            fetchAudioDuration(song);
        });

        renderedSongsCount += nextBatch.length;
    }

    // Scroll listener for right songs playlist
    if (songListContainer) {
        songListContainer.addEventListener('scroll', () => {
            if (songListContainer.scrollHeight - songListContainer.scrollTop - songListContainer.clientHeight < 60) {
                appendMoreSongs();
            }
        });
    }

    // Background duration fetch to prevent tags reading latency
    const durationCache = {};
    function fetchAudioDuration(song) {
        const id = `duration-${song.globalIndex}`;
        const cached = durationCache[song.src];
        if (cached) {
            const el = document.getElementById(id);
            if (el) el.textContent = cached;
            return;
        }

        const tempAudio = new Audio(song.src);
        tempAudio.addEventListener('loadedmetadata', () => {
            const formatted = formatTime(tempAudio.duration);
            durationCache[song.src] = formatted;
            const el = document.getElementById(id);
            if (el) el.textContent = formatted;
            // Unload
            tempAudio.src = "";
            tempAudio.load();
        });
    }

    // ==========================================
    // 11. AUDIO CONTROLS & EVENT BINDINGS
    // ==========================================

    function playTrack(globalIdx) {
        if (globalIdx < 0 || globalIdx >= allSongs.length) return;

        currentlyPlayingIndex = globalIdx;

        // Ensure playQueue and index are in sync with what is being played
        if (playQueue.length === 0 || !playQueue.some(s => s.globalIndex === globalIdx)) {
            const baseQueue = currentPlaylist.length > 0 && currentPlaylist.some(s => s.globalIndex === globalIdx)
                ? [...currentPlaylist]
                : [...allSongs];

            if (isShuffle) {
                originalQueue = [...baseQueue];
                const clickedIdx = baseQueue.findIndex(s => s.globalIndex === globalIdx);
                const clickedSong = baseQueue[clickedIdx];
                const remainingSongs = baseQueue.filter((_, idx) => idx !== clickedIdx);
                shuffleArray(remainingSongs);
                playQueue = [clickedSong, ...remainingSongs];
                playQueueIndex = 0;
            } else {
                originalQueue = [];
                playQueue = [...baseQueue];
                playQueueIndex = playQueue.findIndex(s => s.globalIndex === globalIdx);
            }
        } else {
            playQueueIndex = playQueue.findIndex(s => s.globalIndex === globalIdx);
        }

        const song = allSongs[currentlyPlayingIndex];

        // Init audio context on user action
        initAudioContext();
        if (audioContext && audioContext.state === 'suspended') {
            audioContext.resume();
        }

        // Set source and play
        bgAudio.src = song.src;
        bgAudio.load();

        // Update Dynamic Island Details
        document.getElementById('mini-track-title').textContent = song.title;
        document.getElementById('mini-cover').src = song.cover || DEFAULT_COVER;
        document.getElementById('track-cover').src = song.cover || DEFAULT_COVER;
        document.getElementById('track-title').textContent = song.title;
        document.getElementById('track-artist').textContent = song.artist;

        // Reset progress slider
        progressSlider.value = 0;
        progressSlider.style.setProperty('--value', '0%');

        // Update Dynamic Island Queue
        if (typeof updateIslandQueue === 'function') {
            updateIslandQueue();
        }

        bgAudio.play().then(() => {
            isPlaying = true;
            playIcon.className = 'fa-solid fa-pause';
            setCoverAnimationState(true);
            
            // Re-render views to highlight currently playing item
            updateHighlighting();
        }).catch(err => {
            if (err.name === 'AbortError') {
                console.log("Playback aborted (normal when switching tracks rapidly).");
                return;
            }
            console.error("Audio playback error:", err);
            isPlaying = false;
            playIcon.className = 'fa-solid fa-play';
            setCoverAnimationState(false);
            updateHighlighting();
        });
    }

    function updateHighlighting() {
        // Highlight in left side panel if search results contain it
        const resultItems = document.querySelectorAll('.result-item');
        if (searchType === 'song') {
            renderLibraryPanel();
        }

        // Highlight in right playlist
        const songItems = document.querySelectorAll('.song-item');
        currentPlaylist.forEach((song, idx) => {
            const isPlayingSong = (song.globalIndex === currentlyPlayingIndex);
            const itemEl = songItems[idx];
            if (itemEl) {
                const iconEl = itemEl.querySelector('.song-index-play i');
                if (isPlayingSong) {
                    itemEl.classList.add('playing');
                    if (iconEl) {
                        iconEl.className = isPlaying ? 'fa-solid fa-volume-high' : 'fa-solid fa-play';
                    }
                } else {
                    itemEl.classList.remove('playing');
                    if (iconEl) {
                        iconEl.className = 'fa-solid fa-play';
                    }
                }
            }
        });
    }

    // Playback Toggle Click
    playBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        
        if (allSongs.length === 0) return;

        if (currentlyPlayingIndex === -1) {
            // Play first song
            playTrack(0);
            return;
        }

        initAudioContext();
        if (audioContext && audioContext.state === 'suspended') {
            audioContext.resume();
        }

        if (isPlaying) {
            bgAudio.pause();
            playIcon.className = 'fa-solid fa-play';
            setCoverAnimationState(false);
            isPlaying = false;
        } else {
            bgAudio.play().then(() => {
                playIcon.className = 'fa-solid fa-pause';
                setCoverAnimationState(true);
                isPlaying = true;
            }).catch(e => console.log(e));
        }
        updateHighlighting();
    });

    // Mute controls
    let lastVolume = 0.5;
    function setVolume(val) {
        bgAudio.volume = val;
        volumeSlider.value = val;
        volumeSlider.style.setProperty('--value', `${val * 100}%`);
        localStorage.setItem('moonplayer_volume', val);

        if (val === 0) {
            muteIcon.className = 'fa-solid fa-volume-xmark fa-fw';
        } else if (val <= 0.33) {
            muteIcon.className = 'fa-solid fa-volume-off fa-fw';
        } else if (val <= 0.66) {
            muteIcon.className = 'fa-solid fa-volume-low fa-fw';
        } else {
            muteIcon.className = 'fa-solid fa-volume-high fa-fw';
        }
    }

    // Restore saved volume
    const savedVolume = localStorage.getItem('moonplayer_volume');
    if (savedVolume !== null) {
        setVolume(parseFloat(savedVolume));
    } else {
        setVolume(0.5);
    }

    volumeSlider.addEventListener('input', (e) => {
        setVolume(parseFloat(e.target.value));
    });

    muteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (bgAudio.volume > 0) {
            lastVolume = bgAudio.volume;
            setVolume(0);
        } else {
            setVolume(lastVolume || 0.5);
        }
    });

    // Shuffle & Loop toggles
    shuffleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        isShuffle = !isShuffle;
        shuffleBtn.classList.toggle('active', isShuffle);

        if (playQueue.length === 0) return;

        if (isShuffle) {
            // Turning Shuffle ON: save original order and shuffle the rest
            originalQueue = [...playQueue];
            const currentSong = playQueue[playQueueIndex];
            
            // Shuffle all songs in playQueue
            const remainingSongs = playQueue.filter((_, idx) => idx !== playQueueIndex);
            shuffleArray(remainingSongs);

            // Shuffled queue starts with currently playing song, followed by the rest
            playQueue = [currentSong, ...remainingSongs];
            playQueueIndex = 0;
        } else {
            // Turning Shuffle OFF: restore original order and find current song index
            if (originalQueue.length > 0) {
                const currentSong = playQueue[playQueueIndex];
                playQueue = [...originalQueue];
                playQueueIndex = playQueue.findIndex(s => s.globalIndex === currentSong.globalIndex);
            }
        }
        updateIslandQueue();
    });

    function shuffleArray(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
    }

    loopBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (isLoop === 'none') {
            isLoop = 'all';
            loopBtn.classList.add('active');
            loopBtn.innerHTML = '<i class="fa-solid fa-repeat"></i>';
        } else if (isLoop === 'all') {
            isLoop = 'one';
            loopBtn.classList.add('active');
            loopBtn.style.position = 'relative';
            loopBtn.innerHTML = '<i class="fa-solid fa-repeat"></i><span class="loop-one-badge" style="font-size: 8px; font-weight: 700; position: absolute; top: -1px; right: -1px; background: var(--accent); color: #000000; border-radius: 50%; width: 11px; height: 11px; display: flex; align-items: center; justify-content: center; border: 1px solid #000000; transform: scale(0.95);">1</span>';
        } else {
            isLoop = 'none';
            loopBtn.classList.remove('active');
            loopBtn.innerHTML = '<i class="fa-solid fa-repeat"></i>';
        }
    });

    // Prev / Next logic
    function handleNext() {
        if (playQueue.length === 0) return;

        if (isLoop === 'all') {
            playQueueIndex = (playQueueIndex + 1) % playQueue.length;
        } else {
            if (playQueueIndex >= playQueue.length - 1) {
                bgAudio.currentTime = 0;
                isPlaying = false;
                playIcon.className = 'fa-solid fa-play';
                setCoverAnimationState(false);
                return;
            }
            playQueueIndex = playQueueIndex + 1;
        }

        const nextSong = playQueue[playQueueIndex];
        if (nextSong) {
            playTrack(nextSong.globalIndex);
        }
    }

    function handlePrev() {
        if (playQueue.length === 0) return;
        
        if (isLoop === 'all') {
            playQueueIndex = (playQueueIndex - 1 + playQueue.length) % playQueue.length;
        } else {
            if (playQueueIndex <= 0) {
                playQueueIndex = 0;
            } else {
                playQueueIndex = playQueueIndex - 1;
            }
        }

        const prevSong = playQueue[playQueueIndex];
        if (prevSong) {
            playTrack(prevSong.globalIndex);
        }
    }

    nextBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        handleNext();
    });

    prevBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        handlePrev();
    });

    // Audio element metadata & time update hooks
    bgAudio.addEventListener('ended', () => {
        if (isLoop === 'one') {
            bgAudio.currentTime = 0;
            bgAudio.play().then(() => {
                setCoverAnimationState(true);
            }).catch(e => console.log(e));
        } else {
            handleNext();
        }
    });

    bgAudio.addEventListener('loadedmetadata', () => {
        totalTimeEl.textContent = formatTime(bgAudio.duration);
    });

    bgAudio.addEventListener('timeupdate', () => {
        const current = bgAudio.currentTime;
        const duration = bgAudio.duration;
        currentTimeEl.textContent = formatTime(current);

        if (duration > 0) {
            const percent = (current / duration) * 100;
            progressSlider.value = percent;
            progressSlider.style.setProperty('--value', `${percent}%`);
        }
    });

    progressSlider.addEventListener('input', (e) => {
        if (!bgAudio.duration) return;
        const pct = parseFloat(e.target.value);
        bgAudio.currentTime = (pct / 100) * bgAudio.duration;
        progressSlider.style.setProperty('--value', `${pct}%`);
    });

    // Time formatting helper
    function formatTime(seconds) {
        if (isNaN(seconds)) return "00:00";
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }

    // Clean initial state (no files loaded)
    renderLibraryPanel();

    // Helper: Select album by name & artist
    function selectAlbumByNameAndArtist(albumName, artistName, albumKey) {
        if (albumKey) {
            selectAlbum(albumKey);
            return;
        }
        if (!albumName || albumName === 'Unknown Album' || albumName === 'Artist Profile') return;
        const key = `${albumName.toLowerCase()}_${artistName.toLowerCase()}`;
        selectAlbum(key);
    }

    // Helper: Select artist and navigate to their profile (album grid)
    function selectArtistByName(artistName) {
        if (!artistName || artistName === 'Unknown Artist' || artistName === 'Artist Profile') return;
        const artistKey = artistName.toLowerCase();
        const artist = artists.find(a => a.artistKey === artistKey);
        if (artist) {
            // Highlight and switch search scope to Artist
            searchType = 'artist';
            selectedTypeText.textContent = '▼ Artist';
            searchInput.value = "";
            searchInput.placeholder = "Search by artist...";
            renderLibraryPanel();

            // Find and highlight this artist in the left list
            const resultItems = document.querySelectorAll('.result-item');
            resultItems.forEach(item => {
                const titleEl = item.querySelector('.result-title');
                if (titleEl && titleEl.textContent.toLowerCase() === artistName.toLowerCase()) {
                    item.classList.add('active');
                    item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }
            });

            // Trigger right panel grid render
            selectArtist(artist.artistKey);

            // Collapse expanded dynamic island if open
            if (dynamicIsland) {
                dynamicIsland.classList.remove('expanded');
                dynamicIsland.classList.remove('locked');
            }
        }
    }

    // Dynamic Island queue toggler and builder
    const islandQueueBtn = document.getElementById('island-queue-btn');
    if (islandQueueBtn && dynamicIsland) {
        islandQueueBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            dynamicIsland.classList.toggle('queue-expanded');
            if (dynamicIsland.classList.contains('queue-expanded')) {
                updateIslandQueue();
            }
        });
    }

    function updateIslandQueue() {
        const queueListEl = document.getElementById('island-queue-list');
        if (!queueListEl) return;

        queueListEl.innerHTML = "";
        const activeQueue = currentPlaylist.length > 0 ? currentPlaylist : allSongs;
        const currentIdxInQueue = activeQueue.findIndex(s => s.globalIndex === currentlyPlayingIndex);
        
        const upcoming = activeQueue.slice(currentIdxInQueue + 1, currentIdxInQueue + 7);
        if (upcoming.length === 0) {
            queueListEl.innerHTML = `<div style="font-size: 0.65rem; color: var(--text-secondary); text-align: center; margin-top: 25px; font-weight: 500; letter-spacing: 0.05em;">No upcoming tracks</div>`;
            return;
        }

        upcoming.forEach(song => {
            const itemDiv = document.createElement('div');
            itemDiv.className = 'queue-item';
            itemDiv.innerHTML = `
                <span class="queue-item-title">${song.title}</span>
                <span class="queue-item-artist">${song.artist}</span>
            `;
            itemDiv.addEventListener('click', (e) => {
                e.stopPropagation();
                playTrack(song.globalIndex);
            });
            queueListEl.appendChild(itemDiv);
        });
    }

    // Bind click event on the right header artist name
    if (detailArtist) {
        detailArtist.addEventListener('click', () => {
            if (detailArtist.classList.contains('clickable-artist')) {
                selectArtistByName(detailArtist.textContent);
            }
        });
    }

    // Bind click event on the Dynamic Island expanded artist name
    const trackArtistEl = document.getElementById('track-artist');
    if (trackArtistEl) {
        trackArtistEl.addEventListener('click', (e) => {
            e.stopPropagation();
            const currentTrack = allSongs[currentlyPlayingIndex];
            if (currentTrack) {
                selectArtistByName(currentTrack.artist);
            }
        });
    }

    // Bind click event on the Dynamic Island expanded song title
    const trackTitleEl = document.getElementById('track-title');
    if (trackTitleEl) {
        trackTitleEl.classList.add('clickable-artist');
        trackTitleEl.addEventListener('click', (e) => {
            e.stopPropagation();
            const currentTrack = allSongs[currentlyPlayingIndex];
            if (currentTrack) {
                const albumKey = currentTrack.albumKey;
                selectAlbum(albumKey);
            }
        });
    }

    // ==========================================
    // 12. SETTINGS MODAL & ACCENT COLOR EVENT BINDINGS
    // ==========================================
    const settingsBtn = document.getElementById('settings-btn');
    const settingsModal = document.getElementById('settings-modal');
    const closeSettingsBtn = document.getElementById('close-settings-btn');
    const toggleTiltCheckbox = document.getElementById('toggle-tilt');
    const toggleGlowCheckbox = document.getElementById('toggle-glow');
    const colorOptions = document.querySelectorAll('.color-option');
    const customColorPicker = document.getElementById('custom-color-picker');
    const colorPickerWrapper = document.querySelector('.color-picker-wrapper');

    // Initialize toggle states in UI
    if (toggleTiltCheckbox) toggleTiltCheckbox.checked = isTiltEnabled;
    if (toggleGlowCheckbox) toggleGlowCheckbox.checked = isGlowEnabled;

    // Show/Hide Modal
    if (settingsBtn && settingsModal) {
        settingsBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            settingsModal.classList.add('visible');
        });
    }

    if (closeSettingsBtn && settingsModal) {
        closeSettingsBtn.addEventListener('click', () => {
            settingsModal.classList.remove('visible');
        });
    }

    if (settingsModal) {
        settingsModal.addEventListener('click', (e) => {
            if (e.target === settingsModal) {
                settingsModal.classList.remove('visible');
            }
        });
        const settingsContent = settingsModal.querySelector('.settings-content');
        if (settingsContent) {
            settingsContent.addEventListener('click', (e) => {
                e.stopPropagation();
            });
        }
    }

    // Toggle Tilt
    if (toggleTiltCheckbox) {
        toggleTiltCheckbox.addEventListener('change', (e) => {
            isTiltEnabled = e.target.checked;
            localStorage.setItem('moonplayer_tilt', isTiltEnabled);
            if (!isTiltEnabled && playerCard) {
                playerCard.style.transform = 'perspective(1200px) rotateY(0deg) rotateX(0deg)';
            }
        });
    }

    // Toggle Glow
    if (toggleGlowCheckbox) {
        toggleGlowCheckbox.addEventListener('change', (e) => {
            isGlowEnabled = e.target.checked;
            localStorage.setItem('moonplayer_glow', isGlowEnabled);
            if (playerCard) {
                if (isGlowEnabled) {
                    playerCard.classList.remove('glow-disabled');
                } else {
                    playerCard.classList.add('glow-disabled');
                }
            }
        });
    }

    // Toggle Snow
    const toggleSnowCheckbox = document.getElementById('toggle-snow');
    if (toggleSnowCheckbox) {
        toggleSnowCheckbox.checked = isSnowEnabled;
        toggleSnowCheckbox.addEventListener('change', (e) => {
            toggleSnow(e.target.checked);
        });
    }

    function toggleSnow(enabled) {
        isSnowEnabled = enabled;
        localStorage.setItem('moonplayer_snow', enabled ? 'true' : 'false');
        if (!enabled) {
            if (snowContainer) snowContainer.innerHTML = "";
        } else {
            if (snowContainer) snowContainer.innerHTML = "";
            for (let i = 0; i < snowflakeCount; i++) {
                createSnowflake();
            }
        }
    }

    // Initialize color active state on load
    function highlightActiveColorOption(selectedColor) {
        let matched = false;
        colorOptions.forEach(opt => {
            const colorVal = opt.getAttribute('data-color');
            if (colorVal.toLowerCase() === selectedColor.toLowerCase()) {
                opt.classList.add('active');
                matched = true;
            } else {
                opt.classList.remove('active');
            }
        });

        if (colorPickerWrapper) {
            if (!matched) {
                colorPickerWrapper.classList.add('active');
                if (customColorPicker) customColorPicker.value = selectedColor;
            } else {
                colorPickerWrapper.classList.remove('active');
            }
        }
    }
    highlightActiveColorOption(accentColor);

    // Preset color option click
    colorOptions.forEach(option => {
        option.addEventListener('click', () => {
            const color = option.getAttribute('data-color');
            accentColor = color;
            localStorage.setItem('moonplayer_accent', color);
            updateAccentColor(color);
            highlightActiveColorOption(color);
        });
    });

    // Custom color picker input
    if (customColorPicker) {
        customColorPicker.addEventListener('input', (e) => {
            const color = e.target.value;
            accentColor = color;
            localStorage.setItem('moonplayer_accent', color);
            updateAccentColor(color);
            highlightActiveColorOption(color);
        });
    }

    // ==========================================
    // 13. INDEXEDDB FOR BG IMAGE STORAGE & SLIDERS
    // ==========================================
    const DB_NAME = 'MoonPlayerDB';
    const DB_VERSION = 2;
    const STORE_NAME = 'settings';
    const METADATA_STORE = 'songs_metadata';

    function getDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME);
                }
                if (!db.objectStoreNames.contains(METADATA_STORE)) {
                    db.createObjectStore(METADATA_STORE);
                }
            };
            request.onsuccess = (e) => resolve(e.target.result);
            request.onerror = (e) => reject(e.target.error);
        });
    }

    async function getCachedMetadata(path) {
        try {
            const db = await getDB();
            return new Promise((resolve, reject) => {
                const tx = db.transaction(METADATA_STORE, 'readonly');
                const store = tx.objectStore(METADATA_STORE);
                const request = store.get(path);
                request.onsuccess = (e) => resolve(e.target.result);
                request.onerror = (e) => reject(e.target.error);
            });
        } catch (err) {
            console.error("Failed to query IndexedDB metadata cache:", err);
            return null;
        }
    }

    async function cacheMetadata(path, metadata) {
        try {
            const db = await getDB();
            return new Promise((resolve, reject) => {
                const tx = db.transaction(METADATA_STORE, 'readwrite');
                const store = tx.objectStore(METADATA_STORE);
                const request = store.put(metadata, path);
                request.onsuccess = () => resolve();
                request.onerror = (e) => reject(e.target.error);
            });
        } catch (err) {
            console.error("Failed to write to IndexedDB metadata cache:", err);
        }
    }

    async function clearMetadataCache() {
        try {
            const db = await getDB();
            return new Promise((resolve, reject) => {
                const tx = db.transaction(METADATA_STORE, 'readwrite');
                const store = tx.objectStore(METADATA_STORE);
                const request = store.clear();
                request.onsuccess = () => resolve();
                request.onerror = (e) => reject(e.target.error);
            });
        } catch (err) {
            console.error("Failed to clear IndexedDB metadata cache:", err);
        }
    }

    async function saveBgImage(fileBlob) {
        const db = await getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            const request = store.put(fileBlob, 'bg_image');
            request.onsuccess = () => resolve();
            request.onerror = (e) => reject(e.target.error);
        });
    }

    async function loadBgImage() {
        const db = await getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const store = tx.objectStore(STORE_NAME);
            const request = store.get('bg_image');
            request.onsuccess = (e) => resolve(e.target.result);
            request.onerror = (e) => reject(e.target.error);
        });
    }

    async function removeBgImage() {
        const db = await getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            const request = store.delete('bg_image');
            request.onsuccess = () => resolve();
            request.onerror = (e) => reject(e.target.error);
        });
    }

    const customBgEl = document.getElementById('custom-bg');
    const bgUploadBtn = document.getElementById('bg-upload-btn');
    const bgRemoveBtn = document.getElementById('bg-remove-btn');
    const bgFileInput = document.getElementById('bg-file-input');
    const bgSlidersContainer = document.getElementById('bg-sliders-container');
    const bgOpacitySlider = document.getElementById('bg-opacity-slider');
    const bgBlurSlider = document.getElementById('bg-blur-slider');
    const bgOpacityVal = document.getElementById('bg-opacity-val');
    const bgBlurVal = document.getElementById('bg-blur-val');

    // Load background settings
    let bgOpacity = localStorage.getItem('moonplayer_bg_opacity') || '0.4';
    let bgBlur = localStorage.getItem('moonplayer_bg_blur') || '10';

    // Apply values to Sliders UI
    if (bgOpacitySlider) {
        bgOpacitySlider.value = bgOpacity;
        bgOpacitySlider.style.setProperty('--value', `${bgOpacity * 100}%`);
        if (bgOpacityVal) bgOpacityVal.textContent = `${Math.round(bgOpacity * 100)}%`;
    }
    if (bgBlurSlider) {
        bgBlurSlider.value = bgBlur;
        bgBlurSlider.style.setProperty('--value', `${(bgBlur / 40) * 100}%`);
        if (bgBlurVal) bgBlurVal.textContent = `${bgBlur}px`;
    }

    // Apply custom background image on load
    let currentBgObjectURL = null;
    async function initBgImage() {
        try {
            const imageBlob = await loadBgImage();
            if (imageBlob && customBgEl) {
                if (currentBgObjectURL) URL.revokeObjectURL(currentBgObjectURL);
                currentBgObjectURL = URL.createObjectURL(imageBlob);
                customBgEl.style.backgroundImage = `url('${currentBgObjectURL}')`;
                customBgEl.style.opacity = bgOpacity;
                customBgEl.style.filter = `blur(${bgBlur}px)`;
                
                if (bgRemoveBtn) bgRemoveBtn.classList.remove('hidden');
                if (bgSlidersContainer) bgSlidersContainer.classList.remove('hidden');
            }
        } catch (err) {
            console.error("Failed loading background from IndexedDB:", err);
        }
    }
    initBgImage();

    // Trigger file dialog
    if (bgUploadBtn && bgFileInput) {
        bgUploadBtn.addEventListener('click', () => {
            bgFileInput.click();
        });
    }

    // Handle background upload
    if (bgFileInput) {
        bgFileInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            try {
                await saveBgImage(file);

                if (currentBgObjectURL) URL.revokeObjectURL(currentBgObjectURL);
                currentBgObjectURL = URL.createObjectURL(file);
                
                if (customBgEl) {
                    customBgEl.style.backgroundImage = `url('${currentBgObjectURL}')`;
                    customBgEl.style.opacity = bgOpacity;
                    customBgEl.style.filter = `blur(${bgBlur}px)`;
                }

                if (bgRemoveBtn) bgRemoveBtn.classList.remove('hidden');
                if (bgSlidersContainer) bgSlidersContainer.classList.remove('hidden');

            } catch (err) {
                console.error("Failed saving background image:", err);
                alert("Could not load image: " + err.message);
            }
        });
    }

    // Remove background image
    if (bgRemoveBtn) {
        bgRemoveBtn.addEventListener('click', async () => {
            try {
                await removeBgImage();
                if (currentBgObjectURL) {
                    URL.revokeObjectURL(currentBgObjectURL);
                    currentBgObjectURL = null;
                }
                if (customBgEl) {
                    customBgEl.style.backgroundImage = 'none';
                    customBgEl.style.opacity = '0';
                }
                if (bgRemoveBtn) bgRemoveBtn.classList.add('hidden');
                if (bgSlidersContainer) bgSlidersContainer.classList.add('hidden');
            } catch (err) {
                console.error("Failed removing background image:", err);
            }
        });
    }

    // Opacity Slider Change
    if (bgOpacitySlider) {
        bgOpacitySlider.addEventListener('input', (e) => {
            const val = e.target.value;
            bgOpacity = val;
            localStorage.setItem('moonplayer_bg_opacity', val);
            
            if (customBgEl && customBgEl.style.backgroundImage !== 'none') {
                customBgEl.style.opacity = val;
            }
            if (bgOpacityVal) bgOpacityVal.textContent = `${Math.round(val * 100)}%`;
            bgOpacitySlider.style.setProperty('--value', `${val * 100}%`);
        });
    }

    // Blur Slider Change
    if (bgBlurSlider) {
        bgBlurSlider.addEventListener('input', (e) => {
            const val = e.target.value;
            bgBlur = val;
            localStorage.setItem('moonplayer_bg_blur', val);
            
            if (customBgEl && customBgEl.style.backgroundImage !== 'none') {
                customBgEl.style.filter = `blur(${val}px)`;
            }
            if (bgBlurVal) bgBlurVal.textContent = `${val}px`;
            bgBlurSlider.style.setProperty('--value', `${(val / 40) * 100}%`);
        });
    }

    // ==========================================
    // 14. SERVER MUSIC FOLDERS & AUTO-RESTORE
    // ==========================================
    const serverFolderPathInput = document.getElementById('server-folder-path');
    const addServerFolderBtn = document.getElementById('add-server-folder-btn');
    const serverFoldersList = document.getElementById('server-folders-list');
    const clearAllMusicBtn = document.getElementById('clear-all-music-btn');

    async function fetchServerFolders() {
        try {
            const res = await fetch('/api/folders');
            const folders = await res.json();
            renderServerFoldersList(folders);
            return folders;
        } catch (e) {
            console.error("Failed to fetch server folders:", e);
            return [];
        }
    }

    function renderServerFoldersList(folders) {
        if (!serverFoldersList) return;
        serverFoldersList.innerHTML = '';
        if (folders.length === 0) {
            serverFoldersList.innerHTML = '<span style="color: var(--text-secondary); font-size: 0.75rem; font-style: italic;">No server folders configured.</span>';
            return;
        }
        folders.forEach(folder => {
            const item = document.createElement('div');
            item.className = 'server-folder-item';
            item.style.display = 'flex';
            item.style.justifyContent = 'space-between';
            item.style.alignItems = 'center';
            item.style.background = 'rgba(255, 255, 255, 0.02)';
            item.style.border = '1px solid var(--card-border)';
            item.style.borderRadius = '8px';
            item.style.padding = '8px 12px';
            item.style.fontSize = '0.75rem';
            item.style.wordBreak = 'break-all';
            
            const nameSpan = document.createElement('span');
            nameSpan.textContent = folder;
            nameSpan.style.color = 'var(--text-primary)';
            nameSpan.style.marginRight = '8px';

            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'settings-action-btn delete-action';
            deleteBtn.style.padding = '4px 8px';
            deleteBtn.style.fontSize = '0.65rem';
            deleteBtn.style.minWidth = 'auto';
            deleteBtn.style.flex = '0';
            deleteBtn.style.marginTop = '0';
            deleteBtn.innerHTML = '<i class="fa-solid fa-trash-can"></i>';
            deleteBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                if (confirm(`Remove folder "${folder}"?`)) {
                    await removeServerFolder(folder);
                }
            });

            item.appendChild(nameSpan);
            item.appendChild(deleteBtn);
            serverFoldersList.appendChild(item);
        });
    }

    async function addServerFolder(path) {
        try {
            const res = await fetch('/api/folders', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ folderPath: path })
            });
            const data = await res.json();
            if (data.error) {
                alert("Error: " + data.error);
            } else {
                if (serverFolderPathInput) serverFolderPathInput.value = '';
                renderServerFoldersList(data.folders);
                await reloadLibraryFromServer();
            }
        } catch (e) {
            console.error("Failed to add server folder:", e);
            alert("Failed to add folder: " + e.message);
        }
    }

    async function removeServerFolder(path) {
        try {
            const res = await fetch(`/api/folders?folderPath=${encodeURIComponent(path)}`, {
                method: 'DELETE'
            });
            const data = await res.json();
            if (data.error) {
                alert("Error: " + data.error);
            } else {
                renderServerFoldersList(data.folders);
                await reloadLibraryFromServer();
            }
        } catch (e) {
            console.error("Failed to remove server folder:", e);
        }
    }

    function parseServerSongMetadata(song) {
        return new Promise((resolve) => {
            const timeoutId = setTimeout(() => {
                resolve(generateServerFallbackMetadata(song));
            }, 5000);

            const absoluteUrl = window.location.origin + song.url;
            window.jsmediatags.read(absoluteUrl, {
                onSuccess: function (tag) {
                    clearTimeout(timeoutId);
                    
                    const tags = tag.tags || {};
                    let title = tags.title ? tags.title.trim() : "";
                    let artist = tags.artist ? tags.artist.trim() : "";
                    let album = tags.album ? tags.album.trim() : "";
                    let year = tags.year ? String(tags.year).trim() : "";
                    let cover = DEFAULT_COVER;

                    if (!title) {
                        const filenameInfo = parseFilename(song.name);
                        title = filenameInfo.title;
                        if (!artist) artist = filenameInfo.artist;
                    }

                    if (!artist) {
                        const pathInfo = parseRelativePath(song.path);
                        artist = pathInfo.artist || "Unknown Artist";
                    }

                    if (!album) {
                        const pathInfo = parseRelativePath(song.path);
                        album = pathInfo.album || "Unknown Album";
                    }

                    if (tags.picture) {
                        try {
                            const pic = tags.picture;
                            const bytes = new Uint8Array(pic.data);
                            let binary = "";
                            const len = bytes.byteLength;
                            const chunk = 8192;
                            for (let i = 0; i < len; i += chunk) {
                                binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
                            }
                            cover = `data:${pic.format};base64,${window.btoa(binary)}`;
                        } catch (imgErr) {
                            console.error("Error reading cover art:", imgErr);
                        }
                    }

                    resolve({
                        path: song.path,
                        src: song.url,
                        title: title || song.name,
                        artist: artist,
                        album: album,
                        year: year,
                        cover: cover
                    });
                },
                onError: function (err) {
                    clearTimeout(timeoutId);
                    console.warn("jsmediatags failed on:", song.url, err);
                    resolve(generateServerFallbackMetadata(song));
                }
            });
        });
    }

    function generateServerFallbackMetadata(song) {
        const pathInfo = parseRelativePath(song.path);
        const fileInfo = parseFilename(song.name);

        return {
            path: song.path,
            src: song.url,
            title: fileInfo.title || song.name,
            artist: fileInfo.artist || pathInfo.artist || "Unknown Artist",
            album: pathInfo.album || "Unknown Album",
            year: "",
            cover: DEFAULT_COVER
        };
    }

    async function reloadLibraryFromServer() {
        try {
            searchResults.innerHTML = `
                <div class="empty-state">
                    <i class="fa-solid fa-spinner fa-spin"></i>
                    <p>Scanning Server Folders...</p>
                    <span id="scan-progress">Fetching track list...</span>
                </div>
            `;

            const res = await fetch('/api/songs');
            const songs = await res.json();

            if (songs.length === 0) {
                allSongs = [];
                buildLibraries();
                setupFuseSearch();
                renderLibraryPanel();
                searchResults.innerHTML = `
                    <div class="empty-state">
                        <i class="fa-solid fa-music"></i>
                        <p>No music found</p>
                        <span>Add server music folders in settings to load your library.</span>
                    </div>
                `;
                const songList = document.getElementById('song-list');
                if (songList) {
                    songList.innerHTML = `
                        <div class="empty-playlist">
                            <p>Load directories to display tracks here</p>
                        </div>
                    `;
                }
                const detailTitle = document.getElementById('detail-title');
                const detailArtist = document.getElementById('detail-artist');
                const detailMeta = document.getElementById('detail-meta');
                if (detailTitle) detailTitle.textContent = "Welcome to MoonPlayer";
                if (detailArtist) detailArtist.textContent = "Load your offline music files";
                if (detailMeta) detailMeta.textContent = "Select a folder to start indexing tracks";
                return;
            }

            searchResults.innerHTML = `
                <div class="empty-state">
                    <i class="fa-solid fa-spinner fa-spin"></i>
                    <p>Processing Library...</p>
                    <span id="scan-progress">Processed: 0 / ${songs.length} files</span>
                </div>
            `;

            allSongs = [];
            let processedCount = 0;
            const progressSpan = document.getElementById('scan-progress');
            const concurrency = 6;

            const processServerSong = async (song) => {
                try {
                    let cached = await getCachedMetadata(song.path);
                    if (cached) {
                        allSongs.push(cached);
                    } else {
                        const metadata = await parseServerSongMetadata(song);
                        allSongs.push(metadata);
                        await cacheMetadata(song.path, metadata);
                    }
                } catch (err) {
                    console.error("Failed processing server metadata, using fallback:", song.name, err);
                    const fallback = generateServerFallbackMetadata(song);
                    allSongs.push(fallback);
                } finally {
                    processedCount++;
                    if (progressSpan) {
                        progressSpan.textContent = `Processed: ${processedCount} / ${songs.length} files`;
                    }
                }
            };

            for (let i = 0; i < songs.length; i += concurrency) {
                const batch = songs.slice(i, i + concurrency);
                await Promise.all(batch.map(song => processServerSong(song)));
            }

            buildLibraries();
            setupFuseSearch();
            renderLibraryPanel();

            if (albums.length > 0) {
                selectAlbum(albums[0].albumKey);
            } else if (allSongs.length > 0) {
                currentPlaylist = [...allSongs];
                renderPlaylistView("All Tracks", "Indexed Server Audio", "Various", null);
            }
        } catch (e) {
            console.error("Failed to load library from server:", e);
            searchResults.innerHTML = `
                <div class="empty-state">
                    <i class="fa-solid fa-circle-exclamation"></i>
                    <p>Failed to scan server folders</p>
                    <span>Check your connection or settings.</span>
                </div>
            `;
        }
    }

    // Set up add server folder event handlers
    if (addServerFolderBtn && serverFolderPathInput) {
        addServerFolderBtn.addEventListener('click', async () => {
            const folderPath = serverFolderPathInput.value.trim();
            if (!folderPath) {
                alert("Please enter a folder path.");
                return;
            }
            await addServerFolder(folderPath);
        });

        serverFolderPathInput.addEventListener('keydown', async (e) => {
            if (e.key === 'Enter') {
                const folderPath = serverFolderPathInput.value.trim();
                if (!folderPath) return;
                await addServerFolder(folderPath);
            }
        });
    }

    // Set up clear all music button handler
    if (clearAllMusicBtn) {
        clearAllMusicBtn.addEventListener('click', async () => {
            if (confirm("Are you sure you want to clear all music? This will remove all server folders and reset the library cache.")) {
                try {
                    await fetch('/api/folders/clear', { method: 'POST' });
                    await clearMetadataCache();
                    allSongs = [];
                    albums = [];
                    artists = [];
                    currentPlaylist = [];
                    currentlyPlayingIndex = -1;
                    
                    if (serverFoldersList) {
                        serverFoldersList.innerHTML = '<span style="color: var(--text-secondary); font-size: 0.75rem; font-style: italic;">No server folders configured.</span>';
                    }
                    
                    buildLibraries();
                    setupFuseSearch();
                    renderLibraryPanel();

                    const songList = document.getElementById('song-list');
                    if (songList) {
                        songList.innerHTML = `
                            <div class="empty-playlist">
                                <p>Load directories to display tracks here</p>
                            </div>
                        `;
                    }
                    const detailTitle = document.getElementById('detail-title');
                    const detailArtist = document.getElementById('detail-artist');
                    const detailMeta = document.getElementById('detail-meta');
                    if (detailTitle) detailTitle.textContent = "Welcome to MoonPlayer";
                    if (detailArtist) detailArtist.textContent = "Load your offline music files";
                    if (detailMeta) detailMeta.textContent = "Select a folder to start indexing tracks";
                    
                    alert("All music cleared successfully.");
                } catch (e) {
                    console.error("Failed to clear music:", e);
                    alert("Error clearing music: " + e.message);
                }
            }
        });
    }

    // Startup initialization
    async function initServerLibrary() {
        const folders = await fetchServerFolders();
        if (folders && folders.length > 0) {
            await reloadLibraryFromServer();
        }
    }
    initServerLibrary();
});
