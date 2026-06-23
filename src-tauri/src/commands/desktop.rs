use crate::error::AppError;

/// 为 .md / .markdown 扩展名注册 ShellNew 注册表项，
/// 使 Windows 资源管理器右键菜单出现"新建 Markdown 文档"。
/// 写入 HKEY_CURRENT_USER，无需管理员权限。
#[tauri::command]
pub fn register_shell_new() -> Result<(), AppError> {
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::*;
        use winreg::RegKey;

        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let classes = hkcu
            .open_subkey_with_flags("Software\\Classes", KEY_WRITE)
            .or_else(|_| {
                hkcu.create_subkey("Software\\Classes")
                    .map(|(key, _)| key)
            })
            .map_err(|e| AppError::Native(e.to_string()))?;

        for ext in &[".md", ".markdown"] {
            let (key, _) = classes
                .create_subkey(&format!("{}\\ShellNew", ext))
                .map_err(|e| AppError::Native(e.to_string()))?;
            key.set_value("NullFile", &"")
                .map_err(|e| AppError::Native(e.to_string()))?;
        }
        Ok(())
    }

    #[cfg(not(target_os = "windows"))]
    {
        Ok(())
    }
}

/// 移除 ShellNew 注册表项（卸载时调用）。
#[tauri::command]
pub fn unregister_shell_new() -> Result<(), AppError> {
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::*;
        use winreg::RegKey;

        let hkcu = RegKey::predef(HKEY_CURRENT_USER);

        for ext in &[".md", ".markdown"] {
            let path = format!("Software\\Classes\\{}\\ShellNew", ext);
            let _ = hkcu.delete_subkey(&path);
        }
        Ok(())
    }

    #[cfg(not(target_os = "windows"))]
    {
        Ok(())
    }
}
