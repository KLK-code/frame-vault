import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

export type Entry = {
  schemaVersion: number;
  id: string;
  title: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  /** 属于哪个文件夹（= 哪个场景）；null = 仓库根 */
  folderId: string | null;
  /** 写入时生效的场景 id */
  scene: string | null;
  /** 场景自定义字段的开放区 */
  fields: Record<string, unknown>;
};

export type FolderNode = {
  id: string;
  name: string;
  parentId: string | null;
  order: number;
  pinned: boolean;
  /** 自己绑定的场景；null = 继承 */
  scene: string | null;
  /** 继承解析后真正生效的场景 */
  effectiveScene: string;
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

export const openVaultManager = () => invoke<void>("open_vault_manager");
export const closeVaultManager = () => invoke<void>("close_vault_manager");

export const openSettings = () => invoke<void>("open_settings");
export const closeSettings = () => invoke<void>("close_settings");


// ── 记录 ──
export const saveEntry = (
  id: string,
  title: string,
  createdAt: string,
  folderId: string | null = null,
) => invoke<string>("save_entry", { id, title, createdAt, folderId });

export const loadEntry = (id: string) => invoke<Entry>("load_entry", { id });

/** 列出记录（新的在前）；给了 folderId 就只看那个场景下的 */
export const listEntries = (folderId: string | null = null) =>
  invoke<Entry[]>("list_entries", { folderId });

/** 读当前仓库的身份文件 vault.json */
export const readVaultMeta = () => invoke<VaultMeta>("read_vault_meta");
