//! `vaultfs://` —— 让 WebView 显示**仓库里**的媒体。
//!
//! 为什么不能用 asset 协议：它内部是 `std::fs::File::open` + scope 校验，
//! 而安卓 SAF 上的照片**没有文件系统路径**（只有 `content://` 树 URI + Kotlin 桥）。
//! 这条协议把 URL 里的路径交给**当前仓库的 store** 去读字节，于是两端一条代码路径。
//!
//! URL 形状：`http://vaultfs.localhost/<仓库内相对路径>`（百分号编码；为什么不是
//! `vaultfs://localhost/…` 见 `url_for` 的注释 —— 那是 tauri 按平台定的形式）。
//! 用**相对路径**而不是记录 id / 媒体 id：加载一张图不该顺带把整个仓库扫一遍
//! （`vault/` 里的定位一律"按扫描"，那是给增删改用的重活）。
//!
//! 桌面也能用这条协议，但那边 asset 协议更直接（`convertFileSrc`），
//! 所以是否给出 `vaultfs://` 地址由**后端能力**决定（`VaultStore::native_paths`）。

use crate::commands;
use crate::state::AppState;
use crate::vault;
use tauri::Manager;

/// 读一个媒体文件：返回 (MIME, 字节)
pub fn read(app: &tauri::AppHandle, url_path: &str) -> Result<(String, Vec<u8>), String> {
    let state = app
        .try_state::<AppState>()
        .ok_or_else(|| "仓库状态还没就绪".to_string())?;
    let reference = commands::active_vault_ref(&state).map_err(|e| e.to_string())?;
    let vault = commands::vault_for_ref(app, &reference).map_err(|e| e.to_string())?;

    let rel = percent_decode(url_path.trim_start_matches('/'))
        .ok_or_else(|| format!("地址里的转义看不懂：{url_path}"))?;

    // 不许跑出仓库：相对路径里出现 `..` 就直接拒绝（前端不该给，但这条协议是公开入口）
    if rel.split('/').any(|segment| segment == "..") {
        return Err("路径不许跑到仓库外面去".to_string());
    }

    let path = vault.join(&rel);
    let bytes = vault.read_bytes(&path).map_err(|e| e.to_string())?;
    Ok((mime_of(&rel), bytes))
}

/// 按扩展名给个 MIME（WebView 认它决定怎么显示）
fn mime_of(name: &str) -> String {
    let ext = name
        .rsplit_once('.')
        .map(|(_, ext)| ext.to_lowercase())
        .unwrap_or_default();
    match ext.as_str() {
        "jpg" | "jpeg" | "jpe" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "avif" => "image/avif",
        "tif" | "tiff" => "image/tiff",
        "heic" | "heif" => "image/heic",
        "mp4" | "m4v" => "video/mp4",
        "mov" => "video/quicktime",
        "webm" => "video/webm",
        "avi" => "video/x-msvideo",
        "mkv" => "video/x-matroska",
        "json" => "application/json",
        "md" => "text/markdown; charset=utf-8",
        _ => "application/octet-stream",
    }
    .to_string()
}

/// 百分号编码：只放行 URL 路径里安全的那批 ASCII，其余（中文、空格、`#`…）一律转义。
pub fn percent_encode(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for byte in text.as_bytes() {
        let safe = matches!(*byte, b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9'
            | b'-' | b'_' | b'.' | b'~' | b'/');
        if safe {
            out.push(*byte as char);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

/// 百分号解码成路径字符串；遇到不合法的转义返回 `None`。
pub fn percent_decode(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let hex = bytes.get(index + 1..index + 3)?;
            let value = u8::from_str_radix(std::str::from_utf8(hex).ok()?, 16).ok()?;
            out.push(value);
            index += 3;
        } else {
            out.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(out).ok()
}

/// 给一条媒体算它的 `vaultfs://` 地址（仓库内相对路径，百分号编码）。
pub fn url_for(vault: &vault::Vault, absolute: &std::path::Path) -> String {
    let rel = vault
        .relative(absolute)
        .map(|p| p.to_string_lossy().replace('\\', "/"))
        .unwrap_or_else(|| absolute.to_string_lossy().replace('\\', "/"));
    // tauri 的规矩（`app.rs` 里 register_asynchronous_uri_scheme_protocol 的文档原话）：
    // macOS / iOS / Linux 是 `<scheme>://localhost/<path>`，
    // **Windows 与 Android 是 `http://<scheme>.localhost/<path>`**。
    // 而这条地址只有 SAF 后端会要（= 只可能是安卓），所以发这个形式刚刚好。
    format!("http://vaultfs.localhost/{}", percent_encode(&rel))
}

/// 给前端/日志用：把错误变成 404 的正文
pub fn read_or_message(app: &tauri::AppHandle, url_path: &str) -> (u16, String, Vec<u8>) {
    match read(app, url_path) {
        Ok((mime, bytes)) => (200, mime, bytes),
        Err(err) => (404, "text/plain; charset=utf-8".to_string(), err.into_bytes()),
    }
}

#[cfg(test)]
mod tests {
    use super::{percent_decode, percent_encode};

    #[test]
    fn percent_round_trips_chinese_and_specials() {
        for raw in [
            "科研/论文笔记/2026-09-23 周报/2026-09-23_写作_01.jpg",
            "未归类/2026-09-24 随手记/照片 #1 (2).png",
            "a/b/c.md",
            "",
        ] {
            let encoded = percent_encode(raw);
            assert!(!encoded.contains(' '), "空格必须转义：{encoded}");
            assert_eq!(percent_decode(&encoded).as_deref(), Some(raw));
        }
    }

    #[test]
    fn percent_encode_keeps_slashes_but_escapes_the_rest() {
        assert_eq!(percent_encode("a/b c.jpg"), "a/b%20c.jpg");
        assert_eq!(percent_encode("照片.jpg"), "%E7%85%A7%E7%89%87.jpg");
    }

    #[test]
    fn percent_decode_rejects_junk() {
        assert_eq!(percent_decode("%E7%85"), None, "半个转义不合法");
        assert_eq!(percent_decode("%ZZ"), None);
        assert_eq!(percent_decode("abc"), Some("abc".to_string()));
    }
}
