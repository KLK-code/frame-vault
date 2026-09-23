# FrameVault 主题契约（Theme Contract）

> 面向：想给 FrameVault 写外观主题的人，以及要改默认样式的我们自己。
> 配套阅读：架构文档 §4.6（样式归属）、§13.1（外观主题 vs 功能主题）；设置窗口里的「外观 · 实时调整」。

## 0. 两件事，别混（外观主题 / 功能主题）

| | **外观主题**（Theme） | **功能主题**（Workspace Type） |
|---|---|---|
| 决定什么 | **整个软件的风格**：配色、字体、圆角、间距、阴影 —— 所有窗口、所有区域 | 某个文件夹里的**玩法**：字段、编辑方式、视图、流程 |
| 手段 / 形态 | ① **变量覆盖**（推荐）：覆盖 `--fv-*` → ✅ **承诺稳定**<br>② **组件规则**：覆盖第 2 节的公开类名，改密度 / 边框 / 布局细节 → ⚠️ 有限承诺 | 一份 manifest + 视图组件（M5 之后开放给插件） |
| 挂在哪 | `:root[data-appearance="preset.*"]` —— **所有窗口都跟随** | 舞台容器（`data-scene`）—— **作用域碰不到外壳** |
| 一套值叫 | **外观预设（Preset）**，如 `preset.paper` | 主题 id，如 `builtin.travel` |

**“皮肤 / Skin” 不是独立概念**：它就是外观主题的**手段 ②（组件规则）**，稳定性较弱。
写主题请优先用手段 ①；手段 ② 用到的类名如果不在公开表里，随时可能变。

**功能主题的「巧思」白名单**（只挂舞台容器，碰不到标题栏 / 侧栏 / 设置窗口）：图标、`--fv-scene-banner`、主题视图自己的排版。除此之外一律归外观主题。

## 1. 公开 token 表（可安全覆盖）

共 **49** 个变量，其中 **19** 个在深色主题里也定义了一份（主题必须两套都给，否则切到深色会露馅）。

| 变量 | 默认值 | 用途 | 深色主题覆盖 |
|---|---|---|---|
| `--fv-color-bg` | `#ffffff` | 内容区底色 | ✅ |
| `--fv-color-surface` | `#fbfbfa` | 侧栏 / 面板 / 标题栏（Obsidian 的暖灰） | ✅ |
| `--fv-color-surface-hover` | `#f2f2f1` | 悬停底色 | ✅ |
| `--fv-color-surface-active` | `#eaeae8` | 按下底色 | ✅ |
| `--fv-color-text` | `#171717` | 正文：接近纯黑，屏幕上更利落 | ✅ |
| `--fv-color-text-strong` | `#0a0a0a` | 需要更实（标题栏按钮悬停等） | ✅ |
| `--fv-color-muted` | `#6e6e6e` | 次要文字：不要太浅，浅了整屏发灰 | ✅ |
| `--fv-color-border` | `#e8e8e6` | 发丝线 | ✅ |
| `--fv-color-border-strong` | `#d8d8d5` | 需要用力的分隔线 | ✅ |
| `--fv-color-accent` | `#086ddd` | — | ✅ |
| `--fv-color-accent-soft` | `#e8f1fd` | 选中底色 | ✅ |
| `--fv-color-accent-hover` | `#f0f5fc` | 悬停淡色 | ✅ |
| `--fv-color-danger` | `#c0392b` | — | ✅ |
| `--fv-color-danger-strong` | `#e81123` | 关闭按钮悬停（Windows 习惯色） | — |
| `--fv-color-on-danger` | `#ffffff` | — | ✅ |
| `--fv-color-focus-ring` | `#086ddd` | 键盘聚焦环 | ✅ |
| `--fv-color-selection` | `#d7e6fb` | 文本选中底色 | ✅ |
| `--fv-color-scrim` | `rgba(0, 0, 0, 0.62)` | 大图 / 对话框背后的遮罩 | ✅ |
| `--fv-nav-active-bg` | `var(--fv-color-accent-soft)` | 侧栏选中行底色（外壳风格，归外观管） | — |
| `--fv-nav-active-fg` | `var(--fv-color-accent)` | 侧栏选中行文字 | — |
| `--fv-color-paper` | `var(--fv-color-bg)` | 记录纸面 / 输入区底色 | — |
| `--fv-color-on-accent` | `#ffffff` | 实心主色按钮上的文字 | ✅ |
| `--fv-color-on-scrim` | `#ffffff` | 遮罩（大图 / 对话框）上的文字 | — |
| `--fv-scene-banner` | `linear-gradient(120deg, var(--fv-color-accent-soft), var(--fv-color-bg))` | 场景横幅渐变（功能主题的巧思之一） | — |
| `--fv-titlebar-height` | `32px` | — | — |
| `--fv-titlebar-inset-mac` | `80px` | 仅 macOS：顶栏左侧让给红黄绿的位置（与 `commands/window.rs` 的 `TRAFFIC_LIGHT` 必须同时改） | — |
| `--fv-radius-sm` | `4px` | — | — |
| `--fv-radius-md` | `6px` | — | — |
| `--fv-radius-lg` | `10px` | — | — |
| `--fv-space-1` | `4px` | — | — |
| `--fv-space-2` | `8px` | — | — |
| `--fv-space-3` | `12px` | — | — |
| `--fv-space-4` | `16px` | — | — |
| `--fv-space-5` | `24px` | — | — |
| `--fv-space-6` | `32px` | — | — |
| `--fv-space-7` | `48px` | — | — |
| `--fv-font-sans` | `"MiSans", "HarmonyOS Sans SC", system-ui, "Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif` | — | — |
| `--fv-font-mono` | `ui-monospace, "Cascadia Mono", Consolas, monospace` | — | — |
| `--fv-font-display` | `"Georgia", "STKaiti", "KaiTi", serif` | 标题 / 签名用的衬线字体 | — |
| `--fv-text-xs` | `12px` | — | — |
| `--fv-text-sm` | `13px` | — | — |
| `--fv-text-base` | `15px` | — | — |
| `--fv-text-lg` | `17px` | — | — |
| `--fv-text-xl` | `22px` | — | — |
| `--fv-text-hero` | `34px` | 场景签名那种超大字号 | — |
| `--fv-line-height` | `1.6` | — | — |
| `--fv-shadow-1` | `0 1px 2px rgba(0, 0, 0, 0.06)` | — | — |
| `--fv-shadow-2` | `0 6px 24px rgba(0, 0, 0, 0.1)` | — | ✅ |
| `--fv-shadow-menu` | `var(--fv-shadow-2)` | 兼容旧名字 | — |

规则：

0. **对比度**：正文类文字（`--fv-color-text`）对比度要 ≥ **4.5:1**，次要文字（`--fv-color-muted`）≥ **3:1**。
   `--fv-color-muted` **只给次要文字**用（说明、路径、占位、状态行）；导航项、标题、按钮标签这类**主要文字必须用 `--fv-color-text`**——
   错误地把 muted 当默认文字色，会让整个界面"灰蒙蒙"，这是最常见的主题事故。
1. **只覆盖，不要新增**（新增变量属于改默认样式，请提 PR 而不是包主题）；
2. **不要用 `!important`**——主题写在 `@layer theme` 里，本来就压过组件层（见第 4 节）；
3. **深色模式**：覆盖 `[data-theme="dark"]` 里同一批变量，组件一行都不用改。

### 1.1 外观预设规格（preset）

一个预设 = **一整套 `--fv-*` 的值**，挂 `:root[data-appearance="preset.<id>"]`，所有窗口都读它。

| 规矩 | 细节 |
|---|---|
| 两套色值 | **浅色 + 深色都必须给全**（沿用第 1 节第 3 条：不给就会在切深色时露馅） |
| 只许分颜色 | 允许变：`--fv-color-*`、`--fv-color-focus-ring` / `--fv-color-selection`、`--fv-scene-banner`、以及外壳层少数变量（侧栏选中行 `--fv-nav-active-bg` / `--fv-nav-active-fg`）；**骨架值不许变**：字号、间距、圆角尺度、阴影 —— 三套外观要像**同一个产品**，不是三个 App |
| 对比度 | 正文 `--fv-color-text` ≥ 4.5:1，次要文字 `--fv-color-muted` ≥ 3:1（同第 1 节规则 0） |
| id 命名空间 | 内置 `preset.*`；第三方 `vendor.*`（M3 之后再放开） |
| 认不出来 | 回退默认预设，**不白屏、不报错打断** |
| 优先级 | 用户在设置里的**单值覆盖 > 预设 > `:root` 默认**；选哪套预设：**用户选过 > 当前主题的 `suggestedAppearance` 推荐 > 默认预设** |

功能主题可以在 `manifest.presentation.suggestedAppearance` 里**推荐**一套预设（纯数据），但**不能强制**。

内置三套（id / 名字 / 代码落点三处一致）：`preset.paper` 暖纸、`preset.tide` 青碧、`preset.ember` 炭火 —— 值写在 `src/skins.css`，列表写在 `features/theme/presets.ts`。

## 2. 公开 selector 表（承诺稳定的类名）

只有下面这些类名是对外承诺的，其余（尤其未来新增的内部类）**不保证不变**。

| 区域 | 公开类名 |
|---|---|
| 标题栏 | `.titlebar`、`.titlebar__title`、`.titlebar__actions`、`.titlebar__btn`、`.titlebar__btn--close` |
| 主外壳 | `.app-root`、`.app`、`.sidebar`、`.sidebar__footer`、`.sidebar__icon`、`.app__divider`、`.content` |
| 场景树（左侧） | `.scene-tree`、`.scene-tree__head`、`.scene-tree__title`、`.scene-tree__add`、`.scene-tree__compose`、`.scene-tree__compose-actions`、`.scene-tree__scroll`、`.scene-tree__empty`、`.scene-group`、`.scene-group__title`、`.scene-group__count`、`.scene-row`、`.scene-row-wrap`、`.scene-row__name`、`.scene-row__pin`、`.scene-row__more`、`.scene-row__input`、`.scene-menu` |
| 手机骨架 | `.mobile`、`.mobile__bar`、`.mobile__scene`、`.mobile__scene-name`、`.mobile__scene-theme`、`.mobile__body`、`.mobile__settings`、`.mobile__tabs`、`.mobile__tab`、`.mobile__sheet`、`.mobile__sheet-head`、`.mobile__sheet-title`、`.mobile__sheet-done`、`.mobile__sheet-body`、`.mobile__vault`、`.mobile__vault-dot`、`.mobile__vault-name`、`.mobile__caret`、`.mobile__hint`、`.mobile__error` |
| 场景照片墙 | `.photo-grid`、`.photo-grid__cell`、`.photo-grid__date`、`.photo-grid__fallback`、`.photo-grid__empty` |
| 可撤销提示 | `.scene-notice`、`.scene-notice__text`、`.scene-notice__action`、`.scene-notice__close` |
| 声明式表单 | `.fields`、`.field`、`.field__label`、`.field__unit`、`.field__control` |
| 场景舞台（右侧） | `.scene-host`、`.scene-host--empty`、`.scene-host__notice`（**2026-09 起舞台没有标题区**：原先的 `.scene-host__head` / `__name` / `__theme` 已删除，`--fv-scene-banner` 暂时没有使用者） |
| 内置普通记录主题 | `.plain-scene`、`.plain-scene__compose`、`.plain-scene__list`、`.plain-scene__empty`、`.plain-scene__count`、`.plain-scene__error`、`.entry`、`.entry__head`、`.entry__title`、`.entry__time`、`.entry__body`、`.entry__actions`、`.entry__meta`、`.entry__edit`、`.entry__edit-title`、`.entry__edit-text`、`.entry__edit-actions`、`.entry__media`、`.thumb`、`.thumb__fallback` |
| 内置写作台主题 | `.writing`、`.writing__bar`、`.writing__count`、`.writing__btn`、`.writing__empty`、`.writing__body`、`.writing__list`、`.writing__item`、`.writing__item-day`、`.writing__item-summary`、`.writing__sheet`、`.writing__head`、`.writing__date`、`.writing__time`、`.writing__dirty`、`.writing__meta`、`.writing__actions`、`.writing__hint`、`.writing__photos`、`.writing__photo-fallback`、`.writing__loading` |
| 内置挑战主题 | `.challenge`、`.challenge__head`、`.challenge__progress`、`.challenge__bar`、`.challenge__fill`、`.challenge__numbers`、`.challenge__streaks`、`.challenge__setup`、`.challenge__state`、`.challenge__rules`、`.challenge__settings`、`.challenge__field`、`.challenge__settings-actions`、`.challenge__compose`、`.challenge__empty`、`.challenge__error`、`.wall`、`.wall__cell`、`.wall__btn`、`.wall__fallback`、`.wall__date`、`.challenge__note`、`.challenge__note-actions`、`.challenge__note-hint` |
| 大图 / 视频预览 | `.lightbox`、`.lightbox__body`、`.lightbox__media`、`.lightbox__footer`、`.lightbox__bar`、`.lightbox__caption`、`.lightbox__unsupported`、`.lightbox__hint` |
| 独立窗口 | `.window`、`.window__body` |
| 仓库切换菜单 | `.vault-switcher`、`.vault-switcher__button`、`.vault-switcher__name`、`.vault-switcher__menu`、`.vault-switcher__item`、`.vault-switcher__path`、`.vault-switcher__sep` |
| 设置界面 | `.settings`、`.settings__nav`、`.settings__search`、`.settings__nav-item`、`.settings__nav-icon`、`.settings__content`、`.settings__title`、`.settings__group-title`、`.settings__card`、`.settings__row`、`.settings__text`、`.settings__label`、`.settings__desc`、`.settings__badge`、`.settings__action`、`.settings__status` |
| 管理仓库 | `.manager__head`、`.manager__head-actions`、`.manager__hint`、`.manager__list`、`.manager__info`、`.manager__actions`、`.manager__empty`、`.manager__status` |
| Markdown 输入控件 | `.md-field`、`.md-field__head`、`.md-field__bar`、`.md-field__btn`、`.md-field__modes`、`.md-field__mode`、`.md-field__input`、`.md-field__preview`、`.md-field__empty` |
| 主题的 manifest 声明（`FieldDecl.note` / `SceneManifest.mediaNameTemplate`） | **承诺语义，不承诺字段名之外的形状**：`note: true` 的多行字段 = 这条记录的正文（落磁盘上的 `note.md`，不进 `entry.json`），一个主题最多一个；`mediaNameTemplate` = 媒体导入时的命名模板（纯数据，可用 `{date}` / `{scene}` / `{title}` / `{field:<key>}` / `{n}`），不声明就走核心默认 `{date}_{scene}_{n}`。两者都由核心渲染 / 执行，主题不写实现 |
| Markdown 所见即所得编辑器 | `.md-wysiwyg`（**内部类名不算承诺**：`CodeMirror` 自己的 `.cm-editor` / `.cm-content` / `.cm-line` 等跟着它的版本走，本仓库自己挂的装饰类名 `.cm-fv-*` 也属于实现细节，会跟排版一起调） |
| Markdown 正文 | `.md`、`.md__h` 与 `.md__h--1`…`.md__h--6`、`.md__p`、`.md__quote`、`.md__list`、`.md__list--ordered`、`.md__item`、`.md__item--task`、`.md__item-body`、`.md__check`、`.md__pre`、`.md__code`、`.md__inline-code`、`.md__strong`、`.md__em`、`.md__del`、`.md__hr`、`.md__link`、`.md__link-blocked`、`.md__table-wrap`、`.md__table`、`.md__cell`、`.md__cell--head`、`.md__cell--center`、`.md__cell--right`、`.md__notice` |

**没写进上表的都不承诺。** 尤其是网格的**列宽数值**（`.entry__media` / `.wall` / `.photo-grid` 用的 `minmax(最小, 上限)`）属于实现细节：
它跟着「拖窗口别抖」这个目标调过几轮，以后还会调。主题要改网格密度就自己写 `grid-template-columns`，
但**别把上限换成 `1fr`** —— 那会让每掉一列所有格子一起膨胀一次（见 `ARCHITECTURE_IMPL §4.6`）；也别删滚动容器的 `scrollbar-gutter: stable;`，删了滚动条一出现整页就会横跳。

命名约定：`.block__element--modifier`。**内部类名不加 `fv-` 前缀**，加了就意味着对外承诺。

## 3. 主题包格式（M3 落地，现在是设计稿）

```text
my-theme/
├── manifest.json
├── theme.css
└── preview.webp          可选，列表里显示用
```

`manifest.json`：

```json
{
  "id": "com.example.sakura",
  "name": "Sakura",
  "version": "1.0.0",
  "themeApiVersion": "1",
  "author": "your name",
  "description": "淡粉配色，浅色/深色各一套",
  "modes": ["light", "dark"]
}
```

`theme.css`：**必须写在 `@layer theme` 里**

```css
@layer theme {
  :root {
    --fv-color-accent: #d16b86;
    --fv-color-accent-soft: #fbeef2;
  }

  [data-theme="dark"] {
    --fv-color-accent: #e79bb0;
    --fv-color-accent-soft: #3a2a30;
  }
}
```

安全约束（沿用技术架构文档 §12.2）：主题默认**不执行 JS**、不允许远程资源、不允许读 Vault。纯 CSS。

## 4. 层顺序：为什么主题能压过组件

`src/styles/layers.css`：

```css
@layer reset, base, components, theme, user;
```

- `reset`：浏览器默认样式归零
- `base`：**tokens 就在这里**（`tokens.css`）
- `components`：所有组件样式
- `theme`：**主题包只写这一层** → 天然压过 components，**不需要 `!important`，也不用比选择器权重**
- `user`：用户在设置界面里的实时覆盖，落在 `:root` 的内联样式上，是**最强的一层**

> 注意：**未分层的样式会强过所有分层样式**。所以项目里任何新 CSS 文件都必须写进某一层，否则这套契约会漏。

## 5. 用实时编辑器调出默认样式（现在就能用）

1. 打开 **设置** 窗口 → 「外观 · 实时调整」；
2. 改颜色 / 圆角 / 字号 / 间距 → **全局立即生效**，不用重启、不用编译；
3. 满意后点「**复制当前覆盖为 CSS**」；
4. 把复制到的内容粘回 `src/tokens.css` 的 `:root` → 它就成了新的默认样式；
5. 单项点 `↺` 还原，或「全部重置」回到 tokens 里的默认值。

覆盖值存在 `localStorage`（键 `fv.themeOverrides`），配色模式存在 `fv.colorScheme`。它们属于「视图 / 偏好」类状态，**不进 Vault**（架构文档 §14）。

**为什么先做这个**：它能让你在**不写一行代码**的情况下把默认样式调出来——调好之后再决定哪些值固化成默认、哪些留给主题作者。

## 6. 兼容策略

| 变更 | 是否破坏性 | 处理 |
|---|---|---|
| 新增一个 token | ❌ 不是 | 老主题不写它就用默认值 |
| 新增一个组件 / 类名 | ❌ 不是 | 主题不覆盖就没影响 |
| **删除或改名** token / 公开类名 | ✅ **是** | 必须升 `themeApiVersion`，并写 ADR |
| 改动层的顺序或名字 | ✅ **是** | 同上 |
| 组件改用新的内部类名（不在公开表里） | ❌ 不是 | 主题本来就不该依赖它们 |

每次破坏性变更写一条 ADR（`docs/adr/`），并在本文档第 1、2 节更新表格。
