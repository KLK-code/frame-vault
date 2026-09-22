# FrameVault 实现架构（前端 / 后端 / 契约）

> 版本：v0.1 · 2026-09-21
> 前置阅读：`FrameVault_PRD_zh-CN.md`、`FrameVault_Technical_Architecture_zh-CN.md`
> 本文档回答三个问题：**① 应该有哪些文件 ② 每个文件负责什么 ③ 每个文件对外暴露什么接口**
>
> 约定：标 **✅ 已实现** 的是当前仓库里真实存在的；标 **⬜ 计划** 的是还没写的。
> 全文只给**接口**（函数签名 / 类型），不给函数体。

> **v0.2 修订（对齐 README「当前产品方向与开发范围」）**
>
> 1. **单窗口优先**：多窗口与浏览器式多标签**暂缓**。§5.1 里的 `open_vault_manager` / `close_vault_manager` 已经能跑，但**降级为可选**；仓库管理的主入口是「管理仓库」**页面**（§4.2 已如此）。
> 2. 新增 **功能主题（Workspace Type）** 架构：见 §13。
> 3. 前端状态必须**分区管理**：主题绑定、用户排序置顶、当前选择、视图与面板开关**分开**，不要混成一个 `page` 状态。见 §14。
> 4. §11 演进路线已按 README 的 M1~M5 重写。
> 5. 数据落点补充：Vault 内新增「文件夹 / 功能主题绑定 / 排序与置顶」元数据（§13.2）。

---

---

## 0. 怎么读这份文档

1. 先看第 1 节的全景图，建立"有几个东西、它们怎么说话"的心理模型；
2. 再看第 3、4 节的文件清单——**每个文件只做一件事，并且只通过声明的接口被使用**；
3. 第 5 节是**契约**，前后端唯一的耦合点都在那里，改代码前先看它；
4. 第 11 节告诉你"下一步该加哪些文件"，按阶段推进，别一次全建。

**为什么这样组织**：架构文档最大的价值不是描述现状，而是**规定边界**。所以本文档写的是"允许做什么、接口长什么样"，不是"代码怎么写的"。

---

## 1. 全景

```text
┌─────────────────────────── WebView2（浏览器沙箱） ───────────────────────────┐
│  前端：TypeScript + React                                                    │
│  pages/ 页面   components/ 组件   lib/api.ts 唯一出口   styles/ 主题变量      │
└───────────────────────────────────┬──────────────────────────────────────────┘
                                    │  invoke（请求/响应） / listen（后端推送）
┌───────────────────────────────────▼──────────────────────────────────────────┐
│  后端：Rust（原生进程，唯一能碰系统的地方）                                    │
│  commands/ 接线盒 → vault/ 领域核心 → index/ 索引 → storage/ 存储 → sync/ 同步 │
└───────────────────────────────────┬──────────────────────────────────────────┘
                                    │
        ┌───────────────────────────┴───────────────────────────┐
        ▼                                                       ▼
  用户 Vault 目录                                        应用数据目录
  vault.json / entries/**/entry.json / note.md / media   %APPDATA%/com.framevault.app
  （= 用户的数据本体，可备份、可迁移）                     （= 索引、缓存、仓库列表）
```

### 四条铁律

| 铁律 | 含义 | 违背的后果 |
|---|---|---|
| **前端不碰文件** | WebView 里没有文件系统 API，只能请求 Rust | 想绕也绕不过去，这是物理事实 |
| **跨层只走 invoke / emit** | 所有前后端通信都在这两条通道上 | 出现隐式依赖，重构必崩 |
| **纯逻辑不认识 tauri** | `vault/` 等目录里不出现 `tauri` 这个词 | 逻辑无法单独测试，只能在窗口里点 |
| **页面自己负责自己的设计** | 外壳只选页面，不写页面的标题和布局 | 每加一个页面都要改外壳，最终变成一坨 |

**为什么**：这四条不是风格偏好，而是**让"可测试、可替换、可扩展"变成结构上的事实**，而不是靠自觉。

---

## 2. 目录总览

### 仓库根

```text
frame-vault/
├── FrameVault_PRD_zh-CN.md                      产品需求
├── FrameVault_Technical_Architecture_zh-CN.md   技术架构（上位文档）
├── README.md                                    仓库说明
├── docs/
│   ├── ARCHITECTURE_IMPL_zh-CN.md               ← 本文档
│   ├── adr/                                     架构决策记录
│   └── vault-spec/                              Vault 规范正文
├── apps/
│   └── framevault/                              应用本体（前端 + Rust 宿主）
├── packages/                                    ⬜ 与 UI 无关的纯 TS 包
├── crates/                                      ⬜ Rust 核心（从 apps 里抽出来）
├── plugins-native/                              ⬜ 平台原生插件（Android 相机）
├── pnpm-workspace.yaml                          ⬜ 出现第二个 JS 包时再加
└── Cargo.toml                                   ⬜ 出现第二个 crate 时再加
```

**为什么要留 `packages/` 和 `crates/`**：插件 SDK、主题 SDK、Vault 规范 schema 这些**要被第三方引用**的东西不能塞在 app 里；Vault 核心、索引、同步这些 Rust 逻辑要被 CLI、测试、未来的同步守护进程复用，也不该锁死在 Tauri 里。现在不建，但目录边界按这个方向演进。

### 应用内部（现状 ✅）

```text
apps/framevault/
├── package.json / pnpm-lock.yaml          前端包身份 + 依赖锁
├── index.html                             HTML 入口（两个窗口共用）
├── vite.config.ts                         固定 1420 端口 + 忽略 src-tauri
├── tsconfig.json / tsconfig.node.json     TS 配置
├── src/                                   前端源码（第 4 节）
└── src-tauri/                             Rust 宿主
    ├── Cargo.toml / Cargo.lock
    ├── build.rs                           构建脚本（tauri-build）
    ├── tauri.conf.json                    产品名/标识符/窗口/打包
    ├── capabilities/default.json          权限清单（含第二个窗口）
    ├── icons/                             打包图标
    ├── examples/demo.rs                   可单独运行的试验程序
    ├── gen/                               自动生成（schemas、将来的 android 工程）
    └── src/                               Rust 源码（第 3 节）
```

---

## 3. 后端（Rust）架构

### 3.1 分层与依赖方向

```text
lib.rs（组装）
   ├── commands/（接线盒：依赖 tauri，收参数 → 调逻辑 → 转错误）
   │      ├──▶ vault/（领域核心：不认识 tauri）
   │      └──▶ state.rs（全局状态 + 持久化）
   ├── state.rs ──▶ vault/（借用原子写入工具）
   ├── capture/ storage/ sync/ index/（各自独立，通过 trait 对外）
   └── error.rs（被所有人用）
```

| 层 | 目录 | 允许 use | 禁止 use | 可测试性 |
|---|---|---|---|---|
| 组装层 | `lib.rs` | 所有 | — | 不测（只做装配） |
| 接线层 | `commands/` | `tauri`、`vault/`、`state.rs` | 不写业务细节 | 通过前端手测 |
| 领域层 | `vault/` | `std`、`serde`、`uuid` | **`tauri`** | `cargo test` 秒级 |
| 抽象层 | `capture/`、`storage/` | `std`、trait 定义 | **`tauri`** | 用 mock 实现测 |
| 状态层 | `state.rs` | `serde`、`vault/` | 不写业务规则 | 测 load / save |

**为什么这么严**：领域层一旦 `use tauri`，就只能靠开窗口点击来验证；而它恰恰是最需要反复测试的部分（Vault 格式、迁移、同步冲突）。**这条线是整个后端最重要的边界。**


### 3.2 文件清单与接口

#### `src-tauri/src/main.rs` ✅
- **职责**：进程入口，只调用 `framevault_lib::run()`。
- **接口**：无（可执行产物入口）。
- **规则**：永远不在这里写逻辑。

#### `src-tauri/src/lib.rs` ✅
- **职责**：组装——注册插件、初始化并管理状态、注册命令、挂窗口事件。
- **对外**：`pub fn run()`（被 main.rs 调用）。
- **现状**：opener / dialog 插件已注册；`AppState` 在 `setup` 里 `manage`；关主窗口时 `exit(0)`。

#### `src-tauri/src/error.rs` ⬜
- **职责**：统一错误类型，替代到处手写 `map_err(|e| e.to_string())`。
- **接口**：
  ```rust
  pub enum AppError { Io(std::io::Error), Json(serde_json::Error), Invalid(String), NotFound(String), NotSelected }
  pub type AppResult<T> = Result<T, AppError>;
  impl From<std::io::Error> for AppError        // 让 ? 直接可用
  impl From<serde_json::Error> for AppError
  impl serde::Serialize for AppError            // Tauri 要求错误可序列化
  ```
- **为什么**：命令统一返回 `AppResult<T>` 后，函数体里的 `?` 能一路传下去，前端拿到的错误信息也更准确。**这是把领域层写复杂之前必须先做的一件事。**

#### `src-tauri/src/state.rs` ✅
- **职责**：全局状态 + 其持久化。
- **接口**：
  ```rust
  pub struct VaultRegistry { pub active: Option<PathBuf>, pub known: Vec<PathBuf> }
  pub struct AppState { pub vaults: Mutex<VaultRegistry> /* + config_path */ }
  impl AppState {
      pub fn new(config_path: PathBuf) -> Self;
      pub fn load(&self) -> std::io::Result<()>;   // 启动时读 vaults.json
      pub fn save(&self) -> std::io::Result<()>;   // 改动后写回
  }
  ```
- **规则**：锁只保护内存，**不要拿着锁做磁盘 IO**（用 `{ }` 把临界区圈小）。
- **扩展方向**：加「最近打开」等字段；超过一个文件就拆成 `state/` 目录。

#### `src-tauri/src/vault/` ⬜（当前是单文件 `vault.rs` ✅）
领域核心。**这个目录里永远不出现 `tauri`。**

| 文件 | 职责 | 对外接口（签名级） | 阶段 |
|---|---|---|---|
| `mod.rs` | 汇总导出 + 常量 | `pub const SCHEMA_VERSION: u32"` | M0 |
| `model.rs` | 数据结构 | `Entry { schema_version, id, title, tags, created_at, updated_at, media }`、`Media { id, kind, path, byte_size }`、`VaultMeta { schema_version, vault_id, name, created_at }` | M0 |
| `storage.rs` | 文件读写 | `write_entry(&Path, &Entry) -> io::Result<PathBuf>`、`read_entry(&Path, &str) -> io::Result<Entry>`、`list_entries(&Path) -> io::Result<Vec<Entry>>`、`delete_entry(&Path, &str) -> io::Result<()>`、`write_json_atomic<T: Serialize>(&Path, &T) -> io::Result<()>`、`ensure_vault(&Path) -> io::Result<VaultMeta>` | M0 |
| `id.rs` | ID 生成与校验 | `new_entry_id() -> String`（UUIDv7）、`is_valid_id(&str) -> bool` | M0 |
| `migration.rs` | schemaVersion 迁移 | `migrate_vault(&Path) -> io::Result<()>`、`is_supported(u32) -> bool` | M1 |
| `tombstone.rs` | 删除标记 | `mark_deleted(&Path, &str) -> io::Result<()>`、`list_tombstones(&Path) -> io::Result<Vec<Tombstone>>` | M4 |

#### `src-tauri/src/commands/` ⬜（当前是单文件 `commands.rs` ✅）
接线盒。**一个命令只做三件事：收参数（校验）→ 调领域层 → 把结果/错误转成可序列化的形状。**
命令超过 6~8 个时拆成目录：

| 文件 | 命令 | 阶段 |
|---|---|---|
| `vault.rs` | `list_vaults` / `add_vault` / `switch_vault` / `forget_vault` / `create_vault` | ✅ 前四个，⬜ create_vault |
| `entry.rs` | `save_entry` / `load_entry` / `list_entries` / `delete_entry` | ✅ 前两个 |
| `media.rs` | `import_media` / `make_thumbnail` | M1 |
| `window.rs` | `open_vault_manager` / `close_vault_manager` / `open_settings` / `close_settings` | ✅ |
| `sync.rs` | `sync_now` / `sync_status` / `cancel_sync` | M4 |

#### `src-tauri/src/capture/` ⬜
- **职责**：把「拍照 / 录像 / 选文件」抽象成跨平台能力。
- **接口**：
  ```rust
  pub trait CaptureProvider: Send + Sync {
      fn capabilities(&self) -> CaptureCapabilities;   // can_capture / can_record / can_pick_folder
      fn capture_photo(&self, ctx: CaptureContext) -> AppResult<Option<CaptureResult>>;
      fn record_video(&self, ctx: CaptureContext) -> AppResult<Option<CaptureResult>>;
  }
  pub struct CaptureContext { pub vault_id: String, pub entry_id: String, pub requested_at: String }
  pub struct CaptureResult  { pub staging_path: PathBuf, pub kind: MediaKind }
  ```
- **实现**：`desktop.rs`（文件对话框导入）、`android.rs`（调用 Kotlin 插件）。M2 才做。

#### `src-tauri/src/storage/` ⬜
- **职责**：所有存储后端统一接口（技术架构 §9）。
- **接口**：
  ```rust
  pub trait StorageProvider {
      fn capabilities(&self) -> ProviderCapabilities;  // delta_sync / resumable_upload / range_read / ...
      fn stat(&self, key: &str) -> AppResult<Option<ObjectStat>>;
      fn read(&self, key: &str, range: Option<ByteRange>) -> AppResult<Box<dyn Read>>;
      fn write(&self, key: &str, data: &mut dyn Read, opts: WriteOptions) -> AppResult<()>;
      fn list(&self, prefix: &str, cursor: Option<String>) -> AppResult<ListPage>;
      fn delete(&self, key: &str) -> AppResult<()>;
  }
  ```
- **实现**：`local.rs`（M1）、`webdav.rs`（M4），后续网盘各自一个文件。

#### `src-tauri/src/index/` ⬜
- **职责**：SQLite 索引与搜索。**只存可重建的数据**（技术架构 §13）。
- **接口**：`open(db_path) -> AppResult<Index>`、`rebuild_from_vault(&Path) -> AppResult<()>`、`search(query) -> AppResult<Vec<String>>`、`upsert_entry(&Entry)`、`remove_entry(&str)`。
- **规则**：数据库文件放应用数据目录，**永远不进 Vault 目录**。

#### `src-tauri/src/sync/` ⬜
- **职责**：增量同步与冲突（技术架构 §10）。
- **接口**：`plan(&dyn StorageProvider) -> AppResult<SyncPlan>`、`apply(&SyncPlan, &dyn StorageProvider) -> AppResult<SyncReport>`、`resolve_conflict(...) -> ConflictDecision`，并向 UI 推 `sync://progress`。

### 3.3 将来抽到 `crates/` 的映射

| 现在的目录 | 抽成 | 时机 |
|---|---|---|
| `vault/` | `crates/framevault-core` | 文件超过 3 个（M1 初） |
| `storage/` | `crates/storage-core` | 接第一个 WebDAV 时（M4） |
| `index/` | `crates/indexer` | 索引逻辑超过一个文件（M1 末） |
| `sync/` | `crates/sync-engine` | M4 |
| `capture/` | 留在 app 内（依赖平台 SDK，不适合复用） | — |

**判定标准**：能被别的程序（CLI / 测试 / 守护进程）复用时才抽。抽出的 crate，`Cargo.toml` 里**不能有 tauri**——这就是"编译器帮你焊死边界"。

---

## 4. 前端（TypeScript + React）架构

### 4.1 先说现在哪里乱（诚实版）

当前 `src/` 是这样平铺的：`App.tsx` / `App.css` / `tokens.css` / `styles/reset.css` / `lib/api.ts` / `lib/pages.tsx` / `pages/*.tsx` / `VaultManagerWindow.tsx`。文件不多，但**规则不统一**，页面一多就会失控：

| 症状 | 具体表现 |
|---|---|
| 样式有三种放法 | `App.css` 在根、`tokens.css` 在根、`reset.css` 在 `styles/`、`VaultManagerPage.css` 跟页面同目录 |
| 页面里什么都干 | 取数据 + 转错误 + 渲染 + 写状态文案，全塞在一个 `VaultPage.tsx` 里 |
| 没有通用原语 | 按钮、空状态、错误提示每个页面各写一遍 |
| 注册表位置不对 | `lib/pages.tsx` 里 `import` 了**所有**页面，它是外壳的配置，不是通用工具 |
| 外壳与页面互相知道 | `App.tsx` 里写死了页面的渲染分支 |
| 窗口外壳和页面内容平级 | `VaultManagerWindow.tsx` 和 `pages/VaultManagerPage.tsx` 混在一层 |

### 4.2 目标结构：四层 + 一个约定

```text
src/
├── main.tsx                  入口：按窗口 label 分派
├── app/                      ── 外壳层：只管窗口、导航、当前页面 ──
│   ├── AppShell.tsx          主窗口外壳
│   ├── AppShell.css
│   ├── TitleBar.tsx / .css    自绘标题栏（两个窗口共用）
│   ├── window.css            独立窗口共用的外框布局
│   ├── VaultManagerWindow.tsx  管理仓库窗口外壳
│   ├── SettingsWindow.tsx      设置窗口外壳
│   ├── navigation.ts         导航项：id / label / 分组 / 图标
│   └── routes.ts             id → 懒加载组件（React.lazy）
├── pages/                    ── 页面层：一个页面一个目录 ──
│   ├── timeline/
│   │   ├── TimelinePage.tsx
│   │   └── TimelinePage.css
│   ├── gallery/
│   ├── calendar/
│   ├── vault/
│   │   ├── VaultPage.tsx
│   │   └── VaultPage.css
│   └── Placeholder.tsx
├── features/                 ── 业务块：被 ≥2 个页面用到才升级到这里 ──
│   ├── vault/
│   │   ├── VaultSwitcher.tsx      悬浮菜单：切换 / 添加 / 管理仓库…
│   │   ├── VaultSwitcher.css
│   │   ├── VaultManagerPanel.tsx  独立窗口里的管理面板（只被窗口用）
│   │   ├── VaultManagerPanel.css
│   │   ├── VaultList.tsx
│   │   ├── VaultRow.tsx
│   │   └── useVaults.ts      仓库数据 hook（列表 + 增删切换）
│   ├── timeline/
│   │   └── EntryCard.tsx
│   └── settings/
│       ├── SettingsPanel.tsx      外壳：左导航 + 右内容（Obsidian 式）
│       ├── settingsSections.tsx   分类注册表（加一个分类 = 加一行）
│       └── sections/              每个分类一个文件
│           ├── AppearanceSection.tsx   外观：实时主题编辑器
│           └── PlaceholderSection.tsx  还没实现的设置项（按钮占位）
├── components/               ── 通用原语：与业务无关，纯 props ──
│   ├── PageHeader.tsx        统一页头（标题 + 右侧操作区）
│   ├── Button.tsx
│   ├── Card.tsx
│   ├── EmptyState.tsx
│   ├── ErrorNotice.tsx
│   └── Spinner.tsx
├── lib/                      ── 数据与工具 ──
│   ├── api.ts                唯一 invoke 出口
│   ├── types.ts              与 Rust 对齐的类型（Entry / VaultInfo / …）
│   ├── useAsync.ts           统一的 加载 / 错误 / 刷新
│   └── capabilities.ts       （M2）
├── styles/                   ── 全局样式，只有这三个文件 ──
│   ├── reset.css
│   ├── tokens.css
│   └── layers.css            （M3）
└── assets/
```

**依赖方向（不许反向）**：

```text
app/  ──▶ pages/ ──▶ features/ ──▶ components/
  │            │            │
  └────────────┴────────────┴──▶ lib/（api / types / useAsync）
  所有层都可以用 styles/ 里的变量，但没人 import 别人的样式文件
```

**外壳已经实现的交互**（都属于「视图与面板开关」类状态，存 `localStorage`，**不进 Vault**——见 §14）：

- **侧栏宽度可拖动**：分隔条用 Pointer 事件（鼠标和触摸通用），夹在 160~480px 之间；双击复位；聚焦后按 ← / → 也能调；**松手才写 localStorage**（不要每帧写）。
- **仓库切换悬浮菜单**：侧栏底部的小按钮 → 向上弹出菜单（切换 / 添加 / 管理仓库…），点菜单外面或按 Esc 关闭。管理仓库的**唯一入口**在这个菜单里，点开才是独立窗口。

### 4.3 四条规则（这才是"不乱"的关键）

| 规则 | 说明 | 例子 |
|---|---|---|
| **一个页面一个目录** | 页面本体 + 它的样式 + **只属于它**的子组件都放里面 | `pages/timeline/` 里可以放 `EntryCard.tsx`，删页面时删一个目录 |
| **复用要"有人催"** | 第二个页面真要用才从 `pages/` 升级到 `features/`，第三个才升级到 `components/` | `EntryCard` 一开始就放 `pages/timeline/` |
| **样式与组件同目录同名** | 全局样式只有 `styles/` 下三个文件；其它样式跟它服务的组件并排 | `TimelinePage.css` 与 `TimelinePage.tsx` 同目录 |
| **外壳不认识页面内部** | 外壳只读 `app/navigation.ts` 的 id/label 和 `app/routes.ts` 的映射 | `AppShell.tsx` 不 `import` 任何 page |

### 4.4 页面契约（每个页面长什么样）

```tsx
// pages/timeline/TimelinePage.tsx
export default function TimelinePage() {
  const { data, error, loading, reload } = useAsync(listEntries, []);

  return (
    <>
      <PageHeader title="时间线" actions={<Button onClick={reload}>刷新</Button>} />
      {loading && <Spinner />}
      {error && <ErrorNotice message={error} onRetry={reload} />}
      {data?.length === 0 && <EmptyState title="还没有记录" hint="点「新建」开始" />}
      {data?.map((e) => <EntryCard key={e.id} entry={e} />)}
    </>
  );
}
```

三条约定：

1. **默认导出、无 props**（页面自己取数据，不靠外壳喂）；
2. **页面自己渲染 `PageHeader`**（外壳不替它写标题——这是"每页一套设计"的前提）；
3. **loading / error / empty 三态用统一原语**，不各写各的文案。

### 4.5 三个复用层级的判定

```text
只用一次          → 留在页面目录里（pages/timeline/EntryCard.tsx）
两个页面都要用     → 升级到 features/（features/timeline/EntryCard.tsx）
跟业务无关（纯 props）→ 升级到 components/（components/Card.tsx）
```

**不要提前升级**。放进 `components/` 的东西一旦带上业务字段，就会变成"什么都能塞的杂物间"。

### 4.6 样式归属规则

| 场景 | 放哪 | 例子 |
|---|---|---|
| 全局变量 / 主题 | `styles/tokens.css` | `--fv-color-text` |
| 浏览器默认样式归零 | `styles/reset.css` | `box-sizing`、`margin: 0` |
| 外壳布局 | `app/AppShell.css` | `.app`、`.sidebar`、`.content` |
| 页面 / 组件私有 | 与它同目录同名 | `pages/vault/VaultPage.css` |
| 需要绝对隔离 | `*.module.css` | 包装第三方组件时 |

**外壳的类名由外壳拥有**：页面不该去写 `.content` 或 `.sidebar`。页面拿到的只有"一块可用区域"，怎么在里面排版是页面自己的事。

### 4.7 迁移步骤（每步都能跑，别一次改完）

| 步 | 做什么 | 验证 |
|---|---|---|
| 1 | 建目录骨架：`styles/`、`app/`、`components/`、`features/` | `ls src` |
| 2 | `tokens.css` 与 `styles/reset.css` 都搬到 `styles/`，改 `main.tsx` 的 import | `pnpm dev` 样式不变 |
| 3 | 抽通用原语：`PageHeader` / `Button` / `EmptyState` / `ErrorNotice` / `Spinner` | 页面里不再有内联的加载文案 |
| 4 | 建 `lib/types.ts`、`lib/useAsync.ts`；把 `api.ts` 里的类型搬过去 | `tsc --noEmit` 通过 |
| 5 | 页面搬进目录：`pages/VaultPage.tsx` → `pages/vault/VaultPage.tsx`（同步改 import） | `pnpm dev` 页面正常 |
| 6 | 抽业务块：把管理页的列表抽成 `features/vault/VaultList.tsx` + `useVaults.ts` | 管理页变薄，逻辑可复用 |
| 7 | 外壳改名：`App.tsx` → `app/AppShell.tsx`；`lib/pages.tsx` → `app/navigation.ts` + `app/routes.ts`（`React.lazy` 按需加载） | 切页面正常，新增页面只改这两个文件 |
| 8 | 更新本文档 §4 与 `README` 的结构说明 | — |

**纪律**：每一步结束都跑一次 `pnpm exec tsc --noEmit` 和 `pnpm dev` 看一眼；出问题只可能是刚做的那一步。

### 4.8 什么时候引入路由库 / 状态库

| 引入什么 | 触发条件 | 现在需要吗 |
|---|---|---|
| react-router 等路由库 | 页面需要 **URL 参数 / 前进后退 / 深链接** | ❌ 不需要，注册表 + `useState` 够用 |
| Zustand / Jotai 等状态库 | 出现"服务端状态缓存"痛点（同一份远端数据多处使用、需要失效策略） | ❌ 不需要，Rust 是唯一数据源，`useAsync` 够用 |
| CSS-in-JS | 需要运行时主题计算 | ❌ 不需要，CSS 变量就是干这个的 |

**为什么先不引入**：现在前端只是**展示 + 转发**，引入路由和 store 会让"谁说了算"变模糊，也让你多学两个库却解决不了当下的问题。

---

## 5. 前后端契约（最重要的一节）

### 5.1 命令全表

| 命令 | 参数（前端传） | 返回 | 用途 | 状态 |
|---|---|---|---|---|
| `list_vaults` | — | `VaultInfo[]` | 取仓库列表 + 当前项 + 目录是否还存在 | ✅ |
| `add_vault` | `path` | `VaultInfo[]` | 导入文件夹为仓库（并设为当前） | ✅ |
| `switch_vault` | `path` | `void` | 切换当前仓库 | ✅ |
| `forget_vault` | `path` | `VaultInfo[]` | 从列表移除（**不删磁盘文件**） | ✅ |
| `create_vault` | `name` / `parentPath?` | `VaultInfo[]` | 新建仓库（建目录 + 写 vault.json） | ⬜ |
| `save_entry` | `id` / `title` / `createdAt` | `string`（写入路径） | 写一条记录 | ✅ |
| `load_entry` | `id` | `Entry` | 读一条记录 | ✅ |
| `list_entries` | — | `Entry[]` | 列当前仓库全部记录（时间线用） | ⬜ |
| `delete_entry` | `id` | `void` | 删除（写 tombstone） | ⬜ |
| `import_media` | `entryId` / `sourcePath` | `Media` | 导入媒体 | ⬜ M1 |
| `make_thumbnail` | `mediaId` / `maxSize` | `string` | 生成缩略图并返回路径 | ⬜ M1 |
| `open_vault_manager` | — | `void` | 打开管理窗口（已开则聚焦） | ✅ |
| `close_vault_manager` | — | `void` | 关闭管理窗口 | ✅ |
| `open_settings` | — | `void` | 打开设置窗口（已开则聚焦） | ✅ |
| `close_settings` | — | `void` | 关闭设置窗口 | ✅ |
| `sync_now` / `sync_status` | — | `SyncReport` / `SyncState` | 手动同步 / 查状态 | ⬜ M4 |

### 5.2 事件全表（后端 → 前端推送）

| 事件名 | 负载 | 场景 |
|---|---|---|
| `vault://changed` | `{ activePath }` | 切换 / 导入仓库后，通知所有页面刷新 |
| `sync://progress` | `{ done, total, currentFile }` | 同步进度（长任务必须用事件，不能用 invoke） |
| `media://imported` | `{ entryId, mediaId }` | 拍照 / 导入完成后通知界面 |
| `index://rebuilt` | `{ count }` | 索引重建完成 |

**为什么必须有事件**：`invoke` 是"一问一答"，长任务（同步 3 GB 视频）没法用它报进度。前端用 `listen("sync://progress", cb)` 订阅即可。


### 5.3 数据结构与命名规则

- Rust 结构体统一加 `#[serde(rename_all = "camelCase")]`，字段用 snake_case；
- 前端 TS 类型用 camelCase，**字段名必须与 JSON 完全一致**；
- 命令参数名：Rust 写 `vault_id` ↔ 前端传 `vaultId`（Tauri 自动转换）；
- 命令名是小写蛇形（`list_vaults`），前端调用时是**字符串**——写错不会编译报错，只在运行时失败，所以**只在 `api.ts` 里写一次**。

### 5.4 三条纪律

1. **`invoke` 只出现在 `src/lib/api.ts`**。组件里只 import 包装函数。
2. **错误统一用 `Result<T, String>`**（将来统一成 `AppResult`）——前端一律 `try / catch`。
3. **加一个命令 = 改三处**：在 `commands/*.rs` 写函数 → 在 `lib.rs` 的 `generate_handler!` 注册 → 在 `api.ts` 加包装。漏了第二处，启动时会报"找不到命令"。

---

## 6. 数据放在哪（三处，绝不混）

| 数据 | 落点 | 进 git | 丢了怎么办 |
|---|---|---|---|
| 源码、配置、锁文件 | 仓库 `apps/framevault` | ✅ | 重新 clone |
| 用户 Vault（`vault.json`、`entry.json`、`note.md`、媒体） | 用户自己选的目录 | ❌ | **不可丢**，这是数据本体 |
| 应用数据（`vaults.json`、SQLite、缩略图、pending 拍照） | `%APPDATA%/com.framevault.app` | ❌ | 可重建（重扫 Vault） |
| 依赖缓存 | `~/.cargo`、pnpm store | ❌ | 重装 |

**判定口诀**：**「删掉它，用户的数据还在吗？」** 在 → 放应用数据目录；不在 → 放 Vault。

---

## 7. Vault 规范的代码落点

对应技术架构文档 §7：

```text
<用户选的目录>/
├── vault.json              ← vault/migration.rs 写，storage.rs 校验
├── .framevault/
│   ├── migrations/         ← migration.rs
│   └── tombstones/         ← tombstone.rs（M4）
└── entries/
    └── <entry-id>/         ← id.rs 生成（UUIDv7）
        ├── entry.json      ← storage.rs 原子写入（.tmp + rename）
        ├── note.md
        └── media/          ← media-core 负责（M1）
```

**四条硬规则**（都已在现有代码里体现）：

1. 所有可持久化结构都带 `schemaVersion`，写入前校验；
2. 元数据写入必须**原子**（临时文件 + rename）；
3. ID 与路径 / 标题解耦（UUIDv7），外部当 opaque ID 用；
4. 不把绝对路径写进跨端元数据（媒体条目存相对路径）。


---

## 8. 平台差异怎么处理

| 差异类型 | 处理方式 | 落点 |
|---|---|---|
| 前端布局（手机 vs 桌面） | **CSS 断点 + pointer / hover 媒体查询**，不是 JS 判平台 | `*.css` |
| 外壳导航（侧栏 vs 底部标签栏） | 两个薄外壳，页面共用 | `App.tsx` / 将来的 `MobileShell.tsx` |
| 能力差异（能不能拍照 / 选文件夹） | **provider 声明能力**，UI 只读 `capabilities` | `lib/capabilities.ts` + `capture/` |
| 平台专属 API（托盘、Intent、SAF） | Rust `#[cfg(desktop)]` / `#[cfg(target_os = "android")]`；前端不写平台分支 | `lib.rs`、`capture/android.rs` |
| 打包 | 两条独立流水线：`pnpm tauri build` / `pnpm tauri android build` | — |

**为什么不让前端判平台**：一旦 UI 里散落 `if (isAndroid)`，加第三个平台就要重写一遍。**能力探测**让新增平台只多一个 provider 实现。

---

## 9. 安全模型落点

| 关注点 | 落点 | 现状 |
|---|---|---|
| 权限最小化 | `src-tauri/capabilities/default.json` 的 `windows` + `permissions` | ✅ 已含主窗口与管理窗口 |
| 路径 scope | 用 `tauri-plugin-fs` 时按目录授权；自研命令自己校验 | ⬜ |
| 凭证（OAuth / 应用密码） | `tauri-plugin-stronghold`，**永不写入 Vault 或普通 JSON** | ⬜ M4 |
| CSP | `tauri.conf.json` 的 `app.security.csp`，主题系统上线前必须收紧 | ⬜ M3 |
| 插件隔离 | 插件只走 Plugin API，拿不到 `window.__TAURI__` | ⬜ M3 / M5 |

**一个已经踩过的坑**：新窗口必须**同时**出现在 `capabilities` 的 `windows` 数组里，否则那个窗口一条权限都没有（`dialog.open`、`window.close` 全部被静默拒绝）。

---

## 10. 测试与调试

| 对象 | 手段 | 命令 | 速度 |
|---|---|---|---|
| 领域逻辑（`vault/`） | 单元测试 | `cargo test` | 1~2 秒 |
| 想亲眼看数据 | 独立小程序 | `cargo run --example demo` | 2 秒 |
| Rust 类型检查 | `cargo check` | — | 秒级 |
| 前端类型检查 | `tsc --noEmit` | `pnpm exec tsc --noEmit` | 秒级 |
| 纯 UI | 浏览器 + DevTools 设备模拟 | `pnpm dev`、`pnpm dev --host`（手机真机） | 即改即看 |
| 整体 | 开发模式 | `pnpm tauri dev` | 首次 5~15 分钟 |
| 端到端 | 手工清单（拍照取消、断网恢复…） | — | 慢 |

**调试习惯**：一次改动只走一条链——改逻辑跑 `cargo test`，改界面跑 `pnpm dev`，只有验证"两边接起来"才用 `pnpm tauri dev`。

**三处同看**：终端里的 `println!`、界面上的状态文字、磁盘上的文件。哪个没动，问题就在哪一段。


---

## 11. 演进路线（每阶段新增哪些文件）

> 与 README「实施阶段」一致。顺序不可打乱：按"不可逆风险从大到小"排列。

| 阶段 | 后端新增 | 前端新增 | 验收标准 |
|---|---|---|---|
| **M0 收尾**（下一步） | 把 `vault.rs` 拆成 `vault/`（model / storage / id / folder）；加 `error.rs`；加 `create_vault` / `list_entries` | `components/VaultSwitcher.tsx`、`components/FolderTree.tsx`、`pages/TimelinePage.tsx`（先假数据） | 新建仓库 → 建一条记录 → 在文件夹里看到它 |
| **M1 桌面 MVP（单窗口）** | `index/`（SQLite）+ `rebuild_from_vault`；`media-core`（缩略图 / EXIF / 哈希）；`vault/folder.rs` 的排序 / 置顶 / 绑定命令；`workspace/builtin/plain.rs` | 文件夹导航、内置普通记录功能主题、`GalleryPage`、`ReaderPage`（Markdown）、拖动排序与置顶 | 导入照片、生成缩略图、文件夹导航、排序置顶能持久化 |
| **M2 Android** | `capture/android.rs` + Kotlin 插件（`plugins-native/capture/`） | `lib/capabilities.ts`、`lib/platform/*`、移动外壳与断点 | 从 Entry 调系统相机并自动归档 |
| **M3 个性化** | 插件宿主骨架、权限校验、`workspace/registry.rs` 支持外部主题 | `styles/layers.css`、外观主题包加载、设置页、功能主题扩展点 | 换外观主题无需重编译；功能主题扩展点可用 |
| **M4 同步** | `storage/webdav.rs`、`sync/`、Stronghold | 同步状态与冲突处理界面 | 两设备互不覆盖、删除可传播 |
| **M5 开放生态** | Provider 插件化、Marketplace 协议、功能主题插件加载 | 插件市场 / 管理界面 | 侧载 + 自定义 Registry |

---

## 12. 工程约定（写代码前先看这节）

1. **一个文件一件事**：能用一句话概括它的职责；不能就拆。
2. **先定接口再写实现**：签名就是文档。
3. **领域层不认识 tauri**；一旦 `use tauri` 就说明分层错了。
4. **所有元数据写入走 `write_json_atomic`**，不要直接 `fs::write`。
5. **前端不写裸色值**，颜色都从 `tokens.css` 取。
6. **加依赖前先问：Rust 侧还是 JS 侧？** 加官方插件用 `pnpm tauri add`（它会做齐三处）。
7. **命名**：Rust 变量 / 字段 snake_case、类型 PascalCase；TS 同；CSS 用 `.block__element--modifier`。
8. **错误不吞**：命令返回 `Err(...)`，前端 `try / catch` 后显示到界面上。
9. **不预先铺空架子**：文件按第 11 节的阶段长出来。
10. **重要决定写 ADR**（`docs/adr/`）：记背景、方案、取舍、后果。
11. **状态分区**：持久化用户数据（主题绑定 / 排序 / 置顶 / 主题进度）经 Rust 落盘；当前选择、视图、面板开关各自独立管理，不混成一个 `page` 状态（详见 §14）。

---

## 13. 功能主题（Workspace Type）

### 13.1 两种"主题"要分清

| | 外观主题（Theme） | 功能主题（Workspace Type） |
|---|---|---|
| 改变什么 | 颜色、字体、圆角、间距、阴影 | **记录结构、内容区界面、操作流程、业务规则** |
| 技术形态 | 一组 CSS 变量（`--fv-*`） | 一份 manifest + 若干视图组件 + 校验规则 |
| 换掉之后 | 界面只是变好看，操作方式不变 | 用户像进入"另一个小应用"（普通记录 / 旅行 / 挑战） |
| 归属 | `packages/theme-sdk`（M3） | `workspace/`（后端）+ `workspaces/`（前端），M3 之后开放给插件 |

**一句判定法**：**把这个主题换掉，用户的操作流程会变吗？** 会 → 功能主题；只是"好看了" → 外观主题。

### 13.2 数据落点（都在 Vault 内，开放格式）

```text
<用户选的目录>/
├── vault.json
├── entries/<entry-id>/…            记录本体（不变）
└── folders/<folder-id>/folder.json 文件夹元数据 ← 新增
```

`folder.json` 的字段级设计：

```json
{
  "schemaVersion": 1,
  "id": "0199...",             // UUIDv7
  "name": "2026 跑步挑战",
  "parentId": null,            // null = 根级；不存绝对路径
  "order": 3,                  // 同级排序，拖动后重写
  "pinned": true,              // 置顶
  "workspaceType": "builtin.challenge",   // 绑定的功能主题 id
  "workspaceConfig": {}        // 主题自己的配置（如目标天数）
}
```

**四条规则**：

1. 这些是**用户数据**——排序、置顶、主题绑定、主题业务进度都必须落在 Vault 里，**不能只存在前端内存或 SQLite**（README「工程约定」最后一条就是这个意思）；
2. 记录自己的排序 / 置顶可以放 `entry.json` 的两个同名字段（不要引入第二套机制）；
3. 文件夹结构与记录一样用**原子写入**；
4. 不存绝对路径，父级用 `parentId` 表达。

### 13.3 解析与继承规则

```text
某个文件夹的生效主题 = 自己绑定的
                    ?? 最近的祖先绑定的
                    ?? builtin.plain（内置普通记录）
```

- 同一文件夹下的记录**共同遵循**该主题（README 原话）；
- 主题 id 找不到对应实现时 → **回退到 `builtin.plain` 并给出警告**，绝不因为缺插件就显示空白；
- 嵌套继承的细节（子文件夹能不能覆盖、能不能解绑）尚未定案，列在 PRD §12「仍需后续决策的问题」。

### 13.4 代码落点与接口

**后端**

| 文件 | 职责 | 接口（签名级） |
|---|---|---|
| `vault/folder.rs` | 文件夹元数据 | `read_folder(&Path, &str) -> io::Result<FolderMeta>`、`write_folder(&Path, &FolderMeta) -> io::Result<()>`、`list_folders(&Path) -> io::Result<Vec<FolderMeta>>`、`children_of(&Path, Option<&str>) -> io::Result<Vec<FolderMeta>>`、`reorder(&Path, Option<&str>, &[String]) -> io::Result<()>` |
| `workspace/mod.rs` | 功能主题契约 | `trait WorkspaceType { fn id(&self) -> &'static str; fn validate_entry(&self, &Entry) -> AppResult<()>; fn ui_manifest(&self) -> WorkspaceUiManifest }`、`struct WorkspaceUiManifest { id, label, views: Vec<ViewDecl>, default_view: String }` |
| `workspace/registry.rs` | 按 id 找实现 | `resolve(&str) -> &'static dyn WorkspaceType`（找不到时回退 plain） |
| `workspace/builtin/plain.rs` | 内置普通记录（M1 唯一实现） | 视图声明：timeline / gallery / reader |

**前端**

| 文件 | 职责 | 接口 |
|---|---|---|
| `lib/workspace.ts` | 取主题清单与当前文件夹的生效主题 | `listWorkspaceTypes()`、`getWorkspaceFor(folderId)`、`getUiManifest(typeId)` |
| `pages/WorkspaceHost.tsx` | **内容区宿主**：按 manifest 决定渲染哪个视图 | props: `folderId`、`viewId` |
| `workspaces/plain/TimelineView.tsx` 等 | 内置主题的各个视图 | props: `entries`、`onOpen` |
| `components/FolderTree.tsx` | 侧栏文件夹树（导航主入口） | props: `nodes`、`activeId`、`onSelect`、`onReorder`、`onTogglePin` |

**扩展点（M3 之后）**：功能主题以 `manifest + 视图组件` 的形式由插件提供；**UI 扩展点先做 declarative contributions**（声明式：命令、菜单、设置项、标签页元数据），需要复杂 UI 时才上 sandboxed iframe —— 与技术架构文档 §11.3 一致。

### 13.5 命令补充表（M0/M1）

| 命令 | 参数 | 返回 | 用途 |
|---|---|---|---|
| `list_folders` | — | `FolderNode[]` | 侧栏文件夹树（含 order / pinned / 生效主题） |
| `create_folder` | `name` / `parentId?` | `FolderNode[]` | 新建文件夹 |
| `rename_folder` | `id` / `name` | `FolderNode[]` | 重命名 |
| `move_folder` | `id` / `newParentId?` | `FolderNode[]` | 移动（含跨父级） |
| `reorder_folders` | `parentId?` / `orderedIds` | `FolderNode[]` | 拖动排序落盘 |
| `set_folder_pinned` | `id` / `pinned` | `FolderNode[]` | 置顶 / 取消置顶 |
| `bind_workspace` | `folderId` / `workspaceType` | `FolderNode[]` | 绑定功能主题 |
| `list_workspace_types` | — | `WorkspaceTypeInfo[]` | 可用主题清单 |
| `set_entry_pinned` / `reorder_entries` | `id` / `…` | `Entry[]` | 记录级排序与置顶 |

**注意**：这一批命令都返回**整个列表**（而不是只返回被改的那一条）。为什么？因为排序 / 置顶 / 继承都是**相对关系**，只回一条会让前端自己猜规则，两边迟早不一致。**关系型改动，返回全量。**

---

## 14. 前后端状态分区（别用一个 page 状态走天下）

README 工程约定最后一条要求：**功能主题绑定、用户排序、置顶与主题业务进度保存为开放元数据；当前选择、视图和面板开关分别管理，不混成单一 `page` 状态。**

落地成四类状态：

| 状态种类 | 例子 | 谁拥有 | 存哪 | 变更方式 |
|---|---|---|---|---|
| **持久化用户数据** | 文件夹排序、置顶、主题绑定、挑战进度、主题配置 | **Rust** | Vault 内 JSON（原子写入） | 命令 + 返回全量 |
| **当前选择** | 选中的文件夹、当前工作区视图 | 前端（展示用），可请求 Rust 恢复 | 内存（可选写 localStorage） | `useState` |
| **视图与面板开关** | 图库 / 列表切换、侧栏折叠、编辑面板显隐 | 前端 | 内存 | `useState` |
| **派生数据** | SQLite 索引、缩略图、搜索缓存 | Rust | 应用数据目录 | 命令；**可随时重建** |

**三条纪律**：

1. **持久化数据一律经 Rust 落盘**，前端不允许自己"记住"这些东西（哪怕 localStorage 很方便）；
2. **不要把这些塞进一个大对象**（例如 `page = { folder, view, panel, theme, order }`）。它们是四类不同的东西，生命周期和真相来源都不同；
3. 前端状态可以**乐观更新**（先改 UI 再等命令返回），但返回的全量数据必须**覆盖**本地状态——**Rust 是唯一真相来源**。

**为什么**：一旦把"用户排的序"和"当前打开的视图"混在一起，你会很快遇到"重启后顺序没了"或"切主题把排序重置了"这类 bug，而且很难查。**分区是给未来的自己省时间。**

---

---

## 附录 A：当前已实现清单（本文档写作时）

**后端**：`main.rs`；`lib.rs`（插件注册、状态初始化、关主窗口即退出）；`state.rs`（仓库注册表 + `vaults.json` 持久化）；`commands.rs`（8 个命令）；`vault.rs`（`Entry` 模型、原子写入、4 个单元测试）；`examples/demo.rs`。

**前端**：`main.tsx`（按窗口 label 分派）；`App.tsx`（外壳：**可拖动侧栏** + 导航 + 页面注册表）；`VaultManagerWindow.tsx`（第二窗口外壳）；`features/vault/VaultSwitcher.tsx`（仓库切换悬浮菜单）；`features/vault/VaultManagerPanel.tsx`（窗口内的管理面板）；`lib/api.ts`（全部命令包装）；`lib/pages.tsx`（注册表）；`pages/{Placeholder,VaultPage}`；`tokens.css`；`styles/reset.css`。

**验证状态**：`cargo test` 4 passed；`cargo check` 干净；`tsc --noEmit` 干净。

## 附录 B：已经踩过的坑（别重复踩）

| 坑 | 现象 | 正确做法 |
|---|---|---|
| 同步命令里建窗口 | 窗口建出来但**关不掉**，进程也不退出 | 窗口相关命令加 `#[tauri::command(async)]` |
| 忘记给第二个窗口授权 | 那个窗口里所有插件调用被静默拒绝 | `capabilities` 的 `windows` 要列出**每个**窗口 label |
| 用 URL 查询串区分窗口 | 参数被编码搞坏，窗口渲染错内容 | 前端读 `getCurrentWindow().label` 判断 |
| 只关主窗口 | 进程不退出（还有别的窗口活着） | `on_window_event` 里对主窗口 `CloseRequested` 调 `app.exit(0)` |
| 拿着锁做磁盘 IO | 并发时卡死 | 用 `{ }` 圈小临界区，IO 放锁外 |
| 文件行尾 CRLF | 编辑器保存后整个文件"变了" | `.gitattributes` + Prettier `endOfLine: "lf"` |
| 只盯着报错末尾看 | 被十几个连锁错误吓到 | **从第一个 error 开始修**，只看输出开头几十行 |

