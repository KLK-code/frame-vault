import { useCallback, useEffect, useState } from "react";
import { DEFAULT_APPEARANCE } from "./presets";
import { onThemeChange, publishTheme, readStoredTheme } from "./themeSync";

/**
 * 外观预设（骨架用）：**用户选一套，没选过就是默认那套（极简白）**。
 *
 * 2026-09 起不再有"场景推荐配色"——场景只决定怎么排版，不决定配色（AGENTS §6）。
 * 只有**主骨架**会重算"生效值"并广播；用户的选择可能是在设置窗口改的，所以这里要订阅事件。
 */
export function useAppearance() {
  const [choice, setChoice] = useState(() => readStoredTheme().appearance);
  const applied = choice || DEFAULT_APPEARANCE;

  // 别处（设置窗口）改了"用户的选择" → 收进来，逼着重算生效值
  useEffect(
    () =>
      onThemeChange((payload) => {
        setChoice((prev) => (payload.appearance === prev ? prev : payload.appearance));
      }),
    [],
  );

  // 生效值变了就广播；只写 applied 这一项，不去碰覆盖与配色模式
  useEffect(() => {
    publishTheme({ applied });
  }, [applied]);

  return { choice, setChoice, applied };
}

/** 设置窗口用：只改"用户的选择"；生效值先乐观跟上，主骨架随后广播权威值 */
export function useAppearanceChoice() {
  const [choice, setChoice] = useState(() => readStoredTheme().appearance);

  useEffect(
    () =>
      onThemeChange((payload) => {
        setChoice((prev) => (payload.appearance === prev ? prev : payload.appearance));
      }),
    [],
  );

  const setChoiceAndPublish = useCallback((id: string) => {
    setChoice(id);
    publishTheme({ appearance: id, applied: id || DEFAULT_APPEARANCE });
  }, []);

  return { choice, setChoice: setChoiceAndPublish };
}
