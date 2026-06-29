use crate::error::AppError;
use crate::models::{
    DocumentImageImportResult, DocumentImageResolveResult, DocumentOpenResult, DocumentRenameResult,
    DocumentSaveResult, ImageAssetAuthorizationResult,
};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

const IMAGE_EXTENSIONS: [&str; 6] = ["png", "jpg", "jpeg", "gif", "webp", "svg"];

#[tauri::command]
pub fn open_document(path: String) -> Result<DocumentOpenResult, AppError> {
    let content = fs::read_to_string(&path)?;
    let last_modified_ms = read_modified_time_ms(Path::new(&path))?;

    Ok(DocumentOpenResult {
        path,
        content,
        last_modified_ms,
    })
}

#[tauri::command]
pub fn save_document(
    path: String,
    content: String,
    expected_last_modified_ms: Option<u64>,
    force: bool,
) -> Result<DocumentSaveResult, AppError> {
    let path_ref = Path::new(&path);
    if !force {
        if let Some(expected) = expected_last_modified_ms {
            if let Ok(current_modified) = read_modified_time_ms(path_ref) {
                if current_modified != expected {
                    return Err(AppError::conflict(
                        "文件已被外部修改，请重新加载或选择强制覆盖",
                    ));
                }
            }
        }
    }

    atomic_write(path_ref, content.as_bytes())?;
    let last_modified_ms = read_modified_time_ms(path_ref)?;

    Ok(DocumentSaveResult {
        path,
        last_modified_ms,
    })
}

#[tauri::command]
pub fn rename_file(old_path: String, new_name: String) -> Result<DocumentRenameResult, AppError> {
    let trimmed = new_name.trim();
    if trimmed.is_empty() {
        return Err(AppError::validation("文件名不能为空"));
    }

    let illegal_chars = ['/', '\\', ':', '*', '?', '"', '<', '>', '|'];
    if trimmed.chars().any(|c| illegal_chars.contains(&c)) {
        return Err(AppError::validation("文件名包含非法字符"));
    }

    let old_path_ref = Path::new(&old_path);
    if !old_path_ref.exists() {
        return Err(AppError::validation("原文件不存在"));
    }

    let extension = old_path_ref
        .extension()
        .and_then(|ext| ext.to_str())
        .ok_or_else(|| AppError::validation("无法识别文件扩展名"))?;

    let parent = old_path_ref
        .parent()
        .ok_or_else(|| AppError::validation("无法获取父目录"))?;

    // 去掉用户可能自己加的 .md 后缀
    let stem = trimmed
        .strip_suffix(".md")
        .or_else(|| trimmed.strip_suffix(".markdown"))
        .or_else(|| trimmed.strip_suffix(".txt"))
        .unwrap_or(trimmed);

    let new_filename = format!("{}.{}", stem, extension);
    let new_path = parent.join(&new_filename);

    // 目标已存在且不是同一文件 → 冲突
    if new_path.exists() {
        let same = old_path_ref.canonicalize().ok()
            == new_path.canonicalize().ok();
        if !same {
            return Err(AppError::conflict("目标文件已存在"));
        }
        // 同一文件（如仅大小写变化）→ 无需操作
        return Ok(DocumentRenameResult {
            path: new_path.to_string_lossy().to_string(),
        });
    }

    fs::rename(old_path_ref, &new_path)?;

    let new_path_str = new_path
        .to_str()
        .ok_or_else(|| AppError::validation("路径包含非法字符"))?
        .to_string();

    Ok(DocumentRenameResult { path: new_path_str })
}

#[tauri::command]
pub fn import_document_image(
    source_path: String,
    document_path: String,
    storage_dir: Option<String>,
) -> Result<DocumentImageImportResult, AppError> {
    let source = Path::new(&source_path);
    let filename = source
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| AppError::validation("无法解析图片文件名"))?;

    let target_dir = if let Some(ref dir) = storage_dir {
        Path::new(dir).to_path_buf()
    } else {
        let document_dir = Path::new(&document_path)
            .parent()
            .ok_or_else(|| AppError::validation("无法获取文档目录"))?;
        document_dir.join("assets")
    };

    if !target_dir.exists() {
        fs::create_dir_all(&target_dir)?;
    }

    let (target_path, target_filename) = unique_asset_target(&target_dir, filename);
    fs::copy(source, &target_path)?;
    let absolute_path = target_path
        .to_str()
        .ok_or_else(|| AppError::validation("无法解析图片路径"))?
        .to_string();

    Ok(DocumentImageImportResult {
        relative_path: format!("assets/{}", target_filename),
        absolute_path,
    })
}

#[tauri::command]
pub fn resolve_document_image_path(
    document_path: String,
    relative_path: String,
) -> Result<DocumentImageResolveResult, AppError> {
    // 防止路径遍历：拒绝绝对路径和含 .. 的相对路径
    if relative_path.starts_with('/') || relative_path.contains("..") {
        return Err(AppError::validation("图片路径无效"));
    }

    let document_dir = Path::new(&document_path)
        .parent()
        .ok_or_else(|| AppError::validation("无法获取文档目录"))?;
    let absolute_path = document_dir.join(&relative_path);
    let absolute_path = absolute_path
        .to_str()
        .ok_or_else(|| AppError::validation("无法解析图片路径"))?;

    Ok(DocumentImageResolveResult {
        absolute_path: absolute_path.to_string(),
    })
}

#[tauri::command]
pub fn authorize_image_asset(
    app: AppHandle,
    path: String,
) -> Result<ImageAssetAuthorizationResult, AppError> {
    let canonical_path = validate_image_asset_path(Path::new(&path))?;
    app.asset_protocol_scope().allow_file(&canonical_path)?;

    Ok(ImageAssetAuthorizationResult {
        path: canonical_path.to_string_lossy().to_string(),
    })
}

/// 如果路径是符号链接，解析到真实路径
fn resolve_symlink(path: &Path) -> PathBuf {
    match fs::symlink_metadata(path) {
        Ok(meta) if meta.is_symlink() => {
            match fs::read_link(path) {
                Ok(target) => {
                    if target.is_absolute() {
                        target
                    } else {
                        path.parent().unwrap_or(Path::new("")).join(target)
                    }
                }
                Err(_) => path.to_path_buf(),
            }
        }
        _ => path.to_path_buf(),
    }
}

pub(crate) fn atomic_write(path: &Path, content: &[u8]) -> Result<(), AppError> {
    let path = resolve_symlink(path);
    let parent = path
        .parent()
        .ok_or_else(|| AppError::validation("无法获取父目录"))?;
    if !parent.exists() {
        fs::create_dir_all(parent)?;
    }

    let tmp_path = temp_path(&path);
    {
        let mut file = fs::File::create(&tmp_path)?;
        file.write_all(content)?;
    }

    // std::fs::rename 在 Windows 上使用 MoveFileExW + MOVEFILE_REPLACE_EXISTING，
    // 在 Unix 上使用 rename(2)，两者都能原子地覆盖目标文件。
    // 无需 Windows 特殊的先删除再重命名（那会引入竞态窗口）。
    fs::rename(&tmp_path, &path)?;
    Ok(())
}

fn validate_image_asset_path(path: &Path) -> Result<PathBuf, AppError> {
    // 先 canonicalize 解析符号链接和 .. 路径，防止通过符号链接绕过扩展名检查
    // （例如 evil.png -> /etc/passwd 会在 canonicalize 后暴露真实扩展名）
    let canonical_path = path.canonicalize()?;

    let metadata = fs::metadata(&canonical_path)?;
    if !metadata.is_file() {
        return Err(AppError::validation("只能预览图片文件"));
    }

    let extension = canonical_path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_lowercase())
        .ok_or_else(|| AppError::validation("无法识别图片类型"))?;

    if !IMAGE_EXTENSIONS.contains(&extension.as_str()) {
        return Err(AppError::validation("不支持的图片类型"));
    }

    Ok(canonical_path)
}

fn read_modified_time_ms(path: &Path) -> Result<u64, AppError> {
    let metadata = fs::metadata(path)?;
    let modified = metadata.modified()?;
    let duration = modified
        .duration_since(UNIX_EPOCH)
        .map_err(|error| AppError::Io(error.to_string()))?;
    Ok(duration.as_millis() as u64)
}

fn temp_path(path: &Path) -> PathBuf {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("solo");
    path.with_file_name(format!(".{}.{}.tmp", file_name, millis))
}

fn unique_asset_target(assets_dir: &Path, filename: &str) -> (PathBuf, String) {
    let original = Path::new(filename);
    let stem = original
        .file_stem()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or("image");
    let extension = original.extension().and_then(|value| value.to_str());

    for suffix in 0.. {
        let candidate_name = if suffix == 0 {
            filename.to_string()
        } else if let Some(extension) = extension {
            format!("{stem}-{suffix}.{extension}")
        } else {
            format!("{stem}-{suffix}")
        };
        let candidate_path = assets_dir.join(&candidate_name);
        if !candidate_path.exists() {
            return (candidate_path, candidate_name);
        }
    }

    unreachable!("unbounded suffix loop must return before exhausting usize");
}

#[cfg(test)]
mod tests {
    use super::{
        atomic_write, import_document_image, open_document, rename_file, save_document,
        validate_image_asset_path,
    };
    use crate::error::AppError;
    use std::fs;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::thread;
    use std::time::{Duration, SystemTime, UNIX_EPOCH};

    static TEST_COUNTER: AtomicU64 = AtomicU64::new(1);

    fn test_dir() -> PathBuf {
        let millis = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_millis())
            .unwrap_or(0);
        let seq = TEST_COUNTER.fetch_add(1, Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!("solo-document-test-{}-{}", millis, seq));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn open_document_returns_content_and_mtime() {
        let dir = test_dir();
        let path = dir.join("demo.md");
        atomic_write(&path, b"# demo").unwrap();

        let result = open_document(path.to_string_lossy().to_string()).unwrap();

        assert_eq!(result.content, "# demo");
        assert!(result.last_modified_ms > 0);

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn save_document_reports_conflicts() {
        let dir = test_dir();
        let path = dir.join("demo.md");
        atomic_write(&path, b"first").unwrap();
        let opened = open_document(path.to_string_lossy().to_string()).unwrap();
        thread::sleep(Duration::from_millis(5));
        atomic_write(&path, b"second").unwrap();

        let error = save_document(
            opened.path.clone(),
            "third".to_string(),
            Some(opened.last_modified_ms),
            false,
        )
        .unwrap_err();

        match error {
            AppError::Conflict(_) => {}
            other => panic!("expected conflict error, got {:?}", other),
        }

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn import_document_image_does_not_overwrite_existing_asset() {
        let dir = test_dir();
        let document_path = dir.join("demo.md");
        let source_dir = dir.join("source");
        let assets_dir = dir.join("assets");
        fs::create_dir_all(&source_dir).unwrap();
        fs::create_dir_all(&assets_dir).unwrap();
        fs::write(&document_path, b"# demo").unwrap();
        fs::write(assets_dir.join("cover.png"), b"existing").unwrap();
        let source_path = source_dir.join("cover.png");
        fs::write(&source_path, b"new").unwrap();

        let imported = import_document_image(
            source_path.to_string_lossy().to_string(),
            document_path.to_string_lossy().to_string(),
            None,
        )
        .unwrap();

        assert_eq!(imported.relative_path, "assets/cover-1.png");
        assert_eq!(fs::read(assets_dir.join("cover.png")).unwrap(), b"existing");
        assert_eq!(fs::read(assets_dir.join("cover-1.png")).unwrap(), b"new");

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn validate_image_asset_path_rejects_non_images() {
        let dir = test_dir();
        let text_path = dir.join("demo.txt");
        fs::write(&text_path, b"not an image").unwrap();

        let error = validate_image_asset_path(&text_path).unwrap_err();

        match error {
            AppError::Validation(message) => assert_eq!(message, "不支持的图片类型"),
            other => panic!("expected validation error, got {:?}", other),
        }

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn validate_image_asset_path_returns_canonical_image_path() {
        let dir = test_dir();
        let image_path = dir.join("cover.PNG");
        fs::write(&image_path, b"image").unwrap();

        let validated = validate_image_asset_path(&image_path).unwrap();

        assert_eq!(validated, image_path.canonicalize().unwrap());

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn save_document_force_skips_conflict_check() {
        let dir = test_dir();
        let path = dir.join("force.md");
        atomic_write(&path, b"original").unwrap();
        let opened = open_document(path.to_string_lossy().to_string()).unwrap();

        // externally modify file
        thread::sleep(Duration::from_millis(5));
        atomic_write(&path, b"external").unwrap();

        // force=true should succeed despite mtime mismatch
        let result = save_document(
            opened.path.clone(),
            "forced content".into(),
            Some(opened.last_modified_ms),
            true,
        )
        .unwrap();

        assert_eq!(result.path, opened.path);

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn save_document_creates_parent_directory() {
        let dir = test_dir();
        let nested = dir.join("sub").join("new.md");
        let result = save_document(
            nested.to_string_lossy().to_string(),
            "new file".into(),
            None,
            true,
        )
        .unwrap();

        assert!(nested.exists());
        assert_eq!(fs::read_to_string(&nested).unwrap(), "new file");
        assert!(result.last_modified_ms > 0);

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn rename_file_rejects_empty_name() {
        let dir = test_dir();
        let path = dir.join("old.md");
        atomic_write(&path, b"content").unwrap();

        let err = rename_file(path.to_string_lossy().to_string(), "  ".into()).unwrap_err();
        match err {
            AppError::Validation(msg) => assert_eq!(msg, "文件名不能为空"),
            _ => panic!("expected validation error"),
        }

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn rename_file_rejects_illegal_chars() {
        let dir = test_dir();
        let path = dir.join("old.md");
        atomic_write(&path, b"content").unwrap();

        let err = rename_file(path.to_string_lossy().to_string(), "a/b".into()).unwrap_err();
        match err {
            AppError::Validation(msg) => assert_eq!(msg, "文件名包含非法字符"),
            _ => panic!("expected validation error"),
        }

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn rename_file_strips_md_extension_from_new_name() {
        let dir = test_dir();
        let path = dir.join("old.md");
        atomic_write(&path, b"content").unwrap();

        let result = rename_file(path.to_string_lossy().to_string(), "new.md".into()).unwrap();

        let expected = dir.join("new.md");
        assert_eq!(result.path, expected.to_string_lossy());
        assert!(expected.exists());

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn rename_file_rejects_target_exists() {
        let dir = test_dir();
        let old = dir.join("old.md");
        let target = dir.join("target.md");
        atomic_write(&old, b"old").unwrap();
        atomic_write(&target, b"target").unwrap();

        let err = rename_file(old.to_string_lossy().to_string(), "target".into()).unwrap_err();
        match err {
            AppError::Conflict(msg) => assert_eq!(msg, "目标文件已存在"),
            _ => panic!("expected conflict error"),
        }

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn rename_file_success() {
        let dir = test_dir();
        let old = dir.join("old.md");
        atomic_write(&old, b"hello").unwrap();

        let result = rename_file(old.to_string_lossy().to_string(), "renamed".into()).unwrap();

        let expected = dir.join("renamed.md");
        assert_eq!(result.path, expected.to_string_lossy());
        assert!(!old.exists());
        assert!(expected.exists());
        assert_eq!(fs::read_to_string(&expected).unwrap(), "hello");

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn resolve_document_image_path_rejects_absolute() {
        let err = super::resolve_document_image_path("/abs/path.md".into(), "/evil/passwd".into())
            .unwrap_err();
        match err {
            AppError::Validation(msg) => assert_eq!(msg, "图片路径无效"),
            _ => panic!("expected validation error"),
        }
    }

    #[test]
    fn resolve_document_image_path_rejects_path_traversal() {
        let err =
            super::resolve_document_image_path("/abs/path.md".into(), "../../etc/passwd".into())
                .unwrap_err();
        match err {
            AppError::Validation(msg) => assert_eq!(msg, "图片路径无效"),
            _ => panic!("expected validation error"),
        }
    }

    #[test]
    fn resolve_document_image_path_resolves_relative_path() {
        let dir = test_dir();
        let doc_path = dir.join("doc.md");
        let result =
            super::resolve_document_image_path(doc_path.to_string_lossy().to_string(), "images/x.png".into())
                .unwrap();
        let expected = dir.join("images/x.png");
        assert_eq!(result.absolute_path, expected.to_string_lossy());

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn temp_path_has_expected_format() {
        let dir = test_dir();
        let path = dir.join("demo.md");
        let tmp = super::temp_path(&path);

        let filename = tmp.file_name().unwrap().to_string_lossy();
        assert!(filename.starts_with(".demo."));
        assert!(filename.ends_with(".tmp"));

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn unique_asset_target_returns_first_available_slot() {
        let dir = test_dir();
        let assets = dir.join("assets");
        fs::create_dir_all(&assets).unwrap();

        let (p1, n1) = super::unique_asset_target(&assets, "cover.png");
        assert_eq!(n1, "cover.png");
        assert_eq!(p1, assets.join("cover.png"));

        // create the file so next call deduplicates
        fs::write(&p1, b"img").unwrap();
        let (p2, n2) = super::unique_asset_target(&assets, "cover.png");
        assert_eq!(n2, "cover-1.png");
        assert_eq!(p2, assets.join("cover-1.png"));

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn unique_asset_target_without_extension() {
        let dir = test_dir();
        let assets = dir.join("assets");
        fs::create_dir_all(&assets).unwrap();

        let (p1, n1) = super::unique_asset_target(&assets, "image");
        assert_eq!(n1, "image");

        fs::write(&p1, b"img").unwrap();
        let (_p2, n2) = super::unique_asset_target(&assets, "image");
        assert_eq!(n2, "image-1");

        let _ = fs::remove_dir_all(dir);
    }
}
