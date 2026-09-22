import { useCallback, useEffect, useRef, useState } from "react";

const STORAGE_KEY = "fv.themeOverrides";
const SCHEME_KEY = "fv.colorScheme";

export type Overrides = Record<string, string>;

function readOverrides(): Overrides {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Overrides) : {};
  } catch {
    return {};
  }
}

/**
 * 实时主题覆盖：
 * - 写进 documentElement 的内联样式 = 最强的一层（相当于 CSS 里的 user 层）
 * - 存 localStorage（属于"视图 / 偏好"类状态，不进 Vault；见架构文档 §14）
 * - 能导出成一段 CSS，粘回 tokens.css 就成了默认样式
 */
export function useThemeOverrides() {
  const [overrides, setOverrides] = useState<Overrides>(readOverrides);
  const applied = useRef<string[]>([]);

  useEffect(() => {
    const root = document.documentElement;

    for (const key of applied.current) {
      if (!(key in overrides)) root.style.removeProperty(key);
    }
    for (const [key, value] of Object.entries(overrides)) {
      root.style.setProperty(key, value);
    }

    applied.current = Object.keys(overrides);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
  }, [overrides]);

  const set = useCallback((key: string, value: string) => {
    setOverrides((prev) => ({ ...prev, [key]: value }));
  }, []);

  const resetOne = useCallback((key: string) => {
    setOverrides((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  const reset = useCallback(() => setOverrides({}), []);

  const exportCss = useCallback(() => {
    const lines = Object.keys(overrides)
      .sort()
      .map((k) => `    ${k}: ${overrides[k]};`);
    if (lines.length === 0) return "/* 还没有做过任何覆盖 */\n";
    return [
      "/* FrameVault 外观覆盖 —— 从设置界面导出，粘回 src/tokens.css 的 :root 即成为默认样式 */",
      "  :root {",
      ...lines,
      "  }",
      "",
    ].join("\n");
  }, [overrides]);

  return { overrides, set, reset, resetOne, exportCss };
}

export type ColorScheme = "system" | "light" | "dark";

/** 浅色 / 深色 / 跟随系统：通过 html[data-theme="dark"] 切换 tokens 里的那组覆盖 */
export function useColorScheme() {
  const [scheme, setScheme] = useState<ColorScheme>(
    () => (localStorage.getItem(SCHEME_KEY) as ColorScheme | null) ?? "system",
  );

  useEffect(() => {
    const root = document.documentElement;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");

    function apply() {
      const dark = scheme === "dark" || (scheme === "system" && mql.matches);
      if (dark) root.dataset.theme = "dark";
      else delete root.dataset.theme;
    }

    apply();
    localStorage.setItem(SCHEME_KEY, scheme);

    if (scheme === "system") {
      mql.addEventListener("change", apply);
      return () => mql.removeEventListener("change", apply);
    }
    return undefined;
  }, [scheme]);

  return { scheme, setScheme };
}
