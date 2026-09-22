import { useState } from "react";
import { SETTINGS_SECTIONS } from "./settingsSections";
import "./SettingsPanel.css";

export default function SettingsPanel() {
  const [activeId, setActiveId] = useState(SETTINGS_SECTIONS[0].id);
  const active = SETTINGS_SECTIONS.find((s) => s.id === activeId) ?? SETTINGS_SECTIONS[0];
  const ActiveSection = active.Section;

  return (
    <div className="settings">
      <nav className="settings__nav">
        {SETTINGS_SECTIONS.map((section) => (
          <button
            key={section.id}
            className={"settings__nav-item" + (section.id === activeId ? " is-active" : "")}
            onClick={() => setActiveId(section.id)}
          >
            {section.label}
          </button>
        ))}
      </nav>

      <section className="settings__content">
        <h1 className="settings__title">{active.label}</h1>
        <ActiveSection />
      </section>
    </div>
  );
}
