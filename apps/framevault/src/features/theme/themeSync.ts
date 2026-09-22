import { emit, listen } from "@tauri-apps/api/event";

/**
 * 主题需要跨窗口同步：每个 Tauri 窗口都是**独立的 document**，
 * 在设置窗口里写 documentElement 的样式，主窗口不会知道。
 * 所以：本地立即生效 + 存 localStorage + 用 Tauri 事件广播给其它窗口。
 */
const OVERRIDES_KEY = "fv.themeOverrides";
const SCHEME_KEY = "fv.colorScheme";

export const THEME_EVENT = "theme://changed";

export type ColorScheme = "system" | "light" | "dark";

export type ThemePayload = {
  overrides: Record<string, string>;
  scheme: ColorScheme;
};

/** 本窗口已经应用过的变量名，用于"取消覆盖"时清掉内联样式 */
let appliedKeys: string[] = [];

function applyOverrides(next: Record<string, string>) {
  const root = document.documentElement;

  for (const key of appliedKeys) {
    if (!(key in next)) root.style.removeProperty(key);
  }
  for (const [key, value] of Object.entries(next)) {
    root.style.setProperty(key, value);
  }

  appliedKeys = Object.keys(next);
}

let schemeMedia: MediaQueryList | null = null;
let currentScheme: ColorScheme = "system";

function paintScheme() {
  const root = document.documentElement;
  const dark =
    currentScheme === "dark" || (currentScheme === "system" && !!schemeMedia?.matches);

  if (dark) root.dataset.theme = "dark";
  else delete root.dataset.theme;
}

function applyScheme(scheme: ColorScheme) {
  currentScheme = scheme;

  if (!schemeMedia) {
    schemeMedia = window.matchMedia("(prefers-color-scheme: dark)");
    schemeMedia.addEventListener("change", paintScheme);
  }

  paintScheme();
}

export function readStoredTheme(): ThemePayload {
  let overrides: Record<string, string> = {};
  try {
    const raw = localStorage.getItem(OVERRIDES_KEY);
    if (raw) overrides = JSON.parse(raw) as Record<string, string>;
  } catch {
    overrides = {}; // 坏数据就当没有
  }

  const scheme = (localStorage.getItem(SCHEME_KEY) as ColorScheme | null) ?? "system";
  return { overrides, scheme };
}

export function applyTheme(payload: ThemePayload) {
  applyOverrides(payload.overrides ?? {});
  applyScheme(payload.scheme ?? "system");
}

export function publishTheme(payload: ThemePayload) {
  applyTheme(payload); // 本窗口立即生效
  localStorage.setItem(OVERRIDES_KEY, JSON.stringify(payload.overrides));
  localStorage.setItem(SCHEME_KEY, payload.scheme);
  void emit(THEME_EVENT, payload).catch(() => {
    /* 不是 Tauri 环境（比如浏览器里跑 pnpm dev）时忽略 */
  });
}

/** 每个窗口启动时调一次：先应用已存的，再订阅其它窗口的改动 */
export function initTheme() {
  applyTheme(readStoredTheme());

  const pending = listen<ThemePayload>(THEME_EVENT, (event) => {
    applyTheme(event.payload);
  });

  return () => {
    void pending.then((unlisten) => unlisten()).catch(() => {});
  };
}
