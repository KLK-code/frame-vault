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
│  features/scene 场景  features/vault 仓库  lib/api.ts 唯一出口  tokens.css   │
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

#### `src-tauri/src/vault/` ✅（已按下面的形状拆开：mod / model / storage / id）
领域核心。**这个目录里永远不出现 `tauri`。**

| 文件 | 职责 | 对外接口（签名级） | 阶段 |
|---|---|---|---|
| `mod.rs` | 汇总导出 + 常量 | `pub const SCHEMA_VERSION: u32"` | M0 |
| `model.rs` | 数据结构 | `Entry { schema_version, id, title, tags, created_at, updated_at, media }`、`Media { id, kind, path, byte_size }`、`VaultMeta { schema_version, vault_id, name, created_at }` | M0 |
| `storage.rs` | 文件读写 | `write_entry(&Path, &Entry) -> io::Result<PathBuf>`、`read_entry(&Path, &str) -> io::Result<Entry>`、`list_entries(&Path) -> io::Result<Vec<Entry>>`、`delete_entry(&Path, &str) -> io::Result<()>`、`write_json_atomic<T: Serialize>(&Path, &T) -> io::Result<()>`、`ensure_vault(&Path) -> io::Result<VaultMeta>` | M0 |
| `id.rs` | ID 生成与校验 | `new_entry_id() -> String`（UUIDv7）、`is_valid_id(&str) -> bool` | M0 |
| `migration.rs` | schemaVersion 迁移 | `migrate_vault(&Path) -> io::Result<()>`、`is_supported(u32) -> bool` | M1 |
| `tombstone.rs` | 删除标记 | `mark_deleted(&Path, &str) -> io::Result<()>`、`list_tombstones(&Path) -> io::Result<Vec<Tombstone>>` | M4 |

#### `src-tauri/src/commands/` ✅（五个模块：`vault` / `folder` / `entry` / `media` / `window`）
接线盒。**一个命令只做三件事：收参数（校验）→ 调领域层 → 把结果/错误转成可序列化的形状。**
命令超过 6~8 个时拆成目录：

| 文件 | 命令 | 阶段 |
|---|---|---|
| `vault.rs` | `list_vaults` / `add_vault` / `create_vault` / `switch_vault` / `forget_vault` / `vault_exists` | ✅ 全部 |
| `folder.rs` | `list_folder_tree` / `create_folder` / `rename_folder` / `delete_folder` / `bind_folder_scene` / `set_folder_pinned` / `reorder_folders` / `list_scenes` / **主题**：`list_topics` / `create_topic` / `rename_topic` / `delete_topic` | ✅ 全部 |
| `entry.rs` | `new_id` / `save_entry` / `update_entry` / `delete_entry` / `restore_entry` / `load_entry` / `list_entries` / `reorder_entries` / `read_vault_meta` | ✅ 全部 |
| `media.rs` | `import_media`（`async`，含复制 / sha256 / 探尺寸 / 生成缩略图） / `list_media` | ✅ 本轮 |
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

### 4.1 曾经的乱，与一次方向性纠错

（记录于重构前）当时 `src/` 是平铺的：`App.tsx` / `tokens.css` / `styles/reset.css` / `lib/api.ts` / `lib/pages.tsx` / `pages/*.tsx` / `app/VaultManagerWindow.tsx`。文件不多，但规则不统一：

| 症状 | 具体表现 |
|---|---|
| 样式有三种放法 | `App.css` 在根、`tokens.css` 在根、`reset.css` 在 `styles/`、组件自己的跟组件同目录 |
| 组件里什么都干 | 取数据 + 转错误 + 渲染 + 写状态文案，全塞进一个文件 |
| 没有通用原语 | 按钮、空状态、错误提示每处各写一遍 |
| 外壳与内容互相知道 | `App.tsx` 里写死了"当前是哪个页面"的渲染分支 |

**被推翻的设计（重要）**：那时左侧是固定导航项（时间线 / 图库 / 日历 / 笔记），右侧是"页面"。这个模型错了——

- 左侧就是**场景**（= 一个文件夹 + 它绑定的主题），右侧是**那个场景的主题视图**；
- 于是 `lib/pages.tsx` 与 `pages/` 整套"页面注册表"被删除，换成 `features/scene/`；
- 教训：**把入口做成固定菜单，等于提前把数据模型的形状焊死在 UI 里**。

### 4.2 结构：外壳 / 场景 / 业务块 / 资源

```text
src/
├── main.tsx                  入口：按窗口 label 分派
├── App.tsx                   主窗口外壳：左场景树 + 右场景舞台 + 可拖分隔条
├── App.css
├── app/                      ── 外壳层：只管窗口与共用外框 ──
│   ├── TitleBar.tsx / .css     自绘标题栏（各窗口共用）
│   ├── window.css             独立窗口共用的外框布局
│   ├── VaultManagerWindow.tsx  管理仓库窗口外壳
│   └── SettingsWindow.tsx      设置窗口外壳
├── features/scene/           ── 场景层：本项目的"页面层" ──
│   ├── useFolders.ts          场景数据 + 按主题归类（groups，见 §4.4）
│   ├── SceneTree.tsx / .css    左侧：文件夹树（三种分组：按主题/按场景/平铺）+ 主题与文件夹的增删改
│   ├── SceneHost.tsx / .css    右侧：按 effectiveScene 找视图并渲染（含空态、缺主题提示）
│   ├── registry.ts            主题 id → 视图组件（**扩展点**）
│   ├── SceneComposer.tsx/.css  共用快捷录入（照片 / 文字，防重复提交）
│   ├── EntryTimeline.tsx/.css  共用时间线、编辑、媒体与删除入口
│   ├── SceneIcon.tsx          主题声明使用的线性图标
│   └── scenes/{plain,travel,challenge,writing}/  普通日记 / 旅行 / 挑战 / 写作台 自治单元
│       └── manifest.ts + index.ts + 视图.tsx + 同名.css
├── features/vault/           仓库：悬浮切换菜单 + 独立窗口里的管理面板
├── features/settings/        设置：左导航 + 右内容
├── features/theme/           设计令牌 schema + 实时编辑 + 跨窗口同步
├── lib/api.ts                唯一 invoke / listen 出口 + 与 Rust 对齐的类型
├── styles/layers.css         层顺序声明（@layer reset, base, components, theme, user）
├── styles/reset.css
└── tokens.css                设计令牌：**唯一允许出现裸色值的地方**
```

**依赖方向（不许反向）**：

```text
App.tsx ──▶ features/* ──▶ lib/api.ts ──▶ (invoke / listen) ──▶ Rust
   │
   └──▶ styles/ + tokens.css（只有变量；没人 import 别人的组件样式）
```

**外壳已经实现的交互**（都属于"视图状态"，存 `localStorage`，**不进 Vault**——见 §14）：

- **侧栏宽度可拖动**：分隔条用 Pointer 事件（鼠标与触摸通用），夹在 160~480px；双击复位；聚焦后按 ← / → 也能调；**松手才写 localStorage**（不要每帧写）。
- **仓库切换悬浮菜单**：侧栏底部的小按钮 → 向上弹出菜单，**只做切换**（外加一个进入管理窗口的入口）；点菜单外面或按 Esc 关闭。
- **写操作只在管理窗口里**：新建仓库 / 添加已有仓库 / 移除，全部放在独立窗口（`VaultManagerPanel`）。菜单是"顺手切一下"的地方，写操作放这儿误点代价大，何况"选目录 + 起名"本来就塞不进悬浮菜单。
- **两个窗口靠事件对齐**：管理窗口改完仓库集合，Rust 广播 `vault://changed`，主窗口的切换器和场景树各自重载——不要试图用 React 状态跨窗口同步。

### 4.3 四条规则（这才是"不乱"的关键）

| 规则 | 说明 | 例子 |
|---|---|---|
| **一个主题一个目录** | 主题视图 + 它私有的子组件 + 样式都放一起，删主题只删一个目录 | `scenes/plain/{PlainScene.tsx,PlainScene.css}` |
| **复用要"有人催"** | 第二个主题真要用才从 `scenes/<id>/` 升级到 `features/scene/` | 三个主题已共用 `SceneComposer` / `EntryTimeline`，数据仍由 `useSceneData` 提供 |
| **样式与组件同目录同名** | 全局样式只有 `styles/` + `tokens.css`；其余样式跟它服务的组件并排 | `SceneTree.css` 与 `SceneTree.tsx` 同目录 |
| **外壳不认识场景内部** | 外壳只认 `FolderNode` / `SceneInfo` 这两个契约类型，不认识任何主题的实现 | `App.tsx` 不 import 任何 `scenes/…` 里的东西 |

### 4.4 场景契约（新东西都在这一节）

**磁盘上扁平，展示层分组**——这是整个前端模型的核心一句话：

```text
Vault 里                    前端显示层
folders/<id>/folder.json    ┌ 挑战（主题）
entries/<id>/entry.json     │   ├ 晨跑打卡     ← scene: builtin.challenge
   ↑ 只有 folderId 指回去    │   └ 健身房       ← scene: builtin.challenge
顺序 / 置顶 / 主题绑定         └ 普通记录（主题）
                              └ 随手记        ← scene: null → builtin.plain
```

为什么记录不按文件夹物理嵌套：**移动 = 改一个字段**（同步工具只看到一个文件变），删场景不会牵动一堆子目录，索引（SQLite）坏了大不了重建。

前端只做两件事，分别落在两个文件里：

| 地方 | 干什么 | 关键代码 |
|---|---|---|
| `useFolders.ts` | 拉数据 + 按 `effectiveScene` **分组** | `groups: SceneGroup[]`（组的先后 = 组内第一个场景在整体排序里的位置，所以置顶某组里的场景整组会浮上来） |
| `SceneHost.tsx` | 拿当前场景的生效主题，从注册表找视图渲染 | `const View = SCENE_VIEWS[folder.effectiveScene]` |

**主题视图契约**（写新主题只需要满足这个）：

```tsx
// features/scene/registry.ts
export type SceneViewProps = {
  folder: FolderNode;          // 当前场景（含它自己的 sceneConfig）
  scene: SceneInfo;            // 主题元信息（名字、描述）
  onSceneConfigChange: (config: Record<string, unknown>) => Promise<boolean>;
};

// features/scene/scenes/<主题>/XxxScene.tsx
export default function XxxScene({ folder, scene, onSceneConfigChange }: SceneViewProps) {
  // 自己决定列什么、怎么录入；场景自己的参数写进 folder.sceneConfig（核心不解释）
}

// 公共件（**第二处用到才抽的**）：
//   mediaFormat.ts     格式化 + "这个格式 WebView 能不能显示"
//   MediaLightbox.tsx  点开大图 / 播视频
// 新主题直接复用，别再写第三份。
//
// 主题自己的字段按主题 id 命名空间存放：entry.fields["builtin.plain"].text
// 读取时兼容老数据（早期直接写在 fields 顶层），写入时只替换自己那一个命名空间。
```

**底层能力（主题必须用它，不许自己重造）**：`features/scene/useSceneData.ts`

| 能力 | 说明 |
|---|---|
| `entries` / `media` / `mediaOf(entryId)` / `dateOf(entry)` | 本场景的记录、只属于它的媒体、"这条按哪天算"（最早照片的拍摄时间，否则记录时间） |
| `create(title, text?)` / `edit(entry, { title?, fields? })` | 建一条 / 改一条；归属与创建时间由 Rust 保证不动 |
| `remove(entry)` / `undo()` / `notice` | **删除（写墓碑，可撤销）**；提示由 `SceneNotice` 显示，10 秒后消失 |
| `pickPhotos()` / `importPhotos(entryId, files)` | 原语：选文件、把文件导进某条记录（挑战用这两个自己编排"一张照片一条记录"） |
| `attachPhotos(entryId)` / `createWithPhotos(title)` | 便利组合：往已有记录加照片 / 新建一条并放照片 |
| `busy` / `error` / `reload()` | 忙碌与错误状态、手动刷新 |

**声明式渲染（主题怎么带来自己的"特殊功能"）**：主题在 `manifest.ts` 里声明，核心负责画出来。

| 声明 | 作用 | 现在的例子 |
|---|---|---|
| `entryFields` | 这个主题的记录上有什么字段（核心生成录入控件与展示） | 普通记录的「正文」 |
| `configSchema` | 这个场景的设置表单形状（存 `folder.sceneConfig`） | 挑战的「目标天数」「规则」 |
| `presentation` | 图标名、推荐外观，全部是纯数据（类别短语随舞台横幅一起删了，2026-09） | 宿主与外壳经注册表读取，不导入主题内部实现 |

**当前四个内置主题**：普通日记 `builtin.plain`、旅行 `builtin.travel`、挑战 `builtin.challenge`、**写作台 `builtin.writing`**。前三个视图各调用一次 `useSceneData`，再把结果传给共用录入和时间线；挑战另有照片墙展示；**写作台是唯一自己编排界面的主题**：左侧篇列表 + 右侧一整块所见即所得的编辑区（`MarkdownWysiwyg`，用 `React.lazy` 按需加载），表单仍交给 `SceneFields`、大图仍用 `MediaLightbox`，它没有一处自己写的输入控件。时间线按 `dateOf` 倒序显示，编辑合并本主题字段并保留其他命名空间与未知字段。`SceneHost` 按场景 id 与主题 id 给视图设置 key，切换场景时重置草稿和预览，避免串场景。

**默认外观**：旅行青绿、挑战炭黑橙色、日记暖白棕色。`tokens.css` 在 `@layer base` 内通过 `:root:has(.app-root[data-scene="…"])` 选择配色；变量仍定义在根元素，使用户内联覆盖保持最高优先级。旅行与日记支持深色变体，挑战默认固定深色基调。标题栏与手机骨架继承同一组变量；独立设置 / 仓库窗口不匹配这个选择器。

**要加"距离 / 时长"这类主题特有字段？在 manifest 里加两行声明即可**——不用改核心，也不用改别的主题。
这是"通用能力 vs 主题特有"的分界：**通用能力进 `useSceneData`；主题特有的一律先走声明**；
真到了声明表达不出来的那天（要跑自己的算法），才上主机 API + 权限声明（M3 之后，见 §11.6）。

**判据：什么该进核心？** 看它**会不会改变磁盘上的数据形状**。会（删除怎么标、字段怎么命名空间、照片归属怎么表达）
→ 必须进核心，所有主题共用一种格式；不会（卡片多大、点哪里、按什么排序）→ 留给主题。
这就是"基础功能默认做好"的真正理由：不是省事，是**格式统一**（一百个主题各写一套删除 = 一百种墓碑格式，Vault 就不再开放）。

**规则**：主题只决定"显示哪些、按什么顺序、点哪里触发哪个能力"。**不许在主题里再写一遍取数据 + 过滤 + 刷新**——
三个主题能同时具备"改文字 / 追加照片 / 删除撤销"，就是因为能力只有一份。

```tsx
```

四条约定：

1. **视图不取"当前仓库"，只认 props 里的 `folder`**——它天然就是"当前场景"；
2. **记录一律带 `folderId`**：保存时 `saveEntry(id, title, { folderId })`，主题由 Rust 按场景解析，前端不传主题 id；
3. **loading / error / empty 三态自己处理**（现在还没有通用原语，等第二个主题出现再抽——别提前抽）；
4. **认不出的主题不许白屏**：`SceneHost` 会显示一条提示并用"普通记录"兜底渲染，场景内容永远看得见。

**注册表就是扩展点**：前端 `registry.ts` 登记主题单元，同时在 Rust `builtin_scenes()` 登记同一 id，才能通过绑定主题校验。主题字段使用既有 `entry.fields` 开放区，无需改变核心 schema。将来主题以包的形式分发时再换成动态注册。

### 4.5 三个复用层级的判定

```text
只用一次          → 留在主题目录里（scenes/plain/…）
两个主题都要用     → 升级到 features/scene/
跟业务无关（纯 props）→ 升级到通用原语目录
```

**不要提前升级**。放进通用层的组件一旦带上业务字段，就会变成"什么都能塞的杂物间"。

### 4.6 样式归属规则

| 场景 | 放哪 | 例子 |
|---|---|---|
| 设计令牌**默认值** | 根目录 `tokens.css` | `--fv-color-text` |
| **外观预设**（一整套值） | 根目录 `skins.css`（`:root[data-appearance="preset.*"]`） | `preset.paper` / `preset.tide` / `preset.ember` / `preset.azure` |
| 浏览器默认样式归零 | `styles/reset.css` | `box-sizing`、`margin: 0` |
| 层顺序 | `styles/layers.css` | `@layer reset, base, components, theme, user;` |
| 外壳布局 | `App.css` / `app/window.css` | `.app`、`.sidebar`、`.content` |
| 组件 / 主题私有 | 与它同目录同名 | `features/scene/SceneTree.css` |
| 需要绝对隔离 | `*.module.css` | 包装第三方组件时 |

**每个 CSS 文件都必须包在 `@layer` 里**（否则层顺序形同虚设）；组件里**不许出现裸色值**——颜色 / 间距 / 字号 / 圆角 / 阴影一律走 `--fv-*`。
**尺寸只在"会被别处引用或需要主题覆盖"时才起 token**（`--fv-titlebar-height` / `--fv-titlebar-inset-mac` 就是这种：前者还得跟 `tauri.conf.json` 对齐）；
只在一个组件里用的布局数值（网格列宽、`aspect-ratio`、`1px` 细线）写具体像素，别为了凑规则硬造 token。

**网格与滚动容器的写法（定死的，不是口味问题）**：

| 要写的东西 | 照这个写 | 为什么 |
|---|---|---|
| 网格列 | `repeat(auto-fill, minmax(最小, 上限))`，上限给**具体像素** | `1fr` 是「余量全给我」：每掉一列所有格子一起膨胀一次，拖窗口就像在抖（详见附录 B） |
| 纵向滚动容器 | `scrollbar-gutter: stable;` + `overflow-x: hidden;` + `overflow-y: auto;`（**长写**） | 滚动条出现/消失会改容器宽度；`auto` 简写会把另一个轴重置回去 |

现在只有四处网格，数值如下 —— **改任何一处，同步这一节与 AGENTS §9**：

| 网格 | 在哪 | 现在 |
|---|---|---|
| 记录里的缩略图 | `scenes/plain/PlainScene.css` 的 `.entry__media` | `minmax(112px, 176px)` |
| 打卡墙 | `scenes/challenge/ChallengeScene.css` 的 `.wall` | `minmax(148px, 220px)` |
| 手机照片墙 | `SceneMedia.css` 的 `.photo-grid` | `minmax(104px, 168px)` |
| 写作台照片区 | `scenes/writing/WritingScene.css` 的 `.writing__photos-body` | `minmax(96px, 132px)` |

代价要讲清楚：给了上限，**窗口很宽时最右边会留一点白**（格子不再无限撑大）。

**外壳的类名由外壳拥有**：组件不该去写 `.content` 或 `.sidebar`。它拿到的只是"一块可用区域"。

### 4.7 这次重构实际做了什么（可复用为下次的模板）

| 步 | 做什么 | 验证 |
|---|---|---|
| 1 | Rust 侧先把模型改平：删 `parentId` / 继承 / `move_folder`，加 `delete_folder` / `new_id` / `vault://changed` | `cargo test` 12 passed（含"老文件多出废弃字段仍能读"） |
| 2 | `api.ts` 对齐契约：`listFolderTree` / `createFolder(name, scene)` / `bindFolderScene` / `saveEntry(…, { folderId })` / `onVaultChanged` | `pnpm exec tsc --noEmit` 干净 |
| 3 | 写 `useFolders.ts`：数据 + 分组，写操作统一"Rust 回全量列表 → 直接替换"（不做乐观更新） | 新建/改名/置顶/换主题各点一遍 |
| 4 | 写 `SceneTree` + `SceneHost` + `PlainScene`，改 `App.tsx` 挂上去 | 三处同看：终端 `println!` / 界面 / `folders\`entries\` 目录 |
| 5 | 删 `lib/pages.tsx`、`pages/`（`grep` 确认没有残留 import） | `pnpm build` 通过 |
| 6 | 更新本文档 §4 / §5 / §13 与 `theme-contract.md` | 文档里搜不到 `move_folder` / `parentId` |

**纪律**：每一步结束都跑一次 `pnpm exec tsc --noEmit`（外加 `cargo test`，如果动了 Rust）；出问题只可能是刚做的那一步。

**⚠️ 改了 Rust 命令名必须重启 `pnpm tauri dev`**：Vite 的 HMR 只换前端，跑着的二进制还是旧的命令表，前端会报 `command xxx not found`。

### 4.8 什么时候引入路由库 / 状态库

| 引入什么 | 触发条件 | 现在需要吗 |
|---|---|---|
| react-router 等路由库 | 需要 **URL 参数 / 前进后退 / 深链接** | ❌ 不需要，"当前场景"就是 `useState` + 一个注册表 |
| Zustand / Jotai 等状态库 | 出现"服务端状态缓存"痛点（同一份远端数据多处用、要失效策略） | ❌ 不需要，Rust 是唯一数据源，`useFolders` 够用 |
| CSS-in-JS | 需要运行时主题计算 | ❌ 不需要，CSS 变量就是干这个的 |

**为什么先不引入**：现在前端只是**展示 + 转发**，引入路由和 store 会让"谁说了算"变模糊，也让你多学两个库却解决不了当下的问题。

---

### 4.9 Markdown 渲染（核心能力，不是主题私有）

```text
src/markdown/parse.ts              唯一出口：parseMarkdown(text) → MdNode 树（别处不许 import remark）
features/scene/markdown/           渲染与输入（要用 vault 资源地址，所以放场景域）
  MarkdownView.tsx  registry.ts  blocks.tsx  MarkdownView.css
```

为什么分两层：解析是纯函数（给字符串出树，跟场景无关）→ 通用层；渲染要用 vault 的资源地址 → 场景域。
为什么自建注册表：主题 / 插件将来要加自定义块，扩展点是 `registry.ts`（节点名 → 渲染函数），不是改核心。

三条规矩：

1. 原始 HTML 不渲染：mdast 的 `html` 节点给一条看得见的提示，不静默丢弃、更不执行（整条链路不产生 HTML 字符串，所以不需要 sanitizer）；
2. 认不出的节点降级显示：有文字显示文字、有子节点显示子节点 —— 跟「认不出的主题不许白屏」同一条规矩；
3. 只读投影，绝不回写：渲染不改 `fields`，也不产生任何落盘数据。

两条刻意的取舍：

- 软换行按换行显示（文本节点里的换行转成 `<br>`）：日记 / 手机记录的习惯是敲了就换行，不按 CommonMark 合并成空格；
- 图片暂不渲染：Vault 内的图片引用语法还没定，先给可见提示（免得主题各自发明引用写法）。

这个阶段明确不做：自建 Document Model（等有第二个消费者）、`remark-rehype` / `rehype-react`（直连 React，少两个依赖且不产生 HTML）、`remark-directive` 自定义块（等真有主题要用）、语法高亮。

**输入侧（同一层）有两种编辑器，主题只挑"用哪个"**：

- `MarkdownField.tsx` = textarea + 语法工具栏 + 编辑 / 预览切换。`SceneFields` 渲染多行字段时用的就是它，所以**所有主题自动都有**；
- `MarkdownWysiwyg.tsx` + `livePreview.ts` = 一整块所见即所得的编辑区，内核是 **CodeMirror 6**（`@codemirror/*` + `@lezer/markdown`，MIT）：**文档本身就是 Markdown 文本**，装饰决定语法符号藏还是显。现在只有写作台用它，**`React.lazy` 按需加载**（带着 CM6 家族；实测主包 417.68 KB + 独立 chunk 500.68 KB / gzip 174.14 KB，写作台之外一行都不下载）。
  **为什么从 ProseMirror 换过来**（2026-09，见 `docs/PROPOSAL_editor_codemirror6_zh-CN.md`）：PM 的文档是节点树，`**` 根本不在文档里，要做"光标所在处露源码"只能把整块序列化成文本再换成一个控件 —— 于是必然有盒子、有层切换、选区被困在控件里。文档即文本之后，这三样一起消失。
- **粘贴不需要特殊处理**：纯文本原样插入，因为插入的就是 Markdown，当场按装饰规则渲染（旧的 `handlePaste` + `looksLikeMarkdown` 判据已删）。**已知回退**：从浏览器复制的富文本只剩文字，不做 HTML→MD 转换。

- **实时渲染（live preview）**：整篇按排版渲染，**语法符号只在光标碰到的地方露**——块级记号（`# ` / `> ` / `- ` / 围栏）按行露，行内记号（`**` / `` ` `` / `[](…)`）按令牌露，移开立刻收回（Obsidian / Typora 手感）。实现分两半，因为 **CM6 只允许 `StateField` 提供行级与块级装饰**（`ViewPlugin` 提供会抛 `RangeError` 且整块不渲染）：`outer`（行级类名、整块 widget、表格）走 StateField，`inner`（行内记号与 widget）走 `ViewPlugin` 且只遍历 `view.visibleRanges`。装饰样式在 `MarkdownWysiwyg.css`；**结构性那几条**（滚动容器 / 内边距 / 光标 / 字号）写在 `MarkdownWysiwyg.tsx` 的 `EditorView.theme` 里 —— 因为 CM6 注入的基础样式是**未分层**的，`@layer` 里的规则压不过它。

**编辑引擎 ≠ 渲染引擎**：`MarkdownView` 负责"把 Markdown 显示成排版"（只读投影，核心唯一的渲染器，主题不许另写）；`MarkdownWysiwyg` 负责"让你不看见语法符号地打字"（可写，是全仓库唯一 import `@codemirror/*` / `@lezer/*` 的地方）。两者之间只有磁盘上那一串 Markdown 文本，所以**记录用哪个编辑器敲的，磁盘格式、渲染器、主题都不知道**。

四个坑（都写在代码注释里，也进了附录 B）：工具栏按钮要在 `onMouseDown` 里 `preventDefault`（否则手机键盘当场收起）；插入用 `setRangeText` 而不是自己拼字符串（自己拼会清掉浏览器撤销栈）；中文输入法 `composition` 期间不碰选区；**所见即所得编辑器只在"外部换了内容"时回灌**（用 ref 记住自己刚 `onChange` 出去的那份做比对）——每次渲染都 `replaceAll` 会跟打字打架，光标跳、输入法串断、撤销栈被清。

公开类名见 `docs/theme-contract.md` §2 的「Markdown 输入控件」「Markdown 所见即所得编辑器」「Markdown 正文」三行。

## 5. 前后端契约（最重要的一节）

### 5.1 命令全表

| 命令 | 参数（前端传） | 返回 | 用途 | 状态 |
|---|---|---|---|---|
| `list_vaults` | — | `VaultInfo[]` | 取仓库列表 + 当前项 + 目录是否还存在 | ✅ |
| `add_vault` | `path` | `VaultInfo[]` | 添加已有仓库（必须是带 vault.json 的目录；并设为当前） | ✅ |
| `switch_vault` | `path` | `void` | 切换当前仓库 | ✅ |
| `forget_vault` | `path` | `VaultInfo[]` | 从列表移除（**不删磁盘文件**） | ✅ |
| `create_vault` | `path` / `name`（留空取目录名）/ `createdAt` | `VaultInfo[]` | 在某目录里建 Vault（写 vault.json 身份） | ✅ |
| `new_id` | — | `string` | 发一个 UUIDv7 记录 id（前端不自己拼时间戳 id） | ✅ |
| `save_entry` | `id` / `title` / `createdAt?` / `updatedAt?` / `folderId?` / `day?` / `note?` | `EntryView` | 写一条记录（主题**由所属场景解析**后快照进 `scene`）。**新建时算出目录名建目录**；`day` = 创建日（前端给，Rust 无时钟），`note` = 正文（写 `note.md`）；换 `folderId` 会**真的搬目录** | ✅ |
| `update_entry` | `id` / `title?` / `fields?` / `note?` / `updatedAt?` | `EntryView` | 编辑已有记录：**只改给到的部分**，归属与创建时间不动（`fields` 整体替换，不深合并）；改了标题会**连目录一起改名**（手动改过名的除外） | ✅ |
| `delete_entry` | `id` / `deletedAt` | `EntryView` | **把整个记录目录挪进回收站**（`.framevault/trash/`，保留原目录名）并写墓碑；撤销 = 挪回来 | ✅ |
| `restore_entry` | `id` / `now` | `EntryView` | 撤销删除：挪回原场景（场景没了就回「未归类」），清墓碑 | ✅ |
| `load_entry` | `id` | `EntryView` | 读一条记录（含 `note`，来自 `note.md`） | ✅ |
| `list_entries` | `folderId?` / `includeDeleted?` | `EntryView[]` | 列记录（**手动排过的块在前按 order，没排过的按时间降序**；**墓碑默认不出现**，要看回收站才传 `includeDeleted`）。内部是**扫盘**：场景目录下的记录 + 未归类容器 + 回收站 | ✅ |
| `reorder_entries` | `orderedIds` | `EntryView[]` | 手动排序：把当前场景的记录 id 按**新顺序**整表发来，按位置写 `order` 0..n（只认活记录，没发到的不动；order 改动不触发目录改名）。返回该场景全量 | ✅ |
| `read_vault_meta` | — | `VaultMeta` | 读 vault.json（校验身份与布局版本；**v1 仓库在这里被拒**） | ✅ |
| `import_media` | `sourcePath` / `entryId` / `nameTemplate?` / `addedAt` | `MediaItem` | 把一个文件**复制进记录目录**，按模板命名（算 sha256 / 探尺寸 / 生成缩略图）；`entryId` **必填**，`async` 命令，不占主线程 | ✅ |
| `list_media` | `entryId?` | `MediaItem[]` | 列媒体（新的在前）：**从各条记录的 `media[]` 汇总**（不再扫 `media/`），返回原文件与缩略图的**绝对路径** | ✅ |
| `list_folder_tree` | — | `FolderNode[]` | 全部场景（已排序；含 `scene` / `effectiveScene` / `order` / `pinned`） | ✅ |
| `create_folder` | `name` / `scene?` / `topic?` | `FolderNode[]` | 新建**文件夹**：起名 + 选场景（怎么记）+ 选放哪个**主题**下（`topic: null` = 直接摆根下，没有主题；主题不存在会报错，不偷偷建目录） | ✅ |
| `list_topics` | — | `string[]` | **主题**清单（根下不带 `folder.json` 的一级目录）；空主题也要列出来 | ✅ |
| `create_topic` | `name` | `string[]` | 新建主题 = 建一个目录（**不写任何文件**：主题没有字段） | ✅ |
| `rename_topic` | `name` / `newName` | `string[]` | 主题改名 = 改目录名（里面的文件夹跟着换主题） | ✅ |
| `delete_topic` | `name` | `string[]` | 删除主题；**里面还有东西就拒绝** | ✅ |
| `rename_folder` | `id` / `name` | `FolderNode[]` | 给场景改名 | ✅ |
| `delete_folder` | `id` | `FolderNode[]` | 删场景；**里面还有记录时拒绝**（不让记录变孤儿） | ✅ |
| `bind_folder_scene` | `id` / `scene?` / `sceneConfig?` | `FolderNode[]` | 换主题（`null` = 退回内置普通记录） | ✅ |
| `set_folder_pinned` | `id` / `pinned` | `FolderNode[]` | 置顶 / 取消置顶 | ✅ |
| `reorder_folders` | `orderedIds` | `FolderNode[]` | 排序落盘（SceneTree 拖拽已接：三种分组模式均可拖，**只允许同组内**重排，提交的是全量显示顺序） | ✅ |
| `list_scenes` | — | `SceneInfo[]` | 可用主题清单（现在只有 `builtin.plain`） | ✅ |
| `open_vault_manager` | — | `void` | 打开管理窗口（已开则聚焦） | ✅ |
| `close_vault_manager` | — | `void` | 关闭管理窗口 | ✅ |
| `open_settings` | — | `void` | 打开设置窗口（已开则聚焦） | ✅ |
| `close_settings` | — | `void` | 关闭设置窗口 | ✅ |
| `sync_now` / `sync_status` | — | `SyncReport` / `SyncState` | 手动同步 / 查状态 | ⬜ M4 |

### 5.2 事件全表（后端 → 前端推送）

| 事件名 | 负载 | 场景 |
|---|---|---|
| `vault://changed` | `()`（空负载） | 新建 / 导入 / 切换 / 移除仓库后广播：每个窗口据此重载场景树与记录。**每个窗口是独立的 `document`**，只靠 React 状态同步不了 |
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

**移动端的硬约束：只有一个 WebView 窗口。** 桌面端「管理仓库」「设置」是独立窗口（`open_vault_manager` / `open_settings`），
而 Android / iOS 上开不出第二个窗口 —— 所以移动端必须把它们做成**内嵌页面**（见 `app/MobileShell.tsx`）。

**两套骨架，一份能力。** 桌面 = 左场景树 + 右场景舞台（`App.tsx` 的 `DesktopShell`）；
手机 = 顶部场景切换 + 主题渲染区 + 底部标签栏（`app/MobileShell.tsx`）。
两者共用 `useFolders` / `useActiveFolder` / `useSceneData` / `SceneHost`，**区别只有编排**。
**共用的那份状态（场景树 + 当前选中的场景 + 它的主题信息）挂在 `App` 上**，经 `SceneShellProps` 传给骨架；
骨架自己只留视图开关（侧栏宽度、当前标签、弹层）。跨断点会换掉骨架组件，
状态要是挂在骨架里就跟着一起重建 —— 那就是"缩一下窗口跳回第一个场景"的成因。
选哪套由 `lib/useCompact.ts`（视口宽度，响应式）与 `lib/platform.ts` 的 `isMobileOS`（能不能开第二个窗口）共同决定。
窄屏的横切调整集中在 `styles/compact.css`，**全部包在媒体查询里**，桌面端不受影响。

**骨架之上永远有"窗口外壳"。** 自绘标题栏（`app/TitleBar.tsx`）不是骨架的一部分，而是**窗口**的一部分：
Windows 的窗口是 `decorations: false`，那块标题栏是唯一能拖动 / 最小化 / 关闭的地方；
macOS 靠它给红黄绿留位。所以规则是：**除真移动端（系统自己管窗口）外，每套骨架都要在最上面渲染它**，
整屏弹层也必须只盖"骨架那一片"（`position: absolute` 相对骨架），别用 `fixed; inset: 0` 把标题栏一起盖掉 ——
否则会出现"窗口拖不动、关不掉"这种只有强杀进程才能出来的故障。

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
| **M0（已完成）** | `vault/` 拆分（model / storage / id / folder / scene）；`error.rs`；`state.rs`；`commands/` 五个模块（21 个命令） | `features/scene/`（场景树 + 场景宿主 + 注册表 + `useFolders`）、`features/vault/`、`lib/api.ts` | 新建仓库 → 新建场景 → 记一条 → 在场景里看到它。**方向修正**：目录嵌套改为「仓库扁平 + 展示层按主题归类」 |
| **M1 桌面 MVP（单窗口）** | `index/`（SQLite）+ `rebuild_from_vault`；`media-core`（缩略图 / EXIF / 哈希）；`delete_entry` / `update_entry`；`scene.rs` 注册更多内置主题 | 主题视图：普通记录的图库 / 阅读视图、拖动排序与置顶接 UI、`scenes/<主题>/` 骨架 | 导入照片、生成缩略图、场景导航、排序置顶能持久化 |
| **M2 Android** | `capture/android.rs` + Kotlin 插件（`plugins-native/capture/`） | `lib/capabilities.ts`、`lib/platform/*`、移动外壳与断点 | 从 Entry 调系统相机并自动归档 |
| **M3 个性化** | 插件宿主骨架、权限校验、`vault/scene.rs` 支持注册外部主题 | `styles/layers.css`、外观主题包加载、设置页、功能主题扩展点 | 换外观主题无需重编译；功能主题扩展点可用 |
| **M4 同步** | `storage/webdav.rs`、`sync/`、Stronghold | 同步状态与冲突处理界面 | 两设备互不覆盖、删除可传播 |
| **M5 开放生态** | Provider 插件化、Marketplace 协议、功能主题插件加载 | 插件市场 / 管理界面 | 侧载 + 自定义 Registry |

---

> **进度偏差**：挑战主题（打卡墙 / 进度 / 连续天数）比计划提前落地了（原计划放在后期），但只做了"只统计不清零"的那一半——时长边界、违规判定、轮次重启按 PRD §12 第 16 条仍待定。

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

### 13.1 外观主题 / 功能主题：两件事，靠 CSS 作用域分开

| | 外观主题（Theme） | 功能主题（Workspace Type） |
|---|---|---|
| 决定什么 | **整个软件的风格**：配色、字体、圆角、间距、阴影 | 某个场景里的**玩法**：字段、编辑方式、视图、流程 |
| 形态 | 一整套 `--fv-*` 的值 = 一个**预设**（`preset.*`）；外加「组件规则」这种手段（改密度 / 边框 / 布局细节，稳定性较弱） | 一份 manifest + 视图组件（`features/scene/scenes/<id>/`） |
| 挂在哪 | `:root[data-appearance="preset.x"]` —— **所有窗口、所有区域** | **舞台容器**（`data-scene`）—— 作用域碰不到外壳 |
| 代码落点 | `src/tokens.css`（默认值）、`src/skins.css`（预设）、`features/theme/`（选择与实时覆盖） | `features/scene/scenes/*` + `vault/scene.rs` 登记同一个 id |

**功能主题的「巧思」白名单**（只挂舞台容器）：图标、`--fv-scene-banner`、主题视图自己的排版。
**不许**改底色 / 文字色 / 字号 / 间距 / 圆角尺度（那是“整个软件”的骨架），**不许**给外壳（标题栏 / 侧栏 / 设置窗口）着色。

**优先级链**：用户单值覆盖 > 预设 > `:root` 默认；选哪套预设：用户选过 > 主题的 `suggestedAppearance` 推荐 > 默认预设。认不出的预设 / 主题 → 回退默认，不白屏。

**一句判定法**：换掉它，用户的**操作流程**会变吗？会 → 功能主题；只是“整个软件换个样子” → 外观主题。
**第二条判定法**：这条样式会影响**别的区域**（标题栏 / 侧栏 / 设置窗口）吗？会 → 它属于外观，**不许**写在主题里。

### 13.2 数据落点（都在 Vault 内，开放格式）

2026-09 新增的旅行字段为 `fields["builtin.travel"].location` / `.text`，挑战心得为 `fields["builtin.challenge"].text`，日记正文继续使用 `fields["builtin.plain"].text`；均走现有开放字段区与原子写盘通道，不改 `SCHEMA_VERSION`。读取仍兼容早期顶层字段。主题展示声明与默认配色不写进 Vault。

**磁盘布局（v2「人可读层级」，2026-09 落地）**：

```text
<用户选的目录>/
├── vault.json                      身份文件（有它才算 Vault；layout: 2）
├── .framevault/trash/<原目录名>/    删掉的记录挪这儿（撤销 = 挪回原文件夹）
├── 科研/                           **主题**：一级目录 + **没有 folder.json**（不存任何字段）
│   └── 论文笔记/                    文件夹：folder.json 绑一个**场景**（怎么记）
│       └── 2026-09-23 周报/         记录
│           ├── entry.json          id / day / 时间戳 / 标题 / fields / media[]
│           ├── note.md             正文（唯一真相，不进 entry.json）
│           └── 2026-09-23_论文笔记_01.jpg
├── 晨跑打卡/                       文件夹也可以直接摆根下 = **没有主题**
└── 未归类/                         没有文件夹的记录（默认容器，按名字认）
```

**三层各管一件事**（2026-09 拍板，见 `docs/PROPOSAL_topics_scenes_zh-CN.md`）：

| 层 | 是什么 | 形态 |
|---|---|---|
| **主题** | 记录讲的**内容**（科研 / 旅游 / 挑战…） | **数据**：一层目录，**不存字段**（位置派生） |
| **文件夹** | 一堆记录 + 绑的**场景** | 数据：`folder.json`（`scene` + 配置） |
| **记录** | 一条内容 | 数据：`entry.json` + `note.md` + 媒体 |
| **场景** | 记录**怎么记**（随心记 / 认真写作 / 拍照打卡） | **代码**：`features/scene/scenes/<id>/` + `builtin_scenes()` |

认目录**只有一条规则**：一级目录带 `folder.json` = 文件夹；不带 = 容器（主题）；
容器里既可以放文件夹，也可以直接放记录（「未归类」按名字认 —— 写路径要一个确定落点）。

**三条"名字"规矩**（唯一出口是 `vault/naming.rs`）：

1. **名字就是名字**：`FolderMeta.name` 等于场景目录名，`Entry.title` 等于记录目录名去掉
   `"{创建日} "` 前缀 —— 所以不存在"界面上叫 A、磁盘上叫 B"，也不需要额外的目录名字段；
2. **改名跟着走**：应用内改标题 / 改场景名 → 算出新目录名 → `rename`（撞名加 ` (2)`）；
   但**当前目录名与按旧值算出来的名字不一致**时（说明用户手动改过），从此只写内容、永久不动目录名；
3. **磁盘为准**：记录属于哪个场景，看它住在谁的目录里（父目录是场景 → 该场景；父目录是未归类容器
   / 直接摆在根下 → `folderId = null`）。用户在资源管理器里挪动、改名，扫一次就跟着认。
   不需要"id → 路径"缓存，一次扫描就是一次真相。

**媒体**：本体住在记录目录里，**只有一个名字 `MediaMeta.file`**（导入时按模板生成、之后跟着改名走）——
界面显示与路径拼接一律用它，导入前的原名不存。文件名在导入那一刻按场景 manifest 声明的模板生成一次
（`{date}` / `{scene}` / `{title}` / `{field:<key>}` / `{n}`，不声明就走核心默认 `{date}_{scene}_{n}`），
之后永不自动改。元数据（文件名 / 原名 / 尺寸 / 哈希 / 拍摄时间）收在记录的 `media[]` 里 ——
**不再有全局 `media/` 目录，也没有"无主媒体"**（见 §13.6）。

`folder.json` 的字段级设计：

```json
{
  "schemaVersion": 2,
  "id": "0199...",                       // UUIDv7
  "name": "2026 跑步挑战",
  "order": 3,                            // 全局排序（仓库层面是平的，没有“同级”一说）
  "pinned": true,                        // 置顶：永远排最前
  "scene": "builtin.challenge",          // 绑定的主题 id；null / 缺省 = builtin.plain
  "sceneConfig": {}                      // 主题自己的配置（如目标天数），核心不解释
}
```

**五条规则**：

1. 这些是**用户数据**——排序、置顶、主题绑定、主题业务进度都必须落在 Vault 里，**不能只存在前端内存或 SQLite**（README「工程约定」最后一条就是这个意思）；
2. 记录自己的排序 / 置顶可以放 `entry.json` 的两个同名字段（不要引入第二套机制）；
3. 文件夹结构与记录一样用**原子写入**；
4. **不存绝对路径**，也**不存父级**——仓库层面是平的（见 §13.3）；
5. 新增字段一律 `#[serde(default)]`，而且**删掉的字段留在老文件里也不能报错**（serde 默认忽略未知字段，有单元测试守着这件事）。

### 13.3 生效主题与“归类”

```text
某个场景的生效主题 = 自己绑定的 scene ?? builtin.plain（内置普通记录）
```

- **仓库层面是平的**：场景之间没有父子关系，所以没有“继承”这回事——一个场景绑什么主题就是什么主题；
- 同一场景下的记录**共同遵循**该主题（README 原话）。写入时会把生效主题**快照**进 `entry.scene`：将来场景换了主题，老记录仍能按当时的规则解释；
- 主题 id 找不到实现时 → **回退到 `builtin.plain` 并给出提示**，绝不因为缺插件显示空白；
- **“归类”是展示层的事**：前端按 `effectiveScene` 把同类场景聚成一组（“挑战”下面同时挂着跑步和健身房）。想把跑步挪到别组，只改绑定主题，磁盘上的记录一条都不动。

> 为什么不做目录嵌套：嵌套会让“移动”变成一串路径改写，同步工具看到一堆文件变化，索引还得跟着重建。
> 扁平存放 + 记录上带一个 `folderId`，**移动 = 改一个字段**。

### 13.4 代码落点与接口

**后端**

| 文件 | 职责 | 接口（签名级） |
|---|---|---|
| `vault/model.rs` | 记录与仓库身份 | `Entry { folder_id, scene, fields, … }`、`VaultMeta`、`SCHEMA_VERSION` / `is_supported` |
| `vault/folder.rs` | 场景（文件夹）元数据 + 排序 | `read_folder` / `write_folder` / `list_folders` / `delete_folder`、`sort_folders`（置顶→order→名称）、`next_order`、`FolderMeta::effective_scene()` |
| `vault/scene.rs` | 内置主题登记 | `PLAIN_SCENE`、`builtin_scenes() -> Vec<SceneInfo>`、`is_known(&str) -> bool` |
| `vault/storage.rs` | 落盘 | `write_json_atomic`（tmp + rename）、`read_json`、`is_vault`、`create_vault`、`list_entries` |
| `commands/folder.rs` | 场景命令（薄适配器） | `FolderNode` + 8 个命令；**业务规则一条都不在这层** |

**前端**

| 文件 | 职责 | 接口 |
|---|---|---|
| `features/scene/useFolders.ts` | 场景数据 + 按主题**归类** | `useFolders() -> { folders, scenes, groups, create, rename, remove, togglePinned, bindScene }` |
| `features/scene/registry.ts` | 主题 id → 视图组件（扩展点） | `SCENE_VIEWS: Record<string, ComponentType<SceneViewProps>>` |
| `features/scene/SceneHost.tsx` | 右侧宿主：按 `effectiveScene` 渲染 + 空态 + 缺主题兜底 | props: `{ folder: FolderNode \| null, scene: SceneInfo \| null }` |
| `features/scene/EntryMenu.tsx` | 记录的**右键菜单**（桌面右键 / 触摸长按）；条目由调用方给，删除走 `useSceneData.remove`（写墓碑 + 可撤销提示） |
| `features/scene/SceneTree.tsx` | 左侧：文件夹树（**三种分组方式**：按主题 = 磁盘的样子 / 按场景 / 平铺，记在 localStorage）+ 主题的建改删 | props: `{ folders, groups, topicGroups, topics, scenes, activeId, onSelect, onCreate, onRename, onDelete, onTogglePinned, onBindScene, onCreateTopic, onRenameTopic, onDeleteTopic, onToggleCollapsed }` |
| `features/scene/scenes/plain/PlainScene.tsx` | 内置普通记录视图（也是写新主题的骨架示例） | props: `SceneViewProps` |

**扩展点（M3 之后）**：功能主题以 `manifest + 视图组件` 的形式由插件提供；**UI 扩展点先做 declarative contributions**（声明式：命令、菜单、设置项、标签页元数据），需要复杂 UI 时才上 sandboxed iframe —— 与技术架构文档 §11.3 一致。

### 13.5 还没做的命令（M1+）

| 命令 | 参数 | 返回 | 用途 |
|---|---|---|---|
| `set_entry_pinned` / `reorder_entries` | `id` / `…` | `Entry[]` | 记录级排序与置顶 |
| `sync_now` / `sync_status` | — | `SyncReport` / `SyncState` | 手动同步 / 查状态（M4） |

**注意**：已经实现的命令请查 §5.1 全表——这里只列还没做的，避免两处各写一份、早晚不一致。

---

### 13.6 媒体落点（本轮新增）

```text
<vault>/media/<media-id>/
├── orig.jpg      原始文件本体，导入后**不可变**（PRD FV-SYN-003）
└── meta.json     原名 / 扩展名 / MIME / 大小 / 宽高 / sha256 / entryId / addedAt / takenAt
```

四条规则：

1. **磁盘上叫 `orig.<ext>`，不用用户的原文件名**——导入路径与存储分离（PRD §6.1），躲开中文 / 空格 / 重名 / 大小写；原名只在 meta 里做展示；
2. **换归属 = 改 meta 里的 `entryId`**，不搬动几 GB 的文件（和记录扁平化同一个理由）；导入时也是“先落盘、再挂到记录上”两步；
3. **缩略图不进 Vault**：`%APPDATA%/com.framevault.app/thumbs/<vault-id>/<media-id>.jpg`，可随时重建（PRD FV-SYN-002）；
4. **媒体进 WebView 的唯一通道是 asset 协议**：Cargo 开 `protocol-asset` + `tauri.conf.json` 开 `assetProtocol`，运行时只 `allow_directory` **当前 Vault 和它的缩略图缓存**——不用 `**` 把整台机器打开。前端一律走 `assetUrl()`（`api.ts` 里包着 `convertFileSrc`），绝不手拼路径。

5. **拍摄时间要读 EXIF（`takenAt`）**：拍照那天才是打卡墙 / 日历该用的日期；读不到（截图、微信导出图都没有 EXIF）就退回 `addedAt`，**不许把导入日当成拍摄日**。

> 为什么缩略图放本机：它是**派生数据**。放进 Vault 只会让同步白搬几 GB，还会在每台设备上各自冲突；丢了在导入时重建即可。

**不假装能显示**：HEIC / AVIF 这类 `image` 库解不开（也是 WebView 解不开的）格式，导入照旧成功、文件完整落盘，但界面给**明确的占位与说明**，而不是丢一个碎图。iPhone 直出就是 HEIC，这条迟早会遇到——要真正支持得等 M1 之后接平台解码（PRD FV-MED-002「以平台解码能力为准」）。

**导入流程（一次导入 = 一条记录）**：选文件 → 建一条记录（标题取输入框内容，没写就用日期）→ 逐个 `import_media` → 刷新列表。
标题兜底写在前端，因为“一次导入算一条记录”是工作流选择，不是数据规则——换主题可以换一套录入流程。

## 14. 前后端状态分区（别用一个 page 状态走天下）

README 工程约定最后一条要求：**功能主题绑定、用户排序、置顶与主题业务进度保存为开放元数据；当前选择、视图和面板开关分别管理，不混成单一 `page` 状态。**

落地成五类状态：

| 状态种类 | 例子 | 谁拥有 | 存哪 | 变更方式 |
|---|---|---|---|---|
| **持久化用户数据** | 文件夹排序、置顶、主题绑定、挑战进度、主题配置 | **Rust** | Vault 内 JSON（原子写入） | 命令 + 返回全量 |
| **当前选择** | 选中的文件夹、当前工作区视图 | 前端（展示用），可请求 Rust 恢复 | 内存（可选写 localStorage） | `useState` |
| **视图与面板开关** | 图库 / 列表切换、侧栏折叠、编辑面板显隐 | 前端 | 内存（需要记住的写 localStorage） | `useState` |
| **派生数据** | SQLite 索引、缩略图、搜索缓存 | Rust | 应用数据目录 | 命令；**可随时重建** |
| **外观选择** | 选中的预设、用户手调的单值、`themeSync` 记的明暗模式 | 前端 | **localStorage（本机偏好，不进 Vault）** | 本机立即生效 + **patch 合并写盘** + 广播完整快照；每个字段只有一个 owner（覆盖 / 选择 ← 设置窗口，生效值 ← 主骨架） |

**为什么外观选择归前端、不进 Vault**：外观是**本机偏好**（屏幕不同、喜好不同），同一份 Vault 在两台机器上可以长得不一样；而「这个文件夹绑定哪个功能主题」是**用户数据**，必须经 Rust 落盘。两者的边界不要混。

**三条纪律**：

1. **持久化数据一律经 Rust 落盘**，前端不允许自己"记住"这些东西（哪怕 localStorage 很方便）；
2. **不要把这些塞进一个大对象**（例如 `page = { folder, view, panel, theme, order }`）。它们是四类不同的东西，生命周期和真相来源都不同；
3. 前端状态可以**乐观更新**（先改 UI 再等命令返回），但返回的全量数据必须**覆盖**本地状态——**Rust 是唯一真相来源**。

**为什么**：一旦把"用户排的序"和"当前打开的视图"混在一起，你会很快遇到"重启后顺序没了"或"切主题把排序重置了"这类 bug，而且很难查。**分区是给未来的自己省时间。**

---

## 附录 A：当前已实现清单（更新于 2026-09-22）

**Rust 外壳**：`main.rs`；`lib.rs`（插件注册、状态初始化、关主窗口即退出、29 条命令注册——含一个示例 `greet`）；`error.rs`（`AppError` / `AppResult`，命令里不手写 `map_err`）；`state.rs`（仓库注册表 + `vaults.json` 持久化）。

**领域层**（`vault/`，**不认识 tauri**，`cargo test` 直接测）：`model.rs`（`Entry`：`folderId` / `scene` 快照 / `fields` 开放区 / `deletedAt` 墓碑，以及 `apply_update` / `mark_deleted` / `restore`）、`storage.rs`（tmp + rename 原子写入；列出时跳过坏数据；返回**含墓碑**的全部记录）、`folder.rs`（场景元数据 / 排序 / 删场景守卫只数活记录）、`scene.rs`（内置主题登记：普通日记、旅行、挑战）、`media.rs`（导入 / sha256 / 尺寸 / EXIF 拍摄时间 / 缩略图）、`id.rs`（UUIDv7）。

**命令层**（`commands/`，薄适配器，29 条）：`vault.rs`（6）、`folder.rs`（8）、`entry.rs`（8，含 `delete_entry` / `restore_entry`）、`media.rs`（2，导入是 `async`）、`window.rs`（4，全部 `async`）。命令层另外负责 `thumbs_dir` / `allow_vault_assets` 两个应用级副作用。

**前端**：`main.tsx`（按窗口 label 分派）；`App.tsx`（外壳：可拖动侧栏 + 场景树 + 场景舞台）；`app/*`（TitleBar / MobileShell（手机骨架）/ 两个独立窗口外壳）；`features/scene/*`（场景树 / 宿主 / 注册表 / `useFolders` 归类 / **`useSceneData` 底层能力** / `manifest.ts` 声明契约 / `SceneFields` 声明→表单 / `SceneNotice` 可撤销提示 / `mediaFormat` / `MediaLightbox` / `SceneComposer` / `EntryTimeline` / `SceneIcon` / 四个主题单元 `scenes/{plain,travel,challenge,writing}`）；`features/vault/*`；`features/settings/*`；`features/theme/*`（预设选择 `presets.ts` / `useAppearance.ts` + 实时覆盖 + 跨窗口同步）；`skins.css`（四套外观预设，每套浅深齐全）；`src/markdown/` + `features/scene/markdown/`（Markdown 渲染 + 注册表 + 输入控件 `MarkdownField`）；`lib/api.ts`（唯一 `invoke` / `listen` / `convertFileSrc` 出口）；`tokens.css` + `styles/{layers,reset}.css`。

**验证状态**：`cargo test` 27 passed；`cargo check` / `cargo build` 干净；`pnpm exec tsc --noEmit` 干净；`pnpm build` 通过（JS 约 294 KB / CSS 约 45 KB；gzip 后 90 KB / 7 KB）。

## 附录 B：已经踩过的坑（别重复踩）

| 坑 | 现象 | 正确做法 |
|---|---|---|
| 同步命令里建窗口 | 窗口建出来但**关不掉**，进程也不退出 | 窗口 / 长任务命令加 `#[tauri::command(async)]` |
| 忘记给第二个窗口授权 | 那个窗口里所有插件调用被静默拒绝 | `capabilities` 的 `windows` 要列出**每个**窗口 label |
| 用 URL 查询串区分窗口 | 参数被编码搞坏，窗口渲染错内容 | 前端读 `getCurrentWindow().label` 判断 |
| 只关主窗口 | 进程不退出（还有别的窗口活着） | `on_window_event` 里对主窗口 `CloseRequested` 调 `app.exit(0)` |
| 拿着锁做磁盘 IO | 并发时卡死 | 用 `{ }` 圈小临界区，IO 放锁外 |
| 改了 `generate_handler!` 里的命令名 | 界面报 `command xxx not found`，但 `cargo check` 一切正常 | 改了 Rust 命令名**必须重启** `pnpm tauri dev`：HMR 只换前端 |
| 忘了开 asset 协议 / 忘了放行目录 | 照片全是碎图 | Cargo 开 `protocol-asset` + `assetProtocol.enable` + 运行时 `allow_directory(vault)` |
| 把 HEIC 直接塞进 `<img>` | 网格里一片碎图（iPhone 直出就是 HEIC） | 先生成缩略图；解不开就查扩展名给占位 + 原文件路径 |
| 把导入日当成拍摄日 | 从相册导旧照片，日期全是"今天" | 读 EXIF `DateTimeOriginal` 存 `takenAt`；读不到才退回 `addedAt` |
| 给骨架做分支时漏了"窗口外壳" | 窗口**拖不动、关不掉**，只能强杀进程 —— 而且只在"窄窗口 + 桌面平台"同时成立时才出现 | 自绘标题栏（`TitleBar`）属于**窗口外壳**，不属于任何一套骨架：Windows 的窗口是 `decorations: false`，没它就等于没边框。规则：**除真移动端（系统自己管窗口）外，每套骨架都必须在最上面渲染 TitleBar**；整屏弹层要用 `position: absolute` 盖在骨架内，别用 `fixed; inset: 0` 把标题栏一起盖掉 |
| 改了窗口尺寸 / 最小尺寸只改了一份配置 | 两个平台行为不一致（比如 Windows 能缩到 360、mac 还是 640） | 窗口块在 `tauri.conf.json` 与 `tauri.macos.conf.json` 里各有一份（平台配置是整体替换，不是逐字段合并）：**改尺寸要同时改两处**，改完 `grep -n minWidth` 对一眼 |
| 滚动条引起的内容抖动（两种机制，都要治） | 拖动窗口时缩略图**反复变大变小**（网格列数在 2↔3 之间横跳） | ①**纵向**：布局“宽度决定列数、列数决定高度”时，滚动条出现/消失会让容器宽度跳 15px → 滚动容器加 `scrollbar-gutter: stable;`；②**横向↔纵向互相触发**：一点点横向溢出 → 出现横向滚动条（吃掉高度）→ 内容变高 → 出现纵向滚动条（吃掉宽度）→ 横向不再溢出 → 横向滚动条消失 → 宽度回来 → 又溢出……**无限循环**。所以纵向滚动容器还要 `overflow-x: hidden;`（结构上禁止横向滚动），并让可能超宽的按钮行 `flex-wrap: wrap;`；③**想让换列更平滑**：网格列宽一律 `repeat(auto-fill, minmax(最小, 上限))`，**别写 `1fr`** —— `1fr` 是「把余量全给我」，每掉一列所有格子一起膨胀一次，那才是「抖」的观感来源；给了具体像素上限（现在三处：`.entry__media` 112~176 / `.wall` 148~220 / `.photo-grid` 104~168）格子到上限就不再长大，跳变才有上界，代价是宽窗口右侧留一点白。改任何一处网格都照这个写法 |
| 用 `overflow: auto` 简写又想单独控制一个轴 | 写了 `overflow-x: hidden` 却毫无效果（简写把它重置回 auto）；修复“看起来改了但没生效” | 简写会重置**两个**轴，跟书写顺序无关的错觉最坑人。要单独控制就**全用长写**：`overflow-x: hidden; overflow-y: auto;`；插在简写**之前**必被覆盖 |
| 在移动端调 `open_vault_manager` / `open_settings` | 第二个窗口开不出来，调用失败或毫无反应 | **Android / iOS 只有一个 WebView 窗口**：移动端必须做成内嵌页面（见 `app/MobileShell.tsx`） |
| 把删除做成真删文件 | 同步时另一台设备把记录"复活"，用户也没法反悔 | 写**墓碑**（`deletedAt`），列表默认不显示；真删盘留给将来的"清理回收站" |
| 删掉的文件又自己回来了 | 报"找不到模块"，但 `git status` 里它是未跟踪的 `??` | 编辑器还开着那个标签页，会话恢复把内容写回磁盘；**删磁盘文件 ≠ 关标签页** |
| 文件行尾 CRLF | 编辑器保存后整个文件"变了" | `.gitattributes` + Prettier `endOfLine: "lf"` |
| 只盯着报错末尾看 | 被十几个连锁错误吓到 | **从第一个 error 开始修**，只看输出开头几十行 |
| 工具栏插入用自己拼字符串 | 每次点按钮都重设 textarea 的 value，**浏览器的撤销栈被清空** —— 用户按 Ctrl+Z 一次丢掉整段 | 用 `textarea.setRangeText()` 改内容，再 `dispatchEvent(new Event('input', { bubbles: true }))` 让 React 收到；
| 工具栏按钮不阻止默认行为 | 点按钮时 textarea 失焦，**手机键盘立刻收起**，插完还得再点一次输入框 | 按钮加 `onMouseDown={(e) => e.preventDefault()}` |
| 输入法组合期间改选区 | 中文拼音还没上屏就被截断（用户以为输入法坏了） | 用 `compositionstart / compositionend` 标记，组合期间工具栏不动作 |
| 把 Markdown 渲染塞进 p 标签 | 标题 / 列表 / 引用都是块级元素，浏览器会自动闭合外层 p —— DOM 跟写的不一样，排版莫名其妙 | 渲染容器用 div：正文那处已从 p 换成 div（样式仍挂在外层 div 上） |
| 用脚本裁剪 CSS 段落后没跑构建 | `lightningcss` 报 `Invalid empty selector`，位置指向一个空行 —— 其实是多了一个 `}`（删段落时把 `@layer` 的收尾括号也留下了） | 删整段后**数一遍括号**，并且先跑 `pnpm build`：括号不平衡时 dev / build 都会报，但报错位置会误导 |
| 把 `data-scene` 挂在 `.app-root` 上给主题选配色 | 功能主题连带改掉了整个软件的外观（标题栏 / 侧栏 / 设置窗口），三个主题看起来像三个 App | 外观挂 `:root[data-appearance]`（全窗口），`data-scene` 只挂**舞台容器**；功能主题的视觉只走巧思白名单（图标 / banner） |
| 在共享组件的样式里写死某个主题 id | `SceneTree.css` 里 `[data-scene="builtin.travel"]` 那条：第四个主题（或第三方主题）**不报错、不提示**，只是少一条样式 | 共享组件里不许出现主题 id；要区分的观感做成 token（如 `--fv-nav-active-bg`），由**外观预设**给值 |
| 用一次整文件写回改文档 | 读到一半就写回，会把文件尾部**整段截断**（本文件就栽过一次） | 改文档用定位替换（`edit` / 按行 splice），别用"读全文再写回"；写完 `tail` 看一眼尾部 |
| 在 `ViewPlugin` 的 decorations 里给行 / 块加装饰 | CM6 抛 `RangeError: Block decorations may not be specified via plugins`，而且**整块不渲染**：画面全空、DOM 里文字俱在（无障碍树都读得到），一眼看不出是装饰的问题 | 行级 / 块级装饰走 `StateField`（`Decoration.line`、`block: true`），只有行内记号与 widget 留在 `ViewPlugin`（并只算 `view.visibleRanges`） |
| 把 CM6 的结构性样式写进 `@layer` | 完全不生效 —— CM6 往 document 注入的基础样式是**未分层**的，层叠层规矩里未分层永远压过分层，写多少条都没用 | 滚动容器 / 内边距 / 光标走 `EditorView.theme({...})`（值仍是 `--fv-*`）；装饰类名照旧进 CSS 文件 |
| 用 `Decoration.replace({ block: true })` 吞掉围栏行 / 表格行 | 行没了，**相邻行的行级装饰一起丢**、表格 widget 也不落地 —— 症状是"代码块没样式、表格凭空消失" | 少用块级替换：围栏改成"藏围栏文本 + 整块铺代码底色"，表格改成行内替换（代价：表格后留两行空行） |
| 露出源码的粒度按记号自己判 | 围栏上下两条 `CodeMark` 各自与光标比，光标在正文时都不露 —— "光标进块显示源码"当场失效 | 块级记号按**宿主块**判（`rangeTouched(parent.from, parent.to)`），行内记号才按令牌自身范围判 |
| 以为在 App 窗口里就能验证编辑器行为 | 自动化往窗口发合成键盘事件常常到不了 WebView（连普通 `<input>` 都收不到，容易误判成"编辑器坏了"）；App 若是提权进程，UIA 直接拒接 | **在真浏览器里验编辑器**：临时用 vite 挂一个 harness 页，浏览器自动化可以精确点选 / 打字 / 读计算样式与 DOM；挂载与主题集成再回 App 看 |
| 改标题只写 JSON 不搬目录 | 界面变了、磁盘没变，"名字就是名字"当场破功 | 写盘只走 `write_entry`（先内容 → 再改名）；能不能自动改名，看"当前目录名 == 按旧值算出来的名字"，不等就永久不再改 |
| 改名判定写成 `if let (true, false) = (may_rename, current != wanted)` | 元组模式正向匹配，条件不成立就整段跳过 —— **改名永远不发生，且不报错** | 写 `if may_rename && current != wanted`；并且**必须有测试断言目录真的动了**（实测这条就是被测试抓住的） |
| 扫描时拿目录名去改写记录的 `title` | 用户在应用里改的标题，下一次列出被目录名覆盖回去 | 标题的真相在 `entry.json`；目录名是名字，不反向覆盖标题。场景那边相反：`FolderMeta.name` 就是磁盘目录名 |
| 回收站目录用 `<entryId>` 命名 | 撤销时只能按 `day + title` 重算名字，用户手动改过的目录名丢掉 | 回收站保留原目录名，撤销原样挪回去 |
| 在扫描（读命令）里做媒体对账并写盘 | 对账按"文件不在 `media[]` 里"判重，会让"导入后立刻读一次"重复收养同一张照片 | 收养前按**文件名**排重；只在真的变了时写盘，且只写 `entry.json` |
| 让"主题"也带字段（`folder.json.topic`） | 会出现"字段写着科研、目录却在旅游下"的矛盾；与"磁盘为准"并存会打架 | 主题**不存字段**：位置就是它（`FolderNode.topic` 是扫描时算出来的派生字段） |
| 用同一条规则同时管"扫描"和"落点" | 「科研」也是"没有 folder.json 的一级目录"，于是"没有文件夹的记录放哪"就没有确定答案了 | 扫描按**结构**，写路径按**名字**（`ensure_uncategorized` 只认「未归类」） |
| 窄屏规则放进 `styles/compact.css` 却不生效 | 那个文件先于组件样式导入，同优先级下组件赢（规则静默失效） | 用复合选择器抬优先级（`.settings .settings__row`、`.settings.settings`），照文件里 `.md-field .md-field__btn` 的写法 |
| 在 flex 链上靠百分比高度撑满 | 某一环高度不确定时塌成内容高度（左栏竖线只画一半） | 高度用 flex 传：`display:flex; flex-direction:column` + `flex:1; min-height:0` |
| 直接跑 `target/debug/framevault.exe` | 调试构建指向 vite dev server，没起 dev server 时窗口只有"拒绝连接" | 一律 `pnpm tauri dev` |
| 写作台自动保存 + 按 `updatedAt` 重载草稿 | 存一次 → 重载一次 → 刚敲的字被盖回去（丢字） | 重载依赖只认"哪一篇"；待写内容带篇 id 存 ref，切篇/失焦/卸载补写 |
| 触摸屏上的"右键删除" | 没有右键 = 功能不存在 | 长按兜底（500ms，鼠标不参与）；菜单做成公共件 `EntryMenu` |
| 两套骨架各自 `useState` 存"当前选中的场景" | 跨过断点换骨架时组件重挂载，选择重置成第一个场景 | 共用状态挂在公共父节点（`App`）上，经 `SceneShellProps` 传下去；骨架里只留视图开关 |
| 在跑着的 dev 实例里验证 `MarkdownWysiwyg` 的行为改动 | vite HMR 只热替换组件代码，而**编辑器实例只在挂载时创建一次**（`useEffect(…, [])` 里 `new EditorView`），已挂载的编辑器继续跑旧逻辑 —— 「提交了修复但还是坏的」多半是在旧实例里验的 | 整页刷新（Ctrl+R）或重启 `pnpm tauri dev` 后**真的敲一遍**。另外，字面粘贴过的老条目存盘时语法字符已被转义（`\>`、`\*\*`），重开看着仍像"没渲染"—— 那是坏数据不是复现，用**新建条目**验证 |
| 想让场景内的面板（列表 / 照片 / 编辑器）各自独立滚动 | 给内层 `flex:1; min-height:0` 之后**整页还在滚** —— 断点在祖先：`.scene-host` 用 `min-height: 100%` 只是"最小高度"，内容一高容器跟着长，整条收缩链从它这里作废（2026-09 写作台实测：编辑器把 `.writing` 撑到 2000+px）；改成 `height: 100%` 后**又断了一次**——上方加了兄弟元素（视图标签行），100% + 标签行高度 = 依旧溢出；另外 grid 的 `1fr` 行默认是 `minmax(auto, 1fr)`，auto 下限会被列表的自然高度撑爆 | 锚点层**挂在 flex 链上**：父级（`.content`）改纵向 flex，锚点用 `flex: 1; min-height: 0` —— 上方加多少兄弟元素都严格吃剩余高度；中间每一环都显式写：grid 行 `minmax(0, 1fr)`、flex 子项 `min-height: 0`，一层都不能省；滚动容器照 §4.6 长写。怀疑哪层断了就临时给各层加彩色 `outline`，看谁的框跟着内容长 |
