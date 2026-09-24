import { assetUrl, type MediaItem } from "../../lib/api";

/** WebView 自己就能解的图片格式。HEIC 不在其中——而 iPhone 直出恰恰是 HEIC */
export const WEBVIEW_IMAGE_EXTS = new Set(["jpg", "jpeg", "jpe", "png", "webp", "gif", "bmp", "avif"]);

/**
 * 一个媒体项的**原图地址**：后端给了 URL 就用它（安卓 SAF 走 `vaultfs://`），
 * 否则把磁盘路径交给 asset 协议（桌面）。
 *
 * 这里是**唯一**决定"用哪条通道看照片"的地方 —— 界面上别处只管拿这个字符串。
 */
export function originalSrc(item: MediaItem): string | null {
  if (item.url) return item.url;
  return item.originalPath ? assetUrl(item.originalPath) : null;
}

/**
 * 这个媒体能不能直接丢给 <img>：有缩略图就用缩略图（快），否则看格式。
 * 返回 null = 显示不了，界面要给占位和说明，别丢一个碎图给用户。
 *
 * 缩略图永远落在**应用数据目录**（真文件系统），所以它一直走 asset 协议。
 */
export function displayableSrc(item: MediaItem): string | null {
  if (item.thumbPath) return assetUrl(item.thumbPath);
  if (item.mime.startsWith("video/")) return null;
  return WEBVIEW_IMAGE_EXTS.has(item.ext) ? originalSrc(item) : null;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function formatTime(iso: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("zh-CN", { dateStyle: "medium", timeStyle: "short" });
}

/** 只显示日期（卡片角上那种） */
export function formatDay(iso: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("zh-CN", { year: "numeric", month: "numeric", day: "numeric" });
}

/** 本地自然日 "YYYY-MM-DD"；解析不出来返回 null */
export function localDay(iso: string): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
