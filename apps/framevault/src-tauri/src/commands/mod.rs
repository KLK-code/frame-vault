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
    match reference {
        VaultRef::Fs(path) => Ok(Vault::at(path)),
        // SAF 那条链在 S2 接上（Kotlin 桥 + SafStore）。在那之前明确报错 ——
        // **绝不退化成一条看着能用、实际会写错地方的路径**。
        VaultRef::Saf(uri) => saf_vault(app, &uri),
    }
}

/// SAF 仓库的根句柄。**S2 的落点就是这里**：改成
/// `crate::saf::vault_for_uri(app, uri)`（Kotlin 桥 + `SafStore`）。
/// 签名先按"要拿得到 AppHandle"写死，免得接上那天又满仓库改调用点。
fn saf_vault(_app: &tauri::AppHandle, uri: &str) -> AppResult<Vault> {
    Err(AppError::Invalid(format!(
        "「{uri}」在安卓的外部存储上，当前版本还不支持读写它（SAF 支持还没做完）"
    )))
}

/// 当前仓库的**桌面路径**：只给"真的需要一条文件系统路径"的地方用 ——
/// asset 协议放行、缩略图缓存目录、以及 S3 之前的媒体导入。理由同上：宁可报错。
pub(crate) fn active_vault_dir(state: &AppState) -> AppResult<PathBuf> {
    let reference = active_vault_ref(state)?;
    match reference.as_path() {
        Some(path) => Ok(path.to_path_buf()),
        None => Err(AppError::Invalid(
            "这个仓库在安卓的外部存储上，当前版本还不支持读写它".to_string(),
        )),
    }
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
