import { useEffect, useState } from "react";
import { assetUrl, type Entry, type MediaItem } from "../../../../lib/api";
import { useCompact } from "../../../../lib/useCompact";
import { fieldText, readField, writeFields, type FieldDecl, type SceneViewProps } from "../../manifest";
import { displayableSrc, formatDay } from "../../mediaFormat";
import MarkdownField from "../../markdown/MarkdownField";
import MediaLightbox from "../../MediaLightbox";
import SceneFields from "../../SceneFields";
import SceneIcon from "../../SceneIcon";
import SceneNotice from "../../SceneNotice";
import { useSceneData } from "../../useSceneData";
import manifest from "./manifest";
import "./WritingScene.css";

const NL = String.fromCharCode(10);

type Draft = { text: string; meta: Record<string, unknown> };

function textFieldOf(fields: FieldDecl[]): FieldDecl | undefined {
  return fields.find((field) => field.type === "textarea");
}

function draftFrom(entry: Entry | null, sceneId: string, fields: FieldDecl[]): Draft {
  if (!entry) return { text: "", meta: {} };
  const textField = textFieldOf(fields);
  const meta: Record<string, unknown> = {};
  for (const field of fields) {
    if (field.type !== "textarea") meta[field.key] = readField(entry, sceneId, field.key);
  }
  return { text: textField ? fieldText(readField(entry, sceneId, textField.key)) : "", meta };
}

/** 列表里的一行：优先标题，其次正文第一行（去掉开头的 # 号） */
function summaryOf(entry: Entry, sceneId: string, textField: FieldDecl | undefined): string {
  if (entry.title.trim()) return entry.title.trim();
  if (!textField) return "空白的这一篇";
  const text = fieldText(readField(entry, sceneId, textField.key)).trim();
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
    const space = current.fields[scene.id];
    const namespace = {
      ...(typeof space === "object" && space !== null ? (space as Record<string, unknown>) : {}),
      ...draft.meta,
      ...(textField ? { [textField.key]: draft.text } : {}),
    };
    const ok = await data.edit(current, {
      title: current.title,
      fields: writeFields(current, scene.id, namespace),
    });
    if (ok) setDirty(false);
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

              <MarkdownField
                id="writing-text"
                value={draft.text}
                rows={compact ? 10 : 18}
                layout={compact ? "toggle" : "split"}
                placeholder={textField ? textField.placeholder : undefined}
                onChange={(next) => {
                  setDraft((prev) => ({ ...prev, text: next }));
                  setDirty(true);
                }}
              />

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
                  className="writing__btn"
                  onClick={() => void data.attachPhotos(current.id)}
                  disabled={data.busy !== null}
                >
                  ＋ 加照片
                </button>
                <button
                  type="button"
                  className="writing__btn is-danger"
                  onClick={() => void data.remove(current)}
                  disabled={data.busy !== null}
                >
                  删除
                </button>
                <span className="writing__hint">正文是 Markdown；宽窗口下右边是实时预览</span>
              </div>

              {photos.length > 0 && (
                <ul className="writing__photos">
                  {photos.map((item) => {
                    // displayableSrc 给的是磁盘路径，必须过 assetUrl 才能在 WebView 里显示
                    const src = displayableSrc(item);
                    const video = item.mime.startsWith("video/");
                    return (
                      <li key={item.id}>
                        <button type="button" onClick={() => setPreview(item)} title={item.name}>
                          {src ? (
                            <img loading="lazy" src={assetUrl(src)} alt={item.name} />
                          ) : (
                            <span className="writing__photo-fallback">
                              {video ? "▶" : "?"} {item.ext.toUpperCase()}
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </article>
          )}
        </div>
      )}

      {preview && <MediaLightbox item={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}
