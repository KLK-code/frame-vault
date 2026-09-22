import { useEffect } from "react";
import TitleBar from "./app/TitleBar";
import VaultManagerPanel from "./features/vault/VaultManagerPanel";
import { closeVaultManager } from "./lib/api";
import "./VaultManagerWindow.css";

export default function VaultManagerWindow() {
  // 保留 Esc 关闭（没有 UI，纯快捷键）
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") closeVaultManager();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <main className="manager-window">
      <TitleBar title="管理仓库" />
      <div className="manager-window__body">
        <VaultManagerPanel />
      </div>
    </main>
  );
}
