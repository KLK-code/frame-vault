//! Vault 领域核心。
//!
//! **这个模块里不许出现 `tauri`**——只依赖 std / serde / uuid。
//! 这样它才能被 `cargo test` 直接测，将来也能整体搬进 `crates/framevault-core`。

mod folder;
mod id;
mod model;
mod scene;
mod storage;

pub use folder::{
    delete_folder, folder_dir, folder_path, folders_dir, list_folders, next_order, read_folder,
    sort_folders, write_folder, FolderMeta,
};
pub use id::new_id;
pub use model::{is_supported, Entry, VaultMeta, SCHEMA_VERSION};
pub use scene::{builtin_scenes, is_known as is_known_scene, SceneInfo, PLAIN_SCENE};
pub use storage::{
    create_vault, entries_dir, entry_dir, entry_path, is_vault, list_entries, read_entry,
    read_vault_meta, vault_meta_path, write_entry, write_json_atomic,
};
