import { useEffect, useState } from "react";

/**
 * 视口够不够宽 —— 决定用哪套骨架。
 *
 * 这是**响应式**，不是平台分支：桌面用户把窗口拉窄也会进去，
 * 所以那套骨架必须能独立工作（不能依赖"只有触摸屏才有的事件"）。
 * 平台相关的判断一律在 `lib/platform.ts`（AGENTS §2）。
 *
 * **两个阈值（滞后 / hysteresis）**：窄到 640 才切手机骨架，宽到 680 才切回桌面骨架。
 * 中间 40px 是"死区"——状态保持不变。
 * 为什么必须这样：单阈值时，如果窗口恰好停在 640，一次一像素的抖动就会让
 * 两套骨架反复互切，整个界面（连图片尺寸）跟着来回跳。
 */
export function useCompact(maxWidth = 640, releaseWidth = 680): boolean {
  const narrowQuery = `(max-width: ${maxWidth}px)`;
  const wideQuery = `(min-width: ${releaseWidth}px)`;

  const [compact, setCompact] = useState(
    () => typeof window !== "undefined" && window.matchMedia(narrowQuery).matches,
  );

  useEffect(() => {
    const narrow = window.matchMedia(narrowQuery);
    const wide = window.matchMedia(wideQuery);

    // 只在"跨过自己的阈值"时才动，死区内谁都不改
    const sync = () => {
      if (narrow.matches) setCompact(true);
      else if (wide.matches) setCompact(false);
    };

    sync();
    narrow.addEventListener("change", sync);
    wide.addEventListener("change", sync);
    return () => {
      narrow.removeEventListener("change", sync);
      wide.removeEventListener("change", sync);
    };
  }, [narrowQuery, wideQuery]);

  return compact;
}
