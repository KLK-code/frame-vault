import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./styles/reset.css";
import "./tokens.css";
import App from "./App";
import VaultManagerWindow from "./VaultManagerWindow";

// 同一份前端产物，两个窗口：用窗口 label 区分（不经过 URL，不会被编码搞坏）
const isManager = getCurrentWindow().label === "vault-manager";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {isManager ? <VaultManagerWindow /> : <App />}
  </React.StrictMode>,
);
