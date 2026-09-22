import type { ComponentType } from "react";
import type { Entry, FolderNode, SceneInfo } from "../../lib/api";

/**
 * 主题（场景）的**声明**。
 *
 * 三条刻意的约束：
 * 1. **纯数据**——没有函数、没有 React，将来把它整块搬进 `manifest.json`、由 Rust 读，成本是零；
 * 2. 主题**只声明"我要什么"**，怎么渲染由核心提供（见 `SceneFields`）——
 *    所以第三方主题不用重写一遍设置表单与录入表单；
 * 3. 核心不认识的东西一律进 `entry.fields` / `folder.sceneConfig`，天然前向兼容。
 *
 * 现在只有两项（字段与配置）。将来会长出 `views`（主题自己的多视图）、`needs`（权限声明）——
 * 那时候主题包自带清单，Rust 也来读同一份。
 */
export type FieldType = "text" | "textarea" | "number" | "date" | "bool" | "select";

export type FieldOption = { value: string; label: string };

export type FieldDecl = {
  key: string;
  label: string;
  type: FieldType;
  /** number 的单位（km / 分钟），只影响展示 */
  unit?: string;
  placeholder?: string;
  /** type 为 select 时的可选项 */
  options?: FieldOption[];
};

export type SceneManifest = {
  /** 纯展示声明，宿主与侧栏共享，不包含组件或业务规则。 */
  presentation?: {
    icon: "book" | "mountain" | "bolt";
    eyebrow: string;
    subtitle: string;
    signature: string;
    motto: string;
  };
  /** 这个主题的记录上有什么字段（核心据此生成录入与展示） */
  entryFields?: FieldDecl[];
  /** 这个场景的设置表单形状（存在 folder.sceneConfig 里） */
  configSchema?: FieldDecl[];
};

/** 主题视图拿到的原料：场景本身 + 主题信息 + 写回自己配置的通道 */
export type SceneViewProps = {
  folder: FolderNode;
  scene: SceneInfo;
  onSceneConfigChange: (config: Record<string, unknown>) => Promise<boolean>;
};

/** 一个主题单元 = 声明 + 视图。主题目录就是围绕它组织的，将来整包分发也是它 */
export type SceneUnit = {
  manifest: SceneManifest;
  View: ComponentType<SceneViewProps>;
};

/**
 * 读一条记录里属于某个主题的字段。
 *
 * 字段按**主题 id 命名空间**存放（`fields["builtin.plain"].text`），两个主题各写各的 key 不会打架。
 * 早期数据直接把字段写在 `fields` 顶层，这里做一次兼容读取——不用迁移老记录也能继续用。
 */
export function readField(entry: Entry, sceneId: string, key: string): unknown {
  const scoped = entry.fields?.[sceneId];
  if (scoped && typeof scoped === "object" && !Array.isArray(scoped)) {
    return (scoped as Record<string, unknown>)[key];
  }
  return entry.fields?.[key];
}

/** 写回：**只替换本主题的命名空间**，别的主题的字段原样保留（update_entry 的 fields 是整体替换） */
export function writeFields(
  entry: Entry,
  sceneId: string,
  values: Record<string, unknown>,
): Record<string, unknown> {
  return { ...entry.fields, [sceneId]: values };
}

/** 字段值 → 输入框用的字符串（null / undefined / 数字都收敛成字符串） */
export function fieldText(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}
