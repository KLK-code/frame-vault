import { useState } from "react";
import "./SettingsPanel.css";

type Item = {
  /** 将来的接口名，先用它做占位反馈 */
  id: string;
  label: string;
  /** 计划在哪个里程碑实现 */
  hint?: string;
};

const GROUPS: { title: string; items: Item[] }[] = [
  {
    title: "外观",
    items: [
      { id: "theme.choose", label: "选择外观主题…", hint: "M3" },
      { id: "theme.followSystem", label: "跟随系统深色模式", hint: "M3" },
    ],
  },
  {
    title: "Vault",
    items: [
      { id: "vault.defaultLocation", label: "设置默认 Vault 位置…" },
      { id: "vault.rebuildIndex", label: "重建索引" },
    ],
  },
  {
    title: "媒体与缓存",
    items: [
      { id: "cache.clearThumbnails", label: "清理缩略图缓存…" },
      { id: "cache.openAppData", label: "打开应用数据目录" },
    ],
  },
  {
    title: "同步",
    items: [
      { id: "sync.addBackend", label: "添加同步后端…", hint: "M4" },
      { id: "sync.now", label: "立即同步" },
    ],
  },
  {
    title: "插件与主题包",
    items: [
      { id: "plugin.install", label: "安装插件…", hint: "M5" },
      { id: "plugin.openFolder", label: "打开插件目录" },
    ],
  },
  {
    title: "关于",
    items: [
      { id: "about.version", label: "版本信息" },
      { id: "about.logs", label: "查看日志…" },
    ],
  },
];

export default function SettingsPanel() {
  const [status, setStatus] = useState("");

  function handle(item: Item) {
    // TODO: 将来换成真正的 Tauri 命令调用，例如 invoke(item.id, ...)
    setStatus(`「${item.label}」还没实现（接口占位：${item.id}）`);
  }

  return (
    <>
      <h1 className="settings__title">设置</h1>

      {GROUPS.map((group) => (
        <section className="settings__group" key={group.title}>
          <h2>{group.title}</h2>

          <div className="settings__rows">
            {group.items.map((item) => (
              <button key={item.id} className="settings__row" onClick={() => handle(item)}>
                <span className="settings__label">{item.label}</span>
                {item.hint && <span className="settings__badge">{item.hint}</span>}
              </button>
            ))}
          </div>
        </section>
      ))}

      <p className="settings__status">{status}</p>
    </>
  );
}
