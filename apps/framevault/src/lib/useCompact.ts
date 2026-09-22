import { useEffect, useState } from "react";

/**
 * 视口够不够宽 —— 决定用哪套骨架。
 *
 * 这是**响应式**，不是平台分支：桌面用户把窗口拉窄也会进去，
 * 所以那套骨架必须能独立工作（不能依赖"只有触摸屏才有的事件"）。
 * 平台相关的判断一律在 `lib/platform.ts`（AGENTS §2）。
 */
export function useCompact(maxWidth = 640): boolean {
  const query = `(max-width: ${maxWidth}px)`;
  const [compact, setCompact] = useState(
    () => typeof window !== "undefined" && window.matchMedia(query).matches,
  );

  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setCompact(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return compact;
}
