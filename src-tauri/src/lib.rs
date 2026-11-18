//! ScholarBox desktop/mobile shell.
//!
//! The whole product lives in the webview; Rust only does the few things a
//! browser cannot: reach arbitrary folders on disk, open native dialogs, make
//! HTTP requests without CORS, and persist a settings file.

use tauri::{Manager, Runtime};
use tauri_plugin_fs::FsExt;

/// Grant the webview access to a user-chosen vault folder.
///
/// The vault is a plain folder anywhere on disk (that is the whole point of the
/// app), so the static scopes in `tauri.conf.json` cannot cover it. The frontend
/// calls this once per opened vault, before any read/write.
///
/// Two scopes must be widened:
/// * the `fs` plugin scope — used by `readTextFile`, `writeFile`, …
/// * the asset-protocol scope — used by `convertFileSrc()` to stream PDFs,
///   which is what keeps a 500 MB PDF out of the IPC bridge entirely.
#[tauri::command]
fn allow_vault_scope<R: Runtime>(app: tauri::AppHandle<R>, path: String) -> Result<(), String> {
    let dir = std::path::PathBuf::from(&path);
    if !dir.is_absolute() {
        return Err(format!("文献库路径必须是绝对路径: {path}"));
    }

    app.fs_scope()
        .allow_directory(&dir, true)
        .map_err(|err| format!("无法授权文件访问: {err}"))?;

    app.asset_protocol_scope()
        .allow_directory(&dir, true)
        .map_err(|err| format!("无法授权 PDF 读取: {err}"))?;

    Ok(())
}

/// Reveal the vault folder in the system file manager (nice-to-have for the
/// settings screen; failures are not fatal).
#[tauri::command]
fn reveal_vault(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let dir = std::path::PathBuf::from(&path);
    if !dir.exists() {
        return Err(format!("文件夹不存在: {path}"));
    }
    #[cfg(target_os = "windows")]
    {
        let _ = app;
        std::process::Command::new("explorer")
            .arg(&dir)
            .spawn()
            .map_err(|err| err.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        let _ = app;
        std::process::Command::new("open")
            .arg(&dir)
            .spawn()
            .map_err(|err| err.to_string())?;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let _ = app;
        std::process::Command::new("xdg-open")
            .arg(&dir)
            .spawn()
            .map_err(|err| err.to_string())?;
    }
    Ok(())
}

/// 把整个仓库文件夹移进系统回收站。
///
/// 前端只在「删除仓库文件夹」时调用，且调用前已经把危险路径挡掉了
/// （`src/lib/vault/delete.ts` 的 `guardDeletePath`）。这里再校验一次：
/// 传进来的必须是存在的目录，不能是盘符根。
///
/// 失败返回 `unavailable: ...`，前端据此退回「直接删除」并告诉用户不可恢复。
#[tauri::command]
fn trash_path(path: String) -> Result<(), String> {
    let target = std::path::PathBuf::from(&path);
    if !target.exists() {
        return Err(format!("not-found: {}", path));
    }
    if !target.is_dir() {
        return Err(format!("not-a-directory: {}", path));
    }
    if target.parent().is_none() {
        return Err("refuse: 目标是根目录".to_string());
    }
    trash::delete(&target).map_err(|err| format!("unavailable: {err}"))?;
    Ok(())
}

// git 专用 HTTP 通道。
//
// 为什么不用 tauri-plugin-http：插件既不读系统代理、也没有「只用 IPv4」的开关。
// 本机实测直连 github.com（IPv4/IPv6 都试过）必超时，只有走系统代理
// （如 Clash 的 127.0.0.1:7890）才能 2.5s 内连通。这里用 reqwest 自建客户端，
// 把套接字钉在 IPv4 上、读系统代理并 apply 到客户端，顺带绕开插件白名单。
//
// 2026-11-17 补：**经代理失败时退回直连**，并把每一次请求（方法、主机、状态码、
// 字节数、耗时、失败原因）写进 `%LOCALAPPDATA%\ScholarBox\git.log`。
// 之前的版本只在 stderr 打一行，GUI 程序没有控制台 —— 等于什么线索都没有。
#[tauri::command]
async fn git_http(
    url: String,
    method: String,
    headers: std::collections::HashMap<String, String>,
    body_b64: Option<String>,
) -> Result<serde_json::Value, String> {
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    let started = std::time::Instant::now();
    let verb = reqwest::Method::from_bytes(method.to_uppercase().as_bytes()).map_err(|e| e.to_string())?;
    let body = match body_b64 {
        Some(b64) => Some(STANDARD.decode(b64).map_err(|e| e.to_string())?),
        None => None,
    };
    let host = url
        .split('/')
        .nth(2)
        .unwrap_or(&url)
        .to_string();

    let mut attempts: Vec<String> = Vec::new();
    let mut response: Option<reqwest::Response> = None;

    if let Some(proxy) = proxy_for_git() {
        match send_git(&git_client(true), verb.clone(), &url, &headers, body.as_deref()).await {
            Ok(res) => response = Some(res),
            Err(err) => {
                attempts.push(format!("经代理 {proxy} 失败：{err}"));
                app_log("git", &format!("{host} 经代理失败，改直连重试：{err}"));
            }
        }
    }
    if response.is_none() {
        match send_git(&git_client(false), verb, &url, &headers, body.as_deref()).await {
            Ok(res) => response = Some(res),
            Err(err) => attempts.push(format!("直连失败：{err}")),
        }
    }

    let Some(res) = response else {
        let detail = attempts.join("；");
        app_log("git", &format!("{host} 请求失败（{}ms）：{detail}", started.elapsed().as_millis()));
        return Err(detail);
    };

    let status = res.status().as_u16();
    let mut out_headers = serde_json::Map::new();
    for (k, v) in res.headers().iter() {
        out_headers.insert(k.as_str().to_string(), serde_json::Value::String(v.to_str().unwrap_or("").to_string()));
    }
    let bytes = res.bytes().await.map_err(|e| e.to_string())?;
    app_log(
        "git",
        &format!(
            "{host} {status} {}B {}ms",
            bytes.len(),
            started.elapsed().as_millis()
        ),
    );
    Ok(serde_json::json!({
        "status": status,
        "headers": out_headers,
        "body": STANDARD.encode(bytes),
    }))
}

/// 发一次请求。`headers` 用引用，重试时不用克隆整个 body。
async fn send_git(
    client: &reqwest::Client,
    verb: reqwest::Method,
    url: &str,
    headers: &std::collections::HashMap<String, String>,
    body: Option<&[u8]>,
) -> Result<reqwest::Response, String> {
    let mut req = client.request(verb, url);
    for (k, v) in headers {
        req = req.header(k.as_str(), v.as_str());
    }
    if let Some(bytes) = body {
        req = req.body(bytes.to_vec());
    }
    req.send().await.map_err(|e| {
        // reqwest 的 Display 只有一层，真正原因常在 source 里
        let mut chain = format!("{e}");
        let mut src: Option<&(dyn std::error::Error + 'static)> = std::error::Error::source(&e);
        while let Some(inner) = src {
            chain.push_str(&format!(" ← {inner}"));
            src = inner.source();
        }
        chain
    })
}

/// 建（并缓存）git 用的 reqwest 客户端。`use_proxy=false` 时是完全直连的版本，
/// 只在代理那条路失败时用。
fn git_client(use_proxy: bool) -> reqwest::Client {
    use std::sync::OnceLock;
    static PROXIED: OnceLock<reqwest::Client> = OnceLock::new();
    static DIRECT: OnceLock<reqwest::Client> = OnceLock::new();

    let build = |proxy: Option<&str>| {
        let mut builder = reqwest::Client::builder()
            .local_address(std::net::IpAddr::V4(std::net::Ipv4Addr::UNSPECIFIED))
            // 大仓库的 packfile 可能上百 MB，90s 不够
            .timeout(std::time::Duration::from_secs(180))
            .redirect(reqwest::redirect::Policy::limited(5))
            // 本机网络下 github.com 的 HTTP/2 连接会被中途重置（RFC 10054），钉死 HTTP/1.1
            .http1_only();
        if let Some(raw) = proxy {
            if let Some(addr) = extract_proxy(raw, "https") {
                if let Ok(p) = reqwest::Proxy::https(proxy_url(&addr)) {
                    builder = builder.proxy(p);
                }
            }
            if let Some(addr) = extract_proxy(raw, "http") {
                if let Ok(p) = reqwest::Proxy::http(proxy_url(&addr)) {
                    builder = builder.proxy(p);
                }
            }
        }
        builder.build().expect("build git http client")
    };

    if use_proxy {
        PROXIED
            .get_or_init(|| build(proxy_for_git().as_deref()))
            .clone()
    } else {
        DIRECT.get_or_init(|| build(None)).clone()
    }
}

/// 这次运行用哪个代理：环境变量优先，其次 Windows 注册表。首次调用时记一条日志。
fn proxy_for_git() -> Option<String> {
    use std::sync::OnceLock;
    static PICKED: OnceLock<Option<String>> = OnceLock::new();
    PICKED
        .get_or_init(|| {
            let picked = system_proxy();
            app_log(
                "git",
                &match &picked {
                    Some(raw) => format!("使用代理：{raw}"),
                    None => "没有读到系统代理，直连".to_string(),
                },
            );
            picked
        })
        .clone()
}

/// 前端写日志（同步失败的报告、分支操作都落到这里）。
#[tauri::command]
fn log_append(scope: String, line: String) {
    let scope = if scope == "sync" || scope == "startup" { scope } else { "sync".to_string() };
    app_log(&scope, &line);
}

/// 读系统代理原始串：先看环境变量（跨平台通用、也方便用户显式指定），
/// 再看 Windows 的 WinINET 注册表（Clash/v2ray 等代理客户端都会写这里）。
/// 返回形如 `127.0.0.1:7890` 或 `http=127.0.0.1:7890;https=127.0.0.1:7890`。
fn system_proxy() -> Option<String> {
    for key in [
        "HTTPS_PROXY",
        "https_proxy",
        "HTTP_PROXY",
        "http_proxy",
        "ALL_PROXY",
        "all_proxy",
    ] {
        if let Ok(v) = std::env::var(key) {
            let v = v.trim().to_string();
            if !v.is_empty() {
                return Some(v);
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        use winreg::enums::HKEY_CURRENT_USER;
        use winreg::RegKey;
        let settings = RegKey::predef(HKEY_CURRENT_USER)
            .open_subkey("Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings")
            .ok()?;
        let enabled: u32 = settings.get_value("ProxyEnable").unwrap_or(0);
        if enabled == 0 {
            return None;
        }
        let server: String = settings.get_value("ProxyServer").ok()?;
        let server = server.trim().to_string();
        if !server.is_empty() {
            return Some(server);
        }
    }

    None
}

/// 从 ProxyServer 原始串里取指定协议（`http`/`https`）的代理地址。
/// 支持两种写法：
/// - 简单式 `127.0.0.1:7890`：对 http/https 通吃；
/// - 分段式 `http=...;https=...`：按协议取，https 缺失时回退到 http（WinINET 行为）。
/// 只认 http/https，`socks=` 段会被跳过（reqwest 没开 socks feature，走不了）。
fn extract_proxy(proxy_server: &str, scheme: &str) -> Option<String> {
    let raw = proxy_server.trim();
    if raw.is_empty() {
        return None;
    }
    if raw.contains('=') {
        let mut fallback: Option<String> = None;
        for part in raw.split(';') {
            let part = part.trim();
            let Some((proto, addr)) = part.split_once('=') else {
                continue;
            };
            let addr = addr.trim();
            if addr.is_empty() {
                continue;
            }
            if proto.eq_ignore_ascii_case(scheme) {
                return Some(addr.to_string());
            }
            if proto.eq_ignore_ascii_case("http") {
                fallback = Some(addr.to_string());
            }
        }
        return fallback;
    }
    Some(raw.to_string())
}

/// reqwest 的 `Proxy::https/http` 要求带 scheme 的 URL，而注册表里的地址通常不带
/// （如 `127.0.0.1:7890`），这里统一补成 `http://...`。
fn proxy_url(addr: &str) -> String {
    let addr = addr.trim();
    if addr.contains("://") {
        addr.to_string()
    } else {
        format!("http://{addr}")
    }
}

/// 收集 WebView2 user data folder 的候选目录。
///
/// 为什么不是「必须 ASCII」：这台机器上实测过，中文路径本身能正常启动
/// （`F:\sb-中文测试\`、`F:\项目\中文测试\x\` 都跑起来了）；真正让 WebView2 报
/// `HRESULT(0x800700AA) 请求的资源在使用中` 的，是数据目录被另一个进程占着、
/// 或者程序所在目录的 ACL / 安全软件拦了 WebView2 的子进程。所以这里只做两件事：
/// 1. 优先挑**纯 ASCII** 的目录（历史上出问题的组合基本都在非 ASCII 路径上，优先避开）；
/// 2. 保留非 ASCII 的候选，**不再为了 ASCII 把它们全丢掉** —— 中文用户名用户的
///    `%LOCALAPPDATA%` 就是中文的，丢掉它等于把唯一合理的落点也放弃了。
///
/// 顺序：显式环境变量 → `%LOCALAPPDATA%` → `%ProgramData%` → 临时目录。
/// 失败一个就换下一个（调用方逐个重试），不会因为第一个不可用就起不来。
#[cfg(windows)]
fn webview_data_candidates() -> Vec<std::path::PathBuf> {
    let mut raw: Vec<std::path::PathBuf> = Vec::new();

    // 用户显式指定时无条件尊重（排第一，也不参与 ASCII 排序）
    if let Some(custom) = std::env::var_os("SCHOLARBOX_WEBVIEW_DATA") {
        let path = std::path::PathBuf::from(custom);
        if path.is_absolute() {
            raw.push(path);
        }
    }
    if let Some(base) = std::env::var_os("LOCALAPPDATA") {
        raw.push(std::path::PathBuf::from(base).join("ScholarBox").join("Webview2"));
    }
    if let Some(base) = std::env::var_os("ProgramData") {
        raw.push(std::path::PathBuf::from(base).join("ScholarBox").join("Webview2"));
    }
    raw.push(std::env::temp_dir().join("ScholarBox-Webview2"));

    // 稳定排序：纯 ASCII 的候选往前挪，非 ASCII 的保留在后面兜底
    raw.sort_by_key(|path| !path.to_string_lossy().is_ascii());

    let mut seen: Vec<String> = Vec::new();
    let mut usable: Vec<std::path::PathBuf> = Vec::new();
    for dir in raw {
        let key = dir.to_string_lossy().to_lowercase();
        if seen.contains(&key) {
            continue;
        }
        seen.push(key);
        match std::fs::create_dir_all(&dir) {
            Ok(()) => {
                startup_log(&format!(
                    "WebView2 候选目录：{}（ASCII={}）",
                    dir.display(),
                    if dir.to_string_lossy().is_ascii() { "是" } else { "否" }
                ));
                usable.push(dir);
            }
            Err(err) => startup_log(&format!("候选目录不可用：{}（{err}）", dir.display())),
        }
    }

    if usable.is_empty() {
        // 全都不行也要返回一个，让 WebView2 自己报错，至少错误信息里带着尝试过的路径
        usable.push(std::env::temp_dir().join("ScholarBox-Webview2"));
    }
    usable
}

/// 启动日志。桌面端 GUI 没有控制台，出问题只能靠这个文件排查。
fn startup_log(line: &str) {
    app_log("startup", line);
}

/// 统一落盘：`%LOCALAPPDATA%\ScholarBox\{scope}.log`（startup / git / sync）。
///
/// 超过 512 KiB 就滚成 `.1`，只保留一代 —— 排查问题够用，又不会无限长。
fn app_log(scope: &str, line: &str) {
    eprintln!("[{scope}] {line}");
    let Some(path) = log_file_path(scope) else { return };
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(meta) = std::fs::metadata(&path) {
        if meta.len() > 512 * 1024 {
            let rolled = path.with_file_name(format!("{scope}.log.1"));
            let _ = std::fs::rename(&path, rolled);
        }
    }
    if let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).open(&path) {
        use std::io::Write;
        let _ = writeln!(file, "{line}");
    }
}

fn log_file_path(scope: &str) -> Option<std::path::PathBuf> {
    if let Some(base) = std::env::var_os("LOCALAPPDATA") {
        return Some(
            std::path::PathBuf::from(base)
                .join("ScholarBox")
                .join(format!("{scope}.log")),
        );
    }
    Some(std::env::temp_dir().join(format!("ScholarBox-{scope}.log")))
}

fn startup_log_path() -> Option<std::path::PathBuf> {
    log_file_path("startup")
}

#[cfg(windows)]
fn show_startup_error(detail: &str) {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::UI::WindowsAndMessaging::{MB_ICONERROR, MB_OK, MessageBoxW};

    fn wide(s: &OsStr) -> Vec<u16> {
        s.encode_wide().chain(std::iter::once(0)).collect()
    }

    let exe = std::env::current_exe().unwrap_or_default();
    let log = startup_log_path()
        .map(|path| path.display().to_string())
        .unwrap_or_else(|| "（不可写）".to_string());
    let body = format!(
        "ScholarBox 启动失败：无法创建 WebView2 窗口。\n\n\
         程序路径：{}\n\n\
         已尝试的 WebView2 数据目录与错误：\n{}\n\n\
         常见原因（按可能性排序）：\n\
         1. 还有别的 ScholarBox 进程（或上次崩溃残留的 msedgewebview2.exe）占着数据目录 —— \
         在任务管理器里结束它们再启动；\n\
         2. 安全软件 / 公司 EDR 拦了 WebView2 创建子进程 —— 把程序目录和上面的数据目录加入白名单；\n\
         3. 程序所在目录或数据目录的权限异常（例如被加了 DENY 访问控制项）—— 安装包可以自选安装路径，\
         换一个普通目录（如 D:\\Apps\\ScholarBox）再装一次。\n\n\
         说明：路径里有中文本身不会导致启动失败（实测中文目录能正常启动）；\
         如果你换过一次目录就好了，那多半是原目录的权限或安全策略不同。\n\n\
         诊断日志：{}\n",
        exe.display(),
        detail.trim(),
        log,
    );

    let title: Vec<u16> = wide(OsStr::new("ScholarBox 无法启动"));
    let text: Vec<u16> = wide(OsStr::new(&body));
    unsafe {
        MessageBoxW(0, text.as_ptr(), title.as_ptr(), MB_OK | MB_ICONERROR);
    }
}

#[cfg(not(windows))]
fn show_startup_error(detail: &str) {
    startup_log(&format!("启动失败：{detail}"));
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    startup_log("===== 启动 =====");

    let mut builder = tauri::Builder::default()
        // Order matters only for the store files: `store` keeps settings.json,
        // `http` gives isomorphic-git a CORS-free transport for GitHub.
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![
            allow_vault_scope,
            reveal_vault,
            trash_path,
            git_http,
            log_append
        ]);

    #[cfg(windows)]
    {
        let dirs = webview_data_candidates();
        builder = builder.setup(move |app| {
            // 窗口在 tauri.conf.json 里是 `create: false`，这里手动建：
            // 只有手动建才能把 `data_directory` 换成我们挑好的目录。
            //
            // 逐个候选目录重试：WebView2 报 0x800700AA（资源在使用中）几乎都是
            // 「这个数据目录被占了 / 权限不对」，换个目录就能起来。以前只试一次，
            // 于是第一个目录不可用就等于整个应用起不来。
            let mut failures: Vec<String> = Vec::new();
            for dir in &dirs {
                match create_main_window(app, dir) {
                    Ok(()) => {
                        startup_log(&format!("主窗口已创建，数据目录：{}", dir.display()));
                        return Ok(());
                    }
                    Err(err) => {
                        startup_log(&format!("建窗失败（数据目录 {}）：{err}", dir.display()));
                        failures.push(format!("{} → {err}", dir.display()));
                    }
                }
            }

            // 不能把 Err 往上抛：tauri 自己在 app.rs 用了 expect()，
            // 那样用户只会看到控制台 panic 而不是这段中文说明。
            show_startup_error(&failures.join("\n"));
            std::process::exit(1);
        });
    }
    #[cfg(not(windows))]
    {
        builder = builder.setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_title("ScholarBox");
            }
            Ok(())
        });
    }

    if let Err(err) = builder.run(tauri::generate_context!()) {
        // 到这儿说明窗口没起来（最常见就是 WebView2）。绝不能裸崩，
        // 用户至少要知道去哪儿看诊断日志。
        show_startup_error(&err.to_string());
        std::process::exit(1);
    }
}

/// 建主窗口，显式指定 WebView2 的数据目录。
///
/// 上一次尝试失败可能留下一个半成品窗口，第二次建同名窗口会报 label 重复，
/// 所以先把它清掉 —— 否则重试永远失败，真正的错误还会被这个「重复 label」盖住。
#[cfg(windows)]
fn create_main_window<R: Runtime, M: Manager<R>>(manager: &M, dir: &std::path::Path) -> Result<(), String> {
    if let Some(existing) = manager.get_webview_window("main") {
        let _ = existing.destroy();
    }
    let cfg = manager
        .config()
        .app
        .windows
        .first()
        .cloned()
        .ok_or_else(|| "tauri.conf.json 里缺少窗口配置".to_string())?;
    tauri::WebviewWindowBuilder::from_config(manager, &cfg)
        .and_then(|window| window.data_directory(dir.to_path_buf()).build())
        .map(|_| ())
        .map_err(|err| err.to_string())
}
