//! Vault 领域核心。
//!
//! **这个模块里不许出现 `tauri`**——只依赖 std / serde / uuid。
//! 这样它才能被 `cargo test` 直接测，将来也能整体搬进 `crates/framevault-core`。
//!
//! 磁盘布局的权威描述在 `docs/PROPOSAL_storage_v2_zh-CN.md`（v2「人可读层级」），
//! 路径约定只有 `storage.rs` 说了算，命名只有 `naming.rs` 说了算。

mod folder;
mod id;
mod media;
mod model;
mod naming;
mod scene;
mod storage;
mod store;

pub use folder::{
    create_folder_in, delete_folder, folder_dir, folder_path, list_folders, next_order, read_folder,
    save_folder, sort_folders, FolderMeta,
};
pub use id::new_id;
pub use media::{
    exif_taken_at, import_into_entry, is_media_ext, sort_media, write_thumbnail, MediaMeta,
};
pub use naming::{
    day_of, entry_dir_name, media_file_stem, sanitize, scene_dir_name, NameVars,
    DEFAULT_MEDIA_TEMPLATE, ENTRY_FILE, FOLDER_FILE, NOTE_FILE, UNCATEGORIZED,
};
pub use model::{is_supported, Entry, VaultMeta, SCHEMA_VERSION};
pub use scene::{builtin_scenes, is_known as is_known_scene, SceneInfo, PLAIN_SCENE};
pub use store::{DirEntry, MemStore, NativeFs, Vault, VaultStore};
pub use storage::{
    create_entry, create_vault, ensure_uncategorized, entry_dirs_in, entry_json_path, entry_slot,
    find_entry_dir, find_folder_dir, folder_dirs, folder_json_path, internal_dir, is_vault,
    list_entries, list_trash_dirs, move_entry_to_slot, reorder_entries, note_path, read_entry, read_entry_from,
    read_text, read_vault_meta, rename_topic, restore_entry, root_dirs, topic_dir, topic_dirs,
    trash_entry, trash_entry_path, vault_meta_path, write_entry, write_json_atomic,
    write_text_atomic,
};
pub use storage::{create_topic, delete_topic};
