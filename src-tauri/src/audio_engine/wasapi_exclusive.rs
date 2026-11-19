// WASAPI exclusive-mode renderer (Windows only).
//
// This is the audiophile / USB DAC path: IAudioClient is initialised with
// AUDCLNT_SHAREMODE_EXCLUSIVE against the device's native WAVEFORMATEX. No OS
// mixer, no system sample-rate conversion, no APO effects. The render thread
// is event-driven and pulls PCM from the shared 64-bit DSP state.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;

use windows::core::GUID;
use windows::Win32::Foundation::{CloseHandle, HANDLE, PROPERTYKEY};
use windows::Win32::Media::Audio::{
    eConsole, eRender, AUDCLNT_SHAREMODE_EXCLUSIVE, AUDCLNT_STREAMFLAGS_EVENTCALLBACK,
    IAudioClient, IAudioRenderClient, IMMDevice, IMMDeviceEnumerator, MMDeviceEnumerator,
    WAVEFORMATEX, WAVEFORMATEXTENSIBLE, WAVEFORMATEXTENSIBLE_0,
    DEVICE_STATE_ACTIVE,
};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoTaskMemFree, CLSCTX_ALL, COINIT_MULTITHREADED, STGM_READ,
};
use windows::Win32::System::Com::StructuredStorage::{PropVariantClear, PROPVARIANT};
use windows::Win32::System::Threading::{CreateEventW, SetEvent, WaitForSingleObject, INFINITE};
use windows::Win32::UI::Shell::PropertiesSystem::IPropertyStore;

use crate::audio_engine::Shared;

// WAVE_FORMAT_EXTENSIBLE (mmreg.h), stored as u16 for wFormatTag.
const WAVE_FORMAT_EXTENSIBLE: u32 = 0xFFFE;

// KSDATAFORMAT_SUBTYPE_IEEE_FLOAT / _PCM (ksmedia.h)
const SUBTYPE_IEEE_FLOAT: GUID = GUID::from_u128(0x00000003_0000_0010_8000_00aa00389b71);
const SUBTYPE_PCM: GUID = GUID::from_u128(0x00000001_0000_0010_8000_00aa00389b71);
// PKEY_Device_FriendlyName {A45C254E-DF1C-4EFD-8020-67D146A850E0}, 14
const PKEY_FRIENDLY_NAME_GUID: GUID = GUID::from_u128(0xA45C254E_DF1C_4EFD_8020_67D146A850E0);
const PKEY_FRIENDLY_NAME_PID: u32 = 14;

pub struct ExclusiveStream {
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
    event: EventHandle,
}

/// A Windows event handle used only to signal the render thread. Send is safe:
/// the handle is created once and signalled/closed from here.
struct EventHandle(HANDLE);
unsafe impl Send for EventHandle {}
impl EventHandle {
    fn raw(&self) -> HANDLE { self.0 }
}

impl Drop for ExclusiveStream {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        unsafe {
            let _ = SetEvent(self.event.raw());
            let _ = CloseHandle(self.event.raw());
        }
        if let Some(t) = self.thread.take() { let _ = t.join(); }
    }
}

struct ComObjects {
    client: ComPtr<IAudioClient>,
    render: ComPtr<IAudioRenderClient>,
    buffer_frames: u32,
    channels: usize,
    depth: u16,
    float: bool,
    rate: u32,
}

/// COM interfaces are apartment-affine. They are moved once onto a single
/// dedicated render thread and never used elsewhere, so Send is safe here.
struct ComPtr<T>(T);
unsafe impl<T> Send for ComPtr<T> {}
impl<T> std::ops::Deref for ComPtr<T> {
    type Target = T;
    fn deref(&self) -> &T { &self.0 }
}

impl ExclusiveStream {
    /// Open the device in exclusive mode and spawn the render thread.
    /// Returns (stream, actual sample rate, channels, bit depth, device name).
    pub fn start(
        wanted_device: Option<&str>,
        source_rate: u32,
        _settings: crate::audio_engine::EngineSettings,
        shared: Shared,
        running: Arc<AtomicBool>,
    ) -> Result<(Self, u32, u16, u16, String), String> {
        unsafe {
            let hr = CoInitializeEx(None, COINIT_MULTITHREADED);
            // S_FALSE == 1 -> already initialised. RPC_E_CHANGED_MODE
            // (0x80010106) -> initialised STA by the host UI thread; the COM
            // objects still work, so proceed instead of failing exclusive mode.
            const RPC_E_CHANGED_MODE: i32 = 0x80010106u32 as i32;
            if hr.is_err() && hr.0 != 1 && hr.0 != RPC_E_CHANGED_MODE {
                return Err(format!("CoInitializeEx failed: {hr:?}"));
            }
            let enumerator: IMMDeviceEnumerator =
                CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
                    .map_err(|e| format!("CoCreateInstance(MMDeviceEnumerator): {e}"))?;
            let device: IMMDevice = match wanted_device {
                Some(name) => find_device_by_name(&enumerator, name)
                    .ok_or_else(|| format!("output device '{name}' not found"))?,
                None => enumerator.GetDefaultAudioEndpoint(eRender, eConsole)
                    .map_err(|e| format!("GetDefaultAudioEndpoint: {e}"))?,
            };
            let device_name = device_friendly_name(&device);
            let client: IAudioClient = device.Activate(CLSCTX_ALL, None)
                .map_err(|e| format!("IMMDevice::Activate(IAudioClient): {e}"))?;

            let mix_ptr = client.GetMixFormat()
                .map_err(|e| format!("GetMixFormat: {e}"))?;
            let native_rate = (*mix_ptr).nSamplesPerSec;
            let native_channels = (*mix_ptr).nChannels;
            CoTaskMemFree(Some(mix_ptr as *mut _ as *const _));

            // Bit-perfect sample rate priority:
            // 1. Exact source rate from file (e.g. 44.1k, 48k, 88.2k, 96k, 192k)
            // 2. Exact integer multiple (2x, 4x) if DAC requires higher rate
            // 3. Device native mix rate
            // 4. Other standard audiophile sample rates
            let mut candidates: Vec<u32> = Vec::new();
            if source_rate > 0 {
                candidates.push(source_rate);
                if source_rate * 2 <= 384_000 { candidates.push(source_rate * 2); }
                if source_rate * 4 <= 384_000 { candidates.push(source_rate * 4); }
            }
            if native_rate > 0 && !candidates.contains(&native_rate) {
                candidates.push(native_rate);
            }
            for r in [44_100, 48_000, 88_200, 96_000, 176_400, 192_000, 352_800, 384_000] {
                if !candidates.contains(&r) { candidates.push(r); }
            }

            let channels = native_channels.clamp(1, 8);
            let mut accepted: Option<(WAVEFORMATEXTENSIBLE, u32, u16, bool)> = None;
            'outer: for &rate in &candidates {
                for depth in [32u16, 24, 16] {
                    for use_float in [depth == 32, false] {
                        let wfx = make_format(rate, channels, depth, use_float);
                        if client.IsFormatSupported(AUDCLNT_SHAREMODE_EXCLUSIVE, &wfx.Format, None).is_ok() {
                            accepted = Some((wfx, rate, depth, use_float));
                            break 'outer;
                        }
                    }
                }
            }
            let (format, rate, depth, use_float) = accepted.ok_or_else(|| {
                "device rejected every exclusive-mode native format".to_string()
            })?;

            let mut default_period = 0i64;
            let mut min_period = 0i64;
            client.GetDevicePeriod(Some(&mut default_period), Some(&mut min_period))
                .map_err(|e| format!("GetDevicePeriod: {e}"))?;
            let period = if min_period > 0 { min_period } else { default_period.max(100_000) };
            // Exclusive + EVENTCALLBACK requires hnsBufferDuration == hnsPeriodicity
            // (AUDCLNT_E_BUFDURATION_PERIOD_NOT_EQUAL otherwise).
            let buffer_duration = period;

            let event = CreateEventW(None, false, false, None)
                .map_err(|e| format!("CreateEventW: {e}"))?;
            if let Err(e) = client.Initialize(
                AUDCLNT_SHAREMODE_EXCLUSIVE,
                AUDCLNT_STREAMFLAGS_EVENTCALLBACK,
                buffer_duration,
                period,
                &format.Format,
                None,
            ) {
                let _ = CloseHandle(event);
                return Err(format!("IAudioClient::Initialize(EXCLUSIVE): {e}"));
            }
            if let Err(e) = client.SetEventHandle(event) {
                let _ = CloseHandle(event);
                return Err(format!("SetEventHandle: {e}"));
            }
            let buffer_frames = client.GetBufferSize().map_err(|e| {
                let _ = CloseHandle(event);
                format!("GetBufferSize: {e}")
            })?;
            let render: IAudioRenderClient = client.GetService().map_err(|e| {
                let _ = CloseHandle(event);
                format!("GetService(IAudioRenderClient): {e}")
            })?;

            let com = ComObjects {
                client: ComPtr(client), render: ComPtr(render),
                buffer_frames, channels: channels as usize,
                depth, float: use_float, rate,
            };
            client_start(&com)?;

            let stop = Arc::new(AtomicBool::new(false));
            let thread_state = ThreadState {
                com, shared, running: Arc::clone(&running), stop: Arc::clone(&stop),
                event: EventHandle(event),
            };
            let thread = std::thread::Builder::new()
                .name("moonplayer-wasapi-exclusive".into())
                .spawn(move || render_loop(thread_state))
                .map_err(|e| format!("failed to spawn render thread: {e}"))?;

            Ok((Self { stop, thread: Some(thread), event: EventHandle(event) }, rate, channels, depth, device_name))
        }
    }
}

fn client_start(com: &ComObjects) -> Result<(), String> {
    unsafe { com.client.Start().map_err(|e| format!("IAudioClient::Start: {e}")) }
}

struct ThreadState {
    com: ComObjects,
    shared: Shared,
    running: Arc<AtomicBool>,
    stop: Arc<AtomicBool>,
    event: EventHandle,
}


/// Fast non-cryptographic PRNG for audio dithering (xorshift32)
struct FastRng(u32);

impl FastRng {
    fn new() -> Self {
        Self(0x853c49e6)
    }
    #[inline(always)]
    fn next_f64(&mut self) -> f64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 17;
        self.0 ^= self.0 << 5;
        (self.0 as f64) / 4294967296.0 - 0.5
    }
    /// Triangular Probability Density Function (TPDF) dither in (-1.0, 1.0) LSB.
    #[inline(always)]
    fn tpdf(&mut self) -> f64 {
        self.next_f64() + self.next_f64()
    }
}

fn render_loop(ts: ThreadState) {
    unsafe {
        let hr = CoInitializeEx(None, COINIT_MULTITHREADED);
        const RPC_E_CHANGED_MODE: i32 = 0x80010106u32 as i32;
        if hr.is_err() && hr.0 != 1 && hr.0 != RPC_E_CHANGED_MODE {
            log::warn!("[AudioEngine] render thread CoInitializeEx: {hr:?}");
        }
        let mut frame = [0f32; 8];
        let mut rng = FastRng::new();
        while !ts.stop.load(Ordering::SeqCst) {
            let wait = WaitForSingleObject(ts.event.raw(), INFINITE);
            if wait.0 != 0 || ts.stop.load(Ordering::SeqCst) { break; }
            loop {
                let padding = match ts.com.client.GetCurrentPadding() {
                    Ok(p) => p,
                    Err(e) => { log::warn!("[AudioEngine] GetCurrentPadding: {e}"); break; }
                };
                let available = ts.com.buffer_frames.saturating_sub(padding);
                if available == 0 { break; }
                let frames = available.min(512);
                let ptr = match ts.com.render.GetBuffer(frames) {
                    Ok(p) => p,
                    Err(e) => { log::warn!("[AudioEngine] GetBuffer: {e}"); break; }
                };
                {
                    let mut s = ts.shared.lock().unwrap();
                    let ready = s.buffer.ready();
                    let ch = ts.com.channels.min(8);
                    let bytes_per_frame = ch * (ts.com.depth as usize / 8);
                    let buf = std::slice::from_raw_parts_mut(ptr, frames as usize * bytes_per_frame);
                    for f in 0..frames as usize {
                        frame[..ch].fill(0.0);
                        if ready {
                            s.buffer.pop_frame(&mut frame[..ch]);
                            s.dsp.process(&mut frame[..ch]);
                        }
                        for c in 0..ch {
                            let v = frame[c].clamp(-1.0, 1.0);
                            let off = (f * ch + c) * (ts.com.depth as usize / 8);
                            write_sample(&mut buf[off..], ts.com.depth, ts.com.float, v, &mut rng);
                        }
                    }
                    let buffered = s.buffer.len();
                    let underruns = s.buffer.underruns.load(Ordering::Relaxed);
                    let pushed = s.buffer.pushed.load(Ordering::Relaxed);
                    let played = s.buffer.played.load(Ordering::Relaxed);
                    let st = &mut s.status;
                    st.buffered_samples = buffered;
                    st.underruns = underruns;
                    st.pushed_samples = pushed;
                    st.played_samples = played;
                    st.running = ts.running.load(Ordering::Relaxed);
                    st.latency_ms = if ts.com.rate > 0 {
                        buffered as f64 / ts.com.channels as f64 / f64::from(ts.com.rate) * 1000.0
                    } else { 0.0 };
                }
                let _ = ts.com.render.ReleaseBuffer(frames, 0);
            }
        }
        let _ = ts.com.client.Stop();
    }
}

/// Write one sample in the device's native format (32-bit float, 32/24/16-bit
/// integer PCM, little-endian). Audiophile TPDF dithering applied for integer
/// depths to eliminate quantization harmonic distortion.
#[inline(always)]
unsafe fn write_sample(dst: &mut [u8], depth: u16, float: bool, v: f32, rng: &mut FastRng) {
    match (depth, float) {
        (32, true) => {
            let b = v.to_le_bytes();
            dst[..4].copy_from_slice(&b);
        }
        (32, false) => {
            let i = (f64::from(v) * 2_147_483_647.0).round().clamp(-2_147_483_648.0, 2_147_483_647.0) as i32;
            dst[..4].copy_from_slice(&i.to_le_bytes());
        }
        (24, false) => {
            let dither = rng.tpdf();
            let scaled = f64::from(v) * 8_388_607.0 + dither;
            let i = scaled.round().clamp(-8_388_608.0, 8_388_607.0) as i32;
            let b = i.to_le_bytes();
            dst[..3].copy_from_slice(&b[..3]);
        }
        (16, false) => {
            let dither = rng.tpdf();
            let scaled = f64::from(v) * 32_767.0 + dither;
            let i = scaled.round().clamp(-32_768.0, 32_767.0) as i16;
            dst[..2].copy_from_slice(&i.to_le_bytes());
        }
        _ => {}
    }
}

fn make_format(rate: u32, channels: u16, depth: u16, use_float: bool) -> WAVEFORMATEXTENSIBLE {
    let block_align = channels * (depth / 8);
    let channel_mask = match channels {
        1 => 0x0004, // SPEAKER_FRONT_CENTER
        2 => 0x0003, // SPEAKER_FRONT_LEFT | SPEAKER_FRONT_RIGHT
        4 => 0x0033, // SPEAKER_FRONT_LEFT | SPEAKER_FRONT_RIGHT | SPEAKER_BACK_LEFT | SPEAKER_BACK_RIGHT
        6 => 0x003F, // 5.1 Surround: FL | FR | FC | LFE | BL | BR
        8 => 0x063F, // 7.1 Surround / Atmos: FL | FR | FC | LFE | BL | BR | SL | SR
        _ => if channels >= 2 { 0x0003 } else { 0x0004 },
    };
    WAVEFORMATEXTENSIBLE {
        Format: WAVEFORMATEX {
            wFormatTag: WAVE_FORMAT_EXTENSIBLE as u16,
            nChannels: channels,
            nSamplesPerSec: rate,
            nAvgBytesPerSec: rate * u32::from(block_align),
            nBlockAlign: block_align,
            wBitsPerSample: depth,
            cbSize: 22,
        },
        Samples: WAVEFORMATEXTENSIBLE_0 { wValidBitsPerSample: depth },
        dwChannelMask: channel_mask,
        SubFormat: if use_float { SUBTYPE_IEEE_FLOAT } else { SUBTYPE_PCM },
    }
}

unsafe fn device_friendly_name(device: &IMMDevice) -> String {
    let store: IPropertyStore = match device.OpenPropertyStore(STGM_READ) {
        Ok(s) => s,
        Err(_) => return "WASAPI output".into(),
    };
    let key = PROPERTYKEY { fmtid: PKEY_FRIENDLY_NAME_GUID, pid: PKEY_FRIENDLY_NAME_PID };
    let mut pv: PROPVARIANT = match store.GetValue(&key) {
        Ok(v) => v,
        Err(_) => return "WASAPI output".into(),
    };
    let ptr = pv.Anonymous.Anonymous.Anonymous.pwszVal.0;
    let s = if ptr.is_null() {
        String::new()
    } else {
        let mut len = 0usize;
        while *ptr.add(len) != 0 { len += 1; }
        String::from_utf16_lossy(std::slice::from_raw_parts(ptr, len))
    };
    let _ = PropVariantClear(&mut pv as *mut _);
    if s.is_empty() { "WASAPI output".into() } else { s }
}

unsafe fn find_device_by_name(enumerator: &IMMDeviceEnumerator, name: &str) -> Option<IMMDevice> {
    let collection = enumerator.EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE).ok()?;
    let count = collection.GetCount().ok()?;
    for i in 0..count {
        if let Ok(dev) = collection.Item(i) {
            if device_friendly_name(&dev).eq_ignore_ascii_case(name) { return Some(dev); }
        }
    }
    None
}
