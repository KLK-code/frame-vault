# AGENTS.md — FrameVault 工程契约

> **这份文件是权威的。** 任何人（或 AI）在动这个仓库之前先读完它。
> 与本文冲突的其它描述，**以本文为准**；本文没写的，查 `docs/ARCHITECTURE_IMPL_zh-CN.md`。
> 最后更新：2026-09（**编辑器全量切到 CM6 三模式 + 外观改默认极简白 + 手机骨架重排**：§3.8 补判重规则（大小写不敏感 / 列一次目录）、§6 的编辑器小节与外观优先级链改写、§9 换成六行新坑，`docs/theme-contract.md` 删掉两族已死类名并更新预设表；**SAF 已批准分七期**（`docs/PROPOSAL_mobile_vault_saf_zh-CN.md`，S0 已完成：`state.rs` 的 `VaultRef` + `naming.rs` 的判重）；**Android 构建打通**：§9 新增三行坑（桌面专属 builder 方法 / Windows 软链接要开发者模式 / Gradle 发行包换镜像）、§1 平台范围，`docs/DEV_ANDROID_zh-CN.md` 是操作手册；**写作台四面板独立滚动**：§9 新增一行坑、网格清单加第四处；**存储规范 v2 落地**：§3 铁律 1/5/8/9、§5 命令契约、§9 新增五行坑、§12 布局图；**编辑器内核换成 CodeMirror 6**：§1 依赖例外、§6 编辑器小节、§9 新增五行坑并改写两行、§10；愿景收编 + 术语改向登记：§4 注记指向 docs/VISION_zh-CN.md；macOS 适配：§1 平台范围、§9 新增 macOS 坑、§12 补两个文件；写作台编辑器：§1 依赖例外、§6 两种输入控件、§9 新增两行坑；编辑器粘贴：§9 新增"行为改动必须重启真粘一次"的坑）

## 0. 一句话

FrameVault 是一个**开放、本地优先、可扩展**的跨平台照片与视频日记 Vault。
用户数据是**开放的普通文件**（JSON / JPG / PNG / MP4 / MOV），FrameVault 只是它的宿主和 UI。
稳定的边界不是界面，而是 **Vault 规范 + Core API + Plugin API**。

## 1. 技术基线（不许擅自替换或升级）

| 层 | 选型 | 备注 |
|---|---|---|
| 壳 | Tauri 2.x | 桌面；Android 推迟 |
| 后端 | Rust | Windows 走 MSVC toolchain，macOS 走 Apple 的 aarch64-apple-darwin。领域逻辑全在这里 |
| 前端 | TypeScript + React 19 + Vite | 无 UI 框架、无路由库、无状态库。**唯一的框架级例外是编辑器引擎**：CodeMirror 6（`@codemirror/*` + `@lezer/markdown`，MIT）—— 它只准出现在 `features/scene/markdown/` 里（`MarkdownWysiwyg.tsx` + `livePreview.ts`），而且必须按需加载，见 §6 / §9 |
| 包管理 | pnpm（单包：`apps/framevault`；仓库根没有 workspace 定义，将来多包再上 workspace） | Tauri CLI 用 `@tauri-apps/cli` 作为 devDependency，**永远不要 `cargo install tauri-cli`** |
| 许可 | Apache-2.0 | 引入新依赖前先看 `docs/REFERENCES.md` 的许可证红线 |

**平台范围**：**Windows 仍是主开发平台；macOS 已验证可编译、可运行**（2026-09 实测：`cargo test` / `pnpm exec tsc --noEmit` / `pnpm build` / `pnpm tauri dev` 全通，窗口走系统原生红黄绿，见 `src-tauri/tauri.macos.conf.json`）。
**Android：能编出 APK，并已在模拟器上跑起来**（2026-09-24 实测：JDK 17 + Android SDK（compileSdk 36）+ NDK 29 + 四个 Rust 交叉目标就绪；`pnpm tauri android build --debug --apk` 出包，装在 MuMu（x86_64 / Android 12）上，手机骨架、窄屏横切、底部标签栏都正常，logcat 无崩溃）。
**但"能用"还不成立**：Android 上**选不了目录** —— `tauri-plugin-dialog` 的 Android 端只有 `ACTION_GET_CONTENT` / `ACTION_CREATE_DOCUMENT`，没有 `ACTION_OPEN_DOCUMENT_TREE`，所以"新建仓库"这一步必然失败（这正是 `docs/PROPOSAL_mobile_vault_saf_zh-CN.md` 要做的 SAF）。**真机（arm64）也还没验过**（只装过 x86_64 那个包）。调用系统相机仍推迟到需要时再写 Kotlin 插件。
**不要为了 Android 提前设计跨平台抽象**：Android 的差异目前只体现为"窗口开不出来""屏幕窄"和"选不了目录"。

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
- **两套骨架**：桌面 = 左文件夹树（可收起成一条图标栏）+ 右场景舞台（`App.tsx` 里的 `DesktopShell`）；手机 = 顶部场景切换（右侧一个设置齿轮）+ **左右两页的横滑主体**（左 = 设置，右边那页里再按底栏切 记录 / 照片 / 文件夹）+ 底部标签栏（`app/MobileShell.tsx`）。**设置页住在"记录"左边**：在记录界面向右滑就露出来，所以底部标签栏里**没有**「设置」（2026-09 用户拍板）；**仓库管理也住在设置里**（`SETTINGS_SECTIONS` 的「仓库」一栏就是真面板），手机上不再有独立的仓库页面。横滑用 `scroll-snap` 交给浏览器做手势，不手写 touch 抽屉。
  两者**共用同一份能力与数据**（`useFolders` / `useActiveFolder` / `useSceneData` / `SceneHost`），**区别只有编排**。
  **共用状态挂在 `App` 上，不挂在骨架里**（`SceneShellProps` = 场景树 + 当前选中的场景 + 它的主题信息，
  由 `App` 调用 `useFolders` / `useActiveFolder` / `useAppearance` 后传下去）。
  骨架自己只留"用完就扔"的视图状态（侧栏宽度、当前标签、弹层开关）。
  为什么：跨过断点会**换掉骨架组件**，挂在骨架里的 state 跟着组件一起销毁重建 ——
  表现就是"一缩窗口就跳回第一个场景"（AGENTS §9 有这一行）。
  走哪套由 `lib/useCompact.ts`（视口宽度，响应式）与 `isMobileOS`（能不能开第二个窗口）共同决定。
  **断点带滞后**：窄到 640 才切手机骨架，宽到 680 才切回桌面 —— 中间 40px 是死区，
  否则窗口停在阈值上时两套骨架会反复互切，整个界面（连图片尺寸）跟着跳。

## 3. 数据模型铁律

1. **仓库是"名字就是名字"的三层，磁盘为准**：
   **主题** = 根下一个**没有 `folder.json`** 的一级目录（用户自己分的组，**不存任何字段**）；
   **文件夹** = 带 `folder.json` 的目录（直接摆根下 = 没有主题，也允许）；
   **记录** = 文件夹里的一个目录（`"{创建日} {标题}"`，里面是 `entry.json` + `note.md` + 媒体本体）。
   **认目录只有一条规则**：带 `folder.json` = 文件夹，不带 = 容器（主题）；
   容器里既可以放文件夹，也可以直接放记录（「未归类」就是这种容器，按**名字**认，扫描时按结构认）。
   **归属 = 物理位置**（父目录是谁就是谁的），`Entry.folderId` 是这件事的字段记录，
   所以改归属 = **真的搬目录**（`move_entry_to_slot`），不是只改一个字段。
   用户在资源管理器里挪动 / 改名，扫一次就跟着认；**手动改过的名字永久保留**，系统永不覆盖它。
   "归类 / 分组"仍然只是展示层的事（侧栏按 `effectiveScene` 分组显示）。
2. **用户数据必须经 Rust 落盘**：排序、置顶、主题绑定、主题业务进度、封面……
   错：写进 React state 或 localStorage 就当作保存了（重启就没了），或塞进 SQLite（它只是缓存）。
3. **派生数据不进 Vault**：SQLite 索引、缩略图 → 应用数据目录（Windows `%APPDATA%\com.framevault.app\`，macOS `~/Library/Application Support/com.framevault.app/`，代码里一律走 Tauri 的 `app_data_dir()`，不自己拼）。
   它们随时可重建，**永远不是真相来源**（PRD FV-SYN-002）。
4. **写盘一律原子**：`storage::write_json_atomic`（tmp + rename），不要裸 `fs::write`。
5. **加字段必须 `#[serde(default)]`**；删字段也不能让同版本的老文件读不出来——serde 默认忽略未知字段，
   并且要有测试守着（看法 `vault/folder.rs` / `vault/model.rs` 里的 `old_*_still_loads` 测试）。
   **但跨大版本不做兼容**：v1（扁平 `entries/<uuid>/` + 全局 `media/<uuid>/` 那套）的仓库**直接给中文错误**，
   不迁移、不写兼容测试（2026-09 拍板：「这软件还没有人用」）。改 `SCHEMA_VERSION` 就等于换布局。
6. **id 一律 UUIDv7，由 Rust 发**（`new_id` 命令）。**时间戳由调用方给**，Rust 层不引时钟依赖（测试才好写）。
7. `SCHEMA_VERSION` 在 `vault/model.rs`。改版本号之前先想清楚老数据怎么办。
8. **媒体住在记录目录里**，文件名在导入那一刻按场景的命名模板生成一次（默认 `{date}_{scene}_{n}`），
   之后**永不自动改** —— 用户手动改过的名字永久保留。
   **媒体只有一个名字：`MediaMeta.file`**（磁盘上那个）—— 界面显示、排序、拼路径全用它；
   **导入前的原名不存**（导入那一刻它就被模板改掉了，留着只会让人以为文件还叫那个名字）。
   **归属 = 它在哪个记录目录里**（没有"无主媒体"这回事）。
   **重名判定一律按大小写不敏感**（`naming::unique_child_name`，2026-09 定）：Windows / macOS 的盘本来就不敏感，
   手机上的 FAT/exFAT 也是——三端一条规则。方向是"宁可多让一个名字"：判重严格顶多名字不漂亮，**判宽了会覆盖别人的文件**。
   实现上**列一次目录 + 集合查**，不要一个候选一次 `exists()`（SAF 上那是一次次 ContentResolver 往返）。
9. **正文是 `note.md`，不是字段**：`Entry.note` 带 `#[serde(skip)]`，读时从文件填进来、写时写回文件，
   所以 `entry.json` 里永远没有正文的第二个副本。哪些字段算正文由 manifest 声明（`note: true`），
   一个主题最多一个；没声明的主题，正文照旧留在 `fields` 里（不丢数据，只是不是一个能直接打开的 `.md`）。

## 4. 术语表（**防漂移的关键，务必按这个说**）

> **2026-09-23 拍板（第二轮，取代此前所有用法）**：
> **主题 = 记录讲的内容**（科研 / 旅游 / 挑战……），**场景 = 记录的方式**（随心记 / 认真写作 / 拍照打卡……）。
> 两者管不同层面的事：主题管内容与归类，场景管**界面与录入的特化**。
> 设计过程见 `docs/PROPOSAL_topics_scenes_zh-CN.md`。

| 概念 | 说明 | UI 文案 | 代码标识 |
|---|---|---|---|
| **主题** | 记录讲的内容；用户可以随便命名、随便分（叫"科研"或叫"打卡"都行，App 不给它功能含义）。**磁盘上就是一层目录，不存任何字段**（位置派生） | 主题 | 目录名；`FolderNode.topic`（派生） |
| **场景** | 记录的方式：随心记一句 / 认真写一篇 / 拍照打卡……决定**界面怎么排版、录入怎么特化**。是**代码**（少数几个），与内容无关 | 场景 | `scene`（**正名**）：`FolderMeta.scene`、`effectiveScene`、`builtin_scenes()` |
| **文件夹** | 一堆记录 + 绑定的场景。用户点击、命名、置顶的就是它 | 文件夹 | `Folder` / `FolderMeta` / `FolderNode` |
| **记录** | 一条内容（正文 `note.md` + 媒体 + 字段） | 记录 | `Entry` |
| **外观** | 整个软件的风格（配色 / 字体 / 圆角 / 间距 / 阴影），含**外观预设**（一整套值） | 外观 | `--fv-*` token、`features/theme/`、`src/skins.css`、`preset.*` |
| 照片 / 视频 | 住在记录目录里的媒体本体 | 照片 / 视频 | `MediaMeta` / `MediaItem` |

⚠️ **“皮肤 / Skin” 不是独立概念**：它并入**外观**（手段 ① 变量覆盖 `--fv-*` ✅ 承诺稳定；
手段 ② 组件规则 = 覆盖公开类名，⚠️ 有限承诺）。UI 与文档里不要再用"皮肤"指代配色。

**已作废的旧用法**（不要再用，看到就当 bug）：

| 旧说法 | 为什么废 |
|---|---|
| 「场景 = 文件夹」 | 场景现在是**记录方式**；文件夹就叫文件夹 |
| 「主题 = 功能主题 / 玩法模板」 | 主题现在是**内容分类** |
| 「主题 = 外观」 | 外观就叫外观（这个词本来就没歧义） |
| 「代码里的 `scene` 是历史命名，永远不要写」 | `scene` **是正名** —— `folder.json` 里那个字段存的就是"绑哪个场景"，正是这个意思 |

三条文案规则：

1. UI 里 **"文件夹"** = 用户点击的那个容器；**"主题"** = 它上面那层分类；**"场景"** = 它绑的记录方式；
2. UI 里 **"外观"** 专指配色那一套，不要拿"主题"说外观；
3. 三层名字**一次说清**：`主题 / 文件夹 / 记录`（磁盘）对应 `--fv-*` 那个**外观**（风格）。混用就是漂移源。

## 5. 命令 / 事件契约

- 命令名 `snake_case`、动词开头（`list_entries` / `save_entry` / `import_media`）。
- **主题（2026-09 第三轮）**：`create_folder` 多了 `topic`（`Some("科研")` = 建在那个主题目录里，
  `None` = 直接摆根下）；新增 `list_topics` / `create_topic` / `rename_topic` / `delete_topic`
  （主题没有元数据，所以只有建 / 改名 / 删；空主题也要列出来）。`FolderNode.topic` 是**派生字段**
  （磁盘位置 → 名字），不进 `folder.json`。
- **v2 之后的参数变化**：`save_entry` 多了 `day`（本地创建日，前端给 —— 目录名要用）与 `note`（正文）；
  `update_entry` 多了 `note`（不传就不动 `note.md`）；`import_media` 的 `entryId` **变成必填**，
  另加 `nameTemplate`（场景 manifest 里声明的命名模板，前端解析后传入；不传走核心默认）。
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
- **新增一个**场景**（记录方式）= 写一个组件 + 在 `registry.ts` 加一行 + 在 Rust 的 `builtin_scenes()` 登记同一个 id**。
  **新增一个主题（内容分类）什么都不用写** —— 建个目录就行（它是数据，不写代码、不进注册表）。
  核心（记录格式、其他场景）一律不动。
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
- **内置主题共用能力、各自编排**：普通日记 / 旅行 / 挑战共用 `SceneComposer`（录入 / 防重复提交）与 `EntryTimeline`（时间线 / 编辑 / 媒体 / 删除）；**写作台自己编排界面**（左侧篇列表 + 右侧一整块所见即所得的编辑区），但同样只走 `useSceneData`、表单走 `SceneFields`、编辑器走 `MarkdownWysiwyg`、大图走 `MediaLightbox` —— 它没有一处自己写的输入控件。`manifest.presentation` 只声明图标名 / 推荐外观（**2026-09 起没有「类别短语」了** —— 它只服务于舞台横幅，横幅已删）；外壳只经注册表读取。普通日记是 `builtin.plain`，旅行是 `builtin.travel`，挑战是 `builtin.challenge`，**写作台**是 `builtin.writing`（一屏一篇的长文写作，正文所见即所得）。
- **外观与功能主题靠 CSS 作用域分开，不许互相引用**：
  - **外观主题**（一套值 = 一个预设）挂 `:root[data-appearance="preset.x"]`，**所有窗口、所有区域**都读它；用户手调的单值覆盖优先级最高（内联在 `documentElement` 上）。**外壳**（标题栏 / 侧栏 / 选中行 / 设置窗口）的风格属于外观，**不许**跟着“当前场景是哪个主题”变。
  - **功能主题的巧思**只挂它自己的**舞台容器**（`data-scene` 在舞台那一层，**不在** `.app-root`），所以主题样式在作用域上碰不到外壳；允许的只有白名单：图标、`--fv-scene-banner`，以及主题视图自己的排版。
  - **优先级链**：用户单值覆盖 > 预设 > `:root` 默认；选哪套预设**只由用户决定**（`用户选过` > `默认预设`）—— **场景不再推荐配色**（`manifest.presentation.suggestedAppearance` 已删，2026-09 拍板：场景只决定怎么排版，配色归用户）。认不出的预设 → 回退默认，不白屏。**默认预设是「极简白」**（`preset.mono`，纯黑白灰、一点彩色都没有）。
  - **预设规范**：每套必须**浅色 + 深色两套都给**（否则切深色会露馅）；预设之间只许分**颜色**（`--fv-color-*` / banner / `--fv-nav-active-*`），字号、间距、圆角尺度、阴影这些“骨架”值各套必须一致 —— 几套外观要像**同一个产品**，不是几个 App。
- **Markdown 是核心能力，不是主题私有**：**只有一个控件、一种渲染** —— `features/scene/markdown/MarkdownWysiwyg.tsx`（CodeMirror 6 家族 + `livePreview.ts`），**按需加载**。**主题不许自己写渲染器 / 工具栏 / 富文本编辑器，也不许 import `@codemirror/*` 或 `@lezer/*`**。
  **一个引擎三种模式（2026-09 全量切换后定的形状）**：
  - `live`（默认）：即时渲染 —— 语法符号藏着，光标碰到才露（下面"实时渲染"那段）；
  - `source`：源码 + 语法高亮 + 一排语法按钮（手机上没有 Ctrl+B 这类快捷键，按钮是真有用）；
  - 只读：`readOnly` —— 时间线的**读态就用它**，所以"点一下就改"前后是**同一个实例**（不闪、不丢光标）。
  切换走 `Compartment` 重配，**不重建实例**（文档没变 ⇒ 不算一次改动，不会误触发保存）。宿主决定它长什么样：`variant="fill"`（写作台吃满剩余高度）/ `variant="inline"`（时间线、表单：跟着内容长、**不内部滚动**）。
  要文档级编辑就在视图里 `React.lazy` 引核心的 `MarkdownWysiwyg`（写作台就是这么做的）；字段声明照旧写 `textarea`，多行字段由 `SceneFields` 渲染成同一个控件，`FieldDecl.editor` 可选 `"live" | "source"` 声明默认模式。
  **输入与渲染同源**：磁盘上那串 Markdown 就是文档本身，"排版"由装饰算出来 —— 三种模式看的是同一份数据，不存在两份真相。磁盘格式与渲染器都不用知道记录是用哪种模式敲的。
  ⚠️ **`MarkdownField` / `MarkdownView` / `src/markdown/parse.ts` / `blocks.tsx` / `registry.ts` 已无人引用**（全量切到 CM6 之后留下的旧控件与旧渲染器；`remark` / `unified` 那族依赖因此不进包）。按 2026-09 的决定**暂时留档、不进包、不再维护** —— 新代码一律不要用它们；要加"自定义块"扩展点，位置在 `livePreview.ts` 的 widget / decoration，不是 `registry.ts`。
  **粘贴不需要任何特殊处理**：编辑器的文档**就是 Markdown 文本**，粘一整篇 `.md` 进来当场就是排好版的样子（旧 ProseMirror 版必须自己接 `handlePaste` + 一个 `looksLikeMarkdown` 判据才做得到，换引擎后两者都删了）。**已知回退**：从浏览器复制的带格式内容只剩文字（不再保留粗体 / 链接），这是刻意接受的代价，不做 HTML→MD 转换、不加转换依赖。
  **实时渲染（live preview）是核心能力，不是主题私有**：整篇按排版渲染，**语法符号只在光标碰到的地方露出来** —— 块级记号（`# ` / `> ` / `- ` / 围栏）按**行**露、行内记号（`**` / `` ` `` / `[](…)`）按**令牌**露；光标移开立刻收回去。这就是 Obsidian / Typora 的手感：源码即真值，没有"进模式"、没有盒子、选区永远贯穿全篇。
  实现分两半（CM6 的硬规矩，见 §9）：`livePreview.ts` 里 `outer`（行级 / 块级的类名与整块 widget）走 **StateField**、`inner`（行内记号与 widget）走 **ViewPlugin** 且只算视口。装饰样式在 `MarkdownWysiwyg.css`，**结构性那几条**（滚动容器、内边距、光标）在 `MarkdownWysiwyg.tsx` 的 `EditorView.theme` 里 —— 原因见 §9。主题照旧碰不到它，也照旧按需加载。
- 样式**全部包在 `@layer` 里**（层顺序在 `styles/layers.css`）；组件里**零裸色值**——颜色 / 间距 / 字号 / 圆角 / 阴影一律走 `--fv-*`。
  **尺寸只在"会被别处引用或需要主题覆盖"时才起 token**（`--fv-titlebar-height` 就是这种：它还要跟 `tauri.conf.json` 对齐）；
  只在一个组件里用的布局数值（网格列宽、`aspect-ratio`、`1px` 细线）写具体像素——别为了凑规则硬造 token，也别把同一组数值抄进两个文件（网格列宽照 `ARCHITECTURE_IMPL §4.6` 的写法）。
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
| 设计 token、公开类名、外观预设 | `docs/theme-contract.md` + `tokens.css` + `skins.css` |
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
| 滚动条引起的内容抖动（两种机制，都要治） | 拖动窗口时缩略图**反复变大变小**（网格列数在 2↔3 之间横跳） | ①**纵向**：布局“宽度决定列数、列数决定高度”时，滚动条出现/消失会让容器宽度跳 15px → 滚动容器加 `scrollbar-gutter: stable;`；②**横向↔纵向互相触发**：一点点横向溢出 → 出现横向滚动条（吃掉高度）→ 内容变高 → 出现纵向滚动条（吃掉宽度）→ 横向不再溢出 → 横向滚动条消失 → 宽度回来 → 又溢出……**无限循环**。所以纵向滚动容器还要 `overflow-x: hidden;`（结构上禁止横向滚动），并让可能超宽的按钮行 `flex-wrap: wrap;`；③**想让换列更平滑**：网格列宽一律 `repeat(auto-fill, minmax(最小, 上限))`，**别写 `1fr`** —— `1fr` 是「把余量全给我」，每掉一列所有格子一起膨胀一次，那才是「抖」的观感来源；给了具体像素上限（现在四处：`.entry__media` 112~176 / `.wall` 148~220 / `.photo-grid` 104~168 / `.writing__photos-body` 96~132）格子到上限就不再长大，跳变才有上界，代价是宽窗口右侧留一点白。改任何一处网格都照这个写法 |
| 用 `overflow: auto` 简写又想单独控制一个轴 | 写了 `overflow-x: hidden` 却毫无效果（简写把它重置回 auto）；修复“看起来改了但没生效” | 简写会重置**两个**轴，跟书写顺序无关的错觉最坑人。要单独控制就**全用长写**：`overflow-x: hidden; overflow-y: auto;`；插在简写**之前**必被覆盖 |
| 在移动端调 `open_vault_manager` / `open_settings` | 第二个窗口开不出来，调用失败或毫无反应 | **Android / iOS 只有一个 WebView 窗口**：这两样在移动端必须做成**内嵌页面**（见 `app/MobileShell.tsx`） |
| 在 macOS 上给窗口设 `decorations: false` | 去掉的不只是标题栏，而是整个 `Titled` style mask —— **圆角、阴影、边缘拖拽缩放一起没了**。mac 上要原生外观就得 `decorations: true` + `titleBarStyle: Overlay` + `hiddenTitle`（见 §12 的 `tauri.macos.conf.json`） |
| 把 `data-scene` 挂在 `.app-root` 上给主题选配色 | 功能主题连带改掉了整个软件的外观（标题栏、侧栏、设置窗口），三个主题看起来像三个 App | 外观挂 `:root[data-appearance]`（全窗口），`data-scene` 只挂**舞台容器**；功能主题的外观只走巧思白名单 |
| 在共享组件的样式里写死某个主题 id | `SceneTree.css` 里 `[data-scene="builtin.travel"]` 那条：第四个主题（或第三方主题）**不报错、不提示**，只是少一条样式，最难查 | 共享组件里不许出现主题 id；需要区分的观感做成 token（如 `--fv-nav-active-bg` / `--fv-nav-active-fg`），由**外观预设**给值 |
| 自研过一版 textarea + 工具栏（`MarkdownField`，已弃用） | 踩了三个坑：插入时重设 value **清掉撤销栈**、按钮不阻止默认行为导致**手机键盘当场收起**、输入法组合期动选区**截断拼音串** | 换 CM6 后这三条由内核负责（插入走事务、装饰不碰 DOM）。**现在工具栏按钮唯一的纪律**：`onMouseDown={(e) => e.preventDefault()}`（否则点按钮时编辑器失焦、手机键盘收起） |
| 给 220ms 防抖上报的编辑器配一个「保存」按钮 | 敲完字 220ms 内点保存会**存到旧内容**（丢字）—— `MarkdownWysiwyg` 是攒一小会儿才 `onChange` 的 | **用自动保存**，且写盘延迟必须**大于**编辑器上报延迟（我们是 600ms > 220ms）；时间线的自动保存就是这么定的 |
| 把"点整条卡片进编辑"的 onClick 挂在 `<li>` 上 | 跟拖拽源（`draggable`）、缩略图、正文里的链接抢事件；划选复制也会被当成点击 | 点击挂在**里层真元素**（标题 / 正文）上，加 `window.getSelection()?.isCollapsed` 守卫；读态点链接由编辑器自己 `stopPropagation` |
| 在时间线里给每个编辑器套一个内部滚动区 | 手机上变成"滚动里套滚动"，极难用（`scrollbar-gutter: stable` 还会在每条记录右侧留一道空槽） | `variant="inline"`：高度跟着内容长 + `overflow-y: hidden` + `scrollbar-gutter: auto`。结构性那几条在 `inlineTheme` 里，**不能写进 CSS**（CM6 基础样式是未分层的） |
| 用 CSS / 同特异性 theme 去覆盖 CM6 的结构性样式（内边距 / 高度 / 光标） | 两种形态：写进 CSS 一个字不生效（未分层压过分层）；写进 `EditorView.theme` 但**与 CM6 基础样式同特异性**（它也有 `.cm-content { padding: 4px 0 }`）时是"谁后注入谁赢"—— 实测基础样式赢，我们按变体给的内边距全被盖掉 | 抬一层特异性：`"&.cm-editor .cm-content": { … }`；变体值走**组件内 CSS 变量**（`--md-wysiwyg-pad`），由 CSS 按类名给值 |
| 读态不告诉 livePreview"没有光标" | 只读时选区仍停在位置 0，而规则是"光标碰到的块露源码"—— **第一个块会一直露着 `#`** | 读 `state.facet(EditorView.editable)`：不可编辑时一律当作"没碰到"；并且**重配（读态 ↔ 编辑态）也要重算装饰**（`tr.reconfigured` / `update.transactions.some(t => t.reconfigured)`），否则会留着上一态露出来的记号 |
| 把"窗口整体失焦"也当成"点走了" | 切到别的应用再回来，编辑框被收起（用户以为丢东西了） | 失焦处理里先判 `document.hasFocus()`：窗口失焦**不收起**（只补写一次），页面内点别处才收起 |
| 把 Markdown 渲染塞进 p 标签 | 标题 / 列表是块级元素，浏览器自动闭合外层 p，DOM 与预期不符、排版莫名 | 容器用 div（正文那处已改）；同理别把块级元素放进 p |
| 跨窗口状态**整份回写** | 主骨架每次重算外观都会写一次盘，把设置窗口刚改的变量 / 刚选的选择冲回旧值 —— 表现为「改了没反应」「切了没用」 | **每个字段只有一个 owner**：overrides / scheme / appearance 只有设置窗口写，applied 只有主骨架写；写盘一律 **patch 合并**（只带自己那一项），广播出去的才是合并后的完整快照 |
| 把所见即所得编辑器当受控组件整份回写 | 每次渲染都 `replaceAll(value)`：光标被拽回开头、中文输入法串被打断、撤销栈被清，表现为"打着打着字跳了" | 编辑器**只在"外部换了内容"时回灌一次**：用 ref 记住自己刚 `onChange` 出去的那份，`value === emitted` 就直接返回；自己的输入只向上报，不往下灌 |
| 重编辑器静态 import | 一次都没打开的写作台，也让首屏多下载 334 KB（gzip +102 KB）—— 实测主包 417.9 KB vs 静态引入后的 ~752 KB | 带框架的重编辑器一律 `React.lazy` + `Suspense`（写作台只在自己这一屏里加载它）；判断标准是"不是每次开窗都要用的东西" |
| 以为换引擎后还得自己接过粘贴管线 | 旧 ProseMirror 版确实要自己接（`handlePaste` + `looksLikeMarkdown` 判据），因为它的文档是节点树、`**` 不在文档里 | 现在**不需要**：文档就是 Markdown 文本，纯文本原样插入、当场按渲染规则排版，那两个东西已经删掉。**已知回退**：从浏览器复制的富文本只剩文字（见 §6）|
| 在 `ViewPlugin` 的 decorations 里给行 / 块加装饰 | CM6 直接抛 `RangeError: Block decorations may not be specified via plugins`，而且**整块不渲染** —— 画面全空、DOM 里却什么都有（`a11y` 还能读到文字），极难一眼看出 | 行级与块级装饰**必须走 `StateField`**（`Decoration.line`、`block: true` 的 replace）；行内记号与 widget 才能留在 `ViewPlugin` 里（且只算 `view.visibleRanges`） |
| 把 CM6 的结构性样式写进 `@layer` 里的 CSS | 一个字都不生效：CM6 往 document 注入自己的基础样式，那是**未分层**的，按层叠层的规矩未分层永远压过分层 | 滚动容器 / 内边距 / 光标这几条走 `EditorView.theme({...})`（值仍是 `--fv-*`）；装饰类名照旧写 CSS 文件 |
| 用 `Decoration.replace({ block: true })` 整行吞掉围栏行 / 表格行 | 行是没了，但**相邻行的行级装饰一起被丢掉**，表格 widget 也不落地 —— 表现出来就是"代码块没样式、表格凭空消失" | 少用块级替换：围栏改成"藏掉围栏文本 + 整块（含围栏行）铺代码背景"，表格改成行内替换（代价是表格后面留两行空行，可接受） |
| 露出源码的粒度按记号自己判 | 围栏那类 = 上下两条 `CodeMark` 各自跟光标比，光标在正文时两条都不露，"光标进块显示源码"当场失效 | 块级记号按**宿主块**判：`rangeTouched(parent.from, parent.to)`；行内记号才按令牌自己的范围判 |
| 以为在 App 窗口里能验证编辑器行为 | 自动化给窗口发合成键盘事件常常到不了 WebView（连普通 `<input>` 都收不到），而且 App 可能是提权进程、`UIA` 直接拒接；结果把"自动化打不进字"误判成"编辑器坏了" | **在真浏览器里验**：临时挂一个 `harness.html` + `harness.tsx` 用 vite 跑起来，用浏览器自动化（Playwright）精确点选 / 打字 / 读计算样式与 DOM —— 快且可断言；集成（挂载、主题 token、`@layer`）再回 App 里看 |
| 把"主题"也做成带字段的实体（`folder.json.topic`） | 会出现"字段写着科研、目录却在旅游下"这种自相矛盾的状态，跟"磁盘为准 + 归属由位置派生"两套判据并存迟早打架 | 主题**不存字段**：它就是一层目录，谁在里面就是谁的（`FolderNode.topic` 由 Rust 扫出来给前端）。白送的好处：在资源管理器里把文件夹拖到别的主题下，回应用就是那个主题的 |
| 扫描与"落点"用同一条规则去认「未归类」 | 扫描按结构认"没有 folder.json 的一级目录"，但用户可能建了「科研」——那"没有文件夹的记录该放哪"就没有确定答案了（会随仓库里恰好有几个主题而变） | 分工：**扫描按结构**（任何容器里的记录都算数），**写路径按名字**（`ensure_uncategorized` 只找叫「未归类」的那个，没有就建） |
| 把窄屏规则写进 `styles/compact.css` 就不管了 | **规则完全不生效**，而且不报错：那个文件在 `main.tsx` 里**先于**组件样式导入，同样的选择器优先级下，后导入的组件样式赢 —— "规则明明写在这儿却毫无作用"，最费时间的一类问题 | 跟文件里既有的写法一样，**用复合选择器抬优先级**：`.settings .settings__row`（0,2,0 > 0,1,0）；组件自己也有的那一层用双类名（`.settings.settings`）。写完**必须在窄窗口里真的看一眼** |
| 在 flex 链上靠 `height: 100%` 撑满一屏 | 中间某一环的高度不确定时，格子塌成**内容高度**：症状是"左栏那道竖线只画到内容底部，下面留一截线头"（我们是设置面板在手机骨架里内嵌时遇到的） | 高度**用 flex 传**：容器 `display: flex; flex-direction: column`，自己 `flex: 1; min-height: 0`；别指望百分比高度在 flex 项上一定解析得出来 |
| 直接跑 `target/debug/framevault.exe` 打开应用 | 窗口里只有"localhost 拒绝连接"：**调试构建指向 vite 的 dev server**（`localhost:1420`），dev server 没起来它就没东西可加载 | **一律 `pnpm tauri dev`**（它把 vite 和 Rust 一起拉起来）。改过命令表 / Rust 之后更要重启它 —— 直接跑 exe 只能验证 Rust，前端永远是空的 |
| 自动保存 + "按 `updatedAt` 重载草稿" | 丢字：存一次 → 整个列表重拉 → `updatedAt` 变了 → 草稿被磁盘版本盖回去，打字快的时候刚敲的字就没了 | 重载草稿的依赖**只认"哪一篇"**，不跟 `updatedAt`；待写内容连同"是哪一篇"一起放进 ref（切篇 / 失焦 / 卸载都能补写）；写入要防抖（我们 600ms），别每键一次写一遍盘 |
| 在触摸屏上做"右键菜单" | 手机上根本没有右键，功能等于不存在 | 加**长按**兜底（我们 500ms，`pointerType === "mouse"` 时不进计时，免得鼠标误触）；菜单本身做成公共件（`EntryMenu`），别每个主题写一份 |
| 两套骨架各自 `useState` 存"当前选中的场景" | 跨过断点换骨架时组件重挂载，选择被重置成第一个场景 —— 用户看到的就是"缩一下窗口就跳回第一个"（拉伸再缩、缩了再拉，每次都跳） | 共用状态挂在**两套骨架的公共父节点**（`App`）上，用 props 传下去（`SceneShellProps`）；骨架里只留视图开关。判断"是不是真的重挂载了"：临时数一下页面被加载过几次，或看状态是不是全空一轮 |
| 在跑着的 dev 实例里验证编辑器的行为改动 | vite HMR 会热替换组件代码，但**编辑器实例只在挂载时创建一次**（现在是自己 `useEffect(…, [])` 里 `new EditorView`，工厂同样只在挂载跑一遍），已挂载的编辑器继续跑旧逻辑 —— 「提交了修复但还是坏的」多半是在旧实例里验的 | 整页刷新（Ctrl+R）或重启 `pnpm tauri dev` 后**真的敲/真的点**一遍。另外，字面粘贴过的老条目存盘时语法字符已被转义（`\>`、`\*\*`），重开看着仍像"没渲染"—— 那是坏数据不是复现，用**新建条目**验证 |
| 改标题 / 改场景名只写 JSON，不搬目录 | 界面上名字变了、磁盘上还是旧名字 —— "名字就是名字"当场破功，用户在外面根本找不到 | 写盘一律走 `write_entry` / `save_folder`：先写内容 → 再算目标目录名 → 需要就 `rename`（撞名加 ` (2)`）。判定能不能自动改名的依据是**当前目录名 == 按旧值算出来的名字**；不等就说明用户手动改过，从此只写内容、**永久不动目录名** |
| 改名判定写成 `if let (true, false) = (may_rename, current != wanted)` | 元组模式是正向匹配：条件不成立时不进分支，于是**改名永远不发生**，而且一声不响（只有断言抓得住） | 直接写 `if may_rename && current != wanted`；这类"永假"的写法一定要有测试断言目录真的动了 |
| 扫描时按磁盘名改写记录的 `title` | 用户在应用里改的标题，下一次列出就被目录名覆盖回去 —— 表现是"改了没反应" | 标题的真相在 `entry.json`，目录名是**名字**不是标题；手动改过名只影响"以后不再自动改名"。场景那边反过来：`FolderMeta.name` 没有别的地方存，就是磁盘目录名 |
| 回收站目录用 `<entryId>` 命名 | 撤销时只能按 `day + title` 重算目录名，**用户手动改过的名字就此丢掉** | 回收站里保留**原来的目录名**（撞名加后缀）；撤销就是把它原样挪回原场景，一个字符都不改 |
| 对账写成"文件不在 `media[]` 里就收养" | ①导入完立刻读一次会**重复收养**同名的照片（两套元数据指向一个文件）；②读命令顺手写盘，容易踩"读到一半写回" | 收养前先按**文件名**排重（`file` 是磁盘上的唯一身份）；对账只在"真的变了"时写盘，并且只写 `entry.json` |
| 净化没做全：Windows 保留名、尾部空格与点、按字节截断中文 | 目录/文件建不出来，或者建出来的名字与读回来的不一致（Windows 会悄悄删掉尾部的点与空格）；中文被字节截断成乱码 | 名字一律过 `vault/naming.rs`：非法字符换下划线、保留名加前缀、去尾部空格与点、**按字符数截断**、空名兜底。新场景 / 新记录 / 新媒体都必须走它，别处不许自己拼名字 |
| 场景里的多块面板想各自独立滚动（列表 / 照片 / 编辑器） | 给内层 `flex:1 + min-height:0` 之后**整页还在滚** —— 断点在祖先：`.scene-host` 的 `min-height: 100%` 只是"最小高度"，内容一高它跟着长，收缩链从它这里作废（写作台实测：编辑器把 `.writing` 撑到 2000+px）；而且 grid 的 `1fr` 行默认是 `minmax(auto, 1fr)`，auto 下限会被列表的自然高度撑爆 | 锚点层用**确定的 `height: 100%`**（`.scene-host`；它的父级 `.content` 是定高块级滚动容器，百分比在这里解析得出来）；中间每一环显式写：grid 行 `minmax(0, 1fr)`、flex 子项 `min-height: 0`，**一层都不能省**；滚动容器照 §4.6 长写。怀疑哪层断了就临时给各层加彩色 `outline`，看谁的框跟着内容长 |
| 在 `commands/window.rs` 里直接链 `.center()` / `.closable()` / `.decorations()` | Windows / macOS 编得过，**Android 直接编译不过**（`no method named ... found for struct WebviewWindowBuilder`）：这三个方法在 tauri 里挂在 `#[cfg(desktop)]` 的 impl 块上（`webview_window.rs` 的 456 / 521 / 550 行），移动端根本没有。和 macOS 那几个 `title_bar_style` 是同一类坑，只是这次缺的是"桌面"。**注意 rustc 每次只报一条**：修完 `center` 才会告诉你 `closable` 也没有 | 三个一起包进 `#[cfg(desktop)]`（`.center().closable(true)` 写一行），macOS 那三个照旧单独 `#[cfg(target_os = "macos")]`，自绘标题栏那条用 `#[cfg(all(desktop, not(target_os = "macos")))]`。平台分支只准出现在 `commands/window.rs`（§2）。`set_focus` / `close` 是跨平台的，不用动 |
| Windows 上跑 `tauri android build` / `dev` | 报 `Failed to create a symbolic link ... Creation symbolic link is not allowed for this system.`：Tauri 把编好的 `.so` **软链接**进 `gen/android/app/src/main/jniLibs/<abi>/`（省得每回搬 174 MB），而 Windows 默认只让管理员建符号链接。**两个 target 都编译成功了才死在这一步**，看着像"代码编不过"，其实是权限 | 开**开发者模式**（设置 → 系统 → 开发者选项 → 开发人员模式）。**关键：这条权限是登录组装令牌时授的，开关打开以前就存在的终端拿不到**（`whoami /priv` 里没有 `SeCreateSymbolicLinkPrivilege`）—— 开完要**注销重登或重启**；急用就直接用**管理员终端**跑一次（实测提权能过）。CLI 里没有"改复制"的开关，`gradle` 那条路也会回调同一个 CLI 命令，绕不开 |
| 以为 `tauri android build` 只是本地编译 | 卡在 `Downloading https://services.gradle.org/distributions/gradle-8.14.3-bin.zip failed: timeout` —— Gradle wrapper 要先下自己的发行包（131 MB，解压后 277 MB），国内直连这个域名基本必超时。报错长在 Gradle 的 Java 栈里（`org.gradle.wrapper.Download`），很容易误判成构建脚本的问题 | 改 `gen/android/gradle/wrapper/gradle-wrapper.properties` 的 `distributionUrl` 指向腾讯云镜像 `https://mirrors.cloud.tencent.com/gradle/gradle-8.14.3-bin.zip`（**版本号必须与原值一致**；阿里云没有 gradle 镜像，实测 404）。**`gen/android` 是生成目录，重跑 `tauri android init` 会把这行冲掉**。Maven 那边不用管：`dl.google.com` 与 Maven Central 实测都通 |
| 安卓出包第二次开始报 `Failed to delete some children`（`:app:packageUniversalDebug`） | 上一次构建留下的 **Gradle 守护进程**开着文件监听，占着 `app/build/outputs` 不放 —— 实测连给旧 APK 改名都失败（`Device or resource busy`），而报错文案说的是"有进程打开着文件"，容易被当成杀毒软件干扰 | 构建前 `gradlew --stop`（**安卓整套流程**：出包 / 装 MuMu 或真机 / `run-as` 看 app 里的文件 / 快循环 `android dev`，连 Windows 那两道坎与坑速查表，都写在 `docs/DEV_ANDROID_zh-CN.md`；出包用 `apps/framevault/scripts/android-apk.sh`，停守护进程与免调试符号都已经包进去了） |

## 10. 现在明确不做（YAGNI / 已拍板推迟）

- **目录嵌套只到"主题"这一层**：主题（一层目录）> 文件夹 > 记录，**再往下不再嵌套**；
  "归类/怎么分组显示"仍然是展示层的事（导航栏那三种分组方式）。
- **Android 与调用系统相机**：推迟到 Android 适配阶段。
- **同步、插件宿主、Marketplace、多窗口标签页、日历视图、全文检索**：都还没到，别提前设计。
- **视频抽帧（ffmpeg）**：按 PRD 属 P1/P2；现在视频交给 WebView / 平台解码。
- **不引路由库、状态库、CSS-in-JS、UI 组件库**。编辑器引擎（**CodeMirror 6**）是**唯一的框架级例外** —— 它不是"UI 组件库"，而是"磁盘上那串 Markdown 的编辑引擎"，边界见 §1 / §6：只准出现在 `features/scene/markdown/`、按需加载、主题碰不到。
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
│   │   │                       scenes/travel（旅行）/ scenes/writing（写作台：一屏一篇的长文）
│   │   │                       SceneComposer / EntryTimeline / EntryMenu（右键与长按菜单）/ SceneIcon
│   │   │                       markdown/（MarkdownView 渲染 + MarkdownField 表单输入 + MarkdownWysiwyg 所见即所得 + livePreview 实时渲染装饰 + registry 注册表 + blocks 组件）
│   │   ├── vault/              仓库：悬浮切换菜单 + 管理窗口面板
│   │   ├── settings/           设置：左导航 + 右内容
│   │   └── theme/              外观：预设选择 + token schema + 实时编辑 + 跨窗口同步
│   ├── lib/api.ts              **唯一** invoke / listen / convertFileSrc 出口
│   ├── lib/platform.ts         前端唯一一处"现在是什么系统"的判断（isMacOS / isMobileOS）
│   ├── lib/useCompact.ts       视口够不够宽（响应式，不是平台分支）
│   ├── styles/                 layers.css（层顺序）/ reset.css / compact.css（窄屏横切调整）
│   ├── markdown/               纯逻辑：parse.ts = Markdown 的唯一出口（别处不许 import remark）
│   ├── tokens.css              设计令牌默认值（`:root`）：唯一允许出现裸色值的地方
│   └── skins.css               外观预设：`:root[data-appearance="preset.*"]`，每套必须浅 / 深两套
└── src-tauri/
    ├── tauri.conf.json         assetProtocol 已开；窗口 decorations: false（Windows 自绘标题栏）
    ├── tauri.macos.conf.json   macOS 覆盖：窗口走原生红黄绿（Overlay + hiddenTitle）
    ├── capabilities/default.json  三个窗口的权限
    └── src/
        ├── lib.rs              组装 + generate_handler
        ├── error.rs            AppError / AppResult
        ├── state.rs            VaultRegistry + vaults.json 持久化
        ├── commands/           vault / folder（文件夹 + 主题）/ entry / media / window（薄适配器）
        └── vault/              领域核心（不认识 tauri）：
                                naming（净化 / 目录名派生 / 媒体模板 / 去重 —— **磁盘名字的唯一出口**）
                                storage（路径约定 + 扫描对账 + 原子写 + 回收站）
                                store（**存储抽象**：VaultStore trait + NativeFs + Vault 根句柄；
                                       SAF 实现住在平台层，见 §2）
                                model / folder / scene / media / id
    └── tests/layout_v2.rs      存储 v2 的端到端验收（走一遍用户流程，每一步都看磁盘）
```

```text
<用户选的目录>/          ← Vault：用户数据，可备份、可同步、可手改
├── vault.json                     身份文件（有它才算 Vault；layout: 2）
├── .framevault/trash/<原目录名>/   删掉的记录挪这儿（撤销 = 挪回原文件夹）
├── 科研/                           **主题**：一级目录 + **没有 folder.json**（用户自己分的组）
│   └── 论文笔记/                    文件夹：folder.json 里绑一个**场景**（怎么记）
│       └── 2026-09-23 周报/         记录：`{创建日} {标题}`
│           ├── entry.json
│           ├── note.md             正文（唯一真相）
│           └── 2026-09-23_论文笔记_01.jpg
├── 晨跑打卡/                       文件夹也可以直接摆根下 = **没有主题**
└── 未归类/                         没有文件夹的记录（默认容器，按名字认）

%APPDATA%/com.framevault.app/   ← 本机缓存（macOS 是 ~/Library/Application Support/…），删了能重建
├── vaults.json           已知仓库列表 + 当前仓库
└── thumbs/<vault-id>/<media-id>.jpg
```
