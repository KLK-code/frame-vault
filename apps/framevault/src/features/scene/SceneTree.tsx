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
  /** 拖动排序：把全部文件夹按新顺序的 id 整表发来（Rust 返回全量） */
  onReorder: (orderedIds: string[]) => Promise<boolean>;
  onBindScene: (id: string, scene: string | null) => Promise<boolean>;
  onCreateTopic: (name: string) => Promise<boolean>;
  onRenameTopic: (topic: string, newName: string) => Promise<boolean>;
  onDeleteTopic: (topic: string) => Promise<boolean>;
  /**
   * 收起侧栏。只有桌面骨架会给（手机端的场景列表是整屏弹层，收起没意义）——
   * 没给就不显示这个按钮。
   */
  onToggleCollapsed?: () => void;
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

const GROUPINGS: { id: Grouping; label: string; hint: string }[] = [
  { id: "topic", label: "按主题", hint: "文件夹在磁盘上放哪儿，就这么显示" },
  { id: "scene", label: "按场景", hint: "同一种记录方式聚在一起，跨主题" },
  { id: "flat", label: "平铺", hint: "不分组，一行一个" },
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

/** 收起侧栏：一个方框 + 左竖线 + 向左的箭头 */
function IconCollapse() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <rect x="1" y="1.8" width="10" height="8.4" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.1" />
      <path d="M4.4 1.8v8.4" stroke="currentColor" strokeWidth="1.1" />
      <path d="M6.6 4.6 5.2 6l1.4 1.4" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
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
  onReorder,
  onBindScene,
  onCreateTopic,
  onRenameTopic,
  onDeleteTopic,
  onToggleCollapsed,
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
  const [groupMenu, setGroupMenu] = useState(false);
  /** 拖动排序：正在拖的文件夹 id + 悬停落点（落在目标行的上半 / 下半） */
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropHint, setDropHint] = useState<{ id: string; before: boolean } | null>(null);
  const groupBox = useRef<HTMLDivElement>(null);
  const createInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (creating) createInput.current?.focus();
  }, [creating]);

  useEffect(() => {
    localStorage.setItem(GROUPING_KEY, grouping);
  }, [grouping]);

  // 点菜单外面 / 按 Esc 就关掉（跟底部的仓库切换器同一套手感）
  useEffect(() => {
    if (!groupMenu) return;
    function onDown(e: MouseEvent) {
      if (groupBox.current && !groupBox.current.contains(e.target as Node)) setGroupMenu(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setGroupMenu(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [groupMenu]);

  const current = GROUPINGS.find((item) => item.id === grouping) ?? GROUPINGS[0];

  /** 平铺：所有文件夹按后端给的顺序（置顶 → order → 名称） */
  const flat = useMemo(
    () => groups.flatMap((group) => group.folders),
    [groups],
  );

  /** 当前分组方式下的全部显示顺序（拖动排序提交的就是这份的 id） */
  function displayIds(): string[] {
    if (grouping === "flat") return flat.map((folder) => folder.id);
    if (grouping === "scene") return groups.flatMap((group) => group.folders.map((f) => f.id));
    return topicGroups.flatMap((group) => group.folders.map((f) => f.id));
  }

  /** 分组归属键：拖动只允许发生在同一组内（跨组 = 换主题/搬目录，是另一件事） */
  function groupKeyOf(folder: FolderNode): string {
    if (grouping === "scene") return folder.effectiveScene;
    if (grouping === "flat") return "__flat__";
    return folder.topic ?? "__none__";
  }

  /** 落手：把拖着的行从显示顺序里拔出来，插到目标行前面/后面，整表提交 */
  async function commitReorder(targetId: string, before: boolean) {
    if (!dragging || dragging === targetId) return;
    const order = displayIds();
    const from = order.indexOf(dragging);
    const to = order.indexOf(targetId);
    if (from < 0 || to < 0) return;
    order.splice(from, 1);
    order.splice(order.indexOf(targetId) + (before ? 0 : 1), 0, dragging);
    await onReorder(order);
  }

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

  /** 一行文件夹 —— 三种分组方式共用同一份渲染；`groupKey` 用来限制拖动只发生在同组内 */
  function renderFolder(folder: FolderNode, groupKey: string) {
    const isActive = folder.id === activeId;
    const isEditing = editing?.id === folder.id;
    const isDropTarget = dropHint?.id === folder.id && dragging !== folder.id;

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
      <div
        key={folder.id}
        className={[
          "scene-row-wrap",
          dragging === folder.id ? "is-dragging" : "",
          isDropTarget ? (dropHint!.before ? "is-drop-before" : "is-drop-after") : "",
        ]
          .filter(Boolean)
          .join(" ")}
        draggable={!isEditing}
        onDragStart={(e) => {
          setDragging(folder.id);
          setDropHint(null);
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", folder.id);
        }}
        onDragEnd={() => {
          setDragging(null);
          setDropHint(null);
        }}
        onDragOver={(e) => {
          if (!dragging || dragging === folder.id) return;
          const draggedFolder = folders.find((f) => f.id === dragging);
          if (!draggedFolder || groupKeyOf(draggedFolder) !== groupKey) return;
          e.preventDefault();
          const rect = e.currentTarget.getBoundingClientRect();
          const before = e.clientY < rect.top + rect.height / 2;
          setDropHint((prev) =>
            prev?.id === folder.id && prev.before === before ? prev : { id: folder.id, before },
          );
        }}
        onDrop={(e) => {
          e.preventDefault();
          if (dragging && isDropTarget) void commitReorder(folder.id, dropHint!.before);
          setDragging(null);
          setDropHint(null);
        }}
      >
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

  /** 一组（标题 + 里面的文件夹）；`topic` 有值时标题带主题的 ⋯ 菜单；`groupKey` 传给行做拖动分组 */
  function renderGroup(key: string, title: string, subtitle: string | undefined, list: FolderNode[], topic?: string | null, groupKey?: string) {
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

        {list.map((folder) => renderFolder(folder, groupKey ?? key))}
      </section>
    );
  }

  return (
    <div className="scene-tree">
      <div className="scene-tree__head">
        {/* 「文件夹 · 按主题 ▾」——一个按钮搞定"这是什么 / 怎么分组"，
            点开才看到三种分组方式（跟底部的仓库切换器同一套按钮手感） */}
        <div className="scene-tree__group" ref={groupBox}>
          <button
            className="scene-tree__group-btn"
            title={`分组方式：${current.label}（${current.hint}）`}
            aria-haspopup="menu"
            aria-expanded={groupMenu}
            onClick={() => setGroupMenu((v) => !v)}
          >
            <span className="scene-tree__group-name">文件夹 · {current.label}</span>
            <span className="scene-tree__group-caret">▾</span>
          </button>

          {groupMenu && (
            <div className="scene-tree__group-menu" role="menu">
              {GROUPINGS.map((item) => (
                <button
                  key={item.id}
                  role="menuitemradio"
                  aria-checked={grouping === item.id}
                  className={grouping === item.id ? "is-active" : ""}
                  onClick={() => {
                    setGrouping(item.id);
                    setGroupMenu(false);
                  }}
                >
                  <span className="scene-tree__group-item">
                    {item.label}
                    {grouping === item.id && <span className="scene-tree__group-check">✓</span>}
                  </span>
                  <span className="scene-tree__group-hint">{item.hint}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <button className="scene-tree__add" title="新建文件夹" onClick={openCreate}>
          <IconPlus />
        </button>
        {/* 收起按钮刻意不带 aria-expanded：它不是"展开/收起一个菜单"，按下去就是换骨架；
            而 WebView2 会把 aria-expanded 映射成 ExpandCollapse，自动化点它反而不触发 onClick */}
        {onToggleCollapsed && (
          <button
            className="scene-tree__add"
            title="收起侧栏"
            aria-label="收起侧栏"
            onClick={onToggleCollapsed}
          >
            <IconCollapse />
          </button>
        )}
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
              group.topic ?? "__none__",
            ),
          )}

        {grouping === "scene" &&
          groups.map((group) =>
            renderGroup(group.scene.id, group.scene.name, group.scene.description, group.folders, undefined, group.scene.id),
          )}

        {grouping === "flat" && flat.length > 0 && (
          <section className="scene-group">{flat.map((folder) => renderFolder(folder, "__flat__"))}</section>
        )}
      </div>
    </div>
  );
}
