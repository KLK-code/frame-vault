import { useCallback, useEffect, useState } from "react";
import {
  assetUrl,
  importMedia,
  listEntries,
  listMedia,
  newId,
  pickMediaFiles,
  saveEntry,
  updateEntry,
  type Entry,
  type MediaItem,
} from "../../../../lib/api";
import MediaLightbox from "../../MediaLightbox";
import { displayableSrc, formatBytes, formatTime } from "../../mediaFormat";
import type { SceneViewProps } from "../../registry";
import "./PlainScene.css";

/** 普通记录主题自己的约定：正文放在 fields.text 里（核心不解释 fields 的内容） */
function bodyOf(entry: Entry): string {
  const text = entry.fields?.text;
  return typeof text === "string" ? text : "";
}

/**
 * 内置"普通记录"：一条记录 = 标题 + 正文 + 若干照片/视频。
 *
 * 两条刻意的自由：
 * 1. **一条记录可以挂任意多张照片**——加照片的入口就在每条记录自己身上，不用回到顶部；
 * 2. **文字随时能改**——标题和正文都是可编辑的，不是建完就定死。
 *
 * 它同时是主题的**最小示例**：从 props 拿到场景 → 自己决定列出什么、怎么录入
 * → 自己的约定存进 entry.fields。
 */
export default function PlainScene({ folder, scene }: SceneViewProps) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [busyEntry, setBusyEntry] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<MediaItem | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftText, setDraftText] = useState("");

  const reload = useCallback(async () => {
    try {
      const [list, all] = await Promise.all([listEntries(folder.id), listMedia(null)]);
      setEntries(list);
      // 媒体在磁盘上是全局扁平的，只带一个 entryId；
      // "属于本场景"这件事在这里算出来——和场景归类一样，分组是展示层的活。
      const mine = new Set(list.map((entry) => entry.id));
      setMedia(all.filter((item) => item.entryId && mine.has(item.entryId)));
      setError(null);
    } catch (err) {
      setError(String(err));
    }
  }, [folder.id]);

  // 换场景就重新拉一次
  useEffect(() => {
    void reload();
  }, [reload]);

  function mediaOf(entryId: string): MediaItem[] {
    return media.filter((item) => item.entryId === entryId);
  }

  /** 新建一条记录：只写标题，正文和照片都可以之后再补 */
  async function addText() {
    const text = title.trim();
    if (!text || busy) return;

    setBusy(true);
    try {
      const id = await newId();
      await saveEntry(id, text, { folderId: folder.id });
      setTitle("");
      await reload();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  /** 新建时顺手导入照片：这些照片进同一条记录 */
  async function addWithPhotos() {
    if (busy) return;
    const files = await pickMediaFiles();
    if (files.length === 0) return;

    setBusy(true);
    try {
      const entryId = await newId();
      await saveEntry(entryId, title.trim(), { folderId: folder.id });
      for (const file of files) {
        await importMedia(file, entryId);
      }
      setTitle("");
      await reload();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  /** 往**已有**记录里继续加照片——这是之前缺的那条路 */
  async function attachPhotos(entryId: string) {
    if (busyEntry) return;
    const files = await pickMediaFiles();
    if (files.length === 0) return;

    setBusyEntry(entryId);
    try {
      for (const file of files) {
        await importMedia(file, entryId);
      }
      await reload();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusyEntry(null);
    }
  }

  function startEdit(entry: Entry) {
    setEditingId(entry.id);
    setDraftTitle(entry.title);
    setDraftText(bodyOf(entry));
  }

  async function saveEdit(entry: Entry) {
    setBusyEntry(entry.id);
    try {
      // fields 是整体替换，所以要把旧值摊开再改我们关心的那一个键
      await updateEntry(entry.id, {
        title: draftTitle.trim(),
        fields: { ...entry.fields, text: draftText },
      });
      setEditingId(null);
      await reload();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusyEntry(null);
    }
  }

  return (
    <div className="plain-scene">
      <div className="plain-scene__compose">
        <input
          value={title}
          placeholder={`记点什么…（${scene.name}）`}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void addText();
          }}
        />
        <button className="is-ghost" onClick={() => void addWithPhotos()} disabled={busy}>
          新建并放照片…
        </button>
        <button onClick={() => void addText()} disabled={busy || !title.trim()}>
          记录
        </button>
      </div>

      {error && <p className="plain-scene__error">{error}</p>}

      {entries.length === 0 ? (
        <p className="plain-scene__empty">
          这个场景还没有记录。写点什么，或者直接导入照片。
        </p>
      ) : (
        <ul className="plain-scene__list">
          {entries.map((entry) => {
            const items = mediaOf(entry.id);
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
                      placeholder="正文…（这段会存进这条记录自己的字段里）"
                      onChange={(e) => setDraftText(e.target.value)}
                    />
                    <div className="entry__edit-actions">
                      <button
                        className="is-primary"
                        onClick={() => void saveEdit(entry)}
                        disabled={busyEntry === entry.id}
                      >
                        保存
                      </button>
                      <button onClick={() => setEditingId(null)}>取消</button>
                      <button
                        className="is-quiet"
                        onClick={() => void attachPhotos(entry.id)}
                        disabled={busyEntry === entry.id}
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
                        onClick={() => void attachPhotos(entry.id)}
                        disabled={busyEntry === entry.id}
                      >
                        {busyEntry === entry.id ? "导入中…" : "＋ 加照片…"}
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

      <p className="plain-scene__count">{entries.length > 0 && `共 ${entries.length} 条记录`}</p>

      {preview && <MediaLightbox item={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}
