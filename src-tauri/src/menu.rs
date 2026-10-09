use crate::events::emit_menu_event;
use crate::state::FocusedWindow;
use std::collections::HashMap;
use tauri::menu::{IsMenuItem, Menu, MenuItem, MenuItemKind, PredefinedMenuItem, Submenu};
use tauri::Manager;

fn accelerator(
    shortcuts: &HashMap<String, String>,
    command_id: &str,
    default: Option<&str>,
) -> Option<String> {
    shortcuts
        .get(command_id)
        .cloned()
        .or_else(|| default.map(str::to_string))
}

fn build_menu(
    app: &tauri::AppHandle,
    shortcuts: &HashMap<String, String>,
) -> Result<Menu<tauri::Wry>, tauri::Error> {
    let about_accel = accelerator(shortcuts, "help.about", None);
    let settings_accel = accelerator(shortcuts, "settings.open", Some("CmdOrCtrl+,"));
    let quit_accel = accelerator(shortcuts, "app.quit", Some("CmdOrCtrl+Q"));

    let new_accel = accelerator(shortcuts, "file.new", Some("CmdOrCtrl+N"));
    let open_accel = accelerator(shortcuts, "file.open", Some("CmdOrCtrl+O"));
    let save_accel = accelerator(shortcuts, "file.save", Some("CmdOrCtrl+S"));
    let save_as_accel = accelerator(shortcuts, "file.saveAs", Some("CmdOrCtrl+Shift+S"));
    let undo_accel = accelerator(shortcuts, "editor.undo", Some("CmdOrCtrl+Z"));
    let redo_accel = accelerator(shortcuts, "editor.redo", Some("CmdOrCtrl+Shift+Z"));
    // 兜底键位必须与 registry.ts 的默认值一致：此前 find/replace 写的是
    // CmdOrCtrl+G / CmdOrCtrl+Shift+G，与 registry 的 Mod-f / Mod-h 不符，
    // 仅靠启动后 IPC 同步才盖住 ⇒ 首屏窗口期按的是错键（M-12）。
    let find_accel = accelerator(shortcuts, "edit.find", Some("CmdOrCtrl+F"));
    let replace_accel = accelerator(shortcuts, "edit.replace", Some("CmdOrCtrl+H"));

    let focus_mode_accel = accelerator(shortcuts, "view.focusMode", Some("CmdOrCtrl+Alt+F"));
    // registry 里 view.fullscreen 的默认：mac = Mod-Shift-f，其它平台 = F11
    #[cfg(target_os = "macos")]
    let fullscreen_default = "CmdOrCtrl+Shift+F";
    #[cfg(not(target_os = "macos"))]
    let fullscreen_default = "F11";
    let fullscreen_accel = accelerator(shortcuts, "view.fullscreen", Some(fullscreen_default));

    // ── 「solo」应用菜单 ─────────────────────────────────────────────
    // macOS 专属项（服务 / 隐藏 / 隐藏其他 / 显示全部）**只在 mac 构建**：
    //   1) Windows 上它们的事件被 attach_menu_events 吞掉，点了没有任何反应（死项）；
    //   2) 「隐藏 solo」硬编码的 CmdOrCtrl+H 会在 Windows 上注册成系统加速键，
    //      抢在 WebView2 之前吃掉 Ctrl+H，使 registry 的 edit.replace 永远收不到（M-06 / M-31）。
    let about_item = MenuItem::with_id(app, "help.about", "关于 solo", true, about_accel.as_deref())?;
    let settings_item =
        MenuItem::with_id(app, "settings.open", "设置...", true, settings_accel.as_deref())?;
    let quit_item = MenuItem::with_id(app, "app.quit", "退出 solo", true, quit_accel.as_deref())?;
    let sep_1 = PredefinedMenuItem::separator(app)?;
    let sep_2 = PredefinedMenuItem::separator(app)?;

    #[cfg(target_os = "macos")]
    let app_menu = {
        let services = PredefinedMenuItem::services(app, Some("服务"))?;
        let sep_3 = PredefinedMenuItem::separator(app)?;
        let hide = MenuItem::with_id(app, "app.hide", "隐藏 solo", true, Some("CmdOrCtrl+H"))?;
        let hide_others =
            MenuItem::with_id(app, "app.hideOthers", "隐藏其他", true, Some("CmdOrCtrl+Alt+H"))?;
        let show_all = MenuItem::with_id(app, "app.showAll", "显示全部", true, None::<&str>)?;
        let sep_4 = PredefinedMenuItem::separator(app)?;
        Submenu::with_items(
            app,
            "solo",
            true,
            &[
                &about_item as &dyn IsMenuItem<tauri::Wry>,
                &sep_1,
                &settings_item,
                &sep_2,
                &services,
                &sep_3,
                &hide,
                &hide_others,
                &show_all,
                &sep_4,
                &quit_item,
            ],
        )?
    };

    #[cfg(not(target_os = "macos"))]
    let app_menu = Submenu::with_items(
        app,
        "solo",
        true,
        &[
            &about_item as &dyn IsMenuItem<tauri::Wry>,
            &sep_1,
            &settings_item,
            &sep_2,
            &quit_item,
        ],
    )?;

    let file_menu = Submenu::with_items(
        app,
        "文件",
        true,
        &[
            &MenuItem::with_id(app, "file.new", "新建", true, new_accel.as_deref())?,
            &MenuItem::with_id(app, "file.open", "打开...", true, open_accel.as_deref())?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "file.save", "保存", true, save_accel.as_deref())?,
            &MenuItem::with_id(
                app,
                "file.saveAs",
                "另存为...",
                true,
                save_as_accel.as_deref(),
            )?,
        ],
    )?;

    let edit_menu = Submenu::with_items(
        app,
        "编辑",
        true,
        &[
            &MenuItem::with_id(app, "editor.undo", "撤销", true, undo_accel.as_deref())?,
            &MenuItem::with_id(app, "editor.redo", "重做", true, redo_accel.as_deref())?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, Some("剪切"))?,
            &PredefinedMenuItem::copy(app, Some("复制"))?,
            &PredefinedMenuItem::paste(app, Some("粘贴"))?,
            &PredefinedMenuItem::select_all(app, Some("全选"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "edit.find", "查找", true, find_accel.as_deref())?,
            &MenuItem::with_id(app, "edit.replace", "替换", true, replace_accel.as_deref())?,
        ],
    )?;

    let view_menu = Submenu::with_items(
        app,
        "视图",
        true,
        &[
            &MenuItem::with_id(
                app,
                "view.focusMode",
                "焦点模式",
                true,
                focus_mode_accel.as_deref(),
            )?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(
                app,
                "view.fullscreen",
                "全屏",
                true,
                fullscreen_accel.as_deref(),
            )?,
        ],
    )?;

    let help_menu = Submenu::with_items(
        app,
        "帮助",
        true,
        &[&MenuItem::with_id(
            app,
            "help.diagnostics",
            "打开启动诊断日志",
            true,
            None::<&str>,
        )?],
    )?;

    Menu::with_items(
        app,
        &[&app_menu, &file_menu, &edit_menu, &view_menu, &help_menu],
    )
}

pub fn setup_menu(
    app: &tauri::AppHandle,
    shortcuts: &HashMap<String, String>,
) -> Result<(), tauri::Error> {
    let menu = build_menu(app, shortcuts)?;
    app.set_menu(menu)?;
    Ok(())
}

pub fn attach_menu_events(app: &tauri::AppHandle) {
    app.on_menu_event(move |app, event| {
        let menu_id = event.id().as_ref().to_string();
        match menu_id {
            ref id if id == "app.hide" || id == "app.hideOthers" || id == "app.showAll" => {}
            _ => {
                // P0 修复：菜单事件定向发送到焦点窗口，不再全局广播
                let focused_label = app
                    .try_state::<FocusedWindow>()
                    .and_then(|state| state.get().ok().flatten());

                let target = focused_label
                    .as_deref()
                    .and_then(|label| app.get_webview_window(label));

                match target {
                    Some(window) => emit_menu_event(&window, &menu_id),
                    None => {
                        // 兜底：无法确定焦点窗口时，发给第一个已加载窗口而非全局广播
                        eprintln!("[menu] 无法确定焦点窗口，回退到首个已加载窗口: {menu_id}");
                        let fallback = app
                            .webview_windows()
                            .into_iter()
                            .find(|(label, _)| {
                                app.try_state::<crate::state::LoadedWindows>()
                                    .and_then(|state| state.contains(label).ok())
                                    .unwrap_or(false)
                            })
                            .map(|(_, w)| w);
                        match fallback {
                            Some(window) => emit_menu_event(&window, &menu_id),
                            None => {
                                eprintln!("[menu] 无可用窗口接收菜单事件: {menu_id}");
                            }
                        }
                    }
                }
            }
        }
    });
}

/// 只更新已有菜单项的快捷键，不重建菜单。O(n) 遍历，比 setup_menu 快。
pub fn update_menu_shortcuts<R: tauri::Runtime>(app: &tauri::AppHandle<R>, shortcuts: &HashMap<String, String>) -> Result<(), tauri::Error> {
    if let Some(menu) = app.menu() {
        update_shortcuts_in_items(&menu.items()?, shortcuts)?;
    }
    Ok(())
}

fn update_shortcuts_in_items<R: tauri::Runtime>(items: &[MenuItemKind<R>], shortcuts: &HashMap<String, String>) -> Result<(), tauri::Error> {
    for item in items {
        match item {
            MenuItemKind::MenuItem(mi) => {
                let id = mi.id().as_ref();
                if let Some(accel) = shortcuts.get(id) {
                    mi.set_accelerator(Some(accel))?;
                }
            }
            MenuItemKind::Submenu(sub) => {
                update_shortcuts_in_items(&sub.items()?, shortcuts)?;
            }
            _ => {}
        }
    }
    Ok(())
}
