use crate::error::AppError;

/// 通知 Explorer 刷新文件关联缓存，使 ShellNew 立即生效。
fn notify_shell_change() {
    #[cfg(target_os = "windows")]
    {
        // SHCNE_ASSOCCHANGED = 0x08000000, SHCNF_IDLIST = 0x0000
        const SHCNE_ASSOCCHANGED: u32 = 0x08000000;
        const SHCNF_IDLIST: u32 = 0x0000;
        extern "system" {
            fn SHChangeNotify(
                wEventId: u32,
                uFlags: u32,
                dwItem1: *const std::ffi::c_void,
                dwItem2: *const std::ffi::c_void,
            );
        }
        unsafe {
            SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, std::ptr::null(), std::ptr::null());
        }
    }
}

/// 读注册表字符串值；子键不存在 / 类型不符统一返回 None，
/// 由调用方按「不一致 ⇒ 重写」的保守口径处理。
#[cfg(target_os = "windows")]
fn reg_string(key: &winreg::RegKey, name: &str) -> Option<String> {
    key.get_value::<String, _>(name).ok()
}

/// 只判断值是否存在（不关心内容）。`NullFile` 存的就是空字符串，
/// 必须用这个而不是 `reg_string` —— 空串不是「没配」。
#[cfg(target_os = "windows")]
fn reg_exists(key: &winreg::RegKey, name: &str) -> bool {
    key.get_value::<String, _>(name).is_ok()
}

/// 从注册表读出「当前已登记的关联」快照。任何一项读不到 → None（= 需要重写）。
///
/// 抽成快照是为了让判据 `association_is_current` 成为纯函数、可单测，
/// 不必在测试里真的动 `HKCU`。
#[cfg(target_os = "windows")]
fn read_shell_association(
    classes: &winreg::RegKey,
    prog_id: &str,
) -> Option<ShellAssociation> {
    let ext = |k: &str| -> Option<String> {
        classes.open_subkey(k).ok().and_then(|s| reg_string(&s, ""))
    };
    let sub = |k: &str| -> Option<String> {
        classes.open_subkey(k).ok().and_then(|s| reg_string(&s, ""))
    };
    // NullFile 只判存在（值就是空串，见 reg_exists 注释）
    let shell_new = classes
        .open_subkey(".md\\ShellNew")
        .ok()
        .is_some_and(|k| reg_exists(&k, "NullFile"));

    Some(ShellAssociation {
        md: ext(".md")?,
        markdown: ext(".markdown")?,
        shell_new,
        prog_name: sub(prog_id)?,
        default_icon: sub(&format!("{}\\DefaultIcon", prog_id))?,
        open_command: sub(&format!("{}\\shell\\open\\command", prog_id))?,
    })
}

/// 已登记的关联内容（用于与预期逐项比对）。
#[cfg(target_os = "windows")]
#[derive(Debug, PartialEq, Eq)]
struct ShellAssociation {
    md: String,
    markdown: String,
    shell_new: bool,
    prog_name: String,
    default_icon: String,
    open_command: String,
}

/// 判断 Shell 关联是否已与当前可执行文件一致（纯函数，不碰注册表）。
///
/// 存在的唯一理由：`register_shell_new` 此前**每次启动都无条件重写**注册表并调
/// `SHChangeNotify(SHCNE_ASSOCCHANGED)`，Explorer 收到后会重算全盘文件图标关联，
/// 导致**桌面上所有文件夹重绘闪动**。而「.md 默认用 solo 打开」和「右键新建 Markdown
/// 文档」在装好时登记一次就够，没有每次启动都重刷的道理。
///
/// exe 路径参与比对，因此升级换版本、换安装目录后会自动重新登记；
/// 读不到快照（首次运行 / 被清理）时按「不一致」处理，不会因判断失败丢关联。
#[cfg(target_os = "windows")]
fn association_is_current(actual: &ShellAssociation, prog_id: &str, exe_path: &str) -> bool {
    actual.md == prog_id
        && actual.markdown == prog_id
        && actual.shell_new
        && actual.prog_name == "solo文档"
        && actual.default_icon == format!("{},0", exe_path)
        && actual.open_command == format!("\"{}\" \"%1\"", exe_path)
}

/// 注册 .md / .markdown 文件关联和右键"新建"菜单。
///
/// - 设置文件图标为 solo.exe 的默认图标
/// - 仅 .md 注册 ShellNew（避免 Explorer 右键出现两个"新建"项）
/// - 设置显示名为"solo文档"
/// - 写入 HKEY_CURRENT_USER，无需管理员权限
/// - 通知 Explorer 刷新，不要求重启
/// - **幂等**（2026-10-03）：已注册且指向当前 exe 时直接返回，不重写、不通知，
///   避免每次启动都触发 Explorer 全盘关联重算 ⇒ 桌面所有文件夹闪动
#[tauri::command]
pub fn register_shell_new() -> Result<(), AppError> {
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::*;
        use winreg::RegKey;

        // 获取当前可执行文件路径（编译时不知安装位置，运行时才知道）
        let exe_path = std::env::current_exe()
            .map_err(|e| AppError::Native(e.to_string()))?
            .to_string_lossy()
            .to_string();

        let prog_id = "solo.markdown";
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);

        // 先只读对账：已一致就直接返回，连 KEY_WRITE 句柄和 SHChangeNotify 都不碰。
        // 读不到注册表（首次运行 / 被清理）时按「需要写入」处理。
        let already_current = hkcu
            .open_subkey("Software\\Classes")
            .ok()
            .and_then(|classes| read_shell_association(&classes, prog_id))
            .map(|actual| association_is_current(&actual, prog_id, &exe_path))
            .unwrap_or(false);
        if already_current {
            return Ok(());
        }

        let classes = hkcu
            .open_subkey_with_flags("Software\\Classes", KEY_WRITE)
            .or_else(|_| hkcu.create_subkey("Software\\Classes").map(|(key, _)| key))
            .map_err(|e| AppError::Native(e.to_string()))?;

        for ext in &[".md", ".markdown"] {
            // 设置默认打开程序为 solo
            let (ext_key, _) = classes
                .create_subkey(ext)
                .map_err(|e| AppError::Native(e.to_string()))?;
            ext_key
                .set_value("", &prog_id)
                .map_err(|e| AppError::Native(e.to_string()))?;
        }

        // 清理旧版可能残留的 .markdown\ShellNew，避免 Explorer 右键出现两个"新建"项
        let _ = classes.delete_subkey_all(".markdown\\ShellNew");

        // 仅 .md 注册 ShellNew（右键"新建"菜单）
        let (shell_new, _) = classes
            .create_subkey(".md\\ShellNew")
            .map_err(|e| AppError::Native(e.to_string()))?;
        shell_new
            .set_value("NullFile", &"")
            .map_err(|e| AppError::Native(e.to_string()))?;

        // 设置 ProgID 显示名（影响右键"新建"菜单的显示文本）
        let (prog_key, _) = classes
            .create_subkey(prog_id)
            .map_err(|e| AppError::Native(e.to_string()))?;
        prog_key
            .set_value("", &"solo文档")
            .map_err(|e| AppError::Native(e.to_string()))?;

        // 设置 ProgID 默认图标（指向 solo.exe，显式指定图标索引 0）
        let (icon_key, _) = classes
            .create_subkey(&format!("{}\\DefaultIcon", prog_id))
            .map_err(|e| AppError::Native(e.to_string()))?;
        icon_key
            .set_value("", &format!("{},0", exe_path))
            .map_err(|e| AppError::Native(e.to_string()))?;

        // 设置双击打开命令
        let (cmd_key, _) = classes
            .create_subkey(&format!("{}\\shell\\open\\command", prog_id))
            .map_err(|e| AppError::Native(e.to_string()))?;
        cmd_key
            .set_value("", &format!("\"{}\" \"%1\"", exe_path))
            .map_err(|e| AppError::Native(e.to_string()))?;

        // 通知 Explorer 刷新文件关联缓存，即刻生效
        notify_shell_change();

        Ok(())
    }

    #[cfg(not(target_os = "windows"))]
    {
        Ok(())
    }
}

/// 移除 solo 的文件关联和右键菜单。
#[tauri::command]
pub fn unregister_shell_new() -> Result<(), AppError> {
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::*;
        use winreg::RegKey;

        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let classes_path = "Software\\Classes";

        // 敏感区第 21 条：注销**不得整键删除**。
        // 扩展名主键（.md / .markdown）可能与其它程序共享——只有在「默认值仍指向 solo」
        // 时才清掉这一个值，绝不递归删整棵键（旧实现曾把用户系统里所有 .md 打开方式一并抹掉）。
        let prog_id = "solo.markdown";
        let mut failures: Vec<String> = Vec::new();

        for ext in &[".md", ".markdown"] {
            // ShellNew 是 solo 独占创建的，可整键删除
            if let Err(e) = hkcu.delete_subkey_all(format!("{}\\{}\\ShellNew", classes_path, ext)) {
                if e.kind() != std::io::ErrorKind::NotFound {
                    failures.push(format!("{}\\ShellNew: {}", ext, e));
                }
            }
            // 只清「属于 solo 的」默认值：先读，确认指向我们的 ProgID 才删值（不删键）
            if let Ok(key) = hkcu
                .open_subkey_with_flags(format!("{}\\{}", classes_path, ext), KEY_READ | KEY_WRITE)
            {
                let owned = key.get_value::<String, _>("").ok().as_deref() == Some(prog_id);
                if owned {
                    if let Err(e) = key.delete_value("") {
                        if e.kind() != std::io::ErrorKind::NotFound {
                            failures.push(format!("{} 默认值: {}", ext, e));
                        }
                    }
                }
            }
        }

        // solo 自己的 ProgID 子树（独占）可整树删除
        for sub in ["DefaultIcon", "shell\\open\\command", "shell\\open", "shell", ""] {
            let path = if sub.is_empty() {
                format!("{}\\{}", classes_path, prog_id)
            } else {
                format!("{}\\{}\\{}", classes_path, prog_id, sub)
            };
            if let Err(e) = hkcu.delete_subkey_all(&path) {
                if e.kind() != std::io::ErrorKind::NotFound {
                    failures.push(format!("{}: {}", path, e));
                }
            }
        }

        // 注销侧同样要通知 Explorer 刷新缓存（旧实现只挂了注册侧，M-02）
        notify_shell_change();

        if failures.is_empty() {
            Ok(())
        } else {
            Err(AppError::Native(format!(
                "文件关联清理未完全成功：{}",
                failures.join("；")
            )))
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        Ok(())
    }
}

#[cfg(all(test, target_os = "windows"))]
mod tests {
    use super::*;

    const PROG_ID: &str = "solo.markdown";
    const EXE: &str = r"C:\Program Files\solo\solo.exe";

    fn expected() -> ShellAssociation {
        ShellAssociation {
            md: PROG_ID.to_string(),
            markdown: PROG_ID.to_string(),
            shell_new: true,
            prog_name: "solo文档".to_string(),
            default_icon: format!("{},0", EXE),
            open_command: format!("\"{}\" \"%1\"", EXE),
        }
    }

    #[test]
    fn 已完全登记时判定为当前() {
        assert!(association_is_current(&expected(), PROG_ID, EXE));
    }

    #[test]
    fn shell_new_缺失时判定为需重写() {
        let mut a = expected();
        a.shell_new = false;
        assert!(!association_is_current(&a, PROG_ID, EXE));
    }

    /// 反向校准锚点：`NullFile` 的值**就是空字符串**。
    /// 曾用 `reg_string` 读它，空串被判成「没配」⇒ 判据永远 false ⇒
    /// 修复静默失效（每次启动仍重写 + 通知，闪动照旧）。此用例锁死该边界。
    #[test]
    fn shell_new_值为空串仍算已登记() {
        let a = expected(); // shell_new = true 表示「值存在且为空串」
        assert!(association_is_current(&a, PROG_ID, EXE));
    }

    #[test]
    fn 任一扩展名未被接管时判定为需重写() {
        let mut a = expected();
        a.md = "other.prog".to_string();
        assert!(!association_is_current(&a, PROG_ID, EXE), "md 应触发重写");

        let mut a = expected();
        a.markdown = "other.prog".to_string();
        assert!(!association_is_current(&a, PROG_ID, EXE), "markdown 应触发重写");
    }

    #[test]
    fn 显示名与图标与打开命令任一不符时判定为需重写() {
        let mut a = expected();
        a.prog_name = "XX".to_string();
        assert!(!association_is_current(&a, PROG_ID, EXE), "prog_name 应触发重写");

        let mut a = expected();
        a.default_icon = "other.ico,0".to_string();
        assert!(!association_is_current(&a, PROG_ID, EXE), "default_icon 应触发重写");

        let mut a = expected();
        a.open_command = "notepad.exe %1".to_string();
        assert!(!association_is_current(&a, PROG_ID, EXE), "open_command 应触发重写");
    }

    /// 升级 / 换安装目录后 exe 路径变了 ⇒ 必须重新登记（否则双击打不开）。
    #[test]
    fn exe_路径变化时判定为需重写() {
        assert!(!association_is_current(
            &expected(),
            PROG_ID,
            r"D:\newdir\solo.exe"
        ));
    }

    #[test]
    fn 读不到快照时按需重写处理() {
        let missing: Option<ShellAssociation> = None;
        let already = missing
            .map(|a| association_is_current(&a, PROG_ID, EXE))
            .unwrap_or(false);
        assert!(!already);
    }
}
