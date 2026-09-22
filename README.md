# FrameVault

> 开放、本地优先、可扩展的跨平台照片与视频日记 Vault。

用户数据以**开放文件**（JSON / Markdown / JPG / PNG / HEIC / MP4 / MOV）保存在用户自己的 Vault 目录里，FrameVault 只是它的宿主和 UI。真正稳定的边界不是界面，而是 **Vault Spec、Core API、Plugin API、CaptureProvider、StorageProvider**。

## 文档索引

| 文档 | 说明 |
|---|---|
| [AGENTS.md](./AGENTS.md) | **工程契约（权威）**：分层与依赖方向、数据模型铁律、术语表、命令/事件契约、验证与文档同步纪律、明确不做的事。**动代码前先读它。** |
| [FrameVault_PRD_zh-CN.md](./FrameVault_PRD_zh-CN.md) | 产品需求（功能优先级 P0/P1/P2、里程碑） |
| [FrameVault_Technical_Architecture_zh-CN.md](./FrameVault_Technical_Architecture_zh-CN.md) | 技术栈、模块边界、Vault 规范、同步模型 |
| [docs/ARCHITECTURE_IMPL_zh-CN.md](./docs/ARCHITECTURE_IMPL_zh-CN.md) | **实现架构**：应该有哪些文件、每个文件负责什么、对外暴露什么接口 |
| [docs/theme-contract.md](./docs/theme-contract.md) | **主题契约**：公开 token 表 / 公开 selector 表 / 主题包格式 / 层顺序 |
| [docs/REFERENCES.md](./docs/REFERENCES.md) | 参考项目清单（学习用，含许可证红线） |

## 当前产品方向与开发范围

- **先做好单窗口**：文件夹导航组织记录，功能主题提供内容区体验；多窗口、浏览器式多标签暂缓。
- **文件夹级功能主题（Workspace Type）**：文件夹绑定一套体验，其下记录共同遵循。它可以包含专门界面、操作流程与业务规则，目标是进入不同主题像进入不同用途的小应用。
- **功能主题与外观主题分离**：普通记录、旅行、挑战属于功能主题；蓝色配色、字体等属于外观 Theme。功能主题是未来插件扩展的主要方向之一。
- **图库与阅读**：基础体验提供相册式照片/视频浏览和 Markdown 阅读，共享同一份记录数据；不同功能主题后续可提供自定义视图。
- **用户决定顺序**：文件夹与记录支持拖动排序、置顶/取消置顶；顺序、置顶和主题绑定是需持久化的用户数据，不只是临时界面状态。
- **挑战已有第一版**：打卡墙（一格一张照片、日期取拍摄日）、目标天数与进度条、连续天数与最长连续、“连续已中断”提示。**清零 / 轮次 / 违规判定仍未做**（PRD §12 第 16 条）——现在只提示，不删任何记录。

**实现现状（2026-04）**：可以新建 / 导入 / 切换仓库，新建场景并绑定主题，按主题分组浏览场景，写文字记录，**导入照片与视频并在界面里看大图 / 播放**；导入时读 EXIF 拍摄时间，卡片与打卡按**拍摄日**而不是导入日。内置两个主题：**普通记录**（时间线）与**挑战**（打卡墙 + 进度 + 连续天数）。记录可以**反复编辑**（标题 + 多行正文）并**随时往里追加照片**；这些能力收在一层（`useSceneData`）里，**两个主题都有**。
主题是**自治单元**（`scenes/<id>/` = 声明 `manifest.ts` + 视图 + 样式）：要在记录上加"距离 / 时长"这类自己的字段，**只写声明**，
表单由核心渲染——不用改核心，也不用改别的主题。仍然缺的：删除记录、Markdown 渲染与手机端写法、图库 / 日历 / 搜索、同步与插件宿主。

**已定案（2026-04）**：仓库层面不做目录嵌套——一个文件夹 = 一个场景 = 一个文件夹 + 它绑定的主题，所有场景平铺存放；"按主题归类"是前端显示层的事（同属"挑战"的跑步与健身房会聚成一组显示），记录归属靠 `folderId` 字段、媒体归属靠 `entryId` 字段，移动 = 改一个字段。媒体原始文件按不可变对象保存，缩略图与索引属可重建缓存、放应用数据目录、不进同步。图库聚合范围、排序与跨文件夹移动的交互等尚未定案，统一记录在 [PRD 待决事项](./FrameVault_PRD_zh-CN.md#12-仍需后续决策的问题)。

## 技术栈基线

| 层 | 选型 | 作用 |
|---|---|---|
| 应用容器 | Tauri 2 | Windows / macOS / Android 宿主 |
| 前端语言 | TypeScript | UI、插件 SDK、应用层类型 |
| 前端框架 | React + Vite | 页面、组件、交互状态 |
| 样式与外观主题 | CSS Variables + Design Tokens + Cascade Layers | 外观主题/皮肤扩展基础；功能主题通过应用层和 Plugin API 实现 |
| 本地核心 | Rust | 文件、索引、同步、哈希、大文件流、权限边界 |
| Android 原生 | Kotlin | 系统相机、SAF、Activity 生命周期 |
| 本地索引 | SQLite | **仅**索引、缓存、同步状态、pending 操作 |
| Vault 数据 | JSON + Markdown + 原始媒体文件 | 用户数据的唯一本体 |
| 包管理 | pnpm workspace | JS/TS 依赖与 monorepo |

## 仓库结构

### 现状

```text
frame-vault/
├── AGENTS.md                                   # **工程契约（权威）**，动代码前先读
├── FrameVault_PRD_zh-CN.md                     # 产品需求
├── FrameVault_Technical_Architecture_zh-CN.md  # 技术架构
├── README.md                                   # 本文件
├── docs/
│   ├── ARCHITECTURE_IMPL_zh-CN.md              # 实现架构：文件、接口、命令表、数据结构
│   ├── theme-contract.md                       # 主题契约：token 表、公开 selector、主题包格式
│   └── REFERENCES.md                           # 参考项目与许可证红线
├── .gitignore                                  # 已预置 node_modules / dist / target
├── .vscode/                                    # 本机编辑器配置（已 gitignore）
└── apps/
    └── framevault/                             # Tauri + React 应用：场景树 + 场景舞台 + 媒体导入
```

### 目标形态

**按需生长，不要预先铺空架子。**文档 §6 明确说：初期可以不立即建立所有 crate/package，但目录边界应按这个方向演进。

```text
frame-vault/
├── apps/
│   └── framevault/            # 应用本体（桌面 + 移动同一份代码）              [M0]
├── packages/                  # 与 UI 完全无关的纯 TS 包
│   ├── core-types/            # 领域类型定义：Entry / Media / Vault          [M0]
│   ├── vault-spec/            # Vault JSON Schema 与规范正文                 [M0]
│   ├── plugin-api/            # 插件契约（对外承诺的稳定接口）               [M3]
│   ├── plugin-sdk/            # 社区插件开发 SDK                             [M5]
│   └── theme-sdk/             # 主题 token / schema                          [M3]
├── crates/                    # Rust 核心，不知道 React 的存在
│   ├── framevault-core/       # Vault / Entry / revision / 迁移 / tombstone  [M0]
│   ├── storage-core/          # StorageProvider trait                        [M4]
│   ├── sync-engine/           # 增量同步、冲突决策                            [M4]
│   ├── indexer/               # SQLite 索引与搜索                             [M1]
│   └── media-core/            # 哈希 / EXIF / 缩略图                          [M1]
├── plugins-native/
│   └── capture/               # Android Kotlin 相机插件                       [M2]
├── docs/
│   ├── adr/                   # 架构决策记录                                  [M0]
│   └── vault-spec/            # 规范正文                                      [M0]
├── pnpm-workspace.yaml        # pnpm workspace 声明（出现第二个 JS 包时再加）
├── Cargo.toml                 # Rust workspace 声明（出现第二个 crate 时再加）
└── README.md

上表的 `[M0]`～`[M5]` 对应文末"实施阶段"。**同一个阶段里的东西也不用一次全建**，
只在真的需要共享时才抽出去。
```

### apps/framevault 内部（脚手架生成后的样子）

```text
apps/framevault/
├── package.json               # 前端依赖与脚本：dev / build / tauri
├── vite.config.ts             # Vite 配置，固定 1420 端口，与 tauri.conf.json 的 devUrl 配套
├── index.html                 # 前端入口页
├── tsconfig.json              # TypeScript 编译配置
├── pnpm-lock.yaml             # 依赖锁定（提交到 git）
├── public/                    # 不经打包的静态资源
├── src/                       # ── UI 层：只画界面、只发命令 ──
│   ├── main.tsx               # React 挂载入口
│   ├── App.tsx                # 根组件
│   └── assets/
└── src-tauri/                 # ── 宿主层：唯一能碰系统能力的边界 ──
    ├── Cargo.toml             # Rust 依赖
    ├── Cargo.lock             # 依赖锁定（提交到 git）
    ├── build.rs               # 构建脚本
    ├── tauri.conf.json        # 产品名 / 标识符 / 窗口 / CSP / 打包配置
    ├── capabilities/          # 权限清单：前端能调哪些命令、能访问哪些路径
    │   └── default.json
    ├── icons/                 # 打包图标
    └── src/
        ├── main.rs            # 进程入口，只负责调用 lib.rs
        └── lib.rs             # 应用逻辑入口，业务逻辑从这里往外长
```

### 后续会引入的组件（先有个底）

下面这些现在都**不存在**，按阶段逐个引入。列出来是为了让你知道"将来会多出什么、由哪条命令带进来"，看到陌生名字时不至于发懵。

| 组件 | 阶段 | 它是什么 | 怎么进入项目 |
|---|---|---|---|
| `docs/adr/` | M0 | 架构决策记录，每个"以后很难改"的决定一条 | 纯 Markdown，手写 |
| `packages/core-types`、`packages/vault-spec` | M0 | Entry / Media / Vault 的 TS 类型与 JSON Schema | `pnpm init` + workspace |
| `crates/framevault-core` | M0 | Vault / Entry 读写、revision、迁移、tombstone | `cargo new --lib crates/framevault-core` |
| `src-tauri/src/commands/`、`state.rs` | M0 | 第一批 Tauri command 与应用状态 | 手写，从 `lib.rs` 拆出来 |
| `tauri-plugin-dialog`、`tauri-plugin-fs` | M1 | 选文件夹、读写用户选定的路径 | `pnpm tauri add dialog` / `add fs` |
| `crates/media-core` + `image`、`fast_image_resize`、`kamadak-exif` | M1 | 缩略图、EXIF、内容哈希 | `cargo add` |
| `crates/indexer` + `rusqlite`（bundled） | M1 | SQLite 索引与全文搜索，库文件落在 `%APPDATA%` | `cargo add rusqlite --features bundled` |
| `plugins-native/capture`（Kotlin） | M2 | Android 系统相机、SAF、URI 权限 | `pnpm tauri android init` + 自写 mobile plugin；需 Android Studio / SDK / NDK / JDK 17 |
| `src/styles/tokens.css`、`packages/theme-sdk` | M3 | Design Tokens 与主题包规范 | 手写 + workspace |
| `packages/plugin-api`、`packages/plugin-sdk` | M3 / M5 | 插件契约与社区开发 SDK | workspace |
| `tauri-plugin-stronghold` | M4 | 凭证安全存储（OAuth token、WebDAV 应用密码） | `pnpm tauri add stronghold` |
| `crates/storage-core` + `reqwest`、`quick-xml` | M4 | Local / WebDAV / 网盘 Provider | `cargo add` |
| `crates/sync-engine` | M4 | 增量同步、冲突副本、tombstone 传播 | 自研，`cargo new --lib` |
| `LICENSE`（Apache-2.0）、`rust-toolchain.toml` | 择机 | 开源许可、工具链版本锁定 | 手写 |

**认名字的三个规则**（以后看到陌生目录先套一下）：

- 能用 `pnpm tauri add` 装的、或名字带 `plugin-` 的 → **Tauri 官方插件**，一定会配一份 `capabilities/` 权限；
- `crates/*` → **我们自己的 Rust 库**，与 UI 无关（不知道 React 存在）；
- `packages/*` → **我们自己的 TS 库**，与 React 无关（不知道组件存在）。

### apps/framevault 内部后续会长出来的东西

**建议形态**，我们按这个方向长，不是硬性规定。

```text
apps/framevault/
├── src/                        # ── 前端：只画界面、只发命令 ──
│   ├── lib/tauri.ts            # invoke 的类型化封装，前端只从这里调 Rust          [M0]
│   ├── components/             # 通用组件：时间线卡片、媒体网格、空状态             [M1]
│   ├── features/               # 按功能分目录：vault / entry / gallery / settings  [M1]
│   └── styles/tokens.css       # Design Tokens（--fv-color-* 等）                 [M3]
└── src-tauri/                  # ── 宿主：唯一能碰系统能力的边界 ──
    ├── capabilities/
    │   ├── default.json        # 主窗口权限，最初只有 core:default
    │   └── <plugin>.json       # 每加一个官方插件，多一份权限声明                  [M1 起]
    └── src/
        ├── main.rs             # 进程入口
        ├── lib.rs              # 注册 command 与插件（.invoke_handler / .plugin）
        ├── state.rs            # 应用状态：当前打开的 Vault 等                     [M0]
        └── commands/           # 一个能力一组 command                              [M0]
            ├── vault.rs        # create_vault / open_vault / scan_vault
            └── entry.rs        # create_entry / update_entry / delete_entry
```

`dist/`、`target/`、`node_modules/` 会散落在这些目录里，但都不进 git。

## 数据放在哪

| 数据 | 落点 | 进 git 吗 |
|---|---|---|
| 源码 / 配置 / 锁文件 | `apps/framevault` | ✅ 要 |
| 构建产物 `dist/`、`target/`、`node_modules/` | 同目录，被 .gitignore 挡掉 | ❌ 不要 |
| 用户 Vault（`vault.json`、`entry.json`、`note.md`、媒体、文件夹/功能主题/排序置顶元数据） | 用户自己选择的位置，**不属于本仓库** | ❌ |
| 本机派生数据（SQLite、缩略图、搜索缓存、pending capture） | 系统应用数据目录 `%APPDATA%\com.framevault.app` | ❌ |
| 依赖缓存 | `~/.cargo/registry`、pnpm store | ❌ 全局共享 |

原则：**删掉本机 SQLite 和缩略图后，重新扫描 Vault 必须能恢复全部用户数据。**

## 分层边界（最重要的一条）

UI 层（`src/`）**禁止**：

- 直接读写 Vault 文件；
- 直接访问 SQLite；
- 直接调用网盘 / 云服务 API；
- 直接处理 Android Intent。

所有系统能力必须穿过 `src-tauri` 暴露的 Tauri command。插件同理：**永远只能走 Plugin API**，不直接获得 Tauri 全局对象。

这条规矩的物理形态就是目录结构：`src/` 是皮，`src-tauri/` 是边界，未来的 `crates/` 是与 UI 无关的核心。

## 怎么加东西（四条固定动作）

```powershell
# ① 加前端包（在 apps/framevault 里）
pnpm add <包名>

# ② 加 Rust crate
cd apps\framevault\src-tauri
cargo add <crate名>            # 例：cargo add rusqlite --features bundled

# ③ 加 Tauri 官方插件（一条命令做完全部接线：Rust 依赖 + 插件注册 + 权限 + 前端包）
pnpm tauri add dialog          # 或 sql / stronghold / fs / opener …

# ④ 自己写核心库（真有共享需求时）
cargo new --lib crates/framevault-core
```

## 开发环境

Windows 需要（本机已核对齐全）：

| 依赖 | 版本 |
|---|---|
| Node.js | 24.11.1 |
| pnpm | 11.0.9 |
| Rust + rustup | 1.98.1（stable-x86_64-pc-windows-msvc） |
| MSVC | Visual Studio 2022 Community + Windows SDK 10.0.26100 |
| WebView2 | 153.x（Win11 自带） |
| Tauri CLI | @tauri-apps/cli 2.11.5（项目 devDependency；另装了全局 tauri-cli 用于 `tauri info` 体检） |

Android 开发另需：Android Studio、Android SDK、NDK、JDK 17。

## 快速开始

```powershell
# 1. 生成项目
cd D:\Gitee\frame-vault
mkdir apps
cd apps
pnpm dlx create-tauri-app@latest framevault --manager pnpm --template react-ts --identifier com.framevault.app -y

# 2. 装前端依赖
cd framevault
pnpm install

# 3. 跑起来（首次 Cargo 编译需要 5~15 分钟）
pnpm tauri dev
```

跑通之后再按需补 `pnpm-workspace.yaml` + 根 `Cargo.toml`（见"目标形态"）。**在只有 `apps/framevault` 一个包之前，不要加 workspace 声明。**

## 实施阶段

| 阶段 | 目标 |
|---|---|
| M0 架构验证 | Tauri 2 三端空壳、本地 Vault 读写、Android 系统相机 PoC、Design Tokens PoC、StorageProvider / CaptureProvider 接口、插件与主题最小 PoC |
| M1 桌面本地 MVP | 创建/打开 Vault、单窗口文件夹导航、内置普通记录功能主题、图库/Markdown 阅读、手动排序与置顶、媒体导入、时间线、Entry + note.md、本地索引与缩略图 |
| M2 Android 核心体验 | Vault 访问、系统相机拍照/录像、自动归档到当前 Entry、生命周期恢复 |
| M3 个性化基础 | Design Tokens、外观主题包与本地安装、Plugin manifest / API 骨架、权限模型、功能主题扩展点验证 |
| M4 同步基础 | Sync Engine、Local + WebDAV、坚果云、冲突副本、tombstone、大文件流式传输 |
| M5 开放生态 | 官方/第三方 Provider、插件 SDK、功能主题插件、Marketplace、自定义 Registry；旅行/挑战专门体验后期另行排期 |

## 工程约定

- 所有可持久化 schema 必须带 `schemaVersion`；
- Entry / Media ID 用 **UUIDv7**，与路径、标题解耦，外部只当 opaque ID 使用；
- 元数据写入用**临时文件 + 原子替换**；
- 不把 Windows / macOS 绝对路径写进跨端元数据；
- 重活（扫描、哈希、缩略图、上传）放 Rust，UI 主线程不阻塞；
- SQLite 永远只是缓存：先有文件读写，后有索引。
- 功能主题绑定、用户排序、置顶与主题业务进度保存为开放元数据；当前选择、视图和面板开关分别管理，不混成单一 `page` 状态。
