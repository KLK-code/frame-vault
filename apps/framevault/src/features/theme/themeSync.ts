import { emit, listen } from "@tauri-apps/api/event";

/**
 * 主题需要跨窗口同步：每个 Tauri 窗口都是**独立的 document**，
 * 在设置窗口里写 documentElement 的样式，主窗口不会知道。
 *
 * 真相在 localStorage（同一 origin 共享），Tauri 事件只负责"叫醒别的窗口"。
 *
 * **一律用 patch 合并写**（只改想改的那几项），绝不要拿整份状态盖回去：
 * 主骨架每次重算外观都会写一次盘，整份盖回去就会把设置窗口刚改的变量冲掉。
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
  /** 实际生效的预设：**只有主骨架**会重算它 */
  applied: string;
};

/** 只想改其中几项时用它 —— 其余项从盘上取 */
export type ThemePatch = Partial<ThemePayload>;

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

/** 只把 patch 里的项写盘，返回合并后的完整状态 */
function writeStoredTheme(patch: ThemePatch): ThemePayload {
  const next: ThemePayload = { ...readStoredTheme(), ...patch };
  localStorage.setItem(OVERRIDES_KEY, JSON.stringify(next.overrides));
  localStorage.setItem(SCHEME_KEY, next.scheme);
  localStorage.setItem(APPEARANCE_KEY, next.appearance);
  localStorage.setItem(APPLIED_KEY, next.applied);
  return next;
}

/** 改一项 → 本窗口立即生效 + 合并写盘 + 把**完整快照**广播给其它窗口 */
export function publishTheme(patch: ThemePatch) {
  const next = writeStoredTheme(patch);
  applyTheme(next);
  void emit(THEME_EVENT, next).catch(() => {
    /* 不是 Tauri 环境（比如浏览器里跑 pnpm dev）时忽略 */
  });
}

/** 订阅其它窗口的改动；返回退订函数 */
export function onThemeChange(handler: (payload: ThemePayload) => void) {
  const pending = listen<ThemePayload>(THEME_EVENT, (event) => handler(event.payload));
  return () => {
    void pending.then((unlisten) => unlisten()).catch(() => {});
  };
}

/** 每个窗口启动时调一次：先应用已存的，再订阅其它窗口的改动 */
export function initTheme() {
  applyTheme(readStoredTheme());
  return onThemeChange(applyTheme);
}
