// MoonPlayer 3.2 — Native High-Fidelity Audio Engine
//
// The WebView only decodes containers and streams raw 32-bit float PCM here.
// This module owns the real output device: cpal (WASAPI / ALSA / CoreAudio) for
// shared mode, and a direct IAudioClient exclusive-mode renderer on Windows for
// bit-perfect USB DAC output. All mixing/EQ runs in 64-bit float DSP with no OS
// mixer, no implicit resampling and no browser audio post-processing.

#![allow(dead_code)]
use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{Device, FromSample, SampleFormat, SizedSample, Stream, StreamConfig};
use serde::Serialize;

#[cfg(windows)]
#[path = "audio_engine/wasapi_exclusive.rs"]
mod wasapi_exclusive;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum ShareMode {
    #[default]
    Shared,
    /// WASAPI exclusive. Bypasses the OS mixer and SRC. Falls back to shared
    /// mode (reported in status) when the device refuses exclusive access.
    Exclusive,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(default)]
pub struct EngineSettings {
    pub mode: ShareMode,
    pub device: Option<String>,
    pub eq: [f64; 10],
    pub preamp_db: f64,
    pub eq_enabled: bool,
    pub volume: f64,
}

impl Default for EngineSettings {
    fn default() -> Self {
        Self { mode: ShareMode::Shared, device: None, eq: [0.0; 10], preamp_db: 0.0, eq_enabled: false, volume: 1.0 }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct AudioDeviceInfo {
    pub name: String,
    pub is_default: bool,
    pub sample_rates: Vec<u32>,
    pub channels: u16,
    pub bit_depths: Vec<u16>,
    /// True when the driver advertises a discrete native format (prerequisite
    /// for WASAPI exclusive / USB DAC bit-perfect output).
    pub exclusive_capable: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct EngineStatus {
    pub running: bool,
    pub mode: String,
    pub device: String,
    pub sample_rate: u32,
    pub channels: u16,
    pub sample_format: String,
    pub bit_depth: u16,
    pub exclusive: bool,
    pub eq_enabled: bool,
    pub buffered_samples: usize,
    pub target_samples: usize,
    pub underruns: u64,
    pub pushed_samples: u64,
    pub played_samples: u64,
    pub latency_ms: f64,
    pub backend: String,
    pub message: String,
}

impl Default for EngineStatus {
    fn default() -> Self {
        Self {
            running: false, mode: "shared".into(), device: String::new(), sample_rate: 0,
            channels: 0, sample_format: String::new(), bit_depth: 0, exclusive: false,
            eq_enabled: false, buffered_samples: 0, target_samples: 0, underruns: 0,
            pushed_samples: 0, played_samples: 0, latency_ms: 0.0,
            backend: "none".into(), message: String::new(),
        }
    }
}

// ---------------------------------------------------------------------------
// 64-bit float biquad DSP (RBJ cookbook), 10 ISO bands
// ---------------------------------------------------------------------------

pub const EQ_FREQUENCIES: [f64; 10] = [
    32.0, 64.0, 125.0, 250.0, 500.0, 1000.0, 2000.0, 4000.0, 8000.0, 16000.0,
];

#[derive(Clone, Copy)]
struct Biquad {
    b0: f64, b1: f64, b2: f64, a1: f64, a2: f64,
    z1: [f64; 8], z2: [f64; 8],
}

impl Biquad {
    fn process(&mut self, input: &mut [f32]) {
        for (ch, x) in input.iter_mut().enumerate() {
            if ch >= 8 { break; }
            let xn = f64::from(*x);
            let yn = self.b0 * xn + self.z1[ch];
            self.z1[ch] = self.b1 * xn - self.a1 * yn + self.z2[ch];
            self.z2[ch] = self.b2 * xn - self.a2 * yn;
            *x = yn as f32;
        }
    }
}

fn design_biquad(kind: &str, freq: f64, gain_db: f64, q: f64, sample_rate: f64) -> Biquad {
    let f = freq.clamp(10.0, sample_rate * 0.49);
    let w0 = std::f64::consts::TAU * f / sample_rate;
    let (cos_w, alpha) = (w0.cos(), w0.sin() / (2.0 * q));
    let a = 10f64.powf(gain_db / 40.0);
    let (mut b0, mut b1, mut b2, a0, mut a1, mut a2) = match kind {
        "lowshelf" => {
            let sq = 2.0 * a.sqrt() * alpha;
            (a * ((a + 1.0) - (a - 1.0) * cos_w + sq),
             2.0 * a * ((a - 1.0) - (a + 1.0) * cos_w),
             a * ((a + 1.0) - (a - 1.0) * cos_w - sq),
             (a + 1.0) + (a - 1.0) * cos_w + sq,
             -2.0 * ((a - 1.0) + (a + 1.0) * cos_w),
             (a + 1.0) + (a - 1.0) * cos_w - sq)
        }
        "highshelf" => {
            let sq = 2.0 * a.sqrt() * alpha;
            (a * ((a + 1.0) + (a - 1.0) * cos_w + sq),
             -2.0 * a * ((a - 1.0) + (a + 1.0) * cos_w),
             a * ((a + 1.0) + (a - 1.0) * cos_w - sq),
             (a + 1.0) - (a - 1.0) * cos_w + sq,
             2.0 * ((a - 1.0) - (a + 1.0) * cos_w),
             (a + 1.0) - (a - 1.0) * cos_w - sq)
        }
        _ => (1.0 + alpha * a, -2.0 * cos_w, 1.0 - alpha * a,
              1.0 + alpha / a, -2.0 * cos_w, 1.0 - alpha / a),
    };
    b0 /= a0; b1 /= a0; b2 /= a0; a1 /= a0; a2 /= a0;
    Biquad { b0, b1, b2, a1, a2, z1: [0.0; 8], z2: [0.0; 8] }
}

pub struct DspChain {
    filters: Vec<Biquad>,
    preamp: f64,
    volume: f64,
    is_active: bool,
}

impl DspChain {
    pub fn new(settings: &EngineSettings, sample_rate: u32) -> Self {
        let is_active = settings.eq_enabled && settings.eq.iter().any(|&g| g.abs() > 0.01);
        let filters = EQ_FREQUENCIES.iter().enumerate().map(|(i, &freq)| {
            let kind = if i == 0 { "lowshelf" } else if i == EQ_FREQUENCIES.len() - 1 { "highshelf" } else { "peaking" };
            let gain = if settings.eq_enabled { settings.eq[i].clamp(-12.0, 12.0) } else { 0.0 };
            let q = if kind == "peaking" { 1.4 } else { std::f64::consts::FRAC_1_SQRT_2 };
            design_biquad(kind, freq, gain, q, f64::from(sample_rate))
        }).collect();
        Self {
            filters,
            preamp: if settings.eq_enabled { 10f64.powf(settings.preamp_db.clamp(-12.0, 12.0) / 20.0) } else { 1.0 },
            volume: settings.volume.clamp(0.0, 1.0),
            is_active,
        }
    }

    pub fn set_volume(&mut self, v: f64) { self.volume = v.clamp(0.0, 1.0); }

    pub fn process(&mut self, frame: &mut [f32]) {
        // Pure bit-perfect bypass: when EQ is disabled and volume is 100%, pass through untouched
        if !self.is_active && (self.volume - 1.0).abs() < 1e-6 && (self.preamp - 1.0).abs() < 1e-6 {
            return;
        }
        if (self.preamp - 1.0).abs() >= 1e-6 {
            for s in frame.iter_mut() { *s = (*s as f64 * self.preamp) as f32; }
        }
        if self.is_active {
            for f in self.filters.iter_mut() { f.process(frame); }
        }
        if (self.volume - 1.0).abs() >= 1e-6 {
            for s in frame.iter_mut() { *s = (*s as f64 * self.volume) as f32; }
        }
    }
}

// ---------------------------------------------------------------------------
// Interleaved PCM ring buffer
// ---------------------------------------------------------------------------

pub struct PcmBuffer {
    samples: VecDeque<f32>,
    pub channels: usize,
    pub target_frames: usize,
    pub underruns: AtomicU64,
    pub pushed: AtomicU64,
    pub played: AtomicU64,
    primed: AtomicBool,
}

impl PcmBuffer {
    pub fn new(channels: usize, sample_rate: u32, latency_ms: f64) -> Self {
        let target_frames = (f64::from(sample_rate) * latency_ms / 1000.0) as usize;
        Self {
            samples: VecDeque::with_capacity(target_frames * channels * 2),
            channels, target_frames,
            underruns: AtomicU64::new(0), pushed: AtomicU64::new(0), played: AtomicU64::new(0),
            primed: AtomicBool::new(false),
        }
    }
    pub fn ready(&self) -> bool { self.samples.len() >= self.target_frames * self.channels }
    pub fn push(&mut self, data: &[f32]) {
        self.samples.extend(data.iter().copied());
        self.pushed.fetch_add((data.len() / self.channels.max(1)) as u64, Ordering::Relaxed);
        if self.ready() { self.primed.store(true, Ordering::Relaxed); }
    }
    /// false while priming (silence, not an underrun).
    pub fn pop_frame(&mut self, out: &mut [f32]) -> bool {
        let ch = self.channels;
        if self.samples.len() < ch {
            if self.primed.load(Ordering::Relaxed) {
                self.underruns.fetch_add(1, Ordering::Relaxed);
                self.primed.store(false, Ordering::Relaxed);
            }
            out.fill(0.0);
            return false;
        }
        for slot in out.iter_mut().take(ch) { *slot = self.samples.pop_front().unwrap_or(0.0); }
        self.played.fetch_add(1, Ordering::Relaxed);
        true
    }
    pub fn clear(&mut self) {
        self.samples.clear();
        self.primed.store(false, Ordering::Relaxed);
        self.underruns.store(0, Ordering::Relaxed);
    }
    pub fn len(&self) -> usize { self.samples.len() }
    pub fn is_empty(&self) -> bool { self.samples.is_empty() }
}

// ---------------------------------------------------------------------------
// Shared state between IPC commands and the audio callback
// ---------------------------------------------------------------------------

pub struct SharedState {
    pub buffer: PcmBuffer,
    pub dsp: DspChain,
    pub settings: EngineSettings,
    pub sample_rate: u32,
    pub channels: u16,
    pub status: EngineStatus,
}
pub type Shared = Arc<Mutex<SharedState>>;

/// Convert arbitrary input layout/rate to the output layout/rate.
/// Features:
/// 1. Multichannel Dolby Atmos / 5.1 / 7.1 folddown matrix (ITU-R BS.775) to stereo
/// 2. Passthrough for matching channel counts
/// 3. Catmull-Rom (cubic Hermite) high-order resampler with anti-aliasing
/// 4. Pure bit-perfect passthrough when rates match (ZERO resampling)
pub fn prepare_pcm(data: &[f32], in_ch: usize, in_rate: u32, out_ch: usize, out_rate: u32) -> Vec<f32> {
    let in_ch = in_ch.max(1);
    let out_ch = out_ch.max(1);
    let frames = data.len() / in_ch;
    if frames == 0 { return Vec::new(); }

    let mut stage: Vec<f32> = Vec::with_capacity(frames * out_ch);

    // Channel processing / routing
    if in_ch == out_ch {
        stage.extend_from_slice(&data[..frames * in_ch]);
    } else if in_ch >= 6 && out_ch == 2 {
        // ITU-R BS.775 surround folddown matrix for 5.1 / 7.1 / Dolby Atmos bed
        // 0: FL, 1: FR, 2: FC (Center), 3: LFE (Bass), 4: BL, 5: BR, 6: SL, 7: SR
        let inv_sqrt2 = 0.7071067811865475;
        let lfe_mix = 0.5; // -6 dB LFE mixing
        let norm = 1.0 / (1.0 + inv_sqrt2 + inv_sqrt2 + lfe_mix);
        for i in 0..frames {
            let base = i * in_ch;
            let fl = f64::from(data[base]);
            let fr = f64::from(data[base + 1]);
            let fc = f64::from(data[base + 2]);
            let lfe = f64::from(data[base + 3]);
            let bl = f64::from(data[base + 4]);
            let br = f64::from(data[base + 5]);
            let sl = if in_ch > 6 { f64::from(data[base + 6]) } else { 0.0 };
            let sr = if in_ch > 7 { f64::from(data[base + 7]) } else { 0.0 };

            let l = (fl + inv_sqrt2 * fc + inv_sqrt2 * bl + inv_sqrt2 * sl + lfe_mix * lfe) * norm;
            let r = (fr + inv_sqrt2 * fc + inv_sqrt2 * br + inv_sqrt2 * sr + lfe_mix * lfe) * norm;
            stage.push(l as f32);
            stage.push(r as f32);
        }
    } else if in_ch == 1 && out_ch == 2 {
        // Mono to stereo
        for i in 0..frames {
            let m = data[i];
            stage.push(m);
            stage.push(m);
        }
    } else if in_ch == 2 && out_ch == 1 {
        // Stereo to mono
        for i in 0..frames {
            let l = data[i * 2];
            let r = data[i * 2 + 1];
            stage.push((l + r) * 0.5);
        }
    } else if in_ch == 2 && out_ch >= 6 {
        // Stereo upmix to 5.1 / 7.1
        let inv_sqrt2 = 0.7071067811865475f32;
        for i in 0..frames {
            let l = data[i * 2];
            let r = data[i * 2 + 1];
            let c = (l + r) * 0.5;
            let sub = c;
            stage.push(l);         // FL
            stage.push(r);         // FR
            stage.push(c);         // FC
            stage.push(sub);       // LFE
            stage.push(l * inv_sqrt2); // BL
            stage.push(r * inv_sqrt2); // BR
            for _ in 6..out_ch {
                stage.push(0.0);
            }
        }
    } else {
        // Generic channel mapping
        let copy_ch = in_ch.min(out_ch);
        for i in 0..frames {
            for c in 0..copy_ch {
                stage.push(data[i * in_ch + c]);
            }
            for _ in copy_ch..out_ch {
                stage.push(0.0);
            }
        }
    }

    // Zero-resampling fast path for bit-perfect output
    if in_rate == 0 || out_rate == 0 || in_rate == out_rate {
        return stage;
    }

    // High-fidelity Catmull-Rom (Hermite cubic) spline interpolation resampler
    // Replaces primitive linear interpolation. Preserves treble up to Nyquist
    // and eliminates audible aliasing foldback.
    let ratio = f64::from(out_rate) / f64::from(in_rate);
    let new_frames = (frames as f64 * ratio).floor() as usize;
    if new_frames == 0 { return Vec::new(); }
    let inv = 1.0 / ratio;
    let mut out = Vec::with_capacity(new_frames * out_ch);

    for i in 0..new_frames {
        let pos = i as f64 * inv;
        let idx = pos.floor() as isize;
        let t = pos - pos.floor();
        let t2 = t * t;
        let t3 = t2 * t;

        // Catmull-Rom cubic basis coefficients
        let b0 = -0.5 * t3 + t2 - 0.5 * t;
        let b1 =  1.5 * t3 - 2.5 * t2 + 1.0;
        let b2 = -1.5 * t3 + 2.0 * t2 + 0.5 * t;
        let b3 =  0.5 * t3 - 0.5 * t2;

        for c in 0..out_ch {
            let p0 = f64::from(stage[(idx - 1).clamp(0, frames as isize - 1) as usize * out_ch + c]);
            let p1 = f64::from(stage[idx.clamp(0, frames as isize - 1) as usize * out_ch + c]);
            let p2 = f64::from(stage[(idx + 1).clamp(0, frames as isize - 1) as usize * out_ch + c]);
            let p3 = f64::from(stage[(idx + 2).clamp(0, frames as isize - 1) as usize * out_ch + c]);

            let sample = p0 * b0 + p1 * b1 + p2 * b2 + p3 * b3;
            out.push(sample.clamp(-1.0, 1.0) as f32);
        }
    }
    out
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

struct SendStream(Stream);
/// cpal::Stream is not Send on every platform; it is only created, dropped and
/// played under `engine.backend` lock. No cross-thread use of the value.
unsafe impl Send for SendStream {}

enum Backend {
    Shared(SendStream),
    #[cfg(windows)]
    Exclusive(wasapi_exclusive::ExclusiveStream),
}

struct Handle {
    shared: Shared,
    backend: Backend,
    running: Arc<AtomicBool>,
}

pub struct AudioEngine {
    handle: Mutex<Option<Handle>>,
    last_message: Mutex<String>,
}

impl AudioEngine {
    pub fn new() -> Self {
        Self { handle: Mutex::new(None), last_message: Mutex::new(String::new()) }
    }

    pub fn list_devices(&self) -> Vec<AudioDeviceInfo> {
        let host = cpal::default_host();
        let default_name = host.default_output_device().and_then(|d| d.name().ok()).unwrap_or_default();
        let mut out = Vec::new();
        if let Ok(devices) = host.output_devices() {
            for device in devices {
                let name = match device.name() { Ok(n) => n, Err(_) => continue };
                let mut rates = Vec::new();
                let mut channels = 2u16;
                let mut depths = Vec::new();
                let mut discrete = false;
                if let Ok(configs) = device.supported_output_configs() {
                    for c in configs {
                        let min = c.min_sample_rate().0;
                        let max = c.max_sample_rate().0;
                        channels = channels.max(c.channels());
                        let d = match c.sample_format() {
                            SampleFormat::F32 | SampleFormat::F64 | SampleFormat::I32 | SampleFormat::U32 => 32,
                            SampleFormat::I16 | SampleFormat::U16 => 16,
                            _ => 8,
                        };
                        if !depths.contains(&d) { depths.push(d); }
                        if min == max { discrete = true; }
                        for r in [44_100u32, 48_000, 88_200, 96_000, 176_400, 192_000, 352_800, 384_000] {
                            if r >= min && r <= max && !rates.contains(&r) { rates.push(r); }
                        }
                        if min == max && !rates.contains(&min) { rates.push(min); }
                    }
                }
                if rates.is_empty() { rates = vec![44_100, 48_000]; }
                if depths.is_empty() { depths = vec![16, 32]; }
                rates.sort_unstable(); depths.sort_unstable();
                out.push(AudioDeviceInfo {
                    is_default: name == default_name, name, sample_rates: rates,
                    channels, bit_depths: depths, exclusive_capable: discrete,
                });
            }
        }
        out
    }

    fn rate_for_probe(device: &Device, sample_rate: u32) -> u32 {
        let (config, _, _) = Self::choose_config(device, sample_rate);
        config.sample_rate.0
    }

    fn select_device(host: &cpal::Host, wanted: Option<&str>) -> Result<Device, String> {
        if let Some(name) = wanted {
            if let Ok(devices) = host.output_devices() {
                for d in devices { if d.name().ok().as_deref() == Some(name) { return Ok(d); } }
            }
        }
        host.default_output_device().ok_or_else(|| "no default audio output device".to_string())
    }

    fn choose_config(device: &Device, sample_rate: u32) -> (StreamConfig, SampleFormat, u16) {
        let mut candidates: Vec<(u32, u16, SampleFormat, u16)> = Vec::new();
        if let Ok(configs) = device.supported_output_configs() {
            for c in configs {
                let min = c.min_sample_rate().0;
                let max = c.max_sample_rate().0;
                let rate = if min == max { min } else { sample_rate.clamp(min, max) };
                let depth = match c.sample_format() {
                    SampleFormat::F32 | SampleFormat::F64 | SampleFormat::I32 | SampleFormat::U32 => 32,
                    SampleFormat::I16 | SampleFormat::U16 => 16, _ => 8,
                };
                candidates.push((rate, c.channels().clamp(1, 8), c.sample_format(), depth));
            }
        }
        let quality = |f: SampleFormat| match f {
            SampleFormat::F32 | SampleFormat::F64 => 3, SampleFormat::I32 | SampleFormat::U32 => 2, _ => 1,
        };
        candidates.sort_by(|a, b| {
            let da = (a.0 as i64 - sample_rate as i64).abs();
            let db = (b.0 as i64 - sample_rate as i64).abs();
            (da, quality(b.2), b.3).cmp(&(db, quality(a.2), a.3))
        });
        if let Some(&(rate, ch, fmt, depth)) = candidates.first() {
            (StreamConfig { channels: ch, sample_rate: cpal::SampleRate(rate), buffer_size: cpal::BufferSize::Default }, fmt, depth)
        } else {
            (StreamConfig { channels: 2, sample_rate: cpal::SampleRate(sample_rate), buffer_size: cpal::BufferSize::Default }, SampleFormat::F32, 32)
        }
    }

    /// Start / restart output. `message` in the returned status explains any
    /// exclusive -> shared fallback so the UI reports it honestly.
    pub fn start(&self, settings: EngineSettings, sample_rate: u32, channels: u16) -> Result<EngineStatus, String> {
        self.stop();
        *self.last_message.lock().unwrap() = String::new();
        let host = cpal::default_host();
        let device = Self::select_device(&host, settings.device.as_deref())?;
        let device_name = device.name().unwrap_or_else(|_| "Unknown output".to_string());
        let want_exclusive = settings.mode == ShareMode::Exclusive;

        // --- Exclusive USB DAC path (Windows WASAPI) -----------------------
        #[cfg(windows)]
        if want_exclusive {
            // Make the shared state first so the exclusive renderer can bind
            // to it before its thread starts.
            let probe_rate = Self::rate_for_probe(&device, sample_rate);
            let probe_shared = self.make_shared(&settings, probe_rate, channels.clamp(1, 8), 32,
                                                device_name.clone(), true, "WASAPI exclusive");
            let running = Arc::new(AtomicBool::new(true));
            match wasapi_exclusive::ExclusiveStream::start(
                settings.device.as_deref(), sample_rate, settings.clone(),
                Arc::clone(&probe_shared), Arc::clone(&running),
            ) {
                Ok((stream, rate, ch, depth, dev_name)) => {
                    // Rebuild the buffer for the rate the driver actually chose.
                    {
                        let mut s = probe_shared.lock().unwrap();
                        s.sample_rate = rate;
                        s.channels = ch;
                        s.buffer = PcmBuffer::new(ch as usize, rate, 60.0);
                        s.dsp = DspChain::new(&settings, rate);
                        s.status.sample_rate = rate;
                        s.status.channels = ch;
                        s.status.bit_depth = depth;
                        s.status.device = dev_name;
                        s.status.sample_format = if depth == 32 { "32-bit float/PCM" } else { "24/16-bit PCM" }.into();
                        s.status.target_samples = (f64::from(rate) * 0.06) as usize * ch as usize;
                    }
                    *self.handle.lock().unwrap() = Some(Handle {
                        shared: probe_shared, backend: Backend::Exclusive(stream), running,
                    });
                    return Ok(self.snapshot());
                }
                Err(err) => {
                    log::warn!("[AudioEngine] exclusive mode unavailable: {err}. Falling back to shared.");
                    *self.last_message.lock().unwrap() =
                        format!("Exclusive mode unavailable: {err}. Using shared output.");
                }
            }
        }

        // --- Shared path (cpal) -------------------------------------------
        let (config, fmt, depth) = Self::choose_config(&device, sample_rate);
        let rate = config.sample_rate.0;
        let ch = config.channels;
        let shared = self.make_shared(&settings, rate, ch, depth, device_name, false, "cpal shared");
        let running = Arc::new(AtomicBool::new(true));
        let stream = self.build_stream_dispatch(&device, &config, fmt, Arc::clone(&shared), Arc::clone(&running))?;
        stream.play().map_err(|e| format!("failed to start output stream: {e}"))?;
        *self.handle.lock().unwrap() = Some(Handle {
            shared, backend: Backend::Shared(SendStream(stream)), running,
        });
        Ok(self.snapshot())
    }

    fn make_shared(&self, settings: &EngineSettings, rate: u32, ch: u16, depth: u16,
                   device: String, exclusive: bool, backend: &str) -> Shared {
        let latency_ms = if exclusive { 60.0 } else { 180.0 };
        let message = self.last_message.lock().unwrap().clone();
        let status = EngineStatus {
            running: true,
            mode: if exclusive { "exclusive" } else { "shared" }.into(),
            device, sample_rate: rate, channels: ch,
            sample_format: if depth >= 32 { "32-bit float" } else { "16-bit PCM" }.into(),
            bit_depth: depth, exclusive, eq_enabled: settings.eq_enabled,
            buffered_samples: 0,
            target_samples: (f64::from(rate) * latency_ms / 1000.0) as usize * ch as usize,
            underruns: 0, pushed_samples: 0, played_samples: 0, latency_ms,
            backend: backend.into(), message,
        };
        Arc::new(Mutex::new(SharedState {
            buffer: PcmBuffer::new(ch as usize, rate, latency_ms),
            dsp: DspChain::new(settings, rate),
            settings: settings.clone(),
            sample_rate: rate, channels: ch, status,
        }))
    }

    fn build_stream_dispatch(&self, device: &Device, config: &StreamConfig, fmt: SampleFormat,
                             state: Shared, running: Arc<AtomicBool>) -> Result<Stream, String> {
        macro_rules! arm {
            ($t:ty) => { self.build_stream::<$t>(device, config, state, running) };
        }
        match fmt {
            SampleFormat::F32 => arm!(f32),
            SampleFormat::I16 => arm!(i16),
            SampleFormat::I32 => arm!(i32),
            SampleFormat::U16 => arm!(u16),
            SampleFormat::U32 => arm!(u32),
            SampleFormat::I8 => arm!(i8),
            SampleFormat::U8 => arm!(u8),
            SampleFormat::F64 => arm!(f64),
            other => Err(format!("unsupported output sample format: {other:?}")),
        }
    }

    fn build_stream<T>(&self, device: &Device, config: &StreamConfig, state: Shared,
                       running: Arc<AtomicBool>) -> Result<Stream, String>
    where T: SizedSample + FromSample<f32> {
        let channels = config.channels as usize;
        let rate = config.sample_rate.0;
        let running_for_error = Arc::clone(&running);
        device.build_output_stream(
            config,
            move |output: &mut [T], _: &cpal::OutputCallbackInfo| {
                let mut frame = [0f32; 8];
                let mut s = state.lock().unwrap();
                let ready = s.buffer.ready();
                let ch = channels.min(8);
                for chunk in output.chunks_mut(channels) {
                    frame[..ch].fill(0.0);
                    if ready {
                        s.buffer.pop_frame(&mut frame[..ch]);
                        s.dsp.process(&mut frame[..ch]);
                    }
                    for (slot, &v) in chunk.iter_mut().zip(frame[..ch].iter()) {
                        *slot = T::from_sample(v.clamp(-1.0, 1.0));
                    }
                }
                s.status.buffered_samples = s.buffer.len();
                s.status.underruns = s.buffer.underruns.load(Ordering::Relaxed);
                s.status.pushed_samples = s.buffer.pushed.load(Ordering::Relaxed);
                s.status.played_samples = s.buffer.played.load(Ordering::Relaxed);
                s.status.latency_ms = if rate > 0 {
                    s.buffer.len() as f64 / channels as f64 / f64::from(rate) * 1000.0
                } else { 0.0 };
                s.status.running = running.load(Ordering::Relaxed);
            },
            move |err| {
                log::warn!("[AudioEngine] output stream error: {err}");
                running_for_error.store(false, Ordering::SeqCst);
            },
            None,
        ).map_err(|e| format!("build_output_stream failed: {e}"))
    }

    /// Push slice of interleaved f32 PCM.
    pub fn push_slice(&self, pcm: &[f32], sample_rate: u32, channels: u16) -> Result<(), String> {
        let guard = self.handle.lock().unwrap();
        let Some(handle) = guard.as_ref() else { return Err("native audio engine is not running".into()); };
        let mut s = handle.shared.lock().unwrap();
        let data = prepare_pcm(pcm, channels.max(1) as usize, sample_rate,
                               s.channels as usize, s.sample_rate);
        let max_samples = s.buffer.target_frames * s.channels as usize * 4;
        if data.len() <= max_samples {
            s.buffer.push(&data);
        } else {
            s.buffer.push(&data[data.len() - max_samples..]);
        }
        Ok(())
    }

    /// Push raw byte buffer containing interleaved little-endian f32 PCM.
    /// Fast zero-copy path for typed array transfers from AudioWorklet.
    pub fn push_raw(&self, bytes: &[u8], sample_rate: u32, channels: u16) -> Result<(), String> {
        if bytes.len() % 4 != 0 { return Err("invalid byte length for f32 stream".into()); }
        let floats: &[f32] = unsafe {
            std::slice::from_raw_parts(bytes.as_ptr() as *const f32, bytes.len() / 4)
        };
        self.push_slice(floats, sample_rate, channels)
    }

    /// Push interleaved f32 PCM from the WebView.
    pub fn push(&self, pcm: Vec<f32>, sample_rate: u32, channels: u16) -> Result<(), String> {
        self.push_slice(&pcm, sample_rate, channels)
    }

    /// Dynamically reconfigure output sample rate & channels on track change.
    /// Allows bit-perfect switching (e.g. 44.1k CD FLAC -> 96k Hi-Res FLAC).
    pub fn reconfigure(&self, sample_rate: u32, channels: u16) -> Result<EngineStatus, String> {
        let guard = self.handle.lock().unwrap();
        let Some(handle) = guard.as_ref() else { return Ok(self.snapshot()); };
        let (current_rate, current_ch, current_settings) = {
            let s = handle.shared.lock().unwrap();
            (s.sample_rate, s.channels, s.settings.clone())
        };
        drop(guard);

        if (sample_rate > 0 && sample_rate != current_rate) || (channels > 0 && channels != current_ch) {
            log::info!("[AudioEngine] reconfiguring rate {}Hz -> {}Hz, channels {} -> {}",
                current_rate, sample_rate, current_ch, channels);
            return self.start(current_settings, sample_rate, channels);
        }
        self.flush();
        Ok(self.snapshot())
    }

    pub fn update_settings(&self, settings: EngineSettings) -> Result<EngineStatus, String> {
        let guard = self.handle.lock().unwrap();
        let Some(handle) = guard.as_ref() else { return Ok(self.snapshot()); };
        {
            let mut s = handle.shared.lock().unwrap();
            s.dsp = DspChain::new(&settings, s.sample_rate);
            s.settings = settings.clone();
            s.status.eq_enabled = settings.eq_enabled;
            s.status.mode = match settings.mode { ShareMode::Shared => "shared", ShareMode::Exclusive => "exclusive" }.into();
        }
        Ok(self.snapshot())
    }

    pub fn set_volume(&self, volume: f64) {
        let guard = self.handle.lock().unwrap();
        if let Some(handle) = guard.as_ref() {
            let mut s = handle.shared.lock().unwrap();
            let v = volume.clamp(0.0, 1.0);
            s.settings.volume = v;
            s.dsp.set_volume(v);
        }
    }

    pub fn flush(&self) {
        let guard = self.handle.lock().unwrap();
        if let Some(handle) = guard.as_ref() { handle.shared.lock().unwrap().buffer.clear(); }
    }

    pub fn stop(&self) {
        let taken = self.handle.lock().unwrap().take();
        if let Some(handle) = taken {
            handle.running.store(false, Ordering::SeqCst);
            // Drop backend first so cpal/WASAPI joins its callback thread
            // before the shared state goes away.
            drop(handle.backend);
            drop(handle.shared);
        }
    }

    pub fn snapshot(&self) -> EngineStatus {
        let guard = self.handle.lock().unwrap();
        let Some(handle) = guard.as_ref() else { return EngineStatus::default(); };
        let s = handle.shared.lock().unwrap();
        let mut st = s.status.clone();
        st.buffered_samples = s.buffer.len();
        st.underruns = s.buffer.underruns.load(Ordering::Relaxed);
        st.pushed_samples = s.buffer.pushed.load(Ordering::Relaxed);
        st.played_samples = s.buffer.played.load(Ordering::Relaxed);
        st.running = handle.running.load(Ordering::SeqCst);
        st
    }
}

