use crate::error::AppError;
use crate::models::AppOpenPathsPayload;
use std::collections::{HashMap, HashSet};
use std::sync::Mutex;

#[derive(Default)]
pub struct StartupOpenRequests(pub Mutex<Option<AppOpenPathsPayload>>);

impl StartupOpenRequests {
    /// 合并新请求到已有 payload，路径去重。
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

}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::AppOpenSource;

    fn make_payload(paths: Vec<&str>) -> AppOpenPathsPayload {
        AppOpenPathsPayload {
            paths: paths.into_iter().map(|s| s.to_string()).collect(),
            source: AppOpenSource::Cli,
        }
    }

    // --- StartupOpenRequests ---

    #[test]
    fn startup_requests_take_returns_none_when_empty() {
        let state = StartupOpenRequests::default();
        assert!(state.take().unwrap().is_none());
    }

    #[test]
    fn startup_requests_merge_then_take() {
        let state = StartupOpenRequests::default();
        state.merge(make_payload(vec!["a.md"])).unwrap();
        let taken = state.take().unwrap().unwrap();
        assert_eq!(taken.paths, vec!["a.md"]);
        // second take returns None
        assert!(state.take().unwrap().is_none());
    }

    #[test]
    fn startup_requests_merge_with_existing() {
        let state = StartupOpenRequests::default();
        state.merge(make_payload(vec!["a.md"])).unwrap();
        state.merge(make_payload(vec!["b.md", "c.md"])).unwrap();
        let payload = state.take().unwrap().unwrap();
        assert_eq!(payload.paths, vec!["a.md", "b.md", "c.md"]);
    }

    #[test]
    fn startup_requests_merge_deduplicates() {
        let state = StartupOpenRequests::default();
        state.merge(make_payload(vec!["a.md", "b.md"])).unwrap();
        state.merge(make_payload(vec!["b.md", "c.md"])).unwrap();
        let payload = state.take().unwrap().unwrap();
        assert_eq!(payload.paths, vec!["a.md", "b.md", "c.md"]);
    }

    #[test]
    fn startup_requests_merge_empty_is_same_as_replace() {
        let state = StartupOpenRequests::default();
        state.merge(make_payload(vec!["a.md"])).unwrap();
        let payload = state.take().unwrap().unwrap();
        assert_eq!(payload.paths, vec!["a.md"]);
    }

    // --- PendingWindowPaths ---

    #[test]
    fn pending_window_paths_insert_and_take() {
        let state = PendingWindowPaths::default();
        state
            .insert("main".into(), make_payload(vec!["a.md"]))
            .unwrap();
        let taken = state.take("main").unwrap().unwrap();
        assert_eq!(taken.paths, vec!["a.md"]);
    }

    #[test]
    fn pending_window_paths_take_nonexistent_returns_none() {
        let state = PendingWindowPaths::default();
        assert!(state.take("nonexistent").unwrap().is_none());
    }

    #[test]
    fn pending_window_paths_take_once_removes_entry() {
        let state = PendingWindowPaths::default();
        state
            .insert("main".into(), make_payload(vec!["a.md"]))
            .unwrap();
        assert!(state.take("main").unwrap().is_some());
        assert!(state.take("main").unwrap().is_none());
    }

    // --- FocusedWindow ---

    #[test]
    fn focused_window_initial_is_none() {
        let state = FocusedWindow::default();
        assert!(state.get().unwrap().is_none());
    }

    #[test]
    fn focused_window_set_and_get() {
        let state = FocusedWindow::default();
        state.set("main".into()).unwrap();
        assert_eq!(state.get().unwrap().unwrap(), "main");
    }

    #[test]
    fn focused_window_clear() {
        let state = FocusedWindow::default();
        state.set("main".into()).unwrap();
        state.clear().unwrap();
        assert!(state.get().unwrap().is_none());
    }

    // --- LoadedWindows ---

    #[test]
    fn loaded_windows_mark_and_has_loaded() {
        let state = LoadedWindows::default();
        assert!(state.0.lock().unwrap().is_empty());
        state.mark_loaded("main".into()).unwrap();
        assert!(!state.0.lock().unwrap().is_empty());
    }

    #[test]
    fn loaded_windows_remove() {
        let state = LoadedWindows::default();
        state.mark_loaded("main".into()).unwrap();
        state.remove("main").unwrap();
        assert!(state.0.lock().unwrap().is_empty());
    }

    #[test]
    fn loaded_windows_tracks_multiple_labels() {
        let state = LoadedWindows::default();
        state.mark_loaded("w1".into()).unwrap();
        state.mark_loaded("w2".into()).unwrap();
        state.remove("w1").unwrap();
        assert!(!state.0.lock().unwrap().is_empty());
        state.remove("w2").unwrap();
        assert!(state.0.lock().unwrap().is_empty());
    }
}
