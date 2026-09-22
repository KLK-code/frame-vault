use super::active_vault;
use crate::error::AppResult;
use crate::state::AppState;
use crate::vault::{self, Entry};
use tauri::State;

#[tauri::command]
pub fn save_entry(
    state: State<'_, AppState>,
    id: String,
    title: String,
    created_at: String,
    folder_id: Option<String>,
) -> AppResult<String> {
    let vault_dir = active_vault(state.inner())?;

    // 记录属于哪个场景：跟着文件夹走
    let folders = vault::list_folders(&vault_dir)?;
    let scene = vault::effective_scene(&folders, folder_id.as_deref());

    let entry = Entry::new(&id, &title, &created_at).in_folder(folder_id, scene.clone());
    println!(
        "[rust] save_entry: {id} scene={scene} -> {}",
        vault_dir.display()
    );

    let path = vault::write_entry(&vault_dir, &entry)?;
    Ok(path.display().to_string())
}

#[tauri::command]
pub fn load_entry(state: State<'_, AppState>, id: String) -> AppResult<Entry> {
    let vault_dir = active_vault(state.inner())?;
    Ok(vault::read_entry(&vault_dir, &id)?)
}

/// 列出记录；给了 folder_id 就只看那个场景下的（None = 全部）
#[tauri::command]
pub fn list_entries(
    state: State<'_, AppState>,
    folder_id: Option<String>,
) -> AppResult<Vec<Entry>> {
    let vault_dir = active_vault(state.inner())?;
    let mut list = vault::list_entries(&vault_dir)?;

    if let Some(folder) = folder_id {
        list.retain(|e| e.folder_id.as_deref() == Some(folder.as_str()));
    }

    Ok(list)
}

/// 读当前仓库的身份信息（vault.json）
#[tauri::command]
pub fn read_vault_meta(state: State<'_, AppState>) -> AppResult<vault::VaultMeta> {
    let vault_dir = active_vault(state.inner())?;
    Ok(vault::read_vault_meta(&vault_dir)?)
}
