# FrameVault 主题契约（Theme Contract）

> 面向：想给 FrameVault 写外观主题的人，以及要改默认样式的我们自己。
> 配套阅读：架构文档 §4.6（样式归属）、§13.1（外观主题 vs 功能主题）；设置窗口里的「外观 · 实时调整」。

## 0. 三层可定制级别（先认清自己在哪一层）

| 级别 | 做什么 | 用什么 | 稳定性 |
|---|---|---|---|
| **1. 变量覆盖**（推荐） | 换颜色 / 字体 / 圆角 / 间距 | 覆盖 `--fv-*` 变量 | ✅ **承诺稳定** |
| **2. 组件规则**（Skin） | 改密度、边框、布局细节 | 覆盖第 2 节列出的公开类名 | ⚠️ 有限承诺 |
| **3. 功能主题**（Workspace Type） | 换界面结构与流程 | 插件（M5） | 未定 |

**写主题请优先停在级别 1。** 级别 2 用到的类名如果不在公开表里，随时可能变。

## 1. 公开 token 表（可安全覆盖）

共 **41** 个变量，其中 **18** 个在深色主题里也定义了一份（主题必须两套都给，否则切到深色会露馅）。

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
| `--fv-text-xs` | `12px` | — | — |
| `--fv-text-sm` | `13px` | — | — |
| `--fv-text-base` | `15px` | — | — |
| `--fv-text-lg` | `17px` | — | — |
| `--fv-text-xl` | `22px` | — | — |
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
| 场景舞台（右侧） | `.scene-host`、`.scene-host--empty`、`.scene-host__head`、`.scene-host__name`、`.scene-host__theme`、`.scene-host__notice` |
| 内置普通记录主题 | `.plain-scene`、`.plain-scene__compose`、`.plain-scene__list`、`.plain-scene__empty`、`.plain-scene__count`、`.plain-scene__error`、`.entry`、`.entry__head`、`.entry__title`、`.entry__time`、`.entry__body`、`.entry__actions`、`.entry__meta`、`.entry__edit`、`.entry__edit-title`、`.entry__edit-text`、`.entry__edit-actions`、`.entry__media`、`.thumb`、`.thumb__fallback` |
| 内置挑战主题 | `.challenge`、`.challenge__head`、`.challenge__progress`、`.challenge__bar`、`.challenge__fill`、`.challenge__numbers`、`.challenge__streaks`、`.challenge__setup`、`.challenge__state`、`.challenge__rules`、`.challenge__settings`、`.challenge__field`、`.challenge__settings-actions`、`.challenge__compose`、`.challenge__empty`、`.challenge__error`、`.wall`、`.wall__cell`、`.wall__btn`、`.wall__fallback`、`.wall__date`、`.challenge__note`、`.challenge__note-actions`、`.challenge__note-hint` |
| 大图 / 视频预览 | `.lightbox`、`.lightbox__body`、`.lightbox__media`、`.lightbox__footer`、`.lightbox__bar`、`.lightbox__caption`、`.lightbox__unsupported`、`.lightbox__hint` |
| 独立窗口 | `.window`、`.window__body` |
| 仓库切换菜单 | `.vault-switcher`、`.vault-switcher__button`、`.vault-switcher__name`、`.vault-switcher__menu`、`.vault-switcher__item`、`.vault-switcher__path`、`.vault-switcher__sep` |
| 设置界面 | `.settings`、`.settings__nav`、`.settings__search`、`.settings__nav-item`、`.settings__nav-icon`、`.settings__content`、`.settings__title`、`.settings__group-title`、`.settings__card`、`.settings__row`、`.settings__text`、`.settings__label`、`.settings__desc`、`.settings__badge`、`.settings__action`、`.settings__status` |
| 管理仓库 | `.manager__head`、`.manager__head-actions`、`.manager__hint`、`.manager__list`、`.manager__info`、`.manager__actions`、`.manager__empty`、`.manager__status` |

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
