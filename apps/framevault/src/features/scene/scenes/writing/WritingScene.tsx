import { Suspense, lazy, useEffect, useState } from "react";
import { assetUrl, type Entry, type MediaItem } from "../../../../lib/api";
import { useCompact } from "../../../../lib/useCompact";
import { fieldText, fieldValue, noteFieldOf, writeValues, type FieldDecl, type SceneViewProps } from "../../manifest";
import { displayableSrc, formatDay } from "../../mediaFormat";
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
  const [dirty, setDirty] = useState(false);
  const [preview, setPreview] = useState<MediaItem | null>(null);
  /** 照片卡片收起 / 展开 —— 视图开关，按 README 的状态分区记在 localStorage */
  const [photosOpen, setPhotosOpen] = useState(
    () => localStorage.getItem("fv.writingPhotosOpen") !== "0",
  );

  const ordered = [...data.entries].sort((a, b) => data.dateOf(b).localeCompare(data.dateOf(a)));
  const current = ordered.find((entry) => entry.id === selectedId) ?? ordered[0] ?? null;
  const photos = current ? data.mediaOf(current.id) : [];

  // 换了一篇（或它被别处改了）就把草稿重新装载
  useEffect(() => {
    setDraft(draftFrom(current, scene.id, fields));
    setDirty(false);
    // 依赖只认"哪一篇 + 它最后改动时间"；字段声明是常量
  }, [current ? current.id : null, current ? current.updatedAt : null]);

  async function save() {
    if (!current) return;
    // 正文与元字段一起交给核心路由：正文 → note.md，其余 → 本主题的字段命名空间
    const values = {
      ...draft.meta,
      ...(textField ? { [textField.key]: draft.text } : {}),
    };
    const ok = await data.edit(current, {
      title: current.title,
      ...writeValues(current, scene.id, fields, values),
    });
    if (ok) setDirty(false);
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

      <div className="writing__bar">
        <span className="writing__count">{ordered.length} 篇</span>
        <div className="writing__bar-actions">
          <button
            type="button"
            className="writing__btn"
            onClick={() => void data.reload()}
            disabled={data.busy !== null}
          >
            <SceneIcon name="refresh" size={14} /> 刷新
          </button>
          <button
            type="button"
            className="writing__btn is-primary"
            onClick={() => void createEntry()}
            disabled={data.busy !== null}
          >
            写新的一篇
          </button>
        </div>
      </div>

      {data.error && <p className="writing__error">{data.error}</p>}

      {ordered.length === 0 ? (
        <div className="writing__empty">
          <SceneIcon name="book" size={30} />
          <p>还没有记录。点右上角「写新的一篇」开始 —— 正文支持 Markdown。</p>
        </div>
      ) : (
        <div className={compact ? "writing__body is-compact" : "writing__body"}>
          <ul className="writing__list">
            {ordered.map((entry) => (
              <li key={entry.id}>
                <button
                  type="button"
                  className={current && entry.id === current.id ? "writing__item is-active" : "writing__item"}
                  onClick={() => setSelectedId(entry.id)}
                >
                  <span className="writing__item-day">{formatDay(data.dateOf(entry))}</span>
                  <span className="writing__item-summary">{summaryOf(entry, scene.id, textField)}</span>
                </button>
              </li>
            ))}
          </ul>

          {current && (
            <article className="writing__sheet">
              <header className="writing__head">
                <h2 className="writing__date">{formatDay(data.dateOf(current))}</h2>
                <span className="writing__time">
                  {new Date(current.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}
                </span>
                {dirty && <span className="writing__dirty">未保存</span>}
              </header>

              {/* 照片在上、正文在下：写作时先看见"这一篇配了什么图"，右上角的按钮能把它收起来 */}
              <section className="writing__photos">
                <header className="writing__photos-head">
                  <span className="writing__photos-label">
                    <SceneIcon name="photo" size={14} />
                    照片 {photos.length}
                  </span>
                  {/* 收起 / 展开的按钮在**右上角**（像参考图那样），点一下把整条照片收掉 */}
                  <button
                    type="button"
                    className="writing__photos-toggle"
                    aria-expanded={photosOpen}
                    aria-label={photosOpen ? "收起照片" : "展开照片"}
                    title={photosOpen ? "收起照片" : "展开照片"}
                    onClick={togglePhotos}
                  >
                    <span className="writing__photos-caret">{photosOpen ? "︿" : "﹀"}</span>
                  </button>
                </header>

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
                    onChange={(key, value) => {
                      setDraft((prev) => ({ ...prev, meta: { ...prev.meta, [key]: value } }));
                      setDirty(true);
                    }}
                  />
                </div>
              )}

              <Suspense fallback={<p className="writing__loading">编辑器加载中…</p>}>
                <MarkdownWysiwyg
                  value={draft.text}
                  onChange={(next) => {
                    // 编辑器挂载时会把内容回灌一次（自己的 value 又报回来），那不算用户改动 ——
                    // 不挡住的话，刚打开一篇就亮着"未保存"（验证时看到的）
                    if (next === draft.text) return;
                    setDraft((prev) => ({ ...prev, text: next }));
                    setDirty(true);
                  }}
                />
              </Suspense>

              <div className="writing__actions">
                <button
                  type="button"
                  className="writing__btn is-primary"
                  onClick={() => void save()}
                  disabled={data.busy !== null || !dirty}
                >
                  保存
                </button>
                <button
                  type="button"
                  className="writing__btn is-danger"
                  onClick={() => void data.remove(current)}
                  disabled={data.busy !== null}
                >
                  删除
                </button>
                <span className="writing__hint">所见即所得：标题、列表、引用直接就是排好的样子，粘一整篇 Markdown 进来也会自动排版。改完记得保存</span>
              </div>
            </article>
          )}
        </div>
      )}

      {preview && <MediaLightbox item={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}
