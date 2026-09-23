import { useState } from "react";
import { assetUrl, type MediaItem } from "../../lib/api";
import MediaLightbox from "./MediaLightbox";
import { displayableSrc, formatBytes, formatDay } from "./mediaFormat";
import { useSceneData } from "./useSceneData";
import type { FolderNode } from "../../lib/api";
import "./SceneMedia.css";

/**
 * 当前场景的照片墙（手机骨架的"照片"标签）。
 *
 * 刻意不带主题的玩法——它是"把这一场景的媒体摊开看"，
 * 所以挑战的进度、普通记录的时间线都不出现在这里。
 */
export default function SceneMedia({ folder }: { folder: FolderNode }) {
  const data = useSceneData(folder);
  const entryById = new Map(data.entries.map((entry) => [entry.id, entry]));
  const [preview, setPreview] = useState<MediaItem | null>(null);

  const items = data.media
    .map((item) => ({
      item,
      iso: item.takenAt ?? entryById.get(item.entryId ?? "")?.createdAt ?? "",
    }))
    .sort((a, b) => b.iso.localeCompare(a.iso));

  if (items.length === 0) {
    return (
      <p className="photo-grid__empty">
        这个场景还没有照片。
        <br />
        去「记录」里导入，或者拍一张。
      </p>
    );
  }

  return (
    <>
      <ul className="photo-grid">
        {items.map(({ item, iso }) => {
          const src = displayableSrc(item);
          return (
            <li key={item.id}>
              <button
                className="photo-grid__cell"
                title={item.file + " · " + formatBytes(item.bytes)}
                onClick={() => setPreview(item)}
              >
                {src ? (
                  <img loading="lazy" src={assetUrl(src)} alt={item.file} />
                ) : (
                  <span className="photo-grid__fallback">{item.ext.toUpperCase()}</span>
                )}
                {iso && (
                  <time className="photo-grid__date" dateTime={item.takenAt ?? undefined}>
                    {formatDay(iso)}
                  </time>
                )}
              </button>
            </li>
          );
        })}
      </ul>

      {preview && <MediaLightbox item={preview} onClose={() => setPreview(null)} />}
    </>
  );
}
