/**
 * Riff UI Controller for MoonPlayer
 * Implements 1:1 Material Design 3 interface from Riff Player
 * Powered by MoonPlayer audio engine
 * License: MIT (Riff UI) / GPL-3.0 (MoonPlayer)
 */

(function () {
  'use strict';

  // State Management
  const state = {
    currentView: 'local',
    prevView: 'local',
    viewHistory: [],
    platform: 'local', // 'local', 'soundcloud'
    searchQuery: '',
    currentTrack: null,
    isPlaying: false,
    duration: 0,
    currentTime: 0,
    isShuffle: false,
    repeatMode: 'none', // 'none', 'all', 'one'
    volume: 0.5,
    isMuted: false,
    isLyricsOpen: false,
    isTvKaraokeOpen: false,
    isAudioModalOpen: false,
    isDrawerOpen: false,
    drawerTab: 'playlists',
    selectedPlaylist: null,
    selectedAlbum: null,
    selectedArtist: null,
    waveTracks: [],
    recentHistory: [],
    scrubberDragTime: null,
    lastActiveLyricIdx: -1,
    waveAmplitude: 0.0,
  };

  let el = {};
  let animFrameId = null;
  let scrubPhase = 0;
  let scrubProgress = 0;
  let scrubKnobAnim = 0;
  let scrubPrevKnobX = null;
  let scrubLastTime = 0;
  let isDraggingScrubber = false;

  // Artwork M3 morphing state
  const m3c = {
    canvas: null,
    ctx: null,
    img: new Image(),
    imgReady: false,
    currentThumb: null,
    currentShape: 0,
    nextShape: 1,
    morphProgress: 0,
    morphStartTime: 0,
    isMorphing: false,
    animId: null,
    // 0 = plain rounded square (idle), 1 = fully organic M3 shape (playing)
    stateProgress: 0,
    stateTarget: 0,
    stateAnimId: null,
    stateAnimStart: 0,
    stateAnimFrom: 0
  };

  m3c.img.crossOrigin = 'anonymous';
  m3c.img.onload = () => {
    m3c.imgReady = true;
    renderM3Frame(m3c.morphProgress);
  };
  m3c.img.onerror = () => {
    m3c.imgReady = false;
    renderM3Frame(m3c.morphProgress);
  };

  function initM3Canvas() {
    if (!el.m3cCanvas) return;
    m3c.canvas = el.m3cCanvas;
    // Backing store must match the on-screen size: it used to be a fixed
    // 120px bitmap blown down to 52 CSS px, which left aliased, jagged edges
    // on the cover shape and its progress ring.
    const rect = m3c.canvas.getBoundingClientRect();
    const cssSize = Math.max(24, Math.round(rect.width || m3c.canvas.clientWidth || 52));
    const dpr = window.devicePixelRatio || 1;
    // 3x supersampling: at 52 CSS px the curve/ring would otherwise step.
    const px = Math.round(cssSize * dpr * 3);
    m3c.cssSize = cssSize;
    if (m3c.canvas.width !== px || m3c.canvas.height !== px) {
      m3c.canvas.width = px;
      m3c.canvas.height = px;
    }
    m3c.ctx = m3c.canvas.getContext('2d');
    if (m3c.ctx) {
      // Drawing code works in a 120 x 120 unit space.
      m3c.ctx.setTransform(1, 0, 0, 1, 0, 0);
      m3c.ctx.scale(px / 120, px / 120);
    }
    if (localStorage.getItem('riff_m3_cover') !== 'false') {
      document.body.classList.add('m3-cover-on');
    }
    renderM3Frame(0);
  }

  let m3ResizeTick = 0;
  let m3SquareProfile = null;

  // Rounded-square silhouette used as the idle state of the playbar cover.
  // Same normalisation as RiffShapes profiles (max radius 160) so the two can
  // be blended point by point.
  function getSquareProfile() {
    if (m3SquareProfile) return m3SquareProfile;
    const K = (window.RiffShapes && window.RiffShapes.K) || 360;
    const prof = new Float32Array(K);
    const n = 5;
    let max = 0;
    for (let k = 0; k < K; k++) {
      const theta = -Math.PI + (2 * Math.PI * k) / K;
      const c = Math.abs(Math.cos(theta));
      const s = Math.abs(Math.sin(theta));
      const r = 1 / Math.pow(Math.pow(c, n) + Math.pow(s, n), 1 / n);
      prof[k] = r;
      if (r > max) max = r;
    }
    const scale = 160 / max;
    for (let k = 0; k < K; k++) prof[k] *= scale;
    m3SquareProfile = prof;
    return prof;
  }

  // Animate between the square (idle) and organic (playing) silhouette.
  function animateM3State(target) {
    const goal = target ? 1 : 0;
    if (m3c.stateTarget === goal && m3c.stateAnimId === null) return;
    m3c.stateTarget = goal;
    m3c.stateAnimFrom = m3c.stateProgress;
    m3c.stateAnimStart = performance.now();
    if (m3c.stateAnimId) return;
    const DURATION = 460;
    const step = () => {
      const raw = Math.min(1, (performance.now() - m3c.stateAnimStart) / DURATION);
      const eased = window.RiffShapes ? window.RiffShapes.ease(raw) : raw;
      m3c.stateProgress = m3c.stateAnimFrom + (m3c.stateTarget - m3c.stateAnimFrom) * eased;
      renderM3Frame(m3c.morphProgress);
      if (raw < 1) {
        m3c.stateAnimId = requestAnimationFrame(step);
      } else {
        m3c.stateAnimId = null;
        m3c.stateProgress = m3c.stateTarget;
        renderM3Frame(m3c.morphProgress);
      }
    };
    m3c.stateAnimId = requestAnimationFrame(step);
  }

  function renderM3Frame(tVal = 0) {
    if (!m3c.ctx || !window.RiffShapes || !window.RiffShapes.ready()) return;
    // Cheap periodic re-fit: the canvas is 52px in the Riff playbar but 120px
    // elsewhere, so a mode/scale change must rebuild the backing store.
    if (++m3ResizeTick % 60 === 0 && m3c.canvas) {
      const live = Math.round(m3c.canvas.getBoundingClientRect().width || 0);
      if (live > 8 && Math.abs(live - (m3c.cssSize || 0)) > 1) {
        initM3Canvas();
        return;
      }
    }
    const p1 = window.RiffShapes.profile(m3c.currentShape);
    const p2 = window.RiffShapes.profile(m3c.nextShape);
    if (!p1 || !p2) return;

    const t = window.RiffShapes.ease(Math.max(0, Math.min(1, tVal)));
    const K = window.RiffShapes.K || 360;
    const size = 120;
    const ctx = m3c.ctx;
    // Blend the organic silhouette with the idle rounded square.
    const squareProf = getSquareProfile();
    const sp = window.RiffShapes.ease(Math.max(0, Math.min(1, m3c.stateProgress || 0)));
    const radiusAt = (k) => {
      const organic = (1 - t) * p1[k] + t * p2[k];
      return squareProf[k] + (organic - squareProf[k]) * sp;
    };

    ctx.save();
    ctx.clearRect(0, 0, size, size);
    ctx.translate(size / 2, size / 2);
    ctx.beginPath();
    const scale = (size * 0.44) / 160;

    for (let k = 0; k < K; k++) {
      const theta = -Math.PI + (2 * Math.PI * k) / K;
      const r = radiusAt(k);
      const x = r * scale * Math.cos(theta);
      const y = r * scale * Math.sin(theta);
      if (k === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.clip();

    if ((m3c.imgReady || (m3c.img && m3c.img.complete && m3c.img.naturalWidth > 0)) && m3c.img.naturalWidth > 0) {
      const iw = m3c.img.naturalWidth;
      const ih = m3c.img.naturalHeight;
      const minDim = Math.min(iw, ih);
      const sx = (iw - minDim) / 2;
      const sy = (ih - minDim) / 2;
      ctx.drawImage(m3c.img, sx, sy, minDim, minDim, -size / 2, -size / 2, size, size);
    } else {
      ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--md-sys-color-primary-container') || '#4F378B';
      ctx.fillRect(-size / 2, -size / 2, size, size);
    }
    ctx.restore();

    // Progress Ring Wave around cover shape
    // Optional chaining: this runs during startup, and a hard read of
    // window.MoonPlayer threw before the player API existed.
    const audio = typeof window.MoonPlayer?.getAudio === 'function' ? window.MoonPlayer.getAudio() : (typeof window.MoonPlayer?.getAudioElement === 'function' ? window.MoonPlayer.getAudioElement() : null);
    const dur = audio && isFinite(audio.duration) && audio.duration > 0 ? audio.duration : (state.duration || 0);
    const curTime = audio && isFinite(audio.currentTime) ? audio.currentTime : (state.currentTime || 0);
    const p = dur > 0 ? Math.min(1, Math.max(0, curTime / dur)) : 0;
    const primary = (getComputedStyle(document.documentElement).getPropertyValue('--md-sys-color-primary') || '#D0BCFF').trim();
    const STEPS = 240;
    const RING_GAP = 4;
    const RING_W = 2.5;
    const cx = size / 2;
    const cy = size / 2;
    // The ring only exists while the cover is in its playing (organic) state.
    if (sp <= 0.02) return;
    const ringPoint = (phi, wave) => {
      const theta = phi;
      const k = Math.round((((theta + Math.PI) / (Math.PI * 2)) * K) % K);
      const r = ((radiusAt(k) || 120) * scale) + RING_GAP + RING_W / 2 + wave;
      return [cx + Math.cos(phi) * r, cy + Math.sin(phi) * r];
    };
    const startPhi = -Math.PI / 2;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // A clean 2px ring: the previous version drew a dotted remainder plus a
    // sine-waved progress arc, which at playbar size (52px) read as a crooked,
    // flickering shadow tracing the artwork outline.
    ctx.lineWidth = 2;
    ctx.strokeStyle = primary;
    ctx.globalAlpha = 0.16 * sp;
    ctx.beginPath();
    for (let s = 0; s <= STEPS; s++) {
      const [x, y] = ringPoint(startPhi + (Math.PI * 2 * s) / STEPS, 0);
      if (s === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    if (p > 0) {
      ctx.globalAlpha = 0.85 * sp;
      ctx.beginPath();
      const playedSteps = Math.max(2, Math.round(p * STEPS));
      for (let s = 0; s <= playedSteps; s++) {
        const [x, y] = ringPoint(startPhi + (Math.PI * 2 * s) / STEPS, 0);
        if (s === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function startM3Morph() {
    if (m3c.isMorphing) return;
    m3c.isMorphing = true;
    let lastTime = performance.now();
    let holdTimer = 0;
    const HOLD_MS = 2800;
    const MORPH_MS = 1400;

    function morphLoop(now) {
      if (!m3c.isMorphing) return;
      const dt = now - lastTime;
      lastTime = now;

      if (m3c.morphStartTime > 0) {
        const elapsed = now - m3c.morphStartTime;
        m3c.morphProgress = elapsed / MORPH_MS;
        if (m3c.morphProgress >= 1) {
          m3c.morphProgress = 0;
          m3c.morphStartTime = 0;
          m3c.currentShape = m3c.nextShape;
          m3c.nextShape = window.RiffShapes ? window.RiffShapes.next(m3c.currentShape) : 0;
          holdTimer = HOLD_MS;
          renderM3Frame(0);
        } else {
          renderM3Frame(m3c.morphProgress);
        }
      } else {
        holdTimer -= dt;
        if (holdTimer <= 0) {
          m3c.morphStartTime = now;
          m3c.morphProgress = 0;
        } else {
          renderM3Frame(0);
        }
      }
      m3c.animId = requestAnimationFrame(morphLoop);
    }

    m3c.animId = requestAnimationFrame(morphLoop);
  }

  function stopM3Morph() {
    m3c.isMorphing = false;
    if (m3c.animId) {
      cancelAnimationFrame(m3c.animId);
      m3c.animId = null;
    }
    renderM3Frame(m3c.morphProgress);
  }

  // Robust formatting functions
  function formatDuration(val) {
    if (!val && val !== 0) return '0:00';
    if (typeof val === 'string' && val.includes(':')) return val;
    let sec = Number(val);
    if (!Number.isFinite(sec) || sec <= 0) return '0:00';
    if (sec > 10000) sec = Math.round(sec / 1000);
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function getTrackThumb(track) {
    if (!track) return 'assets/icon.png';
    if (track.cover && track.cover !== '/assets/icon.png' && track.cover !== 'assets/icon.png') {
      return track.cover;
    }
    if (track.folderCoverUrl) return track.folderCoverUrl;
    if (track.picture) return track.picture;
    if (track.artwork_url || track.artworkUrl) return track.artwork_url || track.artworkUrl;
    if (track.path) return `/api/cover?path=${encodeURIComponent(track.path)}`;
    return 'assets/icon.png';
  }

  // Initialize Elements Cache
  function initElements() {
    el = {
      root: document.getElementById('riff-root'),
      titlebar: document.getElementById('titlebar'),
      btnSwitchToMoon: document.getElementById('btn-switch-to-moon'),
      btnMiniPlayer: document.getElementById('btn-mini-player'),
      btnMinimize: document.getElementById('btn-minimize'),
      btnMaximize: document.getElementById('btn-maximize'),
      btnClose: document.getElementById('btn-close'),

      // Top Nav
      searchInput: document.getElementById('riff-search-input'),
      searchClearBtn: document.getElementById('search-clear-btn'),
      searchIconBtn: document.getElementById('search-icon-btn'),
      platformBtns: document.querySelectorAll('.platform-btn'),

      // Sidebar
      sidebar: document.getElementById('sidebar'),
      navActiveIndicator: document.getElementById('nav-active-indicator'),
      navDiscover: document.getElementById('nav-discover'),
      navPlaylists: document.getElementById('nav-playlists'),
      navFavorites: document.getElementById('nav-favorites'),
      navLocal: document.getElementById('nav-local'),
      navHistory: document.getElementById('nav-history'),
      navQueue: document.getElementById('nav-queue'),
      navSettings: document.getElementById('nav-settings'),
      favoritesCount: document.getElementById('favorites-count'),
      localCount: document.getElementById('local-count'),
      queueCount: document.getElementById('queue-count'),

      // Drawers
      btnTogglePresetsDrawer: document.getElementById('btn-toggle-presets-drawer'),
      btnTogglePlaylistsDrawer: document.getElementById('btn-toggle-playlists-drawer'),
      railDrawer: document.getElementById('rail-drawer'),
      railDrawerTitle: document.getElementById('rail-drawer-title'),
      btnCloseRailDrawer: document.getElementById('btn-close-rail-drawer'),
      btnNewPlaylist: document.getElementById('btn-new-playlist'),
      btnSavePresetDialog: document.getElementById('btn-save-preset-dialog'),
      drawerSectionPresets: document.getElementById('drawer-section-presets'),
      drawerSectionPlaylists: document.getElementById('drawer-section-playlists'),
      playlistsList: document.getElementById('playlists-list'),
      presetsContainer: document.getElementById('presets-container'),

      // Views
      mainContent: document.getElementById('main-content'),
      viewDiscover: document.getElementById('view-discover'),
      viewPlaylists: document.getElementById('view-playlists'),
      playlistsGrid: document.getElementById('playlists-grid'),
      playlistsSubtitle: document.getElementById('playlists-subtitle'),
      playlistsSearchInput: document.getElementById('playlists-search-input'),
      btnCreatePlaylistView: document.getElementById('btn-create-playlist-view'),
      viewSearch: document.getElementById('view-search'),
      searchResultsContainer: document.getElementById('search-results-container'),
      viewFavorites: document.getElementById('view-favorites'),
      viewLocal: document.getElementById('view-local'),
      viewHistory: document.getElementById('view-history'),
      viewQueue: document.getElementById('view-queue'),
      viewPlaylistDetail: document.getElementById('view-playlist-detail'),
      viewAlbum: document.getElementById('view-album'),
      viewArtist: document.getElementById('view-artist'),
      viewSettings: document.getElementById('view-settings'),

      // Discover view items
      homeHero: document.getElementById('home-hero'),
      homeVibeGrid: document.getElementById('home-vibe-grid'),
      homeQuickPlayRow: document.getElementById('home-quick-play-row'),
      btnPlayMyWave: document.getElementById('btn-play-my-wave'),
      btnRefreshVibe: document.getElementById('btn-refresh-vibe'),
      myWaveAmbientLight: document.getElementById('my-wave-ambient-light'),
      searchResultsContainer: document.getElementById('search-results-container'),
      searchArtistCardContainer: document.getElementById('search-artist-card-container'),
      searchAlbumsContainer: document.getElementById('search-albums-container'),
      searchTracksList: document.getElementById('search-tracks-list'),

      // Favorites view items
      favoritesTracksList: document.getElementById('favorites-tracks-list'),
      favoritesSubtitle: document.getElementById('favorites-subtitle'),
      favoritesSort: document.getElementById('favorites-sort'),
      favoritesSearchInput: document.getElementById('favorites-search-input'),

      // Local view items
      localTracksList: document.getElementById('local-tracks-list'),
      localSubtitle: document.getElementById('local-subtitle'),
      btnAddLocalFiles: document.getElementById('btn-add-local-files'),
      btnAddLocalFilesEmpty: document.getElementById('btn-add-local-files-empty'),
      localSearchInput: document.getElementById('local-search-input'),

      // SoundCloud view items
      navSoundcloud: document.getElementById('nav-soundcloud'),
      scCount: document.getElementById('sc-count'),
      viewSoundcloud: document.getElementById('view-soundcloud'),
      scTracksList: document.getElementById('sc-tracks-list'),
      btnScRefresh: document.getElementById('btn-sc-refresh'),
      scSubtabs: document.querySelectorAll('.sc-subtab'),
      scSubtitle: document.getElementById('sc-subtitle'),

      // History & Queue items
      historyTracksList: document.getElementById('history-tracks-list'),
      btnClearHistory: document.getElementById('btn-clear-history'),
      queueTracksList: document.getElementById('queue-tracks-list'),
      btnClearQueue: document.getElementById('btn-clear-queue'),

      // Playlist Detail items
      btnBackPlaylists: document.getElementById('btn-back-playlists'),
      playlistDetailTitle: document.getElementById('playlist-detail-title'),
      playlistDetailCount: document.getElementById('playlist-detail-count'),
      playlistDetailCover: document.getElementById('playlist-detail-cover'),
      playlistTracksList: document.getElementById('playlist-tracks-list'),
      playlistSearchInput: document.getElementById('playlist-search-input'),
      btnDeletePlaylist: document.getElementById('btn-delete-playlist'),
      btnDownloadPlaylist: document.getElementById('btn-download-playlist'),
      btnFavAllPlaylist: document.getElementById('btn-fav-all-playlist'),

      // Album View items
      btnBackAlbum: document.getElementById('btn-back-album'),
      albumDetailCover: document.getElementById('album-detail-cover'),
      albumDetailTitle: document.getElementById('album-detail-title'),
      albumDetailArtist: document.getElementById('album-detail-artist'),
      albumDetailCount: document.getElementById('album-detail-count'),
      btnPlayAlbum: document.getElementById('btn-play-album'),
      albumTracksList: document.getElementById('album-tracks-list'),

      // Artist View items
      btnBackArtist: document.getElementById('btn-back-artist'),
      artistAvatarImg: document.getElementById('artist-avatar-img'),
      artistProfileName: document.getElementById('artist-profile-name'),
      artistProfileBio: document.getElementById('artist-profile-bio'),
      artistAlbumsSection: document.getElementById('artist-albums-section'),
      artistAlbumsCount: document.getElementById('artist-albums-count'),
      artistAlbumsGrid: document.getElementById('artist-albums-grid'),
      artistTracksCount: document.getElementById('artist-tracks-count'),
      artistTracksList: document.getElementById('artist-tracks-list'),

      // Settings View items
      settingsNavBtns: document.querySelectorAll('.settings-nav-btn'),
      settingsSections: document.querySelectorAll('.settings-section'),
      settingsSliderScale: document.getElementById('settings-slider-scale'),
      settingsValScale: document.getElementById('settings-val-scale'),
      sliderFontScale: document.getElementById('slider-font-scale'),
      valFontScale: document.getElementById('val-font-scale'),
      fontToggle: document.getElementById('font-toggle'),
      uiOptRiff: document.getElementById('ui-opt-riff'),
      uiOptMoon: document.getElementById('ui-opt-moon'),
      valUiMode: document.getElementById('val-ui-mode'),

      // Playbar items
      playbar: document.getElementById('playbar'),
      playbarArtwork: document.getElementById('playbar-artwork'),
      m3cCanvas: document.getElementById('m3c-canvas'),
      m3cWrap: document.getElementById('m3c-wrap'),
      artworkFallback: document.getElementById('artwork-fallback'),
      playbarTitle: document.getElementById('playbar-title'),
      playbarArtist: document.getElementById('playbar-artist'),
      btnToggleFav: document.getElementById('btn-toggle-fav'),
      favIcon: document.getElementById('fav-icon'),
      btnEditCurrentTrack: document.getElementById('btn-edit-current-track'),
      btnPlaybarMore: document.getElementById('btn-playbar-more'),

      // Playbar Controls
      btnShuffle: document.getElementById('btn-shuffle'),
      btnPrev: document.getElementById('btn-prev'),
      btnPlayPause: document.getElementById('btn-play-pause'),
      playIcon: document.getElementById('play-icon'),
      pauseIcon: document.getElementById('pause-icon'),
      playbarSpinner: document.getElementById('playbar-spinner'),
      btnNext: document.getElementById('btn-next'),
      btnRepeat: document.getElementById('btn-repeat'),

      // Scrubber
      timeCurrent: document.getElementById('time-current'),
      scrubberTrack: document.getElementById('scrubber-track'),
      timeDuration: document.getElementById('time-duration'),

      // Playbar Right
      visualizerContainer: document.getElementById('visualizer-container'),
      visualizerCanvas: document.getElementById('visualizer-canvas'),
      btnToggleLyricsPanel: document.getElementById('btn-toggle-lyrics-panel'),
      btnOpenSettings: document.getElementById('btn-open-settings'),
      btnVolumeMute: document.getElementById('btn-volume-mute'),
      volumeIcon: document.getElementById('volume-icon'),
      volumeMutedIcon: document.getElementById('volume-muted-icon'),
      volumeSlider: document.getElementById('riff-volume-slider'),

      // Audio Suite Modal
      audioSettingsModal: document.getElementById('audio-settings-modal'),
      btnCloseSettings: document.getElementById('btn-close-settings'),
      audioTabs: document.querySelectorAll('.audio-tab'),
      audioPanels: document.querySelectorAll('.audio-panel'),
      sliderSpeed: document.getElementById('slider-speed'),
      valSpeed: document.getElementById('val-speed'),
      sliderPitch: document.getElementById('slider-pitch'),
      valPitch: document.getElementById('val-pitch'),
      sliderGain: document.getElementById('slider-gain'),
      valGain: document.getElementById('val-gain'),
      sliderEqLow: document.getElementById('slider-eq-low'),
      valEqLow: document.getElementById('val-eq-low'),
      sliderEqMid: document.getElementById('slider-eq-mid'),
      valEqMid: document.getElementById('val-eq-mid'),
      sliderEqHigh: document.getElementById('slider-eq-high'),
      valEqHigh: document.getElementById('val-eq-high'),
      eqBandsContainer: document.getElementById('eq-bands'),
      btnResetEqBands: document.getElementById('btn-reset-eq-bands'),
      btnResetAudio: document.getElementById('btn-reset-audio'),
      sleepButtons: document.querySelectorAll('[data-sleep-minutes]'),
      sleepTimerStatus: document.getElementById('sleep-timer-status'),

      // Lyrics Panel
      lyricsPanel: document.getElementById('right-panel') || document.getElementById('lyrics-panel'),
      lyricsContainer: document.getElementById('lyrics-container'),
      btnCloseLyrics: document.getElementById('btn-close-right-panel') || document.getElementById('btn-close-lyrics'),

      // Fullscreen TV Karaoke
      tvKaraoke: document.getElementById('tv-karaoke'),
      btnCloseTvKaraoke: document.getElementById('btn-close-tv-karaoke'),
      tvCover: document.getElementById('tv-cover'),
      tvKaraokeTitle: document.getElementById('tv-karaoke-title'),
      tvKaraokeArtist: document.getElementById('tv-karaoke-artist'),
      tvKaraokeContent: document.getElementById('tv-karaoke-content'),
      tvkVisualizerCanvas: document.getElementById('tvk-visualizer-canvas'),
      btnTvkPrev: document.getElementById('btn-tvk-prev'),
      btnTvkPlay: document.getElementById('btn-tvk-play'),
      btnTvkNext: document.getElementById('btn-tvk-next'),
      tvkPlayIcon: document.getElementById('tvk-play-icon'),
      tvkPauseIcon: document.getElementById('tvk-pause-icon'),

      // Modals
      createPlaylistModal: document.getElementById('create-playlist-modal'),
      newPlaylistInput: document.getElementById('new-playlist-input'),
      btnConfirmNewPlaylist: document.getElementById('btn-confirm-new-playlist'),
      btnCancelNewPlaylist: document.getElementById('btn-cancel-new-playlist'),
      deletePlaylistModal: document.getElementById('delete-playlist-modal'),
      btnConfirmDeletePlaylist: document.getElementById('btn-confirm-delete-playlist'),
      btnCancelDeletePlaylist: document.getElementById('btn-cancel-delete-playlist'),
      deletePlaylistMsg: document.getElementById('delete-playlist-msg'),
      renameTrackModal: document.getElementById('rename-track-modal'),
      shortcutsModal: document.getElementById('shortcuts-modal'),
      btnCloseShortcutsModal: document.getElementById('btn-close-shortcuts-modal'),
      toastContainer: document.getElementById('toast-container'),
    };
  }

  // Toast Notifications
  function showToast(message, duration = 3000) {
    if (!el.toastContainer) return;
    const toast = document.createElement('div');
    toast.className = 'm3-toast';
    toast.style.cssText = `
      background: var(--md-sys-color-surface-container-highest, #28292c);
      color: var(--md-sys-color-on-surface, #fff);
      padding: 10px 18px;
      border-radius: var(--md-shape-corner-full, 9999px);
      box-shadow: 0 4px 16px rgba(0,0,0,0.4);
      font-size: 13px;
      font-weight: 500;
      margin-top: 8px;
      opacity: 0;
      transform: translateY(10px);
      transition: all 0.25s cubic-bezier(0.2, 0, 0, 1);
      display: flex;
      align-items: center;
      gap: 8px;
    `;
    toast.textContent = message;
    el.toastContainer.appendChild(toast);
    void toast.offsetWidth;
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0)';
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(-8px)';
      setTimeout(() => toast.remove(), 250);
    }, duration);
  }

  // Navigation & View Switching
  function switchView(viewName, pushHistory = true) {
    closeDrawer();
    if (pushHistory && state.currentView && state.currentView !== viewName) {
      if (!state.viewHistory) state.viewHistory = [];
      state.viewHistory.push({
        view: state.currentView,
        album: state.selectedAlbum,
        artist: state.selectedArtist,
        playlist: state.selectedPlaylist
      });
      if (state.viewHistory.length > 25) state.viewHistory.shift();
      state.prevView = state.currentView;
    }
    state.currentView = viewName;

    // Refresh elements cache for views/nav if not yet resolved
    if (!el.viewSoundcloud) el.viewSoundcloud = document.getElementById('view-soundcloud');
    if (!el.navSoundcloud) el.navSoundcloud = document.getElementById('nav-soundcloud');

    // Remove active class from views
    const allViews = [
      el.viewDiscover,
      el.viewPlaylists,
      el.viewSearch,
      el.viewFavorites,
      el.viewLocal,
      el.viewSoundcloud,
      el.viewHistory,
      el.viewQueue,
      el.viewPlaylistDetail,
      el.viewAlbum,
      el.viewArtist,
      el.viewSettings,
    ];
    allViews.forEach((v) => {
      if (v) v.classList.remove('active');
    });

    // Remove active class from sidebar buttons
    const allNavs = [
      el.navDiscover,
      el.navPlaylists,
      el.navFavorites,
      el.navLocal,
      el.navSoundcloud,
      el.navHistory,
      el.navQueue,
      el.navSettings,
    ];
    allNavs.forEach((n) => {
      if (n) n.classList.remove('active');
    });

    let targetView = null;
    let targetNav = null;

    if (viewName === 'discover') {
      targetView = el.viewDiscover;
      targetNav = el.navDiscover;
      try { renderDiscoverView(); } catch (err) { console.error('[RiffUI] renderDiscoverView error:', err); }
    } else if (viewName === 'playlists') {
      targetView = el.viewPlaylists;
      targetNav = el.navPlaylists;
      try { renderPlaylistsView(); } catch (err) { console.error('[RiffUI] renderPlaylistsView error:', err); }
    } else if (viewName === 'search') {
      targetView = el.viewSearch;
    } else if (viewName === 'favorites') {
      targetView = el.viewFavorites;
      targetNav = el.navFavorites;
      try { renderFavoritesView(); } catch (err) { console.error('[RiffUI] renderFavoritesView error:', err); }
    } else if (viewName === 'local') {
      targetView = el.viewLocal;
      targetNav = el.navLocal;
      if (state.platform !== 'local') {
        state.platform = 'local';
        const pl = document.getElementById('platform-btn-local');
        const ps = document.getElementById('platform-btn-soundcloud');
        if (pl) pl.classList.add('active');
        if (ps) ps.classList.remove('active');
        if (el.searchInput) el.searchInput.placeholder = 'Search tracks, artists, or albums...';
      }
      try { renderLocalView(); } catch (err) { console.error('[RiffUI] renderLocalView error:', err); }
    } else if (viewName === 'soundcloud') {
      targetView = el.viewSoundcloud;
      targetNav = el.navLocal;
      if (state.platform !== 'soundcloud') {
        state.platform = 'soundcloud';
        const pl = document.getElementById('platform-btn-local');
        const ps = document.getElementById('platform-btn-soundcloud');
        if (pl) pl.classList.remove('active');
        if (ps) ps.classList.add('active');
        if (el.searchInput) el.searchInput.placeholder = 'Search SoundCloud tracks, artists...';
      }
      try { renderSoundCloudView(); } catch (err) { console.error('[RiffUI] renderSoundCloudView error:', err); }
    } else if (viewName === 'history') {
      targetView = el.viewHistory;
      targetNav = el.navHistory;
      try { renderHistoryView(); } catch (err) { console.error('[RiffUI] renderHistoryView error:', err); }
    } else if (viewName === 'queue') {
      targetView = el.viewQueue;
      targetNav = el.navQueue;
      try { renderQueueView(); } catch (err) { console.error('[RiffUI] renderQueueView error:', err); }
    } else if (viewName === 'playlist-detail') {
      targetView = el.viewPlaylistDetail;
    } else if (viewName === 'album') {
      targetView = el.viewAlbum;
    } else if (viewName === 'artist') {
      targetView = el.viewArtist;
    } else if (viewName === 'settings') {
      targetView = el.viewSettings;
      targetNav = el.navSettings;
      try { renderSettingsView(); } catch (err) { console.error('[RiffUI] renderSettingsView error:', err); }
    }

    if (targetView) targetView.classList.add('active');
    if (targetNav) {
      targetNav.classList.add('active');
      updateNavIndicator(targetNav);
    }
  }

  function updateNavIndicator(activeNavEl) {
    if (!el.navActiveIndicator || !activeNavEl) return;
    const top = activeNavEl.offsetTop;
    const height = activeNavEl.offsetHeight;
    el.navActiveIndicator.style.transform = `translateY(${top}px)`;
    el.navActiveIndicator.style.height = `${height}px`;
    el.navActiveIndicator.style.opacity = '1';
  }

  function navigateBack() {
    if (state.viewHistory && state.viewHistory.length > 0) {
      const prev = state.viewHistory.pop();
      if (prev.view === 'album' && prev.album) {
        openAlbum(prev.album, false);
        return;
      } else if (prev.view === 'artist' && prev.artist) {
        openArtistProfile(prev.artist, false);
        return;
      } else if (prev.view === 'playlist-detail' && prev.playlist) {
        openPlaylist(prev.playlist, false);
        return;
      } else if (prev.view) {
        switchView(prev.view, false);
        return;
      }
    }
    switchView(state.prevView || 'local', false);
  }

  // Drawers Toggle
  function toggleDrawer(tabName) {
    if (!el.railDrawer) return;
    const isSameTab = state.drawerTab === tabName && state.isDrawerOpen;
    if (isSameTab) {
      closeDrawer();
      return;
    }
    state.drawerTab = tabName;
    state.isDrawerOpen = true;
    el.railDrawer.classList.remove('hidden');
    el.railDrawer.classList.add('open');
    const backdrop = document.getElementById('rail-drawer-backdrop');
    if (backdrop) {
      backdrop.classList.remove('hidden');
      backdrop.classList.add('open');
    }
    document.body.classList.add('has-drawer-open');
    if (el.btnTogglePlaylistsDrawer) el.btnTogglePlaylistsDrawer.classList.toggle('active', tabName === 'playlists');
    if (el.btnTogglePresetsDrawer) el.btnTogglePresetsDrawer.classList.toggle('active', tabName === 'presets');

    if (tabName === 'playlists') {
      if (el.railDrawerTitle) el.railDrawerTitle.textContent = 'Playlists';
      if (el.btnNewPlaylist) el.btnNewPlaylist.style.display = 'inline-flex';
      if (el.btnSavePresetDialog) el.btnSavePresetDialog.style.display = 'none';
      if (el.drawerSectionPlaylists) el.drawerSectionPlaylists.style.display = 'block';
      if (el.drawerSectionPresets) el.drawerSectionPresets.style.display = 'none';
      renderPlaylistsDrawer();
    } else if (tabName === 'presets') {
      if (el.railDrawerTitle) el.railDrawerTitle.textContent = 'Audio Presets';
      if (el.btnNewPlaylist) el.btnNewPlaylist.style.display = 'none';
      if (el.btnSavePresetDialog) el.btnSavePresetDialog.style.display = 'inline-flex';
      if (el.drawerSectionPlaylists) el.drawerSectionPlaylists.style.display = 'none';
      if (el.drawerSectionPresets) el.drawerSectionPresets.style.display = 'block';
      renderPresetsDrawer();
    }
  }

  function closeDrawer() {
    state.isDrawerOpen = false;
    if (el.railDrawer) {
      el.railDrawer.classList.remove('open');
      el.railDrawer.classList.add('hidden');
    }
    const backdrop = document.getElementById('rail-drawer-backdrop');
    if (backdrop) {
      backdrop.classList.remove('open');
      backdrop.classList.add('hidden');
    }
    document.body.classList.remove('has-drawer-open');
    if (el.btnTogglePlaylistsDrawer) el.btnTogglePlaylistsDrawer.classList.remove('active');
    if (el.btnTogglePresetsDrawer) el.btnTogglePresetsDrawer.classList.remove('active');
  }

  // Smooth Horizontal Scrolling with Wheel translation and Drag-to-scroll
  function makeHorizontalScrollable(container) {
    if (!container || container._hScrollAttached) return;
    container._hScrollAttached = true;
    container.addEventListener('wheel', (e) => {
      if (e.deltaY !== 0) {
        e.preventDefault();
        container.scrollLeft += e.deltaY;
      }
    }, { passive: false });

    let isDown = false;
    let startX = 0;
    let scrollLeft = 0;
    container.addEventListener('mousedown', (e) => {
      if (e.target.closest('button, a, input, select')) return;
      isDown = true;
      startX = e.pageX - container.offsetLeft;
      scrollLeft = container.scrollLeft;
    });
    container.addEventListener('mouseleave', () => { isDown = false; });
    container.addEventListener('mouseup', () => { isDown = false; });
    container.addEventListener('mousemove', (e) => {
      if (!isDown) return;
      e.preventDefault();
      const x = e.pageX - container.offsetLeft;
      const walk = (x - startX) * 1.5;
      container.scrollLeft = scrollLeft - walk;
    });
  }

  // Create Unified Track Row matching Riff design
  function createTrackRow(track, idx, context, trackList = []) {
    const row = document.createElement('div');
    row.className = 'track-row';
    row.tabIndex = 0;
    row.dataset.path = track.path || track.id || '';
    row._track = track;

    const currentSong = window.MoonPlayer ? window.MoonPlayer.getCurrentSong() : null;
    const isLoading = window.MoonPlayer ? window.MoonPlayer.isLoading() : false;
    const isPlayingThis = currentSong && isSameTrack(track, currentSong);

    if (isPlayingThis) {
      row.classList.add('playing');
      if (isLoading) {
        row.classList.add('loading');
      }
    }

    const isFav = window.MoonPlayer ? window.MoonPlayer.isLiked(track) : false;
    const thumbUrl = getTrackThumb(track);

    // FLAC / Lossless badge
    let badgeHtml = '';
    if (window.MoonPlayer && typeof window.MoonPlayer.getFormatBadgeHTML === 'function') {
      badgeHtml = window.MoonPlayer.getFormatBadgeHTML(track, 'flac-badge');
    }

    row.innerHTML = `
      <span class="track-row-index">${idx + 1}</span>
      <img class="track-row-thumb" src="${escapeHtml(thumbUrl)}" alt="" onerror="this.onerror=null;this.src='assets/icon.png'">
      <div class="track-row-info">
        <span class="track-row-title">${escapeHtml(track.title || 'Untitled')}${badgeHtml}</span>
        <span class="track-row-artist" title="View artist">${escapeHtml(track.artist || 'Unknown Artist')}</span>
      </div>
      <span class="track-row-duration">${formatDuration(track.duration || 0)}</span>
      <div class="track-row-actions">
        <button class="btn-icon-pill btn-row-fav" title="${isFav ? 'Remove favorite' : 'Add to favorites'}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="${isFav ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2">
            <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"></path>
          </svg>
        </button>
        <button class="btn-icon-pill btn-row-add-pl" title="Add to playlist">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
        </button>
        ${context === 'playlist' ? `
        <button class="btn-icon-pill btn-row-remove-pl delete-btn" title="Remove from playlist">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>` : ''}
      </div>
    `;

    // Artist name -> open the artist profile (must not start playback)
    const artistEl = row.querySelector('.track-row-artist');
    if (artistEl && track.artist) {
      artistEl.classList.add('artist-link');
      artistEl.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        const user = track.user && (track.user.id || track.user.permalink_url) ? track.user : null;
        if (user) {
          openArtistProfile({
            name: user.username || user.name || track.artist,
            id: user.id,
            avatar: user.avatar_url || user.avatar
          });
        } else {
          openArtistProfile(track.artist);
        }
      });
    }

    // Row Click -> Play Track (clicking anywhere starts playback, only action buttons stop)
    row.addEventListener('click', (e) => {
      if (e.target.closest('button') || e.target.closest('.track-row-actions')) return;
      if (window.MoonPlayer) {
        const cur = window.MoonPlayer.getCurrentTrack();
        const isCurrent = cur && isSameTrack(track, cur);
        if (isCurrent && !window.MoonPlayer.isLoading()) {
          window.MoonPlayer.togglePlayPause();
          return;
        }
        // Immediate visual loading feedback
        row.classList.add('playing');
        row.classList.add('loading');
        state.currentTrack = track;
        state.isPlaying = false;
        if (el.playIcon) el.playIcon.classList.add('hidden');
        if (el.pauseIcon) el.pauseIcon.classList.add('hidden');
        if (el.playbarSpinner) el.playbarSpinner.classList.remove('hidden');
        syncWithPlayer();
        highlightPlayingRows();

        if (Array.isArray(trackList) && trackList.length > 0) {
          window.MoonPlayer.setQueue(trackList, idx);
        }
        window.MoonPlayer.playTrack(track);
        addToRecentHistory(track);
      }
    });

    // Right-Click Context Menu
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (window.MoonPlayer && typeof window.MoonPlayer.showTrackContextMenu === 'function') {
        window.MoonPlayer.showTrackContextMenu(e, track);
      }
    });

    // Favorite Click
    const favBtn = row.querySelector('.btn-row-fav');
    if (favBtn) {
      favBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (window.MoonPlayer) {
          window.MoonPlayer.toggleLike(track);
          const nowFav = window.MoonPlayer.isLiked(track);
          favBtn.querySelector('svg').setAttribute('fill', nowFav ? 'currentColor' : 'none');
          updateCounters();
          if (state.currentView === 'favorites') {
            renderFavoritesView();
          }
        }
      });
    }

    // Add to playlist Click
    const addPlBtn = row.querySelector('.btn-row-add-pl');
    if (addPlBtn) {
      addPlBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        promptAddToPlaylist(track);
      });
    }

    // Remove from playlist Click
    const remPlBtn = row.querySelector('.btn-row-remove-pl');
    if (remPlBtn && state.selectedPlaylist) {
      remPlBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (window.MoonPlayer) {
          window.MoonPlayer.removeTrackFromPlaylist(state.selectedPlaylist, track);
          renderPlaylistDetail(state.selectedPlaylist);
        }
      });
    }

    if ((!track.duration || Number(track.duration) <= 0) && track.path) {
      scheduleDurationLookup(track.path);
    }

    return row;
  }

  // Batch duration resolution helper
  let missingDurationPaths = new Set();
  let durationLookupTimer = null;
  function scheduleDurationLookup(filePath) {
    if (!filePath || filePath.startsWith('soundcloud:')) return;
    missingDurationPaths.add(filePath);
    if (durationLookupTimer) return;
    durationLookupTimer = setTimeout(() => {
      durationLookupTimer = null;
      syncTrackDurations();
    }, 400);
  }

  let durationSyncTimeout = null;
  async function syncTrackDurations() {
    try {
      const res = await fetch('/api/track-durations');
      const data = await res.json();
      const durations = (data && data.durations) || {};
      let updatedCount = 0;
      let missingCount = 0;
      if (window.allSongs && Array.isArray(window.allSongs)) {
        window.allSongs.forEach((song) => {
          if (!song.duration || Number(song.duration) <= 0) {
            if (durations[song.path]) {
              song.duration = durations[song.path];
              updatedCount++;
              const formatted = formatDuration(song.duration);
              const safePath = (song.path || '').replace(/"/g, '\\\"');
              const rows = document.querySelectorAll(`.track-row[data-path="${safePath}"]`);
              rows.forEach((r) => {
                const durEl = r.querySelector('.track-row-duration');
                if (durEl) durEl.textContent = formatted;
                if (r._track) r._track.duration = song.duration;
              });
            } else {
              missingCount++;
            }
          }
        });
      }
      if (state.currentTrack && (!state.currentTrack.duration || Number(state.currentTrack.duration) <= 0)) {
        if (durations[state.currentTrack.path]) {
          state.currentTrack.duration = durations[state.currentTrack.path];
          state.duration = state.currentTrack.duration;
          if (el.timeDuration) el.timeDuration.textContent = formatDuration(state.duration);
        }
      }
      if (missingCount > 0 && !durationSyncTimeout) {
        durationSyncTimeout = setTimeout(() => {
          durationSyncTimeout = null;
          syncTrackDurations();
        }, 3000);
      }
      return updatedCount;
    } catch (e) {}
  }

  // Listen to background & live duration updates from MoonPlayer
  window.addEventListener('moonplayer-duration-updated', (e) => {
    const { path, duration } = e.detail || {};
    if (!path || !duration) return;
    const formatted = formatDuration(duration);
    const safePath = (path || '').replace(/"/g, '\\\"');
    const rows = document.querySelectorAll(`.track-row[data-path="${safePath}"]`);
    rows.forEach((r) => {
      const durEl = r.querySelector('.track-row-duration');
      if (durEl) durEl.textContent = formatted;
      if (r._track) r._track.duration = duration;
    });
    if (state.currentTrack && state.currentTrack.path === path) {
      state.duration = duration;
      if (el.timeDuration) el.timeDuration.textContent = formatted;
    }
  });

  function addToRecentHistory(track) {
    if (!track) return;
    state.recentHistory = state.recentHistory.filter(
      (t) => (t.path && t.path !== track.path) || (t.id && t.id !== track.id)
    );
    state.recentHistory.unshift(track);
    if (state.recentHistory.length > 50) state.recentHistory.pop();
  }

  // Views Implementation
  // 1. Discover View
  function renderDiscoverView() {
    if (!el.viewDiscover) return;
    const allSongs = window.MoonPlayer ? window.MoonPlayer.getAllSongs() : [];

    // "My Wave" recommendation row
    if (el.homeVibeGrid) {
      el.homeVibeGrid.innerHTML = '';
      if (!state.waveTracks || state.waveTracks.length === 0) {
        refreshWaveTracks();
      }

      state.waveTracks.forEach((track) => {
        const card = document.createElement('div');
        card.className = 'mix-card';
        card.style.cssText = `
          min-width: 150px;
          max-width: 150px;
          display: flex;
          flex-direction: column;
          gap: 8px;
          cursor: pointer;
          background: var(--md-sys-color-surface-container, #1e1f22);
          border-radius: var(--md-shape-corner-l, 16px);
          padding: 10px;
          transition: transform 0.2s ease, background 0.2s ease;
        `;
        card.innerHTML = `
          <div style="position: relative; width: 100%; aspect-ratio: 1; border-radius: var(--md-shape-corner-m, 12px); overflow: hidden; background: #000;">
            <img src="${escapeHtml(getTrackThumb(track))}" alt="" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.onerror=null;this.src='assets/icon.png'">
            <button class="btn-pill-primary" style="position: absolute; right: 8px; bottom: 8px; width: 36px; height: 36px; padding: 0; border-radius: 50%; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 12px rgba(0,0,0,0.5);">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4"></polygon></svg>
            </button>
          </div>
          <div style="display: flex; flex-direction: column; overflow: hidden;">
            <span style="font-size: 13px; font-weight: 600; color: var(--md-sys-color-on-surface, #fff); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(track.title || 'Untitled')}</span>
            <span style="font-size: 11px; color: var(--md-sys-color-outline, #938f99); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(track.artist || 'Unknown')}</span>
          </div>
        `;
        card.addEventListener('mouseenter', () => {
          card.style.transform = 'translateY(-4px)';
          card.style.background = 'var(--md-sys-color-surface-container-high, #28292c)';
        });
        card.addEventListener('mouseleave', () => {
          card.style.transform = 'translateY(0)';
          card.style.background = 'var(--md-sys-color-surface-container, #1e1f22)';
        });
        card.addEventListener('click', () => {
          if (window.MoonPlayer) {
            window.MoonPlayer.playTrack(track);
            addToRecentHistory(track);
          }
        });
        el.homeVibeGrid.appendChild(card);
      });
      makeHorizontalScrollable(el.homeVibeGrid);
    }

    // "Jump back in" row
    if (el.homeQuickPlayRow) {
      el.homeQuickPlayRow.innerHTML = '';
      const recent = state.recentHistory.slice(0, 10);
      if (recent.length === 0) {
        el.homeQuickPlayRow.innerHTML = '<span style="font-size: 13px; color: var(--md-sys-color-outline); padding: 12px;">Recently played songs will appear here.</span>';
      } else {
        recent.forEach((track) => {
          const card = document.createElement('div');
          card.className = 'mix-card';
          card.style.cssText = `
            min-width: 140px;
            max-width: 140px;
            display: flex;
            flex-direction: column;
            gap: 6px;
            cursor: pointer;
            background: var(--md-sys-color-surface-container, #1e1f22);
            border-radius: var(--md-shape-corner-m, 12px);
            padding: 8px;
            transition: transform 0.2s ease, background 0.2s ease;
          `;
          card.innerHTML = `
            <div style="position: relative; width: 100%; aspect-ratio: 1; border-radius: var(--md-shape-corner-s, 8px); overflow: hidden; background: #000;">
              <img src="${escapeHtml(getTrackThumb(track))}" alt="" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.onerror=null;this.src='assets/icon.png'">
            </div>
            <span style="font-size: 12px; font-weight: 600; color: var(--md-sys-color-on-surface, #fff); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(track.title || 'Untitled')}</span>
            <span style="font-size: 11px; color: var(--md-sys-color-outline, #938f99); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(track.artist || 'Unknown')}</span>
          `;
          card.addEventListener('mouseenter', () => {
            card.style.transform = 'translateY(-3px)';
          });
          card.addEventListener('mouseleave', () => {
            card.style.transform = 'translateY(0)';
          });
          card.addEventListener('click', () => {
            if (window.MoonPlayer) window.MoonPlayer.playTrack(track);
          });
          el.homeQuickPlayRow.appendChild(card);
        });
        makeHorizontalScrollable(el.homeQuickPlayRow);
      }
    }
  }

  function refreshWaveTracks() {
    const allSongs = window.MoonPlayer ? window.MoonPlayer.getAllSongs() : [];
    if (!allSongs || allSongs.length === 0) {
      state.waveTracks = [];
      return;
    }
    const shuffled = [...allSongs].sort(() => 0.5 - Math.random());
    state.waveTracks = shuffled.slice(0, 14);
  }

  // 2. Favorites View - With Categorized Search and Chunked Loading
  let favFilteredTracks = [];
  let favRenderedCount = 0;
  const FAV_BATCH_SIZE = 60;
  let isAppendingFavChunk = false;

  function appendFavoritesTracksChunk() {
    if (isAppendingFavChunk || !el.favoritesTracksList || favRenderedCount >= favFilteredTracks.length) return;
    isAppendingFavChunk = true;
    requestAnimationFrame(() => {
      try {
        const batch = favFilteredTracks.slice(favRenderedCount, favRenderedCount + FAV_BATCH_SIZE);
        const frag = document.createDocumentFragment();
        batch.forEach((track, idx) => {
          const row = createTrackRow(track, favRenderedCount + idx, 'favorites', favFilteredTracks);
          frag.appendChild(row);
        });
        el.favoritesTracksList.appendChild(frag);
        favRenderedCount += batch.length;
      } finally {
        isAppendingFavChunk = false;
      }
    });
  }

  function renderFavoritesView() {
    if (!el.favoritesTracksList) return;
    el.favoritesTracksList.innerHTML = '';
    const allSongs = window.MoonPlayer ? window.MoonPlayer.getAllSongs() : [];
    let favTracks = allSongs.filter((s) => window.MoonPlayer && window.MoonPlayer.isLiked(s));

    const q = (el.favoritesSearchInput ? el.favoritesSearchInput.value : '').trim().toLowerCase();

    // Categorized Search when typing in "Search favorites..."
    if (q) {
      const allArtists = window.MoonPlayer ? window.MoonPlayer.getArtists() : [];
      const matchedArtists = allArtists
        .map((a) => {
          const aTracks = (a.tracks || []).filter((t) => window.MoonPlayer && window.MoonPlayer.isLiked(t));
          return aTracks.length > 0 && a.name && a.name.toLowerCase().includes(q)
            ? { ...a, tracks: aTracks, trackCount: aTracks.length }
            : null;
        })
        .filter(Boolean);

      const allAlbums = window.MoonPlayer ? window.MoonPlayer.getAlbums() : [];
      const matchedAlbums = allAlbums
        .map((al) => {
          const alTracks = (al.tracks || []).filter((t) => window.MoonPlayer && window.MoonPlayer.isLiked(t));
          const matches = (al.title && al.title.toLowerCase().includes(q)) || (al.artist && al.artist.toLowerCase().includes(q));
          return alTracks.length > 0 && matches
            ? { ...al, tracks: alTracks, trackCount: alTracks.length }
            : null;
        })
        .filter(Boolean);

      const matchedTracks = favTracks.filter(
        (t) =>
          (t.title && t.title.toLowerCase().includes(q)) ||
          (t.artist && t.artist.toLowerCase().includes(q)) ||
          (t.album && t.album.toLowerCase().includes(q))
      );

      if (el.favoritesSubtitle) {
        el.favoritesSubtitle.textContent = `${matchedTracks.length} favorite tracks matching "${q}"`;
      }

      if (matchedArtists.length === 0 && matchedAlbums.length === 0 && matchedTracks.length === 0) {
        el.favoritesTracksList.innerHTML = `<div class="empty-hint">No favorite tracks, albums, or artists matching "${escapeHtml(q)}"</div>`;
        return;
      }

      // 1. Artists Section
      if (matchedArtists.length > 0) {
        const artSec = document.createElement('div');
        artSec.className = 'riff-search-section';
        artSec.innerHTML = `
          <div class="riff-search-section-header">
            <span class="sc-section-title"><i class="fa-solid fa-user"></i> Artists (${matchedArtists.length})</span>
          </div>
        `;
        const scroll = document.createElement('div');
        scroll.className = 'riff-cards-scroll';
        makeHorizontalScrollable(scroll);
        matchedArtists.slice(0, 15).forEach((art) => scroll.appendChild(createArtistCard(art)));
        artSec.appendChild(scroll);
        el.favoritesTracksList.appendChild(artSec);
      }

      // 2. Albums Section
      if (matchedAlbums.length > 0) {
        const albSec = document.createElement('div');
        albSec.className = 'riff-search-section';
        albSec.innerHTML = `
          <div class="riff-search-section-header">
            <span class="sc-section-title"><i class="fa-solid fa-compact-disc"></i> Albums (${matchedAlbums.length})</span>
          </div>
        `;
        const scroll = document.createElement('div');
        scroll.className = 'riff-cards-scroll';
        makeHorizontalScrollable(scroll);
        matchedAlbums.slice(0, 15).forEach((alb) => scroll.appendChild(createAlbumCard(alb)));
        albSec.appendChild(scroll);
        el.favoritesTracksList.appendChild(albSec);
      }

      // 3. Tracks Section
      if (matchedTracks.length > 0) {
        const trkSec = document.createElement('div');
        trkSec.className = 'riff-search-section-header';
        trkSec.innerHTML = `
          <span class="sc-section-title"><i class="fa-solid fa-music"></i> Tracks (${matchedTracks.length})</span>
        `;
        el.favoritesTracksList.appendChild(trkSec);
        favFilteredTracks = matchedTracks;
        favRenderedCount = 0;
        appendFavoritesTracksChunk();
      }
      return;
    }

    // Default: Sort tracks & smooth chunked loading
    const sortMode = el.favoritesSort ? el.favoritesSort.value : 'manual';
    if (sortMode === 'title-asc') {
      favTracks.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
    } else if (sortMode === 'artist-asc') {
      favTracks.sort((a, b) => (a.artist || '').localeCompare(b.artist || ''));
    } else if (sortMode === 'duration-asc') {
      favTracks.sort((a, b) => (a.duration || 0) - (b.duration || 0));
    }

    if (el.favoritesSubtitle) {
      el.favoritesSubtitle.textContent = `${favTracks.length} tracks saved`;
    }

    if (favTracks.length === 0) {
      el.favoritesTracksList.innerHTML = '<div class="empty-hint">No favorite tracks found. Click the heart icon on any song to save it.</div>';
      return;
    }

    favFilteredTracks = favTracks;
    favRenderedCount = 0;
    appendFavoritesTracksChunk();
  }

  // Reusable Material 3 Card Builders for Artists and Albums (Categorized Search)
  function createArtistCard(artist) {
    const card = document.createElement('div');
    card.className = 'riff-card-item';
    const avatar = artist.avatar || artist.avatarUrl || artist.avatar_url || (artist.tracks && artist.tracks.length > 0 ? getTrackThumb(artist.tracks[0]) : 'assets/icon.png');
    const name = artist.name || artist.username || 'Artist';
    const count = artist.trackCount !== undefined ? artist.trackCount : (artist.tracks ? artist.tracks.length : 0);
    card.innerHTML = `
      <img src="${escapeHtml(avatar)}" class="riff-card-artist-avatar" alt="${escapeHtml(name)}" onerror="this.onerror=null;this.src='assets/icon.png'">
      <div class="riff-card-title" title="${escapeHtml(name)}">${escapeHtml(name)}</div>
      <div class="riff-card-subtitle">${count > 0 ? `${count} track${count !== 1 ? 's' : ''}` : 'Artist'}</div>
    `;
    card.addEventListener('click', () => {
      openArtistProfile(artist);
    });
    card.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (window.MoonPlayer && typeof window.MoonPlayer.showArtistContextMenu === 'function') {
        window.MoonPlayer.showArtistContextMenu(e, artist);
      }
    });
    return card;
  }

  function createAlbumCard(album) {
    const card = document.createElement('div');
    card.className = 'riff-card-item';
    const cover = album.cover || album.artwork_url || album.artworkUrl || (album.tracks && album.tracks.length > 0 ? getTrackThumb(album.tracks[0]) : 'assets/icon.png');
    const title = album.title || 'Album';
    const author = album.artist || (typeof album.user === 'string' ? album.user : (album.user && album.user.username) || 'Unknown Artist');
    const count = album.trackCount !== undefined ? album.trackCount : (album.tracks ? album.tracks.length : 0);
    card.innerHTML = `
      <img src="${escapeHtml(cover)}" class="riff-card-cover" alt="${escapeHtml(title)}" onerror="this.onerror=null;this.src='assets/icon.png'">
      <div class="riff-card-title" title="${escapeHtml(title)}">${escapeHtml(title)}</div>
      <div class="riff-card-subtitle">${escapeHtml(author)}${count > 0 ? ` • ${count} tr.` : ''}</div>
    `;
    card.addEventListener('click', () => {
      if ((album.isSoundCloud || (album.id && !album.tracks)) && album.id) {
        fetch(`/api/soundcloud/playlist/${album.id}`)
          .then(r => r.json())
          .then(data => {
            const tracks = data.tracks || [];
            if (window.MoonPlayer && typeof window.MoonPlayer.registerSoundCloudTrack === 'function') {
              tracks.forEach(window.MoonPlayer.registerSoundCloudTrack);
            }
            openAlbum({ ...album, tracks });
          })
          .catch(() => openAlbum(album));
      } else {
        openAlbum(album);
      }
    });
    card.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      let targetAlb = album;
      if (!targetAlb.tracks || targetAlb.tracks.length === 0) {
        const allSongs = window.MoonPlayer ? window.MoonPlayer.getAllSongs() : [];
        targetAlb = { ...album, tracks: allSongs.filter(s => (album.title && s.album && s.album.toLowerCase() === album.title.toLowerCase())) };
      }
      if (window.MoonPlayer && typeof window.MoonPlayer.showAlbumContextMenu === 'function') {
        window.MoonPlayer.showAlbumContextMenu(e, targetAlb);
      }
    });
    return card;
  }

  // 3. Local (My Files) View - Optimized with progressive windowing and categorized search
  let localFilteredTracks = [];
  let localRenderedCount = 0;
  const LOCAL_BATCH_SIZE = 60;
  let localSearchDebounce = null;
  let isAppendingLocalChunk = false;

  function appendLocalTracksChunk() {
    if (isAppendingLocalChunk || !el.localTracksList || localRenderedCount >= localFilteredTracks.length) return;
    isAppendingLocalChunk = true;
    requestAnimationFrame(() => {
      try {
        const batch = localFilteredTracks.slice(localRenderedCount, localRenderedCount + LOCAL_BATCH_SIZE);
        const frag = document.createDocumentFragment();
        batch.forEach((track, idx) => {
          const row = createTrackRow(track, localRenderedCount + idx, 'local', localFilteredTracks);
          frag.appendChild(row);
        });
        el.localTracksList.appendChild(frag);
        localRenderedCount += batch.length;
      } finally {
        isAppendingLocalChunk = false;
      }
    });
  }

  function renderLocalView() {
    if (!el.localTracksList) return;
    el.localTracksList.innerHTML = '';
    const allSongs = window.MoonPlayer ? window.MoonPlayer.getAllSongs() : [];
    let localTracks = allSongs.filter((s) => !isSoundCloudSong(s));
    localTracks = deduplicateTrackList(localTracks);

    const q = (el.localSearchInput ? el.localSearchInput.value : '').trim().toLowerCase();

    // Categorized local search when typing in "Search my files..."
    if (q) {
      const allArtists = window.MoonPlayer ? window.MoonPlayer.getArtists() : [];
      const matchedArtists = allArtists.filter((a) => a.name && a.name.toLowerCase().includes(q));

      const allAlbums = window.MoonPlayer ? window.MoonPlayer.getAlbums() : [];
      const matchedAlbums = allAlbums.filter(
        (al) => (al.title && al.title.toLowerCase().includes(q)) || (al.artist && al.artist.toLowerCase().includes(q))
      );

      const matchedTracks = localTracks.filter(
        (t) =>
          (t.title && t.title.toLowerCase().includes(q)) ||
          (t.artist && t.artist.toLowerCase().includes(q)) ||
          (t.album && t.album.toLowerCase().includes(q))
      );

      if (el.localSubtitle) {
        el.localSubtitle.textContent = `${matchedTracks.length} tracks found for "${q}"`;
      }

      if (matchedArtists.length === 0 && matchedAlbums.length === 0 && matchedTracks.length === 0) {
        el.localTracksList.innerHTML = `<div class="empty-hint">No local tracks, albums, or artists matching "${escapeHtml(q)}"</div>`;
        return;
      }

      // 1. Artists Section
      if (matchedArtists.length > 0) {
        const artSec = document.createElement('div');
        artSec.className = 'riff-search-section';
        artSec.innerHTML = `
          <div class="riff-search-section-header">
            <span class="sc-section-title"><i class="fa-solid fa-user"></i> Artists (${matchedArtists.length})</span>
          </div>
        `;
        const scroll = document.createElement('div');
        scroll.className = 'riff-cards-scroll';
        makeHorizontalScrollable(scroll);
        matchedArtists.slice(0, 15).forEach((art) => scroll.appendChild(createArtistCard(art)));
        artSec.appendChild(scroll);
        el.localTracksList.appendChild(artSec);
      }

      // 2. Albums Section
      if (matchedAlbums.length > 0) {
        const albSec = document.createElement('div');
        albSec.className = 'riff-search-section';
        albSec.innerHTML = `
          <div class="riff-search-section-header">
            <span class="sc-section-title"><i class="fa-solid fa-compact-disc"></i> Albums (${matchedAlbums.length})</span>
          </div>
        `;
        const scroll = document.createElement('div');
        scroll.className = 'riff-cards-scroll';
        makeHorizontalScrollable(scroll);
        matchedAlbums.slice(0, 15).forEach((alb) => scroll.appendChild(createAlbumCard(alb)));
        albSec.appendChild(scroll);
        el.localTracksList.appendChild(albSec);
      }

      // 3. Tracks Section
      if (matchedTracks.length > 0) {
        const trkSec = document.createElement('div');
        trkSec.className = 'riff-search-section-header';
        trkSec.innerHTML = `
          <span class="sc-section-title"><i class="fa-solid fa-music"></i> Tracks (${matchedTracks.length})</span>
        `;
        el.localTracksList.appendChild(trkSec);
        localFilteredTracks = matchedTracks;
        localRenderedCount = 0;
        appendLocalTracksChunk();
      }
      return;
    }

    // Default: full library with smooth chunked loading
    if (el.localSubtitle) {
      el.localSubtitle.textContent = `${localTracks.length} tracks in library`;
    }

    if (localTracks.length === 0) {
      const isScanning = !window.isLibraryLoaded || (window.MoonPlayer && typeof window.MoonPlayer.isLibraryScanning === 'function' && window.MoonPlayer.isLibraryScanning());
      if (isScanning) {
        if (el.localSubtitle) el.localSubtitle.textContent = 'Scanning music library...';
        el.localTracksList.innerHTML = `
          <div class="skeleton-list" style="display:flex; flex-direction:column; gap:6px;">
            ${Array.from({length: 8}).map(() => `
              <div class="skeleton-row" style="display:flex; align-items:center; gap:16px; padding:10px 16px;">
                <div class="skeleton-shimmer" style="width:24px; height:20px; border-radius:4px;"></div>
                <div class="skeleton-shimmer" style="width:44px; height:44px; border-radius:8px;"></div>
                <div style="flex:1; display:flex; flex-direction:column; gap:8px;">
                  <div class="skeleton-shimmer" style="width:40%; height:16px; border-radius:4px;"></div>
                  <div class="skeleton-shimmer" style="width:25%; height:12px; border-radius:4px;"></div>
                </div>
                <div class="skeleton-shimmer" style="width:40px; height:16px; border-radius:4px;"></div>
              </div>
            `).join('')}
          </div>
        `;
        return;
      }

      el.localTracksList.innerHTML = `
        <div class="empty-hint" style="display:flex;flex-direction:column;align-items:center;gap:12px;">
          <span>No local tracks in library yet.</span>
          <button class="btn-pill-primary" id="btn-add-local-empty">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            Add Music Folder
          </button>
        </div>
      `;
      const emptyAddBtn = document.getElementById('btn-add-local-empty');
      if (emptyAddBtn) {
        emptyAddBtn.addEventListener('click', () => {
          if (window.MoonPlayer) window.MoonPlayer.openFolderPicker();
        });
      }
      return;
    }

    localFilteredTracks = localTracks;
    localRenderedCount = 0;
    appendLocalTracksChunk();
  }


  function deduplicateTrackList(tracks) {
    if (!Array.isArray(tracks) || tracks.length <= 1) return tracks || [];
    const deduped = [];
    const seenIds = new Set();
    const seenPaths = new Set();
    const seenMetas = new Set();

    for (let i = 0; i < tracks.length; i++) {
      const t = tracks[i];
      if (!t) continue;

      const id = t.id ? String(t.id) : null;
      const p = t.path ? t.path.toLowerCase().replace(/\\/g, '/') : null;
      const lp = t.localPath ? t.localPath.toLowerCase().replace(/\\/g, '/') : null;
      const title = (t.title || '').trim().toLowerCase();
      const artist = (t.artist || '').trim().toLowerCase();
      const album = (t.album || '').trim().toLowerCase();
      // Keep tracks from different albums distinct!
      const meta = (title && artist && album) ? `${title}:::${artist}:::${album}` : null;

      if (id && seenIds.has(id)) continue;
      if (p && seenPaths.has(p)) continue;
      if (lp && seenPaths.has(lp)) continue;
      if (meta && seenMetas.has(meta)) continue;

      if (id) seenIds.add(id);
      if (p) seenPaths.add(p);
      if (lp) seenPaths.add(lp);
      if (meta) seenMetas.add(meta);

      deduped.push(t);
    }
    return deduped;
  }

  function isSameTrack(t1, t2) {
    if (!t1 || !t2) return false;
    if (t1 === t2) return true;
    if (window.MoonPlayer && typeof window.MoonPlayer.isSameTrack === 'function') {
      return window.MoonPlayer.isSameTrack(t1, t2);
    }
    const sc1 = isSoundCloudSong(t1);
    const sc2 = isSoundCloudSong(t2);
    // Strict platform isolation: Local track must NEVER match SoundCloud track
    if (sc1 !== sc2) return false;

    if (sc1 && sc2) {
      if (t1.id && t2.id && String(t1.id) === String(t2.id)) return true;
      if (t1.path && t2.path && t1.path === t2.path) return true;
      if (t1.permalink_url && t2.permalink_url && t1.permalink_url === t2.permalink_url) return true;
      return false;
    }

    const p1 = (t1.path || '').toLowerCase().replace(/\\/g, '/');
    const p2 = (t2.path || '').toLowerCase().replace(/\\/g, '/');
    if (p1 && p2 && p1 === p2) return true;
    const lp1 = (t1.localPath || '').toLowerCase().replace(/\\/g, '/');
    const lp2 = (t2.localPath || '').toLowerCase().replace(/\\/g, '/');
    if (lp1 && p2 && lp1 === p2) return true;
    if (lp2 && p1 && lp2 === p1) return true;

    const title1 = (t1.title || '').trim().toLowerCase();
    const title2 = (t2.title || '').trim().toLowerCase();
    const artist1 = (t1.artist || '').trim().toLowerCase();
    const artist2 = (t2.artist || '').trim().toLowerCase();
    const album1 = (t1.album || '').trim().toLowerCase();
    const album2 = (t2.album || '').trim().toLowerCase();

    // If both specify albums and they differ, they are genuinely from different albums!
    if (album1 && album2 && album1 !== album2) return false;

    if (title1 && title1 === title2 && artist1 && artist1 === artist2) return true;
    return false;
  }

  function isSoundCloudSong(song) {
    if (!song) return false;
    return !!(
      (song.path && song.path.startsWith('soundcloud:')) ||
      song.isSoundCloud ||
      song.platform === 'soundcloud'
    );
  }

  // 4. History View
  function renderHistoryView() {
    if (!el.historyTracksList) return;
    el.historyTracksList.innerHTML = '';
    if (state.recentHistory.length === 0) {
      el.historyTracksList.innerHTML = '<div class="empty-hint">No recently played tracks.</div>';
      return;
    }
    state.recentHistory.forEach((track, idx) => {
      const row = createTrackRow(track, idx, 'history', state.recentHistory);
      el.historyTracksList.appendChild(row);
    });
  }

  // 5. Queue View - Progressive chunked rendering for high performance
  let queueUpcomingTracks = [];
  let queueRenderedCount = 0;
  const QUEUE_BATCH_SIZE = 50;
  let isAppendingQueueChunk = false;

  function appendQueueTracksChunk() {
    if (isAppendingQueueChunk || !el.queueTracksList || queueRenderedCount >= queueUpcomingTracks.length) return;
    isAppendingQueueChunk = true;
    requestAnimationFrame(() => {
      try {
        const batch = queueUpcomingTracks.slice(queueRenderedCount, queueRenderedCount + QUEUE_BATCH_SIZE);
        const frag = document.createDocumentFragment();
        batch.forEach((track, idx) => {
          const row = createTrackRow(track, queueRenderedCount + idx, 'queue', queueUpcomingTracks);
          frag.appendChild(row);
        });
        el.queueTracksList.appendChild(frag);
        queueRenderedCount += batch.length;
      } finally {
        isAppendingQueueChunk = false;
      }
    });
  }

  function renderQueueView() {
    if (!el.queueTracksList) return;
    el.queueTracksList.innerHTML = '';
    const queue = window.MoonPlayer ? window.MoonPlayer.getQueue() : [];
    const queueIndex = window.MoonPlayer ? window.MoonPlayer.getQueueIndex() : 0;
    queueUpcomingTracks = queue.slice(queueIndex);
    queueRenderedCount = 0;

    if (queueUpcomingTracks.length === 0) {
      el.queueTracksList.innerHTML = '<div class="empty-hint">Playback queue is empty. Play a track to start.</div>';
      return;
    }

    appendQueueTracksChunk();
  }

  // 6. Playlists View
  function renderPlaylistsView() {
    if (!el.viewPlaylists || !el.playlistsGrid) return;
    const playlists = window.MoonPlayer ? window.MoonPlayer.getPlaylists() : {};
    let names = Object.keys(playlists);
    const filter = (el.playlistsSearchInput ? el.playlistsSearchInput.value : '').trim().toLowerCase();
    if (filter) {
      names = names.filter((name) => name.toLowerCase().includes(filter));
    }

    if (el.playlistsSubtitle) {
      el.playlistsSubtitle.textContent = `${names.length} playlist${names.length !== 1 ? 's' : ''}`;
    }

    el.playlistsGrid.innerHTML = '';
    if (names.length === 0) {
      el.playlistsGrid.innerHTML = `
        <div class="empty-hint" style="grid-column: 1 / -1; padding: 48px; text-align: center;">
          <i class="fa-solid fa-compact-disc" style="font-size: 48px; opacity: 0.3; margin-bottom: 16px; display: block;"></i>
          ${filter ? `No playlists matching "${escapeHtml(filter)}"` : 'No playlists yet. Create your first playlist to get started!'}
        </div>
      `;
      return;
    }

    const allSongs = window.MoonPlayer ? window.MoonPlayer.getAllSongs() : [];
    names.forEach((name) => {
      const trackPaths = playlists[name] || [];
      const count = trackPaths.length;
      let cover = 'assets/icon.png';
      if (count > 0) {
        const firstPath = trackPaths[0];
        const s = allSongs.find((item) => item.path === firstPath || (item.id && `soundcloud:${item.id}` === firstPath));
        if (s) {
          cover = getTrackThumb(s);
        }
      }

      const card = document.createElement('div');
      card.className = 'riff-card-item';
      card.innerHTML = `
        <img src="${escapeHtml(cover)}" class="riff-card-cover" alt="${escapeHtml(name)}" onerror="this.onerror=null;this.src='assets/icon.png'">
        <div class="riff-card-title" title="${escapeHtml(name)}">${escapeHtml(name)}</div>
        <div class="riff-card-subtitle">${count} track${count !== 1 ? 's' : ''}</div>
      `;
      card.addEventListener('click', () => {
        openPlaylist(name);
      });
      card.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (window.MoonPlayer && typeof window.MoonPlayer.showPlaylistContextMenu === 'function') {
          window.MoonPlayer.showPlaylistContextMenu(e, name);
        }
      });
      el.playlistsGrid.appendChild(card);
    });
  }

  // 7. Playlist Detail View
  function openPlaylist(playlistName, pushHistory = true) {
    state.selectedPlaylist = playlistName;
    switchView('playlist-detail', pushHistory);
    renderPlaylistDetail(playlistName);
  }

  function renderPlaylistDetail(playlistName) {
    if (!el.viewPlaylistDetail) return;
    const playlists = window.MoonPlayer ? window.MoonPlayer.getPlaylists() : {};
    const trackPaths = playlists[playlistName] || [];
    const allSongs = window.MoonPlayer ? window.MoonPlayer.getAllSongs() : [];

    // Resolve track objects
    const plTracks = [];
    trackPaths.forEach((pathOrUri) => {
      const s = allSongs.find((item) => item.path === pathOrUri || (item.id && `soundcloud:${item.id}` === pathOrUri));
      if (s) plTracks.push(s);
    });

    if (el.playlistDetailTitle) el.playlistDetailTitle.textContent = playlistName;
    if (el.playlistDetailCount) el.playlistDetailCount.textContent = `${plTracks.length} tracks`;

    if (el.playlistDetailCover) {
      const coverUrl = plTracks.length > 0 ? getTrackThumb(plTracks[0]) : 'assets/icon.png';
      el.playlistDetailCover.innerHTML = `<img src="${escapeHtml(coverUrl)}" alt="" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.onerror=null;this.src='assets/icon.png'">`;
    }

    if (el.playlistTracksList) {
      el.playlistTracksList.innerHTML = '';
      if (plTracks.length === 0) {
        el.playlistTracksList.innerHTML = '<div class="empty-hint">This playlist is empty. Add tracks using the "+" button on any song.</div>';
        return;
      }
      plTracks.forEach((track, idx) => {
        const row = createTrackRow(track, idx, 'playlist', plTracks);
        el.playlistTracksList.appendChild(row);
      });
    }

    const btnPlayPl = document.getElementById('btn-play-playlist');
    const btnShufflePl = document.getElementById('btn-shuffle-playlist');
    if (btnPlayPl) {
      btnPlayPl.disabled = plTracks.length === 0;
      btnPlayPl.onclick = () => {
        if (plTracks.length > 0 && window.MoonPlayer) {
          window.MoonPlayer.setQueue(plTracks, 0);
          window.MoonPlayer.playTrack(plTracks[0]);
        }
      };
    }
    if (btnShufflePl) {
      btnShufflePl.disabled = plTracks.length === 0;
      btnShufflePl.onclick = () => {
        if (plTracks.length > 0 && window.MoonPlayer) {
          const shuffled = [...plTracks].sort(() => Math.random() - 0.5);
          window.MoonPlayer.setQueue(shuffled, 0);
          window.MoonPlayer.playTrack(shuffled[0]);
        }
      };
    }
  }

  // 7. Album View
  function openAlbum(albumObj, pushHistory = true) {
    if (!albumObj) return;
    let target = albumObj;
    const allAlbums = window.MoonPlayer ? window.MoonPlayer.getAlbums() : [];
    const allSongs = window.MoonPlayer ? window.MoonPlayer.getAllSongs() : [];

    if (typeof albumObj === 'string') {
      const albSearch = albumObj.trim().toLowerCase();
      const found = allAlbums.find((a) => (a.albumKey && a.albumKey.toLowerCase() === albSearch) || (a.title && a.title.toLowerCase() === albSearch));
      if (found) {
        target = found;
      } else {
        const albumTracks = allSongs.filter((s) => s.album && s.album.trim().toLowerCase() === albSearch);
        target = {
          title: albumObj,
          artist: albumTracks.length > 0 ? albumTracks[0].artist : 'Unknown Artist',
          tracks: albumTracks,
          cover: albumTracks.length > 0 ? getTrackThumb(albumTracks[0]) : 'assets/icon.png'
        };
      }
    } else if (albumObj && typeof albumObj === 'object') {
      const albKey = albumObj.albumKey;
      const albTitle = (albumObj.title || albumObj.name || '').trim().toLowerCase();
      const albArtist = (albumObj.artist || '').trim().toLowerCase();

      let found = null;
      if (albKey) {
        found = allAlbums.find((a) => a.albumKey && a.albumKey === albKey);
      }
      if (!found && albTitle && albArtist) {
        found = allAlbums.find((a) => a.title && a.title.toLowerCase() === albTitle && a.artist && a.artist.toLowerCase() === albArtist);
      }
      if (!found && albTitle) {
        const titleMatches = allAlbums.filter((a) => a.title && a.title.toLowerCase() === albTitle);
        if (titleMatches.length === 1) found = titleMatches[0];
      }

      if (found && Array.isArray(found.tracks) && found.tracks.length > 0) {
        target = found;
      } else if (!albumObj.tracks || albumObj.tracks.length === 0) {
        const albumTracks = allSongs.filter((s) => {
          if (!s.album || s.album.trim().toLowerCase() !== albTitle) return false;
          if (albArtist && s.artist && s.artist.trim().toLowerCase() !== albArtist) return false;
          return true;
        });
        if (albumTracks.length > 0) {
          target = { ...albumObj, tracks: albumTracks };
          if (!target.cover) target.cover = getTrackThumb(albumTracks[0]);
          if (!target.artist) target.artist = albumTracks[0].artist;
        }
      }
    }

    // Connect any online or stub tracks to local audio files if they are in the library
    if (target && Array.isArray(target.tracks) && target.tracks.length > 0) {
      target.tracks = target.tracks.map((t) => {
        const isLocal = t && t.path && !t.path.startsWith('soundcloud:') && !t.isSoundCloud;
        if (!isLocal) {
          const localMatch = allSongs.find(s => s && s.path && !s.path.startsWith('soundcloud:') && !s.isSoundCloud && isSameTrack(s, t));
          if (localMatch) {
            return {
              ...t,
              title: localMatch.title || t.title,
              artist: localMatch.artist || t.artist,
              album: localMatch.album || t.album,
              path: localMatch.path,
              src: localMatch.src || localMatch.url,
              url: localMatch.url || localMatch.src,
              globalIndex: localMatch.globalIndex,
              isSoundCloud: false,
              isDownloadedLocally: true,
              duration: localMatch.duration || t.duration
            };
          }
        } else if (typeof t.globalIndex !== 'number' && t.path) {
          const localMatch = allSongs.find(s => s && s.path && s.path.toLowerCase() === t.path.toLowerCase());
          if (localMatch && typeof localMatch.globalIndex === 'number') {
            t.globalIndex = localMatch.globalIndex;
            if (!t.src) t.src = localMatch.src || localMatch.url;
            if (!t.url) t.url = localMatch.url || localMatch.src;
          }
        }
        return t;
      });
    }

    state.selectedAlbum = target;
    switchView('album', pushHistory);
    renderAlbumView(target);
  }

  function renderAlbumView(album) {
    if (!album || !el.viewAlbum) return;
    const tracks = album.tracks || [];
    if (el.albumDetailTitle) el.albumDetailTitle.textContent = album.title || 'Album';
    if (el.albumDetailArtist) {
      el.albumDetailArtist.textContent = album.artist || 'Unknown Artist';
      el.albumDetailArtist.onclick = () => openArtistProfile(album.artist);
    }
    if (el.albumDetailCount) el.albumDetailCount.textContent = `${tracks.length} tracks`;
    if (el.albumDetailCover) {
      el.albumDetailCover.innerHTML = `<img src="${escapeHtml(album.cover || 'assets/icon.png')}" alt="" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.onerror=null;this.src='assets/icon.png'">`;
    }

    if (el.albumTracksList) {
      el.albumTracksList.innerHTML = '';
      tracks.forEach((track, idx) => {
        const row = createTrackRow(track, idx, 'album', tracks);
        el.albumTracksList.appendChild(row);
      });
    }

    const btnPlayAlbum = document.getElementById('btn-play-album');
    const btnShuffleAlbum = document.getElementById('btn-shuffle-album');
    if (btnPlayAlbum) {
      btnPlayAlbum.disabled = tracks.length === 0;
      btnPlayAlbum.onclick = () => {
        if (tracks.length > 0 && window.MoonPlayer) {
          window.MoonPlayer.setQueue(tracks, 0);
          window.MoonPlayer.playTrack(tracks[0]);
        }
      };
    }
    if (btnShuffleAlbum) {
      btnShuffleAlbum.disabled = tracks.length === 0;
      btnShuffleAlbum.onclick = () => {
        if (tracks.length > 0 && window.MoonPlayer) {
          const shuffled = [...tracks].sort(() => Math.random() - 0.5);
          window.MoonPlayer.setQueue(shuffled, 0);
          window.MoonPlayer.playTrack(shuffled[0]);
        }
      };
    }
  }

  // 8. Artist Profile View - Supports both local and online SoundCloud artists
  function openArtistProfile(artistInput, pushHistory = true) {
    if (!artistInput) return;
    const artistName = typeof artistInput === 'string' ? artistInput : (artistInput.name || artistInput.username || '');
    const isSc = typeof artistInput === 'object' && (artistInput.id || artistInput.isSoundCloud || artistInput.permalink_url);

    // If local artist
    const allArtists = window.MoonPlayer ? window.MoonPlayer.getArtists() : [];
    const found = allArtists.find((a) => a.name && a.name.toLowerCase() === artistName.toLowerCase());

    if (found) {
      state.selectedArtist = found;
      switchView('artist', pushHistory);
      renderArtistView(state.selectedArtist);
      return;
    }

    if (isSc && artistInput.id) {
      // SoundCloud online artist
      state.selectedArtist = {
        name: artistName,
        avatar: artistInput.avatar || artistInput.avatarUrl || artistInput.avatar_url || 'assets/icon.png',
        tracks: [],
        albums: [],
        isSoundCloud: true,
        id: artistInput.id
      };
      switchView('artist', pushHistory);
      renderArtistView(state.selectedArtist);

      // Fetch online artist tracks & albums
      fetch(`/api/soundcloud/artist/${artistInput.id}`)
        .then((r) => r.json())
        .then((data) => {
          if (data && data.success && data.artist) {
            const art = data.artist;
            const topTracks = (data.topTracks || art.topTracks || []).map(t => {
              if (window.MoonPlayer && typeof window.MoonPlayer.registerSoundCloudTrack === 'function') {
                return window.MoonPlayer.registerSoundCloudTrack(t);
              }
              return t;
            }).filter(Boolean);
            const tracks = (data.tracks || art.tracks || []).map(t => {
              if (window.MoonPlayer && typeof window.MoonPlayer.registerSoundCloudTrack === 'function') {
                return window.MoonPlayer.registerSoundCloudTrack(t);
              }
              return t;
            }).filter(Boolean);
            const albums = data.albums || art.albums || [];
            state.selectedArtist.tracks = topTracks.length > 0 ? topTracks : tracks;
            state.selectedArtist.albums = albums;
            state.selectedArtist.avatar = art.avatar || art.cover || state.selectedArtist.avatar;
            renderArtistView(state.selectedArtist);
          }
        })
        .catch((err) => {
          console.warn('[RiffUI] Could not fetch SoundCloud artist tracks:', err);
        });
      return;
    }

    state.selectedArtist = typeof artistInput === 'object' ? artistInput : { name: artistName, tracks: [] };
    switchView('artist', pushHistory);
    renderArtistView(state.selectedArtist);
  }

  function renderArtistView(artist) {
    if (!artist || !el.viewArtist) return;
    if (el.artistProfileName) el.artistProfileName.textContent = artist.name || 'Artist';

    const allSongs = window.MoonPlayer ? window.MoonPlayer.getAllSongs() : [];
    const artistTracks = artist.tracks && artist.tracks.length > 0
      ? artist.tracks
      : allSongs.filter((s) => s.artist && s.artist.toLowerCase() === (artist.name || '').toLowerCase());

    const avatarUrl = artist.avatar || (artistTracks.length > 0 ? getTrackThumb(artistTracks[0]) : 'assets/icon.png');
    if (el.artistAvatarImg) {
      el.artistAvatarImg.src = avatarUrl;
      el.artistAvatarImg.style.display = 'block';
    }

    // Hero backdrop: use the artist's own artwork, blurred and darkened, instead
    // of the flat tonal gradient. The CSS layer already blurs/darkens/masks it;
    // the inline scrim keeps the text readable over bright covers.
    const heroBackdrop = document.getElementById('artist-hero-backdrop');
    const hasArt = avatarUrl && !/assets\/icon\.(png|ico)$/i.test(avatarUrl);
    if (heroBackdrop) {
      if (hasArt) {
        heroBackdrop.style.backgroundImage =
          `linear-gradient(180deg, rgba(8, 8, 10, 0.10) 0%, rgba(8, 8, 10, 0.55) 55%, var(--md-sys-color-surface) 100%), url("${avatarUrl}")`;
        heroBackdrop.style.backgroundColor = 'transparent';
        heroBackdrop.classList.add('has-art');
      } else {
        heroBackdrop.style.backgroundImage = '';
        heroBackdrop.style.backgroundColor = '';
        heroBackdrop.classList.remove('has-art');
      }
    }

    // Artist albums
    const allAlbums = window.MoonPlayer ? window.MoonPlayer.getAlbums() : [];
    const artistAlbums = artist.albums && artist.albums.length > 0
      ? artist.albums
      : allAlbums.filter(
          (al) => al.artist && al.artist.toLowerCase() === (artist.name || '').toLowerCase()
        );

    if (el.artistAlbumsSection && el.artistAlbumsGrid) {
      if (artistAlbums.length > 0) {
        el.artistAlbumsSection.style.display = 'block';
        if (el.artistAlbumsCount) el.artistAlbumsCount.textContent = `${artistAlbums.length} album${artistAlbums.length !== 1 ? 's' : ''}`;
        el.artistAlbumsGrid.innerHTML = '';
        makeHorizontalScrollable(el.artistAlbumsGrid);
        artistAlbums.forEach((al) => {
          el.artistAlbumsGrid.appendChild(createAlbumCard(al));
        });
      } else {
        el.artistAlbumsSection.style.display = 'none';
      }
    }

    if (el.artistTracksCount) {
      el.artistTracksCount.textContent = `${artistTracks.length} track${artistTracks.length !== 1 ? 's' : ''}`;
    }

    if (el.artistTracksList) {
      el.artistTracksList.innerHTML = '';
      if (artistTracks.length === 0) {
        el.artistTracksList.innerHTML = '<div class="empty-hint">No tracks found for this artist.</div>';
        return;
      }
      artistTracks.forEach((track, idx) => {
        const row = createTrackRow(track, idx, 'artist', artistTracks);
        el.artistTracksList.appendChild(row);
      });
    }

    const btnPlayArtist = document.getElementById('btn-play-artist');
    const btnShuffleArtist = document.getElementById('btn-shuffle-artist');
    if (btnPlayArtist) {
      btnPlayArtist.disabled = artistTracks.length === 0;
      btnPlayArtist.onclick = () => {
        if (artistTracks.length > 0 && window.MoonPlayer) {
          window.MoonPlayer.setQueue(artistTracks, 0);
          window.MoonPlayer.playTrack(artistTracks[0]);
        }
      };
    }
    if (btnShuffleArtist) {
      btnShuffleArtist.disabled = artistTracks.length === 0;
      btnShuffleArtist.onclick = () => {
        if (artistTracks.length > 0 && window.MoonPlayer) {
          const shuffled = [...artistTracks].sort(() => Math.random() - 0.5);
          window.MoonPlayer.setQueue(shuffled, 0);
          window.MoonPlayer.playTrack(shuffled[0]);
        }
      };
    }
  }

  
  // 9. Dedicated SoundCloud View with Categorized Online Search
  let scSearchTimeout = null;

  function renderSoundCloudView(subtab = (state.scSubtab || 'trending')) {
    state.scSubtab = subtab;
    const listEl = document.getElementById('sc-tracks-list');
    const subBtns = document.querySelectorAll('.sc-subtab');
    subBtns.forEach((b) => {
      b.classList.toggle('active', b.getAttribute('data-sctab') === subtab);
    });

    if (!listEl) return;
    const subTitle = document.getElementById('sc-subtitle');
    listEl.innerHTML = '';
    const allSongs = window.MoonPlayer ? window.MoonPlayer.getAllSongs() : [];
    let scSongs = allSongs.filter((s) => isSoundCloudSong(s));

    if (subtab === 'likes') {
      scSongs = scSongs.filter((s) => window.MoonPlayer && window.MoonPlayer.isLiked(s));
    }

    if (subTitle) {
      subTitle.textContent = `${scSongs.length} SoundCloud tracks available`;
    }

    if (scSongs.length === 0) {
      listEl.innerHTML = `
        <div class="empty-hint" style="display:flex; flex-direction:column; align-items:center; gap:12px; padding:32px;">
          <span>${subtab === 'likes' ? 'No liked SoundCloud tracks found.' : 'No SoundCloud tracks found in library.'}</span>
          <button class="btn-pill-primary" id="btn-sc-browse-online">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"></circle><line x1="21" y1="21" x2="16.5" y2="16.5"></line></svg>
            Search SoundCloud
          </button>
        </div>
      `;
      const btnBrowse = document.getElementById('btn-sc-browse-online');
      if (btnBrowse) {
        btnBrowse.addEventListener('click', () => {
          if (el.searchInput) {
            el.searchInput.focus();
            if (state.currentView !== 'search') {
              switchView('search');
            }
          }
        });
      }
      return;
    }

    scSongs.forEach((track, idx) => {
      const row = createTrackRow(track, idx, 'soundcloud', scSongs);
      listEl.appendChild(row);
    });
  }


    // 10. Material Design 3 Theme & Palette Controller (Exact 1:1 Riff Theme Engine)
  function computeM3ColorPalette(hex, isLight = false) {
    hex = (hex || '#D0BCFF').replace('#', '');
    if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
    const r = parseInt(hex.substring(0, 2), 16) || 0;
    const g = parseInt(hex.substring(2, 4), 16) || 0;
    const b = parseInt(hex.substring(4, 6), 16) || 0;

    if (isLight) {
      const cr = Math.round(r * 0.25 + 255 * 0.75);
      const cg = Math.round(g * 0.25 + 255 * 0.75);
      const cb = Math.round(b * 0.25 + 255 * 0.75);
      const ocr = Math.round(r * 0.35);
      const ocg = Math.round(g * 0.35);
      const ocb = Math.round(b * 0.35);
      return {
        container: `rgb(${cr}, ${cg}, ${cb})`,
        onContainer: `rgb(${ocr}, ${ocg}, ${ocb})`,
        onPrimary: '#FFFFFF'
      };
    } else {
      const cr = Math.round(r * 0.38 + 26 * 0.62);
      const cg = Math.round(g * 0.38 + 27 * 0.62);
      const cb = Math.round(b * 0.38 + 30 * 0.62);
      const ocr = Math.min(255, Math.round(r * 0.65 + 255 * 0.35));
      const ocg = Math.min(255, Math.round(g * 0.65 + 255 * 0.35));
      const ocb = Math.min(255, Math.round(b * 0.65 + 255 * 0.35));
      return {
        container: `rgb(${cr}, ${cg}, ${cb})`,
        onContainer: `rgb(${ocr}, ${ocg}, ${ocb})`,
        onPrimary: '#1A1B1E'
      };
    }
  }

  function applyRiffTheme(options = {}) {
    let mode = options.mode || localStorage.getItem('riff_theme_mode') || 'dark';
    let color = options.color || localStorage.getItem('riff_theme_color') || '#D0BCFF';
    let container = options.container;
    let onContainer = options.onContainer;
    let onPrimary = options.onPrimary;

    let isLight = mode === 'light';
    if (mode === 'system') {
      isLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
    }

    if (!container || !onContainer) {
      const derived = computeM3ColorPalette(color, isLight);
      container = derived.container;
      onContainer = derived.onContainer;
      onPrimary = derived.onPrimary;
    }

    localStorage.setItem('riff_theme_mode', mode);
    localStorage.setItem('riff_theme_color', color);
    localStorage.setItem('riff_theme_container', container);
    localStorage.setItem('riff_theme_on_container', onContainer);
    localStorage.setItem('riff_theme_on_primary', onPrimary || (isLight ? '#FFFFFF' : '#1A1B1E'));

    let styleTag = document.getElementById('riff-dynamic-theme');
    if (!styleTag) {
      styleTag = document.createElement('style');
      styleTag.id = 'riff-dynamic-theme';
      document.head.appendChild(styleTag);
    }

    // Extract RGB components for --md-sys-color-primary-rgb
    let hex = (color || '#D0BCFF').replace('#', '');
    if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
    const r = parseInt(hex.substring(0, 2), 16) || 0;
    const g = parseInt(hex.substring(2, 4), 16) || 0;
    const b = parseInt(hex.substring(4, 6), 16) || 0;
    const primaryRgb = `${r}, ${g}, ${b}`;

    const css = `
      html.mode-riff, body.mode-riff, #riff-root, .mode-riff {
        --md-sys-color-primary: ${color} !important;
        --md-sys-color-primary-rgb: ${primaryRgb} !important;
        --md-sys-color-on-primary: ${onPrimary || (isLight ? '#FFFFFF' : '#1A1B1E')} !important;
        --md-sys-color-primary-container: ${container} !important;
        --md-sys-color-on-primary-container: ${onContainer} !important;
        --md-sys-color-secondary: ${color} !important;
        --md-sys-color-secondary-container: ${container} !important;
        --md-sys-color-on-secondary-container: ${onContainer} !important;
        --accent: ${color} !important;
        ${isLight ? `
          --md-sys-color-background-solid: #FBF8FD !important;
          --md-sys-color-background: #FBF8FD !important;
          --md-sys-color-surface-solid: #FBF8FD !important;
          --md-sys-color-surface: #FBF8FD !important;
          --md-sys-color-surface-dim: #DEDAE0 !important;
          --md-sys-color-surface-bright: #FBF8FD !important;
          --md-sys-color-surface-container-lowest: #FFFFFF !important;
          --md-sys-color-surface-container-low: #F6F2F7 !important;
          --md-sys-color-surface-container-solid: #F0EDF2 !important;
          --md-sys-color-surface-container: #F0EDF2 !important;
          --md-sys-color-surface-container-high-solid: #EAE7EC !important;
          --md-sys-color-surface-container-high: #EAE7EC !important;
          --md-sys-color-surface-container-highest-solid: #E4E1E6 !important;
          --md-sys-color-surface-container-highest: #E4E1E6 !important;
          --md-sys-color-on-surface-solid: #1B1B1F !important;
          --md-sys-color-on-surface: #1B1B1F !important;
          --md-sys-color-on-surface-variant-solid: #46464F !important;
          --md-sys-color-on-surface-variant: #46464F !important;
          --md-sys-color-outline: #767680 !important;
          --md-sys-color-outline-variant: #C7C5D0 !important;
        ` : `
          --md-sys-color-background-solid: #121214 !important;
          --md-sys-color-background: #121214 !important;
          --md-sys-color-surface-solid: #121214 !important;
          --md-sys-color-surface: #121214 !important;
          --md-sys-color-surface-dim: #121214 !important;
          --md-sys-color-surface-bright: #38383A !important;
          --md-sys-color-surface-container-lowest: #0D0E0F !important;
          --md-sys-color-surface-container-low: #1A1B1E !important;
          --md-sys-color-surface-container-solid: #1E1F22 !important;
          --md-sys-color-surface-container: #1E1F22 !important;
          --md-sys-color-surface-container-high-solid: #28292C !important;
          --md-sys-color-surface-container-high: #28292C !important;
          --md-sys-color-surface-container-highest-solid: #333438 !important;
          --md-sys-color-surface-container-highest: #333438 !important;
          --md-sys-color-on-surface-solid: #E6E6E8 !important;
          --md-sys-color-on-surface: #E6E6E8 !important;
          --md-sys-color-on-surface-variant-solid: #CAC4D0 !important;
          --md-sys-color-on-surface-variant: #CAC4D0 !important;
          --md-sys-color-outline: #938F99 !important;
          --md-sys-color-outline-variant: #49454F !important;
        `}
      }
    `;
    styleTag.textContent = css;

    const root = document.getElementById('riff-root');
    if (root) {
      root.classList.toggle('theme-light', isLight);
    }
    document.documentElement.classList.toggle('theme-light', isLight);
    document.body.classList.toggle('theme-light', isLight);

    // Update settings buttons
    document.querySelectorAll('.theme-mode-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-mode') === mode);
    });
    const valMode = document.getElementById('val-theme-mode');
    if (valMode) {
      valMode.textContent = mode.charAt(0).toUpperCase() + mode.slice(1);
    }

    const swatches = document.querySelectorAll('.theme-swatch');
    swatches.forEach((s) => {
      const isMatch = (s.getAttribute('data-color') || '').toLowerCase() === color.toLowerCase();
      s.classList.toggle('active', isMatch);
    });

    const customInput = document.getElementById('theme-custom-color-input');
    if (customInput) customInput.value = color;

    const valPalette = document.getElementById('val-theme-palette');
    if (valPalette) {
      const activeSwatch = Array.from(swatches).find((s) => (s.getAttribute('data-color') || '').toLowerCase() === color.toLowerCase());
      valPalette.textContent = activeSwatch ? (activeSwatch.getAttribute('data-name') || activeSwatch.title) : 'Custom';
    }
  }

  function setM3UIScale(scalePercent) {
    const scale = parseInt(scalePercent, 10);
    if (isNaN(scale)) return;
    const z = scale / 100;
    // CSS zoom pushed the right-hand columns outside the window: "#riff-root"
    // is 100vw wide, so zooming it to 120% made it 120vw. Scale a layout box
    // that is the inverse size instead, so the UI grows but everything still
    // reflows inside the viewport.
    document.body.style.setProperty('--riff-ui-scale', z.toString());
    document.body.classList.toggle('riff-ui-scaled', scale !== 100);
    // Inline + important: the stylesheet pins #riff-root to 100vw/100vh with
    // !important, so a plain class rule loses the cascade for `height`.
    const riffRoot = document.getElementById('riff-root');
    if (riffRoot) {
      if (scale === 100) {
        ['width', 'height', 'max-height', 'transform', 'transform-origin', 'flex-shrink'].forEach((prop) =>
          riffRoot.style.removeProperty(prop)
        );
      } else {
        riffRoot.style.setProperty('width', `calc(100vw / ${z})`, 'important');
        riffRoot.style.setProperty('height', `calc(100vh / ${z})`, 'important');
        riffRoot.style.setProperty('max-height', `calc(100vh / ${z})`, 'important');
        // body is a column flex container: without this the taller inverse box
        // is simply shrunk back to 100vh and the scaling does nothing vertical.
        riffRoot.style.setProperty('flex-shrink', '0', 'important');
        riffRoot.style.setProperty('transform', `scale(${z})`, 'important');
        riffRoot.style.setProperty('transform-origin', 'top left', 'important');
      }
    }
    const valScale = document.getElementById('settings-val-scale');
    if (valScale) valScale.textContent = `${scale}%`;
    const sliderScale = document.getElementById('settings-slider-scale');
    if (sliderScale) sliderScale.value = scale;
    localStorage.setItem('moonplayer-riff-ui-scale', scale);
  }

  // ---------------------------------------------------------------
  // Custom player background (own photo, blurred + darkened)
  // ---------------------------------------------------------------
  const BG_DEFAULT_BLUR = 18;
  const BG_DEFAULT_DARKEN = 40;
  let riffBgObjectUrl = null;

  function getBackgroundSettings() {
    const blur = parseInt(localStorage.getItem('riff-bg-blur'), 10);
    const darken = parseInt(localStorage.getItem('riff-bg-darken'), 10);
    return {
      blur: Number.isFinite(blur) ? blur : BG_DEFAULT_BLUR,
      darken: Number.isFinite(darken) ? darken : BG_DEFAULT_DARKEN
    };
  }

  function applyBackgroundSettings() {
    const layer = document.getElementById('riff-custom-bg');
    if (!layer) return;
    const { blur, darken } = getBackgroundSettings();
    const brightness = Math.max(0.2, 1 - darken / 100);
    layer.style.filter = `blur(${blur}px) saturate(1.15) brightness(${brightness.toFixed(2)})`;
    layer.style.transform = `scale(${(1 + Math.min(blur, 40) / 300).toFixed(3)})`;
  }

  function paintRiffBackground(url) {
    const layer = document.getElementById('riff-custom-bg');
    const on = !!url;
    document.body.classList.toggle('riff-custom-bg-on', on);
    document.documentElement.classList.toggle('riff-custom-bg-on', on);
    if (!layer) return;
    if (!on) {
      layer.style.backgroundImage = 'none';
      return;
    }
    layer.style.backgroundImage = `url("${url}")`;
    layer.style.backgroundSize = 'cover';
    layer.style.backgroundPosition = 'center';
    applyBackgroundSettings();
  }

  function syncBackgroundControls() {
    const { blur, darken } = getBackgroundSettings();
    const blurSlider = document.getElementById('riff-bg-blur');
    const darkenSlider = document.getElementById('riff-bg-darken');
    const blurVal = document.getElementById('riff-bg-blur-val');
    const darkenVal = document.getElementById('riff-bg-darken-val');
    const removeBtn = document.getElementById('riff-bg-remove');
    const status = document.getElementById('riff-bg-status');
    const hasBg = document.body.classList.contains('riff-custom-bg-on');
    if (blurSlider) blurSlider.value = blur;
    if (darkenSlider) darkenSlider.value = darken;
    if (blurVal) blurVal.textContent = `${blur}px`;
    if (darkenVal) darkenVal.textContent = `${darken}%`;
    if (removeBtn) removeBtn.classList.toggle('hidden', !hasBg);
    if (status) status.textContent = hasBg ? 'Custom photo' : 'None';
  }

  async function refreshRiffBackground() {
    if (!window.MoonPlayer || typeof window.MoonPlayer.getCustomBackground !== 'function') {
      syncBackgroundControls();
      return;
    }
    let blob = null;
    try {
      blob = await window.MoonPlayer.getCustomBackground();
    } catch (err) {
      console.warn('[RiffUI] background read failed:', err);
    }
    if (riffBgObjectUrl) {
      URL.revokeObjectURL(riffBgObjectUrl);
      riffBgObjectUrl = null;
    }
    if (!blob) {
      paintRiffBackground(null);
      syncBackgroundControls();
      return;
    }
    riffBgObjectUrl = URL.createObjectURL(blob);
    paintRiffBackground(riffBgObjectUrl);
    syncBackgroundControls();
  }

  function initBackgroundControls() {
    const uploadBtn = document.getElementById('riff-bg-upload');
    const fileInput = document.getElementById('riff-bg-file');
    const removeBtn = document.getElementById('riff-bg-remove');
    const blurSlider = document.getElementById('riff-bg-blur');
    const darkenSlider = document.getElementById('riff-bg-darken');

    if (uploadBtn && fileInput) {
      uploadBtn.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', async (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        try {
          showToast('Loading image...');
          if (window.MoonPlayer && typeof window.MoonPlayer.setCustomBackground === 'function') {
            await window.MoonPlayer.setCustomBackground(file);
            await refreshRiffBackground();
            showToast('Background updated');
          }
        } catch (err) {
          console.error('[RiffUI] background upload failed:', err);
          showToast('Could not load image: ' + (err && err.message ? err.message : err));
        } finally {
          fileInput.value = '';
        }
      });
    }

    if (removeBtn) {
      removeBtn.addEventListener('click', async () => {
        try {
          if (window.MoonPlayer && typeof window.MoonPlayer.clearCustomBackground === 'function') {
            await window.MoonPlayer.clearCustomBackground();
          }
          if (riffBgObjectUrl) {
            URL.revokeObjectURL(riffBgObjectUrl);
            riffBgObjectUrl = null;
          }
          paintRiffBackground(null);
          syncBackgroundControls();
          showToast('Background removed');
        } catch (err) {
          console.error('[RiffUI] background remove failed:', err);
        }
      });
    }

    if (blurSlider) {
      blurSlider.addEventListener('input', () => {
        localStorage.setItem('riff-bg-blur', blurSlider.value);
        applyBackgroundSettings();
        syncBackgroundControls();
      });
    }

    if (darkenSlider) {
      darkenSlider.addEventListener('input', () => {
        localStorage.setItem('riff-bg-darken', darkenSlider.value);
        applyBackgroundSettings();
        syncBackgroundControls();
      });
    }
  }

  function setM3FontScale(scalePercent) {
    const scale = parseInt(scalePercent, 10);
    if (isNaN(scale)) return;
    document.documentElement.style.setProperty('--font-scale', (scale / 100).toString());
    const valFont = document.getElementById('val-font-scale');
    if (valFont) valFont.textContent = `${scale}%`;
    const sliderFont = document.getElementById('slider-font-scale');
    if (sliderFont) sliderFont.value = scale;
    localStorage.setItem('moonplayer-riff-font-scale', scale);
  }

  function renderSettingsView() {
    const currentMode = window.MoonPlayer ? window.MoonPlayer.getUIMode() : 'moon';
    const uiOptRiff = document.getElementById('ui-opt-riff');
    const uiOptMoon = document.getElementById('ui-opt-moon');
    const valUiMode = document.getElementById('val-ui-mode');

    if (uiOptRiff && uiOptMoon) {
      if (currentMode === 'riff') {
        uiOptRiff.classList.add('active');
        uiOptMoon.classList.remove('active');
        if (valUiMode) valUiMode.textContent = 'Riff UI (M3)';
      } else {
        uiOptMoon.classList.add('active');
        uiOptRiff.classList.remove('active');
        if (valUiMode) valUiMode.textContent = 'MoonPlayer Classic';
      }
    }

    // Sync UI & Font Scales
    const savedScale = localStorage.getItem('moonplayer-riff-ui-scale') || '100';
    setM3UIScale(savedScale);

    const savedFontScale = localStorage.getItem('moonplayer-riff-font-scale') || '100';
    setM3FontScale(savedFontScale);

    // Apply & Sync Theme
    applyRiffTheme();

    // Sync Crossfade
    const toggleCrossfade = document.getElementById('toggle-m3-crossfade');
    const classicCrossfade = document.getElementById('toggle-crossfade');
    if (toggleCrossfade) {
      toggleCrossfade.checked = classicCrossfade ? classicCrossfade.checked : (localStorage.getItem('crossfade-enabled') === 'true');
      const wrap = document.getElementById('m3-crossfade-slider-wrap');
      if (wrap) wrap.style.display = toggleCrossfade.checked ? 'block' : 'none';
    }

    // Sync Crossfade duration
    const sliderCrossfade = document.getElementById('slider-m3-crossfade');
    const classicDuration = document.getElementById('crossfade-duration-slider');
    const valCrossfade = document.getElementById('val-m3-crossfade');
    if (sliderCrossfade) {
      const dur = classicDuration ? classicDuration.value : (localStorage.getItem('crossfade-duration') || '3');
      sliderCrossfade.value = dur;
      if (valCrossfade) valCrossfade.textContent = `${dur}s`;
    }

    // Sync Pause on zero volume
    const togglePauseZero = document.getElementById('toggle-m3-pause-zero');
    const classicPauseZero = document.getElementById('toggle-pause-on-zero-volume');
    if (togglePauseZero) {
      togglePauseZero.checked = classicPauseZero ? classicPauseZero.checked : (localStorage.getItem('pause-on-zero-vol') === 'true');
    }

    // Sync Blobs
    const toggleBlobs = document.getElementById('toggle-m3-blobs');
    if (toggleBlobs) {
      toggleBlobs.checked = localStorage.getItem('blobs-enabled') !== 'false';
    }

    // Sync Discord RPC
    const toggleDiscord = document.getElementById('toggle-m3-discord-rpc');
    const classicDiscord = document.getElementById('toggle-discord-rpc');
    if (toggleDiscord) {
      toggleDiscord.checked = classicDiscord ? classicDiscord.checked : (localStorage.getItem('discord-rpc-enabled') !== 'false');
    }
  }

  function initSettingsView() {
    // 1. Settings Nav Tab Switching
    function selectSettingsTab(cat, btnEl) {
      const allBtns = document.querySelectorAll('.settings-nav-btn');
      allBtns.forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.settings-section').forEach((s) => s.classList.remove('active'));
      if (btnEl) btnEl.classList.add('active');
      else {
        const matching = document.querySelector(`.settings-nav-btn[data-cat="${cat}"]`);
        if (matching) matching.classList.add('active');
      }
      const targetSec = document.querySelector(`.settings-section[data-cat="${cat}"]`);
      if (targetSec) targetSec.classList.add('active');
    }

    const navContainer = document.getElementById('settings-nav');
    if (navContainer) {
      navContainer.onclick = (e) => {
        const btn = e.target.closest('.settings-nav-btn');
        if (!btn) return;
        const cat = btn.getAttribute('data-cat');
        selectSettingsTab(cat, btn);
      };
    }
    document.querySelectorAll('.settings-nav-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const cat = btn.getAttribute('data-cat');
        selectSettingsTab(cat, btn);
      });
    });

    // 2. UI Mode Switcher
    const uiOptRiff = document.getElementById('ui-opt-riff');
    const uiOptMoon = document.getElementById('ui-opt-moon');
    if (uiOptRiff) {
      uiOptRiff.addEventListener('click', () => {
        if (window.MoonPlayer) window.MoonPlayer.setUIMode('riff');
      });
    }
    if (uiOptMoon) {
      uiOptMoon.addEventListener('click', () => {
        if (window.MoonPlayer) window.MoonPlayer.setUIMode('moon');
      });
    }

    // 3. UI Scale Slider
    const sliderScale = document.getElementById('settings-slider-scale');
    if (sliderScale) {
      sliderScale.addEventListener('input', (e) => {
        setM3UIScale(e.target.value);
      });
    }

    // 4. Font Scale Slider
    const sliderFont = document.getElementById('slider-font-scale');
    if (sliderFont) {
      sliderFont.addEventListener('input', (e) => {
        setM3FontScale(e.target.value);
      });
    }

    // 5. Theme Mode Buttons (Auto, Dark, Light)
    document.querySelectorAll('.theme-mode-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const mode = btn.getAttribute('data-mode') || 'dark';
        applyRiffTheme({ mode });
      });
    });

    // 6. Theme Palette Swatches
    document.querySelectorAll('.theme-swatch').forEach((swatch) => {
      swatch.addEventListener('click', () => {
        const color = swatch.getAttribute('data-color');
        const container = swatch.getAttribute('data-container');
        const onContainer = swatch.getAttribute('data-on-container');
        const onPrimary = swatch.getAttribute('data-on-primary');
        applyRiffTheme({ color, container, onContainer, onPrimary });
      });
    });

    const themeCustomColor = document.getElementById('theme-custom-color-input');
    if (themeCustomColor) {
      themeCustomColor.addEventListener('input', (e) => {
        applyRiffTheme({ color: e.target.value });
      });
    }


    // 7. Crossfade
    const toggleCrossfade = document.getElementById('toggle-m3-crossfade');
    if (toggleCrossfade) {
      toggleCrossfade.addEventListener('change', (e) => {
        const classicCrossfade = document.getElementById('toggle-crossfade');
        if (classicCrossfade) {
          classicCrossfade.checked = e.target.checked;
          classicCrossfade.dispatchEvent(new Event('change'));
        }
        const wrap = document.getElementById('m3-crossfade-slider-wrap');
        if (wrap) wrap.style.display = e.target.checked ? 'block' : 'none';
        localStorage.setItem('crossfade-enabled', e.target.checked);
      });
    }

    const sliderCrossfade = document.getElementById('slider-m3-crossfade');
    if (sliderCrossfade) {
      sliderCrossfade.addEventListener('input', (e) => {
        const val = e.target.value;
        const valCrossfade = document.getElementById('val-m3-crossfade');
        if (valCrossfade) valCrossfade.textContent = `${val}s`;
        const classicDuration = document.getElementById('crossfade-duration-slider');
        if (classicDuration) {
          classicDuration.value = val;
          classicDuration.dispatchEvent(new Event('input'));
        }
      });
    }

    // 8. Pause on Zero Volume
    const togglePauseZero = document.getElementById('toggle-m3-pause-zero');
    if (togglePauseZero) {
      togglePauseZero.addEventListener('change', (e) => {
        const classic = document.getElementById('toggle-pause-on-zero-volume');
        if (classic) {
          classic.checked = e.target.checked;
          classic.dispatchEvent(new Event('change'));
        }
        localStorage.setItem('pause-on-zero-vol', e.target.checked);
      });
    }

    // 9. Sleep Timer Pills
    const sleepPills = document.querySelectorAll('#m3-sleep-pills button');
    sleepPills.forEach((btn) => {
      btn.addEventListener('click', () => {
        sleepPills.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        const minutes = btn.getAttribute('data-sleep');
        const countdownEl = document.getElementById('m3-sleep-countdown');
        if (minutes === 'off') {
          if (countdownEl) countdownEl.textContent = 'Disabled';
          if (window.MoonPlayer && window.MoonPlayer.clearSleepTimer) {
            window.MoonPlayer.clearSleepTimer();
          }
        } else {
          const m = parseInt(minutes, 10);
          if (countdownEl) countdownEl.textContent = `${m} minutes remaining`;
          if (window.MoonPlayer && window.MoonPlayer.setSleepTimer) {
            window.MoonPlayer.setSleepTimer(m);
          }
        }
      });
    });
    // 10. Blobs
    const toggleBlobs = document.getElementById('toggle-m3-blobs');
    if (toggleBlobs) {
      toggleBlobs.addEventListener('change', (e) => {
        localStorage.setItem('blobs-enabled', e.target.checked);
        const ambientLight = document.getElementById('my-wave-ambient-light');
        if (ambientLight) ambientLight.style.opacity = e.target.checked ? '1' : '0';
      });
    }

    // 11. SoundCloud & Discord Buttons
    const btnScSignin = document.getElementById('btn-m3-sc-signin');
    if (btnScSignin) {
      btnScSignin.addEventListener('click', () => {
        const classicSignin = document.getElementById('soundcloud-signin-btn');
        if (classicSignin) {
          classicSignin.click();
        } else {
          showToast('Opening SoundCloud Sign In...');
        }
      });
    }

    const btnScRefresh = document.getElementById('btn-m3-sc-refresh');
    const btnScSignout = document.getElementById('btn-m3-sc-signout');
    if (btnScSignout) {
      btnScSignout.addEventListener('click', async () => {
        try {
          await fetch('/api/soundcloud/logout', { method: 'POST' });
          const classicDisc = document.getElementById('soundcloud-disconnect-btn');
          if (classicDisc) classicDisc.click();
          showToast('Logged out of SoundCloud');
          const scStatusText = document.getElementById('m3-sc-status-text');
          const scDot = document.getElementById('m3-sc-status-dot');
          if (scStatusText) scStatusText.textContent = 'Disconnected';
          if (scDot) scDot.style.background = '#eab308';
        } catch (e) {
          console.error(e);
        }
      });
    }

    if (btnScRefresh) {
      btnScRefresh.addEventListener('click', () => {
        const classicRefresh = document.getElementById('soundcloud-refresh-btn');
        if (classicRefresh) {
          classicRefresh.click();
          showToast('Refreshing SoundCloud library...');
        } else {
          showToast('SoundCloud refreshed');
        }
      });
    }

    const toggleDiscord = document.getElementById('toggle-m3-discord-rpc');
    if (toggleDiscord) {
      toggleDiscord.addEventListener('change', (e) => {
        const classic = document.getElementById('toggle-discord-rpc');
        if (classic) {
          classic.checked = e.target.checked;
          classic.dispatchEvent(new Event('change'));
        }
        localStorage.setItem('discord-rpc-enabled', e.target.checked);
      });
    }

    const btnDiscordRefresh = document.getElementById('btn-m3-discord-refresh');
    if (btnDiscordRefresh) {
      btnDiscordRefresh.addEventListener('click', () => {
        const classicRefresh = document.getElementById('discord-rpc-refresh-btn');
        if (classicRefresh) {
          classicRefresh.click();
          showToast('Reconnecting Discord RPC...');
        } else {
          showToast('Discord RPC refreshed');
        }
      });
    }
  }

  
  // Search Engine & Live Categorized Search (Tracks, Albums, Artists)
  let searchTracksChunkList = [];
  let searchTracksRenderedCount = 0;
  const SEARCH_TRACKS_BATCH = 50;
  let searchDebounceTimer = null;

  let isAppendingSearchChunk = false;
  function appendSearchTracksChunk() {
    if (isAppendingSearchChunk || !el.searchTracksList || searchTracksRenderedCount >= searchTracksChunkList.length) return;
    isAppendingSearchChunk = true;
    requestAnimationFrame(() => {
      try {
        const batch = searchTracksChunkList.slice(searchTracksRenderedCount, searchTracksRenderedCount + SEARCH_TRACKS_BATCH);
        const frag = document.createDocumentFragment();
        batch.forEach((track, idx) => {
          const row = createTrackRow(track, searchTracksRenderedCount + idx, 'search', searchTracksChunkList);
          frag.appendChild(row);
        });
        el.searchTracksList.appendChild(frag);
        searchTracksRenderedCount += batch.length;
      } finally {
        isAppendingSearchChunk = false;
      }
    });
  }

  function renderSearchResultsSections(artists, albums, tracks) {
    if (!el.searchResultsContainer) return;
    if (el.searchArtistCardContainer) el.searchArtistCardContainer.innerHTML = '';
    if (el.searchAlbumsContainer) el.searchAlbumsContainer.innerHTML = '';
    if (el.searchTracksList) el.searchTracksList.innerHTML = '';

    const hasArtists = artists && artists.length > 0;
    const hasAlbums = albums && albums.length > 0;
    const hasTracks = tracks && tracks.length > 0;

    if (!hasArtists && !hasAlbums && !hasTracks) {
      if (el.searchTracksList) {
        el.searchTracksList.innerHTML = `
          <div class="empty-hint" style="display:flex; flex-direction:column; align-items:center; gap:12px; padding:32px;">
            <span>No results matching "${escapeHtml(state.searchQuery)}"</span>
            ${state.platform !== 'soundcloud' ? `
              <button class="btn-pill-primary" id="btn-search-sc-fallback" type="button" style="display:inline-flex; align-items:center; gap:8px;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M11.56 8.87V17h8.84c1.99 0 3.6-1.61 3.6-3.6 0-1.85-1.4-3.37-3.21-3.57-.42-2.73-2.77-4.83-5.63-4.83-1.64 0-3.12.69-4.17 1.8A5.98 5.98 0 0 0 11.56 8.87zM8.33 17h1.67V9.75c-.53.2-1.09.52-1.67.92V17zm-3.33 0h1.67v-5.25c-.53.4-1.09.84-1.67 1.33V17zm-3.33 0h1.67v-3.33c-.53.5-1.09 1.05-1.67 1.63V17z"/></svg>
                Search on SoundCloud
              </button>
            ` : ''}
          </div>
        `;
        const btnScFallback = document.getElementById('btn-search-sc-fallback');
        if (btnScFallback) {
          btnScFallback.addEventListener('click', () => {
            const scBtn = document.getElementById('platform-btn-soundcloud');
            if (scBtn) scBtn.click();
          });
        }
      }
      return;
    }

    // 1. Artists Section (horizontal cards scroll)
    if (hasArtists && el.searchArtistCardContainer) {
      const artSec = document.createElement('div');
      artSec.className = 'riff-search-section';
      artSec.innerHTML = `
        <div class="riff-search-section-header">
          <span class="sc-section-title"><i class="fa-solid fa-user"></i> Artists (${artists.length})</span>
        </div>
      `;
      const scroll = document.createElement('div');
      scroll.className = 'riff-cards-scroll';
      makeHorizontalScrollable(scroll);
      artists.slice(0, 20).forEach((art) => scroll.appendChild(createArtistCard(art)));
      artSec.appendChild(scroll);
      el.searchArtistCardContainer.appendChild(artSec);
    }

    // 2. Albums Section (horizontal cards scroll)
    if (hasAlbums && el.searchAlbumsContainer) {
      const albSec = document.createElement('div');
      albSec.className = 'riff-search-section';
      albSec.innerHTML = `
        <div class="riff-search-section-header">
          <span class="sc-section-title"><i class="fa-solid fa-compact-disc"></i> Albums (${albums.length})</span>
        </div>
      `;
      const scroll = document.createElement('div');
      scroll.className = 'riff-cards-scroll';
      makeHorizontalScrollable(scroll);
      albums.slice(0, 20).forEach((alb) => scroll.appendChild(createAlbumCard(alb)));
      albSec.appendChild(scroll);
      el.searchAlbumsContainer.appendChild(albSec);
    }

    // 3. Tracks Section (track rows)
    if (hasTracks && el.searchTracksList) {
      const trkHdr = document.createElement('div');
      trkHdr.className = 'riff-search-section-header';
      trkHdr.innerHTML = `
        <span class="sc-section-title"><i class="fa-solid fa-music"></i> Tracks (${tracks.length})</span>
      `;
      el.searchTracksList.appendChild(trkHdr);
      searchTracksChunkList = tracks;
      searchTracksRenderedCount = 0;
      appendSearchTracksChunk();
    }
  }

  function performSearch(query) {
    state.searchQuery = query.trim();
    if (!state.searchQuery) {
      if (el.homeHero) el.homeHero.classList.remove('hidden');
      if (el.searchResultsContainer) el.searchResultsContainer.classList.add('hidden');
      return;
    }

    if (el.homeHero) el.homeHero.classList.add('hidden');
    if (el.searchResultsContainer) el.searchResultsContainer.classList.remove('hidden');

    const q = state.searchQuery.toLowerCase();
    const currentQ = state.searchQuery;
    const searchSubtitle = document.getElementById('search-view-subtitle');

    // In SoundCloud mode: top search queries SoundCloud directly
    if (state.platform === 'soundcloud') {
      if (searchSubtitle) searchSubtitle.textContent = `Searching SoundCloud for "${currentQ}"...`;
      if (el.searchArtistCardContainer) el.searchArtistCardContainer.innerHTML = '';
      if (el.searchAlbumsContainer) el.searchAlbumsContainer.innerHTML = '';
      if (el.searchTracksList) {
        el.searchTracksList.innerHTML = `
          <div class="empty-hint" style="display:flex; flex-direction:column; align-items:center; gap:14px; padding:48px 24px;">
            <div style="width:28px; height:28px; border:3px solid var(--md-sys-color-primary, #ff5500); border-top-color:transparent; border-radius:50%; animation:spin 0.8s linear infinite;"></div>
            <span style="font-size:14px; color:var(--md-sys-color-on-surface-variant, #ccc);">Searching SoundCloud for "${escapeHtml(currentQ)}"...</span>
          </div>
        `;
      }
      if (window.MoonPlayer && typeof window.MoonPlayer.searchSoundCloud === 'function') {
        if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(() => {
          window.MoonPlayer.searchSoundCloud(currentQ, 'all')
            .then((scData) => {
              if (state.searchQuery !== currentQ) return;
              if (!scData) {
                renderSearchResultsSections([], [], []);
                return;
              }
              const scArtists = scData.artists || [];
              const scAlbums = scData.albums || scData.playlists || [];
              const scTracks = scData.tracks || [];
              if (window.MoonPlayer && typeof window.MoonPlayer.registerSoundCloudTrack === 'function') {
                scTracks.forEach(t => window.MoonPlayer.registerSoundCloudTrack(t));
              }
              if (searchSubtitle) {
                searchSubtitle.textContent = `${scTracks.length} tracks, ${scAlbums.length} albums, ${scArtists.length} artists from SoundCloud`;
              }
              renderSearchResultsSections(scArtists, scAlbums, scTracks);
            })
            .catch((err) => {
              if (state.searchQuery !== currentQ) return;
              if (el.searchTracksList) {
                el.searchTracksList.innerHTML = `<div class="empty-hint">SoundCloud search failed: ${escapeHtml(err.message || 'Error')}</div>`;
              }
            });
        }, 220);
      }
      return;
    }

    // Local Library Search
    const allSongs = window.MoonPlayer ? window.MoonPlayer.getAllSongs() : [];
    const allArtists = window.MoonPlayer ? window.MoonPlayer.getArtists() : [];
    const allAlbums = window.MoonPlayer ? window.MoonPlayer.getAlbums() : [];

    const sourceSongs = allSongs.filter((s) => !isSoundCloudSong(s));
    const sourceAlbums = allAlbums.filter((al) => Array.isArray(al.tracks) && al.tracks.some((t) => !isSoundCloudSong(t)));
    const sourceArtists = allArtists.filter((ar) => Array.isArray(ar.tracks) && ar.tracks.some((t) => !isSoundCloudSong(t)));

    let matchedArtists = sourceArtists.filter((a) => a.name && a.name.toLowerCase().includes(q));
    let matchedAlbums = sourceAlbums.filter(
      (al) => (al.title && al.title.toLowerCase().includes(q)) || (al.artist && al.artist.toLowerCase().includes(q))
    );
    let matchedTracks = sourceSongs.filter(
      (s) =>
        (s.title && s.title.toLowerCase().includes(q)) ||
        (s.artist && s.artist.toLowerCase().includes(q)) ||
        (s.album && s.album.toLowerCase().includes(q))
    );

    matchedTracks = deduplicateTrackList(matchedTracks);

    if (searchSubtitle) {
      searchSubtitle.textContent = `${matchedTracks.length} tracks, ${matchedAlbums.length} albums, ${matchedArtists.length} artists in local library`;
    }

    renderSearchResultsSections(matchedArtists, matchedAlbums, matchedTracks);
  }


  // Drawers: Playlists and Audio Presets
  function renderPlaylistsDrawer() {
    if (!el.playlistsList) return;
    el.playlistsList.innerHTML = '';
    const playlists = window.MoonPlayer ? window.MoonPlayer.getPlaylists() : {};
    const names = Object.keys(playlists);

    if (names.length === 0) {
      el.playlistsList.innerHTML = '<div style="font-size: 12px; color: var(--md-sys-color-outline); padding: 12px;">No playlists yet. Create one!</div>';
      return;
    }

    names.forEach((name) => {
      const count = (playlists[name] || []).length;
      const item = document.createElement('div');
      item.className = 'playlist-item';
      item.style.cssText = `
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 10px 14px;
        border-radius: var(--md-shape-corner-m, 12px);
        cursor: pointer;
        transition: background 0.15s ease;
      `;
      item.innerHTML = `
        <div style="display: flex; align-items: center; gap: 10px; overflow: hidden;">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15V6M18.5 18a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM12 12H3M16 6H3M12 18H3"></path></svg>
          <span style="font-size: 13px; font-weight: 600; color: var(--md-sys-color-on-surface, #fff); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(name)}</span>
        </div>
        <span style="font-size: 11px; color: var(--md-sys-color-outline, #938f99);">${count} tracks</span>
      `;
      item.addEventListener('mouseenter', () => (item.style.background = 'var(--md-sys-color-surface-container-high, #28292c)'));
      item.addEventListener('mouseleave', () => (item.style.background = 'transparent'));
      item.addEventListener('click', () => {
        closeDrawer();
        openPlaylist(name);
      });
      item.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (window.MoonPlayer && typeof window.MoonPlayer.showPlaylistContextMenu === 'function') {
          window.MoonPlayer.showPlaylistContextMenu(e, name);
        }
      });
      el.playlistsList.appendChild(item);
    });
  }

  function renderPresetsDrawer() {
    if (!el.presetsContainer) return;
    el.presetsContainer.innerHTML = '';
    const presetMap = (window.MoonPlayer && typeof window.MoonPlayer.getEqPresets === 'function')
      ? window.MoonPlayer.getEqPresets()
      : null;
    const presets = presetMap ? Object.keys(presetMap) : ['Flat', 'Bass Boost', 'Bass Reducer', 'Deep Sub-bass', 'Mega Bass', 'Rock', 'Hard Rock / Metal', 'Pop', 'Jazz', 'Classical', 'Electronic / EDM', 'Hip-Hop / Rap', 'Acoustic', 'Vocal Booster', 'Vocal Cut', 'R&B / Soul', 'Dance / Club', 'Lounge / Chill', 'Loudness & Clarity', 'Gaming / Spatial'];
    const currentPreset = (window.MoonPlayer && typeof window.MoonPlayer.getCurrentEqPreset === 'function')
      ? window.MoonPlayer.getCurrentEqPreset()
      : 'Flat';

    presets.forEach((preset) => {
      const chip = document.createElement('button');
      chip.className = `preset-chip riff-eq-chip ${preset === currentPreset ? 'active' : ''}`;
      chip.style.cssText = 'padding: 6px 14px; font-size: 12px; font-weight: 500; cursor: pointer;';
      chip.textContent = preset;
      chip.addEventListener('click', () => {
        if (window.MoonPlayer && typeof window.MoonPlayer.applyEqPreset === 'function') {
          window.MoonPlayer.applyEqPreset(preset);
          showToast(`Equalizer Preset: ${preset}`);
          updateEqSliders();
        }
      });
      el.presetsContainer.appendChild(chip);
    });

    const fullEqBtn = document.createElement('button');
    fullEqBtn.className = 'btn-pill-primary';
    fullEqBtn.id = 'btn-drawer-full-eq';
    fullEqBtn.style.cssText = 'width: 100%; margin-top: 16px; padding: 10px 16px; display: flex; align-items: center; justify-content: center; gap: 8px; font-size: 13px; font-weight: 600; cursor: pointer;';
    fullEqBtn.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="21" x2="4" y2="14"></line><line x1="4" y1="10" x2="4" y2="3"></line><line x1="12" y1="21" x2="12" y2="12"></line><line x1="12" y1="8" x2="12" y2="3"></line><line x1="20" y1="21" x2="20" y2="16"></line><line x1="20" y1="12" x2="20" y2="3"></line><line x1="1" y1="14" x2="7" y2="14"></line><line x1="9" y1="8" x2="15" y2="8"></line><line x1="17" y1="16" x2="23" y2="16"></line></svg>
      Full Equalizer & Audio FX
    `;
    fullEqBtn.addEventListener('click', () => {
      closeDrawer();
      openAudioSuite('eq');
    });
    el.presetsContainer.appendChild(fullEqBtn);
  }

  // Playbar & Audio Synchronization
  function syncWithPlayer() {
    if (!window.MoonPlayer) return;
    const currentSong = typeof window.MoonPlayer.getCurrentSong === 'function' 
      ? window.MoonPlayer.getCurrentSong() 
      : (typeof window.MoonPlayer.getCurrentTrack === 'function' ? window.MoonPlayer.getCurrentTrack() : state.currentTrack);
    state.currentTrack = currentSong;
    state.isPlaying = typeof window.MoonPlayer.isPlaying === 'function' ? window.MoonPlayer.isPlaying() : false;
    const audio = typeof window.MoonPlayer.getAudio === 'function' 
      ? window.MoonPlayer.getAudio() 
      : (typeof window.MoonPlayer.getAudioElement === 'function' ? window.MoonPlayer.getAudioElement() : null);

    if (audio) {
      state.duration = audio.duration || 0;
      state.currentTime = audio.currentTime || 0;
      const savedVol = localStorage.getItem('moonplayer_volume');
      if (savedVol !== null && !isNaN(parseFloat(savedVol))) {
        state.volume = parseFloat(savedVol);
      } else if (window.MoonPlayer && typeof window.MoonPlayer.getVolume === 'function') {
        state.volume = window.MoonPlayer.getVolume();
      } else if (audio.volume > 0) {
        state.volume = audio.volume;
      }
      state.isMuted = audio.muted || state.volume === 0;
    }

    // Update Playbar Track Meta
    if (currentSong) {
      let badgeHtml = '';
      if (typeof window.MoonPlayer.getFormatBadgeHTML === 'function') {
        badgeHtml = window.MoonPlayer.getFormatBadgeHTML(currentSong, 'flac-badge');
      }
      if (el.playbarTitle) {
        el.playbarTitle.innerHTML = `${escapeHtml(currentSong.title || 'Untitled')}${badgeHtml}`;
      }
      if (el.playbarArtist) {
        el.playbarArtist.textContent = currentSong.artist || 'Unknown Artist';
      }
      const thumb = getTrackThumb(currentSong);
      if (el.playbarArtwork) {
        el.playbarArtwork.onerror = () => {
          el.playbarArtwork.classList.add('hidden');
          el.playbarArtwork.style.display = 'none';
          if (el.m3cWrap) {
            el.m3cWrap.classList.add('hidden');
            el.m3cWrap.style.display = 'none';
          }
          if (el.artworkFallback) {
            el.artworkFallback.style.display = 'flex';
            el.artworkFallback.classList.remove('hidden');
          }
        };
        el.playbarArtwork.onload = () => {
          // In M3 mode the canvas draws the cover; letting onload reveal the
          // <img> again flashed the square thumbnail for a frame.
          if (document.body.classList.contains('m3-cover-on')) {
            el.playbarArtwork.classList.add('hidden');
            el.playbarArtwork.style.display = 'none';
            if (el.m3cWrap) {
              el.m3cWrap.classList.remove('hidden');
              el.m3cWrap.style.display = 'flex';
            }
            return;
          }
          el.playbarArtwork.classList.remove('hidden');
          el.playbarArtwork.style.display = 'block';
          if (el.m3cWrap) {
            el.m3cWrap.classList.remove('hidden');
            el.m3cWrap.style.display = 'flex';
          }
          if (el.artworkFallback) {
            el.artworkFallback.style.display = 'none';
            el.artworkFallback.classList.add('hidden');
          }
        };
        const isM3On = document.body.classList.contains('m3-cover-on');
        if (thumb && thumb !== 'assets/icon.png' && !thumb.endsWith('icon.png')) {
          if (el.playbarArtwork.getAttribute('src') !== thumb) {
            el.playbarArtwork.src = thumb;
          }
          if (isM3On) {
            el.playbarArtwork.classList.add('hidden');
            el.playbarArtwork.style.display = 'none';
          } else {
            el.playbarArtwork.classList.remove('hidden');
            el.playbarArtwork.style.display = 'block';
          }
          if (el.m3cWrap) {
            el.m3cWrap.classList.remove('hidden');
            el.m3cWrap.style.display = 'flex';
          }
          if (el.artworkFallback) {
            el.artworkFallback.style.display = 'none';
            el.artworkFallback.classList.add('hidden');
          }
        } else {
          el.playbarArtwork.src = '';
          el.playbarArtwork.classList.add('hidden');
          el.playbarArtwork.style.display = 'none';
          if (el.m3cWrap) {
            el.m3cWrap.classList.add('hidden');
            el.m3cWrap.style.display = 'none';
          }
          if (el.artworkFallback) {
            el.artworkFallback.style.display = 'flex';
            el.artworkFallback.classList.remove('hidden');
          }
        }
      }
      if (thumb && thumb !== 'assets/icon.png' && !thumb.endsWith('icon.png')) {
        if (m3c.currentThumb !== thumb) {
          m3c.currentThumb = thumb;
          m3c.imgReady = false;
          if (thumb.startsWith('data:')) {
            m3c.img.removeAttribute('crossorigin');
          } else {
            m3c.img.crossOrigin = 'anonymous';
          }
          m3c.img.src = thumb;
        }
      } else {
        if (m3c.currentThumb !== null) {
          m3c.currentThumb = null;
          m3c.imgReady = false;
          m3c.img.src = '';
          renderM3Frame(0);
        }
      }

      // Bottom-Left artwork playing breathing animation & M3 morph
      const playbarArtWrap = document.getElementById('playbar-artwork-wrapper');
      if (playbarArtWrap) playbarArtWrap.classList.toggle('playing', !!state.isPlaying);
      if (el.m3cWrap) el.m3cWrap.classList.toggle('playing', !!state.isPlaying);
      if (state.isPlaying) {
        startM3Morph();
        animateM3State(1);
      } else {
        stopM3Morph();
        animateM3State(0);
      }

      // Right Panel Now Playing Synchronize
      const rightPanelTitle = document.getElementById('right-panel-title');
      const rightPanelArtist = document.getElementById('right-panel-artist');
      const rightPanelCover = document.getElementById('right-panel-cover');
      const rightPanelFallback = document.getElementById('right-panel-fallback');
      if (rightPanelTitle) rightPanelTitle.innerHTML = `${escapeHtml(currentSong.title || 'Untitled')}${badgeHtml}`;
      if (rightPanelArtist) rightPanelArtist.textContent = currentSong.artist || 'Unknown Artist';
      if (rightPanelCover) {
        rightPanelCover.src = thumb;
        rightPanelCover.style.display = 'block';
      }
      if (rightPanelFallback) rightPanelFallback.style.display = 'none';

      // TV Karaoke meta
      if (el.tvKaraokeTitle) el.tvKaraokeTitle.textContent = currentSong.title || 'Untitled';
      if (el.tvKaraokeArtist) el.tvKaraokeArtist.textContent = currentSong.artist || 'Unknown Artist';
      if (el.tvCover) el.tvCover.src = thumb;
    } else {
      if (el.m3cWrap) {
        el.m3cWrap.classList.add('hidden');
        el.m3cWrap.style.display = 'none';
      }
      if (el.playbarArtwork) {
        el.playbarArtwork.src = '';
        el.playbarArtwork.classList.add('hidden');
        el.playbarArtwork.style.display = 'none';
      }
      if (el.artworkFallback) {
        el.artworkFallback.style.display = 'flex';
        el.artworkFallback.classList.remove('hidden');
      }
      if (el.playbarTitle) el.playbarTitle.textContent = 'No track playing';
      if (el.playbarArtist) el.playbarArtist.textContent = 'Select a track to listen';
      if (el.playbarArtwork) el.playbarArtwork.src = '';

      // Reset Right Panel
      const rightPanelTitle = document.getElementById('right-panel-title');
      const rightPanelArtist = document.getElementById('right-panel-artist');
      const rightPanelCover = document.getElementById('right-panel-cover');
      const rightPanelFallback = document.getElementById('right-panel-fallback');
      if (rightPanelTitle) rightPanelTitle.textContent = 'No track playing';
      if (rightPanelArtist) rightPanelArtist.textContent = 'Select a track to listen';
      if (rightPanelCover) rightPanelCover.style.display = 'none';
      if (rightPanelFallback) rightPanelFallback.style.display = 'flex';

      const playbarArtWrap = document.getElementById('playbar-artwork-wrapper');
      if (playbarArtWrap) playbarArtWrap.classList.remove('playing');
      if (el.m3cWrap) el.m3cWrap.classList.remove('playing');
      stopM3Morph();
    }

    // Update Favorite Heart
    const isFav = currentSong && window.MoonPlayer.isLiked(currentSong);
    if (el.favIcon) {
      el.favIcon.setAttribute('fill', isFav ? 'currentColor' : 'none');
    }

    // Update Play/Pause button
    updatePlayPauseButton();

    // Update Shuffle & Repeat
    state.isShuffle = window.MoonPlayer.isShuffle();
    state.repeatMode = window.MoonPlayer.getLoopMode ? window.MoonPlayer.getLoopMode() : 'none';
    if (el.btnShuffle) el.btnShuffle.classList.toggle('active', state.isShuffle);
    updateRepeatUI(state.repeatMode);

    // Update Volume Slider
    if (el.volumeSlider) {
      el.volumeSlider.value = state.volume;
      updateVolumeFill();
    }
    updateVolumeIcon();

    // Update Counters
    updateCounters();

    // Start Visualizers
    startVisualizerLoop();
  }

  function updateRepeatUI(mode) {
    if (!el.btnRepeat) return;
    const m = mode || state.repeatMode || 'none';
    if (m === 'one') {
      el.btnRepeat.classList.add('active');
      el.btnRepeat.setAttribute('title', 'Repeat One');
      el.btnRepeat.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="17 1 21 5 17 9"></polyline><path d="M3 11V9a4 4 0 0 1 4-4h14"></path><polyline points="7 23 3 19 7 15"></polyline><path d="M21 13v2a4 4 0 0 1-4 4H3"></path><text x="12" y="14.5" font-size="8.5" font-weight="900" fill="currentColor" stroke="none" text-anchor="middle" font-family="system-ui, -apple-system, sans-serif">1</text></svg>';
    } else if (m === 'all') {
      el.btnRepeat.classList.add('active');
      el.btnRepeat.setAttribute('title', 'Repeat All');
      el.btnRepeat.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="17 1 21 5 17 9"></polyline><path d="M3 11V9a4 4 0 0 1 4-4h14"></path><polyline points="7 23 3 19 7 15"></polyline><path d="M21 13v2a4 4 0 0 1-4 4H3"></path></svg>';
    } else {
      el.btnRepeat.classList.remove('active');
      el.btnRepeat.setAttribute('title', 'Repeat Off');
      el.btnRepeat.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="17 1 21 5 17 9"></polyline><path d="M3 11V9a4 4 0 0 1 4-4h14"></path><polyline points="7 23 3 19 7 15"></polyline><path d="M21 13v2a4 4 0 0 1-4 4H3"></path></svg>';
    }
  }

  function updatePlayPauseButton() {
    const audio = window.MoonPlayer && typeof window.MoonPlayer.getAudio === 'function' ? window.MoonPlayer.getAudio() : null;
    const isActuallyPlaying = (audio && !audio.paused) || (window.MoonPlayer ? window.MoonPlayer.isPlaying() : false);
    const isLoading = (!isActuallyPlaying) && (window.MoonPlayer ? window.MoonPlayer.isLoading() : false);
    const isPlaying = isActuallyPlaying;

    if (el.btnPlayPause) {
      el.btnPlayPause.classList.toggle('playing', isPlaying);
    }

    if (isLoading) {
      if (el.playIcon) el.playIcon.classList.add('hidden');
      if (el.pauseIcon) el.pauseIcon.classList.add('hidden');
      if (el.playbarSpinner) el.playbarSpinner.classList.remove('hidden');
    } else if (isPlaying) {
      if (el.playIcon) el.playIcon.classList.add('hidden');
      if (el.pauseIcon) el.pauseIcon.classList.remove('hidden');
      if (el.playbarSpinner) el.playbarSpinner.classList.add('hidden');
    } else {
      if (el.playIcon) el.playIcon.classList.remove('hidden');
      if (el.pauseIcon) el.pauseIcon.classList.add('hidden');
      if (el.playbarSpinner) el.playbarSpinner.classList.add('hidden');
    }

    // TV Karaoke Play button
    if (el.tvkPlayIcon && el.tvkPauseIcon) {
      if (isPlaying) {
        el.tvkPlayIcon.classList.add('hidden');
        el.tvkPauseIcon.classList.remove('hidden');
      } else {
        el.tvkPlayIcon.classList.remove('hidden');
        el.tvkPauseIcon.classList.add('hidden');
      }
    }
  }

  function updateVolumeFill() {
    if (!el.volumeSlider) return;
    const val = parseFloat(el.volumeSlider.value);
    const pct = Math.max(0, Math.min(100, (isNaN(val) ? 0.85 : val) * 100));
    el.volumeSlider.style.setProperty('--volume-pct', `${pct}%`);
    el.volumeSlider.style.setProperty('--slider-pct', `${pct}%`);
  }

  function updateVolumeIcon() {
    if (state.isMuted || state.volume === 0) {
      if (el.volumeIcon) el.volumeIcon.classList.add('hidden');
      if (el.volumeMutedIcon) el.volumeMutedIcon.classList.remove('hidden');
    } else {
      if (el.volumeIcon) el.volumeIcon.classList.remove('hidden');
      if (el.volumeMutedIcon) el.volumeMutedIcon.classList.add('hidden');
    }
  }

  function updateCounters() {
    const allSongs = window.MoonPlayer ? window.MoonPlayer.getAllSongs() : [];
    const favCount = allSongs.filter((s) => window.MoonPlayer && window.MoonPlayer.isLiked(s)).length;
    const localCount = allSongs.filter((s) => !isSoundCloudSong(s)).length;
    const scCount = allSongs.filter((s) => isSoundCloudSong(s)).length;
    const queue = window.MoonPlayer ? window.MoonPlayer.getQueue() : [];

    if (el.favoritesCount) el.favoritesCount.textContent = favCount;
    if (el.localCount) el.localCount.textContent = localCount;
    if (el.scCount) {
      el.scCount.textContent = scCount;
      el.scCount.classList.toggle('hidden', scCount === 0);
    }
    if (el.queueCount) el.queueCount.textContent = queue.length;
  }

  // Squiggly Canvas Scrubber (Riff Signature Feature)
  function initScrubber() {
    if (!el.scrubberTrack) return;
    let canvas = document.getElementById('squiggly-canvas');
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.id = 'squiggly-canvas';
      canvas.className = 'squiggly-canvas';
      el.scrubberTrack.appendChild(canvas);
    }

    const dpr = window.devicePixelRatio || 1;
    const rect = el.scrubberTrack.getBoundingClientRect();
    const trackW = Math.round(rect.width || 300);
    const trackH = Math.round(rect.height || 24);

    canvas.width = Math.round(trackW * dpr);
    canvas.height = Math.round(trackH * dpr);
    canvas.style.width = `${trackW}px`;
    canvas.style.height = `${trackH}px`;

    const ctx = canvas.getContext('2d');
    ctx.resetTransform();
    ctx.scale(dpr, dpr);

    // Mouse drag seeking events
    el.scrubberTrack.addEventListener('mousedown', (e) => {
      isDraggingScrubber = true;
      el.scrubberTrack.classList.add('dragging');
      updateSeekPosition(e);
    });

    window.addEventListener('mousemove', (e) => {
      if (!isDraggingScrubber) return;
      updateSeekPosition(e);
    });

    window.addEventListener('mouseup', (e) => {
      if (!isDraggingScrubber) return;
      isDraggingScrubber = false;
      if (el.scrubberTrack) el.scrubberTrack.classList.remove('dragging');
      if (state.scrubberDragTime !== null && window.MoonPlayer) {
        window.MoonPlayer.seek(state.scrubberDragTime);
      }
      state.scrubberDragTime = null;
    });
  }

  function updateSeekPosition(e) {
    if (!el.scrubberTrack) return;
    const rect = el.scrubberTrack.getBoundingClientRect();
    const pad = 5.5;
    const w = rect.width - pad * 2;
    let pos = (e.clientX - rect.left - pad) / w;
    pos = Math.max(0, Math.min(1, pos));

    const audio = window.MoonPlayer ? window.MoonPlayer.getAudio() : null;
    const dur = audio && Number.isFinite(audio.duration) ? audio.duration : state.duration;
    const targetTime = pos * dur;
    state.scrubberDragTime = targetTime;

    if (el.timeCurrent) {
      el.timeCurrent.textContent = formatDuration(targetTime);
    }
  }

  // Draw Squiggly Waveform Frame
  function drawSquiggly(timestamp, dt) {
    const canvas = document.getElementById('squiggly-canvas');
    if (!canvas || !el.scrubberTrack) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const sw = Math.round(el.scrubberTrack.clientWidth || 300);
    const sh = Math.round(el.scrubberTrack.clientHeight || 24);
    const reqW = Math.round(sw * dpr);
    const reqH = Math.round(sh * dpr);

    if (canvas.width !== reqW || canvas.height !== reqH) {
      canvas.width = reqW;
      canvas.height = reqH;
      canvas.style.width = `${sw}px`;
      canvas.style.height = `${sh}px`;
      ctx.resetTransform();
      ctx.scale(dpr, dpr);
    }

    ctx.save();
    ctx.resetTransform();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();

    const audio = window.MoonPlayer ? window.MoonPlayer.getAudio() : null;
    const dur = (audio && Number.isFinite(audio.duration) && audio.duration > 0) ? audio.duration : state.duration;
    let cur = (audio && Number.isFinite(audio.currentTime)) ? audio.currentTime : state.currentTime;

    if (isDraggingScrubber && state.scrubberDragTime !== null) {
      cur = state.scrubberDragTime;
    }

    if (el.timeCurrent && !isDraggingScrubber) {
      el.timeCurrent.textContent = formatDuration(cur);
    }
    if (el.timeDuration && dur > 0) {
      el.timeDuration.textContent = formatDuration(dur);
    }

    const targetProgress = dur > 0 ? Math.max(0, Math.min(1, cur / dur)) : 0;
    const followSpeed = isDraggingScrubber ? 32 : 45;
    scrubProgress += (targetProgress - scrubProgress) * Math.min(1, dt * followSpeed);

    const padLeft = 5.5;
    const padRight = 5.5;
    const trackWidth = sw - padLeft - padRight;
    const knobCenterX = padLeft + scrubProgress * trackWidth;

    if (scrubPrevKnobX === null) scrubPrevKnobX = knobCenterX;
    const deltaX = knobCenterX - scrubPrevKnobX;
    scrubPrevKnobX = knobCenterX;

    const k = (2 * Math.PI) / 42;
    const isPlaying = window.MoonPlayer ? window.MoonPlayer.isPlaying() : false;

    // Smooth wave appearance / disappearance on play / pause
    const targetAmp = isPlaying ? 4.5 : 0.0;
    const ampSpeed = isPlaying ? 5.5 : 6.5;
    state.waveAmplitude = state.waveAmplitude !== undefined ? state.waveAmplitude : 0.0;
    state.waveAmplitude += (targetAmp - state.waveAmplitude) * Math.min(1, dt * ampSpeed);
    if (Math.abs(state.waveAmplitude - targetAmp) < 0.005) {
      state.waveAmplitude = targetAmp;
    }

    if (isDraggingScrubber) {
      scrubPhase += deltaX * k;
    } else if (isPlaying || state.waveAmplitude > 0.01) {
      scrubPhase += 3.5 * dt;
    }

    const knobW = isDraggingScrubber ? 9 : 7.5;
    const knobH = isDraggingScrubber ? 22 : 18;
    const knobR = isDraggingScrubber ? 4.5 : 3.75;
    const knobLeft = knobCenterX - knobW / 2;
    const waveStart = padLeft;
    const waveEnd = knobLeft - 4.5;
    const inactiveStart = knobCenterX + knobW / 2 + 4;
    const inactiveEnd = sw - padRight;
    const centerY = sh / 2;

    const primaryColor = getComputedStyle(document.documentElement).getPropertyValue('--md-sys-color-primary').trim() || '#D0BCFF';
    const dimColor = getComputedStyle(document.documentElement).getPropertyValue('--md-sys-color-surface-container-highest').trim() || '#333438';

    // Inactive background track
    if (inactiveEnd > inactiveStart) {
      ctx.save();
      ctx.globalAlpha = 0.35;
      ctx.beginPath();
      ctx.lineWidth = 8;
      ctx.lineCap = 'round';
      ctx.strokeStyle = dimColor;
      ctx.moveTo(inactiveStart, centerY);
      ctx.lineTo(inactiveEnd, centerY);
      ctx.stroke();
      ctx.restore();
    }

    // Active squiggly wave track
    if (waveEnd > waveStart) {
      ctx.beginPath();
      ctx.lineWidth = 8;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = primaryColor;

      if (state.waveAmplitude <= 0.01) {
        ctx.moveTo(waveStart, centerY);
        ctx.lineTo(waveEnd, centerY);
      } else {
        const waveLen = waveEnd - waveStart;
        const taper = Math.min(22, waveLen * 0.35);
        const step = 2;
        ctx.moveTo(waveStart, centerY);
        for (let x = waveStart; x <= waveEnd; x += step) {
          const angle = scrubPhase - (waveEnd - x) * k;
          let env = 1.0;
          if (taper > 0) {
            const dLeft = x - waveStart;
            const dRight = waveEnd - x;
            if (dLeft < taper) env = Math.min(env, dLeft / taper);
            if (dRight < taper) env = Math.min(env, dRight / taper);
            env = env * env * (3 - 2 * env);
          }
          const y = centerY + Math.sin(angle) * (state.waveAmplitude * env);
          ctx.lineTo(x, y);
        }
        ctx.lineTo(waveEnd, centerY);
      }
      ctx.stroke();
    }

    // Knob
    ctx.beginPath();
    ctx.roundRect(knobLeft, centerY - knobH / 2, knobW, knobH, knobR);
    ctx.fillStyle = primaryColor;
    ctx.fill();
  }

  // Visualizer Canvas Loop
  function drawVisualizer() {
    if (!el.visualizerCanvas) return;
    const ctx = el.visualizerCanvas.getContext('2d');
    ctx.clearRect(0, 0, 60, 24);

    const isPlaying = window.MoonPlayer ? window.MoonPlayer.isPlaying() : false;
    if (!isPlaying) return;

    const analyser = window.MoonPlayer ? window.MoonPlayer.getAnalyser() : null;
    const dataArray = window.MoonPlayer ? window.MoonPlayer.getDataArray() : null;

    if (analyser && dataArray) {
      analyser.getByteFrequencyData(dataArray);
      const barCount = 12;
      const barW = 3;
      const gap = 2;
      const startX = (60 - barCount * (barW + gap)) / 2;

      for (let i = 0; i < barCount; i++) {
        const val = dataArray[i * 2] || 0;
        let barH = (val / 255) * 20;
        if (barH < 2) barH = 2;
        const x = startX + i * (barW + gap);
        const y = 24 - barH;

        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.roundRect(x, y, barW, barH, 2);
        ctx.fill();
      }
    }
  }

  // Main Animation Loop
  function startVisualizerLoop() {
    if (animFrameId) return;

    function loop(timestamp) {
      animFrameId = requestAnimationFrame(loop);
      const dt = scrubLastTime === 0 ? 0.016 : Math.min((timestamp - scrubLastTime) / 1000, 0.1);
      scrubLastTime = timestamp;

      // Only draw when Riff mode is active
      const isRiffMode = document.body.classList.contains('mode-riff');
      if (isRiffMode) {
        drawSquiggly(timestamp, dt);
        drawVisualizer();
      }
    }

    animFrameId = requestAnimationFrame(loop);
  }

  // Equalizer & Audio Suite Modal
  // Equalizer & Audio Suite Modal
  function openAudioSuite(tab = 'eq') {
    if (!el.audioSettingsModal) return;
    closeDrawer();
    const isCurrentlyOpenWithSameTab = state.isAudioModalOpen && state.audioModalTab === tab;
    if (isCurrentlyOpenWithSameTab) {
      closeAudioSuite();
      return;
    }
    state.isAudioModalOpen = true;
    state.audioModalTab = tab;
    el.audioSettingsModal.classList.remove('hidden');
    el.audioSettingsModal.classList.add('visible');
    el.audioTabs.forEach((t) => {
      const match = t.getAttribute('data-audio-tab') === tab;
      t.classList.toggle('active', match);
    });
    el.audioPanels.forEach((p) => {
      const match = p.getAttribute('data-audio-panel') === tab;
      p.classList.toggle('active', match);
    });
    renderRiffEqPresets();
    updateEqSliders();
  }

  function closeAudioSuite() {
    if (el.audioSettingsModal) {
      el.audioSettingsModal.classList.remove('visible');
      el.audioSettingsModal.classList.add('hidden');
    }
    state.isAudioModalOpen = false;
    state.audioModalTab = null;
  }

  function renderRiffEqPresets() {
    const container = document.getElementById('riff-eq-presets-container');
    if (!container) return;

    if (!container._hasWheelListener) {
      container._hasWheelListener = true;
      container.addEventListener('wheel', (e) => {
        if (e.deltaY) {
          e.preventDefault();
          container.scrollLeft += e.deltaY;
        }
      }, { passive: false });
    }

    container.innerHTML = '';
    const presetMap = (window.MoonPlayer && typeof window.MoonPlayer.getEqPresets === 'function')
      ? window.MoonPlayer.getEqPresets()
      : null;
    const presets = presetMap ? Object.keys(presetMap) : ['Flat', 'Bass Boost', 'Bass Reducer', 'Deep Sub-bass', 'Mega Bass', 'Rock', 'Hard Rock / Metal', 'Pop', 'Jazz', 'Classical', 'Electronic / EDM', 'Hip-Hop / Rap', 'Acoustic', 'Vocal Booster', 'Vocal Cut', 'R&B / Soul', 'Dance / Club', 'Lounge / Chill', 'Loudness & Clarity', 'Gaming / Spatial'];
    const currentPreset = (window.MoonPlayer && typeof window.MoonPlayer.getCurrentEqPreset === 'function')
      ? window.MoonPlayer.getCurrentEqPreset()
      : 'Flat';

    const presetsList = (currentPreset === 'Custom' && !presets.includes('Custom'))
      ? ['Custom', ...presets]
      : presets;

    presetsList.forEach((preset) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = `riff-eq-chip ${preset === currentPreset ? 'active' : ''}`;
      chip.textContent = preset;
      chip.addEventListener('click', () => {
        if (preset === 'Custom') return;
        if (window.MoonPlayer && typeof window.MoonPlayer.applyEqPreset === 'function') {
          window.MoonPlayer.applyEqPreset(preset);
          showToast(`Preset: ${preset}`);
          updateEqSliders();
        }
      });
      container.appendChild(chip);
    });

    const activeChip = container.querySelector('.riff-eq-chip.active');
    if (activeChip && typeof activeChip.scrollIntoView === 'function') {
      try { activeChip.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' }); } catch (e) {}
    }
  }

  function initAudioModal() {
    if (!el.audioSettingsModal) return;

    if (el.btnOpenSettings) {
      el.btnOpenSettings.addEventListener('click', (e) => {
        e.stopPropagation();
        openAudioSuite('eq');
      });
    }
    const btnOpenEq = document.getElementById('btn-open-equalizer');
    if (btnOpenEq) {
      btnOpenEq.addEventListener('click', (e) => {
        e.stopPropagation();
        openAudioSuite('eq');
      });
    }

    if (el.btnCloseSettings) {
      el.btnCloseSettings.addEventListener('click', () => {
        closeAudioSuite();
      });
    }

    el.audioSettingsModal.addEventListener('click', (e) => {
      if (e.target === el.audioSettingsModal) {
        closeAudioSuite();
      }
    });

    // Audio Tabs
    el.audioTabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        const targetCat = tab.getAttribute('data-audio-tab');
        openAudioSuite(targetCat);
      });
    });

    // Populate 10-Band Equalizer Faders
    if (el.eqBandsContainer) {
      el.eqBandsContainer.innerHTML = '';
      const frequencies = (window.MoonPlayer && typeof window.MoonPlayer.getEqLabels === 'function')
        ? window.MoonPlayer.getEqLabels()
        : ['32', '64', '125', '250', '500', '1k', '2k', '4k', '8k', '16k'];
      frequencies.forEach((freq, idx) => {
        const band = document.createElement('div');
        band.className = 'eq-band';
        band.innerHTML = `
          <span class="eq-band-val" id="riff-eq-val-${idx}">0.0 dB</span>
          <div class="eq-slider-box">
            <input type="range" class="eq-band-range" id="riff-eq-slider-${idx}" min="-12" max="12" step="0.5" value="0" aria-label="${freq}Hz">
          </div>
          <span class="eq-band-freq">${freq}</span>
        `;
        const slider = band.querySelector('input');
        slider.addEventListener('input', (e) => {
          const val = parseFloat(e.target.value);
          const valEl = band.querySelector('.eq-band-val');
          if (valEl) valEl.textContent = `${val > 0 ? '+' : ''}${val.toFixed(1)} dB`;
          slider.style.background = 'transparent';
          if (window.MoonPlayer && typeof window.MoonPlayer.setEqGain === 'function') {
            window.MoonPlayer.setEqGain(idx, val);
          }
        });
        el.eqBandsContainer.appendChild(band);
      });
    }

    // Preamp slider
    const riffPreampSlider = document.getElementById('riff-eq-preamp-slider');
    const riffPreampVal = document.getElementById('riff-eq-preamp-val');
    if (riffPreampSlider) {
      riffPreampSlider.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        if (riffPreampVal) riffPreampVal.textContent = `${val > 0 ? '+' : ''}${val.toFixed(1)} dB`;
        const min = parseFloat(riffPreampSlider.min || -12);
        const max = parseFloat(riffPreampSlider.max || 12);
        const pct = Math.max(0, Math.min(100, ((val - min) / (max - min)) * 100));
        riffPreampSlider.style.setProperty('--slider-pct', `${pct}%`);
        riffPreampSlider.style.background = 'transparent';
        if (window.MoonPlayer && typeof window.MoonPlayer.setEqPreamp === 'function') {
          window.MoonPlayer.setEqPreamp(val);
        }
      });
    }

    // EQ Toggle
    const riffToggleEq = document.getElementById('riff-toggle-eq');
    const riffEqStatusLabel = document.getElementById('riff-eq-status-label');
    if (riffToggleEq) {
      riffToggleEq.addEventListener('change', (e) => {
        const en = e.target.checked;
        if (riffEqStatusLabel) {
          riffEqStatusLabel.textContent = en ? 'ENABLED' : 'DISABLED';
          riffEqStatusLabel.style.color = en ? 'var(--md-sys-color-primary)' : 'var(--md-sys-color-outline)';
        }
        if (window.MoonPlayer && typeof window.MoonPlayer.setEqEnabled === 'function') {
          window.MoonPlayer.setEqEnabled(en);
        }
      });
    }

    // Reset EQ
    if (el.btnResetEqBands) {
      el.btnResetEqBands.addEventListener('click', () => {
        if (window.MoonPlayer && typeof window.MoonPlayer.resetEq === 'function') {
          window.MoonPlayer.resetEq();
          updateEqSliders();
          showToast('Equalizer reset to Flat (0 dB)');
        }
      });
    }

    // Reset all audio settings
    if (el.btnResetAudio) {
      el.btnResetAudio.addEventListener('click', () => {
        if (window.MoonPlayer) {
          if (typeof window.MoonPlayer.resetEq === 'function') window.MoonPlayer.resetEq();
          if (typeof window.MoonPlayer.setPlaybackRate === 'function') window.MoonPlayer.setPlaybackRate(1.0);
          if (el.sliderSpeed) el.sliderSpeed.value = 1.0;
          if (el.valSpeed) el.valSpeed.textContent = '1.00x';
          updateEqSliders();
          showToast('Audio settings reset');
        }
      });
    }

    // Speed Slider
    if (el.sliderSpeed) {
      el.sliderSpeed.addEventListener('input', (e) => {
        const rate = parseFloat(e.target.value);
        if (el.valSpeed) el.valSpeed.textContent = `${rate.toFixed(2)}x`;
        if (window.MoonPlayer) window.MoonPlayer.setPlaybackRate(rate);
      });
    }

    // Sleep Timer Buttons
    el.sleepButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        el.sleepButtons.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        const mins = btn.getAttribute('data-sleep-minutes');
        if (window.MoonPlayer) {
          if (mins === 'off') {
            window.MoonPlayer.setSleepTimer('off');
            if (el.sleepTimerStatus) el.sleepTimerStatus.textContent = 'Off';
            showToast('Sleep timer turned off');
          } else if (mins === 'end') {
            window.MoonPlayer.setSleepTimer(999);
            if (el.sleepTimerStatus) el.sleepTimerStatus.textContent = 'End of track';
            showToast('Sleep timer: End of track');
          } else {
            const num = parseInt(mins, 10);
            window.MoonPlayer.setSleepTimer(num);
            if (el.sleepTimerStatus) el.sleepTimerStatus.textContent = `${num} min`;
            showToast(`Sleep timer set for ${num} minutes`);
          }
        }
      });
    });

    // Subscribe to MoonPlayer equalizerChange event
    if (window.MoonPlayer && typeof window.MoonPlayer.on === 'function') {
      window.MoonPlayer.on('equalizerChange', () => {
        updateEqSliders();
      });
    }
  }

  function updateEqSliders() {
    if (!window.MoonPlayer) return;
    const bands = window.MoonPlayer.getEqValues ? window.MoonPlayer.getEqValues() : (window.MoonPlayer.getEqBands ? window.MoonPlayer.getEqBands() : []);
    bands.forEach((val, idx) => {
      const slider = document.getElementById(`riff-eq-slider-${idx}`);
      const valEl = document.getElementById(`riff-eq-val-${idx}`);
      if (slider) {
        slider.value = val;
        const min = parseFloat(slider.min || -12);
        const max = parseFloat(slider.max || 12);
        const pct = Math.max(0, Math.min(100, ((val - min) / (max - min)) * 100));
        slider.style.background = `linear-gradient(to right, var(--md-sys-color-primary, #D0BCFF) 0%, var(--md-sys-color-primary, #D0BCFF) ${pct}%, var(--md-sys-color-surface-container-highest, #333438) ${pct}%, var(--md-sys-color-surface-container-highest, #333438) 100%)`;
      }
      if (valEl) valEl.textContent = `${val > 0 ? '+' : ''}${Number(val).toFixed(1)} dB`;
    });

    // Update active preset chip
    const currentPreset = window.MoonPlayer.getCurrentEqPreset ? window.MoonPlayer.getCurrentEqPreset() : 'Flat';
    let found = false;
    document.querySelectorAll('.riff-eq-chip').forEach((chip) => {
      const match = chip.textContent.trim() === currentPreset;
      chip.classList.toggle('active', match);
      if (match) found = true;
    });
    if (!found && currentPreset === 'Custom') {
      renderRiffEqPresets();
    }

    // Update Preamp
    const preampVal = window.MoonPlayer.getEqPreamp ? window.MoonPlayer.getEqPreamp() : 0;
    const riffPreampSlider = document.getElementById('riff-eq-preamp-slider');
    const riffPreampVal = document.getElementById('riff-eq-preamp-val');
    if (riffPreampSlider) {
      riffPreampSlider.value = preampVal;
      const min = parseFloat(riffPreampSlider.min || -12);
      const max = parseFloat(riffPreampSlider.max || 12);
      const pct = Math.max(0, Math.min(100, ((preampVal - min) / (max - min)) * 100));
      riffPreampSlider.style.background = `linear-gradient(to right, var(--md-sys-color-primary, #D0BCFF) 0%, var(--md-sys-color-primary, #D0BCFF) ${pct}%, var(--md-sys-color-surface-container-highest, #333438) ${pct}%, var(--md-sys-color-surface-container-highest, #333438) 100%)`;
    }
    if (riffPreampVal) riffPreampVal.textContent = `${preampVal > 0 ? '+' : ''}${Number(preampVal).toFixed(1)} dB`;

    // Update Toggle
    const isEn = window.MoonPlayer.isEqEnabled ? window.MoonPlayer.isEqEnabled() : true;
    const riffToggleEq = document.getElementById('riff-toggle-eq');
    const riffEqStatusLabel = document.getElementById('riff-eq-status-label');
    if (riffToggleEq) riffToggleEq.checked = isEn;
    if (riffEqStatusLabel) {
      riffEqStatusLabel.textContent = isEn ? 'ENABLED' : 'DISABLED';
      riffEqStatusLabel.style.color = isEn ? 'var(--md-sys-color-primary)' : 'var(--md-sys-color-outline)';
    }
  }

  if (!window.RiffUI) window.RiffUI = {};
  Object.assign(window.RiffUI, {
    openEqualizer: () => openAudioSuite('eq'),
    closeEqualizer: () => closeAudioSuite(),
    openAudioSuite: openAudioSuite,
    closeAudioSuite: closeAudioSuite
  });

  // Synced Lyrics Drawer
  function toggleLyricsPanel() {
    state.isLyricsOpen = !state.isLyricsOpen;
    if (el.lyricsPanel) {
      el.lyricsPanel.classList.toggle('hidden', !state.isLyricsOpen);
      if (state.isLyricsOpen) {
        const currentSong = window.MoonPlayer ? window.MoonPlayer.getCurrentSong() : state.currentTrack;
        if (currentSong) {
          if (el.rightPanelTitle) el.rightPanelTitle.textContent = currentSong.title || 'Untitled';
          if (el.rightPanelArtist) el.rightPanelArtist.textContent = currentSong.artist || 'Unknown Artist';
          if (el.rightPanelCover) el.rightPanelCover.src = getTrackThumb(currentSong);
        }
        renderLyrics();
      }
    }
  }

  function renderLyrics() {
    if (!el.lyricsContainer) return;
    const lyrics = window.MoonPlayer ? window.MoonPlayer.getCurrentLyrics() : [];
    const hasLyrics = Array.isArray(lyrics) && lyrics.length > 0;

    if (el.lyricsPanel) {
      el.lyricsPanel.classList.toggle('lyrics-empty', !hasLyrics);
    }

    el.lyricsContainer.innerHTML = '';

    if (!hasLyrics) {
      el.lyricsContainer.innerHTML = '<div class="empty-hint" style="text-align: center; padding: 40px 16px; color: var(--md-sys-color-outline);">No synced lyrics available for this track.</div>';
      return;
    }

    lyrics.forEach((line, idx) => {
      const div = document.createElement('div');
      div.className = 'lyric-line';
      div.dataset.idx = idx;
      div.style.setProperty('--dist', idx);
      div.textContent = line.text;
      div.addEventListener('click', () => {
        if (window.MoonPlayer && Number.isFinite(line.time)) {
          window.MoonPlayer.seek(line.time);
        }
      });
      el.lyricsContainer.appendChild(div);
    });

    state.lastActiveLyricIdx = -999;
    updateLyricsHighlight();
  }

  function updateLyricsHighlight() {
    const activeIdx = window.MoonPlayer ? window.MoonPlayer.getActiveLyricIndex() : -1;
    if (activeIdx === state.lastActiveLyricIdx) return;
    state.lastActiveLyricIdx = activeIdx;

    // Highlight in lyrics panel
    if (el.lyricsContainer) {
      const lines = el.lyricsContainer.querySelectorAll('.lyric-line');
      lines.forEach((l, idx) => {
        const dist = Math.abs(idx - activeIdx);
        l.style.setProperty('--dist', dist);
        if (idx === activeIdx) {
          l.classList.add('active');
          const container = el.lyricsContainer;
          const targetTop = l.offsetTop - (container.clientHeight / 2) + (l.clientHeight / 2);
          container.scrollTo({ top: Math.max(0, targetTop), behavior: 'smooth' });
        } else {
          l.classList.remove('active');
        }
      });
    }

    // Highlight in TV Karaoke
    if (state.isTvKaraokeOpen && el.tvKaraokeContent) {
      const tvLines = el.tvKaraokeContent.querySelectorAll('.tvk-lyric-line');
      tvLines.forEach((l, idx) => {
        const dist = Math.abs(idx - activeIdx);
        if (idx === activeIdx) {
          l.classList.add('active');
          l.style.color = '#ffffff';
          l.style.transform = 'scale(1.12)';
          l.style.opacity = '1';
          const container = el.tvKaraokeContent;
          const targetTop = l.offsetTop - (container.clientHeight / 2) + (l.clientHeight / 2);
          container.scrollTo({ top: Math.max(0, targetTop), behavior: 'smooth' });
        } else {
          l.classList.remove('active');
          l.style.color = 'rgba(255, 255, 255, 0.35)';
          l.style.transform = 'scale(1)';
          l.style.opacity = Math.max(0.2, 1 - dist * 0.25);
        }
      });
    }

    // Keep window and document locked to prevent scroll displacement
    if (window.scrollY !== 0 || document.documentElement.scrollTop !== 0) {
      window.scrollTo(0, 0);
    }
  }

  // Fullscreen TV Karaoke Mode
  function toggleTvKaraoke() {
    state.isTvKaraokeOpen = !state.isTvKaraokeOpen;
    if (el.tvKaraoke) {
      el.tvKaraoke.classList.toggle('hidden', !state.isTvKaraokeOpen);
      if (state.isTvKaraokeOpen) {
        renderTvKaraoke();
      }
    }
  }

  function renderTvKaraoke() {
    if (!el.tvKaraokeContent) return;
    el.tvKaraokeContent.innerHTML = '';
    const lyrics = window.MoonPlayer ? window.MoonPlayer.getCurrentLyrics() : [];
    const currentSong = window.MoonPlayer ? window.MoonPlayer.getCurrentSong() : null;

    if (currentSong) {
      if (el.tvCover) el.tvCover.src = getTrackThumb(currentSong);
      if (el.tvKaraokeTitle) el.tvKaraokeTitle.textContent = currentSong.title || 'Untitled';
      if (el.tvKaraokeArtist) el.tvKaraokeArtist.textContent = currentSong.artist || 'Unknown Artist';
    }

    if (!lyrics || lyrics.length === 0) {
      el.tvKaraokeContent.innerHTML = '<div style="font-size: 24px; color: rgba(255,255,255,0.5); text-align: center; margin-top: 100px;">No synced lyrics available.</div>';
      return;
    }

    lyrics.forEach((line, idx) => {
      const p = document.createElement('p');
      p.className = 'tvk-lyric-line';
      p.style.cssText = `
        font-size: 32px;
        font-weight: 700;
        color: rgba(255, 255, 255, 0.35);
        margin: 18px 0;
        cursor: pointer;
        transition: all 0.3s cubic-bezier(0.2, 0, 0, 1);
        text-align: center;
      `;
      p.textContent = line.text;
      p.addEventListener('click', () => {
        if (window.MoonPlayer && Number.isFinite(line.time)) {
          window.MoonPlayer.seek(line.time);
        }
      });
      el.tvKaraokeContent.appendChild(p);
    });

    updateLyricsHighlight();
  }

  // Playlist Modals
  function promptCreatePlaylist() {
    if (el.createPlaylistModal) {
      el.createPlaylistModal.classList.remove('hidden');
      if (el.newPlaylistInput) {
        el.newPlaylistInput.value = '';
        el.newPlaylistInput.focus();
      }
    }
  }

  function promptAddToPlaylist(track) {
    const playlists = window.MoonPlayer ? window.MoonPlayer.getPlaylists() : {};
    const names = Object.keys(playlists).filter((n) => n !== 'Liked');
    if (names.length === 0) {
      showToast('Create a playlist first in the Playlists drawer!');
      toggleDrawer('playlists');
      return;
    }

    // Modal picker for playlists
    const modal = document.createElement('div');
    modal.className = 'modal-backdrop';
    modal.style.cssText = 'position: fixed; inset: 0; background: rgba(0,0,0,0.7); z-index: 100; display: flex; align-items: center; justify-content: center;';
    modal.innerHTML = `
      <div class="dialog-card" style="width: 360px; background: var(--md-sys-color-surface-container, #1e1f22); padding: 24px; border-radius: 20px;">
        <h3 style="margin-top: 0; color: #fff; font-size: 18px;">Add to Playlist</h3>
        <p style="font-size: 13px; color: var(--md-sys-color-outline); margin-bottom: 16px;">Choose a playlist for "${escapeHtml(track.title)}"</p>
        <div class="pl-choice-list" style="display: flex; flex-direction: column; gap: 8px; max-height: 200px; overflow-y: auto;">
          ${names.map((n) => `<button class="btn-outline-pill pl-opt" data-pl="${escapeHtml(n)}" style="text-align: left; padding: 10px 14px; font-size: 13px;">${escapeHtml(n)}</button>`).join('')}
        </div>
        <div style="margin-top: 18px; display: flex; justify-content: flex-end;">
          <button class="btn-outline-pill btn-cancel-pl" style="padding: 8px 16px;">Cancel</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    modal.querySelectorAll('.pl-opt').forEach((btn) => {
      btn.addEventListener('click', () => {
        const plName = btn.getAttribute('data-pl');
        if (window.MoonPlayer) {
          window.MoonPlayer.addTrackToPlaylist(plName, track);
          showToast(`Added to "${plName}"`);
        }
        modal.remove();
      });
    });

    modal.querySelector('.btn-cancel-pl').addEventListener('click', () => modal.remove());
  }

  // Bind Event Listeners
  function bindEvents() {
    // Scroll guard: prevent any scroll displacement on window and root containers
    window.addEventListener('scroll', () => {
      if (window.scrollX !== 0 || window.scrollY !== 0) {
        window.scrollTo(0, 0);
      }
    }, { passive: true });

    const riffRootEl = document.getElementById('riff-root');
    if (riffRootEl) {
      riffRootEl.addEventListener('scroll', () => {
        if (riffRootEl.scrollTop !== 0) riffRootEl.scrollTop = 0;
        if (riffRootEl.scrollLeft !== 0) riffRootEl.scrollLeft = 0;
      }, { passive: true });
    }
    // 1. UI Switcher Button in Titlebar -> Switch to MoonPlayer Classic
    if (el.btnSwitchToMoon) {
      el.btnSwitchToMoon.addEventListener('click', () => {
        if (window.MoonPlayer) {
          window.MoonPlayer.setUIMode('moon');
          showToast('Switched to MoonPlayer Classic UI');
        }
      });
    }

    // 2. Window Controls for Tauri
    const getTauriWin = () => {
      try {
        if (window.__TAURI__?.window?.getCurrentWindow) return window.__TAURI__.window.getCurrentWindow();
        if (window.__TAURI__?.webviewWindow?.getCurrentWebviewWindow) return window.__TAURI__.webviewWindow.getCurrentWebviewWindow();
        if (window.__TAURI_INTERNALS__) return window.__TAURI_INTERNALS__;
      } catch (_) {}
      return null;
    };

    if (el.btnMinimize) {
      el.btnMinimize.addEventListener('click', () => {
        const win = getTauriWin();
        if (win && typeof win.minimize === 'function') win.minimize();
      });
    }
    if (el.btnMaximize) {
      el.btnMaximize.addEventListener('click', () => {
        const win = getTauriWin();
        if (win && typeof win.toggleMaximize === 'function') win.toggleMaximize();
      });
    }
    if (el.btnClose) {
      el.btnClose.addEventListener('click', () => {
        const win = getTauriWin();
        if (win && typeof win.close === 'function') win.close();
        else window.close();
      });
    }

    // 3. Navigation Rail items
    if (el.navPlaylists) el.navPlaylists.addEventListener('click', () => switchView('playlists'));
    if (el.navFavorites) el.navFavorites.addEventListener('click', () => switchView('favorites'));
    if (el.navLocal) {
      el.navLocal.addEventListener('click', () => {
        if (state.platform === 'soundcloud') {
          switchView('soundcloud');
        } else {
          switchView('local');
        }
      });
    }
    if (el.navHistory) el.navHistory.addEventListener('click', () => switchView('history'));
    if (el.navSoundcloud) el.navSoundcloud.addEventListener('click', () => switchView('soundcloud'));
    if (el.navQueue) el.navQueue.addEventListener('click', () => switchView('queue'));
    if (el.navSettings) el.navSettings.addEventListener('click', () => switchView('settings'));

    // Top Header Platform Switcher (Local vs SoundCloud)
    const platformBtnLocal = document.getElementById('platform-btn-local');
    const platformBtnSoundCloud = document.getElementById('platform-btn-soundcloud');

    function setActivePlatform(plat, doSwitchView = true) {
      state.platform = plat;
      if (platformBtnLocal) platformBtnLocal.classList.toggle('active', plat === 'local');
      if (platformBtnSoundCloud) platformBtnSoundCloud.classList.toggle('active', plat === 'soundcloud');

      if (el.searchInput) {
        el.searchInput.placeholder = (plat === 'soundcloud')
          ? 'Search SoundCloud tracks, artists...'
          : 'Search tracks, artists, or albums...';
      }

      if (doSwitchView) {
        if (plat === 'soundcloud' && state.currentView === 'local') {
          switchView('soundcloud');
        } else if (plat === 'local' && state.currentView === 'soundcloud') {
          switchView('local');
        }
      }

      if (el.searchInput && el.searchInput.value.trim()) {
        performSearch(el.searchInput.value);
      }
    }

    if (platformBtnLocal) {
      platformBtnLocal.addEventListener('click', () => setActivePlatform('local'));
    }
    if (platformBtnSoundCloud) {
      platformBtnSoundCloud.addEventListener('click', () => setActivePlatform('soundcloud'));
    }

    // SoundCloud subtabs & buttons
    const scSubtabBtns = document.querySelectorAll('.sc-subtab');
    scSubtabBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const sctab = btn.getAttribute('data-sctab') || 'trending';
        renderSoundCloudView(sctab);
      });
    });
    const btnScRefresh = document.getElementById('btn-sc-refresh');
    if (btnScRefresh) {
      btnScRefresh.addEventListener('click', () => {
        const classicRefresh = document.getElementById('soundcloud-refresh-btn');
        if (classicRefresh) classicRefresh.click();
        showToast('Refreshing SoundCloud tracks...');
        setTimeout(() => renderSoundCloudView(), 1500);
      });
    }

    // Rail Button 6: Equalizer
    if (el.btnTogglePresetsDrawer) {
      el.btnTogglePresetsDrawer.addEventListener('click', (e) => {
        e.stopPropagation();
        openAudioSuite('eq');
      });
    }
    // Rail Button 7: Audio FX & Presets
    if (el.btnTogglePlaylistsDrawer) {
      el.btnTogglePlaylistsDrawer.addEventListener('click', (e) => {
        e.stopPropagation();
        openAudioSuite('effects');
      });
    }
    if (el.btnCloseRailDrawer) {
      el.btnCloseRailDrawer.addEventListener('click', () => closeDrawer());
    }
    const railBackdrop = document.getElementById('rail-drawer-backdrop');
    if (railBackdrop) {
      railBackdrop.addEventListener('click', () => closeDrawer());
    }

    // Back buttons
    if (el.btnBackPlaylists) el.btnBackPlaylists.addEventListener('click', () => navigateBack());
    if (el.btnBackAlbum) el.btnBackAlbum.addEventListener('click', () => navigateBack());
    if (el.btnBackArtist) el.btnBackArtist.addEventListener('click', () => navigateBack());

    // Playlists View buttons
    if (el.btnCreatePlaylistView) {
      el.btnCreatePlaylistView.addEventListener('click', () => promptCreatePlaylist());
    }
    if (el.playlistsSearchInput) {
      el.playlistsSearchInput.addEventListener('input', () => renderPlaylistsView());
    }

    // Search bar
    let mainSearchDebounceTimer = null;
    if (el.searchInput) {
      el.searchInput.addEventListener('input', (e) => {
        const rawVal = e.target.value;
        const val = rawVal.trim();
        if (val) {
          if (state.currentView !== 'search') {
            state.prevView = state.currentView;
            switchView('search');
          }
        } else {
          if (state.currentView === 'search') {
            switchView((state.prevView && state.prevView !== 'search') ? state.prevView : (state.platform === 'soundcloud' ? 'soundcloud' : 'local'));
          }
        }
        if (el.searchClearBtn) {
          el.searchClearBtn.classList.toggle('hidden', !rawVal);
        }
        if (mainSearchDebounceTimer) clearTimeout(mainSearchDebounceTimer);
        mainSearchDebounceTimer = setTimeout(() => {
          performSearch(rawVal);
        }, 120);
      });
    }

    // In-tab search & sort inputs (Issue 4)
    if (el.localSearchInput) {
      el.localSearchInput.addEventListener('input', () => {
        if (localSearchDebounce) clearTimeout(localSearchDebounce);
        localSearchDebounce = setTimeout(() => {
          renderLocalView();
        }, 150);
      });
    }
    if (el.favoritesSearchInput) {
      el.favoritesSearchInput.addEventListener('input', () => {
        renderFavoritesView();
      });
    }
    if (el.favoritesSort) {
      el.favoritesSort.addEventListener('change', () => {
        renderFavoritesView();
      });
    }
    if (el.searchClearBtn) {
      el.searchClearBtn.addEventListener('click', () => {
        if (mainSearchDebounceTimer) {
          clearTimeout(mainSearchDebounceTimer);
          mainSearchDebounceTimer = null;
        }
        if (el.searchInput) {
          el.searchInput.value = '';
          el.searchClearBtn.classList.add('hidden');
          if (state.currentView === 'search') {
            switchView((state.prevView && state.prevView !== 'search') ? state.prevView : (state.platform === 'soundcloud' ? 'soundcloud' : 'local'));
          }
          performSearch('');
        }
      });
    }

    // Infinite progressive scroll for local view, queue & search results
    if (el.mainContent) {
      el.mainContent.addEventListener('scroll', () => {
        const remaining = el.mainContent.scrollHeight - el.mainContent.scrollTop - el.mainContent.clientHeight;
        if (remaining < 800) {
          if (state.currentView === 'local') {
            appendLocalTracksChunk();
          } else if (state.currentView === 'queue') {
            appendQueueTracksChunk();
          } else if (state.currentView === 'search' && state.searchQuery) {
            appendSearchTracksChunk();
          } else if (state.currentView === 'favorites' && (!el.favoritesSearchInput || !el.favoritesSearchInput.value.trim())) {
            appendFavoritesTracksChunk();
          }
        }
      }, { passive: true });
    }

    // Initialize M3 Settings View controls
    initSettingsView();

    // Playbar Controls
    if (el.btnPlayPause) {
      el.btnPlayPause.addEventListener('click', () => {
        if (window.MoonPlayer) window.MoonPlayer.togglePlayPause();
      });
    }
    if (el.btnPrev) {
      el.btnPrev.addEventListener('click', () => {
        if (window.MoonPlayer) window.MoonPlayer.prev();
      });
    }
    if (el.btnNext) {
      el.btnNext.addEventListener('click', () => {
        if (window.MoonPlayer) window.MoonPlayer.next();
      });
    }
    if (el.btnShuffle) {
      el.btnShuffle.addEventListener('click', () => {
        if (window.MoonPlayer) {
          window.MoonPlayer.toggleShuffle();
          state.isShuffle = window.MoonPlayer.isShuffle();
          el.btnShuffle.classList.toggle('active', state.isShuffle);
        }
      });
    }
    if (el.btnRepeat) {
      el.btnRepeat.addEventListener('click', () => {
        if (window.MoonPlayer) {
          window.MoonPlayer.toggleLoop();
          state.repeatMode = window.MoonPlayer.getLoopMode();
          updateRepeatUI(state.repeatMode);
        }
      });
    }
    if (el.playbarTitle) {
      el.playbarTitle.addEventListener('click', () => {
        if (!state.currentTrack) return;
        const song = state.currentTrack;
        const alb = song.album;
        if (alb && alb.toLowerCase() !== 'unknown album') {
          openAlbum({
            albumKey: song.albumKey,
            title: alb,
            artist: song.artist,
            cover: song.folderCoverUrl || song.cover,
            tracks: [song]
          });
        } else {
          switchView('local');
          if (el.localSearchInput) {
            el.localSearchInput.value = state.currentTrack.title || '';
          }
          renderLocalView();
        }
      });
    }
    if (el.playbarArtist) {
      el.playbarArtist.addEventListener('click', () => {
        if (!state.currentTrack || !state.currentTrack.artist) return;
        openArtistProfile(state.currentTrack.artist);
      });
    }
    if (el.btnToggleFav) {
      el.btnToggleFav.addEventListener('click', () => {
        if (window.MoonPlayer && state.currentTrack) {
          window.MoonPlayer.toggleLike(state.currentTrack);
          const nowFav = window.MoonPlayer.isLiked(state.currentTrack);
          if (el.favIcon) el.favIcon.setAttribute('fill', nowFav ? 'currentColor' : 'none');
          updateCounters();
        }
      });
    }

    // Right-Click Context Menu on Playbar Bottom-Left (Art, Title, Artist, Meta)
    const handleBottomLeftContextMenu = (e) => {
      if (e.target.closest('#btn-toggle-fav')) return;
      const currentSong = (window.MoonPlayer && typeof window.MoonPlayer.getCurrentSong === 'function')
        ? window.MoonPlayer.getCurrentSong()
        : state.currentTrack;
      if (currentSong && window.MoonPlayer && typeof window.MoonPlayer.showTrackContextMenu === 'function') {
        e.preventDefault();
        e.stopPropagation();
        window.MoonPlayer.showTrackContextMenu(e, currentSong);
      }
    };

    const playbarLeftEl = document.querySelector('.playbar-left');
    if (playbarLeftEl) playbarLeftEl.addEventListener('contextmenu', handleBottomLeftContextMenu);
    if (el.playbarTitle) el.playbarTitle.addEventListener('contextmenu', handleBottomLeftContextMenu);
    if (el.playbarArtist) el.playbarArtist.addEventListener('contextmenu', handleBottomLeftContextMenu);
    const artWrapper = document.getElementById('playbar-artwork-wrapper');
    if (artWrapper) artWrapper.addEventListener('contextmenu', handleBottomLeftContextMenu);

    // Close drawers on outside click
    document.addEventListener('pointerdown', (e) => {
      if (!state.isDrawerOpen) return;
      if (el.railDrawer && el.railDrawer.contains(e.target)) return;
      if (e.target.closest('#btn-toggle-playlists-drawer') || e.target.closest('#btn-toggle-presets-drawer')) return;
      closeDrawer();
    });

    // Volume & Mute
    if (el.volumeSlider) {
      el.volumeSlider.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        state.volume = val;
        state.isMuted = val === 0;
        if (window.MoonPlayer) window.MoonPlayer.setVolume(val);
        updateVolumeFill();
        updateVolumeIcon();
      });
    }
    if (el.btnVolumeMute) {
      el.btnVolumeMute.addEventListener('click', () => {
        if (window.MoonPlayer) {
          window.MoonPlayer.toggleMute();
          const audio = window.MoonPlayer.getAudio();
          const savedVol = localStorage.getItem('moonplayer_volume');
          if (audio) {
            state.volume = audio.muted ? 0 : (savedVol !== null ? parseFloat(savedVol) : audio.volume);
            state.isMuted = audio.muted || state.volume === 0;
            if (el.volumeSlider) {
              el.volumeSlider.value = state.volume;
              updateVolumeFill();
            }
            updateVolumeIcon();
          }
        }
      });
    }

    // Lyrics Drawer & Fullscreen TV Karaoke
    if (el.btnToggleLyricsPanel) {
      el.btnToggleLyricsPanel.addEventListener('click', () => toggleLyricsPanel());
    }
    if (el.btnCloseLyrics) {
      el.btnCloseLyrics.addEventListener('click', () => toggleLyricsPanel());
    }
    const btnTvKaraoke = document.getElementById('btn-tv-karaoke');
    if (btnTvKaraoke) {
      btnTvKaraoke.addEventListener('click', () => toggleTvKaraoke());
    }
    if (el.btnCloseTvKaraoke) {
      el.btnCloseTvKaraoke.addEventListener('click', () => toggleTvKaraoke());
    }

    // TV Karaoke Play Controls
    if (el.btnTvkPlay) {
      el.btnTvkPlay.addEventListener('click', () => {
        if (window.MoonPlayer) window.MoonPlayer.togglePlayPause();
      });
    }
    if (el.btnTvkPrev) {
      el.btnTvkPrev.addEventListener('click', () => {
        if (window.MoonPlayer) window.MoonPlayer.prev();
      });
    }
    if (el.btnTvkNext) {
      el.btnTvkNext.addEventListener('click', () => {
        if (window.MoonPlayer) window.MoonPlayer.next();
      });
    }

    // Discover Hero Wave buttons
    if (el.btnPlayMyWave) {
      el.btnPlayMyWave.addEventListener('click', () => {
        if (state.waveTracks && state.waveTracks.length > 0 && window.MoonPlayer) {
          window.MoonPlayer.playTrack(state.waveTracks[0]);
        }
      });
    }
    if (el.btnRefreshVibe) {
      el.btnRefreshVibe.addEventListener('click', () => {
        refreshWaveTracks();
        renderDiscoverView();
        showToast('Refreshed My Wave mix');
      });
    }

    // Local Files "Add Files"
    if (el.btnAddLocalFiles) {
      el.btnAddLocalFiles.addEventListener('click', () => {
        if (window.MoonPlayer) window.MoonPlayer.openFolderPicker();
      });
    }

    // Playlist Creation Modal
    if (el.btnNewPlaylist) {
      el.btnNewPlaylist.addEventListener('click', () => promptCreatePlaylist());
    }
    if (el.btnConfirmNewPlaylist) {
      el.btnConfirmNewPlaylist.addEventListener('click', () => {
        const name = (el.newPlaylistInput ? el.newPlaylistInput.value : '').trim();
        if (name && window.MoonPlayer) {
          window.MoonPlayer.createPlaylist(name);
          if (el.createPlaylistModal) el.createPlaylistModal.classList.add('hidden');
          renderPlaylistsDrawer();
          if (state.currentView === 'playlists') renderPlaylistsView();
          showToast(`Created playlist "${name}"`);
        }
      });
    }
    if (el.btnCancelNewPlaylist) {
      el.btnCancelNewPlaylist.addEventListener('click', () => {
        if (el.createPlaylistModal) el.createPlaylistModal.classList.add('hidden');
      });
    }

    // Delete Playlist
    if (el.btnDeletePlaylist) {
      el.btnDeletePlaylist.addEventListener('click', () => {
        if (state.selectedPlaylist && window.MoonPlayer) {
          if (confirm(`Delete playlist "${state.selectedPlaylist}"?`)) {
            const plName = state.selectedPlaylist;
            state.selectedPlaylist = null;
            window.MoonPlayer.deletePlaylist(plName);
            showToast(`Deleted playlist "${plName}"`);
            switchView('playlists');
            renderPlaylistsDrawer();
            renderPlaylistsView();
          }
        }
      });
    }

    // Rename Playlist
    const btnRenamePlaylist = document.getElementById('btn-rename-playlist');
    if (btnRenamePlaylist) {
      btnRenamePlaylist.addEventListener('click', () => {
        if (!state.selectedPlaylist || !window.MoonPlayer) return;
        const oldName = state.selectedPlaylist;
        const newName = prompt(`Rename playlist "${oldName}" to:`, oldName);
        if (newName && newName.trim() && newName.trim() !== oldName) {
          const trimmed = newName.trim();
          const playlists = window.MoonPlayer.getPlaylists();
          if (playlists[trimmed]) {
            showToast(`Playlist "${trimmed}" already exists`);
            return;
          }
          playlists[trimmed] = [...(playlists[oldName] || [])];
          delete playlists[oldName];
          if (typeof window.MoonPlayer.savePlaylists === 'function') {
            window.MoonPlayer.savePlaylists();
          } else {
            localStorage.setItem('moonplayer_playlists', JSON.stringify(playlists));
            window.MoonPlayer.emit('playlistsChange', playlists);
          }
          state.selectedPlaylist = trimmed;
          showToast(`Renamed to "${trimmed}"`);
          renderPlaylistDetail(trimmed);
          renderPlaylistsDrawer();
          if (state.currentView === 'playlists') renderPlaylistsView();
        }
      });
    }

    // Add all playlist tracks to favorites
    const btnFavAllPlaylist = document.getElementById('btn-fav-all-playlist');
    if (btnFavAllPlaylist) {
      btnFavAllPlaylist.addEventListener('click', () => {
        if (!state.selectedPlaylist || !window.MoonPlayer) return;
        const playlists = window.MoonPlayer.getPlaylists();
        const trackPaths = playlists[state.selectedPlaylist] || [];
        const allSongs = window.MoonPlayer.getAllSongs();
        let addedCount = 0;
        trackPaths.forEach((pathOrUri) => {
          const s = allSongs.find((item) => item.path === pathOrUri || (item.id && `soundcloud:${item.id}` === pathOrUri));
          if (s && !window.MoonPlayer.isLiked(s)) {
            window.MoonPlayer.toggleLike(s);
            addedCount++;
          }
        });
        updateCounters();
        showToast(`Added ${addedCount} tracks to favorites`);
      });
    }

    // Clear Queue
    if (el.btnClearQueue) {
      el.btnClearQueue.addEventListener('click', () => {
        if (window.MoonPlayer && typeof window.MoonPlayer.setQueue === 'function') {
          const current = window.MoonPlayer.getCurrentSong();
          window.MoonPlayer.setQueue(current ? [current] : [], 0);
          renderQueueView();
          showToast('Queue cleared');
        }
      });
    }

    // Clear History
    if (el.btnClearHistory) {
      el.btnClearHistory.addEventListener('click', () => {
        state.recentHistory = [];
        if (window._playbackHistory) window._playbackHistory = [];
        renderHistoryView();
        showToast('History cleared');
      });
    }

    // UI Mode Toggle inside Settings
    if (el.uiOptRiff) {
      el.uiOptRiff.addEventListener('click', () => {
        if (window.MoonPlayer) window.MoonPlayer.setUIMode('riff');
      });
    }
    if (el.uiOptMoon) {
      el.uiOptMoon.addEventListener('click', () => {
        if (window.MoonPlayer) window.MoonPlayer.setUIMode('moon');
      });
    }


    // Global Keyboard Shortcuts
    window.addEventListener('keydown', (e) => {
      if (!document.body.classList.contains('mode-riff')) return;
      const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
      if (activeTag === 'input' || activeTag === 'textarea' || document.activeElement.isContentEditable) {
        return;
      }

      if (e.code === 'Space') {
        e.preventDefault();
        if (window.MoonPlayer) window.MoonPlayer.togglePlayPause();
      } else if (e.code === 'KeyF' && !e.ctrlKey) {
        e.preventDefault();
        toggleTvKaraoke();
      } else if (e.code === 'KeyL' && !e.ctrlKey) {
        e.preventDefault();
        toggleLyricsPanel();
      } else if (e.code === 'KeyM' && !e.ctrlKey) {
        e.preventDefault();
        if (window.MoonPlayer) window.MoonPlayer.toggleMute();
      } else if (e.code === 'Escape') {
        if (state.isTvKaraokeOpen) toggleTvKaraoke();
        else if (state.isLyricsOpen) toggleLyricsPanel();
        else if (state.isAudioModalOpen) closeAudioSuite();
        else if (state.isDrawerOpen) closeDrawer();
      }
    });

    // Listen to MoonPlayer reactive events
    if (window.MoonPlayer) {
      window.MoonPlayer.on('trackChange', (song) => {
        state.currentTrack = song;
        syncWithPlayer();
        highlightPlayingRows();
        if (state.isLyricsOpen) renderLyrics();
        if (state.isTvKaraokeOpen) renderTvKaraoke();
      });

      window.MoonPlayer.on('playStateChange', (isPlaying) => {
        state.isPlaying = isPlaying;
        updatePlayPauseButton();
        highlightPlayingRows();
        syncWithPlayer();
      });

      window.MoonPlayer.on('loadingStateChange', () => {
        updatePlayPauseButton();
        highlightPlayingRows();
      });

      window.MoonPlayer.on('volumeChange', (payload) => {
        let v = 0.5;
        let isMuted = false;
        if (typeof payload === 'object' && payload !== null) {
          v = payload.volume !== undefined ? parseFloat(payload.volume) : state.volume;
          isMuted = !!payload.muted || v === 0;
        } else if (typeof payload === 'number') {
          v = payload;
          isMuted = v === 0;
        }
        state.volume = v;
        state.isMuted = isMuted;
        if (el.volumeSlider) {
          el.volumeSlider.value = state.volume;
          updateVolumeFill();
        }
        updateVolumeIcon();
      });

      const bgAudioEl = typeof window.MoonPlayer.getAudio === 'function' ? window.MoonPlayer.getAudio() : document.getElementById('bg-audio');
      if (bgAudioEl) {
        bgAudioEl.addEventListener('loadstart', () => {
          updatePlayPauseButton();
          highlightPlayingRows();
        });
        bgAudioEl.addEventListener('waiting', () => {
          updatePlayPauseButton();
          highlightPlayingRows();
        });
        bgAudioEl.addEventListener('playing', () => {
          state.isPlaying = true;
          updatePlayPauseButton();
          highlightPlayingRows();
          syncWithPlayer();
        });
        bgAudioEl.addEventListener('canplay', () => {
          if (!bgAudioEl.paused) {
            updatePlayPauseButton();
          }
        });
        bgAudioEl.addEventListener('play', () => {
          state.isPlaying = true;
          updatePlayPauseButton();
          highlightPlayingRows();
          syncWithPlayer();
        });
        bgAudioEl.addEventListener('pause', () => {
          state.isPlaying = false;
          updatePlayPauseButton();
          highlightPlayingRows();
          syncWithPlayer();
        });
        bgAudioEl.addEventListener('timeupdate', () => {
          if (!bgAudioEl.paused) {
            if (el.playbarSpinner && !el.playbarSpinner.classList.contains('hidden')) {
              updatePlayPauseButton();
            }
          }
        });
      }

      window.MoonPlayer.on('timeUpdate', ({ currentTime, duration }) => {
        state.currentTime = currentTime;
        state.duration = duration;
        updateLyricsHighlight();
      });

      window.MoonPlayer.on('lyricsLoaded', () => {
        if (state.isLyricsOpen) renderLyrics();
        if (state.isTvKaraokeOpen) renderTvKaraoke();
      });

      window.MoonPlayer.on('lyricsUpdate', () => {
        if (state.isLyricsOpen && el.lyricsContainer && !el.lyricsContainer.querySelector('.lyric-line')) {
          renderLyrics();
        }
        if (state.isTvKaraokeOpen && el.tvKaraokeContent && !el.tvKaraokeContent.querySelector('.tvk-lyric-line')) {
          renderTvKaraoke();
        }
        updateLyricsHighlight();
      });

      window.MoonPlayer.on('libraryLoaded', () => {
        refreshWaveTracks();
        updateCounters();
        if (state.currentView === 'playlists') renderPlaylistsView();
        else if (state.currentView === 'local') renderLocalView();
        else if (state.currentView === 'favorites') renderFavoritesView();
        else if (state.currentView === 'soundcloud') renderSoundCloudView();
        else if (state.currentView === 'queue') renderQueueView();
        syncWithPlayer();
        syncTrackDurations();
      });

      window.MoonPlayer.on('playlistsChange', () => {
        renderPlaylistsDrawer();
        updateCounters();
        if (state.currentView === 'playlists') {
          renderPlaylistsView();
        }
        if (state.currentView === 'playlist-detail' && state.selectedPlaylist) {
          renderPlaylistDetail(state.selectedPlaylist);
        }
      });

      window.MoonPlayer.on('repeatChange', (mode) => {
        state.repeatMode = mode;
        updateRepeatUI(mode);
        const audio = window.MoonPlayer && typeof window.MoonPlayer.getAudio === 'function' ? window.MoonPlayer.getAudio() : null;
        if (audio) {
          audio.loop = (mode === 'one');
        }
      });

      window.MoonPlayer.on('shuffleChange', (isShuf) => {
        state.isShuffle = isShuf;
        if (el.btnShuffle) el.btnShuffle.classList.toggle('active', isShuf);
      });
    }
  }

  function highlightPlayingRows() {
    const current = window.MoonPlayer ? window.MoonPlayer.getCurrentSong() : null;
    const isLoading = window.MoonPlayer ? window.MoonPlayer.isLoading() : false;
    const allRows = document.querySelectorAll('.mode-riff .track-row');
    allRows.forEach((row) => {
      const t = row._track;
      const isMatch = !!(current && t && isSameTrack(t, current));
      row.classList.toggle('playing', isMatch);
      row.classList.toggle('loading', isMatch && isLoading);
    });
  }

  // Initialization
  function initRiffUI() {
    initElements();
    initM3Canvas();
    applyRiffTheme();
    initScrubber();
    initAudioModal();
    bindEvents();
    syncWithPlayer();
    updateVolumeFill();
    syncTrackDurations();
    // Restore the saved UI scale before the first paint of the views.
    setM3UIScale(localStorage.getItem('moonplayer-riff-ui-scale') || '100');
    initBackgroundControls();
    refreshRiffBackground();
    switchView('local');

    window.addEventListener('moonplayer-library-loading', (e) => {
      if (state.currentView === 'local') {
        renderLocalView();
      }
      if (e && e.detail && e.detail.scanning === false) {
        syncTrackDurations();
      }
    });

    function onActivate() {
      // Re-populate and render views if songs are loaded in MoonPlayer
      refreshWaveTracks();
      if (state.currentView === 'playlists') renderPlaylistsView();
      else if (state.currentView === 'local') renderLocalView();
      else if (state.currentView === 'favorites') renderFavoritesView();
      else if (state.currentView === 'soundcloud') renderSoundCloudView();
      else if (state.currentView === 'queue') renderQueueView();

      startVisualizerLoop();
      syncWithPlayer();
      highlightPlayingRows();
      applyRiffTheme();
      syncTrackDurations();
    }

    function onDeactivate() {
      if (animFrameId) {
        cancelAnimationFrame(animFrameId);
        animFrameId = null;
      }
      closeDrawer();
    }

    // Register on window
    window.RiffUI = {
      getState: () => state,
      syncWithPlayer,
      switchView,
      showToast,
      openPlaylist,
      openAlbum,
      openArtistProfile,
      renderSoundCloudView,
      applyRiffTheme,
      onActivate,
      onDeactivate,
      openEqualizer: () => openAudioSuite('eq'),
      closeEqualizer: () => closeAudioSuite(),
      openAudioSuite: openAudioSuite,
      closeAudioSuite: closeAudioSuite
    };

    console.log('[RiffUI] Material Design 3 Riff UI initialized for MoonPlayer.');
  }

  try { applyRiffTheme(); } catch (e) {}

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initRiffUI);
  } else {
    initRiffUI();
  }
})();
