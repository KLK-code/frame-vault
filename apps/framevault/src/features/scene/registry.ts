import type { ComponentType } from "react";
import type { FolderNode, SceneInfo } from "../../lib/api";
import ChallengeScene from "./scenes/challenge/ChallengeScene";
import PlainScene from "./scenes/plain/PlainScene";

/** 主题视图拿到的原料：场景本身 + 它的主题信息 + 写回自己配置的通道 */
export type SceneViewProps = {
  folder: FolderNode;
  scene: SceneInfo;
  /** 主题要写自己的 sceneConfig 时走这里（Rust 落盘后返回新的场景列表） */
  onSceneConfigChange: (config: Record<string, unknown>) => Promise<boolean>;
};

/**
 * 主题 id → 视图组件。
 *
 * 这就是"可扩展"的入口：新增一个主题 = 写一个组件 + 在这里登记一行，
 * 核心（Rust 的 schema、记录格式）完全不用动。
 * 将来主题以包的形式分发时，这里是动态注册点。
 *
 * Rust 侧 `builtin_scenes()` 也要登记同一个 id；两边只缺一边时界面会显示
 * "主题没有安装"的兜底提示，而不是白屏。
 */
export const SCENE_VIEWS: Record<string, ComponentType<SceneViewProps>> = {
  "builtin.plain": PlainScene,
  "builtin.challenge": ChallengeScene,
};
