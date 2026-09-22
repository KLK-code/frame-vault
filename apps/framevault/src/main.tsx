import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./styles/layers.css"; // 必须最先导入：声明层顺序
import "./styles/reset.css";
import "./styles/compact.css"; // 窄屏横切调整（触摸目标 / 安全区 / 面板堆叠）
import "./tokens.css";
import "./skins.css";
import App from "./App";
import VaultManagerWindow from "./app/VaultManagerWindow";
import SettingsWindow from "./app/SettingsWindow";
import { initTheme } from "./features/theme/themeSync";
import { isMacOS } from "./lib/platform";

// 每个窗口启动时先把已存的主题应用上，并订阅其它窗口的改动
initTheme();

// 让 CSS 知道系统：macOS 的顶栏要给系统原生红黄绿让出位置（见 app/TitleBar.css）。
// 打在整个 document 上而不是某个组件上，是因为三个窗口共用同一份顶栏。
document.documentElement.dataset.os = isMacOS ? "macos" : "other";

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
