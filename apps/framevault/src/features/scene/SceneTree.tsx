import { useEffect, useRef, useState } from "react";
import type { FolderNode, SceneInfo } from "../../lib/api";
import type { SceneGroup } from "./useFolders";
import "./SceneTree.css";

type Props = {
  groups: SceneGroup[];
  scenes: SceneInfo[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onCreate: (name: string, scene: string | null) => Promise<boolean>;
  onRename: (id: string, name: string) => Promise<boolean>;
  onDelete: (folder: FolderNode) => Promise<boolean>;
  onTogglePinned: (folder: FolderNode) => Promise<boolean>;
  onBindScene: (id: string, scene: string | null) => Promise<boolean>;
};

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
 * 左侧 = 场景树。
 *
 * 结构是**两级**：第一级是主题（"挑战"/"普通记录"…），第二级是场景。
 * 第一级不是磁盘上的文件夹，纯粹是显示层的归类（见 useFolders.groups）。
 */
export default function SceneTree({
  groups,
  scenes,
  activeId,
  onSelect,
  onCreate,
  onRename,
  onDelete,
  onTogglePinned,
  onBindScene,
}: Props) {
  const [creating, setCreating] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftScene, setDraftScene] = useState<string>("");
  const [editing, setEditing] = useState<{ id: string; mode: "rename" | "scene" } | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const createInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (creating) createInput.current?.focus();
  }, [creating]);

  // 菜单开着时点别处就关掉
  useEffect(() => {
    if (!menuFor) return;
    const close = () => setMenuFor(null);
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [menuFor]);

  function openCreate() {
    setDraftName("");
    setDraftScene("");
    setCreating(true);
  }

  async function submitCreate() {
    const name = draftName.trim();
    if (!name) return;
    const ok = await onCreate(name, draftScene || null);
    if (ok) {
      setCreating(false);
      setDraftName("");
    }
  }

  async function submitRename(folder: FolderNode, name: string) {
    const next = name.trim();
    setEditing(null);
    if (!next || next === folder.name) return;
    await onRename(folder.id, next);
  }

  return (
    <div className="scene-tree">
      <div className="scene-tree__head">
        <span className="scene-tree__title">场景</span>
        <button className="scene-tree__add" title="新建场景" onClick={openCreate}>
          <IconPlus />
        </button>
      </div>

      {creating && (
        <div className="scene-tree__compose">
          <input
            ref={createInput}
            value={draftName}
            placeholder="场景名称，比如「晨跑打卡」"
            onChange={(e) => setDraftName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submitCreate();
              if (e.key === "Escape") setCreating(false);
            }}
          />
          <select
            value={draftScene}
            title="选择主题"
            onChange={(e) => setDraftScene(e.target.value)}
          >
            <option value="">普通记录</option>
            {scenes
              .filter((s) => s.id !== "builtin.plain")
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </select>
          <div className="scene-tree__compose-actions">
            <button className="is-primary" onClick={() => void submitCreate()}>
              创建
            </button>
            <button onClick={() => setCreating(false)}>取消</button>
          </div>
        </div>
      )}

      <div className="scene-tree__scroll">
        {groups.length === 0 && !creating && (
          <p className="scene-tree__empty">
            还没有场景。
            <br />
            点右上角 ＋ 新建一个。
          </p>
        )}

        {groups.map((group) => (
          <section key={group.scene.id} className="scene-group">
            <h3 className="scene-group__title" title={group.scene.description}>
              {group.scene.name}
              <span className="scene-group__count">{group.folders.length}</span>
            </h3>

            {group.folders.map((folder) => {
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
                    <option value="">不绑定 · 普通记录</option>
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
                    title={folder.name}
                  >
                    {folder.pinned && (
                      <span className="scene-row__pin" title="已置顶">
                        <IconBookmark />
                      </span>
                    )}
                    <span className="scene-row__name">{folder.name}</span>
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
                        切换主题…
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
                        删除场景
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </section>
        ))}
      </div>
    </div>
  );
}
