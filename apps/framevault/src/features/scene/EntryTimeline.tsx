import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { assetUrl, type Entry, type MediaItem } from "../../lib/api";
import MediaLightbox from "./MediaLightbox";
import SceneFields from "./SceneFields";
import { fieldText, fieldValue, writeValues } from "./manifest";
import { displayableSrc, formatBytes, formatTime, formatDay } from "./mediaFormat";
import type { FieldDecl } from "./manifest";
import SceneIcon from "./SceneIcon";
import type { SceneData } from "./useSceneData";
import "./EntryTimeline.css";

// 唯一那个 Markdown 控件（CodeMirror 6）比较重，**必须按需加载**：静态 import 会把它
// 拉进主包，连"设置窗口 / 仓库管理窗口"这两个根本不用编辑器的窗口也要白下 400 KB（AGENTS §9）。
const MarkdownWysiwyg = lazy(() => import("./markdown/MarkdownWysiwyg"));

/**
 * 三个主题共用时间线；数据与写盘仍由 useSceneData 提供。
 *
 * 交互（2026-09 起）：**点标题或正文就改** —— 读态没有「改文字」按钮，
 * 正文平时是排好版的 Markdown（同一个 CM6 组件的只读态），点一下当场变成可写，
 * 停手约 0.6s 自动写盘。这是为"小场景快速记录"做的尝试：
 * 若将来试下来内联改在小屏/长文上不顺手，退路是"点开一屏编辑"——
 * 那只需要换宿主，编辑器本身（MarkdownWysiwyg）不用动。
 *
 * 自动保存的两条硬规矩（都与 220ms 有关，见 AGENTS §9）：
 * 1. 防抖延迟必须**大于**编辑器上报延迟（我们 600ms > 220ms），否则会存到旧文本；
 * 2. 重载草稿只认"在编辑哪一条"，**不跟 updatedAt** —— 否则每次自动保存都会把刚敲的字盖回去。
 */
type SaveState = "clean" | "pending" | "saving" | "error";

/** 停手多久写一次盘。必须大于 MarkdownWysiwyg 的 220ms 上报延迟 */
const AUTOSAVE_DELAY = 600;

function saveText(state: SaveState): string {
  if (state === "saving") return "保存中…";
  if (state === "pending") return "待保存…";
  if (state === "error") return "保存失败";
  return "已保存";
}

export default function EntryTimeline({ data, sceneId, fields, emptyText }: {
  data: SceneData;
  sceneId: string;
  fields: FieldDecl[];
  emptyText: string;
}) {
  const [preview, setPreview] = useState<MediaItem | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  /** 点哪儿进来的 → 进去以后焦点落在哪儿（点标题改标题，点正文接着写） */
  const [editingFocus, setEditingFocus] = useState<"title" | "body">("body");
  const [draftTitle, setDraftTitle] = useState("");
  const [draftFields, setDraftFields] = useState<Record<string, unknown>>({});
  const [saveState, setSaveState] = useState<SaveState>("clean");
  /** 谁在导照片（操作行的"导入中…"只该由它决定 —— `data.busy` 也被自动保存占用） */
  const [importingId, setImportingId] = useState<string | null>(null);
  /** 拖动排序：正在拖的记录 id + 悬停落点（目标行的上半 / 下半） */
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropHint, setDropHint] = useState<{ id: string; before: boolean } | null>(null);

  // 草稿的镜像：flush 是异步的，需要**同步**取走"此刻要写什么"，避免跟切条抢引用
  const draftRef = useRef({ title: "", fields: {} as Record<string, unknown> });
  draftRef.current = { title: draftTitle, fields: draftFields };
  /** 进编辑那一刻的样子：草稿跟它一样 = 没有真改动，不必写盘 */
  const baseRef = useRef("");
  const pending = useRef<{ entry: Entry } | null>(null);
  const saveTimer = useRef<number | null>(null);
  const editingIdRef = useRef<string | null>(null);
  editingIdRef.current = editingId;

  /**
   * 显示顺序：**手动排过的块在前（按 order）**，没排过的按时间降序跟在后面 ——
   * 与 Rust 侧 `list_entries` 的规则一致（前端这里再排一次是因为 dateOf 要靠媒体算）。
   */
  const visible = [...data.entries].sort((a, b) => {
    if (a.order != null && b.order != null) return a.order - b.order;
    if (a.order != null) return -1;
    if (b.order != null) return 1;
    return data.dateOf(b).localeCompare(data.dateOf(a));
  });

  /** 落手：按显示顺序拔出拖动的、插到目标行前/后，整表提交（Rust 返回全量直接替换） */
  async function commitReorder(targetId: string, before: boolean) {
    if (!draggingId || draggingId === targetId) return;
    const order = visible.map((entry) => entry.id);
    const from = order.indexOf(draggingId);
    if (from < 0 || !order.includes(targetId)) return;
    order.splice(from, 1);
    order.splice(order.indexOf(targetId) + (before ? 0 : 1), 0, draggingId);
    await data.reorderEntries(order);
  }

  /** 一份"要写什么"的指纹：跟基线一样就说明没改，别写盘 */
  function fingerprint(title: string, values: Record<string, unknown>): string {
    return JSON.stringify({ title: title.trim(), values });
  }

  /**
   * 写盘（唯一的写盘路径）。**先把要写的东西同步取走**，再发请求 ——
   * 这样切条时不必等它，也不会因为切条改了 ref 而把内容写串。
   */
  function flush(): Promise<boolean> | null {
    if (saveTimer.current != null) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    const job = pending.current;
    if (!job) return null;
    pending.current = null;

    const { title, fields: values } = draftRef.current;
    const target = job.entry;
    setSaveState("saving");
    const done = data.edit(target, {
      title: title.trim(),
      ...writeValues(target, sceneId, fields, values),
    });
    void done.then((ok) => {
      // 已经切到别的记录了就别拿旧结果去改界面上的保存状态
      if (editingIdRef.current !== target.id) return;
      setSaveState(ok ? "clean" : "error");
      if (ok) baseRef.current = fingerprint(title, values);
    });
    return done;
  }

  /** 草稿一变就排队：停手 AUTOSAVE_DELAY 之后写一次 */
  useEffect(() => {
    const current = editingId;
    if (!current) return;
    const entry = data.entries.find((item) => item.id === current);
    if (!entry) return;

    if (fingerprint(draftTitle, draftFields) === baseRef.current) {
      // 跟进来时一样（刚进编辑、或改回原样）→ 撤掉排队，不写盘
      pending.current = null;
      setSaveState("clean");
      return;
    }
    pending.current = { entry };
    setSaveState("pending");
    if (saveTimer.current != null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = null;
      void flush();
    }, AUTOSAVE_DELAY);
    return () => {
      if (saveTimer.current != null) {
        window.clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftTitle, draftFields, editingId]);

  // flush 每次渲染都是新的（它闭包着 data / fields）；事件监听里用 ref 拿最新的那份
  const flushRef = useRef(flush);
  flushRef.current = flush;

  // 窗口失焦（点了别的窗口）与卸载（切场景 / 换视图）前都补写一次，防丢字
  useEffect(() => {
    function onBlur() {
      void flushRef.current();
    }
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("blur", onBlur);
      void flushRef.current();
    };
  }, []);

  // Esc 收起编辑（全局监听：CM6 会吃掉容器内的按键，挂在容器上收不到）
  const leaveRef = useRef<() => void>(() => {});
  useEffect(() => {
    if (!editingId) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") void leaveRef.current();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editingId]);

  /** 收起编辑：先把没写的内容补上 */
  async function leaveEdit() {
    await flush();
    setEditingId(null);
    setSaveState("clean");
    baseRef.current = "";
    pending.current = null;
  }
  leaveRef.current = () => void leaveEdit();

  /** 进编辑。已经在编辑同一条就不动（别把刚敲的字重置回磁盘版本） */
  function beginEdit(entry: Entry, focus: "title" | "body") {
    if (editingId === entry.id) return;
    void flush(); // 上一条没写完的先补上（同步取走了内容，不用等）
    const values = Object.fromEntries(
      fields.map((field) => [field.key, fieldValue(entry, sceneId, field)]),
    );
    baseRef.current = fingerprint(entry.title, values);
    setDraftTitle(entry.title);
    setDraftFields(values);
    setEditingFocus(focus);
    setSaveState("clean");
    setEditingId(entry.id);
  }

  /**
   * 读态的点击 = 进入编辑。两道守卫：
   * ① 刚划选完（要复制）不算点击；② 点在链接上不算（读态的点链接由编辑器自己处理并拦下冒泡，
   * 这里再挡一次是给非 CM6 的内容留的余量）。
   */
  function clickToEdit(event: React.MouseEvent, entry: Entry, focus: "title" | "body") {
    if (!window.getSelection()?.isCollapsed) return;
    if ((event.target as HTMLElement).closest("a")) return;
    beginEdit(entry, focus);
  }

  /** 编辑区失焦即收起（点「＋ 也加照片…」焦点还在区内，不会收起；导照片时不收） */
  function onEditBlur(event: React.FocusEvent<HTMLDivElement>) {
    // 窗口整体失焦（切到别的应用、弹系统选择器）不算"点走了"：保持编辑态，只把内容补上。
    // 不然用户只是去别的窗口看一眼，回来发现编辑框没了。
    if (!document.hasFocus()) return;
    const next = event.relatedTarget as Node | null;
    if (next && event.currentTarget.contains(next)) return;
    if (importingId === editingId) return;
    void leaveEdit();
  }

  async function attachPhotos(entry: Entry) {
    setImportingId(entry.id);
    try {
      await data.attachPhotos(entry.id);
    } finally {
      setImportingId(null);
    }
  }

  return (
    <div className="entry-timeline">
      <div className="entry-timeline__toolbar">
        <span>{data.entries.length} 条记录 · {data.media.length} 个照片 / 视频</span>
        <button type="button" onClick={() => void data.reload()} disabled={data.busy !== null}>
          <SceneIcon name="refresh" size={14} /> 刷新
        </button>
      </div>
      {data.entries.length === 0 ? (
        <div className="entry-timeline__empty plain-scene__empty"><SceneIcon name="book" size={30} /><p>{emptyText}</p></div>
      ) : (
        <ul className="entry-timeline__list plain-scene__list">
          {visible.map((entry) => {
            const items = data.mediaOf(entry.id);
            const isEditing = editingId === entry.id;
            const edited = Boolean(entry.updatedAt) && entry.updatedAt !== entry.createdAt;
            const isDropTarget = dropHint?.id === entry.id && draggingId !== entry.id;

            const declared = fields.map((field) => ({
              field,
              text: fieldText(fieldValue(entry, sceneId, field)).trim(),
            }));
            const body = declared
              .filter((item) => item.field.type === "textarea" && item.text)
              .map((item) => item.text)
              .join("\n");
            const inline = declared.filter((item) => item.field.type !== "textarea" && item.text);

            return (
              <li
                key={entry.id}
                className={[
                  "entry",
                  draggingId === entry.id ? "is-dragging" : "",
                  isDropTarget ? (dropHint!.before ? "is-drop-before" : "is-drop-after") : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                draggable={!isEditing}
                onDragStart={(e) => {
                  setDraggingId(entry.id);
                  setDropHint(null);
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", entry.id);
                }}
                onDragEnd={() => {
                  setDraggingId(null);
                  setDropHint(null);
                }}
                onDragOver={(e) => {
                  if (!draggingId || draggingId === entry.id) return;
                  e.preventDefault();
                  const rect = e.currentTarget.getBoundingClientRect();
                  const before = e.clientY < rect.top + rect.height / 2;
                  setDropHint((prev) =>
                    prev?.id === entry.id && prev.before === before ? prev : { id: entry.id, before },
                  );
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (draggingId && isDropTarget) void commitReorder(entry.id, dropHint!.before);
                  setDraggingId(null);
                  setDropHint(null);
                }}
              >
                {isEditing ? (
                  <div className="entry__edit" onBlur={onEditBlur}>
                    <input
                      className="entry__edit-title"
                      value={draftTitle}
                      aria-label="记录标题"
                      placeholder="标题（可留空）"
                      autoFocus={editingFocus === "title"}
                      onChange={(e) => setDraftTitle(e.target.value)}
                    />
                    <SceneFields
                      fields={fields}
                      values={draftFields}
                      onChange={(key, value) => setDraftFields((prev) => ({ ...prev, [key]: value }))}
                      idPrefix={`${entry.id}-edit`}
                      focusRich={editingFocus === "body"}
                    />
                    <div className="entry__edit-actions">
                      <button
                        className="is-quiet"
                        onClick={() => void attachPhotos(entry)}
                        disabled={importingId === entry.id}
                      >
                        {importingId === entry.id ? "导入中…" : "＋ 也加照片…"}
                      </button>
                      <span className="entry__save-state">{saveText(saveState)}</span>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="entry__head">
                      <time className="entry__time" dateTime={data.dateOf(entry)}>
                        {formatDay(data.dateOf(entry))}
                      </time>
                      {inline.length > 0 && <span className="entry__location">{inline.map((item) => item.text).join(" · ")}</span>}
                      <span className="entry__clock">{new Date(entry.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</span>
                    </div>
                    {/* 点标题或正文就进编辑。点击挂在里层真元素上，**不挂整条 <li>**：
                        <li> 同时是拖拽源，且点缩略图 / 按钮 / 链接各有自己的活（见 AGENTS §9） */}
                    <h3
                      className="entry__title"
                      onClick={(event) => clickToEdit(event, entry, "title")}
                    >
                      {entry.title || "未命名记录"}
                    </h3>

                    {body && (
                      /* 正文：同一个 CM6 组件的只读态（排好版的 Markdown）。
                         空正文不挂实例 —— 只有标题的记录不该多出一个空编辑区。
                         fallback 直接把源码铺出来：块加载只发生在这一次开 app 时，
                         给个高度相近的东西占位，免得列表先塌下去再撑开 */
                      <div className="entry__body" onClick={(event) => clickToEdit(event, entry, "body")}>
                        <Suspense fallback={<p className="entry__body-pending">{body}</p>}>
                          <MarkdownWysiwyg
                            value={body}
                            onChange={() => {}}
                            readOnly
                            variant="inline"
                            ariaLabel={`${entry.title || "未命名记录"} 的正文`}
                          />
                        </Suspense>
                      </div>
                    )}

                    {items.length > 0 && (
                      <ul className="entry__media">
                        {items.map((item) => {
                          const src = displayableSrc(item);
                          return (
                            <li key={item.id}>
                              <button
                                className="thumb"
                                title={`${item.file} · ${formatBytes(item.bytes)}`}
                                onClick={() => setPreview(item)}
                              >
                                {src ? (
                                  <img loading="lazy" src={assetUrl(src)} alt={item.file} />
                                ) : (
                                  <span className="thumb__fallback">
                                    {item.mime.startsWith("video/") ? "▶" : "?"} {item.ext.toUpperCase()}
                                  </span>
                                )}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}

                    <div className="entry__actions">
                      <button
                        onClick={() => void attachPhotos(entry)}
                        disabled={data.busy === entry.id}
                      >
                        {importingId === entry.id ? "导入中…" : "＋ 加照片…"}
                      </button>
                      <button
                        className="is-danger"
                        onClick={() => void data.remove(entry)}
                        disabled={data.busy === entry.id}
                      >
                        删除
                      </button>
                      <span className="entry__meta">
                        {inline
                          .map((item) => `${item.field.label} ${item.text}${item.field.unit ?? ""}`)
                          .join(" · ")}
                        {inline.length > 0 && items.length > 0 && " · "}
                        {items.length > 0 && `${items.length} 张`}
                        {edited && ` · 改于 ${formatTime(entry.updatedAt)}`}
                      </span>
                    </div>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {preview && <MediaLightbox item={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}
