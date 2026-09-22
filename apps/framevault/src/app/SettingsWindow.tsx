import { useEffect } from "react";
import TitleBar from "./TitleBar";
import SettingsPanel from "../features/settings/SettingsPanel";
import { closeSettings } from "../lib/api";
import "./window.css";

export default function SettingsWindow() {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") closeSettings();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <main className="window">
      <TitleBar title="设置" />
      <div className="window__body">
        <SettingsPanel />
      </div>
    </main>
  );
}
