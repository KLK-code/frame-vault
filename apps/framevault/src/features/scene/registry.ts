import type { ComponentType } from "react";
import type { FolderNode, SceneInfo } from "../../lib/api";
import PlainScene from "./scenes/plain/PlainScene";

/** 主题视图拿到的原料：场景本身 + 它的主题信息 */
export type SceneViewProps = {
  folder: FolderNode;
  scene: SceneInfo;
};

/**
 * 主题 id → 视图组件。
 *
 * 这就是"可扩展"的入口：新增一个主题 = 写一个组件 + 在这里登记一行，
 * 核心（Rust 的 schema、记录格式）完全不用动。
 * 将来主题以包的形式分发时，这里是动态注册点。
 */
export const SCENE_VIEWS: Record<string, ComponentType<SceneViewProps>> = {
  "builtin.plain": PlainScene,
};
