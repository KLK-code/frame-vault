import { useCallback, useEffect, useMemo, useState } from "react";
import {
  bindFolderScene,
  createFolder as createFolderCmd,
  deleteFolder as deleteFolderCmd,
  listFolderTree,
  listScenes,
  onVaultChanged,
  renameFolder as renameFolderCmd,
  setFolderPinned,
  type FolderNode,
  type SceneInfo,
} from "../../lib/api";

/** 一个"主题分组"：同一种属性的场景聚在一起，方便查找 */
export type SceneGroup = {
  scene: SceneInfo;
  folders: FolderNode[];
};

/**
 * 场景数据 + 归类。
 *
 * 数据事实：仓库里所有场景是**平铺**的（Rust 只管排序），
 * 归属关系只存在于展示层——这里按 `effectiveScene`（生效主题）把它们分组。
 * 想换归类方式，只需要改 `groups` 这一段，磁盘上的数据一动不动。
 */
export function useFolders() {
  const [folders, setFolders] = useState<FolderNode[]>([]);
  const [scenes, setScenes] = useState<SceneInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [tree, sceneList] = await Promise.all([listFolderTree(), listScenes()]);
      setFolders(tree);
      setScenes(sceneList);
      setError(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  // 首次加载 + 仓库切换（Rust 广播 vault://changed）
  useEffect(() => {
    void reload();
    return onVaultChanged(() => {
      void reload();
    });
  }, [reload]);

  /** 写操作统一走这里：Rust 回来的就是排好序的新列表，直接替换，不做乐观更新 */
  const apply = useCallback(async (run: () => Promise<FolderNode[]>) => {
    try {
      setFolders(await run());
      setError(null);
      return true;
    } catch (err) {
      setError(String(err));
      return false;
    }
  }, []);

  const create = useCallback(
    (name: string, scene: string | null) => apply(() => createFolderCmd(name, scene)),
    [apply],
  );

  const rename = useCallback(
    (id: string, name: string) => apply(() => renameFolderCmd(id, name)),
    [apply],
  );

  const remove = useCallback((id: string) => apply(() => deleteFolderCmd(id)), [apply]);

  const togglePinned = useCallback(
    (id: string, pinned: boolean) => apply(() => setFolderPinned(id, pinned)),
    [apply],
  );

  const bindScene = useCallback(
    (id: string, scene: string | null) => apply(() => bindFolderScene(id, scene)),
    [apply],
  );

  /**
   * 分组：按 `effectiveScene` 聚拢。
   * 组的先后顺序 = 组内第一个场景在整体排序里的位置，
   * 所以用户把某组里的场景置顶/排前，整组也会跟着浮上来。
   */
  const groups = useMemo<SceneGroup[]>(() => {
    const known = new Map(scenes.map((s) => [s.id, s]));
    const seen = new Map<string, SceneGroup>();
    const out: SceneGroup[] = [];

    for (const folder of folders) {
      const id = folder.effectiveScene;
      let group = seen.get(id);
      if (!group) {
        // 主题没装（比如第三方主题被卸载）也要显示出来，不能凭空吞掉用户的场景
        const scene =
          known.get(id) ??
          ({
            id,
            name: `未知主题（${id}）`,
            description: "这个主题当前没有安装，场景内容仍会以普通记录显示",
            builtin: false,
          } satisfies SceneInfo);
        group = { scene, folders: [] };
        seen.set(id, group);
        out.push(group);
      }
      group.folders.push(folder);
    }
    return out;
  }, [folders, scenes]);

  return {
    folders,
    scenes,
    groups,
    loading,
    error,
    reload,
    create,
    rename,
    remove,
    togglePinned,
    bindScene,
    /** 供 UI 显示错误后清掉 */
    clearError: () => setError(null),
  };
}
