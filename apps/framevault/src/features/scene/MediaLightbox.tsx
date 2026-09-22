import { useEffect, type ReactNode } from "react";
import { assetUrl, type MediaItem } from "../../lib/api";
import { WEBVIEW_IMAGE_EXTS, displayableSrc, formatBytes } from "./mediaFormat";
import "./MediaLightbox.css";

type Props = {
  item: MediaItem;
  onClose: () => void;
  /** 主题自己的补充界面（比如"编辑这张照片的说明"）——公共件不认识记录，只负责摆位置 */
  footer?: ReactNode;
};

/**
 * 点开大图 / 播放视频。普通记录和挑战两处都用到，所以它是公共件（不是提前抽的）。
 * Esc 或点背景关闭；解不开的格式给说明 + 原文件路径，不假装能显示。
 */
export default function MediaLightbox({ item, onClose, footer }: Props) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const thumb = displayableSrc(item);

  return (
    <div className="lightbox" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="lightbox__body" onClick={(e) => e.stopPropagation()}>
        {item.mime.startsWith("video/") ? (
          <video className="lightbox__media" src={assetUrl(item.originalPath)} controls autoPlay />
        ) : WEBVIEW_IMAGE_EXTS.has(item.ext) ? (
          <img className="lightbox__media" src={assetUrl(item.originalPath)} alt={item.name} />
        ) : (
          <div className="lightbox__unsupported">
            <p>WebView 解不开 .{item.ext}（常见于 iPhone 直出的 HEIC）。</p>
            <p>文件已经完整导入，原始文件在这里：</p>
            <code>{item.originalPath}</code>
            {thumb && <p className="lightbox__hint">列表里显示的是它的缩略图。</p>}
          </div>
        )}

        {footer && <div className="lightbox__footer">{footer}</div>}

        <div className="lightbox__bar">
          <span className="lightbox__caption">
            {item.name} · {formatBytes(item.bytes)}
            {item.width ? ` · ${item.width}×${item.height}` : ""}
            {item.takenAt ? ` · 拍摄于 ${item.takenAt.replace("T", " ")}` : ""}
          </span>
          <button onClick={onClose}>关闭</button>
        </div>
      </div>
    </div>
  );
}
