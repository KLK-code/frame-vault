import { useCallback, useEffect, useState } from "react";
import {
  assetUrl,
  importMedia,
  listEntries,
  listMedia,
  newId,
  pickMediaFiles,
  saveEntry,
  type Entry,
  type MediaItem,
} from "../../../../lib/api";
import MediaLightbox from "../../MediaLightbox";
import { displayableSrc, formatBytes, formatTime } from "../../mediaFormat";
import type { SceneViewProps } from "../../registry";
import "./PlainScene.css";

/**
 * 内置"普通记录"：一条记录 = 一个标题 + 时间 + 若干照片/视频。
 *
 * 它同时是主题的**最小示例**——别的主题照着这个骨架写就行：
 * 从 props 拿到场景 → 自己决定列出什么、怎么录入 → 数据都存进 entry.fields。
 */
export default function PlainScene({ folder, scene }: SceneViewProps) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<MediaItem | null>(null);

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

  /** 新建一条纯文字记录 */
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

  /**
   * 导入照片/视频：**一次导入 = 一条记录**（今天爬山 = 12 张照片挂在同一条记录下）。
   * 标题用输入框里的字，没写字就用日期，免得出现一堆"未命名"。
   */
  async function importPhotos() {
    if (busy) return;
    const files = await pickMediaFiles();
    if (files.length === 0) return;

    setBusy(true);
    try {
      const entryId = await newId();
      const heading = title.trim() || `${new Date().toLocaleDateString("zh-CN")} 的照片`;
      await saveEntry(entryId, heading, { folderId: folder.id });
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

  function mediaOf(entryId: string): MediaItem[] {
    return media.filter((item) => item.entryId === entryId);
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
        <button className="is-ghost" onClick={() => void importPhotos()} disabled={busy}>
          导入照片…
        </button>
        <button onClick={() => void addText()} disabled={busy || !title.trim()}>
          记录
        </button>
      </div>

      {error && <p className="plain-scene__error">{error}</p>}

      {entries.length === 0 ? (
        <p className="plain-scene__empty">这个场景还没有记录。写点什么，或者直接导入照片。</p>
      ) : (
        <ul className="plain-scene__list">
          {entries.map((entry) => {
            const items = mediaOf(entry.id);
            return (
              <li key={entry.id} className="entry">
                <div className="entry__head">
                  <span className="entry__title">{entry.title}</span>
                  <time className="entry__time" dateTime={entry.createdAt}>
                    {formatTime(entry.createdAt)}
                  </time>
                </div>

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
