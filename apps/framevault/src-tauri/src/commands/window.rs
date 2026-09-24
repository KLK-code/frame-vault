use crate::error::AppResult;
use tauri::Manager; // 提供 get_webview_window / config

// 注意 #[tauri::command(async)]：**没有 async 关键字的命令跑在主线程**，
// 在主线程里建窗口会把消息循环搞坏（窗口建出来但关不掉）——踩过这个坑。

/// macOS：窗口保留系统标题栏（圆角、阴影、原生红黄绿都在），
/// 但内容铺满整个窗口、标题文字不画，红黄绿就浮在自绘顶栏上层。
///
/// **红黄绿的位置只有一份来源**：`tauri.macos.conf.json` 里主窗口的 `trafficLightPosition`，
/// 子窗口在这里把它读出来复用。别再写一个常量 —— 写两处迟早会不一致，
/// 而"主窗口和子窗口的红黄绿差几像素"是那种看着别扭但说不出哪不对的问题。
/// （为什么那个 y 是 14：见 AGENTS §9，原理写在那边，这里不重复。）
///
/// 这几个 builder 方法都带 `#[cfg(target_os = "macos")]`，调用点必须也包在 cfg 里，
/// 否则 Windows 直接编译不过——不是可选的写法。
#[cfg(target_os = "macos")]
fn native_titlebar<'a, R: tauri::Runtime, M: tauri::Manager<R>>(
    app: &tauri::AppHandle<R>,
    builder: tauri::WebviewWindowBuilder<'a, R, M>,
) -> tauri::WebviewWindowBuilder<'a, R, M> {
    let builder = builder
        .decorations(true)
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true);

    match app
        .config()
        .app
        .windows
        .iter()
        .find(|w| w.label == "main")
        .and_then(|w| w.traffic_light_position.clone())
    {
        Some(pos) => builder.traffic_light_position(tauri::LogicalPosition::new(pos.x, pos.y)),
        None => {
            // 读不到就退回系统默认位置，但要吼一声：
            // 多半是主窗口 label 被改了，或者平台配置没被合并进来
            eprintln!(
                "[rust] 主配置里没有 main 窗口的 trafficLightPosition，红黄绿用系统默认位置"
            );
            builder
        }
    }
}

#[tauri::command(async)]
pub fn open_vault_manager(app: tauri::AppHandle) -> AppResult<()> {
    if let Some(w) = app.get_webview_window("vault-manager") {
        w.set_focus()?;
        return Ok(());
    }

    let builder = tauri::WebviewWindowBuilder::new(
        &app,
        "vault-manager",
        tauri::WebviewUrl::App("index.html".into()),
    )
    .title("管理仓库")
    .inner_size(760.0, 540.0)
    .resizable(true);

    // 下面三个方法是**桌面专属**：`center` / `closable` / `decorations` 在 tauri 里都挂在
    // `#[cfg(desktop)]` 的 impl 块上，Android 上根本没有这几个方法（编译就过不去）。
    // 和 macOS 那三个 `title_bar_style` 是同一类坑，只是这次缺的是"桌面"而不是"macOS"。
    // 移动端也不需要：那边只有一个 WebView，这两个窗口压根开不出来（见 AGENTS §9）。
    #[cfg(desktop)]
    let builder = builder.center().closable(true);
    #[cfg(target_os = "macos")]
    let builder = native_titlebar(&app, builder);
    #[cfg(all(desktop, not(target_os = "macos")))]
    let builder = builder.decorations(false); // 自绘标题栏

    builder.build()?;

    Ok(())
}

#[tauri::command(async)]
pub fn close_vault_manager(app: tauri::AppHandle) -> AppResult<()> {
    if let Some(w) = app.get_webview_window("vault-manager") {
        w.close()?;
    }
    Ok(())
}

#[tauri::command(async)]
pub fn open_settings(app: tauri::AppHandle) -> AppResult<()> {
    if let Some(w) = app.get_webview_window("settings") {
        w.set_focus()?;
        return Ok(());
    }

    let builder = tauri::WebviewWindowBuilder::new(
        &app,
        "settings",
        tauri::WebviewUrl::App("index.html".into()),
    )
    .title("设置")
    .inner_size(720.0, 560.0)
    .resizable(true);

    #[cfg(desktop)]
    let builder = builder.center().closable(true);
    #[cfg(target_os = "macos")]
    let builder = native_titlebar(&app, builder);
    #[cfg(all(desktop, not(target_os = "macos")))]
    let builder = builder.decorations(false);

    builder.build()?;

    Ok(())
}

#[tauri::command(async)]
pub fn close_settings(app: tauri::AppHandle) -> AppResult<()> {
    if let Some(w) = app.get_webview_window("settings") {
        w.close()?;
    }
    Ok(())
}
