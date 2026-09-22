import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./styles/layers.css"; // 必须最先导入：声明层顺序
import "./styles/reset.css";
import "./tokens.css";
import App from "./App";
import VaultManagerWindow from "./app/VaultManagerWindow";
import SettingsWindow from "./app/SettingsWindow";

// 同一份前端产物，多个窗口：用窗口 label 区分（不经过 URL，不会被编码搞坏）
const label = getCurrentWindow().label;

function pickWindow() {
  if (label === "vault-manager") return <VaultManagerWindow />;
  if (label === "settings") return <SettingsWindow />;
  return <App />;
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>{pickWindow()}</React.StrictMode>,
);
