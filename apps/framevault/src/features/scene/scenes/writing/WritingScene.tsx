import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { assetUrl, type Entry, type MediaItem } from "../../../../lib/api";
import { useCompact } from "../../../../lib/useCompact";
import { fieldText, fieldValue, noteFieldOf, writeValues, type FieldDecl, type SceneViewProps } from "../../manifest";
import { displayableSrc, formatDay } from "../../mediaFormat";
import EntryMenu, { type EntryMenuState } from "../../EntryMenu";
import MediaLightbox from "../../MediaLightbox";
import SceneFields from "../../SceneFields";
import SceneIcon from "../../SceneIcon";
import SceneNotice from "../../SceneNotice";
import { useSceneData } from "../../useSceneData";
import manifest from "./manifest";
import "./WritingScene.css";

// 所见即所得编辑器比较重（ProseMirror 家族），只在写作台里按需加载
const MarkdownWysiwyg = lazy(() => import("../../markdown/MarkdownWysiwyg"));

const NL = String.fromCharCode(10);
/** 停手多久算"写完了"。太短会写得太勤（对同步盘不友好），太长会觉得没存上 */
const AUTOSAVE_DELAY = 600;
/** 长按多久算"右键"（触摸屏没有右键） */
const LONG_PRESS_MS = 500;

type Draft = { text: string; meta: Record<string, unknown> };

/**
 * 写作台的"正文"就是主题声明的那个 `note` 字段 —— 它落磁盘上的 `note.md`，
 * 所以用户写完真的能看到一个 `.md` 文件（这是写作台存在的意义之一）。
 */
function textFieldOf(fields: FieldDecl[]): FieldDecl | undefined {
  return noteFieldOf(fields) ?? fields.find((field) => field.type === "textarea");
}

function draftFrom(entry: Entry | null, sceneId: string, fields: FieldDecl[]): Draft {
  if (!entry) return { text: "", meta: {} };
  const textField = textFieldOf(fields);
  const meta: Record<string, unknown> = {};
  for (const field of fields) {
    if (!field.note && field.type !== "textarea") meta[field.key] = fieldValue(entry, sceneId, field);
  }
  return { text: textField ? fieldText(fieldValue(entry, sceneId, textField)) : "", meta };
}

/** 列表里的一行：优先标题，其次正文第一行（去掉开头的 # 号） */
function summaryOf(entry: Entry, sceneId: string, textField: FieldDecl | undefined): string {
  if (entry.title.trim()) return entry.title.trim();
  if (!textField) return "空白的这一篇";
  const text = fieldText(fieldValue(entry, sceneId, textField)).trim();
  const first = text.split(NL).find((line) => line.trim().length > 0) ?? "";
  return first.replace(/^#+ */, "").slice(0, 24) || "空白的这一篇";
}

/**
 * 写作台：左边一列"篇"，右边一屏"写作"。
 *
 * 数据全部来自 useSceneData（主题不许自己取数据）；这一层只决定"怎么排、怎么显示"。
 * 编辑器 / 渲染器 / 表单 / 大图都是核心提供的公共件，所以这里没有一处自己写的输入控件。
 */
export default function WritingScene({ folder, scene }: SceneViewProps) {
  const data = useSceneData(folder);
  const compact = useCompact();
  const fields: FieldDecl[] = manifest.entryFields ?? [];
  const textField = textFieldOf(fields);
  const metaFields = fields.filter((field) => field.type !== "textarea");

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>({ text: "", meta: {} });
  /** 保存状态：改了就排队、停手就写、写完显示"已保存"（没有保存按钮） */
  const [saveState, setSaveState] = useState<"clean" | "pending" | "saving" | "error">("clean");
  const [preview, setPreview] = useState<MediaItem | null>(null);
  /** 右键 / 长按一篇弹的菜单（桌面右键、触摸长按都走它） */
  const [menu, setMenu] = useState<EntryMenuState>(null);
  /** 照片卡片收起 / 展开 —— 视图开关，按 README 的状态分区记在 localStorage */
  const [photosOpen, setPhotosOpen] = useState(
    () => localStorage.getItem("fv.writingPhotosOpen") !== "0",
  );

  const ordered = [...data.entries].sort((a, b) => data.dateOf(b).localeCompare(data.dateOf(a)));
  const current = ordered.find((entry) => entry.id === selectedId) ?? ordered[0] ?? null;
  const photos = current ? data.mediaOf(current.id) : [];

  /**
   * 待写的这一份：**连同"是哪一篇"一起记**，所以切篇 / 卸载时补写也写得对。
   * `snapshot` 是序列化后的内容，用来判断"到底变没变"（没变就不写盘）。
   */
  const pending = useRef<{ id: string; entry: Entry; snapshot: string } | null>(null);
  const saveTimer = useRef<number | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  function snapshotOf(entry: Entry, values: Draft): string {
    return JSON.stringify({
      text: values.text,
      meta: values.meta,
      // 标题固定不动（写作台的标题是空的，目录名只按创建日），但带上它省得以后忘
      title: entry.title,
    });
  }

  /** 立刻把待写的那一份落盘（停手后、切篇前、失焦时、卸载时都调它） */
  async function flush() {
    const job = pending.current;
    if (!job) return;
    if (saveTimer.current != null) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    setSaveState("saving");
    const values = draftRef.current;
    const ok = await data.edit(job.entry, {
      title: job.entry.title,
      ...writeValues(job.entry, scene.id, fields, {
        ...values.meta,
        ...(textField ? { [textField.key]: values.text } : {}),
      }),
    });
    if (!ok) {
      setSaveState("error");
      return; // 留着 pending：下一次改动或补写还会再试
    }
    if (pending.current?.snapshot === job.snapshot) pending.current = null;
    setSaveState("clean");
  }

  // 换了一篇就把草稿重新装载。
  // **依赖只认"哪一篇"**：自动保存会让 updatedAt 每次变化，跟着它重载就成了
  // "存一次 → 重载一次 → 把刚敲的字盖回去"，打字快的时候会丢字（见 AGENTS §9）。
  useEffect(() => {
    setDraft(draftFrom(current, scene.id, fields));
    setSaveState("clean");
    pending.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current ? current.id : null]);

  // 草稿一变就排队：停手 AUTOSAVE_DELAY 之后写一次
  useEffect(() => {
    if (!current) return;
    const values = { text: draft.text, meta: draft.meta };
    const snapshot = snapshotOf(current, values);
    pending.current = { id: current.id, entry: current, snapshot };
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
  }, [draft]);

  // 窗口失焦 / 组件卸载：把还没写的补上（Obsidian 也是这么干的）
  useEffect(() => {
    const onBlur = () => void flush();
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("blur", onBlur);
      void flush();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 在指针位置弹出那一篇的菜单（桌面右键 / 触摸长按共用） */
  function openMenuAt(x: number, y: number, entry: Entry) {
    setMenu({
      x,
      y,
      items: [
        {
          label: "删除这一篇",
          danger: true,
          onSelect: () => {
            setMenu(null);
            void data.remove(entry);
          },
        },
      ],
    });
  }

  function openMenu(event: React.MouseEvent, entry: Entry) {
    event.preventDefault();
    openMenuAt(event.clientX, event.clientY, entry);
  }

  const pressTimer = useRef<number | null>(null);

  function startPress(event: React.PointerEvent, entry: Entry) {
    if (event.pointerType === "mouse") return; // 鼠标走右键，免得误触
    const { clientX, clientY } = event;
    endPress();
    pressTimer.current = window.setTimeout(() => {
      pressTimer.current = null;
      openMenuAt(clientX, clientY, entry);
    }, LONG_PRESS_MS);
  }

  function endPress() {
    if (pressTimer.current != null) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  }

  function togglePhotos() {
    setPhotosOpen((prev) => {
      const next = !prev;
      localStorage.setItem("fv.writingPhotosOpen", next ? "1" : "0");
      return next;
    });
  }

  async function createEntry() {
    const entry = await data.create("");
    if (entry) setSelectedId(entry.id);
  }

  return (
    <div className="writing">
      <SceneNotice message={data.notice} onUndo={data.undo} onDismiss={data.dismissNotice} />

      {data.error && <p className="writing__error">{data.error}</p>}

      {ordered.length === 0 ? (
        <div className="writing__empty">
          <SceneIcon name="book" size={30} />
          <p>还没有记录。写下一篇开始 —— 正文支持 Markdown。</p>
          <button
            type="button"
            className="writing__btn is-primary"
            onClick={() => void createEntry()}
            disabled={data.busy !== null}
          >
            <SceneIcon name="edit" size={14} /> 写新的一篇
          </button>
        </div>
      ) : (
        <div className={compact ? "writing__body is-compact" : "writing__body"}>
          <div className="writing__side">
            {/* 列表自己的头：篇数在左，新建按钮是 Obsidian 式的小图标（自动保存之后顶栏就没有存在的必要了） */}
            <div className="writing__list-head">
              <span className="writing__count">{ordered.length} 篇</span>
              <button
                type="button"
                className="writing__new"
                title="写新的一篇"
                aria-label="写新的一篇"
                onClick={() => void createEntry()}
                disabled={data.busy !== null}
              >
                <SceneIcon name="edit" size={16} />
              </button>
            </div>
            <ul className="writing__list">
            {ordered.map((entry) => (
              <li key={entry.id}>
                <button
                  type="button"
                  className={current && entry.id === current.id ? "writing__item is-active" : "writing__item"}
                  title="右键（或长按）可以删除这一篇"
                  onClick={() => {
                    void flush(); // 切篇前先把这一篇写完（卸下待写任务，防丢字）
                    setSelectedId(entry.id);
                  }}
                  onContextMenu={(e) => openMenu(e, entry)}
                  onPointerDown={(e) => startPress(e, entry)}
                  onPointerUp={endPress}
                  onPointerLeave={endPress}
                  onPointerMove={endPress}
                >
                  <span className="writing__item-day">{formatDay(data.dateOf(entry))}</span>
                  <span className="writing__item-summary">{summaryOf(entry, scene.id, textField)}</span>
                </button>
              </li>
            ))}
            </ul>
          </div>

          {current && (
            <article className="writing__sheet">
              <header className="writing__head">
                <h2 className="writing__date">{formatDay(data.dateOf(current))}</h2>
                <span className="writing__time">
                  {new Date(current.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}
                </span>
                <span className="writing__save-state">
                  {saveState === "saving"
                    ? "保存中…"
                    : saveState === "error"
                      ? "没存上，改一下再试"
                      : saveState === "pending"
                        ? ""
                        : "✓ 已保存"}
                </span>
              </header>

              {/* 照片在上、正文在下：写作时先看见"这一篇配了什么图"。
              **整行都是开关**：点哪儿都能收起 / 展开，右侧箭头指示当前状态 */}
              <section className="writing__photos">
                <button
                  type="button"
                  className="writing__photos-head"
                  aria-expanded={photosOpen}
                  aria-label={photosOpen ? "收起照片" : "展开照片"}
                  title={photosOpen ? "收起照片" : "展开照片"}
                  onClick={togglePhotos}
                >
                  <span className="writing__photos-label">
                    <SceneIcon name="photo" size={14} />
                    照片 {photos.length}
                  </span>
                  <span className={photosOpen ? "writing__photos-caret is-open" : "writing__photos-caret"} />
                </button>

                {photosOpen && (
                  <div className="writing__photos-body">
                    {photos.map((item) => {
                      // displayableSrc 给的是磁盘路径，必须过 assetUrl 才能在 WebView 里显示
                      const src = displayableSrc(item);
                      const video = item.mime.startsWith("video/");
                      return (
                        <button
                          key={item.id}
                          type="button"
                          className="writing__photo"
                          onClick={() => setPreview(item)}
                          title={item.file}
                        >
                          {src ? (
                            <img loading="lazy" src={assetUrl(src)} alt={item.file} />
                          ) : (
                            <span className="writing__photo-fallback">
                              {video ? "▶" : "?"} {item.ext.toUpperCase()}
                            </span>
                          )}
                        </button>
                      );
                    })}

                    <button
                      type="button"
                      className="writing__photo is-add"
                      onClick={() => void data.attachPhotos(current.id)}
                      disabled={data.busy !== null}
                    >
                      <span className="writing__photo-plus">＋</span>
                      导入照片
                    </button>
                  </div>
                )}
              </section>

              {metaFields.length > 0 && (
                <div className="writing__meta">
                  <SceneFields
                    fields={metaFields}
                    values={draft.meta}
                    idPrefix="writing-meta"
                    onChange={(key, value) =>
                      // 只管改草稿：排队写盘交给下面那个监听 draft 的 effect（自动保存）
                      setDraft((prev) => ({ ...prev, meta: { ...prev.meta, [key]: value } }))
                    }
                  />
                </div>
              )}

              <Suspense fallback={<p className="writing__loading">编辑器加载中…</p>}>
                <MarkdownWysiwyg
                  value={draft.text}
                  onChange={(next) => {
                    // 编辑器挂载时会把内容回灌一次（自己的 value 又报回来），那不算用户改动 ——
                    // 不挡住的话，刚打开一篇就排队写一次盘
                    if (next === draft.text) return;
                    setDraft((prev) => ({ ...prev, text: next }));
                  }}
                />
              </Suspense>

            </article>
          )}
        </div>
      )}

      <EntryMenu menu={menu} onClose={() => setMenu(null)} />

      {preview && <MediaLightbox item={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}
