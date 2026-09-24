# 提案：安卓端 Vault 选目录 —— SAF 存储桥 + StorageProvider 抽象

> **状态：已批准、分七期实施（2026-09-24）**。S0（补网）已完成。
> 前置依赖：安卓构建环境（JDK 17 / Android Studio / SDK / NDK / Rust 交叉目标，见 AGENTS §1 平台范围）—— **已就绪**，
> `pnpm tauri android build --debug --apk` 已能在真机/模拟器上跑起来（见 `docs/DEV_ANDROID_zh-CN.md`）。

## 已定的三个决策（2026-09-24 用户拍板）

1. **自写 Kotlin 桥**，不用社区插件（`tauri-plugin-android-fs` 之类）：Kotlin 只做平台胶水
   （Intent / 持久授权 / ContentResolver 读写），规则全在 Rust。代价是要把 `gen/android` 纳入版本控制
   （Kotlin 桥写在那儿，而 `tauri android init` 会覆盖它）。
2. **照片一起做**：Vault 内的原图/视频走**自定义协议**（`vaultfs://`），媒体**物理上仍住在用户选的目录里**。
   （另一条"导入时在应用私有目录留副本"的捷径被否掉：那会让媒体不再物理住在 Vault 里，
   违反"用户数据是打开就能拿走的普通文件"这条核心价值。）
3. **跨端一致性是硬线**（写进 AGENTS 铁律）：桌面打包 → 传到手机 → SAF 选目录导入，必须开箱可用、逐文件一致。
   三条纪律：① Vault 内容只有一份产出者（`vault/` 领域层，`VaultStore` 只换"字节怎么落盘"）；
   ② Vault 里不许有绝对路径与平台字段；③ 禁止三条捷径（媒体挪私有目录 / 安卓专用字段 / 安卓专用命名规则）。
   **唯一允许的差异**：SAF 没有"同目录 tmp + rename 覆盖"的原子语义 —— 用"写临时 → 改名 → 删旧"逼近，
   并把这条写进 AGENTS §9。

## 分期（每期独立验证）

| 期 | 做什么 | 验证 |
|---|---|---|
| **S0 ✅ 已完成** | `vaults.json` 能表达 path / SAF URI + 全部字段 `serde(default)`（拆掉"加字段就起不来"的启动炸弹）；`unique_child_name` 改成"列一次目录 + 集合查"且判重按大小写不敏感 | `cargo test` 86 单测 + 4 端到端全绿 |
| **S1a ✅ 已完成** | `vault/store.rs`：`VaultStore` trait（只做原语）+ `NativeFs` + `MemStore` + `Vault` 根句柄；**同一套 conformance 断言在两种实现上各跑一遍**（桌面那批"磁盘形状"的断言用裸 `std::fs`，SAF 下没有磁盘可看，语义只能钉在这一层） | `cargo test` 89 单测 + 4 端到端全绿 |
| **S1b** | 把 `storage.rs`（36 个 `pub fn`）/ `folder.rs` / `media.rs` 的参数从 `vault: &Path` 换成 `&Vault`；命令层 21 处 `active_vault` 改成拿句柄 | 同上全绿 + 桌面行为零变化 |
| **S2** | Kotlin SAF 桥 + `SafStore`；建仓 / 导仓 / 切换三条流程切过去；对账改成走 store 且"列不出来就跳过" | MuMu 选目录 → 建仓 → 写一篇 → `run-as` 查磁盘 |
| **S3** | 媒体导入走字节/流；缩略图吃 `&[u8]`；**给相机留接缝**（导入 API 接受"来源"而不是写死路径） | 导一张图；反向跨端验收 |
| **S4** | `vaultfs://` 自定义协议 + 前端 URL 化（缩略图仍走 asset，Vault 内原图/视频走新协议） | 大图、视频、照片墙滚动 |
| **S5** | 真机（arm64）验收 + 文档同步（含新铁律） | 重启后授权还在；双向跨端验收 |
| **S6** | 拍照直接进仓库（零 Kotlin 路：`<input capture>` + manifest 加 CAMERA；要应用内预览/录像再上 CameraX） | 拍一张进当前文件夹 |

**停在 S2 就是一个"文本可用且跨端一致"的安卓版**；S6 可以插在任何一期之后。

## 背景与用户裁定

安卓没有「自由选文件夹」的路径访问：应用对用户目录的一切读写必须走 **SAF**（系统返回
`content://` URI + 持久化授权）。此前提案里的「v1 简单方案：Vault 放应用私有目录」被用户否决 ——
**移动端必须像 Obsidian 一样：用户在系统目录选择器里选 Vault，Vault 留在用户放的地方**
（包括坚果云 / Syncthing 的同步目录）。

Obsidian 安卓版就是这个机制，是安卓公开能力，不是黑魔法：

1. `ACTION_OPEN_DOCUMENT_TREE` 弹系统目录选择器 → 用户选目录；
2. `takePersistableUriPermission` 拿到**跨重启的**读写授权（URI 记下来就是 Vault 身份）；
3. 之后一切读写走 `ContentResolver` + `DocumentFile` 按「URI + 相对路径」进行。

## 设计

### 1. Kotlin SAF 桥（安卓侧插件）

最小命令集（tauri 插件，写在 `gen/android` 的工程里）：

| 桥命令 | 作用 |
|---|---|
| `pickTree()` | 弹系统目录选择器 → 持久化授权 → 返回 `content://` URI（存进 vaults.json 当作 Vault 路径） |
| `list(uri, relPath)` | 列子目录 / 子文件（名字 + 是否目录） |
| `readText(uri, relPath)` / `writeText(...)` | entry.json / folder.json / note.md 的读写（原子性由「写临时 + 文档级 rename」近似） |
| `mkdir(uri, relPath)` / `rename(uri, from, to)` / `delete(uri, relPath)` | 目录与文件操作（改名/搬记录/回收站都靠它们） |
| `copyIn(uri, relPath, sourceUri)` | 媒体导入：把相册选中的 content URI **复制进** Vault 树 |

### 2. Rust：`VaultStore` trait（StorageProvider 首次上岗）

- 现状：`vault/storage.rs` 直呼 `std::fs`，与 v2 的目录结构耦合；
- 改法：文件读写收口到一个 trait（`read_text / write_text / list_dir / mkdir / rename / remove / copy_in …`），
  两个实现：**`NativeFs`**（桌面，现状直通）与 **`SafStore`**（安卓，每步经 Kotlin 桥）；
- `vault/` 的领域函数（建仓、扫描、改名、回收站、媒体收养）全部改为面向 trait —— **业务规则一行不改**，
  改的只是「文件操作从哪来」；
- 身份变化：桌面存路径，安卓存 URI；`vaults.json` 两种都记（`path` / `uri` 字段）。

### 3. 交互与命名不变

- 移动端首次启动 → SAF 选目录（Obsidian 同款系统弹窗）→ 建仓 / 导入仓库；
- 目录名派生、净化、媒体命名模板、回收站、未归类 —— **全部规则原样保留**（名字仍是字符串，
  「目录」变成 SAF 文档树里的虚拟目录）；「磁盘为准 / 手动改名永久保留」的判定照旧成立。

### 4. 媒体导入

相册选图（`ACTION_OPEN_DOCUMENT` / Photo Picker）→ 桥 `copyIn` 复制进记录目录 →
Rust 拿到**字节流**做 EXIF / sha256 / 命名模板（`import_media` 的入口分叉：桌面收路径、安卓收字节）。

## 顺序

分期与验证见上面的表（S0~S6）。原来那份"依赖环境就绪"的六步顺序已经被它取代 ——
其中前两步（安卓环境、`android init` + 跑通壳）**已经完成**，见 `docs/DEV_ANDROID_zh-CN.md`；
3~6 步的内容分别落在 S2（Kotlin 桥 + 三条流程）、S1（`VaultStore` 抽象）、S3~S4（媒体）、S5（真机验收）。

## 风险与成本（诚实账）

| 项 | 账 |
|---|---|
| 工程量 | M2 里最大的一块：存储入口重构 + 一个 Kotlin 插件；比相机插件大 |
| SAF 性能 | ContentResolver 比直接 fs 慢一个数量级 —— 扫描/列表要缓存；**M1 推迟的 SQLite 索引在这个阶段大概率真要回来了** |
| 原子性 | SAF 没有「同目录 tmp + rename」的完整语义，写策略要用文档级 rename 近似并在测试里钉住 |
| 好消息 | M4 同步（WebDAV）本来就要 StorageProvider —— 这次等于把 M4 的地基提前打了一半 |
| 已知适配债 | 触摸屏上 HTML5 拖拽不生效（今天的拖动排序）→ 安卓端要补长按拖动或移动按钮；返回键导航；WebView 版本碎片化实测 |
