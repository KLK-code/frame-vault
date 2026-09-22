import { useState } from "react";
import { assetUrl, type Entry, type MediaItem } from "../../../../lib/api";
import MediaLightbox from "../../MediaLightbox";
import { displayableSrc, formatBytes, formatTime } from "../../mediaFormat";
import type { SceneViewProps } from "../../registry";
import { useSceneData } from "../../useSceneData";
import "./PlainScene.css";

/** 普通记录主题自己的约定：正文放在 fields.text 里（核心不解释 fields 的内容） */
function bodyOf(entry: Entry): string {
  const text = entry.fields?.text;
  return typeof text === "string" ? text : "";
}

/**
 * 内置"普通记录"：一条记录 = 标题 + 正文 + 若干照片/视频。
 *
 * 这个组件**只做展示与编排**：数据读写、归属、刷新、忙碌状态全部来自 `useSceneData`
 * （底层能力）。所以"一条记录能挂多张照片、文字能反复改"不是这个主题特有的功能，
 * 而是所有主题共用的能力——挑战主题同样有，只是它选择了别的画法。
 */
export default function PlainScene({ folder, scene }: SceneViewProps) {
  const data = useSceneData(folder);
  const [title, setTitle] = useState("");
  const [preview, setPreview] = useState<MediaItem | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftText, setDraftText] = useState("");

  function startEdit(entry: Entry) {
    setEditingId(entry.id);
    setDraftTitle(entry.title);
    setDraftText(bodyOf(entry));
  }

  async function saveEdit(entry: Entry) {
    // fields 是整体替换，所以要把旧值摊开再改我们关心的那一个键
    const ok = await data.edit(entry, {
      title: draftTitle.trim(),
      fields: { ...entry.fields, text: draftText },
    });
    if (ok) setEditingId(null);
  }

  return (
    <div className="plain-scene">
      <div className="plain-scene__compose">
        <input
          value={title}
          placeholder={`记点什么…（${scene.name}）`}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void data.create(title.trim());
          }}
        />
        <button
          className="is-ghost"
          onClick={() => void data.createWithPhotos(title.trim())}
          disabled={data.busy === "new"}
        >
          新建并放照片…
        </button>
        <button
          onClick={() => void data.create(title.trim())}
          disabled={data.busy === "new" || !title.trim()}
        >
          记录
        </button>
      </div>

      {data.error && <p className="plain-scene__error">{data.error}</p>}

      {data.entries.length === 0 ? (
        <p className="plain-scene__empty">
          这个场景还没有记录。写点什么，或者直接导入照片。
        </p>
      ) : (
        <ul className="plain-scene__list">
          {data.entries.map((entry) => {
            const items = data.mediaOf(entry.id);
            const body = bodyOf(entry);
            const isEditing = editingId === entry.id;
            const edited = Boolean(entry.updatedAt) && entry.updatedAt !== entry.createdAt;

            return (
              <li key={entry.id} className="entry">
                {isEditing ? (
                  <div className="entry__edit">
                    <input
                      className="entry__edit-title"
                      value={draftTitle}
                      placeholder="标题（可留空）"
                      onChange={(e) => setDraftTitle(e.target.value)}
                    />
                    <textarea
                      className="entry__edit-text"
                      rows={4}
                      value={draftText}
                      placeholder="正文…"
                      onChange={(e) => setDraftText(e.target.value)}
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
                      <h3 className="entry__title">{entry.title || "（没写标题）"}</h3>
                      <time className="entry__time" dateTime={entry.createdAt}>
                        {formatTime(entry.createdAt)}
                      </time>
                    </div>

                    {body && <p className="entry__body">{body}</p>}

                    {items.length > 0 && (
                      <ul className="entry__media">
                        {items.map((item) => {
                          const src = displayableSrc(item);
                          return (
                            <li key={item.id}>
                              <button
                                className="thumb"
                                title={`${item.name} · ${formatBytes(item.bytes)}`}
                                onClick={() => setPreview(item)}
                              >
                                {src ? (
                                  <img loading="lazy" src={assetUrl(src)} alt={item.name} />
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
                      <span className="entry__meta">
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

      <p className="plain-scene__count">
        {data.entries.length > 0 && `共 ${data.entries.length} 条记录`}
      </p>

      {preview && <MediaLightbox item={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}
