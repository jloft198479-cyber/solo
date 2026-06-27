use crate::error::AppError;
use crate::models::AppOpenPathsPayload;
use std::collections::{HashMap, HashSet};
use std::sync::Mutex;

#[derive(Default)]
pub struct StartupOpenRequests(pub Mutex<Option<AppOpenPathsPayload>>);

impl StartupOpenRequests {
    pub fn replace(&self, payload: AppOpenPathsPayload) -> Result<(), AppError> {
        *self
            .0
            .lock()
            .map_err(|error| AppError::Native(error.to_string()))? = Some(payload);
        Ok(())
    }

    /// 合并新请求到已有 payload，路径去重。防止快速连续打开时 replace 覆盖丢文件。
    pub fn merge(&self, payload: AppOpenPathsPayload) -> Result<(), AppError> {
        let mut guard = self
            .0
            .lock()
            .map_err(|error| AppError::Native(error.to_string()))?;
        if let Some(existing) = guard.as_mut() {
            for path in payload.paths {
                if !existing.paths.iter().any(|p| p == &path) {
                    existing.paths.push(path);
                }
            }
        } else {
            *guard = Some(payload);
        }
        Ok(())
    }

    pub fn take(&self) -> Result<Option<AppOpenPathsPayload>, AppError> {
        let payload = self
            .0
            .lock()
            .map_err(|error| AppError::Native(error.to_string()))?
            .take();
        Ok(payload)
    }
}

#[derive(Default)]
pub struct PendingWindowPaths(pub Mutex<HashMap<String, AppOpenPathsPayload>>);

impl PendingWindowPaths {
    pub fn insert(&self, label: String, payload: AppOpenPathsPayload) -> Result<(), AppError> {
        self.0
            .lock()
            .map_err(|error| AppError::Native(error.to_string()))?
            .insert(label, payload);
        Ok(())
    }

    pub fn take(&self, label: &str) -> Result<Option<AppOpenPathsPayload>, AppError> {
        Ok(self
            .0
            .lock()
            .map_err(|error| AppError::Native(error.to_string()))?
            .remove(label))
    }
}

#[derive(Default)]
pub struct LoadedWindows(pub Mutex<HashSet<String>>);

/// 跟踪当前焦点窗口的 label，用于菜单事件定向分发
#[derive(Default)]
pub struct FocusedWindow(pub Mutex<Option<String>>);

impl FocusedWindow {
    pub fn set(&self, label: String) -> Result<(), AppError> {
        *self
            .0
            .lock()
            .map_err(|error| AppError::Native(error.to_string()))? = Some(label);
        Ok(())
    }

    pub fn clear(&self) -> Result<(), AppError> {
        *self
            .0
            .lock()
            .map_err(|error| AppError::Native(error.to_string()))? = None;
        Ok(())
    }

    pub fn get(&self) -> Result<Option<String>, AppError> {
        Ok(self
            .0
            .lock()
            .map_err(|error| AppError::Native(error.to_string()))?
            .clone())
    }
}

impl LoadedWindows {
    pub fn mark_loaded(&self, label: String) -> Result<(), AppError> {
        self.0
            .lock()
            .map_err(|error| AppError::Native(error.to_string()))?
            .insert(label);
        Ok(())
    }

    pub fn remove(&self, label: &str) -> Result<(), AppError> {
        self.0
            .lock()
            .map_err(|error| AppError::Native(error.to_string()))?
            .remove(label);
        Ok(())
    }

    pub fn has_loaded_window(&self) -> Result<bool, AppError> {
        let has_loaded = !self
            .0
            .lock()
            .map_err(|error| AppError::Native(error.to_string()))?
            .is_empty();
        Ok(has_loaded)
    }
}
