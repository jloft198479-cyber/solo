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

/// 注册 .md / .markdown 文件关联和右键"新建"菜单。
///
/// - 设置文件图标为 solo.exe 的默认图标
/// - 注册 ShellNew 使右键出现"新建 Markdown 文档"
/// - 写入 HKEY_CURRENT_USER，无需管理员权限
/// - 通知 Explorer 刷新，不要求重启
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

        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let classes = hkcu
            .open_subkey_with_flags("Software\\Classes", KEY_WRITE)
            .or_else(|_| hkcu.create_subkey("Software\\Classes").map(|(key, _)| key))
            .map_err(|e| AppError::Native(e.to_string()))?;

        let prog_id = "solo.markdown";

        for ext in &[".md", ".markdown"] {
            // 设置默认打开程序为 solo
            let (ext_key, _) = classes
                .create_subkey(ext)
                .map_err(|e| AppError::Native(e.to_string()))?;
            ext_key
                .set_value("", &prog_id)
                .map_err(|e| AppError::Native(e.to_string()))?;

            // ShellNew → 右键"新建 Markdown 文档"
            let (shell_new, _) = classes
                .create_subkey(&format!("{}\\ShellNew", ext))
                .map_err(|e| AppError::Native(e.to_string()))?;
            shell_new
                .set_value("NullFile", &"")
                .map_err(|e| AppError::Native(e.to_string()))?;
        }

        // 设置 ProgID 默认图标（指向 solo.exe）
        let (icon_key, _) = classes
            .create_subkey(&format!("{}\\DefaultIcon", prog_id))
            .map_err(|e| AppError::Native(e.to_string()))?;
        icon_key
            .set_value("", &exe_path)
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

        for ext in &[".md", ".markdown"] {
            let _ = hkcu.delete_subkey_all(format!("{}\\{}\\ShellNew", classes_path, ext));
            let _ = hkcu.delete_subkey_all(format!("{}\\{}", classes_path, ext));
        }

        let _ = hkcu.delete_subkey_all(format!("{}\\solo.markdown\\DefaultIcon", classes_path));
        let _ = hkcu.delete_subkey_all(format!("{}\\solo.markdown\\shell\\open\\command", classes_path));
        let _ = hkcu.delete_subkey_all(format!("{}\\solo.markdown\\shell\\open", classes_path));
        let _ = hkcu.delete_subkey_all(format!("{}\\solo.markdown\\shell", classes_path));
        let _ = hkcu.delete_subkey_all(format!("{}\\solo.markdown", classes_path));

        Ok(())
    }

    #[cfg(not(target_os = "windows"))]
    {
        Ok(())
    }
}
