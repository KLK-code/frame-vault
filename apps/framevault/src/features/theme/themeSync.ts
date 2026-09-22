import { emit, listen } from "@tauri-apps/api/event";

/**
 * 主题需要跨窗口同步：每个 Tauri 窗口都是**独立的 document**，
 * 在设置窗口里写 documentElement 的样式，主窗口不会知道。
 * 所以：本地立即生效 + 存 localStorage + 用 Tauri 事件广播给其它窗口。
 */
const OVERRIDES_KEY = "fv.themeOverrides";
const SCHEME_KEY = "fv.colorScheme";
const APPEARANCE_KEY = "fv.appearance";
const APPLIED_KEY = "fv.appearanceApplied";

export const THEME_EVENT = "theme://changed";

export type ColorScheme = "system" | "light" | "dark";

export type ThemePayload = {
  overrides: Record<string, string>;
  scheme: ColorScheme;
  /** 用户选的外观预设；空串 = 跟随当前主题的推荐 */
  appearance: string;
  /** 实际生效的预设：由主骨架算出来并广播，其它窗口直接跟 */
  applied: string;
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

function applyAppearance(id: string) {
  const root = document.documentElement;
  if (id) root.dataset.appearance = id;
  else delete root.dataset.appearance;
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
  const appearance = localStorage.getItem(APPEARANCE_KEY) ?? "";
  const applied = localStorage.getItem(APPLIED_KEY) ?? "";
  return { overrides, scheme, appearance, applied };
}

export function applyTheme(payload: ThemePayload) {
  applyOverrides(payload.overrides ?? {});
  applyScheme(payload.scheme ?? "system");
  // 生效值优先：主骨架算出来的那个是权威
  applyAppearance(payload.applied || payload.appearance || "");
}

export function publishTheme(payload: ThemePayload) {
  applyTheme(payload); // 本窗口立即生效
  localStorage.setItem(OVERRIDES_KEY, JSON.stringify(payload.overrides));
  localStorage.setItem(SCHEME_KEY, payload.scheme);
  localStorage.setItem(APPEARANCE_KEY, payload.appearance ?? "");
  // 只有主骨架会算出新的生效值；其它窗口原样带回，别把权威值覆盖掉
  localStorage.setItem(APPLIED_KEY, payload.applied || readStoredTheme().applied);
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
