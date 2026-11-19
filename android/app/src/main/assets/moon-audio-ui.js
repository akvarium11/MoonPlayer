/* MoonPlayer 3.2 — native audio engine bridge + UI contrast/fader/modal fixes.
   Loaded after script.js. No hardcoded colors: contrast is computed at runtime
   from each button's real background luminance. */
(function () {
  'use strict';

  const T = window.__TAURI_INTERNALS__ || window.__TAURI__;
  const invoke = T && T.invoke ? T.invoke.bind(T) : null;
  const isTauri = !!invoke;

  // -----------------------------------------------------------------------
  // 1. Native audio engine: capture decoded PCM, route to Rust, mute browser
  // -----------------------------------------------------------------------

  const NativeAudio = {
    enabled: false,
    started: false,
    ctx: null,
    workletNode: null,
    fallbackNode: null,
    sink: null,
    tap: null,
    settings: {
      mode: 'shared',
      device: null,
      eq: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      preamp_db: 0,
      eq_enabled: false,
      volume: 1.0,
    },
    status: null,
    pending: 0,
    maxPending: 12,
    pendingChunks: [],
  };

  // Batch ~4096 frames (~85 ms at 48 kHz) before crossing the IPC boundary.
  // Posting one message per 128-frame render quantum would create ~375 IPC
  // calls per second and starve the UI thread.
  const WORKLET_SOURCE = `
    class MoonPcmTap extends AudioWorkletProcessor {
      constructor() {
        super();
        this.target = 4096;
        this.frames = 0;
        this.chunks = [];
      }
      process(inputs) {
        const input = inputs[0];
        if (input && input.length) {
          const ch = input.length;
          const len = input[0].length;
          const interleaved = new Float32Array(len * ch);
          for (let i = 0; i < len; i++) {
            for (let c = 0; c < ch; c++) interleaved[i * ch + c] = input[c][i];
          }
          this.chunks.push(interleaved);
          this.frames += len;
          if (this.frames >= this.target) {
            const total = this.frames * ch;
            const merged = new Float32Array(total);
            let off = 0;
            for (const part of this.chunks) { merged.set(part, off); off += part.length; }
            this.port.postMessage({ pcm: merged, channels: ch }, [merged.buffer]);
            this.chunks = [];
            this.frames = 0;
          }
        }
        return true;
      }
    }
    registerProcessor('moon-pcm-tap', MoonPcmTap);
  `;

  function toSettings() {
    const g = (i) => {
      const f = window.MoonPlayer && window.MoonPlayer.getEqBandGain;
      return f ? Number(f(i)) || 0 : NativeAudio.settings.eq[i];
    };
    const mp = window.MoonPlayer || {};
    return {
      mode: NativeAudio.settings.mode,
      device: NativeAudio.settings.device,
      eq: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(g),
      preamp_db: typeof mp.getEqPreamp === 'function' ? Number(mp.getEqPreamp()) || 0 : 0,
      eq_enabled: typeof mp.isEqEnabled === 'function' ? !!mp.isEqEnabled() : NativeAudio.settings.eq_enabled,
      volume: NativeAudio.settings.volume,
    };
  }

  async function pushPcm(data, rate, channels) {
    if (!isTauri || !NativeAudio.started) return;
    NativeAudio.pendingChunks.push([data, rate, channels]);
    // Bound the queue: never let a stalled device grow memory without limit.
    if (NativeAudio.pendingChunks.length > 64) NativeAudio.pendingChunks.shift();
    if (NativeAudio.pending > NativeAudio.maxPending) return;
    while (NativeAudio.pendingChunks.length && NativeAudio.pending < NativeAudio.maxPending) {
      const [d, r, c] = NativeAudio.pendingChunks.shift();
      NativeAudio.pending++;
      const u8 = new Uint8Array(d.buffer, d.byteOffset, d.byteLength);
      // Fast byte buffer IPC path (audio_push_raw) with fallback to pcm float array (audio_push)
      invoke('audio_push_raw', { data: Array.from(u8), sample_rate: r, channels: c })
        .catch(() => invoke('audio_push', { pcm: Array.from(d), sample_rate: r, channels: c }))
        .catch((e) => console.warn('[NativeAudio] push failed:', e))
        .finally(() => { NativeAudio.pending--; });
    }
  }

  // Export early: script.js calls install() from initAudioContext(), which can
  // run on the very first user gesture before DOMContentLoaded boot() finishes.
  NativeAudio.install = (...args) => install(...args);
  window.MoonNativeAudio = NativeAudio;

  /** Install into the Web Audio graph script.js already owns. A media element
      can only be captured by one AudioContext, so we must reuse it. */
  async function install(ctx, source, analyser, destination) {
    if (!isTauri || NativeAudio.started) return false;
    NativeAudio.ctx = ctx;
    try {
      // Mute browser output: reconnect analyser through a zero-gain node.
      try { analyser.disconnect(destination); } catch (e) {}
      const sink = ctx.createGain();
      sink.gain.value = 0;
      analyser.connect(sink);
      sink.connect(destination);
      NativeAudio.sink = sink;

      if (ctx.audioWorklet) {
        const blob = new Blob([WORKLET_SOURCE], { type: 'application/javascript' });
        const url = URL.createObjectURL(blob);
        await ctx.audioWorklet.addModule(url);
        URL.revokeObjectURL(url);
        const maxCh = (ctx.destination && ctx.destination.maxChannelCount) || 8;
        const node = new AudioWorkletNode(ctx, 'moon-pcm-tap', {
          numberOfInputs: 1, numberOfOutputs: 1,
          channelCount: Math.min(maxCh, 8),
          channelCountMode: 'explicit',
          channelInterpretation: 'discrete',
        });
        node.port.onmessage = (e) => {
          const d = e.data;
          const pcm = (d && d.pcm) ? d.pcm : d;
          const ch = (d && d.channels) ? d.channels : 2;
          pushPcm(pcm, NativeAudio.currentTrackRate || ctx.sampleRate, ch);
        };
        source.connect(node); // tap raw decoded PCM, pre-EQ/analyser
        node.connect(sink);   // silent output keeps the processor alive
        NativeAudio.workletNode = node;
      } else {
        const node = ctx.createScriptProcessor(4096, 2, 2);
        node.onaudioprocess = (e) => {
          const l = e.inputBuffer.getChannelData(0);
          const r = e.inputBuffer.numberOfChannels > 1 ? e.inputBuffer.getChannelData(1) : l;
          const inter = new Float32Array(l.length * 2);
          for (let i = 0; i < l.length; i++) { inter[i * 2] = l[i]; inter[i * 2 + 1] = r[i]; }
          pushPcm(inter, NativeAudio.currentTrackRate || ctx.sampleRate, 2);
        };
        source.connect(node);
        node.connect(sink);
        NativeAudio.fallbackNode = node;
      }

      const initialRate = NativeAudio.currentTrackRate || ctx.sampleRate;
      const initialCh = NativeAudio.currentTrackChannels || 2;
      await invoke('audio_start', {
        settings: toSettings(), sample_rate: initialRate, channels: initialCh,
      });
      NativeAudio.started = true;
      NativeAudio.enabled = true;
      NativeAudio.status = await invoke('audio_status');
      renderAudioStatus();
      return true;
    } catch (e) {
      console.error('[NativeAudio] install failed, staying on browser audio:', e);
      if (NativeAudio.sink) NativeAudio.sink.gain.value = 1;
      return false;
    }
  }

  async function onTrackChange(song) {
    if (!isTauri) return;
    try {
      NativeAudio.currentSong = song;
      let rate = (song && song.sampleRate) || (NativeAudio.ctx && NativeAudio.ctx.sampleRate) || 44100;
      let ch = (song && song.channels) || 2;

      // On-demand resolver for local tracks missing sampleRate
      if ((!song || !song.sampleRate) && song && song.path && !song.path.startsWith('soundcloud:')) {
        fetch(`/api/track-duration?path=${encodeURIComponent(song.path)}`)
          .then((r) => r.json())
          .then((info) => {
            if (info && info.sampleRate && info.sampleRate !== rate) {
              song.sampleRate = info.sampleRate;
              song.channels = info.channels || 2;
              song.bitDepth = info.bitDepth || 16;
              onTrackChange(song);
            }
          }).catch(() => {});
      }

      NativeAudio.currentTrackRate = rate;
      NativeAudio.currentTrackChannels = ch;
      if (NativeAudio.started) {
        await invoke('audio_reconfigure', { sample_rate: rate, channels: ch }).catch(() => {});
        NativeAudio.status = await invoke('audio_status').catch(() => null);
        renderAudioStatus();
      }
    } catch (e) {
      console.warn('[NativeAudio] onTrackChange failed:', e);
    }
  }

  async function startEngine() {
    // script.js creates the graph on initAudioContext(); force it now.
    if (!isTauri || NativeAudio.started) return false;
    try {
      if (window.MoonPlayer && typeof window.MoonPlayer.initAudioContext === 'function') {
        window.MoonPlayer.initAudioContext();
      }
    } catch (e) {}
    return NativeAudio.started;
  }

  async function applySettings(restart) {
    if (!isTauri) return;
    try {
      if (restart || !NativeAudio.started) {
        await startEngine();
      } else {
        await invoke('audio_settings', { settings: toSettings() });
      }
      NativeAudio.status = await invoke('audio_status');
      renderAudioStatus();
    } catch (e) { console.warn('[NativeAudio] settings failed:', e); }
  }

  async function flush() {
    if (isTauri && NativeAudio.started) {
      NativeAudio.pendingChunks = [];
      await invoke('audio_flush').catch(() => {});
    }
  }

  NativeAudio.onTrackChange = onTrackChange;
  NativeAudio.flush = flush;

  // -----------------------------------------------------------------------
  // 2. Vertical EQ fader fill (0 dB -> thumb), for both UIs
  // -----------------------------------------------------------------------
  function updateFaderFill(el) {
    if (!el || !el.classList) return;
    const min = Number(el.min || -12), max = Number(el.max || 12);
    const val = Number(el.value || 0);
    if (max <= min) return;
    const center = ((0 - min) / (max - min)) * 100;
    const pos = ((val - min) / (max - min)) * 100;
    const start = Math.min(center, pos), end = Math.max(center, pos);
    el.style.setProperty('--eq-fill-start', start.toFixed(2) + '%');
    el.style.setProperty('--eq-fill-end', end.toFixed(2) + '%');
    el.style.setProperty('--slider-pct', pos.toFixed(2) + '%');
  }

  function refreshAllFaders(root) {
    (root || document).querySelectorAll('.eq-slider, .eq-band-range, #riff-eq-preamp-slider, .pill-range').forEach(updateFaderFill);
  }

  // -----------------------------------------------------------------------
  // 3. Adaptive button inversion: compute real contrast at runtime
  // -----------------------------------------------------------------------
  function parseColor(str) {
    if (!str) return null;
    const s = String(str).trim();
    if (s === 'transparent' || s === 'none') return null;
    const m = s.match(/rgba?\(([^)]+)\)/);
    if (m) {
      const p = m[1].split(/[\s,\/]+/).filter(Boolean).map(Number);
      return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
    }
    if (s[0] === '#') {
      let h = s.slice(1);
      if (h.length === 3) h = h.split('').map((c) => c + c).join('');
      if (h.length >= 6) return {
        r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16),
        b: parseInt(h.slice(4, 6), 16), a: 1,
      };
    }
    // Chrome resolves color-mix()/relative colors to color(srgb r g b / a).
    const cm = s.match(/^color\(\s*srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\s*\)$/i);
    if (cm) return {
      r: Number(cm[1]) * 255, g: Number(cm[2]) * 255, b: Number(cm[3]) * 255,
      a: cm[4] !== undefined ? Number(cm[4]) : 1,
    };
    return null;
  }

  function luminance(c) {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  }

  function effectiveBackground(el) {
    // Collect every semi-transparent layer from the button up to <html>, then
    // composite root -> element. Compositing in the wrong order was the reason
    // white-on-light buttons were judged "readable" over a dark fallback.
    const chain = [];
    let node = el;
    let guard = 0;
    while (node && guard++ < 12) {
      const c = parseColor(getComputedStyle(node).backgroundColor);
      if (c && c.a > 0) chain.push(c);
      node = node.parentElement;
    }
    // An opaque button hides everything behind it. Returning it directly also
    // keeps the full-screen dim overlay from being mistaken for the button's
    // own fill (it sits between the modal card and the page background).
    if (chain.length && chain[0].a >= 0.999) return chain[0];
    const light = document.body.classList.contains('theme-light')
      || document.documentElement.classList.contains('theme-light')
      || (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches
          && localStorage.getItem('riff_theme_mode') === 'system');
    let base = light
      ? { r: 251, g: 248, b: 253, a: 1 }  // light theme page fill
      : { r: 18, g: 18, b: 20, a: 1 };    // dark theme page fill
    for (let i = chain.length - 1; i >= 0; i--) {
      const c = chain[i];
      base = {
        r: c.r * c.a + base.r * (1 - c.a),
        g: c.g * c.a + base.g * (1 - c.a),
        b: c.b * c.a + base.b * (1 - c.a),
        a: 1,
      };
    }
    return base;
  }

  function contrastRatio(l1, l2) {
    const a = Math.max(l1, l2) + 0.05, b = Math.min(l1, l2) + 0.05;
    return a / b;
  }

  // Adaptive inversion: never hardcode a color. Pick white or black text based
  // on which gives higher contrast against the button's real background, then
  // derive a subtle border/hover from the same luminance relationship.
  let contrastBusy = false;
  let settlePending = false;
  const contrastStats = { runs: 0, settles: 0, scheduled: 0 };
  function scheduleSettle(root) {
    if (settlePending) return;
    settlePending = true;
    contrastStats.scheduled++;
    // CSS theme transitions animate background-color over ~400 ms and some
    // surfaces settle later. One guaranteed deferred pass re-measures after
    // the final fill is painted. Do NOT debounce/reset here: frequent
    // MutationObserver callbacks would otherwise starve the settle pass.
    setTimeout(() => {
      settlePending = false;
      applyAdaptiveContrast(root, true);
    }, 950);
  }
  function applyAdaptiveContrast(root, settle) {
    if (contrastBusy) return;
    contrastBusy = true;
    contrastStats.runs++;
    if (settle) contrastStats.settles++;
    try {
    const scope = root || document;
    const els = scope.querySelectorAll('button, [role="button"], .btn-outline-pill, .btn-icon-pill, .btn-pill-primary, .settings-btn, .preset-chip, .riff-eq-chip, .audio-tab, .chip-btn, .format-chip, .quality-chip, .sleep-timer-options .btn-outline-pill');
    els.forEach((el) => {
      if (el.dataset.contrastSkip === '1') return;
      const cs = getComputedStyle(el);
      // visibility:hidden elements still have a full computed style; they are
      // common in closed modals and must be inverted before they are shown.
      if (cs.display === 'none') return;
      const bg = effectiveBackground(el);
      const lBg = luminance(bg);
      const white = 1, black = 0;
      const cWhite = contrastRatio(lBg, white);
      const cBlack = contrastRatio(lBg, black);
      // Prefer the theme's own on-primary/on-surface token when it already
      // has good contrast, otherwise invert.
      const fgRaw = parseColor(cs.color);
      const lFg = fgRaw ? luminance(fgRaw) : cWhite >= cBlack ? white : black;
      const cCurrent = contrastRatio(lBg, lFg);
      const targetL = cWhite >= cBlack ? white : black;
      const out = targetL === white
        ? { color: 'rgb(255,255,255)', border: 'rgba(255,255,255,0.22)', icon: 'currentColor' }
        : { color: 'rgb(12,12,14)', border: 'rgba(12,12,14,0.22)', icon: 'currentColor' };
      // Always apply the luminance-derived foreground: adaptive inversion,
      // not a hardcoded white/black pair. On a settle pass we ignore the
      // current color (it may be our own previous guess) and re-derive purely
      // from the now-final background, so theme switches converge.
      const prev = el.dataset.contrastApplied === '1';
      const keepTheme = !prev && !settle && cCurrent >= 4.5 && fgRaw;
      const fg = keepTheme
        ? `rgb(${Math.round(fgRaw.r)},${Math.round(fgRaw.g)},${Math.round(fgRaw.b)})`
        : out.color;
      el.style.setProperty('--btn-adaptive-fg', fg);
      el.style.setProperty('--btn-adaptive-border', out.border);
      el.style.setProperty('--btn-adaptive-icon', fg);
      el.querySelectorAll('i, svg, .fa-solid, .fa-regular, .fa-brands, .fa').forEach((ic) => {
        ic.style.setProperty('color', fg, 'important');
        if (ic.tagName && ic.tagName.toLowerCase() === 'svg') {
          ic.style.setProperty('stroke', fg, 'important');
        }
      });
      if (parseFloat(cs.borderTopWidth) > 0) {
        el.style.setProperty('border-color', out.border, 'important');
      }
      el.dataset.contrastApplied = '1';
    });
    } finally { contrastBusy = false; }
  }

  // Full recheck + one guaranteed deferred pass (theme transitions).
  function refreshContrast(root) {
    applyAdaptiveContrast(root);
    scheduleSettle(root);
  }

  // -----------------------------------------------------------------------
  // 4. Modal backdrop gap: portal overlays to <body>
  // -----------------------------------------------------------------------
  function portalOverlays() {
    const overlays = document.querySelectorAll('.modal-overlay, .modal-backdrop');
    overlays.forEach((el) => {
      if (el.parentElement === document.body) return;
      // Mark original parent so we can keep CSS descendant selectors working
      // via a copied class list on the body.
      const origin = el.parentElement;
      if (origin && origin.id) el.dataset.portalOrigin = origin.id;
      document.body.appendChild(el);
    });
  }

  function keepBackdropFullscreen() {
    // Ancestor transforms (UI scale / 3D tilt) make position:fixed relative to
    // that ancestor. Force viewport coordinates on overlay nodes.
    document.querySelectorAll('.modal-overlay, .modal-backdrop').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.top !== 0 || r.left !== 0 || Math.abs(r.width - window.innerWidth) > 1 || Math.abs(r.height - window.innerHeight) > 1) {
        el.style.setProperty('top', '0', 'important');
        el.style.setProperty('left', '0', 'important');
        el.style.setProperty('right', '0', 'important');
        el.style.setProperty('bottom', '0', 'important');
        el.style.setProperty('width', '100vw', 'important');
        el.style.setProperty('height', '100vh', 'important');
        el.style.setProperty('transform', 'none', 'important');
      }
    });
  }

  // -----------------------------------------------------------------------
  // 5. Audio engine UI (settings panel)
  // -----------------------------------------------------------------------
  function buildAudioUI() {
    if (!isTauri) return;
    const settingsModal = document.getElementById('settings-modal');
    let host = settingsModal ? settingsModal.querySelector('.modal-body') : null;
    if (!host) {
      host = document.querySelector('.settings-body, .audio-settings-body, .modal-body');
    }
    if (!host || document.getElementById('moon-native-audio-card')) return;

    const card = document.createElement('div');
    card.id = 'moon-native-audio-card';
    card.className = 'setting-item';
    card.style.cssText = 'display:flex;flex-direction:column;gap:12px;padding:16px;border-radius:16px;background:var(--md-sys-color-surface-container-high, rgba(255,255,255,0.05));border:1px solid var(--card-border, rgba(255,255,255,0.08));margin-bottom:12px;';
    card.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
        <div>
          <div style="font-weight:700;font-size:0.92rem;">Native Hi-Fi Audio Engine</div>
          <div style="font-size:0.74rem;opacity:0.7;margin-top:2px;">Low-level Rust output · 64-bit DSP · WASAPI exclusive USB DAC</div>
        </div>
        <label class="switch" style="transform:scale(0.85);margin:0;">
          <input type="checkbox" id="moon-native-engine-toggle" checked>
          <span class="switch-slider"></span>
        </label>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;">
        <label style="font-size:0.76rem;opacity:0.8;min-width:64px;">Output</label>
        <select id="moon-audio-device" style="flex:1 1 180px;min-width:0;background:var(--md-sys-color-surface-container-highest, rgba(255,255,255,0.08));color:inherit;border:1px solid var(--card-border, rgba(255,255,255,0.12));border-radius:10px;padding:8px 10px;font:inherit;font-size:0.8rem;">
          <option value="">System default</option>
        </select>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;">
        <label style="font-size:0.76rem;opacity:0.8;min-width:64px;">Mode</label>
        <button type="button" id="moon-audio-mode-shared" class="btn-outline-pill" style="height:32px;padding:4px 14px;font-size:0.76rem;">Shared</button>
        <button type="button" id="moon-audio-mode-exclusive" class="btn-outline-pill" style="height:32px;padding:4px 14px;font-size:0.76rem;">Exclusive USB (bit-perfect)</button>
      </div>
      <div id="moon-audio-status" style="font-size:0.72rem;line-height:1.5;opacity:0.8;font-variant-numeric:tabular-nums;white-space:pre-wrap;">Starting native engine…</div>
    `;
    host.insertBefore(card, host.firstChild);

    const toggle = card.querySelector('#moon-native-engine-toggle');
    const sel = card.querySelector('#moon-audio-device');
    const bShared = card.querySelector('#moon-audio-mode-shared');
    const bExcl = card.querySelector('#moon-audio-mode-exclusive');

    const setMode = async (mode) => {
      NativeAudio.settings.mode = mode;
      bShared.style.outline = mode === 'shared' ? '2px solid var(--accent, #fff)' : 'none';
      bExcl.style.outline = mode === 'exclusive' ? '2px solid var(--accent, #fff)' : 'none';
      bShared.dataset.active = mode === 'shared' ? '1' : '0';
      bExcl.dataset.active = mode === 'exclusive' ? '1' : '0';
      await applySettings(true);
    };
    bShared.addEventListener('click', () => setMode('shared'));
    bExcl.addEventListener('click', () => setMode('exclusive'));
    sel.addEventListener('change', async () => {
      NativeAudio.settings.device = sel.value || null;
      await applySettings(true);
    });
    toggle.addEventListener('change', async () => {
      if (toggle.checked) { await startEngine(); }
      else {
        await invoke('audio_stop').catch(() => {});
        NativeAudio.started = false;
        NativeAudio.enabled = false;
        if (NativeAudio.sink) NativeAudio.sink.gain.value = 1; // browser fallback
        renderAudioStatus();
      }
    });

    invoke('audio_devices').then((devices) => {
      devices.forEach((d) => {
        const o = document.createElement('option');
        o.value = d.name;
        o.textContent = `${d.name}${d.is_default ? ' (default)' : ''} — ${Math.max(...d.sample_rates) / 1000} kHz · ${Math.max(...d.bit_depths)}-bit${d.exclusive_capable ? ' · exclusive' : ''}`;
        sel.appendChild(o);
      });
    }).catch(() => {});
  }

  function renderAudioStatus() {
    const el = document.getElementById('moon-audio-status');
    if (!el) return;
    const s = NativeAudio.status;
    if (!NativeAudio.started || !s || !s.running) {
      el.textContent = isTauri ? 'Native engine off — browser audio output.' : 'Browser audio (native engine needs the desktop app).';
      return;
    }
    const isBitPerfect = s.exclusive && (!s.eq_enabled);
    const modeLabel = s.exclusive
      ? (isBitPerfect ? 'EXCLUSIVE [Bit-Perfect] · Direct Hardware DAC' : 'EXCLUSIVE · OS mixer bypassed')
      : 'Shared mode';
    const dspLabel = s.eq_enabled ? ' · 10-band EQ active' : (s.exclusive ? ' · Pure bit-perfect pass-through' : '');
    const trackInfo = NativeAudio.currentSong && NativeAudio.currentSong.sampleRate
      ? `Track: ${(NativeAudio.currentSong.sampleRate / 1000).toFixed(1)} kHz / ${NativeAudio.currentSong.bitDepth || 16}-bit · `
      : '';
    el.textContent = `● ${s.backend} · ${s.device}\n${trackInfo}DAC: ${(s.sample_rate / 1000).toFixed(1)} kHz · ${s.bit_depth}-bit · ${s.channels}ch · ${s.sample_format}\n${modeLabel}${dspLabel}\nBuffer ${(s.latency_ms || 0).toFixed(0)} ms · underruns ${s.underruns}${s.message ? '\n' + s.message : ''}`;
  }

  // -----------------------------------------------------------------------
  // Bootstrap
  // -----------------------------------------------------------------------
  function boot() {
    portalOverlays();
    keepBackdropFullscreen();
    refreshAllFaders();
    refreshContrast();
    buildAudioUI();

    // React to dynamic UI (riff re-renders EQ, modals, theme changes).
    let moTimer = 0;
    const mo = new MutationObserver(() => {
      clearTimeout(moTimer);
      moTimer = setTimeout(() => {
        refreshAllFaders();
        refreshContrast();
        portalOverlays();
      }, 120);
    });
    // Only class changes + added nodes are observed. Watching `style` would
    // feed back on the inline contrast vars we write and loop forever.
    mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });

    // Fader input + theme/accent changes.
    document.addEventListener('input', (e) => {
      if (e.target && (e.target.classList.contains('eq-slider') || e.target.classList.contains('eq-band-range') || e.target.id === 'riff-eq-preamp-slider' || e.target.classList.contains('pill-range'))) {
        updateFaderFill(e.target);
      }
    }, true);
    document.addEventListener('change', (e) => {
      if (e.target && e.target.id === 'moon-audio-device') return;
      if (window.MoonPlayer && isTauri) {
        // EQ/preamp/toggle changed in classic UI -> sync native DSP.
        applySettings(false);
        const a = document.getElementById('bg-audio');
        invoke('audio_volume', { volume: a ? a.volume : 1 }).catch(() => {});
      }
    }, true);
    window.addEventListener('resize', () => { keepBackdropFullscreen(); refreshContrast(); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshContrast(); });

    // Hover/focus change button backgrounds. Recompute contrast for just that
    // element while the hover style is active, so the inversion stays correct.
    let hoverRaf = 0;
    const recompute = (el) => {
      if (!el || !el.dataset || el.dataset.contrastApplied !== '1') return;
      cancelAnimationFrame(hoverRaf);
      hoverRaf = requestAnimationFrame(() => refreshContrast(el.parentElement || document));
    };
    document.addEventListener('pointerover', (e) => recompute(e.target && e.target.closest ? e.target.closest('button, [role="button"]') : null), true);
    document.addEventListener('pointerout', (e) => recompute(e.target && e.target.closest ? e.target.closest('button, [role="button"]') : null), true);
    document.addEventListener('focusin', (e) => recompute(e.target), true);

    // Theme changes (riff-ui.js injects a dynamic stylesheet).
    const themeObserver = new MutationObserver(() => refreshContrast());
    themeObserver.observe(document.head, { childList: true, subtree: true, characterData: true });
    document.addEventListener('moonplayer:theme', () => refreshContrast());

    // Theme transitions (~400 ms) and late-rendered menus can change a
    // button's fill after the first measurement. A periodic full recheck
    // guarantees no button is left with a stale inverted foreground.
    [150, 700, 1500].forEach((ms) => setTimeout(() => refreshContrast(), ms));
    setInterval(() => refreshContrast(), 1200);

    // Start on first user gesture (AudioContext autoplay policy).
    const kick = async () => {
      if (!NativeAudio.started && isTauri) await startEngine();
      if (NativeAudio.ctx && NativeAudio.ctx.state === 'suspended') await NativeAudio.ctx.resume().catch(() => {});
    };
    document.addEventListener('pointerdown', kick, { once: false });
    document.addEventListener('keydown', kick, { once: false });

    // Seek / track change: drop buffered PCM and sync sample rate so DAC matches file bit-perfect.
    window.addEventListener('moonplayer:seek', flush);
    window.addEventListener('moonplayer:trackchange', (e) => {
      flush();
      onTrackChange(e && e.detail ? e.detail : e);
    });
    const audioEl = document.getElementById('bg-audio');
    if (audioEl) {
      audioEl.addEventListener('seeked', flush);
      audioEl.addEventListener('seeking', flush);
      audioEl.addEventListener('emptied', flush);
    }
    if (window.MoonPlayer && window.MoonPlayer.on) {
      window.MoonPlayer.on('equalizerChange', () => applySettings(false));
      window.MoonPlayer.on('trackChange', (song) => {
        flush();
        onTrackChange(song);
      });
      window.MoonPlayer.on('volumeChange', (v) => {
        NativeAudio.settings.volume = v && typeof v.volume === 'number' ? v.volume : 1;
        if (isTauri) invoke('audio_volume', { volume: NativeAudio.settings.volume }).catch(() => {});
      });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.MoonNativeAudio = NativeAudio;
  window.MoonUiFixes = { applyAdaptiveContrast, refreshContrast, refreshAllFaders, portalOverlays, keepBackdropFullscreen, startEngine, applySettings, flush,
    stats: contrastStats,
    debug: (el) => {
      const bg = effectiveBackground(el);
      const l = luminance(bg);
      return { bg, l, white: contrastRatio(l, 1), black: contrastRatio(l, 0),
        ownBg: getComputedStyle(el).backgroundColor, fgVar: el.style.getPropertyValue('--btn-adaptive-fg') };
    } };
})();
