use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt;

#[cfg(windows)]
use std::os::windows::io::AsRawHandle;
#[cfg(windows)]
use std::os::windows::process::CommandExt;

const SERVER_PORT: u16 = 7644;
const LOGIN_WINDOW: &str = "soundcloud-login";
const LOGIN_TIMEOUT: Duration = Duration::from_secs(300);
const LOGIN_POLL_INTERVAL: Duration = Duration::from_secs(4);

/// Labels for social-login popups must be unique, so each one gets a number.
static NEXT_POPUP: AtomicU64 = AtomicU64::new(1);

#[cfg(windows)]
#[derive(Clone, Copy)]
struct SendHandle(windows_sys::Win32::Foundation::HANDLE);
#[cfg(windows)]
unsafe impl Send for SendHandle {}
#[cfg(windows)]
unsafe impl Sync for SendHandle {}

#[cfg(windows)]
struct ServerProcess {
    child: Child,
    job_handle: Option<SendHandle>,
}

#[cfg(not(windows))]
struct ServerProcess {
    child: Child,
}

static SERVER_PROCESS: Mutex<Option<ServerProcess>> = Mutex::new(None);

fn clean_path<P: AsRef<Path>>(path: P) -> PathBuf {
    let s = path.as_ref().to_string_lossy();
    #[cfg(windows)]
    {
        if let Some(stripped) = s.strip_prefix(r"\\?\UNC\") {
            return PathBuf::from(format!(r"\\{}", stripped));
        }
        if let Some(stripped) = s.strip_prefix(r"\\?\") {
            return PathBuf::from(stripped);
        }
    }
    PathBuf::from(s.as_ref())
}

fn is_server_running(port: u16) -> bool {
    let addr = format!("127.0.0.1:{}", port);
    if let Ok(socket_addr) = addr.parse() {
        TcpStream::connect_timeout(&socket_addr, Duration::from_millis(150)).is_ok()
    } else {
        false
    }
}

fn find_server_dir(app_handle: &tauri::AppHandle) -> Option<(PathBuf, PathBuf)> {
    let mut candidates = Vec::new();

    // 1. Tauri resource directory (installed app or release bundle)
    if let Ok(res_dir) = app_handle.path().resource_dir() {
        let clean_res = clean_path(res_dir);
        candidates.push(clean_res.join("server"));
        candidates.push(clean_res.join("resources").join("server"));
        candidates.push(clean_res.join("_up_"));
        candidates.push(clean_res.join("resources"));
        candidates.push(clean_res);
    }

    // 2. Next to current exe (portable / unpacked)
    if let Ok(exe_path) = std::env::current_exe() {
        let clean_exe = clean_path(exe_path);
        if let Some(parent) = clean_exe.parent() {
            candidates.push(parent.join("server"));
            candidates.push(parent.join("_up_"));
            candidates.push(parent.join("resources").join("server"));
            candidates.push(parent.join("resources"));
            candidates.push(parent.to_path_buf());
            if let Some(grandparent) = parent.parent() {
                candidates.push(grandparent.join("server"));
                candidates.push(grandparent.to_path_buf());
                if let Some(greatgrandparent) = grandparent.parent() {
                    candidates.push(greatgrandparent.join("server"));
                    candidates.push(greatgrandparent.to_path_buf());
                    if let Some(g4) = greatgrandparent.parent() {
                        candidates.push(g4.to_path_buf());
                    }
                }
            }
        }
    }

    // 3. Current working directory
    candidates.push(clean_path(PathBuf::from("server")));
    candidates.push(clean_path(PathBuf::from(".")));

    // 4. Source / compile time directory fallback (for tauri dev / debug)
    if let Some(manifest_dir) = option_env!("CARGO_MANIFEST_DIR") {
        let p = clean_path(PathBuf::from(manifest_dir));
        if let Some(parent) = p.parent() {
            candidates.push(parent.to_path_buf());
        }
    }

    for dir in candidates {
        let server_file = dir.join("server.js");
        if server_file.exists() {
            return Some((clean_path(dir), clean_path(server_file)));
        }
    }

    None
}

fn find_node_executable(server_dir: &Path) -> PathBuf {
    // 1. Check bundled node inside server directory
    let server_candidates = [
        server_dir.join("bin").join("node.exe"),
        server_dir.join("bin").join("node"),
        server_dir.join("node.exe"),
        server_dir.join("node"),
        server_dir.join("..").join("bin").join("node.exe"),
        server_dir.join("..").join("node.exe"),
    ];
    for c in &server_candidates {
        if c.exists() {
            return c.clone();
        }
    }

    // 2. Check next to current exe
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(parent) = exe_path.parent() {
            let exe_candidates = [
                parent.join("bin").join("node.exe"),
                parent.join("node.exe"),
                parent.join("server").join("bin").join("node.exe"),
                parent.join("server").join("node.exe"),
                parent.join("_up_").join("bin").join("node.exe"),
                parent.join("..").join("bin").join("node.exe"),
            ];
            for c in &exe_candidates {
                if c.exists() {
                    return c.clone();
                }
            }
        }
    }

    // 3. Check project root bin directory
    if let Some(manifest_dir) = option_env!("CARGO_MANIFEST_DIR") {
        let p = PathBuf::from(manifest_dir);
        if let Some(parent) = p.parent() {
            let dev_node = parent.join("bin").join("node.exe");
            if dev_node.exists() {
                return dev_node;
            }
        }
    }

    // 4. Check well-known Windows locations
    #[cfg(windows)]
    {
        let common_paths = [
            r"C:\Program Files\nodejs\node.exe",
            r"C:\Program Files (x86)\nodejs\node.exe",
        ];
        for p in &common_paths {
            let pb = PathBuf::from(p);
            if pb.exists() {
                return pb;
            }
        }
        if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
            let fnm_node = PathBuf::from(&local_app_data).join(r"Programs\node\node.exe");
            if fnm_node.exists() {
                return fnm_node;
            }
        }
    }

    // 5. Fall back to system PATH
    PathBuf::from("node")
}

#[cfg(windows)]
unsafe fn assign_to_job_object(raw_handle: std::os::windows::io::RawHandle) -> Option<SendHandle> {
    use std::mem::size_of;
    use std::ptr::null_mut;
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, SetInformationJobObject,
        JobObjectExtendedLimitInformation, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };

    let job = CreateJobObjectW(null_mut(), null_mut());
    if job == 0 as _ {
        return None;
    }

    let mut jeli: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
    jeli.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;

    let res = SetInformationJobObject(
        job,
        JobObjectExtendedLimitInformation,
        &jeli as *const _ as *const _,
        size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
    );

    if res != 0 {
        AssignProcessToJobObject(job, raw_handle as _);
    }

    Some(SendHandle(job))
}

fn start_server(app_handle: &tauri::AppHandle) -> Result<(), String> {
    if is_server_running(SERVER_PORT) {
        log::info!("Server is already running on port {}", SERVER_PORT);
        return Ok(());
    }

    let (raw_work_dir, raw_server_path) = find_server_dir(app_handle)
        .ok_or_else(|| "Could not locate server.js in application directories. Please verify the application files are intact.".to_string())?;

    let work_dir = clean_path(raw_work_dir);
    let server_path = clean_path(raw_server_path);
    let node_bin = clean_path(find_node_executable(&work_dir));

    log::info!("Launching Node server: {:?} in {:?}", node_bin, work_dir);

    // Resolve persistent data directory
    let data_dir = clean_path(
        app_handle
            .path()
            .app_data_dir()
            .unwrap_or_else(|_| work_dir.clone())
    );
    let _ = std::fs::create_dir_all(&data_dir);

    let mut cmd = Command::new(&node_bin);
    // Passing "server.js" if server_path is in work_dir avoids Windows UNC / verbatim path issues with Node.js
    if server_path.parent() == Some(&work_dir) {
        cmd.arg("server.js");
    } else {
        cmd.arg(&server_path);
    }

    cmd.current_dir(&work_dir)
        .env("PORT", SERVER_PORT.to_string())
        .env("MOONPLAYER_DATA_DIR", data_dir.to_string_lossy().to_string());

    // Redirect stdout and stderr to server.log for diagnostics
    let log_path = data_dir.join("server.log");
    if let Ok(mut log_file) = std::fs::File::create(&log_path) {
        use std::io::Write;
        let _ = writeln!(
            log_file,
            "[MoonPlayer] Node: {:?}\n[MoonPlayer] WorkDir: {:?}\n[MoonPlayer] DataDir: {:?}\n",
            node_bin, work_dir, data_dir
        );
        if let Ok(err_file) = log_file.try_clone() {
            cmd.stdout(log_file);
            cmd.stderr(err_file);
        }
    }

    #[cfg(windows)]
    {
        // CREATE_NO_WINDOW = 0x08000000
        cmd.creation_flags(0x08000000);
    }

    let child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn Node backend ({:?}): {}. Please make sure Node.js is installed or bundled.", node_bin, e))?;

    #[cfg(windows)]
    {
        let raw_handle = child.as_raw_handle();
        let job_handle = unsafe { assign_to_job_object(raw_handle) };
        let mut proc_guard = SERVER_PROCESS.lock().unwrap();
        *proc_guard = Some(ServerProcess { child, job_handle });
    }

    #[cfg(not(windows))]
    {
        let mut proc_guard = SERVER_PROCESS.lock().unwrap();
        *proc_guard = Some(ServerProcess { child });
    }

    // Wait up to 12 seconds for the server to bind
    let start_time = Instant::now();
    let timeout = Duration::from_secs(12);
    let mut ready = false;

    while start_time.elapsed() < timeout {
        std::thread::sleep(Duration::from_millis(200));
        if is_server_running(SERVER_PORT) {
            ready = true;
            break;
        }
    }

    if !ready {
        let log_content = std::fs::read_to_string(&log_path).unwrap_or_default();
        let last_log = if log_content.trim().is_empty() {
            String::new()
        } else {
            let lines: Vec<&str> = log_content.lines().collect();
            let tail = if lines.len() > 10 { &lines[lines.len() - 10..] } else { &lines[..] };
            format!("\n\nServer log output:\n{}", tail.join("\n"))
        };

        return Err(format!(
            "Node server started, but did not respond on port {} within 12 seconds.\nWorking dir: {:?}\nServer: {:?}\nNode: {:?}{}",
            SERVER_PORT, work_dir, server_path, node_bin, last_log
        ));
    }

    log::info!("Node server successfully started and listening on port {}", SERVER_PORT);
    Ok(())
}

fn stop_server() {
    let mut proc_guard = SERVER_PROCESS.lock().unwrap();
    if let Some(mut proc) = proc_guard.take() {
        let _ = proc.child.kill();
        #[cfg(windows)]
        if let Some(job) = proc.job_handle.take() {
            unsafe {
                windows_sys::Win32::Foundation::CloseHandle(job.0);
            }
        }
    }
}

fn escape_html(input: &str) -> String {
    input
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
        .replace('\n', "<br>")
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SoundCloudLogin {
    oauth_token: String,
    datadome_cookie: Option<String>,
}

/// Opens a SoundCloud sign-in window in the app's own WebView and returns the
/// session cookies once the user has logged in. The caller persists them.
///
/// The wait runs on its own thread. A sync command is executed on Tauri's async
/// worker, and sleeping there stalls the runtime the window needs to paint and
/// to handle its close button.
#[tauri::command]
async fn soundcloud_login(app: AppHandle) -> Result<SoundCloudLogin, String> {
    if let Some(existing) = app.get_webview_window(LOGIN_WINDOW) {
        let _ = existing.show();
        let _ = existing.set_focus();
    } else {
        open_login_window(&app)?;
    }

    tauri::async_runtime::spawn_blocking(move || wait_for_sign_in(app))
        .await
        .map_err(|err| format!("sign-in task failed: {err}"))?
}

fn wait_for_sign_in(app: AppHandle) -> Result<SoundCloudLogin, String> {
    // Give the page time to paint before the first cookie read touches it.
    std::thread::sleep(Duration::from_secs(3));

    let deadline = Instant::now() + LOGIN_TIMEOUT;
    loop {
        let window = match app.get_webview_window(LOGIN_WINDOW) {
            Some(window) => window,
            // The user closed the window. Leave the app running.
            None => return Err("sign-in cancelled".to_string()),
        };

        match read_session_cookies(&window) {
            Ok(Some(login)) => {
                let _ = window.close();
                return Ok(login);
            }
            Ok(None) => {}
            Err(err) => {
                log::warn!("soundcloud cookie read failed: {err}");
            }
        }

        if Instant::now() >= deadline {
            if let Some(window) = app.get_webview_window(LOGIN_WINDOW) {
                let _ = window.close();
            }
            return Err("sign-in timed out".to_string());
        }
        std::thread::sleep(LOGIN_POLL_INTERVAL);
    }
}

fn open_login_window(app: &AppHandle) -> Result<(), String> {
    let url: tauri::Url = "https://soundcloud.com/signin"
        .parse()
        .map_err(|err| format!("bad sign-in url: {err}"))?;

    // The popup handler outlives this function, so it needs its own handle.
    let app_handle = app.clone();

    WebviewWindowBuilder::new(app, LOGIN_WINDOW, WebviewUrl::External(url))
        .title("Sign in to SoundCloud")
        .inner_size(960.0, 760.0)
        .resizable(true)
        .decorations(true)
        .closable(true)
        .minimizable(true)
        .center()
        // Social logins (Google, Apple, Facebook) navigate off soundcloud.com
        // and open popups. Unlike the main window, both are allowed here.
        .on_navigation(|nav_url| {
            let url = nav_url.as_str();
            url.starts_with("https://") || url.starts_with("http://") || url.starts_with("about:")
        })
        .on_new_window(move |url, features| open_login_popup(&app_handle, url, features))
        .build()
        .map_err(|err| format!("could not open sign-in window: {err}"))?;

    Ok(())
}

/// SoundCloud's social buttons call `window.open`. WebView2 has no window of
/// its own, so the page only sees a popup when the app builds one and hands it
/// back. Returning `Allow` makes `window.open` come back null, which is the
/// "Please enable popup windows" error.
fn open_login_popup(
    app: &AppHandle,
    url: tauri::Url,
    features: tauri::webview::NewWindowFeatures,
) -> tauri::webview::NewWindowResponse<tauri::Wry> {
    let scheme = url.scheme();
    if scheme != "https" && scheme != "http" {
        return tauri::webview::NewWindowResponse::Deny;
    }

    let label = format!(
        "soundcloud-popup-{}",
        NEXT_POPUP.fetch_add(1, Ordering::Relaxed)
    );
    let (width, height) = features
        .size()
        .map(|size| (size.width, size.height))
        .unwrap_or((520.0, 720.0));

    // Popups chain (Google opens a second window), so each one needs the same
    // handler. The handle is cloned per window so the closure stays 'static.
    let app_handle = app.clone();

    let mut builder = WebviewWindowBuilder::new(app, label, WebviewUrl::External(url))
        .title("SoundCloud sign-in")
        .inner_size(width, height)
        .resizable(true)
        .decorations(true)
        .closable(true)
        .minimizable(true)
        .center()
        .on_navigation(|nav_url| {
            let url = nav_url.as_str();
            url.starts_with("https://") || url.starts_with("http://") || url.starts_with("about:")
        })
        .on_new_window(move |url, features| open_login_popup(&app_handle, url, features));

    // The popup has to come from the opener's WebView2 environment, or
    // WebView2 refuses it and the page sees no window.
    #[cfg(windows)]
    {
        builder = builder.with_environment(features.opener().environment.clone());
    }
    #[cfg(not(windows))]
    {
        let _ = features;
    }

    match builder.build() {
        Ok(window) => tauri::webview::NewWindowResponse::Create { window },
        Err(err) => {
            log::warn!("soundcloud popup failed: {err}");
            tauri::webview::NewWindowResponse::Deny
        }
    }
}

#[cfg(windows)]
fn read_session_cookies(
    window: &tauri::WebviewWindow,
) -> Result<Option<SoundCloudLogin>, String> {
    use webview2_com::GetCookiesCompletedHandler;
    use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2_2;
    use windows::core::{Interface, PCWSTR};

    let (tx, rx) = std::sync::mpsc::channel();
    let tx = std::sync::Arc::new(std::sync::Mutex::new(tx));

    window
        .with_webview(move |platform| {
            let report = |result: Result<Vec<(String, String)>, String>| {
                if let Ok(tx) = tx.lock() {
                    let _ = tx.send(result);
                }
            };

            let controller = platform.controller();
            let webview = match unsafe { controller.CoreWebView2() } {
                Ok(webview) => webview,
                Err(err) => return report(Err(err.to_string())),
            };
            let webview2 = match webview.cast::<ICoreWebView2_2>() {
                Ok(webview2) => webview2,
                Err(err) => return report(Err(err.to_string())),
            };
            let manager = match unsafe { webview2.CookieManager() } {
                Ok(manager) => manager,
                Err(err) => return report(Err(err.to_string())),
            };

            let tx_handler = std::sync::Arc::clone(&tx);
            let handler = GetCookiesCompletedHandler::create(Box::new(move |hr, list| {
                let report = |result: Result<Vec<(String, String)>, String>| {
                    if let Ok(tx) = tx_handler.lock() {
                        let _ = tx.send(result);
                    }
                };
                if hr.is_err() {
                    report(Err(format!("GetCookies failed: {hr:?}")));
                    return Ok(());
                }
                let Some(list) = list else {
                    report(Ok(Vec::new()));
                    return Ok(());
                };
                report(read_cookie_list(&list));
                Ok(())
            }));

            let uri: Vec<u16> = "https://soundcloud.com\0".encode_utf16().collect();
            if let Err(err) = unsafe { manager.GetCookies(PCWSTR(uri.as_ptr()), &handler) } {
                report(Err(err.to_string()));
            }
        })
        .map_err(|err| format!("webview unavailable: {err}"))?;

    rx.recv_timeout(Duration::from_secs(15))
        .map_err(|_| "cookie read timed out".to_string())?
        .map(pick_session_cookies)
}

#[cfg(windows)]
fn read_cookie_list(
    list: &webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2CookieList,
) -> Result<Vec<(String, String)>, String> {
    use windows::core::PWSTR;

    let mut count = 0u32;
    unsafe { list.Count(&mut count) }.map_err(|err| err.to_string())?;

    let mut cookies = Vec::with_capacity(count as usize);
    for index in 0..count {
        let cookie = unsafe { list.GetValueAtIndex(index) }.map_err(|err| err.to_string())?;

        let mut name = PWSTR::null();
        let mut value = PWSTR::null();
        let name_res = unsafe { cookie.Name(&mut name) };
        let value_res = unsafe { cookie.Value(&mut value) };

        let name_str = wide_to_string(name.0);
        let value_str = wide_to_string(value.0);
        free_task_mem(name.0);
        free_task_mem(value.0);

        name_res.map_err(|err| err.to_string())?;
        value_res.map_err(|err| err.to_string())?;

        if let (Some(name), Some(value)) = (name_str, value_str) {
            cookies.push((name, value));
        }
    }
    Ok(cookies)
}

#[cfg(windows)]
fn wide_to_string(ptr: *const u16) -> Option<String> {
    if ptr.is_null() {
        return None;
    }
    let mut len = 0usize;
    while unsafe { *ptr.add(len) } != 0 {
        len += 1;
    }
    Some(String::from_utf16_lossy(unsafe {
        std::slice::from_raw_parts(ptr, len)
    }))
}

#[cfg(windows)]
fn free_task_mem(ptr: *mut u16) {
    if !ptr.is_null() {
        unsafe { windows::Win32::System::Com::CoTaskMemFree(Some(ptr.cast())) }
    }
}

#[cfg(not(windows))]
fn read_session_cookies(
    _window: &tauri::WebviewWindow,
) -> Result<Option<SoundCloudLogin>, String> {
    Err("SoundCloud sign-in window requires the Windows desktop app".to_string())
}

fn pick_session_cookies(cookies: Vec<(String, String)>) -> Option<SoundCloudLogin> {
    let mut oauth_token = None;
    let mut datadome_cookie = None;

    for (name, value) in cookies {
        if value.is_empty() {
            continue;
        }
        match name.as_str() {
            "oauth_token" if oauth_token.is_none() => oauth_token = Some(value),
            "datadome" if datadome_cookie.is_none() => datadome_cookie = Some(value),
            _ => {}
        }
    }

    oauth_token.map(|oauth_token| SoundCloudLogin {
        oauth_token,
        datadome_cookie,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![soundcloud_login])
        .plugin(tauri_plugin_log::Builder::default().level(log::LevelFilter::Info).build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .setup(|app| {
            let handle = app.handle().clone();

            // 1. Start or detect backend server
            let server_res = start_server(&handle);

            // 2. Configure target URL
            let server_url = format!("http://localhost:{}", SERVER_PORT);
            let target_url: tauri::Url = match &server_res {
                Ok(_) => server_url.parse().expect("Valid server URL"),
                Err(err) => {
                    log::error!("MoonPlayer server error: {}", err);
                    let escaped = escape_html(err);
                    let err_page = format!(
                        "data:text/html;charset=utf-8,<!DOCTYPE html><html><head><meta charset='utf-8'><title>MoonPlayer Error</title><style>body{{background:%23070708;color:%23fff;font-family:system-ui,-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;padding:24px;box-sizing:border-box;}}div{{max-width:640px;background:%23111114;border:1px solid %2327272a;border-radius:14px;padding:32px;box-shadow:0 12px 40px rgba(0,0,0,0.8);text-align:center;}}h2{{margin-top:0;color:%23f87171;font-size:20px;}}pre{{text-align:left;background:%23000;color:%23fca5a5;padding:12px;border-radius:8px;font-size:12px;overflow-x:auto;white-space:pre-wrap;word-break:break-all;}}p{{color:%23a1a1aa;font-size:14px;line-height:1.5;}}button{{margin-top:16px;background:%237c3aed;color:%23fff;border:none;padding:10px 24px;border-radius:8px;font-weight:600;cursor:pointer;}}button:hover{{background:%236d28d9;}}</style></head><body><div><h2>⚠️ MoonPlayer Startup Error</h2><p>The background server could not be started or did not respond on port {}:</p><pre>{}</pre><p>Please ensure that Node.js is installed or restart the app.</p><button onclick='location.reload()'>Retry</button></div></body></html>",
                        SERVER_PORT, escaped
                    );
                    err_page.parse().expect("Valid error data URL")
                }
            };

            let app_opener = app.handle().clone();
            let window = WebviewWindowBuilder::new(app, "main", WebviewUrl::External(target_url))
                .title("MoonPlayer")
                .inner_size(1280.0, 820.0)
                .min_inner_size(900.0, 600.0)
                .resizable(true)
                .visible(false)
                .on_navigation(move |nav_url| {
                    let url_str = nav_url.as_str();
                    let is_http = url_str.starts_with("http://") || url_str.starts_with("https://");
                    let is_local = url_str.starts_with(&format!("http://localhost:{}", SERVER_PORT))
                        || url_str.starts_with(&format!("http://127.0.0.1:{}", SERVER_PORT));

                    if is_http && !is_local {
                        let _ = app_opener.opener().open_url(url_str, None::<&str>);
                        false
                    } else {
                        true
                    }
                })
                .build()?;

            let w_show = window.clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_millis(300));
                let _ = w_show.show();
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            // Only the main window owns the backend. Closing the sign-in
            // window must not kill the server and freeze the app.
            if let tauri::WindowEvent::Destroyed = event {
                if window.label() == "main" {
                    stop_server();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                stop_server();
            }
        });
}
