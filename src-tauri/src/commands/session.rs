//! 文档会话记忆：最近文件 + 阅读位置（重开回到上次位置）。
//!
//! 数据落盘在 `app_local_data_dir/session/document-session.json`，单文件 JSON，
//! 读写都走「读全文 → 内存改 → 原子写回」（tmp + rename）。多窗口并发写靠
//! spawn_blocking 串行 + 「最后一次为准」——最近文件少记一条可接受，不做跨进程锁。
//!
//! 设计边界（有意为之，勿扩）：
//! - 只记「滚动比例」不记像素：窗口尺寸变化后像素失效，比例天然自适应。
//!   大文档开 content-visibility 后 scrollHeight 是占位估值，恢复位置有偏差，可接受。
//! - 阅读位置上限 50 篇，按 updated_ms 淘汰最久未读的。
//! - 文件损坏（手改/截断）→ 视为空状态重建，不报错——这份数据不值得让用户看到报错。

use crate::error::AppError;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

/// 最近文件列表上限
const RECENT_FILES_LIMIT: usize = 10;
/// 阅读位置记忆篇数上限
const POSITIONS_LIMIT: usize = 50;

/// 单篇文档的阅读位置（滚动比例 0..1）与最后阅读时间
#[derive(Serialize, Deserialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ReadingPosition {
    pub ratio: f64,
    pub updated_ms: u64,
}

#[derive(Serialize, Deserialize, Clone, Default, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DocumentSessionState {
    pub recent_files: Vec<String>,
    pub reading_positions: HashMap<String, ReadingPosition>,
}

/// 记录一次「打开 / 阅读」：最近文件去重置顶；带比例时更新阅读位置。
///
/// 纯函数（不碰 IO 与时钟，时间由调用方注入）以便单测。
/// 空路径（未命名/新建文档）不记录——没有稳定身份，记了也恢复不到同一份内容。
fn apply_record(
    mut state: DocumentSessionState,
    path: &str,
    scroll_ratio: Option<f64>,
    now_ms: u64,
) -> DocumentSessionState {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return state;
    }

    // 最近文件：去重置顶 + 截断
    state.recent_files.retain(|p| p != trimmed);
    state.recent_files.insert(0, trimmed.to_string());
    state.recent_files.truncate(RECENT_FILES_LIMIT);

    if let Some(raw) = scroll_ratio {
        // 非有限值（NaN/Inf）直接丢弃；合法值 clamp 进 0..1
        if raw.is_finite() {
            state.reading_positions.insert(
                trimmed.to_string(),
                ReadingPosition {
                    ratio: raw.clamp(0.0, 1.0),
                    updated_ms: now_ms,
                },
            );
            // 超限淘汰最久未读的（排除刚写入的这篇，防并列时间戳时误删自己）
            while state.reading_positions.len() > POSITIONS_LIMIT {
                let oldest = state
                    .reading_positions
                    .iter()
                    .filter(|(k, _)| k.as_str() != trimmed)
                    .min_by_key(|(_, p)| p.updated_ms)
                    .map(|(k, _)| k.clone());
                match oldest {
                    Some(oldest) => {
                        state.reading_positions.remove(&oldest);
                    }
                    None => break,
                }
            }
        }
    }

    state
}

fn session_file(app: &AppHandle) -> Result<PathBuf, AppError> {
    Ok(app
        .path()
        .app_local_data_dir()
        .map_err(|e| AppError::Native(e.to_string()))?
        .join("session")
        .join("document-session.json"))
}

/// 读状态；文件不存在或损坏 → 空状态（这份数据不值得报错，静默重建）。
fn load_state(file: &Path) -> DocumentSessionState {
    fs::read(file)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

/// 原子写回：tmp + rename（同盘 rename 原子，断电最多丢本次，不会写坏旧文件）。
fn save_state(file: &Path, state: &DocumentSessionState) -> Result<(), AppError> {
    if let Some(dir) = file.parent() {
        fs::create_dir_all(dir)?;
    }
    let bytes = serde_json::to_vec(state).map_err(|e| AppError::Native(e.to_string()))?;
    let file_name = file
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "document-session.json".into());
    let tmp = file.with_file_name(format!("{file_name}.tmp"));
    fs::write(&tmp, bytes)?;
    fs::rename(&tmp, file)?;
    Ok(())
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// 记录一次文档会话：打开文档时（scroll_ratio=null）记最近文件；
/// 切走/滚动防抖/关窗时带当前滚动比例，顺带更新阅读位置。
#[tauri::command]
pub async fn record_document_session(
    path: String,
    scroll_ratio: Option<f64>,
    app: AppHandle,
) -> Result<(), AppError> {
    let file = session_file(&app)?;
    tauri::async_runtime::spawn_blocking(move || -> Result<(), AppError> {
        let state = load_state(&file);
        let next = apply_record(state, &path, scroll_ratio, now_ms());
        save_state(&file, &next)
    })
    .await
    .map_err(|e| AppError::Native(format!("任务调度失败: {e}")))?
}

/// 读取会话记忆（最近文件 + 阅读位置）。命令面板「最近文件」分组与
/// 打开文档后的滚动恢复共用这一次读取。
#[tauri::command]
pub async fn read_document_session(app: AppHandle) -> Result<DocumentSessionState, AppError> {
    let file = session_file(&app)?;
    tauri::async_runtime::spawn_blocking(move || -> Result<DocumentSessionState, AppError> {
        Ok(load_state(&file))
    })
    .await
    .map_err(|e| AppError::Native(format!("任务调度失败: {e}")))?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn state_with(recent: &[&str], positions: &[(&str, f64, u64)]) -> DocumentSessionState {
        let mut state = DocumentSessionState {
            recent_files: recent.iter().map(|s| s.to_string()).collect(),
            reading_positions: HashMap::new(),
        };
        for (path, ratio, ms) in positions {
            state.reading_positions.insert(
                path.to_string(),
                ReadingPosition {
                    ratio: *ratio,
                    updated_ms: *ms,
                },
            );
        }
        state
    }

    #[test]
    fn record_recent_file_dedupes_and_moves_to_front() {
        let state = state_with(&["a.md", "b.md", "c.md"], &[]);
        let next = apply_record(state, "b.md", None, 100);
        assert_eq!(next.recent_files, vec!["b.md", "a.md", "c.md"]);
    }

    #[test]
    fn record_recent_file_truncates_to_limit() {
        let mut state = DocumentSessionState::default();
        // 与真实行为同序：新记录 insert 在头部 ⇒ 头部最新、尾部最旧
        for i in (0..RECENT_FILES_LIMIT).rev() {
            state.recent_files.push(format!("f{i}.md"));
        }
        let next = apply_record(state, "new.md", None, 100);
        assert_eq!(next.recent_files.len(), RECENT_FILES_LIMIT);
        assert_eq!(next.recent_files[0], "new.md");
        // 最旧的（尾部 f0）被挤出
        assert!(!next.recent_files.contains(&"f0.md".to_string()));
        assert!(next.recent_files.contains(&"f9.md".to_string()));
    }

    #[test]
    fn record_without_ratio_keeps_positions_untouched() {
        let state = state_with(&["a.md"], &[("a.md", 0.5, 1)]);
        let next = apply_record(state, "a.md", None, 200);
        assert_eq!(next.reading_positions["a.md"].ratio, 0.5);
        assert_eq!(next.reading_positions["a.md"].updated_ms, 1);
    }

    #[test]
    fn record_with_ratio_updates_position_and_clamps() {
        let state = DocumentSessionState::default();
        let next = apply_record(state, "a.md", Some(1.7), 100);
        assert_eq!(next.reading_positions["a.md"].ratio, 1.0);

        let next = apply_record(next, "b.md", Some(-0.3), 101);
        assert_eq!(next.reading_positions["b.md"].ratio, 0.0);
    }

    #[test]
    fn record_rejects_non_finite_ratio() {
        let state = state_with(&[], &[("a.md", 0.5, 1)]);
        let next = apply_record(state, "b.md", Some(f64::NAN), 100);
        assert!(!next.reading_positions.contains_key("b.md"));
        let next = apply_record(next, "b.md", Some(f64::INFINITY), 100);
        assert!(!next.reading_positions.contains_key("b.md"));
    }

    #[test]
    fn record_empty_or_blank_path_is_ignored() {
        let state = state_with(&["a.md"], &[("a.md", 0.5, 1)]);
        let next = apply_record(state, "", None, 100);
        assert_eq!(next.recent_files, vec!["a.md"]);
        let next = apply_record(next, "   ", Some(0.7), 101);
        assert!(!next.reading_positions.contains_key(""));
        assert_eq!(next.reading_positions["a.md"].ratio, 0.5);
    }

    #[test]
    fn record_evicts_oldest_position_beyond_limit() {
        let mut state = DocumentSessionState::default();
        for i in 0..POSITIONS_LIMIT {
            state.reading_positions.insert(
                format!("p{i}.md"),
                ReadingPosition {
                    ratio: 0.5,
                    updated_ms: i as u64,
                },
            );
        }
        // p0.md 最久未读（updated_ms=0），新记录进来后应被淘汰
        let next = apply_record(state, "new.md", Some(0.8), 999);
        assert_eq!(next.reading_positions.len(), POSITIONS_LIMIT);
        assert!(!next.reading_positions.contains_key("p0.md"));
        assert_eq!(next.reading_positions["new.md"].ratio, 0.8);
    }

    #[test]
    fn record_never_evicts_the_just_written_entry() {
        let mut state = DocumentSessionState::default();
        for i in 0..POSITIONS_LIMIT {
            state.reading_positions.insert(
                format!("p{i}.md"),
                ReadingPosition {
                    ratio: 0.5,
                    updated_ms: 0, // 全部并列最旧
                },
            );
        }
        // 新条目时间也并列——但绝不能把自己淘汰掉（否则本次记录丢失）
        let next = apply_record(state, "new.md", Some(0.8), 0);
        assert!(next.reading_positions.contains_key("new.md"));
    }

    #[test]
    fn session_state_roundtrips_through_json() {
        let state = state_with(&["a.md", "b.md"], &[("a.md", 0.42, 12345)]);
        let bytes = serde_json::to_vec(&state).unwrap();
        let parsed: DocumentSessionState = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(parsed, state);
        // camelCase 字段名（与前端约定）
        let text = serde_json::to_string(&state).unwrap();
        assert!(text.contains("recentFiles"));
        assert!(text.contains("readingPositions"));
        assert!(text.contains("updatedMs"));
    }

    /// 各测试独立子目录：cargo test 并行跑，共享目录会互相 remove_dir_all 掐掉对方
    fn temp_dir(tag: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!("solo-session-test-{}-{tag}", std::process::id()))
    }

    #[test]
    fn load_state_falls_back_to_empty_on_garbage() {
        let dir = temp_dir("garbage");
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("broken.json");
        fs::write(&file, b"{not valid json").unwrap();
        let loaded = load_state(&file);
        assert_eq!(loaded, DocumentSessionState::default());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn save_state_atomic_and_reloadable() {
        let dir = temp_dir("atomic");
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("state.json");
        let state = state_with(&["a.md"], &[("a.md", 0.42, 12345)]);
        save_state(&file, &state).unwrap();
        assert_eq!(load_state(&file), state);
        // tmp 不残留
        assert!(!file.with_file_name("state.json.tmp").exists());
        let _ = fs::remove_dir_all(&dir);
    }
}
