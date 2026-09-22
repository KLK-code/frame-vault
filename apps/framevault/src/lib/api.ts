import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ask, open } from "@tauri-apps/plugin-dialog";

/**
 * 前端与 Rust 的唯一接缝。
 *
 * 两条硬规则（docs/ARCHITECTURE_IMPL_zh-CN.md §5）：
 *   1) `invoke` / `listen` 只允许出现在这个文件里，别处一律从这里 import；
 *   2) 参数用 camelCase 传（Tauri 自动映射到 Rust 的 snake_case 形参），
 *      返回值已经是 camelCase（Rust 侧 `#[serde(rename_all = "camelCase")]`）。
 */

export type Entry = {
  schemaVersion: number;
  id: string;
  title: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  /** 属于哪个场景（文件夹）；null = 未归类 */
  folderId: string | null;
  /** 写入时生效的主题 id（快照） */
  scene: string | null;
  /** 主题自定义字段的开放区 */
  fields: Record<string, unknown>;
};

/** 一个场景 = 一个文件夹 + 绑定的主题。仓库层面是平的，没有父子关系。 */
export type FolderNode = {
  id: string;
  name: string;
  order: number;
  pinned: boolean;
  /** 用户自己绑的主题；null = 没绑，用内置普通记录 */
  scene: string | null;
  /** 实际生效的主题 id（Rust 已经算好，前端不重复推导） */
  effectiveScene: string;
  sceneConfig: Record<string, unknown>;
};

export type SceneInfo = {
  id: string;
  name: string;
  description: string;
  builtin: boolean;
};

/**
 * 一个媒体文件。前六个字段是磁盘上的事实（Rust 的 `media/<id>/meta.json`），
 * 两个 `*Path` 是命令层算好的绝对路径——前端不拼路径，改布局时只改 Rust。
 */
export type MediaItem = {
  schemaVersion: number;
  id: string;
  /** 用户原本的文件名（磁盘上其实叫 orig.<ext>） */
  name: string;
  ext: string;
  mime: string;
  bytes: number;
  width: number | null;
  height: number | null;
  /** sha256，将来去重与同步校验用 */
  hash: string;
  /** 挂在哪条记录上；null = 导入了还没整理 */
  entryId: string | null;
  addedAt: string;
  originalPath: string;
  /** 缩略图；视频或解不开的格式是 null（那就退回显示原文件） */
  thumbPath: string | null;
};

export type VaultMeta = {
  schemaVersion: number;
  vaultId: string;
  name: string;
  createdAt: string;
};

export type VaultInfo = {
  path: string;
  name: string;
  active: boolean;
  exists: boolean;
};

/** 系统确认框；点"确定"返回 true */
export const confirm = (message: string, title = "确认") => ask(message, { title, kind: "warning" });

/** 弹系统文件夹选择器；取消则返回 null */
export async function pickFolder(title: string): Promise<string | null> {
  const selected = await open({ directory: true, multiple: false, title });
  return typeof selected === "string" ? selected : null;
}

// ── 仓库 ──
export const listVaults = () => invoke<VaultInfo[]>("list_vaults");
export const addVault = (path: string) => invoke<VaultInfo[]>("add_vault", { path });
/** 在指定目录里新建 Vault；name 留空则用目录名 */
export const createVault = (path: string, name = "", createdAt = new Date().toISOString()) =>
  invoke<VaultInfo[]>("create_vault", { path, name, createdAt });

export const switchVault = (path: string) => invoke<void>("switch_vault", { path });
export const forgetVault = (path: string) => invoke<VaultInfo[]>("forget_vault", { path });

/** 切换/新增/移除仓库后 Rust 会广播这个事件，各窗口据此重新加载 */
export function onVaultChanged(handler: () => void): () => void {
  const pending = listen("vault://changed", () => handler());
  return () => {
    void pending.then((unlisten) => unlisten());
  };
}

// ── 场景（= 文件夹 + 主题）──
/** 全部场景，已排序（置顶 → order → 名称）。**分组是前端的事**。 */
export const listFolderTree = () => invoke<FolderNode[]>("list_folder_tree");

export const createFolder = (name: string, scene: string | null = null) =>
  invoke<FolderNode[]>("create_folder", { name, scene });

export const renameFolder = (id: string, name: string) =>
  invoke<FolderNode[]>("rename_folder", { id, name });

/** 删除场景；里面还有记录时 Rust 会拒绝 */
export const deleteFolder = (id: string) => invoke<FolderNode[]>("delete_folder", { id });

/** 换主题（null = 退回内置普通记录） */
export const bindFolderScene = (
  id: string,
  scene: string | null,
  sceneConfig?: Record<string, unknown>,
) => invoke<FolderNode[]>("bind_folder_scene", { id, scene, sceneConfig });

export const setFolderPinned = (id: string, pinned: boolean) =>
  invoke<FolderNode[]>("set_folder_pinned", { id, pinned });

export const reorderFolders = (orderedIds: string[]) =>
  invoke<FolderNode[]>("reorder_folders", { orderedIds });

/** 已安装的主题列表 */
export const listScenes = () => invoke<SceneInfo[]>("list_scenes");

// ── 记录 ──
/** 新建记录前先要一个 id：时间有序的 UUID v7，由 Rust 发放 */
export const newId = () => invoke<string>("new_id");

export const saveEntry = (
  id: string,
  title: string,
  options: { folderId?: string | null; createdAt?: string; updatedAt?: string } = {},
) => {
  const now = new Date().toISOString();
  return invoke<Entry>("save_entry", {
    id,
    title,
    createdAt: options.createdAt ?? now,
    updatedAt: options.updatedAt ?? now,
    folderId: options.folderId ?? null,
  });
};

export const loadEntry = (id: string) => invoke<Entry>("load_entry", { id });

/** 列出记录（新的在前）；给了 folderId 就只看那个场景里的 */
export const listEntries = (folderId: string | null = null) =>
  invoke<Entry[]>("list_entries", { folderId });

// ── 媒体 ──
/**
 * 导入一个文件（复制进 Vault，原文件不动）。
 * 长任务：Rust 侧是 `#[tauri::command(async)]`，不会占住主线程。
 */
export const importMedia = (
  sourcePath: string,
  entryId: string | null = null,
  addedAt = new Date().toISOString(),
) => invoke<MediaItem>("import_media", { sourcePath, entryId, addedAt });

/** 列出媒体（新的在前）；给了 entryId 就只看那条记录的 */
export const listMedia = (entryId: string | null = null) =>
  invoke<MediaItem[]>("list_media", { entryId });

/**
 * 本地绝对路径 → WebView 能显示的 URL（asset 协议）。
 * 能读到哪些目录由 Rust 决定：**只放行当前 Vault 和它的缩略图缓存**。
 */
export const assetUrl = (path: string) => convertFileSrc(path);

/** 弹系统文件选择器选照片/视频，可多选；取消返回空数组 */
export async function pickMediaFiles(): Promise<string[]> {
  const picked = await open({
    multiple: true,
    title: "选择要导入的照片或视频",
    filters: [
      {
        name: "照片与视频",
        extensions: [
          "jpg", "jpeg", "png", "webp", "gif", "bmp", "tif", "tiff", "heic", "avif",
          "mp4", "mov", "m4v", "webm", "avi", "mkv",
        ],
      },
    ],
  });
  if (Array.isArray(picked)) return picked;
  return typeof picked === "string" ? [picked] : [];
}

/** 读当前仓库的身份文件 vault.json */
export const readVaultMeta = () => invoke<VaultMeta>("read_vault_meta");

// ── 窗口 ──
export const openVaultManager = () => invoke<void>("open_vault_manager");
export const closeVaultManager = () => invoke<void>("close_vault_manager");

export const openSettings = () => invoke<void>("open_settings");
export const closeSettings = () => invoke<void>("close_settings");
