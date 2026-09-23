# 参考项目清单（学习用）

> 用途：后续自学时的参照物。**只看结构、接口设计和文档，不要复制代码**（许可证原因，见文末）。
> 每个条目写清楚：它是什么、跟 FrameVault 哪一节对应、值得看什么。

## 一、同栈同类（最该先看）

### Agaric —— Tauri 2 + React 19 + Rust 的 local-first 笔记/日记
- 仓库：https://github.com/jfolcini/agaric ｜ 许可证：**GPL-3.0**
- 平台：Linux / Windows / macOS / Android（和你的目标完全一致）
- 技术：SQLite + FTS5、Rust 后端、块级嵌套与拖动排序、局域网 P2P 同步
- **跟你的对应关系**：
  - 它的 **Spaces**（互相隔离的上下文，切换时日志/标签/最近项/链接解析一起换）≈ 你的 **Vault**
  - Journal-first（每日日志）= 你的影像日记
  - 拖动排序 / 置顶 / 面包屑 = 你 §13.2 的文件夹元数据
  - `docs/UX.md»、`docs/UI-MAP.md» = 你该建的前端结构文档
- **看什么**：仓库顶层结构、页面目录怎么切、Spaces 切换时重置哪些状态、排序命令的粒度。

### Spacedrive —— 跨端本地优先文件平台（Rust core + React）
- 仓库：https://github.com/spacedriveapp/spacedrive ｜ 许可证：**FSL-1.1-ALv2**
- 关键设计：BLAKE3 内容哈希去重、把 S3/Google Drive/Dropbox/OneDrive/Azure/GCS 做成**一等 volume**、九种视图、Iroh/QUIC P2P
- **跟你的对应关系**：§9 的 `StorageProvider» 抽象、§10 同步、§13 多视图（时间线/图库）
- **看什么**：`crates/» 怎么切、core 如何做到不依赖 UI、视图注册机制。

### Kunkun —— Tauri 做的可扩展启动器
- 仓库：https://github.com/kunkunsh/kunkun
- 关键点：**扩展默认跑在沙箱里**
- **跟你的对应关系**：§9 插件隔离、§11 权限模型
- **看什么**：扩展清单（manifest）字段、权限声明、宿主中介网络/存储的方式。

## 二、生产级 Tauri 2 + React 应用（学工程组织）

| 项目 | 是什么 | 看什么 |
|---|---|---|
| Yaak | API 客户端 | 命令怎么分组、TS 与 Rust 类型如何对齐 |
| Clash Verge Rev | 代理客户端（中文社区） | 多窗口/托盘/自动更新、i18n |
| Surrealist | SurrealDB 的 GUI | 大型前端的目录组织、状态管理选型 |

## 三、单点技术参考（按你的模块）

| 你的模块 | 参考 | 抄什么（思路） |
|---|---|---|
| StorageProvider（§9.1） | rclone（Go） | backend 统一接口 + 能力声明字段设计 |
| 同步冲突（§10.3） | Syncthing | `*.sync-conflict-日期-时间-设备.ext» 命名与保留策略 |
| 缩略图 / EXIF / 索引（M1） | PhotoPrism、Immich | 派生数据目录、任务队列、失败重试、进度上报 |
| 插件沙箱（§11.3） | Extism（WASM）、rquickjs | 用 WASM 做隔离；宿主提供受限 API |
| Android 相机插件（M2） | tauri-plugin-barcode-scanner | Kotlin 插件写法、权限声明、Rust↔Kotlin 桥 |
| 凭证安全存储（§9.3） | tauri-plugin-stronghold | 官方做法与权限配置 |
| 移动端适配 | Agaric、Spacedrive 的移动外壳 | 窄屏导航形态、安全区处理 |

## 四、Vault / 开放格式参考

| 项目 | 借鉴点 |
|---|---|
| Obsidian（闭源） | Vault 目录约定、插件生态设计（只学概念） |
| Logseq | 块模型、插件 API、图谱视图 |
| Foam / SilverBullet | Markdown 优先、文件即真相 |
| Anytype / AppFlowy / AFFiNE | 本地优先的多端数据模型与加密策略 |

## 五、抓文档的工具（帮你快速看别人怎么写）

- `deepwiki.com/<owner>/<repo>» —— 对仓库生成的结构化解读（我查 PhotoPrism 的媒体流水线时用的就是它）
- `repos.ecosyste.ms/topics/<topic>» —— 按 topic 找同类仓库
- `raw.githubusercontent.com/<owner>/<repo>/main/README.md» —— 直连某个文件

## 六、许可证红线（重要）

| 许可证 | 能不能抄代码进 Apache-2.0 项目 |
|---|---|
| MIT / Apache-2.0 / BSD | ✅ 可以（保留版权声明） |
| **GPL-3.0**（Agaric） | ❌ 绝对不行，会传染整个仓库 |
| **FSL-1.1-ALv2**（Spacedrive） | ❌ 不行（且带商用限制） |
| 未声明许可证 | ❌ 默认保留所有权利 |

**结论**：本清单里的项目**全部只用于读结构和设计**。要引入依赖，先在这一页登记它的许可证。

### 已引入依赖的许可证登记（本仓库真正在用的）

引入新依赖前先在这里登记（见 AGENTS §1）。当前装的是这些：

**Markdown 管线（解析 + 渲染，只在 `src/markdown/parse.ts` 与 `features/scene/markdown/` 里用）**：

| 包 | 版本 | 许可证 | 用途 |
|---|---|---|---|
| `unified` | 11.x | MIT | Markdown 管线骨架（只在 `src/markdown/parse.ts` 里用） |
| `remark-parse` | 11.x | MIT | CommonMark 解析 → mdast |
| `remark-gfm` | 4.x | MIT | GFM 扩展：表格 / 任务列表 / 删除线 / 自动链接 |

**编辑引擎（所见即所得，只在 `features/scene/markdown/` 里用 —— `MarkdownWysiwyg.tsx` + `livePreview.ts`，且按需加载）**：

| 包 | 版本 | 许可证 | 用途 |
|---|---|---|---|
| `@codemirror/state` | 6.7.5 | MIT | 编辑器状态 / 事务 / `StateField`（行级与块级装饰的唯一合法出处） |
| `@codemirror/view` | 6.43.12 | MIT | 视图层：`EditorView`、装饰、widget、`EditorView.theme` |
| `@codemirror/commands` | 6.11.1 | MIT | 默认键位、撤销栈（`history` / `historyKeymap` / `indentWithTab`） |
| `@codemirror/language` | 6.12.4 | MIT | 语法树访问（`syntaxTree`）—— 实时渲染按它找语法记号 |
| `@codemirror/lang-markdown` | 6.5.2 | MIT | Markdown 语言（`markdown()` / `markdownKeymap` / `pasteURLAsLink`） |
| `@lezer/markdown` | 1.7.2 | MIT | GFM 扩展语法（表格 / 任务列表 / 删除线） |

传递依赖 `@lezer/*`（`highlight` / `common` / `lr` / `highlighter-tags` 等）同为 MIT。
2026-09 换内核时撤下了 `@milkdown/kit`、`@milkdown/react` 与 prosemirror 家族，**`dompurify` 一并消失**
（它原本由 Milkdown 带入、用来清洗粘贴内容；现在文档就是 Markdown 文本、原始 HTML 不渲染，不需要清洗）。

2026-09 换内核后重跑 `pnpm licenses ls --prod`：**95 个包，全部 MIT / Apache-2.0（含双许可），没有 GPL / AGPL / LGPL / 未声明许可证的包，也没有 MPL 项**。已按上面的红线核对过，可以进这个仓库。

## 七、下一步想学的方向（按优先级）

1. **前端结构**：Agaric 的 `docs/UI-MAP.md» 与 Spacedrive 的视图注册 → 直接服务你现在的痛点
2. **Vault 与文件夹元数据**：Agaric 的 Spaces / 块排序
3. **媒体流水线**：PhotoPrism 的 Media Processing Pipeline
4. **同步与冲突**：Syncthing 的冲突文件策略
5. **插件沙箱**：Kunkun + Extism
