//! 接线层：只做三件事——**收参数（校验）→ 调领域层 → 把结果/错误变成能过桥的形状**。
//! 业务规则一律不写在这里。

pub mod entry;
pub mod folder;
pub mod media;
pub mod vault;
pub mod window;

use crate::error::{AppError, AppResult};
use crate::state::AppState;
use std::path::{Path, PathBuf};
use tauri::Manager;

/// 所有命令共用的"当前仓库是哪个"
pub(crate) fn active_vault(state: &AppState) -> AppResult<PathBuf> {
    let guard = state.vaults.lock()?;
    guard.active.clone().ok_or(AppError::NotSelected)
}

/// 缩略图缓存目录：`<应用数据>/thumbs/<vault-id>/`
///
/// **刻意不进 Vault**（PRD §9 / FV-SYN-002）：缩略图是可重建缓存，
/// 放进 Vault 只会让同步白白搬几 GB，还会在每台设备上冲突。
pub(crate) fn thumbs_dir(app: &tauri::AppHandle, vault_dir: &Path) -> AppResult<PathBuf> {
    let vault_id = crate::vault::read_vault_meta(vault_dir)?.vault_id;
    Ok(app.path().app_data_dir()?.join("thumbs").join(vault_id))
}

/// 放行 asset 协议读这个 Vault —— WebView 里显示本地照片/视频的**唯一通道**。
///
/// 只放行「当前 Vault」和「它自己的缩略图缓存」，**不用 `**` 把整台机器都打开**：
/// 前端一旦被注入，能读的范围就是这里放行的范围。
pub(crate) fn allow_vault_assets(app: &tauri::AppHandle, vault_dir: &Path) {
    let scope = app.asset_protocol_scope();
    if let Err(e) = scope.allow_directory(vault_dir, true) {
        eprintln!("[rust] 放行 Vault 目录失败（{}）：{e}", vault_dir.display());
    }
    if let Ok(dir) = thumbs_dir(app, vault_dir) {
        let _ = scope.allow_directory(&dir, false);
    }
}
