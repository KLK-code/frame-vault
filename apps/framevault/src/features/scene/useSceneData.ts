import { useCallback, useEffect, useState } from "react";
import {
  deleteEntry,
  importMedia,
  listEntries,
  listMedia,
  localDay,
  newId,
  pickMediaFiles,
  restoreEntry,
  saveEntry,
  updateEntry,
  type Entry,
  type FolderNode,
  type MediaItem,
} from "../../lib/api";
import { SCENES } from "./registry";

/**
 * 场景的**底层能力**：所有主题共享同一套数据读写，主题只决定"显示哪些、怎么显示"。
 *
 * 为什么要收口：这些事（取记录、取媒体、算出哪些媒体属于本场景、刷新、忙碌与错误状态、
 * 建记录、改文字、追加照片）跟主题的玩法**没有关系**。让每个主题自己抄一遍，
 * 迟早出现"这个主题能改文字、那个主题不能"——那正是能力散落的症状。
 *
 * 主题**看不到**也不能绕过的东西：文件夹归属、id 生成、写入时机、错误处理。
 */
export type SceneData = {
  entries: Entry[];
  /** 只包含本场景记录的媒体（磁盘上是全局扁平的，这里按 entryId 归位） */
  media: MediaItem[];
  /** 正在忙的 key：`"new"` 或某个 entryId；界面用它禁用对应按钮 */
  busy: string | null;
  error: string | null;
  reload: () => Promise<void>;
  mediaOf: (entryId: string) => MediaItem[];
  /** 这条记录按哪天算：它最早一张照片的拍摄时间，没有照片就用记录时间 */
  dateOf: (entry: Entry) => string;
  /** 新建一条记录（可带正文）；失败返回 null 并把错误挂到 error 上 */
  create: (title: string, text?: string) => Promise<Entry | null>;
  /** 编辑一条记录：只改给到的部分，归属与创建时间由 Rust 保证不动 */
  edit: (
    entry: Entry,
    patch: { title?: string; fields?: Record<string, unknown>; note?: string },
  ) => Promise<boolean>;
  /** 只弹选择器，把用户选的文件路径给主题（主题要自己编排时用，比如挑战的一张照片一条记录） */
  pickPhotos: () => Promise<string[]>;
  /** 把**已经选好**的文件导入某条记录（不弹窗） */
  importPhotos: (entryId: string, files: string[]) => Promise<boolean>;
  /** 往**已有**记录追加照片（自己弹选择器；用户取消返回 false） */
  attachPhotos: (entryId: string) => Promise<boolean>;
  /** 新建一条记录并把选中的照片全放进去 */
  createWithPhotos: (title: string, text?: string) => Promise<Entry | null>;
  /** 删除一条记录（写墓碑，不删文件）；`notice` 会变成可撤销的提示 */
  remove: (entry: Entry) => Promise<boolean>;
  /** 撤销刚才那次删除 */
  undo: () => Promise<boolean>;
  /** 一句可撤销的提示（主题用 `SceneNotice` 显示；10 秒后自动消失） */
  notice: string | null;
  dismissNotice: () => void;
  clearError: () => void;
};

export function useSceneData(folder: FolderNode): SceneData {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** 刚被删掉的那条，供撤销用 */
  const [lastDeleted, setLastDeleted] = useState<string | null>(null);

  // 提示自己会消失；消失后就不能撤销了（和大多数应用的"撤销"窗口一致）
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => {
      setNotice(null);
      setLastDeleted(null);
    }, 10_000);
    return () => clearTimeout(timer);
  }, [notice]);

  const reload = useCallback(async () => {
    try {
      const [list, all] = await Promise.all([listEntries(folder.id), listMedia(null)]);
      setEntries(list);
      const mine = new Set(list.map((entry) => entry.id));
      setMedia(all.filter((item) => item.entryId && mine.has(item.entryId)));
      setError(null);
    } catch (err) {
      setError(String(err));
    }
  }, [folder.id]);

  // 换场景就重新拉一次
  useEffect(() => {
    void reload();
  }, [reload]);

  const mediaOf = useCallback(
    (entryId: string) => media.filter((item) => item.entryId === entryId),
    [media],
  );

  const dateOf = useCallback(
    (entry: Entry) => {
      const stamps = mediaOf(entry.id).map((item) => item.takenAt ?? entry.createdAt);
      stamps.push(entry.createdAt);
      return stamps.sort()[0];
    },
    [mediaOf],
  );

  /**
   * 媒体命名模板来自**当前场景的 manifest**（纯数据），由这里取出来传给 Rust ——
   * 第三方场景的模板写在它自己的插件包里，Rust 不该去读插件目录。没声明就走核心默认。
   */
  const nameTemplate = SCENES[folder.effectiveScene]?.manifest.mediaNameTemplate ?? null;

  /** 把一批已经选好的文件导入到某条记录（已经是记录就不再建） */
  const importInto = useCallback(
    async (entryId: string, files: string[]) => {
      for (const file of files) {
        await importMedia(file, entryId, nameTemplate);
      }
    },
    [nameTemplate],
  );

  const create = useCallback(
    async (title: string, note?: string) => {
      setBusy("new");
      try {
        const id = await newId();
        // 正文直接随 save_entry 落进 note.md（记录目录名也用得上 day，一起给）
        const entry = await saveEntry(id, title, {
          folderId: folder.id,
          day: localDay(),
          note,
        });
        await reload();
        return entry;
      } catch (err) {
        setError(String(err));
        return null;
      } finally {
        setBusy(null);
      }
    },
    [folder.id, reload],
  );

  const edit = useCallback(
    async (
      entry: Entry,
      patch: { title?: string; fields?: Record<string, unknown>; note?: string },
    ) => {
      setBusy(entry.id);
      try {
        await updateEntry(entry.id, patch);
        await reload();
        return true;
      } catch (err) {
        setError(String(err));
        return false;
      } finally {
        setBusy(null);
      }
    },
    [reload],
  );

  const importPhotos = useCallback(
    async (entryId: string, files: string[]) => {
      setBusy(entryId);
      try {
        await importInto(entryId, files);
        await reload();
        return true;
      } catch (err) {
        setError(String(err));
        return false;
      } finally {
        setBusy(null);
      }
    },
    [importInto, reload],
  );

  const pickPhotos = useCallback(async () => {
    try {
      return await pickMediaFiles();
    } catch (err) {
      setError(String(err));
      return [];
    }
  }, []);

  const attachPhotos = useCallback(
    async (entryId: string) => {
      const files = await pickPhotos();
      if (files.length === 0) return false;
      return importPhotos(entryId, files);
    },
    [importPhotos, pickPhotos],
  );

  const createWithPhotos = useCallback(
    async (title: string, note?: string) => {
      const files = await pickPhotos();
      if (files.length === 0) return null;

      setBusy("new");
      try {
        const id = await newId();
        const entry = await saveEntry(id, title, {
          folderId: folder.id,
          day: localDay(),
          note,
        });
        await importInto(id, files);
        await reload();
        return entry;
      } catch (err) {
        setError(String(err));
        return null;
      } finally {
        setBusy(null);
      }
    },
    [folder.id, importInto, reload, pickPhotos],
  );

  const remove = useCallback(
    async (entry: Entry) => {
      setBusy(entry.id);
      try {
        await deleteEntry(entry.id);
        setLastDeleted(entry.id);
        setNotice(`已删除「${entry.title || "未命名记录"}」`);
        await reload();
        return true;
      } catch (err) {
        setError(String(err));
        return false;
      } finally {
        setBusy(null);
      }
    },
    [reload],
  );

  const undo = useCallback(async () => {
    if (!lastDeleted) return false;
    try {
      await restoreEntry(lastDeleted);
      setLastDeleted(null);
      setNotice(null);
      await reload();
      return true;
    } catch (err) {
      setError(String(err));
      return false;
    }
  }, [lastDeleted, reload]);

  return {
    entries,
    media,
    busy,
    error,
    reload,
    mediaOf,
    dateOf,
    create,
    edit,
    pickPhotos,
    importPhotos,
    attachPhotos,
    createWithPhotos,
    remove,
    undo,
    notice,
    dismissNotice: () => {
      setNotice(null);
      setLastDeleted(null);
    },
    clearError: () => setError(null),
  };
}
