use crate::error::AppError;
use crate::models::AppOpenPathsPayload;
use std::collections::{HashMap, HashSet};
use std::sync::Mutex;
use std::time::{Duration, Instant};

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

    pub fn contains(&self, label: &str) -> Result<bool, AppError> {
        Ok(self
            .0
            .lock()
            .map_err(|error| AppError::Native(error.to_string()))?
            .contains(label))
    }
}

/// 一次关闭请求的应答看门狗记录。
#[derive(Debug, Clone, Copy)]
struct CloseAttempt {
    requested_at: Instant,
    acked: bool,
}

/// 一次关闭请求该走哪条路。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CloseDecision {
    /// 之前没有待处理请求：本次已登记，应通知前端弹窗确认。
    Prompt,
    /// 前端已应答（确认框还挂着），或宽限期还没到：静默吞掉本次请求。
    Waiting,
    /// 前端超期未应答：JS 主线程被占死，放行原生关闭，不再询问。
    Force,
}

/// 「关窗逃生舱」状态：每窗口一条待处理关闭请求。
///
/// 存在的理由：关窗确认链完全在前端跑，4MB 以上文档的序列化会把 WebView 的
/// JS 线程占死——close-requested 送进去没人应答，窗口既关不掉也不弹框。
/// 这个看门狗让「第二次关闭请求 + 前端始终没应答」成为一条纯 Rust 的退路。
#[derive(Default)]
pub struct CloseGuard(Mutex<HashMap<String, CloseAttempt>>);

impl CloseGuard {
    /// 登记并判定一次关闭请求。读写共用一把锁，避免 check-then-act 竞态。
    pub fn evaluate(&self, label: &str, grace: Duration) -> Result<CloseDecision, AppError> {
        let mut guard = self
            .0
            .lock()
            .map_err(|error| AppError::Native(error.to_string()))?;
        let Some(attempt) = guard.get_mut(label) else {
            guard.insert(
                label.to_string(),
                CloseAttempt {
                    requested_at: Instant::now(),
                    acked: false,
                },
            );
            return Ok(CloseDecision::Prompt);
        };
        if attempt.acked {
            return Ok(CloseDecision::Waiting);
        }
        if attempt.requested_at.elapsed() >= grace {
            guard.remove(label);
            return Ok(CloseDecision::Force);
        }
        Ok(CloseDecision::Waiting)
    }

    /// 前端确认收到关闭请求（证明 JS 主线程还活着）。
    /// 返回 false 表示没有待处理记录——自定义标题栏直接调关闭链时就是这种情形。
    pub fn mark_acked(&self, label: &str) -> Result<bool, AppError> {
        let mut guard = self
            .0
            .lock()
            .map_err(|error| AppError::Native(error.to_string()))?;
        match guard.get_mut(label) {
            Some(attempt) => {
                attempt.acked = true;
                Ok(true)
            }
            None => Ok(false),
        }
    }

    /// 本次关闭链已中止（用户取消 / 保存失败），清掉记录让下一次请求重新弹窗。
    pub fn clear(&self, label: &str) -> Result<(), AppError> {
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

    // --- CloseGuard ---

    const NO_GRACE: Duration = Duration::ZERO;
    const LONG_GRACE: Duration = Duration::from_secs(3600);

    #[test]
    fn close_guard_first_request_prompts() {
        let guard = CloseGuard::default();
        assert_eq!(
            guard.evaluate("main", LONG_GRACE).unwrap(),
            CloseDecision::Prompt
        );
    }

    #[test]
    fn close_guard_second_request_within_grace_waits() {
        let guard = CloseGuard::default();
        guard.evaluate("main", LONG_GRACE).unwrap();
        assert_eq!(
            guard.evaluate("main", LONG_GRACE).unwrap(),
            CloseDecision::Waiting
        );
    }

    #[test]
    fn close_guard_acked_request_never_forces() {
        let guard = CloseGuard::default();
        guard.evaluate("main", LONG_GRACE).unwrap();
        assert!(guard.mark_acked("main").unwrap());
        // 确认框挂着多久都不该被逃生舱干掉
        assert_eq!(
            guard.evaluate("main", NO_GRACE).unwrap(),
            CloseDecision::Waiting
        );
    }

    #[test]
    fn close_guard_unanswered_request_forces_after_grace() {
        let guard = CloseGuard::default();
        guard.evaluate("main", LONG_GRACE).unwrap();
        assert_eq!(guard.evaluate("main", NO_GRACE).unwrap(), CloseDecision::Force);
        // Force 已清掉记录，下一次请求重新回到弹窗流程
        assert_eq!(
            guard.evaluate("main", LONG_GRACE).unwrap(),
            CloseDecision::Prompt
        );
    }

    #[test]
    fn close_guard_ack_without_pending_record_is_noop() {
        let guard = CloseGuard::default();
        assert!(!guard.mark_acked("main").unwrap());
    }

    #[test]
    fn close_guard_clear_restarts_the_prompt_cycle() {
        let guard = CloseGuard::default();
        guard.evaluate("main", LONG_GRACE).unwrap();
        guard.mark_acked("main").unwrap();
        guard.clear("main").unwrap();
        assert_eq!(
            guard.evaluate("main", LONG_GRACE).unwrap(),
            CloseDecision::Prompt
        );
    }

    #[test]
    fn close_guard_tracks_windows_independently() {
        let guard = CloseGuard::default();
        guard.evaluate("main", LONG_GRACE).unwrap();
        assert_eq!(
            guard.evaluate("secondary", LONG_GRACE).unwrap(),
            CloseDecision::Prompt
        );
        assert_eq!(
            guard.evaluate("main", LONG_GRACE).unwrap(),
            CloseDecision::Waiting
        );
    }
}
