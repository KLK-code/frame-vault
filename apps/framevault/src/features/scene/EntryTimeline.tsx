import { useState } from "react";
import { assetUrl, type Entry, type MediaItem } from "../../lib/api";
import MediaLightbox from "./MediaLightbox";
import SceneFields from "./SceneFields";
import MarkdownView from "./markdown/MarkdownView";
import { fieldText, fieldValue, writeValues } from "./manifest";
import { displayableSrc, formatBytes, formatTime, formatDay } from "./mediaFormat";
import type { FieldDecl } from "./manifest";
import SceneIcon from "./SceneIcon";
import type { SceneData } from "./useSceneData";
import "./EntryTimeline.css";

/** 三个主题共用时间线；数据与写盘仍由 useSceneData 提供。 */
export default function EntryTimeline({ data, sceneId, fields, emptyText }: {
  data: SceneData;
  sceneId: string;
  fields: FieldDecl[];
  emptyText: string;
}) {
  const [preview, setPreview] = useState<MediaItem | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftFields, setDraftFields] = useState<Record<string, unknown>>({});

  function startEdit(entry: Entry) {
    setEditingId(entry.id);
    setDraftTitle(entry.title);
    // 按声明逐个取值——主题不写"哪几个字段"，因为字段是声明出来的
    setDraftFields(
      Object.fromEntries(fields.map((field) => [field.key, fieldValue(entry, sceneId, field)])),
    );
  }

  async function saveEdit(entry: Entry) {
    // 写回：正文进 note.md，其余字段进本主题的命名空间（别的主题的字段原样带走）
    const ok = await data.edit(entry, {
      title: draftTitle.trim(),
      ...writeValues(entry, sceneId, fields, draftFields),
    });
    if (ok) setEditingId(null);
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
          {[...data.entries].sort((a, b) => data.dateOf(b).localeCompare(data.dateOf(a))).map((entry) => {
            const items = data.mediaOf(entry.id);
            const isEditing = editingId === entry.id;
            const edited = Boolean(entry.updatedAt) && entry.updatedAt !== entry.createdAt;

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
              <li key={entry.id} className="entry">
                {isEditing ? (
                  <div className="entry__edit">
                    <input
                      className="entry__edit-title"
                      value={draftTitle}
                      aria-label="记录标题"
                      placeholder="标题（可留空）"
                      onChange={(e) => setDraftTitle(e.target.value)}
                    />
                    <SceneFields
                      fields={fields}
                      values={draftFields}
                      onChange={(key, value) => setDraftFields((prev) => ({ ...prev, [key]: value }))}
                      idPrefix={`${entry.id}-edit`}
                    />
                    <div className="entry__edit-actions">
                      <button
                        className="is-primary"
                        onClick={() => void saveEdit(entry)}
                        disabled={data.busy === entry.id}
                      >
                        保存
                      </button>
                      <button onClick={() => setEditingId(null)}>取消</button>
                      <button
                        className="is-quiet"
                        onClick={() => void data.attachPhotos(entry.id)}
                        disabled={data.busy === entry.id}
                      >
                        ＋ 也加照片…
                      </button>
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
                    <h3 className="entry__title">{entry.title || "未命名记录"}</h3>

                    {body && (
                      /* 正文是 Markdown：这里从 <p> 换成 <div> —— 块级元素不能塞进 <p>（<p> 会被浏览器自动闭合） */
                      <div className="entry__body">
                        <MarkdownView text={body} />
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
                      <button onClick={() => startEdit(entry)}>改文字</button>
                      <button
                        onClick={() => void data.attachPhotos(entry.id)}
                        disabled={data.busy === entry.id}
                      >
                        {data.busy === entry.id ? "导入中…" : "＋ 加照片…"}
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
