import type { ComponentType, ReactNode } from "react";
import AppearanceSection from "./sections/AppearanceSection";
import PlaceholderSection, { type Item } from "./sections/PlaceholderSection";

export type SettingsSection = {
  id: string;
  label: string;
  icon: ReactNode;
  Section: ComponentType;
};

/* 16×16、stroke 跟随 currentColor 的极简图标（不引图标库） */
const IconAppearance = (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
    <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.4" />
    <path d="M8 2a6 6 0 0 1 0 12z" fill="currentColor" />
  </svg>
);

const IconVault = (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
    <ellipse cx="8" cy="4.2" rx="5" ry="2.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
    <path
      d="M3 4.2v7.6c0 1.2 2.2 2.2 5 2.2s5-1 5-2.2V4.2"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
    />
  </svg>
);

const IconMedia = (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
    <rect x="2" y="3" width="12" height="10" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.4" />
    <circle cx="6" cy="7" r="1.2" fill="currentColor" />
    <path d="M3 12.5L7 9l5 4" fill="none" stroke="currentColor" strokeWidth="1.4" />
  </svg>
);

const IconSync = (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
    <path
      d="M3 6h8l-2.2-2.2M13 10H5l2.2 2.2"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
    />
  </svg>
);

const IconPlugins = (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
    <rect x="2" y="2" width="5" height="5" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
    <rect x="9" y="2" width="5" height="5" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
    <rect x="2" y="9" width="5" height="5" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
    <rect x="9" y="9" width="5" height="5" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
  </svg>
);

const IconAbout = (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
    <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.4" />
    <path d="M8 7.2v4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    <circle cx="8" cy="4.9" r="0.9" fill="currentColor" />
  </svg>
);

const VAULT_ITEMS: Item[] = [
  {
    id: "vault.defaultLocation",
    label: "默认 Vault 位置",
    desc: "新建 Vault 时默认放在哪里",
    action: "选择…",
  },
  { id: "vault.rebuildIndex", label: "重建索引", desc: "删除 SQLite 索引并按 Vault 重新扫描", action: "重建" },
];

const MEDIA_ITEMS: Item[] = [
  { id: "cache.clearThumbnails", label: "清理缩略图缓存", desc: "不会影响 Vault 里的原图", action: "清理" },
  { id: "cache.openAppData", label: "应用数据目录", desc: "索引、缩略图、仓库列表都放在这里", action: "打开" },
];

const SYNC_ITEMS: Item[] = [
  { id: "sync.addBackend", label: "添加同步后端", desc: "WebDAV、坚果云、S3 等（M4）", action: "添加…" },
  { id: "sync.now", label: "立即同步", desc: "把本地改动推到远端并拉取变化", action: "同步" },
];

const PLUGIN_ITEMS: Item[] = [
  { id: "plugin.install", label: "安装插件", desc: "从 ZIP / 目录 / 自定义源安装（M5）", action: "安装…" },
  { id: "plugin.openFolder", label: "插件目录", desc: "存放已安装插件的地方", action: "打开" },
];

const ABOUT_ITEMS: Item[] = [
  { id: "about.version", label: "版本信息", desc: "FrameVault 0.1.0 · Vault schemaVersion 1", action: "查看" },
  { id: "about.logs", label: "运行日志", desc: "出问题时把日志贴给开发者", action: "查看…" },
];

export const SETTINGS_SECTIONS: SettingsSection[] = [
  { id: "appearance", label: "外观", icon: IconAppearance, Section: AppearanceSection },
  { id: "vault", label: "Vault", icon: IconVault, Section: () => <PlaceholderSection items={VAULT_ITEMS} /> },
  { id: "media", label: "媒体与缓存", icon: IconMedia, Section: () => <PlaceholderSection items={MEDIA_ITEMS} /> },
  { id: "sync", label: "同步", icon: IconSync, Section: () => <PlaceholderSection items={SYNC_ITEMS} /> },
  { id: "plugins", label: "插件与主题包", icon: IconPlugins, Section: () => <PlaceholderSection items={PLUGIN_ITEMS} /> },
  { id: "about", label: "关于", icon: IconAbout, Section: () => <PlaceholderSection items={ABOUT_ITEMS} /> },
];
