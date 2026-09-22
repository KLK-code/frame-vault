# AGENTS.md — FrameVault 工程契约

> **这份文件是权威的。** 任何人（或 AI）在动这个仓库之前先读完它。
> 与本文冲突的其它描述，**以本文为准**；本文没写的，查 `docs/ARCHITECTURE_IMPL_zh-CN.md`。
> 最后更新：2026-09（macOS 适配：§1 平台范围、§9 新增 macOS 坑、§12 补两个文件）

## 0. 一句话

FrameVault 是一个**开放、本地优先、可扩展**的跨平台照片与视频日记 Vault。
用户数据是**开放的普通文件**（JSON / JPG / PNG / MP4 / MOV），FrameVault 只是它的宿主和 UI。
稳定的边界不是界面，而是 **Vault 规范 + Core API + Plugin API**。

## 1. 技术基线（不许擅自替换或升级）

| 层 | 选型 | 备注 |
|---|---|---|
| 壳 | Tauri 2.x | 桌面；Android 推迟 |
| 后端 | Rust | Windows 走 MSVC toolchain，macOS 走 Apple 的 aarch64-apple-darwin。领域逻辑全在这里 |
| 前端 | TypeScript + React 19 + Vite | 无 UI 框架、无路由库、无状态库 |
| 包管理 | pnpm（workspace） | Tauri CLI 用 `@tauri-apps/cli` 作为 devDependency，**永远不要 `cargo install tauri-cli`** |
| 许可 | Apache-2.0 | 引入新依赖前先看 `docs/REFERENCES.md` 的许可证红线 |

**平台范围**：**Windows 仍是主开发平台；macOS 已验证可编译、可运行**（2026-09 实测：`cargo test` / `pnpm exec tsc --noEmit` / `pnpm build` / `pnpm tauri dev` 全通，窗口走系统原生红黄绿，见 `src-tauri/tauri.macos.conf.json`）。**Android：界面适配已开始**（手机骨架 + 窄屏横切调整已落地），但**构建环境（JDK / Android SDK / NDK / Rust 交叉目标）与真机验证尚未做**——
所以"能编出 APK"这句话现在还不成立，别把它当已完成。调用系统相机仍推迟到需要时再写 Kotlin 插件。
**不要为了 Android 提前设计跨平台抽象**：Android 的差异目前只体现为"窗口开不出来"和"屏幕窄"。

## 2. 分层与依赖方向（最容易被改坏的地方）

**Rust**

```text
main.rs → lib.rs（组装：插件、状态、命令注册）
          └── commands/   薄适配器：收参数（校验）→ 调领域 → 转可序列化形状
                └── vault/   领域核心：**这里不许出现 tauri**
```

- `vault/` 里**不许** `use tauri`、不许出现 `AppHandle`/`State`/窗口概念。它只依赖 std + serde + uuid + sha2 + image。
  这样它才能被 `cargo test` 直接测，将来也才能整体搬进独立 crate。
- `commands/` 里**不许写业务规则**。校验参数可以，判断业务不行——规则进 `vault/`。
- 错误统一用 `error.rs` 的 `AppError` / `AppResult`（有 `From` 实现，`?` 直接能用）。命令里**不许**手写 `.map_err()`。

**前端**

```text
main.tsx（按窗口 label 分派）→ App.tsx / app/*（外壳）→ features/*（业务块）→ lib/api.ts（唯一出口）
```

- **`invoke` / `listen` / `convertFileSrc` / 插件调用只能出现在 `lib/api.ts`**。别的文件一律从这里 import。
- 样式跟组件同目录同名；**组件不许 import 别人的样式文件**。
- 依赖方向单向。外壳不许 import 主题视图的内部实现（只认 `FolderNode` / `SceneInfo` 这类契约类型）。
- **平台差异只允许出现在两处**：后端 `commands/window.rs`（窗口 builder 的 `#[cfg(target_os = "macos")]` 分支）
  与前端 `lib/platform.ts`（唯一的 OS 判断）。**别在别处写 `if (isMac)` / `#[cfg]`**——
  每多一处，就多一处“只在一边编译过”的机会。真要加第三处，先改这一条。
- **两套骨架**：桌面 = 左场景树 + 右场景舞台（`App.tsx` 里的 `DesktopShell`）；手机 = 顶部场景切换 + 主题渲染区 + 底部标签栏（`app/MobileShell.tsx`）。
  两者**共用同一份能力与数据**（`useFolders` / `useActiveFolder` / `useSceneData` / `SceneHost`），**区别只有编排**。
  走哪套由 `lib/useCompact.ts`（视口宽度，响应式）与 `isMobileOS`（能不能开第二个窗口）共同决定。

## 3. 数据模型铁律

1. **仓库里一切都是扁平的**：`folders/` 没有父子关系、`entries/` 不嵌套、`media/` 一个 id 一个目录。
   归属靠字段（`Entry.folderId`、`MediaMeta.entryId`）；**"归类/分组"永远只是展示层的事**。
   移动 = 改一个字段，不搬文件。
2. **用户数据必须经 Rust 落盘**：排序、置顶、主题绑定、主题业务进度、封面……
   错：写进 React state 或 localStorage 就当作保存了（重启就没了），或塞进 SQLite（它只是缓存）。
3. **派生数据不进 Vault**：SQLite 索引、缩略图 → 应用数据目录（Windows `%APPDATA%\com.framevault.app\`，macOS `~/Library/Application Support/com.framevault.app/`，代码里一律走 Tauri 的 `app_data_dir()`，不自己拼）。
   它们随时可重建，**永远不是真相来源**（PRD FV-SYN-002）。
4. **写盘一律原子**：`storage::write_json_atomic`（tmp + rename），不要裸 `fs::write`。
5. **加字段必须 `#[serde(default)]`**；删字段也不能让老文件读不出来——serde 默认忽略未知字段，
   并且要有测试守着"老版本文件还能读"（看法 `vault/folder.rs` / `vault/model.rs` 里的 `old_*_still_loads` 测试）。
6. **id 一律 UUIDv7，由 Rust 发**（`new_id` 命令）。**时间戳由调用方给**，Rust 层不引时钟依赖（测试才好写）。
7. `SCHEMA_VERSION` 在 `vault/model.rs`。改版本号之前先想清楚老数据怎么办。
8. **媒体原始文件导入后不可变**；磁盘名固定 `orig.<ext>`，用户原名只存在 meta 里。

## 4. 术语表（**防漂移的关键，务必按这个说**）

| 概念 | 文档 / PRD | UI 文案 | 代码标识 |
|---|---|---|---|
| 一个文件夹（容器） | 文件夹 | **场景** | `Folder` / `FolderMeta` / `FolderNode` |
| 文件夹绑定的那套玩法 | 功能主题（**Workspace Type**） | **主题** | `scene` ⚠️ 见下 |
| 配色 / 字体 / 皮肤 | 外观 Theme | 外观 | `--fv-*` token、`features/theme/` |
| 一条记录 | Entry | 记录 | `Entry` |
| 照片 / 视频 | 媒体 | 照片 / 视频 | `MediaMeta` / `MediaItem` |

⚠️ **代码里的 `scene` 是历史命名**，它的真实含义是"这个文件夹绑定的功能主题 id"
（`FolderMeta.scene`、`SceneInfo`、`effectiveScene`、`builtin_scenes()`）。
**文档与 PRD 里永远不要写 `scene`，代码里永远不要再造第三个名字。**

三条文案规则：

1. UI 里 **"场景" = 文件夹**；不要把功能主题叫"场景"；
2. UI 里 **"主题" = 功能主题**；外观主题一律叫"外观"；
3. 想改名（`scene` → `workspaceType`）**必须一次做全**：加 `#[serde(alias = "scene")]` 读老文件 →
   写迁移 → 改前端 → 更新本文档与 ARCHITECTURE_IMPL。**不许只改一半**（那才是真正的漂移源）。

## 5. 命令 / 事件契约

- 命令名 `snake_case`、动词开头（`list_entries` / `save_entry` / `import_media`）。
- 前端 `invoke` 传 **camelCase**，Rust 形参 **snake_case**，Tauri 自动映射；进 JSON 的结构体一律 `#[serde(rename_all = "camelCase")]`。
- **关系型改动返回全量**（排序 / 置顶 / 绑定 / 删除 → 返回整个列表）。前端直接替换，不做乐观更新。
  理由：只回一条会让前端自己猜规则，两边迟早不一致。
- Rust 的 `Err` 会变成 Promise reject；错误文案用中文、说人话，别把英文栈甩给用户。
- **重活/长任务必须 `#[tauri::command(async)]`**（否则跑在主线程，窗口会卡死甚至关不掉——踩过）。
- 事件名 `域://动作`（例：`vault://changed`）。**每个窗口是独立的 `document`**，跨窗口同步只能靠事件。
- 加/改/删命令要同时改**四处**：命令实现 → `lib.rs` 的 `generate_handler!` → `lib/api.ts` 的包装 → 本文 §5 与 `ARCHITECTURE_IMPL §5.1`。
- 命令层可以算**绝对路径**给前端（前端不拼路径），可以放行 asset 协议，但**不许**存业务状态。

## 6. 前端规范

- 目录：`features/<域>/`；主题视图放 `features/scene/scenes/<主题 id>/`。
- **新增一个功能主题 = 写一个组件 + 在 `registry.ts` 加一行 + 在 Rust 的 `builtin_scenes()` 登记同一个 id**。核心（记录格式、其他主题）一律不动。
  主题拿到的 props 是 `SceneViewProps`：`folder`（含它自己的 `sceneConfig`）、`scene`、`onSceneConfigChange`（写回配置）。
- **能力在底层，主题只管展示与编排**：数据读写一律走 `features/scene/useSceneData.ts`
  （取记录 / 取媒体 / 媒体归属 / "这条按哪天算" / 刷新 / 忙碌与错误 / 建记录 / 改文字 / 追加照片）。
  **主题不许自己再写一遍"取记录 + 取媒体 + 过滤 + 刷新"**——那是能力散落的开始，
  也是"这个主题有这功能、那个主题没有"的来源。主题能决定的只有：显示哪些、什么顺序、点哪里触发哪个能力。
- **主题是一个自治单元**：一个目录 = 一份声明（`manifest.ts`）+ 一个视图（`PlainScene.tsx` 之类）+ 自己的样式，`index.ts` 导出 `SceneUnit`。
  注册表只做汇总（id → 单元），**不认识主题内部**。将来主题包分发时，`manifest` 原样变成 `manifest.json`。
- **manifest 必须是纯数据**：不放函数、不放 React 组件——**它是"将来会被 Rust 读、会被第三方写"的东西**。
  主题只声明"我要什么字段 / 什么配置"，表单由核心的 `SceneFields` 渲染，**主题不许自己手写那套 input + label**。
- **主题自己的字段按主题 id 命名空间存放**：`entry.fields["builtin.plain"].text`。
  读的时候要兼容老数据（早期直接写在 `fields` 顶层的 key），写的时候只替换自己那一个命名空间。
- **基础能力默认齐备**：新建 / 编辑 / **删除（写墓碑，可撤销）** / 追加照片 / 选文件 / 刷新 / 忙碌与错误 / "这条按哪天算"——**主题不该为了这些去自己写一遍**。
  权限上区分两种"默认"：**内置主题默认齐备且默认授权**；第三方主题同样默认齐备，但要按 `needs` 声明 + 用户同意。
- **什么该进核心？判据：这个能力会不会改变磁盘上的数据形状？**
  会（删除怎么标、字段怎么命名空间、照片归属怎么表达）→ **必须进核心**，所有主题共用一种格式，
  否则一百个主题会发明一百种格式，Vault 就不再是开放格式；
  不会（卡片多大、点哪里、按什么排序显示）→ 留给主题，随便写。
- **公共件**：`features/scene/mediaFormat.ts`（格式化 / 能否显示）、`MediaLightbox.tsx`（大图 / 视频）、`SceneFields.tsx`（声明→表单）、`SceneNotice.tsx`（可撤销提示）已经抽出来了，新主题直接复用，**别写第五份**。
- 样式**全部包在 `@layer` 里**（层顺序在 `styles/layers.css`）；组件里**零裸色值/裸尺寸**，只能用 `--fv-*` token。
- **窄屏横切调整放 `styles/compact.css`**：只放“没有哪个组件该独自负责”的调整（触摸目标下限、安全区、设置面板堆叠），
  而且**全部包在窄屏媒体查询里** —— 桌面端一点不受影响。组件自己的样式仍旧留在组件目录。
- 类名 `.block__element--modifier`；只有 `docs/theme-contract.md` 里列出的类名算"对外承诺"。
- 状态分区（README 工程约定最后一条）：持久化用户数据（Rust）/ 当前选择（`useState`）/ 视图与面板开关（`useState` + localStorage）/ 派生数据（Rust 缓存）。
  **不要合成一个大的 `page` 对象**。
- 不引路由库、状态库、CSS-in-JS。现在前端只是"展示 + 转发"。
- 文案中文、口语；空状态要给出下一步该做什么，错误要能看懂。
- **不要提前抽象**：第二个地方真的要用，才把东西从主题目录升级到 `features/` 或通用层。

## 7. 验证纪律（"写完了"不等于"跑过了"）

| 改了什么 | 必须跑 |
|---|---|
| `vault/` 领域层 | `cargo test`（新逻辑要带测试）+ `cargo check` |
| 任何 Rust / `tauri.conf.json` | `cargo build`，而且**必须重启 `pnpm tauri dev`**（HMR 只换前端，跑着的还是旧命令表） |
| 前端 | `pnpm exec tsc --noEmit` + `pnpm build` |

- **三处同看**：终端的 `println!`、界面上的状态、磁盘上的文件。哪个没动，问题就在哪一段。
- 报错**从第一个 error 开始修**（Rust 会串一长串连锁错误，只看末尾会被吓到）。
- 无法验证的改动，必须在回复里说清楚"为什么无法验证、你要怎么确认"。

## 8. 文档同步矩阵（改了代码不更新文档 = 制造漂移）

| 改了 | 必须同步 |
|---|---|
| 命令 / 事件 | `ARCHITECTURE_IMPL §5.1 / §5.2` + 本文 §5 |
| 磁盘布局、字段、schema | `ARCHITECTURE_IMPL §13` + `PRD §12` 里对应待决项 |
| 设计 token、公开类名 | `docs/theme-contract.md` + `tokens.css` |
| 前端目录结构、分层规则 | `ARCHITECTURE_IMPL §4` |
| 阶段范围变化（做什么/不做什么） | `README.md`「当前产品方向与开发范围」+ PRD 里程碑 |
| 踩到新坑 | `ARCHITECTURE_IMPL 附录 B` + 本文 §9 |

## 9. 已知坑（浓缩版，完整版在 `ARCHITECTURE_IMPL 附录 B`）

| 坑 | 正确做法 |
|---|---|
| 改了 `generate_handler!` 里的命令名，界面报 `command xxx not found` | 重启 `pnpm tauri dev` |
| 窗口命令写成同步的 | 窗口/长任务命令一律 `#[tauri::command(async)]` |
| 新窗口没在 `capabilities` 里授权 | `capabilities/default.json` 的 `windows` 要列出**每个**窗口 label |
| 用 URL 查询串区分窗口 | 读 `getCurrentWindow().label` |
| 只关主窗口，进程不退出 | `on_window_event` 里对主窗口 `CloseRequested` 调 `app.exit(0)` |
| 拿着 Mutex 做磁盘 IO | 用 `{ }` 圈小临界区，IO 放锁外 |
| 忘了开 asset 协议 / 忘了放行目录 | 照片全碎：要 `protocol-asset` feature + `assetProtocol.enable` + 运行时 `allow_directory(vault)` |
| 把 HEIC 直接塞进 `<img>` | 先缩略图；解不开就查扩展名给占位 + 原文件路径 |
| 文件行尾 CRLF | `.gitattributes` + Prettier `endOfLine: "lf"` |
| 在组件里写裸色值 | 用 `--fv-*`；要新颜色先给 token 起个语义名字 |
| 删掉的文件又自己回来了 | 编辑器还开着那个标签页，会话恢复时把内容写回磁盘。删磁盘文件 ≠ 关标签页；报"找不到模块"时先 `git status` 看它是不是未跟踪的 `??` |
| 以为 `tauri.macos.conf.json` 的 `app.windows` 会和主配置**逐字段合并** | 不会。平台配置走的是 json_patch（RFC 7386），**数组整体替换**：mac 那份必须把窗口字段写全，而且**必须显式写 `"label": "main"`** —— 漏了 label 窗口就换了名字，`capabilities/default.json` 的 `windows` 对不上，权限全掉 |
| 在 `commands/window.rs` 里直接链 `title_bar_style` / `hidden_title` / `traffic_light_position` | 这三个方法带 `#[cfg(target_os = "macos")]`，**Windows 直接编译不过**。必须包进 `#[cfg(target_os = "macos")]` 块，非 mac 分支保持 `.decorations(false)` |
| 以为 `trafficLightPosition.y` 是"按钮顶边到窗口顶边的距离"，或以为 `y = 顶栏高 - 按钮高` | 都不是。tao 把标题栏容器高度设成 `按钮frame高 + y`，容器顶边钉在窗口顶边，按钮却保留它到容器**底边**的距离 —— 于是 **y 每 +1，红黄绿就往下 1px**。实测 `按钮中心 = y + 2`：顶栏 32px 要居中就是 `y = 14`（x=20 对齐 20~72px，前端留 80px）。对不齐别推公式，`screencapture` 截图量按钮中心，改成 `中心 - 2`。**y 只有一份**（`tauri.macos.conf.json` 的主窗口配置），子窗口在 `native_titlebar()` 里从 `app.config()` 读，别在 Rust 里再抄一个常量；因此改顶栏高度只需同步 **JSON + `tokens.css`** 两处 |
| 想自己写 `onDoubleClick` 做"双击顶栏最大化" | 不用写：Tauri 注入的 `drag.js` 已经带了，而且 macOS 上专门走 `mouseup`（鼠标移开还能取消），比自写更贴系统习惯 |
| 给骨架做分支时漏了"窗口外壳" | 窗口**拖不动、关不掉**，只能强杀进程 —— 而且只在"窄窗口 + 桌面平台"同时成立时才出现 | 自绘标题栏（`TitleBar`）属于**窗口外壳**，不属于任何一套骨架：Windows 的窗口是 `decorations: false`，没它就等于没边框。规则：**除真移动端（系统自己管窗口）外，每套骨架都必须在最上面渲染 TitleBar**；整屏弹层要用 `position: absolute` 盖在骨架内，别用 `fixed; inset: 0` 把标题栏一起盖掉 |
| 改了窗口尺寸 / 最小尺寸只改了一份配置 | 两个平台行为不一致（比如 Windows 能缩到 360、mac 还是 640） | 窗口块在 `tauri.conf.json` 与 `tauri.macos.conf.json` 里各有一份（平台配置是整体替换，不是逐字段合并）：**改尺寸要同时改两处**，改完 `grep -n minWidth` 对一眼 |
| 滚动容器没留滚动条的位置（漏 `scrollbar-gutter: stable`） | 拖动窗口时缩略图**反复变大变小**（网格列数在 2↔3 之间横跳） | 布局只要是“**宽度决定列数、列数决定高度**”（`repeat(auto-fill, minmax(...))` 的网格就是），就会出现反馈环：换列 → 内容变高 → 滚动条出现 → 容器窄 15px → 又换列。滚动容器一律加 `scrollbar-gutter: stable;`，让滚动条**永远占位**，宽度不再随它跳 |
| 在移动端调 `open_vault_manager` / `open_settings` | 第二个窗口开不出来，调用失败或毫无反应 | **Android / iOS 只有一个 WebView 窗口**：这两样在移动端必须做成**内嵌页面**（见 `app/MobileShell.tsx`） |
| 在 macOS 上给窗口设 `decorations: false` | 去掉的不只是标题栏，而是整个 `Titled` style mask —— **圆角、阴影、边缘拖拽缩放一起没了**。mac 上要原生外观就得 `decorations: true` + `titleBarStyle: Overlay` + `hiddenTitle`（见 §12 的 `tauri.macos.conf.json`） |

## 10. 现在明确不做（YAGNI / 已拍板推迟）

- **目录嵌套、主题继承**：已定案不做——仓库扁平，归类是展示层的事。
- **Android 与调用系统相机**：推迟到 Android 适配阶段。
- **同步、插件宿主、Marketplace、多窗口标签页、日历视图、全文检索**：都还没到，别提前设计。
- **视频抽帧（ffmpeg）**：按 PRD 属 P1/P2；现在视频交给 WebView / 平台解码。
- **不引路由库、状态库、CSS-in-JS、UI 组件库**。
- **不把 SQLite / localStorage / React state 当真相来源**。
- **不许为了"以后可能要用"加抽象层**。

## 11. 提交与协作

- commit message 用中文，写清**做了什么 + 为什么**；一次提交只做一件事。
- 提交前跑完 §7 的验证。
- 大改动（改 schema、改命令名、改目录布局）**先在对话里说清楚再动手**；不确定就问，不要猜着写。
- 不要 `git push --force`、不要动别人的分支。

## 12. 文件地图（找东西从这里开始）

```text
apps/framevault/
├── src/                        前端
│   ├── App.tsx / App.css       主窗口外壳：左场景树 + 右场景舞台 + 可拖分隔条
│   ├── main.tsx                入口：按窗口 label 分派
│   ├── app/                    TitleBar / 独立窗口外壳 / window.css
│   │                           MobileShell.tsx（手机骨架：顶栏 + 标签栏 + 整屏弹层）
│   ├── features/
│   │   ├── scene/              场景层：useFolders（数据+归类）/ SceneTree / SceneHost /
│   │   │                       registry.ts（主题→视图）/ mediaFormat.ts / MediaLightbox.tsx
│   │   │                       SceneMedia.tsx（场景照片墙，手机“照片”页）
│   │   │                       scenes/plain（普通记录）/ scenes/challenge（挑战打卡墙）
│   │   ├── vault/              仓库：悬浮切换菜单 + 管理窗口面板
│   │   ├── settings/           设置：左导航 + 右内容
│   │   └── theme/              外观：token schema + 实时编辑 + 跨窗口同步
│   ├── lib/api.ts              **唯一** invoke / listen / convertFileSrc 出口
│   ├── lib/platform.ts         前端唯一一处"现在是什么系统"的判断（isMacOS / isMobileOS）
│   ├── lib/useCompact.ts       视口够不够宽（响应式，不是平台分支）
│   ├── styles/                 layers.css（层顺序）/ reset.css / compact.css（窄屏横切调整）
│   └── tokens.css              设计令牌：唯一允许出现裸色值的地方
└── src-tauri/
    ├── tauri.conf.json         assetProtocol 已开；窗口 decorations: false（Windows 自绘标题栏）
    ├── tauri.macos.conf.json   macOS 覆盖：窗口走原生红黄绿（Overlay + hiddenTitle）
    ├── capabilities/default.json  三个窗口的权限
    └── src/
        ├── lib.rs              组装 + generate_handler
        ├── error.rs            AppError / AppResult
        ├── state.rs            VaultRegistry + vaults.json 持久化
        ├── commands/           vault / folder / entry / media / window（薄适配器）
        └── vault/              领域核心（不认识 tauri）：model / storage / folder / scene / media / id
```

```text
<用户选的目录>/          ← Vault：用户数据，可备份、可同步、可手改
├── vault.json            身份文件（有它才算 Vault）
├── entries/<id>/entry.json
├── folders/<id>/folder.json
└── media/<id>/{orig.<ext>, meta.json}

%APPDATA%/com.framevault.app/   ← 本机缓存（macOS 是 ~/Library/Application Support/…），删了能重建
├── vaults.json           已知仓库列表 + 当前仓库
└── thumbs/<vault-id>/<media-id>.jpg
```
