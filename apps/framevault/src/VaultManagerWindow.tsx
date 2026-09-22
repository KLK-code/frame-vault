import { useEffect } from "react";
import { closeVaultManager } from "./lib/api";
import VaultManagerPage from "./pages/VaultManagerPage";
import "./VaultManagerWindow.css";

export default function VaultManagerWindow() {
  // Esc 关闭窗口（走 Rust 命令，不受 capabilities 限制）
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") closeVaultManager();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <main className="manager-window">
      <div className="manager-window__bar">
        <span>独立窗口 · 按 Esc 或点右侧按钮关闭</span>
        <button onClick={() => closeVaultManager()}>关闭窗口</button>
      </div>

      <div className="manager-window__body">
        <VaultManagerPage />
      </div>
    </main>
  );
}

