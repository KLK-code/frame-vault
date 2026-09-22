/**
 * 前端唯一一处「现在是什么系统」的判断。要用平台分支，从这里 import，别在组件里再写一遍。
 *
 * 为什么用 UA 而不是 @tauri-apps/plugin-os：
 *   这里只用来决定「标题栏左边要不要给红黄绿让位、要不要自绘那三个按钮」——纯展示层。
 *   为它引一个 native 插件要多付：一个 Rust crate、一个 npm 包、capabilities 里一条权限、
 *   REFERENCES.md 里登记许可证，外加一次异步 IPC（首帧拿不到，要么闪一下、要么推迟首屏）。
 *   等真需要 arch / version（按平台发不同构建、上报环境）时再换 plugin-os，那时只改这一个文件。
 *
 * 为什么不问 Rust：Tauri 只把 osName 注入给它自己的内部脚本（drag.js 等），
 * 没有暴露给业务代码；要拿就得加命令，而按 AGENTS §5 加一个命令要同步改四处。
 *
 * 已知边界：iPad 桌面模式的 UA 里也有 Macintosh，会被判成 mac。移动端按 AGENTS §10 推迟，
 * 真做的时候一并处理；判错的后果只是顶栏内边距和按钮，不碰数据。
 */
export const isMacOS = navigator.userAgent.includes("Macintosh");
