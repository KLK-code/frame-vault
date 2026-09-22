import type { ComponentType } from "react";
import AppearanceSection from "./sections/AppearanceSection";
import PlaceholderSection, { type Item } from "./sections/PlaceholderSection";

export type SettingsSection = {
  id: string;
  label: string;
  Section: ComponentType;
};

const VAULT_ITEMS: Item[] = [
  { id: "vault.defaultLocation", label: "设置默认 Vault 位置…" },
  { id: "vault.rebuildIndex", label: "重建索引" },
];

const MEDIA_ITEMS: Item[] = [
  { id: "cache.clearThumbnails", label: "清理缩略图缓存…" },
  { id: "cache.openAppData", label: "打开应用数据目录" },
];

const SYNC_ITEMS: Item[] = [
  { id: "sync.addBackend", label: "添加同步后端…", hint: "M4" },
  { id: "sync.now", label: "立即同步" },
];

const PLUGIN_ITEMS: Item[] = [
  { id: "plugin.install", label: "安装插件…", hint: "M5" },
  { id: "plugin.openFolder", label: "打开插件目录" },
];

const ABOUT_ITEMS: Item[] = [
  { id: "about.version", label: "版本信息" },
  { id: "about.logs", label: "查看日志…" },
];

export const SETTINGS_SECTIONS: SettingsSection[] = [
  { id: "appearance", label: "外观", Section: AppearanceSection },
  { id: "vault", label: "Vault", Section: () => <PlaceholderSection items={VAULT_ITEMS} /> },
  { id: "media", label: "媒体与缓存", Section: () => <PlaceholderSection items={MEDIA_ITEMS} /> },
  { id: "sync", label: "同步", Section: () => <PlaceholderSection items={SYNC_ITEMS} /> },
  { id: "plugins", label: "插件与主题包", Section: () => <PlaceholderSection items={PLUGIN_ITEMS} /> },
  { id: "about", label: "关于", Section: () => <PlaceholderSection items={ABOUT_ITEMS} /> },
];
