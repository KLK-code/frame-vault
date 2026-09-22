import { useCallback, useEffect, useState } from "react";
import { DEFAULT_APPEARANCE } from "./presets";
import { publishTheme, readStoredTheme } from "./themeSync";

/**
 * 外观预设（骨架用）：用户选过就听用户，没选过就听当前主题的推荐。
 *
 * 算出来的"生效值"随主题一起广播 —— 于是设置窗口、仓库窗口跟主窗口长得一样，
 * 不会出现"主窗口是炭火、设置窗口还是默认"的怪事。
 */
export function useAppearance(suggested?: string) {
  const [choice, setChoice] = useState(() => readStoredTheme().appearance);
  const applied = choice || suggested || DEFAULT_APPEARANCE;

  useEffect(() => {
    publishTheme({ ...readStoredTheme(), appearance: choice, applied });
  }, [choice, applied]);

  return { choice, setChoice, applied };
}

/** 设置窗口用：只改"用户的选择"，生效值沿用主窗口广播过来的那个 */
export function useAppearanceChoice() {
  const [choice, setChoice] = useState(() => readStoredTheme().appearance);

  const setChoiceAndPublish = useCallback((id: string) => {
    setChoice(id);
    publishTheme({ ...readStoredTheme(), appearance: id });
  }, []);

  return { choice, setChoice: setChoiceAndPublish };
}
