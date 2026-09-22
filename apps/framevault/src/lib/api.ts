import { invoke } from "@tauri-apps/api/core";
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

/** 读当前仓库的身份文件 vault.json */
export const readVaultMeta = () => invoke<VaultMeta>("read_vault_meta");

// ── 窗口 ──
export const openVaultManager = () => invoke<void>("open_vault_manager");
export const closeVaultManager = () => invoke<void>("close_vault_manager");

export const openSettings = () => invoke<void>("open_settings");
export const closeSettings = () => invoke<void>("close_settings");
