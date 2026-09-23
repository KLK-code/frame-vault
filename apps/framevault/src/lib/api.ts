import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ask, open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";

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
  /** 记录名。**净化后的名字就是名字本身**：它等于磁盘上的目录名（去掉日期前缀） */
  title: string;
  /** 创建日的本地日期（YYYY-MM-DD）。磁盘上的记录目录名由它 + 标题组成 */
  day: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  /** 属于哪个场景（文件夹）；null = 未归类（住在根下的「未归类」容器里） */
  folderId: string | null;
  /** 写入时生效的主题 id（快照） */
  scene: string | null;
  /** 主题自定义字段的开放区。**正文不在这里** —— 正文是 `note` */
  fields: Record<string, unknown>;
  /** 这条记录的媒体（磁盘事实）。界面用的形状是 `MediaItem`（多了绝对路径） */
  media: MediaMeta[];
  /** 写这条记录时生效的场景版本。现在恒为 0：给"场景版本管理"占位 */
  sceneVersion: number;
  /**
   * 正文。磁盘上它是记录目录里的 **`note.md`**（唯一真相），不在 `entry.json` 里。
   * 传 `note` 进 `saveEntry` / `updateEntry` 就会写进那个文件。
   */
  note: string;
  /** 墓碑：删除时间。有值 = 已删除（整个记录目录挪进了回收站，能恢复） */
  deletedAt: string | null;
};

/**
 * 一个**文件夹** = 一堆记录 + 绑定的**场景**（记录方式）。
 *
 * 它住在**主题**目录下（`topic`），或者直接摆在仓库根下（`topic: null`）。
 * 主题**不存字段**：`topic` 是 Rust 从目录位置算出来的（磁盘为准），
 * 所以"在资源管理器里把它拖到别的主题下"就是换主题。
 */
export type FolderNode = {
  id: string;
  name: string;
  order: number;
  pinned: boolean;
  /** 用户自己绑的场景（记录方式）；null = 没绑，用内置「随心记」 */
  scene: string | null;
  /** 实际生效的场景 id（Rust 已经算好，前端不重复推导） */
  effectiveScene: string;
  sceneConfig: Record<string, unknown>;
  /** 所属**主题**（外层目录名）；null = 没有主题（直接摆在仓库根下） */
  topic: string | null;
};

export type SceneInfo = {
  id: string;
  name: string;
  description: string;
  builtin: boolean;
};

/**
 * 一个媒体的**磁盘事实**。它住在所属记录的 `entry.json` 里（`Entry.media`），
 * 本体文件就在那条记录的目录里。
 */
export type MediaMeta = {
  schemaVersion: number;
  id: string;
  /**
   * **它叫什么**：磁盘上的实际文件名（导入时按模板生成，之后跟着改名走）。
   * 界面显示、排序、路径拼接全用它 —— **媒体只有这一个名字**（导入前的原名不留）。
   */
  file: string;
  ext: string;
  mime: string;
  bytes: number;
  width: number | null;
  height: number | null;
  /**
   * EXIF 拍摄时间（"YYYY-MM-DDTHH:MM:SS"，本地时间、无时区）；
   * 读不到就是 null —— 卡片日期、打卡日都要退回 addedAt，不能瞎猜。
   */
  takenAt: string | null;
  /** sha256，将来去重与同步校验用；用户直接拷进来的文件是空串 */
  hash: string;
  addedAt: string;
};

/**
 * 交给界面的媒体：磁盘事实 + 命令层算好的两个绝对路径。
 * 前端不拼路径，改布局时只改 Rust。
 */
export type MediaItem = MediaMeta & {
  /** 属于哪条记录。媒体住在记录里，所以一定有值 */
  entryId: string;
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
/** 在系统浏览器里打开外部链接：Markdown 正文里的链接走这里，不让 WebView 自己跳走 */
export async function openExternal(url: string): Promise<void> {
  await openUrl(url);
}

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

/**
 * 新建文件夹：`topic` 给主题名 = 建在那个主题目录里，给 null = 直接建在仓库根下（没有主题）。
 * 主题不存在会报错（前端应当先 `createTopic`）—— 不会悄悄替用户建目录。
 */
export const createFolder = (
  name: string,
  scene: string | null = null,
  topic: string | null = null,
) => invoke<FolderNode[]>("create_folder", { name, scene, topic });

/**
 * **主题**：根下不带 `folder.json` 的一级目录（用户自己分的组）。
 * 它没有任何元数据 —— 位置就是它自己，所以只有"建 / 改名 / 删"三个动作。
 * 空主题（里面还没放文件夹）也会列出来，否则用户建完看不见它。
 */
export const listTopics = () => invoke<string[]>("list_topics");
export const createTopic = (name: string) => invoke<string[]>("create_topic", { name });
export const renameTopic = (name: string, newName: string) =>
  invoke<string[]>("rename_topic", { name, newName });
export const deleteTopic = (name: string) => invoke<string[]>("delete_topic", { name });

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

/**
 * 本地日期（`YYYY-MM-DD`）。
 *
 * 记录的目录名要用"创建日"，而"今天"是用户本地时区的今天 —— 这个判断只有前端做得对，
 * 所以 `day` 由前端算好传给 Rust（Rust 层不引时钟依赖，也不做时区换算）。
 */
export function localDay(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export const saveEntry = (
  id: string,
  title: string,
  options: {
    folderId?: string | null;
    createdAt?: string;
    updatedAt?: string;
    /** 创建日（YYYY-MM-DD）。不给就用今天 —— 磁盘上的目录名靠它 */
    day?: string;
    /** 正文：写进记录目录里的 `note.md` */
    note?: string;
  } = {},
) => {
  const now = new Date().toISOString();
  return invoke<Entry>("save_entry", {
    id,
    title,
    createdAt: options.createdAt ?? now,
    updatedAt: options.updatedAt ?? now,
    folderId: options.folderId ?? null,
    day: options.day ?? localDay(),
    note: options.note ?? null,
  });
};

/**
 * 编辑一条已有记录：只给到的部分会被改，**归属与创建时间不会动**。
 * `fields` 是整体替换（不是深合并），所以要改主题自留字段时得把旧值一起传上来。
 */
export const updateEntry = (
  id: string,
  patch: { title?: string; fields?: Record<string, unknown>; note?: string },
  updatedAt = new Date().toISOString(),
) =>
  invoke<Entry>("update_entry", {
    id,
    title: patch.title ?? null,
    fields: patch.fields ?? null,
    note: patch.note ?? null,
    updatedAt,
  });

export const loadEntry = (id: string) => invoke<Entry>("load_entry", { id });

/**
 * 列出记录（新的在前）；给了 folderId 就只看那个场景里的。
 * **墓碑默认不出现**，要回收站那种视图才传 includeDeleted。
 */
export const listEntries = (folderId: string | null = null, includeDeleted = false) =>
  invoke<Entry[]>("list_entries", { folderId, includeDeleted });

/** 逻辑删除：写墓碑。文件、媒体、字段都留着，随时能恢复 */
export const deleteEntry = (id: string, deletedAt = new Date().toISOString()) =>
  invoke<Entry>("delete_entry", { id, deletedAt });

/** 撤销删除：把墓碑清掉 */
export const restoreEntry = (id: string, now = new Date().toISOString()) =>
  invoke<Entry>("restore_entry", { id, now });

// ── 媒体 ──
/**
 * 导入一个文件（复制进**这条记录的目录**，原文件不动）。
 *
 * `nameTemplate` 是场景在 manifest 里声明的命名模板（纯数据），由前端解析后传进来 ——
 * 第三方场景的模板在它自己的插件包里，Rust 不该去读插件目录。不给就走核心默认模板。
 * 长任务：Rust 侧是 `#[tauri::command(async)]`，不会占住主线程。
 */
export const importMedia = (
  sourcePath: string,
  entryId: string,
  nameTemplate: string | null = null,
  addedAt = new Date().toISOString(),
) => invoke<MediaItem>("import_media", { sourcePath, entryId, nameTemplate, addedAt });

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
