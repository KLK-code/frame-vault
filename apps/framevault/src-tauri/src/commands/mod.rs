//! 接线层：只做三件事——**收参数（校验）→ 调领域层 → 把结果/错误变成能过桥的形状**。
//! 业务规则一律不写在这里。

pub mod entry;
pub mod folder;
pub mod vault;
pub mod window;

use crate::error::{AppError, AppResult};
use crate::state::AppState;
use std::path::PathBuf;

/// 所有命令共用的"当前仓库是哪个"
pub(crate) fn active_vault(state: &AppState) -> AppResult<PathBuf> {
    let guard = state.vaults.lock()?;
    guard.active.clone().ok_or(AppError::NotSelected)
}
