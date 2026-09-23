import { useEffect, useMemo, useRef, useState } from "react";
import type { FolderNode, SceneInfo } from "../../lib/api";
import type { SceneGroup, TopicGroup } from "./useFolders";
import { sceneOf } from "./registry";
import SceneIcon from "./SceneIcon";
import "./SceneTree.css";

type Props = {
  /** 全部文件夹（平铺那种排法要用） */
  folders: FolderNode[];
  /** 按场景（记录方式）分组 */
  groups: SceneGroup[];
  /** 按主题分组（磁盘的样子） */
  topicGroups: TopicGroup[];
  /** 主题清单（含空主题） */
  topics: string[];
  scenes: SceneInfo[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onCreate: (name: string, scene: string | null, topic: string | null) => Promise<boolean>;
  onRename: (id: string, name: string) => Promise<boolean>;
  onDelete: (folder: FolderNode) => Promise<boolean>;
  onTogglePinned: (folder: FolderNode) => Promise<boolean>;
  onBindScene: (id: string, scene: string | null) => Promise<boolean>;
  onCreateTopic: (name: string) => Promise<boolean>;
  onRenameTopic: (topic: string, newName: string) => Promise<boolean>;
  onDeleteTopic: (topic: string) => Promise<boolean>;
};

/** 导航怎么分组 —— 纯 UI 的事，不影响磁盘上东西怎么放（AGENTS：分组是展示层的事） */
type Grouping = "topic" | "scene" | "flat";

const GROUPING_KEY = "fv.sceneGrouping";
/** 上次把新文件夹建在哪儿（主题名，空串 = 根下/没有主题） */
const LAST_TOPIC_KEY = "fv.lastTopic";

function readGrouping(): Grouping {
  const saved = localStorage.getItem(GROUPING_KEY);
  return saved === "scene" || saved === "flat" ? saved : "topic";
}

/** 创建时选"新建主题…"用的哨兵值（主题名不可能是它，带个箭头） */
const NEW_TOPIC = "__new__";

const GROUPINGS: { id: Grouping; label: string; title: string }[] = [
  { id: "topic", label: "主题", title: "按主题分组（文件夹在磁盘上放哪儿，就这么显示）" },
  { id: "scene", label: "场景", title: "按场景分组：把同一种记录方式的文件夹聚在一起，跨主题" },
  { id: "flat", label: "平铺", title: "不分组的平铺列表" },
];

function IconBookmark() {
  return (
    <svg width="11" height="11" viewBox="0 0 10 10" aria-hidden="true">
      <path
        d="M3 1.3h4v7.4L5 6.9 3 8.7z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconPlus() {
  return (
    <svg width="12" height="12" viewBox="0 0 10 10" aria-hidden="true">
      <path d="M5 1.2v7.6M1.2 5h7.6" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

/**
 * 左侧 = 文件夹树。
 *
 * **三种分组方式**（纯展示层，随时切、记在 localStorage 里）：
 * - **按主题**（默认）= 磁盘的样子：主题是外层目录，文件夹住在它下面；
 * - **按场景**：把同一种记录方式（随心记 / 认真写作 / 拍照打卡）的文件夹聚在一起，跨主题；
 * - **平铺**：一行一个，不分组。
 *
 * 主题是**用户自己的分组**，App 不给它任何功能含义 —— 叫"科研"或叫"打卡"都行。
 * 它在磁盘上就是一层目录（没有元数据），所以这里只有建 / 改名 / 删三个动作。
 */
export default function SceneTree({
  folders,
  groups,
  topicGroups,
  topics,
  scenes,
  activeId,
  onSelect,
  onCreate,
  onRename,
  onDelete,
  onTogglePinned,
  onBindScene,
  onCreateTopic,
  onRenameTopic,
  onDeleteTopic,
}: Props) {
  const [creating, setCreating] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftScene, setDraftScene] = useState<string>("");
  const [draftTopic, setDraftTopic] = useState<string>(() => localStorage.getItem(LAST_TOPIC_KEY) ?? "");
  const [newTopic, setNewTopic] = useState("");
  const [editing, setEditing] = useState<{ id: string; mode: "rename" | "scene" } | null>(null);
  const [editingTopic, setEditingTopic] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [topicMenu, setTopicMenu] = useState<string | null>(null);
  const [grouping, setGrouping] = useState<Grouping>(readGrouping);
  const createInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (creating) createInput.current?.focus();
  }, [creating]);

  useEffect(() => {
    localStorage.setItem(GROUPING_KEY, grouping);
  }, [grouping]);

  /** 平铺：所有文件夹按后端给的顺序（置顶 → order → 名称） */
  const flat = useMemo(
    () => groups.flatMap((group) => group.folders),
    [groups],
  );

  // 菜单开着时点别处就关掉
  useEffect(() => {
    if (!menuFor && !topicMenu) return;
    const close = () => {
      setMenuFor(null);
      setTopicMenu(null);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [menuFor, topicMenu]);

  function openCreate() {
    setDraftName("");
    setDraftScene("");
    setNewTopic("");
    // 记住上次放哪儿：平时不打断，落点没了才需要重选
    setDraftTopic(localStorage.getItem(LAST_TOPIC_KEY) ?? "");
    setCreating(true);
  }

  async function submitCreate() {
    const name = draftName.trim();
    if (!name) return;

    let topic = draftTopic === NEW_TOPIC ? newTopic.trim() : draftTopic;
    if (draftTopic === NEW_TOPIC) {
      if (!topic) return;
      if (!(await onCreateTopic(topic))) return; // 主题建不成就别建文件夹了
    }

    const ok = await onCreate(name, draftScene || null, topic || null);
    if (ok) {
      localStorage.setItem(LAST_TOPIC_KEY, topic);
      setCreating(false);
      setDraftName("");
    }
  }

  async function submitTopicRename(topic: string, name: string) {
    const next = name.trim();
    setEditingTopic(null);
    if (!next || next === topic) return;
    await onRenameTopic(topic, next);
  }

  async function submitRename(folder: FolderNode, name: string) {
    const next = name.trim();
    setEditing(null);
    if (!next || next === folder.name) return;
    await onRename(folder.id, next);
  }

  /** 一行文件夹 —— 三种分组方式共用同一份渲染 */
  function renderFolder(folder: FolderNode) {
    const isActive = folder.id === activeId;
    const isEditing = editing?.id === folder.id;

    if (isEditing && editing.mode === "rename") {
      return (
        <input
          key={folder.id}
          className="scene-row__input"
          defaultValue={folder.name}
          autoFocus
          onBlur={(e) => void submitRename(folder, e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submitRename(folder, e.currentTarget.value);
            if (e.key === "Escape") setEditing(null);
          }}
        />
      );
    }

    if (isEditing && editing.mode === "scene") {
      return (
        <select
          key={folder.id}
          className="scene-row__input"
          defaultValue={folder.scene ?? ""}
          autoFocus
          onChange={(e) => {
            setEditing(null);
            void onBindScene(folder.id, e.target.value || null);
          }}
          onBlur={() => setEditing(null)}
        >
          <option value="">不绑定 · 随心记</option>
          {scenes.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      );
    }

    return (
      <div key={folder.id} className="scene-row-wrap">
        <button
          className={`scene-row${isActive ? " is-active" : ""}`}
          onClick={() => onSelect(folder.id)}
          onDoubleClick={() => setEditing({ id: folder.id, mode: "rename" })}
          title={folder.topic ? `${folder.topic} / ${folder.name}` : folder.name}
          aria-current={isActive ? "page" : undefined}
        >
          <SceneIcon name={sceneOf(folder.effectiveScene)?.manifest.presentation?.icon} size={18} />
          {folder.pinned && (
            <span className="scene-row__pin" title="已置顶">
              <IconBookmark />
            </span>
          )}
          <span className="scene-row__name">{folder.name}</span>
          {grouping === "flat" && folder.topic && (
            <span className="scene-row__tag">{folder.topic}</span>
          )}
        </button>
        <button
          className="scene-row__more"
          title="更多操作"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => setMenuFor(menuFor === folder.id ? null : folder.id)}
        >
          ⋯
        </button>

        {menuFor === folder.id && (
          <div className="scene-menu" onPointerDown={(e) => e.stopPropagation()}>
            <button
              onClick={() => {
                setMenuFor(null);
                setEditing({ id: folder.id, mode: "rename" });
              }}
            >
              重命名
            </button>
            <button
              onClick={() => {
                setMenuFor(null);
                setEditing({ id: folder.id, mode: "scene" });
              }}
            >
              切换场景（怎么记）…
            </button>
            <button
              onClick={() => {
                setMenuFor(null);
                void onTogglePinned(folder);
              }}
            >
              {folder.pinned ? "取消置顶" : "置顶"}
            </button>
            <button
              className="is-danger"
              onClick={() => {
                setMenuFor(null);
                void onDelete(folder);
              }}
            >
              删除文件夹
            </button>
          </div>
        )}
      </div>
    );
  }

  /** 一组（标题 + 里面的文件夹）；`topic` 有值时标题带主题的 ⋯ 菜单 */
  function renderGroup(key: string, title: string, subtitle: string | undefined, list: FolderNode[], topic?: string | null) {
    return (
      <section key={key} className="scene-group">
        <h3 className="scene-group__title" title={subtitle}>
          {title}
          <span className="scene-group__count">{list.length}</span>
          {topic != null && (
            <button
              className="scene-group__more"
              title="主题操作"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => setTopicMenu(topicMenu === topic ? null : topic)}
            >
              ⋯
            </button>
          )}
        </h3>

        {topic != null && topicMenu === topic && (
          <div className="scene-menu" onPointerDown={(e) => e.stopPropagation()}>
            <button
              onClick={() => {
                setTopicMenu(null);
                setEditingTopic(topic);
              }}
            >
              重命名主题
            </button>
            <button
              className="is-danger"
              onClick={() => {
                setTopicMenu(null);
                void onDeleteTopic(topic);
              }}
            >
              删除主题
            </button>
          </div>
        )}

        {topic != null && editingTopic === topic && (
          <input
            className="scene-row__input"
            defaultValue={topic}
            autoFocus
            onBlur={(e) => void submitTopicRename(topic, e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submitTopicRename(topic, e.currentTarget.value);
              if (e.key === "Escape") setEditingTopic(null);
            }}
          />
        )}

        {list.map(renderFolder)}
      </section>
    );
  }

  return (
    <div className="scene-tree">
      <div className="scene-tree__head">
        <span className="scene-tree__title">文件夹</span>
        <div className="scene-tree__modes" role="group" aria-label="分组方式">
          {GROUPINGS.map((item) => (
            <button
              key={item.id}
              className={grouping === item.id ? "is-active" : ""}
              title={item.title}
              aria-pressed={grouping === item.id}
              onClick={() => setGrouping(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <button className="scene-tree__add" title="新建文件夹" onClick={openCreate}>
          <IconPlus />
        </button>
      </div>

      {creating && (
        <div className="scene-tree__compose">
          <input
            ref={createInput}
            value={draftName}
            placeholder="文件夹名称，比如「晨跑打卡」"
            onChange={(e) => setDraftName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submitCreate();
              if (e.key === "Escape") setCreating(false);
            }}
          />
          <select
            value={draftScene}
            title="场景（这条内容怎么记）"
            onChange={(e) => setDraftScene(e.target.value)}
          >
            <option value="">随心记</option>
            {scenes
              .filter((s) => s.id !== "builtin.plain")
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </select>
          <select
            value={draftTopic}
            title="主题（放在哪一类里）"
            onChange={(e) => setDraftTopic(e.target.value)}
          >
            <option value="">不放主题（直接放仓库根下）</option>
            {topics.map((topic) => (
              <option key={topic} value={topic}>
                {topic}
              </option>
            ))}
            <option value={NEW_TOPIC}>＋ 新建主题…</option>
          </select>
          {draftTopic === NEW_TOPIC && (
            <input
              value={newTopic}
              placeholder="新主题名，比如「科研」"
              onChange={(e) => setNewTopic(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submitCreate();
                if (e.key === "Escape") setCreating(false);
              }}
            />
          )}
          <div className="scene-tree__compose-actions">
            <button className="is-primary" onClick={() => void submitCreate()}>
              创建
            </button>
            <button onClick={() => setCreating(false)}>取消</button>
          </div>
        </div>
      )}

      <div className="scene-tree__scroll">
        {folders.length === 0 && topics.length === 0 && !creating && (
          <p className="scene-tree__empty">
            还没有文件夹。
            <br />
            点右上角 ＋ 新建一个。
          </p>
        )}

        {grouping === "topic" &&
          topicGroups.map((group) =>
            renderGroup(
              group.topic ?? "__none__",
              group.topic ?? "没有主题",
              group.topic ? `${group.topic}（磁盘上的一层目录）` : "直接摆在仓库根下的文件夹",
              group.folders,
              group.topic,
            ),
          )}

        {grouping === "scene" &&
          groups.map((group) =>
            renderGroup(group.scene.id, group.scene.name, group.scene.description, group.folders),
          )}

        {grouping === "flat" && flat.length > 0 && (
          <section className="scene-group">{flat.map(renderFolder)}</section>
        )}
      </div>
    </div>
  );
}
