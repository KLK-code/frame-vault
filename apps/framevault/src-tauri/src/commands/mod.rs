//! 接线层：只做三件事——**收参数（校验）→ 调领域层 → 把结果/错误变成能过桥的形状**。
//! 业务规则一律不写在这里。

pub mod entry;
pub mod folder;
pub mod media;
pub mod vault;
pub mod window;

use crate::error::{AppError, AppResult};
use crate::state::{AppState, VaultRef};
use crate::vault::store::Vault;
use std::path::{Path, PathBuf};
use tauri::Manager;

/// 所有命令共用的"当前仓库是哪个"（路径 / SAF 引用都可能）
pub(crate) fn active_vault_ref(state: &AppState) -> AppResult<VaultRef> {
    let guard = state.vaults.lock()?;
    guard.active.clone().ok_or(AppError::NotSelected)
}

/// 当前仓库的**根句柄**：读写一律从它走。
///
/// 桌面 = 文件系统路径，安卓 = SAF（`content://` 树 URI，**根本没有"路径"这回事**）。
/// 领域层只认句柄，所以同一条命令在两端的规则一个字都不差 ——
/// 见 `docs/PROPOSAL_mobile_vault_saf_zh-CN.md` 的跨端一致性硬线。
pub(crate) fn active_vault(state: &AppState, app: &tauri::AppHandle) -> AppResult<Vault> {
    let reference = active_vault_ref(state)?;
    vault_for_ref(app, &reference)
}

/// 把一条仓库引用变成根句柄（当前仓库、或者命令参数里指定的那条）。
///
/// SAF 那半边由 `saf.rs` 负责：安卓上是 Kotlin 桥，桌面上是"这个平台上用不了"的错误。
/// 命令层不写 cfg —— 平台差异只有一处落点（AGENTS §2）。
pub(crate) fn vault_for_ref(app: &tauri::AppHandle, reference: &VaultRef) -> AppResult<Vault> {
    match reference {
        VaultRef::Fs(path) => Ok(Vault::at(path.clone())),
        VaultRef::Saf(uri) => crate::saf::vault_for_uri(app, uri),
    }
}

/// 缩略图缓存目录：`<应用数据>/thumbs/<vault-id>/`
///
/// **刻意不进 Vault**（PRD §9 / FV-SYN-002）：缩略图是可重建缓存，
/// 放进 Vault 只会让同步白白搬几 GB，还会在每台设备上冲突。
pub(crate) fn thumbs_dir(app: &tauri::AppHandle, vault: &Vault) -> AppResult<PathBuf> {
    // vault_id 经 store 读（SAF 上照样读得到）—— 缩略图本身落在应用数据目录，
    // 那是真文件系统，两端一样
    let vault_id = crate::vault::read_vault_meta(vault)?.vault_id;
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
    if let Ok(dir) = thumbs_dir(app, &Vault::at(vault_dir.to_path_buf())) {
        let _ = scope.allow_directory(&dir, false);
    }
}
