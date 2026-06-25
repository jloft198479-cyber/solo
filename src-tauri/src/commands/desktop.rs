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
            // 先设置默认打开程序为 solo，确保图标正确
            let (ext_key, _) = classes
                .create_subkey(ext)
                .map_err(|e| AppError::Native(e.to_string()))?;
            ext_key
                .set_value("", &"solo.markdown")
                .map_err(|e| AppError::Native(e.to_string()))?;

            // 设置 ProgID 关联
            let (progid, _) = classes
                .create_subkey("solo.markdown\\DefaultIcon")
                .map_err(|e| AppError::Native(e.to_string()))?;
            // 留空让 Windows 使用 solo.exe 的默认图标
            progid
                .set_value("", &"")
                .map_err(|e| AppError::Native(e.to_string()))?;

            // ShellNew 注册"新建 Markdown 文档"
            let (shell_new, _) = classes
                .create_subkey(&format!("{}\\ShellNew", ext))
                .map_err(|e| AppError::Native(e.to_string()))?;
            shell_new
                .set_value("NullFile", &"")
                .map_err(|e| AppError::Native(e.to_string()))?;
        }
        Ok(())
    }

    #[cfg(not(target_os = "windows"))]
    {
        Ok(())
    }
}

/// 移除 ShellNew 注册表项及文件关联（卸载时调用）。
#[tauri::command]
pub fn unregister_shell_new() -> Result<(), AppError> {
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::*;
        use winreg::RegKey;

        let hkcu = RegKey::predef(HKEY_CURRENT_USER);

        for ext in &[".md", ".markdown"] {
            // 清理 ShellNew
            let path = format!("Software\\Classes\\{}\\ShellNew", ext);
            let _ = hkcu.delete_subkey(&path);

            // 清理文件关联
            let ext_path = format!("Software\\Classes\\{}", ext);
            let _ = hkcu.delete_subkey(&ext_path);
        }
        // 清理 ProgID
        let _ = hkcu.delete_subkey("Software\\Classes\\solo.markdown\\DefaultIcon");
        let _ = hkcu.delete_subkey("Software\\Classes\\solo.markdown");
        Ok(())
    }

    #[cfg(not(target_os = "windows"))]
    {
        Ok(())
    }
}
