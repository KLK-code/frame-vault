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
  /**
   * 这个字段是记录的**正文**：内容落磁盘上的 `note.md`，不进 `entry.json`。
   *
   * 一个主题最多一个。**没标就不落文件**（字段照旧存在 `entry.json` 里）——
   * 所以老主题、第三方主题不写这一行也不会丢数据，只是正文不是一个能直接打开的 `.md`。
   */
  note?: boolean;
  /**
   * 多行字段（`textarea`）**默认用哪种呈现**：
   * - `"live"`（不写就是它）：即时渲染 —— 语法符号藏着，写的当场就是排好的样子；
   * - `"source"`：源码模式 —— 符号全都露着（带语法高亮），适合要直接改 `**`、表格列宽的场合。
   *
   * 用户当场还能自己切（编辑器右上角那个按钮），这里给的只是默认值。
   * 纯展示偏好，不影响磁盘格式：两种模式写出去的都是同一串 Markdown。
   */
  editor?: "live" | "source";
};

export type SceneManifest = {
  /** 纯展示声明，宿主与侧栏共享，不包含组件或业务规则。 */
  presentation?: {
    icon: "book" | "mountain" | "bolt";
    // 这里**没有**"推荐外观"了（2026-09 拆掉）：场景只决定怎么排版，配色归用户自己选
  };
  /** 这个主题的记录上有什么字段（核心据此生成录入与展示） */
  entryFields?: FieldDecl[];
  /** 这个场景的设置表单形状（存在 folder.sceneConfig 里） */
  configSchema?: FieldDecl[];
  /**
   * 媒体导入时的**命名模板**（纯数据，像 `"{date}_{scene}_{n}"`）。
   *
   * 可用变量：`{date}`（拍摄日，缺则导入日）、`{scene}`（场景名）、`{title}`（记录标题）、
   * `{field:<key>}`（本主题声明的字段）、`{n}`（同目录内序号，两位）。
   * 取不到的变量自己消失；**不声明就走核心默认模板**，所以这行是可选的。
   */
  mediaNameTemplate?: string;
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

/**
 * 取一个声明字段的值。
 *
 * 正文（`note: true` 的那个）住在 `entry.note` 里（磁盘上是 `note.md`），
 * 其余字段在**本主题的命名空间**里 —— 调用方不用自己判断，两边都从这里走。
 */
export function fieldValue(entry: Entry, sceneId: string, field: FieldDecl): unknown {
  return field.note ? entry.note : readField(entry, sceneId, field.key);
}

/** 这个主题的正文声明（最多一个） */
export function noteFieldOf(fields: FieldDecl[] | undefined): FieldDecl | undefined {
  return (fields ?? []).find((field) => field.note === true);
}

/**
 * 写回一批字段：**只替换本主题的命名空间**，别的主题的字段原样保留
 * （`update_entry` 的 fields 是整体替换，所以这里要自己带上旧的）。
 *
 * 正文单独返回（它要落 `note.md`）；没出现在 `values` 里的字段**一律不动** ——
 * 表单只显示一部分字段时，不该把其余字段悄悄抹掉。
 */
export function writeValues(
  entry: Entry,
  sceneId: string,
  fields: FieldDecl[],
  values: Record<string, unknown>,
): { fields: Record<string, unknown>; note: string | undefined } {
  const scoped = entry.fields?.[sceneId];
  const namespace: Record<string, unknown> = {
    ...(typeof scoped === "object" && scoped !== null ? (scoped as Record<string, unknown>) : {}),
  };

  let note: string | undefined;
  for (const field of fields) {
    if (!(field.key in values)) continue;
    if (field.note) {
      note = fieldText(values[field.key]);
      continue;
    }
    namespace[field.key] = values[field.key];
  }

  return { fields: { ...entry.fields, [sceneId]: namespace }, note };
}

/** 字段值 → 输入框用的字符串（null / undefined / 数字都收敛成字符串） */
export function fieldText(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}
