import { useCallback, useEffect, useState } from "react";
import {
  publishTheme,
  readStoredTheme,
  type ColorScheme,
  type ThemePayload,
} from "./themeSync";

export type Overrides = Record<string, string>;

export type { ColorScheme };

/**
 * 实时主题覆盖（只在设置窗口里用）：
 * - 改动 → publishTheme：本窗口立即生效 + 存盘 + 广播给其它窗口
 * - 能导出成一段 CSS，粘回 tokens.css 就成了默认样式
 */
export function useThemeOverrides() {
  const [overrides, setOverrides] = useState<Overrides>(() => readStoredTheme().overrides);

  // 任何改动都广播出去，让主窗口 / 其它窗口跟着变
  useEffect(() => {
    publishTheme({ overrides, scheme: readStoredTheme().scheme });
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

/** 配色模式：同样要广播，否则主窗口不会跟着切深色 */
export function useColorScheme() {
  const [scheme, setScheme] = useState<ColorScheme>(() => readStoredTheme().scheme);

  useEffect(() => {
    const payload: ThemePayload = { overrides: readStoredTheme().overrides, scheme };
    publishTheme(payload);
  }, [scheme]);

  return { scheme, setScheme };
}
