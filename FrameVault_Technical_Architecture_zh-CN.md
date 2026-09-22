# FrameVault 技术栈与架构说明

> 文档版本：v0.2 Draft  
> 日期：2026-09-22  
> 对应 PRD：FrameVault PRD v0.2

## 1. 架构结论摘要

基于 FrameVault 当前最重要的长期目标——**系统相机体验、Obsidian 式插件/主题生态、跨端自由同步**——推荐基线技术路线为：

- **应用容器：Tauri 2**
- **前端语言：TypeScript**
- **前端框架：React + Vite**
- **样式与主题：CSS Variables + Design Tokens + CSS Cascade Layers**
- **本地核心/系统能力：Rust**
- **Android 原生桥：Kotlin（仅用于 Android 特有能力）**
- **插件语言：TypeScript/JavaScript**
- **本地索引：SQLite（只做索引/缓存/同步状态）**
- **Vault 数据：JSON + Markdown + 原始媒体文件**
- **同步协议层：StorageProvider + Sync Engine**
- **秘密凭证：Tauri Stronghold 或等价安全存储**
- **包管理与工作区：pnpm workspace**
- **代码托管：Gitee（公开仓库，Apache-2.0）**

核心思想：

> **Tauri/React 是 FrameVault 的宿主和 UI 实现，不是 FrameVault 数据规范本身。真正稳定的边界是 Vault Spec、Core API、Plugin API、CaptureProvider 与 StorageProvider。**

本次需求补充：当前先完成单窗口，内容以文件夹组织；文件夹绑定功能主题（Workspace Type），其下记录共同遵循一套视图、操作与业务规则。功能主题将成为插件主要扩展方向之一，与只负责配色、字体等的外观 Theme 分离。图库与 Markdown 阅读共享数据，用户手动顺序和置顶属于持久化用户数据。

## 2. 技术栈

### 2.1 前端

| 层 | 技术 | 作用 |
|---|---|---|
| Language | TypeScript | UI、插件 SDK、应用层类型 |
| Framework | React | 页面、组件、交互状态 |
| Bundler | Vite | 开发服务器、构建 |
| Styling | CSS Modules / scoped CSS + CSS Variables | UI 样式 |
| Theme | Design Tokens + CSS Custom Properties | 主题/皮肤扩展基础 |
| Package Manager | pnpm | JS/TS 依赖与 monorepo |

选择 React 的原因：生态成熟、TypeScript 支持完善、开源贡献者容易上手、第三方组件和测试工具丰富。React 不应渗透到 Core 协议层，因此未来更换 UI 框架不会破坏 Vault 或 Plugin API。

### 2.2 宿主与本地核心

| 层 | 技术 | 作用 |
|---|---|---|
| Cross-platform Host | Tauri 2 | Windows/macOS/Android 应用宿主 |
| Native Core | Rust | 文件、索引、同步、哈希、大文件流、权限边界 |
| Android Native | Kotlin | 系统相机、SAF、Android Activity/Intent 生命周期 |
| Local DB | SQLite | 索引、缓存元数据、同步状态、pending operation |
| Secret Storage | Tauri Stronghold | OAuth token、WebDAV 应用密码等 |

Tauri 2 官方允许 Android 插件使用 Kotlin（也可 Java）实现原生命令，并由 Rust/JavaScript 调用，这使系统相机和 Android Storage Access Framework 可以独立封装。

### 3.3 数据格式

用户数据：

- JSON：结构化元数据；
- Markdown：Entry 文本；
- JPG/PNG/HEIC：图片；
- MP4/MOV：视频；
- 未来扩展其他标准附件格式。

本机派生数据：

- SQLite 索引；
- 缩略图；
- 搜索缓存；
- provider sync cursor；
- pending capture；
- 插件缓存。

派生数据不得成为 Vault 唯一数据源。

## 4. 总体架构

```text
┌──────────────────────────────────────────────┐
│                 React / TypeScript           │
│ Folder · Gallery · Reader · Entry · Settings  │
└───────────────────────┬──────────────────────┘
                        │ Application API
┌───────────────────────▼──────────────────────┐
│              FrameVault Application Core     │
│ EntryService · MediaService · TemplateService│
│ PluginHost · ThemeManager · SyncCoordinator  │
└───────────┬──────────────┬──────────────┬────┘
            │              │              │
            │              │              │
     ┌──────▼─────┐ ┌──────▼──────┐ ┌────▼──────────┐
     │ Vault Core │ │ Capture API │ │ Plugin API    │
     └──────┬─────┘ └──────┬──────┘ └────┬──────────┘
            │              │              │
     ┌──────▼──────┐  ┌────▼────────┐  ┌──▼──────────┐
     │Storage Layer│  │Native Bridge│  │Sandbox/Worker│
     └──────┬──────┘  └────┬────────┘  └─────────────┘
            │              │
     ┌──────┼──────────┐   └── Android Kotlin
     │      │          │       System Camera / SAF
     ▼      ▼          ▼
   Local  WebDAV   Provider Plugins
           │
     ┌─────┼──────────────┐
     ▼     ▼              ▼
  Nutstore NAS      Baidu/Ali/S3/...
```

## 5. 模块边界

### 5.1 UI Layer

职责：

- 渲染界面；
- 响应用户操作；
- 维护短生命周期 UI 状态；
- 通过 Application API 调用业务能力。

禁止：

- 页面组件直接读写 Vault 文件；
- 页面组件直接访问 SQLite；
- 页面组件直接调用百度/阿里 API；
- 页面组件直接处理 Android Intent。

### 5.2 Application Core

包含：

- `FolderService`（规划：文件夹组织、主题绑定、顺序与置顶）
- `WorkspaceTypeRegistry`（规划：功能主题定义与视图注册）
- `EntryService`
- `MediaService`
- `TemplateService`
- `VaultService`
- `ThemeManager`
- `PluginHost`
- `SyncCoordinator`

作用是把 UI 意图转换成领域操作。

### 5.3 Vault Core

负责：

- 解析和验证 Vault schema；
- Entry/Media ID；
- revision；
- migration；
- tombstone；
- 原子元数据更新；
- 建立可重建索引所需的标准数据；
- 文件夹稳定标识、归属、功能主题绑定及其配置、排序与置顶的开放元数据；具体 schema 在实现前定稿。

Vault Core 不知道 React，也不应该知道具体网盘 API。

### 5.4 Native Bridge

只处理必须依赖平台能力的事情。

Android 初期：

- System Camera Intent；
- System Video Capture；
- Storage Access Framework；
- Photo Picker；
- URI 权限；
- Activity 生命周期恢复。

桌面端：

- 文件/目录选择；
- OS integration；
- 后续系统分享、通知等。

### 5.5 Plugin Host

插件只能通过 FrameVault Plugin API 获取能力。

不允许插件：

- 直接获得 `window.__TAURI__` 的无限访问；
- 直接访问 SQLite；
- 直接遍历用户全盘；
- 无权限声明任意发网络请求；
- 运行任意原生二进制。

### 5.6 单窗口外壳、功能主题与界面状态

以下为目标职责划分，不代表当前目录或组件已实现：

```text
main.tsx：挂载 React 根组件
  └─ App / AppShell：公共布局与跨组件协调
       ├─ FolderNavigation：文件夹选择、排序、置顶
       ├─ WorkspaceHost：解析当前文件夹的功能主题
       │    ├─ 内置普通记录主题：GalleryView / ReaderView
       │    └─ 后期功能主题插件：专门视图、命令与规则
       └─ Settings：软件设置界面
```

- `main.tsx` 保持挂载职责；页面/面板选择交给外壳和主题宿主，不把所有功能堆成根组件中的条件分支。
- 文件夹绑定功能主题，其下记录遵循该主题；不在每个 Entry 上重复配置一套主题。嵌套子文件夹是否覆盖主题尚未定案。
- 将选择、展示与面板状态分别表达，例如 `selectedFolderId`、`selectedEntryId`、`viewMode`、`settingsOpen`；这些名称是示意，不是固定 API。
- 组件局部状态由组件管理；跨区域使用的选择由共同父级或后续明确的状态层协调。无需为早期界面先引入全局状态框架。
- `viewMode` 属于当前功能主题提供的视图集合；普通记录主题提供图库与 Markdown 阅读，后期主题可增加专门视图，不把它永久限制为两个硬编码页面。
- 功能主题定义属于程序/插件能力；文件夹绑定、配置和业务进度属于持久化数据；当前选择、滚动和弹窗开关属于界面状态。
- 左侧是始终保留全局树还是进入主题后切换导航，图库的数据聚合范围、阅读记录选择流程均见 PRD §12，当前不锁定布局。
- 多窗口、浏览器式多标签与标签拖出窗口暂缓；当前按单窗口做好组件和职责边界。

## 6. 建议仓库结构

```text
frame-vault/
├── apps/
│   └── framevault/
│       ├── src/                  # React/TS UI
│       ├── public/
│       └── src-tauri/            # Tauri host
│           ├── src/
│           ├── capabilities/
│           └── gen/
│
├── packages/
│   ├── core-types/               # 与 UI 无关的 TS 类型定义
│   ├── plugin-api/               # Plugin API contracts
│   ├── plugin-sdk/               # 社区插件开发 SDK
│   ├── theme-sdk/                # Theme schema/tokens
│   └── vault-spec/               # JSON Schema / 文档
│
├── crates/
│   ├── framevault-core/          # Rust domain/core
│   ├── storage-core/             # StorageProvider traits
│   ├── sync-engine/              # Sync engine
│   ├── indexer/                  # SQLite/search/index
│   └── media-core/               # hash/metadata/thumbnail orchestration
│
├── plugins-native/
│   └── capture/                  # Tauri mobile plugin
│       └── android/              # Kotlin
│
├── docs/
│   ├── PRD.md
│   ├── ARCHITECTURE.md
│   ├── vault-spec/
│   └── adr/
│
├── pnpm-workspace.yaml
├── Cargo.toml                    # Rust workspace
├── LICENSE
└── README.md
```

初期可以不立即建立所有 crate/package，但目录边界应按这个方向演进。

## 7. Vault 规范

### 7.1 推荐目录

以下保留既有 Entry 存储单元示意，尚未体现文件夹组织与功能主题；它不是新版完整目录规范。真实文件夹与 Entry 的映射及迁移方式须按 PRD §12 定稿，不能据此实现仅按日期或平铺 Entry 的固定导航。

```text
MyVault/
├── vault.json
├── .framevault/
│   ├── migrations/
│   └── tombstones/
└── entries/
    └── 0199.../
        ├── entry.json
        ├── note.md
        └── media/
            ├── 0199....jpg
            └── 0199....mp4
```

### 7.2 `vault.json`

示例：

```json
{
  "schemaVersion": 1,
  "vaultId": "0199...",
  "createdAt": "2026-09-21T18:00:00+08:00",
  "name": "My FrameVault"
}
```

### 7.3 `entry.json`

```json
{
  "schemaVersion": 1,
  "id": "0199...",
  "revision": 7,
  "createdAt": "2026-09-21T18:00:00+08:00",
  "updatedAt": "2026-09-21T18:10:00+08:00",
  "title": "下午随记",
  "tags": ["生活"],
  "media": [
    {
      "id": "0199...",
      "type": "image",
      "path": "media/0199....jpg"
    }
  ]
}
```

### 7.4 ID 选择

推荐使用 **UUIDv7**：

- 全局稳定；
- 与路径、标题解耦；
- 带时间排序属性；
- 适合多设备离线创建。

外部 API 不应依赖 UUIDv7 的内部结构，只把它当 opaque ID。

### 7.5 文件夹组织与功能主题元数据（规划）

文件夹、功能主题和排序置顶的持久化数据应采用版本化 JSON 等开放格式；不只保存于 React 内存、浏览器本地存储或 SQLite。建议覆盖以下信息，字段名、文件名和组织方式尚未冻结：

| 数据 | 作用 |
|---|---|
| 稳定 Folder ID、名称、父级与 Entry 归属 | 表达用户文件夹组织；ID 不随名称或路径变化 |
| 功能主题 ID、配置版本及配置 | 标识该文件夹使用的功能主题与参数 |
| 子项目顺序、置顶信息 | 保存用户拖动与置顶意图，引用稳定 Folder/Entry ID |
| 功能主题业务数据 | 后期保存如挑战规则、本轮进度等，按主题命名空间和版本管理 |

存放于 `.framevault/` 中规范化元数据或文件夹旁侧元数据的方案均待定；任何方案都应可备份、迁移，并允许索引重建。排序不会通过强制重命名文件或依赖文件系统枚举顺序实现。

### 7.6 手动排序与置顶的写入边界

建议流程：UI 拖动/置顶意图 → Application API → Tauri command → Folder/Vault Core 校验并持久化 → 通知界面刷新。写入沿用临时文件与原子替换策略。

- 同级重排改变显示顺序；跨文件夹移动涉及归属乃至存储位置，不得共用语义不明的“排序”操作。
- 保存前校验 ID 的存在性、归属和重复，避免顺序元数据引用错误项目。
- 默认排序与目录重新扫描不得覆盖已有用户顺序；新增、删除、外部移动项目与顺序表的协调策略需在实现时明确。
- 置顶项目如何分组、组内是否独立排序、跨文件夹拖动，以及并发排序冲突的具体合并规则尚未定案。
- 后期挑战“违规清零”指重置本轮进度，不隐式删除 Entry 或原始媒体；规则判定、重启与历史保留见 PRD 待决项。

## 8. 相机架构

### 8.1 原则

FrameVault 不实现自己的成像 pipeline。Android 默认调用系统/厂商相机。

### 8.2 抽象接口

概念接口：

```ts
interface CaptureProvider {
  takePhoto(context: CaptureContext): Promise<CaptureResult | null>;
  recordVideo(context: CaptureContext): Promise<CaptureResult | null>;
}
```

`CaptureContext` 至少包含：

```ts
interface CaptureContext {
  vaultId: string;
  entryId: string;
  requestedAt: string;
}
```

### 8.3 Android 实现

```text
React
  ↓
Capture API
  ↓
Tauri command/plugin
  ↓
Kotlin Android Plugin
  ↓
ACTION_IMAGE_CAPTURE / ACTION_VIDEO_CAPTURE
  ↓
System Camera
  ↓
Result URI
  ↓
MediaService.attachToEntry(entryId)
```

### 8.4 为什么先 staging 再 attach

不要假定系统相机能直接写入所有类型的 Vault Provider。

推荐：

1. 创建可供系统相机写入的 staging URI；
2. 持久化 pending capture record；
3. 调用相机并授予临时 URI 权限；
4. 返回后验证媒体；
5. 交给 `StorageProvider.import/putStream` 写入目标 Entry；
6. 更新 `entry.json`；
7. 清除 pending state。

这样 Local、Android SAF、WebDAV、S3 等后端都不影响相机代码。

### 8.5 生命周期恢复

`pending_capture` 存本地 SQLite/应用状态库：

```text
capture_id
vault_id
entry_id
staging_uri
created_at
status
```

应用重新启动时扫描未完成操作并恢复/清理。

## 9. StorageProvider 架构

### 9.1 不应假设所有网盘一样

业务层应该统一，但 Provider 底层差异很大，因此接口分“基础能力”和“能力声明”。

概念接口：

```ts
interface StorageProvider {
  stat(key: string): Promise<ObjectStat | null>;
  list(key: string, cursor?: string): Promise<ListPage>;
  read(key: string, range?: ByteRange): Promise<ReadableStream>;
  write(key: string, data: ReadableStream, options?: WriteOptions): Promise<void>;
  mkdir(key: string): Promise<void>;
  delete(key: string): Promise<void>;
  move?(from: string, to: string): Promise<void>;
  getCapabilities(): ProviderCapabilities;
}
```

能力声明：

```ts
interface ProviderCapabilities {
  deltaSync: boolean;
  resumableUpload: boolean;
  rangeRead: boolean;
  serverSideMove: boolean;
  checksum: boolean;
  etag: boolean;
  locks: boolean;
}
```

Sync Engine 根据能力自动选择策略。

### 9.2 首批 Provider

推荐顺序：

1. `LocalProvider`
2. `WebDavProvider`
3. 坚果云（复用 WebDAV）
4. `S3Provider`
5. 百度网盘 Provider
6. 阿里相关官方 Drive/PDS Provider
7. 其他厂商根据官方 API 情况接入

夸克不写死到核心，保留社区或未来官方 Provider 插槽。

### 9.3 Credentials

OAuth token、refresh token、WebDAV 应用密码等：

- 不写入 Vault；
- 不写入普通 JSON 配置；
- 通过安全秘密存储保存；
- 插件只能获得逻辑 credential handle，不直接读取其他 Provider 的 secret。

Tauri 官方 Stronghold 插件可在 Windows/macOS/Android 上保存 secrets，可作为初始实现。

## 10. Sync Engine

### 10.1 同步对象

同步：

- `vault.json`
- `.framevault/` 或其他规范位置中的文件夹组织、功能主题绑定/配置、排序置顶及协调元数据
- Entry 元数据（既有布局示例：`entries/**/entry.json`）
- Markdown 正文（既有布局示例：`entries/**/note.md`）
- 原始媒体（既有布局示例：`entries/**/media/*`）
- 功能主题需要保留的用户业务数据，例如后期挑战进度

Entry 的最终物理布局变化时应同步更新扫描规则，不能把同步器写死为上述示例路径。

不同步：

- SQLite；
- thumbnail cache；
- 设备界面状态，例如当前选择、滚动位置和弹窗开关（不包含用户手动排序、置顶或主题业务数据）；
- plugin cache；
- token/secret。

### 10.2 核心状态

本机 SQLite 保存：

- local hash/revision；
- last synced hash/revision；
- remote etag/version/cursor；
- provider account ID；
- transfer progress；
- conflict state。

### 10.3 冲突原则

媒体：尽量 immutable，以内容 hash/ID 管理。

文本与 JSON：初期使用保守冲突策略：

```text
local changed + remote changed since base
              ↓
          conflict
              ↓
保留 local + remote 两个版本
```

后续可增加 Entry 字段级 merge 和 Markdown 三方合并。文件夹主题配置、手动顺序和置顶也遵循不静默覆盖原则；未设计字段级合并前保留冲突版本，不以重新按名称排序来消解冲突。

### 10.4 删除

不能只“远端看不到就认为删除”。

需要 tombstone：

```json
{
  "objectId": "0199...",
  "deletedAt": "...",
  "deviceId": "..."
}
```

同步确认后再按保留策略清理 tombstone。

### 10.5 大文件

- 使用 stream；
- Provider 支持时使用 range/multipart/resumable upload；
- 允许暂停和重试；
- 传输进度持久化；
- 不将完整视频载入 JS 内存。

重型传输逻辑优先放 Rust core。

## 11. 插件系统

### 11.1 插件包

```text
my-plugin/
├── manifest.json
├── main.js
├── style.css        # 可选
└── assets/
```

示例 manifest：

```json
{
  "id": "com.example.random-memory",
  "name": "Random Memory",
  "version": "1.0.0",
  "apiVersion": "1",
  "entry": "main.js",
  "permissions": [
    "entries.read",
    "ui.commands"
  ]
}
```

### 11.2 API 原则

插件依赖：

```ts
framevault.entries.*
framevault.media.*
framevault.commands.*
framevault.events.*
framevault.ui.*
framevault.storage.*
framevault.net.*
```

功能主题扩展还需规划文件夹访问和主题注册能力（例如 `framevault.folders.*`、`framevault.workspaceTypes.*`）；这些是候选命名，API 尚未实现或冻结。

插件不依赖：

- React 内部 store；
- SQLite schema；
- Rust struct；
- Tauri 内部 command 名；
- Vault 绝对路径。

### 11.3 隔离模型

推荐初期：

- 自动化/逻辑插件：**Web Worker 或独立 JS sandbox + RPC**；
- UI 扩展：先采用 declarative contributions（command/menu/settings/tab metadata）；
- 需要复杂 UI 时再加入 sandboxed iframe；
- 插件不直接获得 DOM root；
- 插件不直接获得 Tauri global API。

这样可以同时兼顾跨平台、安全性和长期 API 稳定。

### 11.4 权限

建议权限命名：

```text
entries.read
entries.write
media.read
media.write
vault.metadata
ui.commands
ui.panels
network
network:<host>
storage.provider
clipboard.read
clipboard.write
```

安装时展示权限变化；插件升级新增权限时必须重新确认。

### 11.5 Marketplace 与自由安装

长期同时支持：

- 官方 Marketplace；
- 本地 ZIP/目录侧载；
- 自定义 Registry URL；
- 开源仓库直连元数据（后续）；
- 插件签名和来源标识。

“市场”不能成为插件唯一安装来源。

### 11.6 功能主题扩展（Workspace Type）

功能主题是文件夹级的完整体验，不是单个 Entry 的标签、模板或 CSS 皮肤。目标是允许插件为旅行、挑战等用途提供专门界面和流程，进入文件夹后呈现具有独立用途的工作空间。

宿主应逐步提供的扩展面：

- 注册稳定功能主题 ID、名称、兼容版本、配置 schema 与所需权限；
- 声明可用视图、命令、设置项及允许范围内的导航贡献；
- 获取当前文件夹及其记录上下文，经公开 API 使用记录和媒体能力；
- 通过宿主校验的存储接口持久化主题配置与业务数据；
- 明确激活、退出、卸载和版本迁移的生命周期，避免主题切换遗留监听与任务。

内置普通记录主题先验证图库与阅读的同数据多视图流程；后续再提炼插件契约。内置组件可以由 React 实现，但公开插件契约不依赖内部 React store 或直接获得应用 DOM 根。复杂 UI 继续按 §11.3 的受控扩展点与隔离方案设计；导航接管范围、iframe/声明式方案尚待确定。

业务规则经公开能力执行；文件系统、索引、原生和存储权限仍由宿主控制。功能主题插件缺失、禁用或加载失败时，应保留数据并设计通用阅读/媒体浏览回退，不能因缺少插件就删除原始内容；具体交互待定。

挑战主题为后期方向：鼓励坚持、按规则重置本轮进度；时间边界、补记/纠错、历史记录策略与判定机制另行设计，不提前写死到核心 Entry 模型。

## 12. 外观主题系统（Theme）

本节只定义颜色、字体、样式与皮肤。文件夹级功能主题使用 §11.6 的插件能力，不通过开放外观 CSS 的权限实现业务逻辑。

### 12.1 Design Tokens

所有核心界面使用统一 token：

```css
:root {
  --fv-color-bg: #ffffff;
  --fv-color-surface: #f7f7f7;
  --fv-color-text: #202020;
  --fv-color-muted: #777777;
  --fv-color-accent: #6f5cff;

  --fv-radius-sm: 6px;
  --fv-radius-md: 12px;
  --fv-radius-lg: 20px;

  --fv-space-1: 4px;
  --fv-space-2: 8px;
  --fv-space-3: 12px;
}
```

业务组件禁止直接散落品牌色。

### 12.2 Theme package

```text
sakura-theme/
├── manifest.json
├── theme.css
└── preview.webp
```

Theme 默认：

- 不执行 JS；
- 不允许访问 Vault；
- 不允许读取凭证；
- CSP 禁止未经允许的远程资源；
- CSS 能力根据稳定性逐步开放。

### 12.3 CSS 稳定层

建议用 CSS Cascade Layers：

```text
@layer reset, base, components, theme, user;
```

并维护公开稳定的 token 与有限 selector contract，避免主题依赖内部 DOM 细节。

## 13. SQLite 索引

SQLite 只保存可重建或设备特定数据：

建议表：

```text
entries_index
media_index
fts_notes
sync_state
transfer_queue
pending_capture
plugin_cache
```

文件夹主题绑定、手动顺序、置顶和功能主题的不可重建业务进度不属于缓存，必须能从 Vault 开放元数据恢复。

原则：

> 删除本机 SQLite 后，重新扫描 Vault 应能恢复核心用户数据。

## 14. 安全模型

### 14.1 Tauri Capability

主 WebView 只开放必要 command 和路径 scope。Tauri 文件系统权限支持按命令和路径 scope 限制，符合最小权限原则。

### 14.2 插件与宿主隔离

- 插件 RPC 必须做参数校验；
- Plugin API 执行权限检查；
- 网络访问通过 host-mediated client；
- 存储写入通过 StorageProvider API；
- 高风险插件显示明确警告；
- 不从 Marketplace 直接加载任意 Rust/Kotlin 原生扩展。

### 14.3 Theme 安全

CSS 仍可能通过远程资源造成隐私问题，因此主题 CSS 不应默认允许任意远程 URL；优先要求资源随包分发。

## 15. 开发环境

### Windows

```text
VS Code
Node.js LTS
pnpm
Rust stable + Cargo
Tauri CLI
Microsoft C++ Build Tools / Visual Studio
WebView2
Git
```

Android 开发再增加：

```text
Android Studio
Android SDK
JDK/JBR
Android NDK（仅在 Tauri/Rust Android 构建需要时按官方版本配置）
```

### macOS

```text
VS Code
Node.js LTS
pnpm
Rust stable + Cargo
Tauri CLI
Xcode / Command Line Tools
Git
```

同一仓库在 Windows 调试 Windows，在 macOS 调试 macOS；Android 可按 Tauri mobile 工具链在合适主机调试。

## 16. 测试策略

### 16.1 Unit

- Vault parser/migration；
- Entry revision；
- tombstone；
- StorageProvider contract；
- Sync conflict decision；
- Plugin permission resolver；
- Folder 归属与稳定 ID、主题配置版本、手动顺序/置顶元数据校验。

### 16.2 Integration

- Local Provider；
- WebDAV mock server；
- SQLite rebuild；
- plugin worker RPC；
- theme load/unload；
- 排序置顶持久化与重建索引后的恢复；
- 内置功能主题的图库/阅读共享数据及切换；
- 后期功能主题插件加载、退出与缺失回退。

### 16.3 Device/E2E

重点覆盖：

- Android 从 Entry 调系统相机并正确归档；
- 相机取消；
- 相机期间进程被回收；
- 断网同步恢复；
- 两设备冲突；
- 大视频上传中断；
- 插件权限拒绝。

## 17. 架构决策记录（ADR）建议

从项目第一天开始维护 `docs/adr/`：

```text
ADR-0001-use-tauri2.md
ADR-0002-open-vault-format.md
ADR-0003-system-camera-only.md
ADR-0004-storage-provider-abstraction.md
ADR-0005-plugin-sandbox.md
ADR-0006-theme-design-tokens.md
ADR-0007-sqlite-is-cache.md
ADR-0008-folder-workspace-types.md
ADR-0009-user-order-and-pins.md
```

每次做“以后很难改”的决定，都用 ADR 记录背景、方案、取舍和后果。

## 18. 推荐实施顺序

当前 UI 学习与迭代优先围绕单窗口、文件夹组织、内置普通记录主题的图库/阅读、排序置顶推进；挑战机制与多窗口不纳入本轮范围。原有跨平台风险验证仍作为架构工作逐步开展，不要求先完成插件生态才允许做基础界面。

架构验证阶段关注：

1. Tauri 2 三端空壳；
2. React + Design Tokens；
3. Vault Core 本地读写；
4. Android Kotlin Capture Plugin PoC；
5. `CaptureProvider`、`StorageProvider` 接口；
6. Plugin Worker/RPC 最小 PoC；
7. Theme 动态加载 PoC；
8. Folder 与 Workspace Type 元数据、排序置顶的持久化和重建验证。

上述风险验证与单窗口基础 UI 可以渐进交替进行；相应能力正式交付前完成其验证。

第二阶段完成桌面本地照片日记：文件夹导航、内置普通记录功能主题、图库/Markdown 阅读，以及用户可控的排序与置顶。

第三阶段完成 Android 相机主流程。

第四阶段完成 WebDAV + Sync Engine。

第五阶段再扩大插件 API、Provider 与 Marketplace，以文件夹级功能主题作为主要插件方向之一；旅行和挑战专门体验后期按需排期。

## 19. 外部事实与官方文档参考（截至 2026-09）

- Tauri 2：单代码库支持 Windows、macOS、Android 等平台；前端可用 JavaScript，应用逻辑可用 Rust，并可通过 Kotlin 深入集成 Android。
  - https://v2.tauri.app/
- Tauri Mobile Plugin Development：Android 插件默认使用 Kotlin，命令可由 Rust 或 JavaScript 调用。
  - https://v2.tauri.app/develop/plugins/develop-mobile/
- Tauri File System：文件 API 采用 permission + path scope 模型。
  - https://v2.tauri.app/plugin/file-system/
- Tauri Stronghold：支持 Windows、macOS、Android，可用于安全存储 secrets。
  - https://v2.tauri.app/plugin/stronghold/
- Android Common Intents：`ACTION_IMAGE_CAPTURE` / `ACTION_VIDEO_CAPTURE` 可启动相机并通过 `EXTRA_OUTPUT` 指定输出 URI。
  - https://developer.android.com/guide/components/intents-common
- 坚果云 WebDAV：第三方应用可使用应用密码通过 WebDAV 上传、下载和管理文件。
  - https://help.jianguoyun.com/?p=2064
- 百度 OAuth 页面显示 netdisk scope 可授权第三方在网盘创建文件夹并读写数据。
  - https://openapi.baidu.com/
- 阿里网盘与相册/PDS 开发文档提供 Native 应用 OAuth2.0 模型和文件管理 API；实际消费级网盘接入需按开放平台当前政策确认。
  - https://www.alibabacloud.com/help/zh/pds/drive-and-photo-service-dev/user-guide/application-access-details/
