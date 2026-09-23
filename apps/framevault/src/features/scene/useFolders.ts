import { useCallback, useEffect, useMemo, useState } from "react";
import {
  bindFolderScene,
  createFolder as createFolderCmd,
  createTopic as createTopicCmd,
  deleteFolder as deleteFolderCmd,
  deleteTopic as deleteTopicCmd,
  listFolderTree,
  listScenes,
  listTopics,
  onVaultChanged,
  reorderFolders,
  renameFolder as renameFolderCmd,
  renameTopic as renameTopicCmd,
  setFolderPinned,
  type FolderNode,
  type SceneInfo,
} from "../../lib/api";

/** 按主题分的一组：`topic` 为 null = 没有主题（直接摆在仓库根下的那些） */
export type TopicGroup = {
  topic: string | null;
  folders: FolderNode[];
};

/** 「文件夹树 + 主题 + 写操作」的完整形状（两套骨架共用的那份数据） */
export type FoldersApi = {
  folders: FolderNode[];
  scenes: SceneInfo[];
  /** 主题清单（只给名字，空主题也在里面） */
  topics: string[];
  /** 按场景（记录方式）分组 —— 导航"按场景"那种排法 */
  groups: SceneGroup[];
  /** 按主题分组 —— 导航"按主题"那种排法（磁盘的样子） */
  topicGroups: TopicGroup[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  create: (name: string, scene: string | null, topic: string | null) => Promise<boolean>;
  createTopic: (name: string) => Promise<boolean>;
  renameTopic: (name: string, newName: string) => Promise<boolean>;
  deleteTopic: (name: string) => Promise<boolean>;
  rename: (id: string, name: string) => Promise<boolean>;
  remove: (id: string) => Promise<boolean>;
  togglePinned: (id: string, pinned: boolean) => Promise<boolean>;
  /** 拖动排序：把**全部文件夹**按新顺序的 id 整表发来（Rust 返回全量直接替换） */
  reorder: (orderedIds: string[]) => Promise<boolean>;
  bindScene: (
    id: string,
    scene: string | null,
    config?: Record<string, unknown>,
  ) => Promise<boolean>;
  clearError: () => void;
};

/** 「当前选中的场景」的形状 */
export type ActiveFolderApi = {
  activeId: string | null;
  setActiveId: (id: string) => void;
  active: FolderNode | null;
};

/**
 * 两套骨架共用的原料 —— **由 `App` 统一提供**（不在这两个骨架组件里各自 useState）。
 *
 * 为什么必须挂在外层：视口跨过断点时 `App` 会换成另一套骨架，
 * 骨架自己的 state 跟着组件一起销毁重建 —— 于是"当前选中的场景"被重置成第一个。
 * 数据与选择是两套骨架**共有**的东西（AGENTS §2），只有编排才归骨架自己。
 */
export type SceneShellProps = {
  tree: FoldersApi;
  selected: ActiveFolderApi;
  /** 当前场景生效的主题信息；null = 还没选中 / 这个主题没装 */
  scene: SceneInfo | null;
};

/**
 * "当前选中的场景"。两套骨架（桌面 / 手机）共用这一份规则：
 * 场景没了或还没选 → 自动落到第一个。
 */
export function useActiveFolder(folders: FolderNode[]): ActiveFolderApi {
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    if (folders.length === 0) {
      if (activeId !== null) setActiveId(null);
      return;
    }
    if (!folders.some((folder) => folder.id === activeId)) {
      setActiveId(folders[0].id);
    }
  }, [folders, activeId]);

  return {
    activeId,
    setActiveId,
    active: folders.find((folder) => folder.id === activeId) ?? null,
  };
}

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
export function useFolders(): FoldersApi {
  const [folders, setFolders] = useState<FolderNode[]>([]);
  const [scenes, setScenes] = useState<SceneInfo[]>([]);
  const [topics, setTopics] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [tree, sceneList, topicList] = await Promise.all([
        listFolderTree(),
        listScenes(),
        listTopics(),
      ]);
      setFolders(tree);
      setScenes(sceneList);
      setTopics(topicList);
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
    (name: string, scene: string | null, topic: string | null) =>
      apply(() => createFolderCmd(name, scene, topic)),
    [apply],
  );

  // 主题没有元数据，"改"只改目录名 —— 但那样会让里面的文件夹换主题，
  // 所以这三个动作做完都要**连文件夹树一起重取**（apply 只换了 folders，topics 要另取）
  const applyTopics = useCallback(
    async (run: () => Promise<string[]>) => {
      try {
        setTopics(await run());
        setFolders(await listFolderTree());
        setError(null);
        return true;
      } catch (err) {
        setError(String(err));
        return false;
      }
    },
    [],
  );

  const createTopic = useCallback((name: string) => applyTopics(() => createTopicCmd(name)), [
    applyTopics,
  ]);
  const renameTopic = useCallback(
    (name: string, newName: string) => applyTopics(() => renameTopicCmd(name, newName)),
    [applyTopics],
  );
  const deleteTopic = useCallback((name: string) => applyTopics(() => deleteTopicCmd(name)), [
    applyTopics,
  ]);

  const rename = useCallback(
    (id: string, name: string) => apply(() => renameFolderCmd(id, name)),
    [apply],
  );

  const remove = useCallback((id: string) => apply(() => deleteFolderCmd(id)), [apply]);

  const togglePinned = useCallback(
    (id: string, pinned: boolean) => apply(() => setFolderPinned(id, pinned)),
    [apply],
  );

  const reorder = useCallback(
    (orderedIds: string[]) => apply(() => reorderFolders(orderedIds)),
    [apply],
  );

  const bindScene = useCallback(
    (id: string, scene: string | null, config?: Record<string, unknown>) =>
      apply(() => bindFolderScene(id, scene, config)),
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

  /**
   * 分组之二：**按主题**（= 磁盘的样子）。
   * 主题按后端的目录顺序排，空主题也占一格；"没有主题"那一组永远排在最后。
   */
  const topicGroups = useMemo<TopicGroup[]>(() => {
    const byTopic = new Map<string | null, FolderNode[]>();
    for (const folder of folders) {
      const list = byTopic.get(folder.topic) ?? [];
      list.push(folder);
      byTopic.set(folder.topic, list);
    }

    const out: TopicGroup[] = topics.map((topic) => ({
      topic,
      folders: byTopic.get(topic) ?? [],
    }));
    // 认不出的目录名（理论上不该有）与"没有主题"，一起放最后
    const loose = [...byTopic.keys()].filter((key) => key !== null && !topics.includes(key));
    for (const key of [...loose, null]) {
      const list = byTopic.get(key);
      if (list) out.push({ topic: key, folders: list });
    }

    return out;
  }, [folders, topics]);

  return {
    folders,
    scenes,
    topics,
    groups,
    topicGroups,
    loading,
    error,
    reload,
    create,
    createTopic,
    renameTopic,
    deleteTopic,
    rename,
    remove,
    togglePinned,
    reorder,
    bindScene,
    /** 供 UI 显示错误后清掉 */
    clearError: () => setError(null),
  };
}
