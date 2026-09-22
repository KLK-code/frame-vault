import { useState } from "react";
import { SETTINGS_SECTIONS } from "./settingsSections";
import "./SettingsPanel.css";

export default function SettingsPanel() {
  const [activeId, setActiveId] = useState(SETTINGS_SECTIONS[0].id);
  const [query, setQuery] = useState("");

  const keyword = query.trim().toLowerCase();
  const visible = SETTINGS_SECTIONS.filter((s) => s.label.toLowerCase().includes(keyword));

  const active = SETTINGS_SECTIONS.find((s) => s.id === activeId) ?? SETTINGS_SECTIONS[0];
  const ActiveSection = active.Section;

  return (
    <div className="settings">
      <nav className="settings__nav">
        <input
          className="settings__search"
          placeholder="搜索设置…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />

        <div className="settings__list">
          {visible.length === 0 ? (
            <span className="settings__nav-empty">没有匹配的设置</span>
          ) : (
            visible.map((section) => (
              <button
                key={section.id}
                className={"settings__nav-item" + (section.id === activeId ? " is-active" : "")}
                onClick={() => setActiveId(section.id)}
              >
                <span className="settings__nav-icon">{section.icon}</span>
                {section.label}
              </button>
            ))
          )}
        </div>
      </nav>

      <section className="settings__content">
        <h1 className="settings__title">{active.label}</h1>
        <ActiveSection />
      </section>
    </div>
  );
}
