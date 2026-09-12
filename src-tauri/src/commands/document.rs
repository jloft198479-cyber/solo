use crate::error::AppError;
use crate::models::{
    DocumentImageImportResult, DocumentOpenResult, DocumentRenameResult,
    DocumentSaveResult, ImageAssetAuthorizationResult,
};
use base64::{engine::general_purpose, Engine as _};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

// 图片扩展名白名单（用于显示授权校验 validate_image_asset_path）。
// ⚠️ 必须与前端 editor-image-drop.ts 的 supportedImageExtensions 保持一致，
// 且与 mime_to_extension 支持的格式对齐——否则会出现「能保存但显示失败」（如 .bmp/.ico）。
const IMAGE_EXTENSIONS: [&str; 8] = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico"];

// 文档扩展名白名单。与 lib.rs 的 supported_open_path()（CLI 参数接收门控）同源于
// 「solo 能编辑什么文件」这一事实，新增可编辑类型时两处都要改。
const OPEN_EXTENSIONS: [&str; 3] = ["md", "markdown", "txt"];
// 写入白名单比读取多一个 json：「导出主题模板」复用 save_document 写 .json
// （见 ThemeSelector.vue 的 downloadTemplate），只按 OPEN 白名单卡会让导出功能报无效参数。
const WRITE_EXTENSIONS: [&str; 4] = ["md", "markdown", "txt", "json"];

// 同目录文档扫描/列举的数量上限：防 node_modules 一类病态目录里有成千上万个 .md
// 把 IPC 或改名后的链接同步扫描拖垮。list_markdown_files 与 sync_wikilinks_on_rename 共用此上限。
const SAME_DIR_DOC_LIMIT: usize = 500;

/// 校验文件扩展名在白名单内（大小写不敏感）。
/// 在 IPC 入口把关，避免恶意文档内容诱导前端读写任意类型文件；
/// 本地绝对路径本身是合法用例（用户引用 D:/docs/x.md），故只卡扩展名不做目录约束。
fn validate_document_extension(path: &str, allowed: &[&str], action: &str) -> Result<(), AppError> {
    let ext = Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default();
    if allowed.contains(&ext.as_str()) {
        Ok(())
    } else {
        Err(AppError::validation(format!(
            "{}仅支持 {} 文件",
            action,
            allowed.join("/")
        )))
    }
}

#[tauri::command]
pub async fn open_document(path: String) -> Result<DocumentOpenResult, AppError> {
    validate_document_extension(&path, &OPEN_EXTENSIONS, "打开")?;
    let path_for_io = path.clone();
    let (content, last_modified_ms) = tauri::async_runtime::spawn_blocking(move || {
        let content = fs::read_to_string(&path_for_io)?;
        let last_modified_ms = read_modified_time_ms(Path::new(&path_for_io))?;
        // 兜底清理：同目录下 solo 崩溃残留的 .tmp 文件（静默，不阻塞）
        cleanup_stale_tmp_files(Path::new(&path_for_io));
        Ok::<_, AppError>((content, last_modified_ms))
    })
    .await
    .map_err(|e| AppError::Native(format!("任务调度失败: {}", e)))??;

    Ok(DocumentOpenResult {
        path,
        content,
        last_modified_ms,
    })
}

#[tauri::command]
pub async fn get_file_mtime(path: String) -> Result<u64, AppError> {
    let path_for_io = path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        read_modified_time_ms(Path::new(&path_for_io))
    })
    .await
    .map_err(|e| AppError::Native(format!("任务调度失败: {}", e)))?
}

/// 互链 `[[` 补全候选：列出当前文档同目录下的 .md 文件名（不递归子目录）。
/// 只返回文件名（不含路径），按名称排序（大小写不敏感），上限 500 防
/// node_modules 类病态目录拖垮 IPC。排除「当前文档自身」由前端做
/// （Rust 不感知「谁是当前文件」的语义，保持命令可复用）。
#[tauri::command]
pub async fn list_markdown_files(path: String) -> Result<Vec<String>, AppError> {
    validate_document_extension(&path, &OPEN_EXTENSIONS, "列出")?;
    tauri::async_runtime::spawn_blocking(move || {
        let dir = Path::new(&path)
            .parent()
            .ok_or_else(|| AppError::validation("文档不在任何目录下"))?;
        let mut names: Vec<String> = fs::read_dir(dir)?
            .filter_map(|entry| entry.ok())
            .filter(|entry| entry.file_type().map(|t| t.is_file()).unwrap_or(false))
            .filter_map(|entry| {
                let name = entry.file_name().to_string_lossy().to_string();
                // 只列 .md：互链 target 无扩展名时统一补 .md（resolveWikilinkTarget），
                // .markdown 等其他可编辑类型无法被互链指向
                if name.to_ascii_lowercase().ends_with(".md") && name.len() > 3 {
                    Some(name)
                } else {
                    None
                }
            })
            .collect();
        names.sort_by(|a, b| a.to_lowercase().cmp(&b.to_lowercase()));
        names.truncate(SAME_DIR_DOC_LIMIT);
        Ok(names)
    })
    .await
    .map_err(|e| AppError::Native(format!("任务调度失败: {}", e)))?
}

#[tauri::command]
pub async fn save_document(
    path: String,
    content: String,
    expected_last_modified_ms: Option<u64>,
    force: bool,
) -> Result<DocumentSaveResult, AppError> {
    validate_document_extension(&path, &WRITE_EXTENSIONS, "保存")?;
    // 冲突检查也涉及 metadata IO，一并放进 spawn_blocking
    let path_for_io = path.clone();
    let last_modified_ms = tauri::async_runtime::spawn_blocking(move || {
        let path_ref = Path::new(&path_for_io);
        if !force {
            if let Some(expected) = expected_last_modified_ms {
                match read_modified_time_ms(path_ref) {
                    Ok(current) if current != expected => {
                        return Err(AppError::conflict(
                            "文件已被外部修改，请重新加载或选择强制覆盖",
                        ));
                    }
                    Ok(_) => {}
                    Err(e) => {
                        // 文件不存在 → 返回 conflict 让前端给"强制覆盖"入口（force 时 atomic_write 重建文件）
                        // 其他 IO 错误（权限等）→ 原样返回
                        if !path_ref.exists() {
                            return Err(AppError::conflict(
                                "文件已被移动或删除，是否在此位置重新创建？",
                            ));
                        }
                        return Err(e);
                    }
                }
            }
        }

        atomic_write(path_ref, content.as_bytes())?;
        read_modified_time_ms(path_ref)
    })
    .await
    .map_err(|e| AppError::Native(format!("任务调度失败: {}", e)))??;

    Ok(DocumentSaveResult {
        path,
        last_modified_ms,
    })
}

#[tauri::command]
pub async fn rename_file(old_path: String, new_name: String) -> Result<DocumentRenameResult, AppError> {
    let trimmed = new_name.trim();
    if trimmed.is_empty() {
        return Err(AppError::validation("文件名不能为空"));
    }

    let illegal_chars = ['/', '\\', ':', '*', '?', '"', '<', '>', '|'];
    if trimmed.chars().any(|c| illegal_chars.contains(&c)) {
        return Err(AppError::validation("文件名包含非法字符"));
    }

    // 去掉用户可能自己加的 .md 后缀（纯字符串操作，无需 IO，留在 spawn_blocking 外）
    let stem = trimmed
        .strip_suffix(".md")
        .or_else(|| trimmed.strip_suffix(".markdown"))
        .or_else(|| trimmed.strip_suffix(".txt"))
        .unwrap_or(trimmed)
        .to_string();

    let new_path_str = tauri::async_runtime::spawn_blocking(move || -> Result<String, AppError> {
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
            return Ok(new_path.to_string_lossy().to_string());
        }

        fs::rename(old_path_ref, &new_path)?;

        Ok(new_path
            .to_str()
            .ok_or_else(|| AppError::validation("路径包含非法字符"))?
            .to_string())
    })
    .await
    .map_err(|e| AppError::Native(format!("任务调度失败: {}", e)))??;

    Ok(DocumentRenameResult { path: new_path_str })
}

/// 把文档正文里指向 `old_stem` 的互链目标改成 `new_stem`；无改动返回 `None`。
///
/// 只动 `[[目标]]` 与 `[[目标|别名]]` 的**目标段**（`|` 后的别名原样保留），
/// 覆盖「裸名」与「带 .md」两种写法。精确整词匹配——`old=笔记` 时不会误伤
/// `[[笔记本]]`，也不碰普通链接 `[x](y)` 或正文里出现的同名词。
/// **围栏代码块（``` / ~~~）内的 `[[旧名]]` 一律跳过**——那是给人看的示例、不是真链接
/// （互链目标不含换行，故逐行判定安全）。
/// 已知限制：缩进式代码块与行内代码（单反引号）不在保护范围（误伤需同时满足
/// 「代码里恰好举例写了旧名」+「旧名正是被改名文档」，概率极低，见方案文档）。
/// 预览（dry_run）与真正改写共用本函数，保证「列给用户看的」与「实际改的」完全一致。
fn rewrite_wikilink_targets(content: &str, old_stem: &str, new_stem: &str) -> Option<String> {
    let mut fence: Option<char> = None;
    let mut out = String::with_capacity(content.len());
    for line in content.split_inclusive('\n') {
        let trimmed = line.trim_start_matches([' ', '\t']);
        let marker = if trimmed.starts_with("```") {
            Some('`')
        } else if trimmed.starts_with("~~~") {
            Some('~')
        } else {
            None
        };
        match (fence, marker) {
            // 围栏起始行：进入围栏，本行原样保留
            (None, Some(ch)) => {
                fence = Some(ch);
                out.push_str(line);
            }
            // 同类标记行：闭合围栏，本行原样保留
            (Some(ch), Some(ch2)) if ch == ch2 => {
                fence = None;
                out.push_str(line);
            }
            // 围栏内普通行：原样保留，绝不替换
            (Some(_), _) => out.push_str(line),
            // 围栏外：做替换
            (None, None) => out.push_str(&replace_targets_in_line(line, old_stem, new_stem)),
        }
    }
    if out == content {
        None
    } else {
        Some(out)
    }
}

/// 对围栏外的单行做精确目标替换：`[[old]]` / `[[old|..]]` 与 `[[old.md]]` / `[[old.md|..]]`
/// 的目标段改成新名，别名段（`|` 后）原样保留。
fn replace_targets_in_line(line: &str, old_stem: &str, new_stem: &str) -> String {
    let mut out = line.to_string();
    // 先替换裸名不会误伤带 .md 的形态——`[[old]]` 要求 `old` 后紧跟 `]]`，
    // 而 `[[old.md]]` 里 `old` 后是 `.`，两者字面不重叠。
    for (old_t, new_t) in [
        (old_stem.to_string(), new_stem.to_string()),
        (format!("{}.md", old_stem), format!("{}.md", new_stem)),
    ] {
        out = out
            .replace(&format!("[[{}]]", old_t), &format!("[[{}]]", new_t))
            .replace(&format!("[[{}|", old_t), &format!("[[{}|", new_t));
    }
    out
}

/// 改名后同步「指向本文档」的互链：扫描同目录其它文档，把 `[[旧名]]` 改成 `[[新名]]`。
///
/// - `dry_run = true`：只读预览，返回**将被改动**的文件名，不写盘（供前端先列清单让用户确认）。
/// - `dry_run = false`：真正改写，每个文件走 `atomic_write`（整篇写成功才算数，绝不出现半篇），
///   返回**已改动**的文件名。
///
/// 边界与安全：路径解析全在本函数（从 `new_path` 取父目录、从两路径取 `file_stem`）；
/// **跳过改名后的这篇自身**（`skip_filename`）——不碰用户正在编辑、内存态未刷新的文档；
/// 只处理同目录、扩展名白名单（`OPEN_EXTENSIONS`）内的文档，按**已扫描文档数**限流
/// （`SAME_DIR_DOC_LIMIT`，防 node_modules 病态目录）；改写保护围栏代码块（见
/// `rewrite_wikilink_targets`）。单个文件读/写失败一律静默跳过，**任何情况都不阻断改名主流程**。
/// 跨窗口若另有窗口正开着被改的文件，靠既有的「外部修改」提示（`checkExternalModification`）
/// 与保存冲突检测（mtime 乐观锁）兜底，不在此新增机制。
#[tauri::command]
pub async fn sync_wikilinks_on_rename(
    old_path: String,
    new_path: String,
    dry_run: bool,
) -> Result<Vec<String>, AppError> {
    validate_document_extension(&new_path, &OPEN_EXTENSIONS, "同步链接")?;

    let new_ref = Path::new(&new_path);
    let old_ref = Path::new(&old_path);
    let dir = new_ref
        .parent()
        .ok_or_else(|| AppError::validation("无法获取父目录"))?
        .to_path_buf();
    let old_stem = old_ref
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or_default()
        .to_string();
    let new_stem = new_ref
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or_default()
        .to_string();
    let skip_filename = new_ref
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or_default()
        .to_string();

    // 名字为空或没变（如仅大小写、扩展名不同的等价改名）→ 无需同步
    if old_stem.is_empty() || new_stem.is_empty() || old_stem == new_stem {
        return Ok(Vec::new());
    }

    let affected = tauri::async_runtime::spawn_blocking(move || {
        scan_and_rewrite_wikilinks(
            &dir,
            &old_stem,
            &new_stem,
            &skip_filename,
            dry_run,
            SAME_DIR_DOC_LIMIT,
        )
    })
    .await
    .map_err(|e| AppError::Native(format!("任务调度失败: {}", e)))?;

    Ok(affected)
}

/// 扫描 `dir`（不递归）下的可编辑文档，把 `[[old_stem]]` 改成 `new_stem`，返回受影响文件名（升序）。
/// 同步执行（由命令包进 `spawn_blocking`）。抽成独立函数便于用 `limit` 做小样本单测。
/// - `skip_filename`：跳过改名后的当前文档自身（同目录唯一同名文件，不比对路径全等即可）。
/// - `limit`：最多**扫描**多少个候选文档（已扫描数，非命中数）——真正给病态大目录兜底。
/// - `dry_run`：只预览命中、不写盘。
fn scan_and_rewrite_wikilinks(
    dir: &Path,
    old_stem: &str,
    new_stem: &str,
    skip_filename: &str,
    dry_run: bool,
    limit: usize,
) -> Vec<String> {
    let mut affected: Vec<String> = Vec::new();
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        // 目录读不了（被删/权限）：静默返回空，不报错、不阻断改名
        Err(_) => return affected,
    };
    let mut scanned = 0usize;
    for entry in entries.flatten() {
        if scanned >= limit {
            break;
        }
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let name = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) => n.to_string(),
            None => continue,
        };
        // 跳过正在改名的这篇自身：它的内存态/基线此刻正被编辑器持有，改写会被下次保存回写
        if name == skip_filename {
            continue;
        }
        // 只碰可编辑文档类型（扩展名闸门），防越权读写任意文件
        if validate_document_extension(&name, &OPEN_EXTENSIONS, "同步链接").is_err() {
            continue;
        }
        scanned += 1;
        let content = match fs::read_to_string(&path) {
            Ok(c) => c,
            // 非 UTF-8 / 权限等读失败：跳过这一个，继续处理其它文件
            Err(_) => continue,
        };
        if let Some(updated) = rewrite_wikilink_targets(&content, old_stem, new_stem) {
            // 预览模式不写盘；改写模式写失败则跳过（不计入 affected）
            if !dry_run && atomic_write(&path, updated.as_bytes()).is_err() {
                continue;
            }
            affected.push(name);
        }
    }
    affected.sort();
    affected
}

#[tauri::command]
pub async fn import_document_image(
    source_path: String,
    document_path: String,
    storage_dir: Option<String>,
) -> Result<DocumentImageImportResult, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        // 复用 validate_image_asset_path 作为「什么是可导入图片」的真理源：
        // canonicalize 解析符号链接 + is_file + IMAGE_EXTENSIONS 三重校验，
        // 防止把任意文件（或 evil.png -> secret.txt 这类符号链接）拷进资产目录。
        let source = validate_image_asset_path(Path::new(&source_path))?;
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

        // 有自定义路径时只用文件名（前端用 asset://），否则用 assets/ 相对路径
        let relative_path = if storage_dir.is_some() {
            target_filename.clone()
        } else {
            format!("assets/{}", target_filename)
        };

        Ok(DocumentImageImportResult {
            relative_path,
            absolute_path,
        })
    })
    .await
    .map_err(|e| AppError::Native(format!("任务调度失败: {}", e)))?
}

/// MIME 类型 → 文件扩展名映射
pub(crate) fn mime_to_extension(mime: &str) -> &'static str {
    match mime {
        "image/png" => "png",
        "image/jpeg" | "image/jpg" => "jpg",
        "image/gif" => "gif",
        "image/webp" => "webp",
        "image/svg+xml" => "svg",
        "image/bmp" => "bmp",
        "image/x-icon" | "image/vnd.microsoft.icon" => "ico",
        _ => "png", // 默认 fallback
    }
}

/// 从 data URL 解码图片并保存到 assets 目录
#[tauri::command]
pub async fn save_clipboard_image(
    data_url: String,
    document_path: Option<String>,
    storage_dir: Option<String>,
) -> Result<DocumentImageImportResult, AppError> {
    // 解析 data URL: data:image/png;base64,iVBOR...（纯字符串解析，不阻塞）
    let (mime_type, base64_data) = parse_data_url(&data_url)?;
    let ext = mime_to_extension(&mime_type);

    tauri::async_runtime::spawn_blocking(move || {
        let target_dir = if let Some(ref dir) = storage_dir {
            Path::new(dir).to_path_buf()
        } else if let Some(ref doc_path) = document_path {
            let document_dir = Path::new(doc_path)
                .parent()
                .ok_or_else(|| AppError::validation("无法获取文档目录"))?;
            document_dir.join("assets")
        } else {
            return Err(AppError::validation("请先保存文档，或设置图片存储位置"));
        };

        if !target_dir.exists() {
            fs::create_dir_all(&target_dir)?;
        }

        // 生成唯一文件名：pasted-image-{毫秒时间戳}.ext
        // 连字符而非空格：`Pasted image xxx.png` 里的空格在 Markdown 链接语法中
        // 需要尖括号包裹才能落盘（历史版本曾因此丢图），新文件从源头消灭空格。
        let timestamp_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0);
        let base_name = format!("pasted-image-{}", timestamp_ms);
        let filename = format!("{}.{}", base_name, ext);

        let (target_path, target_filename) = unique_asset_target(&target_dir, &filename);

        let decoded = general_purpose::STANDARD
            .decode(base64_data.as_bytes())
            .map_err(|_| AppError::validation("图片数据解码失败"))?;

        fs::write(&target_path, decoded)?;

        let absolute_path = target_path
            .to_str()
            .ok_or_else(|| AppError::validation("无法解析图片路径"))?
            .to_string();

        // 有自定义路径时只用文件名（前端用 asset://），否则用 assets/ 相对路径
        let relative_path = if storage_dir.is_some() {
            target_filename.clone()
        } else {
            format!("assets/{}", target_filename)
        };

        Ok(DocumentImageImportResult {
            relative_path,
            absolute_path,
        })
    })
    .await
    .map_err(|e| AppError::Native(format!("任务调度失败: {}", e)))?
}

/// 解析 data URL，返回 (MIME 类型, base64 数据)
fn parse_data_url(data_url: &str) -> Result<(String, String), AppError> {
    // data:[<mediatype>][;base64],<data>
    let rest = data_url
        .strip_prefix("data:")
        .ok_or_else(|| AppError::validation("无效的 data URL 格式"))?;

    let (mime_and_encoding, _data) = rest
        .split_once(',')
        .ok_or_else(|| AppError::validation("无效的 data URL 格式"))?;

    let parts: Vec<&str> = mime_and_encoding.split(';').collect();
    let mime_type = if parts.is_empty() || parts[0].is_empty() {
        "image/png".to_string()
    } else {
        parts[0].to_string()
    };

    let is_base64 = parts.iter().any(|p| p.trim() == "base64");
    if !is_base64 {
        return Err(AppError::validation("仅支持 base64 编码的图片数据"));
    }

    Ok((mime_type, _data.to_string()))
}

#[tauri::command]
pub async fn authorize_image_asset(
    app: AppHandle,
    path: String,
    document_path: Option<String>,
) -> Result<ImageAssetAuthorizationResult, AppError> {
    // 纯路径拼接，不阻塞
    let resolved = if let Some(doc_path) = document_path {
        let doc_dir = Path::new(&doc_path)
            .parent()
            .ok_or_else(|| AppError::validation("无法获取文档目录"))?;
        doc_dir.join(&path)
    } else {
        PathBuf::from(&path)
    };

    // canonicalize + metadata IO 丢进后台线程
    let canonical_path = tauri::async_runtime::spawn_blocking(move || {
        validate_image_asset_path(&resolved)
    })
    .await
    .map_err(|e| AppError::Native(format!("任务调度失败: {}", e)))??;

    // scope 管理不阻塞，留在主线程
    app.asset_protocol_scope().allow_file(&canonical_path)?;

    Ok(ImageAssetAuthorizationResult {
        path: canonical_path.to_string_lossy().to_string(),
    })
}

/// 合并路径判别 + authorize + 返回 canonical path。
/// 与 `authorize_image_asset` 的区别：调用方传 `src`（可能是相对路径/绝对路径/storage 目录下文件名）
/// 和可选的 `document_path` / `storage_dir`，由 Rust 侧统一判别，简化前端调用。
///
/// 路径解析规则（「真理源」集中在 Rust 侧，前端不重复实现）：
/// 1. `src` 是绝对路径 → 直接用（用户自己负责），仅做扩展名校验
/// 2. `src` 以 `assets/` 开头 → 强制走文档目录（即使设了 storage_dir 也不抢）
///    这是为了兼容「文档自带 assets/ 相对引用」的常见写法，否则设了全局
///    imageStoragePath 后 `![x](assets/diagram.png)` 会被错误解析到
///    storagePath/assets/diagram.png——这是真实回归。
/// 3. 否则若有 storage_dir → join 到 storage_dir
/// 4. 否则若有 document_path → join 到文档目录
/// 5. 都没有 → 当作绝对路径
#[tauri::command]
pub async fn resolve_image_display(
    app: AppHandle,
    src: String,
    document_path: Option<String>,
    storage_dir: Option<String>,
) -> Result<ImageAssetAuthorizationResult, AppError> {
    // 纯路径解析，不阻塞
    let (resolved, is_absolute, base_dir) =
        resolve_image_src(&src, document_path.as_deref(), storage_dir.as_deref())?;

    // canonicalize + metadata + containment check 丢进后台线程
    let canonical_path = tauri::async_runtime::spawn_blocking(move || -> Result<PathBuf, AppError> {
        let canonical_path = validate_image_asset_path(&resolved)?;

        // 相对路径必须落在基目录之内（防 ../../secret.png 越权）
        // 绝对路径放行——solo 是本地编辑器，用户有权引用 D:/photos/cat.png 这类外部图片
        if !is_absolute {
            if let Some(ref base) = base_dir {
                let base_canonical = base.canonicalize().ok();
                if let Some(ref base_canonical) = base_canonical {
                    if !canonical_path.starts_with(base_canonical) {
                        return Err(AppError::validation("图片路径越权：不允许引用文档目录之外的相对路径"));
                    }
                }
            }
        }

        Ok(canonical_path)
    })
    .await
    .map_err(|e| AppError::Native(format!("任务调度失败: {}", e)))??;

    // scope 管理不阻塞，留在主线程
    app.asset_protocol_scope().allow_file(&canonical_path)?;

    Ok(ImageAssetAuthorizationResult {
        path: canonical_path.to_string_lossy().to_string(),
    })
}

/// 把 `src`（相对路径 / 绝对路径 / storage 目录下文件名）解析成实际要访问的路径。
/// 返回 `(resolved_path, is_absolute, base_dir)`，供 `resolve_image_display` 做守卫校验。
/// 抽成纯函数便于单测覆盖「assets/ 守卫」「storage 优先级」等规则。
fn resolve_image_src(
    src: &str,
    document_path: Option<&str>,
    storage_dir: Option<&str>,
) -> Result<(PathBuf, bool, Option<PathBuf>), AppError> {
    let src_path = Path::new(src);
    let is_absolute = src_path.is_absolute();
    let is_assets_relative = !is_absolute
        && src_path
            .components()
            .next()
            .and_then(|c| c.as_os_str().to_str())
            .map(|first| first == "assets")
            .unwrap_or(false);

    // 基目录：assets/ 相对引用强制走文档目录；其他情况按 storage > doc > 无 的优先级
    let base_dir: Option<PathBuf> = if is_assets_relative {
        document_path
            .and_then(|p| Path::new(p).parent().map(Path::to_path_buf))
    } else if storage_dir.is_some() {
        storage_dir.map(PathBuf::from)
    } else {
        document_path
            .and_then(|p| Path::new(p).parent().map(Path::to_path_buf))
    };

    // 相对路径必须有基目录；绝对路径直接用
    let resolved = if is_absolute {
        PathBuf::from(src)
    } else {
        let base = base_dir
            .as_ref()
            .ok_or_else(|| AppError::validation("无法解析图片路径：缺少文档目录"))?;
        base.join(src)
    };

    Ok((resolved, is_absolute, base_dir))
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
        // fsync 数据块后再 rename：断电/内核崩溃时若 rename 的元数据先行持久化
        // 而数据块尚未落盘，唯一文档副本会整文件截断或半新半旧（tmp 已被 rename
        // 走，旧数据无法恢复）。保存是低频操作，sync_all 的毫秒级代价可接受。
        file.sync_all()?;
    }

    // std::fs::rename 在 Windows 上使用 MoveFileExW + MOVEFILE_REPLACE_EXISTING，
    // 在 Unix 上使用 rename(2)，两者都能原子地覆盖目标文件。
    // 无需 Windows 特殊的先删除再重命名（那会引入竞态窗口）。
    fs::rename(&tmp_path, &path)?;

    // Unix 上再 fsync 父目录，确保 rename 的目录项变更持久化（断电后不回退到旧文件）。
    // Windows/NTFS 元数据有日志保护且 std 无目录 fsync 入口，无需（也无法）此步。
    #[cfg(unix)]
    {
        if let Ok(dir) = fs::File::open(parent) {
            let _ = dir.sync_all();
        }
    }
    Ok(())
}

/// 兜底清理：同目录下 solo 崩溃残留的 .tmp 文件。
/// 匹配模式 `.{原文件名}.{纯数字}.tmp`，只删 mtime 超过 1h 的残留，
/// 避免误伤双开进程正在写入的 .tmp。
/// 清理失败静默跳过，不阻塞主流程。
fn cleanup_stale_tmp_files(path: &Path) {
    let parent = match path.parent() {
        Some(p) => p,
        None => return,
    };
    let file_name = match path.file_name().and_then(|n| n.to_str()) {
        Some(n) => n,
        None => return,
    };
    let prefix = format!(".{}.", file_name);
    let now = SystemTime::now();
    let stale_age = Duration::from_secs(3600);

    if let Ok(entries) = fs::read_dir(parent) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            // 快速前缀/后缀过滤，跳过不匹配的文件
            if !name.starts_with(&prefix) || !name.ends_with(".tmp") {
                continue;
            }
            // 提取中间的数字部分：.{file_name}.{millis}.tmp
            let middle = &name[prefix.len()..];
            if let Some(dot_pos) = middle.rfind('.') {
                let num_part = &middle[..dot_pos];
                if !num_part.is_empty() && num_part.bytes().all(|b| b.is_ascii_digit()) {
                    let is_stale = entry
                        .metadata()
                        .and_then(|m| m.modified())
                        .ok()
                        .and_then(|modified| now.duration_since(modified).ok())
                        .map(|age| age > stale_age)
                        .unwrap_or(false);
                    if is_stale {
                        let _ = fs::remove_file(entry.path());
                    }
                }
            }
        }
    }
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
        atomic_write, import_document_image, list_markdown_files, open_document, rename_file,
        resolve_image_src, rewrite_wikilink_targets, scan_and_rewrite_wikilinks, save_document,
        sync_wikilinks_on_rename, validate_document_extension, validate_image_asset_path,
        OPEN_EXTENSIONS, WRITE_EXTENSIONS,
    };
    use crate::error::AppError;
    use std::fs;
    use std::path::{Path, PathBuf};
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

    #[tokio::test]
    async fn open_document_returns_content_and_mtime() {
        let dir = test_dir();
        let path = dir.join("demo.md");
        atomic_write(&path, b"# demo").unwrap();

        let result = open_document(path.to_string_lossy().to_string()).await.unwrap();

        assert_eq!(result.content, "# demo");
        assert!(result.last_modified_ms > 0);

        let _ = fs::remove_dir_all(dir);
    }

    #[tokio::test]
    async fn list_markdown_files_returns_sorted_md_names_in_same_dir() {
        let dir = test_dir();
        let doc = dir.join("demo.md");
        atomic_write(&doc, b"# demo").unwrap();
        atomic_write(&dir.join("b.md"), b"").unwrap();
        atomic_write(&dir.join("A.md"), b"").unwrap();
        atomic_write(&dir.join("notes.txt"), b"").unwrap();
        atomic_write(&dir.join("image.png"), b"").unwrap();
        // 子目录里的 .md 不递归列出；恰好名为 ".md" 的文件跳过（target 为空）
        let sub = dir.join("sub");
        fs::create_dir_all(&sub).unwrap();
        atomic_write(&sub.join("c.md"), b"").unwrap();
        atomic_write(&dir.join(".md"), b"").unwrap();

        let names =
            list_markdown_files(doc.to_string_lossy().to_string()).await.unwrap();

        // 大小写不敏感排序：A.md 在 b.md 前；.md/子目录文件/非 md 均不在列。
        // demo.md（当前文档自身）在列——排除自身是前端的职责
        assert_eq!(
            names,
            vec!["A.md".to_string(), "b.md".to_string(), "demo.md".to_string()]
        );

        let _ = fs::remove_dir_all(dir);
    }

    #[tokio::test]
    async fn list_markdown_files_rejects_non_document_extensions() {
        let dir = test_dir();
        let doc = dir.join("demo.exe");
        atomic_write(&doc, b"").unwrap();

        let error = list_markdown_files(doc.to_string_lossy().to_string())
            .await
            .unwrap_err();
        match error {
            AppError::Validation(_) => {}
            other => panic!("expected validation error, got {:?}", other),
        }

        let _ = fs::remove_dir_all(dir);
    }

    #[tokio::test]
    async fn save_document_reports_conflicts() {
        let dir = test_dir();
        let path = dir.join("demo.md");
        atomic_write(&path, b"first").unwrap();
        let opened = open_document(path.to_string_lossy().to_string()).await.unwrap();
        thread::sleep(Duration::from_millis(5));
        atomic_write(&path, b"second").unwrap();

        let error = save_document(
            opened.path.clone(),
            "third".to_string(),
            Some(opened.last_modified_ms),
            false,
        )
        .await
        .unwrap_err();

        match error {
            AppError::Conflict(_) => {}
            other => panic!("expected conflict error, got {:?}", other),
        }

        let _ = fs::remove_dir_all(dir);
    }

    #[tokio::test]
    async fn import_document_image_does_not_overwrite_existing_asset() {
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
        .await
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

    #[tokio::test]
    async fn open_document_rejects_non_document_extension() {
        let dir = test_dir();
        let exe_path = dir.join("payload.exe");
        fs::write(&exe_path, b"MZ").unwrap();

        let error = open_document(exe_path.to_string_lossy().to_string())
            .await
            .unwrap_err();

        match error {
            AppError::Validation(_) => {}
            other => panic!("expected validation error, got {:?}", other),
        }

        let _ = fs::remove_dir_all(dir);
    }

    #[tokio::test]
    async fn save_document_rejects_unexpected_extension_but_allows_theme_json() {
        let dir = test_dir();

        // 写入白名单刻意包含 json：「导出主题模板」复用 save_document（ThemeSelector.vue）
        let json_path = dir.join("theme-template.json");
        save_document(
            json_path.to_string_lossy().to_string(),
            "{\"id\":\"demo\"}".into(),
            None,
            true,
        )
        .await
        .unwrap();
        assert!(json_path.exists());

        let script_path = dir.join("startup.bat");
        let error = save_document(
            script_path.to_string_lossy().to_string(),
            "@echo off".into(),
            None,
            true,
        )
        .await
        .unwrap_err();
        match error {
            AppError::Validation(_) => {}
            other => panic!("expected validation error, got {:?}", other),
        }
        assert!(!script_path.exists());

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn validate_document_extension_is_case_insensitive() {
        assert!(validate_document_extension("C:/docs/README.MD", &OPEN_EXTENSIONS, "打开").is_ok());
        assert!(validate_document_extension("/tmp/notes.Markdown", &OPEN_EXTENSIONS, "打开").is_ok());
        // 无扩展名与未知扩展名一律拒绝
        assert!(validate_document_extension("/tmp/LICENSE", &OPEN_EXTENSIONS, "打开").is_err());
        assert!(validate_document_extension("/tmp/a.sh", &WRITE_EXTENSIONS, "保存").is_err());
    }

    #[test]
    fn write_whitelist_is_read_whitelist_plus_json() {
        // 主题模板导出是 save 独有的合法用例，两处白名单差异必须是有意的
        assert_eq!(OPEN_EXTENSIONS, ["md", "markdown", "txt"]);
        assert_eq!(WRITE_EXTENSIONS, ["md", "markdown", "txt", "json"]);
    }

    #[tokio::test]
    async fn save_document_force_skips_conflict_check() {
        let dir = test_dir();
        let path = dir.join("force.md");
        atomic_write(&path, b"original").unwrap();
        let opened = open_document(path.to_string_lossy().to_string()).await.unwrap();

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
        .await
        .unwrap();

        assert_eq!(result.path, opened.path);

        let _ = fs::remove_dir_all(dir);
    }

    #[tokio::test]
    async fn save_document_creates_parent_directory() {
        let dir = test_dir();
        let nested = dir.join("sub").join("new.md");
        let result = save_document(
            nested.to_string_lossy().to_string(),
            "new file".into(),
            None,
            true,
        )
        .await
        .unwrap();

        assert!(nested.exists());
        assert_eq!(fs::read_to_string(&nested).unwrap(), "new file");
        assert!(result.last_modified_ms > 0);

        let _ = fs::remove_dir_all(dir);
    }

    #[tokio::test]
    async fn rename_file_rejects_empty_name() {
        let dir = test_dir();
        let path = dir.join("old.md");
        atomic_write(&path, b"content").unwrap();

        let err = rename_file(path.to_string_lossy().to_string(), "  ".into()).await.unwrap_err();
        match err {
            AppError::Validation(msg) => assert_eq!(msg, "文件名不能为空"),
            _ => panic!("expected validation error"),
        }

        let _ = fs::remove_dir_all(dir);
    }

    #[tokio::test]
    async fn rename_file_rejects_illegal_chars() {
        let dir = test_dir();
        let path = dir.join("old.md");
        atomic_write(&path, b"content").unwrap();

        let err = rename_file(path.to_string_lossy().to_string(), "a/b".into()).await.unwrap_err();
        match err {
            AppError::Validation(msg) => assert_eq!(msg, "文件名包含非法字符"),
            _ => panic!("expected validation error"),
        }

        let _ = fs::remove_dir_all(dir);
    }

    #[tokio::test]
    async fn rename_file_strips_md_extension_from_new_name() {
        let dir = test_dir();
        let path = dir.join("old.md");
        atomic_write(&path, b"content").unwrap();

        let result = rename_file(path.to_string_lossy().to_string(), "new.md".into()).await.unwrap();

        let expected = dir.join("new.md");
        assert_eq!(result.path, expected.to_string_lossy());
        assert!(expected.exists());

        let _ = fs::remove_dir_all(dir);
    }

    #[tokio::test]
    async fn rename_file_rejects_target_exists() {
        let dir = test_dir();
        let old = dir.join("old.md");
        let target = dir.join("target.md");
        atomic_write(&old, b"old").unwrap();
        atomic_write(&target, b"target").unwrap();

        let err = rename_file(old.to_string_lossy().to_string(), "target".into()).await.unwrap_err();
        match err {
            AppError::Conflict(msg) => assert_eq!(msg, "目标文件已存在"),
            _ => panic!("expected conflict error"),
        }

        let _ = fs::remove_dir_all(dir);
    }

    #[tokio::test]
    async fn rename_file_success() {
        let dir = test_dir();
        let old = dir.join("old.md");
        atomic_write(&old, b"hello").unwrap();

        let result = rename_file(old.to_string_lossy().to_string(), "renamed".into()).await.unwrap();

        let expected = dir.join("renamed.md");
        assert_eq!(result.path, expected.to_string_lossy());
        assert!(!old.exists());
        assert!(expected.exists());
        assert_eq!(fs::read_to_string(&expected).unwrap(), "hello");

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
    fn cleanup_stale_tmp_skips_non_matching_files() {
        let dir = test_dir();
        let doc_path = dir.join("demo.md");
        fs::write(&doc_path, b"# hello").unwrap();

        // 创建一个不匹配模式的 .tmp 文件（不同文件名）
        let other_tmp = dir.join(".other.2000000.tmp");
        fs::write(&other_tmp, b"other").unwrap();

        // 执行清理
        super::cleanup_stale_tmp_files(&doc_path);

        // 不匹配模式的 .tmp 文件不会被删
        assert!(other_tmp.exists(), "non-matching tmp should be kept");

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn cleanup_stale_tmp_deletes_stale_and_keeps_fresh() {
        let dir = test_dir();
        let doc_path = dir.join("demo.md");
        fs::write(&doc_path, b"# hello").unwrap();

        // stale 残留：mtime 设为 2 小时前 → 应删除
        // （tmp 文件名模式与 temp_path 生成格式一致：.{文件名含扩展名}.{毫秒}.tmp）
        let stale_tmp = dir.join(".demo.md.1000000.tmp");
        fs::write(&stale_tmp, b"stale").unwrap();
        set_modified_hours_ago(&stale_tmp, 2);

        // fresh 残留：mtime 当前 → 应保留（双开进程可能正在写入）
        let fresh_tmp = dir.join(".demo.md.1000001.tmp");
        fs::write(&fresh_tmp, b"fresh").unwrap();

        // 匹配前后缀但中间非纯数字 → 应保留
        let bad_num_tmp = dir.join(".demo.md.abc.tmp");
        fs::write(&bad_num_tmp, b"bad").unwrap();

        super::cleanup_stale_tmp_files(&doc_path);

        assert!(!stale_tmp.exists(), "stale tmp (mtime > 1h) should be deleted");
        assert!(fresh_tmp.exists(), "fresh tmp should be kept");
        assert!(bad_num_tmp.exists(), "non-numeric middle part should be kept");

        let _ = fs::remove_dir_all(dir);
    }

    /// 把文件 mtime 设为 N 小时前（FileTimes 稳定于 Rust 1.75+）。
    fn set_modified_hours_ago(path: &Path, hours: u64) {
        use std::fs::FileTimes;

        let file = fs::File::options().write(true).open(path).unwrap();
        let old = SystemTime::now() - Duration::from_secs(hours * 3600);
        file.set_times(FileTimes::new().set_modified(old)).unwrap();
    }

    #[test]
    fn cleanup_stale_tmp_does_not_crash_on_missing_parent() {
        // 路径不存在时应静默跳过
        super::cleanup_stale_tmp_files(Path::new(""));
        super::cleanup_stale_tmp_files(Path::new("\\\\?\\C:\\nonexistent\\path\\file.md"));
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

    // ---- resolve_image_src 规则覆盖（#2 assets/ 守卫 + #3 storage 优先级）----

    #[test]
    fn resolve_image_src_assets_relative_ignores_storage_dir() {
        // 用户设了全局 storage_dir，但 src 以 assets/ 开头 → 强制走文档目录
        // 这是 #2 修复的核心不变量：避免 storage_dir 抢走 assets/ 相对引用
        let doc_path = PathBuf::from("/home/user/notes/demo.md");
        let storage_dir = PathBuf::from("/home/user/.solo/images");

        let (resolved, is_absolute, base_dir) =
            resolve_image_src("assets/diagram.png", Some(doc_path.to_str().unwrap()), Some(storage_dir.to_str().unwrap())).unwrap();

        assert!(!is_absolute);
        assert_eq!(base_dir, Some(PathBuf::from("/home/user/notes")));
        assert_eq!(resolved, PathBuf::from("/home/user/notes/assets/diagram.png"));
    }

    #[test]
    fn resolve_image_src_storage_dir_used_when_no_assets_prefix() {
        // 不以 assets/ 开头 + 有 storage_dir → join 到 storage_dir
        let doc_path = PathBuf::from("/home/user/notes/demo.md");
        let storage_dir = PathBuf::from("/home/user/.solo/images");

        let (resolved, is_absolute, base_dir) =
            resolve_image_src("cat.png", Some(doc_path.to_str().unwrap()), Some(storage_dir.to_str().unwrap())).unwrap();

        assert!(!is_absolute);
        assert_eq!(base_dir, Some(storage_dir.clone()));
        assert_eq!(resolved, storage_dir.join("cat.png"));
    }

    #[test]
    fn resolve_image_src_falls_back_to_document_dir_without_storage() {
        // 无 storage_dir → 走文档目录
        let doc_path = PathBuf::from("/home/user/notes/demo.md");

        let (resolved, is_absolute, base_dir) =
            resolve_image_src("assets/x.png", Some(doc_path.to_str().unwrap()), None).unwrap();

        assert!(!is_absolute);
        assert_eq!(base_dir, Some(PathBuf::from("/home/user/notes")));
        assert_eq!(resolved, PathBuf::from("/home/user/notes/assets/x.png"));
    }

    #[test]
    fn resolve_image_src_absolute_path_passes_through() {
        // 绝对路径 → 直接用，不附任何基目录
        let (resolved, is_absolute, base_dir) =
            resolve_image_src("D:/photos/cat.png", None, None).unwrap();

        assert!(is_absolute);
        assert_eq!(base_dir, None);
        assert_eq!(resolved, PathBuf::from("D:/photos/cat.png"));
    }

    #[test]
    fn resolve_image_src_relative_without_base_dir_errors() {
        // 相对路径但既无 document_path 也无 storage_dir → 报错
        let err = resolve_image_src("assets/x.png", None, None).unwrap_err();
        match err {
            AppError::Validation(msg) => assert!(msg.contains("缺少文档目录")),
            other => panic!("expected validation error, got {:?}", other),
        }
    }

    // ---- 改名后同步互链：rewrite_wikilink_targets（纯函数）+ sync_wikilinks_on_rename ----

    #[test]
    fn rewrite_wikilink_matches_exact_target_not_prefix() {
        // old=笔记：[[笔记]] 改，[[笔记本]] 不动（精确整词，不误伤近名）
        let out = rewrite_wikilink_targets("见 [[笔记]] 与 [[笔记本]]", "笔记", "文章").unwrap();
        assert_eq!(out, "见 [[文章]] 与 [[笔记本]]");
    }

    #[test]
    fn rewrite_wikilink_keeps_alias_and_ignores_plain_link() {
        // 别名段（| 后）原样保留；普通 markdown 链接 [x](y) 不碰
        let out =
            rewrite_wikilink_targets("[[笔记|我的笔记]] 和 [笔记](笔记.md)", "笔记", "文章").unwrap();
        assert_eq!(out, "[[文章|我的笔记]] 和 [笔记](笔记.md)");
    }

    #[test]
    fn rewrite_wikilink_handles_md_suffix_and_multiple_occurrences() {
        // 带 .md 的目标形态也覆盖；同一篇多处链接全部改
        let out = rewrite_wikilink_targets("[[笔记.md]] 见 [[笔记]] 再看 [[笔记]]", "笔记", "文章")
            .unwrap();
        assert_eq!(out, "[[文章.md]] 见 [[文章]] 再看 [[文章]]");
    }

    #[test]
    fn rewrite_wikilink_returns_none_when_no_match() {
        assert!(rewrite_wikilink_targets("正文没有链接", "笔记", "文章").is_none());
    }

    #[tokio::test]
    async fn sync_wikilinks_dry_run_previews_then_apply_writes() {
        let dir = test_dir();
        // 模拟改名已落盘：new.md 已存在；link.md 里有指向旧名 old 的链接
        let new_path = dir.join("new.md");
        atomic_write(&new_path, b"# new").unwrap();
        let link = dir.join("link.md");
        atomic_write(&link, b"see [[old]] here").unwrap();
        // 干扰项：近名 oldbook、普通链接、子目录同名——都不该被动
        atomic_write(&dir.join("near.md"), b"[[oldbook]] and [old](x)").unwrap();
        let sub = dir.join("sub");
        fs::create_dir_all(&sub).unwrap();
        atomic_write(&sub.join("deep.md"), b"[[old]]").unwrap();

        // 旧文件已被 rename 走，无需真实存在（命令只据路径取 stem + 扫同目录）
        let old_str = dir.join("old.md").to_string_lossy().to_string();
        let new_str = new_path.to_string_lossy().to_string();

        // 预览：只报 link.md，且不写盘；子目录不碰
        let preview = sync_wikilinks_on_rename(old_str.clone(), new_str.clone(), true)
            .await
            .unwrap();
        assert_eq!(preview, vec!["link.md".to_string()]);
        assert_eq!(fs::read_to_string(&link).unwrap(), "see [[old]] here");
        assert_eq!(fs::read_to_string(sub.join("deep.md")).unwrap(), "[[old]]");

        // 改写：真正落盘；近名/普通链接/子目录均不受影响
        let changed = sync_wikilinks_on_rename(old_str, new_str, false).await.unwrap();
        assert_eq!(changed, vec!["link.md".to_string()]);
        assert_eq!(fs::read_to_string(&link).unwrap(), "see [[new]] here");
        assert_eq!(
            fs::read_to_string(dir.join("near.md")).unwrap(),
            "[[oldbook]] and [old](x)"
        );
        assert_eq!(fs::read_to_string(sub.join("deep.md")).unwrap(), "[[old]]");

        let _ = fs::remove_dir_all(dir);
    }

    #[tokio::test]
    async fn sync_wikilinks_noop_when_name_unchanged() {
        let dir = test_dir();
        let link = dir.join("link.md");
        atomic_write(&link, b"[[same]]").unwrap();
        // 新旧名相同 → 直接返回空，不扫描不改写
        let p = dir.join("same.md").to_string_lossy().to_string();
        let res = sync_wikilinks_on_rename(p.clone(), p, false).await.unwrap();
        assert!(res.is_empty());
        assert_eq!(fs::read_to_string(&link).unwrap(), "[[same]]");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn rewrite_wikilink_skips_fenced_code_block() {
        // 围栏内的 [[笔记]] 是给人看的示例，不该改；围栏外的真链接才改
        let content =
            "见 [[笔记]] 有效。\n```\n示例 [[笔记]] 不该动\n```\n再来 [[笔记]]\n~~~\n[[笔记]] 也不动\n~~~\n";
        let out = rewrite_wikilink_targets(content, "笔记", "文章").unwrap();
        assert_eq!(
            out,
            "见 [[文章]] 有效。\n```\n示例 [[笔记]] 不该动\n```\n再来 [[文章]]\n~~~\n[[笔记]] 也不动\n~~~\n"
        );
    }

    #[tokio::test]
    async fn sync_wikilinks_skips_the_renamed_file_itself() {
        let dir = test_dir();
        let new_path = dir.join("new.md");
        // 改名后的当前文档：正文含指向自己旧名的自链，也不该被动（用户正在编辑的这篇）
        atomic_write(&new_path, b"see [[old]] and [[new]] here").unwrap();
        let link = dir.join("link.md");
        atomic_write(&link, b"points [[old]]").unwrap();

        let old_str = dir.join("old.md").to_string_lossy().to_string();
        let new_str = new_path.to_string_lossy().to_string();
        let changed = sync_wikilinks_on_rename(old_str, new_str, false)
            .await
            .unwrap();

        assert_eq!(changed, vec!["link.md".to_string()]);
        assert_eq!(
            fs::read_to_string(&new_path).unwrap(),
            "see [[old]] and [[new]] here"
        ); // 自身逐字未动
        assert_eq!(fs::read_to_string(&link).unwrap(), "points [[new]]");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn scan_wikilinks_limits_by_scanned_count() {
        let dir = test_dir();
        atomic_write(&dir.join("new.md"), b"# new").unwrap(); // 当前改名文档，跳过、不计入扫描数
        for f in ["a.md", "b.md", "c.md", "d.md"] {
            atomic_write(&dir.join(f), b"see [[old]]").unwrap();
        }
        // limit=2：只处理 2 个候选（读目录顺序不定，仅断言命中数=2）；证明按"已扫描数"而非"命中数"限流
        let affected = scan_and_rewrite_wikilinks(&dir, "old", "new", "new.md", true, 2);
        assert_eq!(affected.len(), 2);
        // 全量（大 limit）：四个都命中
        let all = scan_and_rewrite_wikilinks(&dir, "old", "new", "new.md", true, 500);
        assert_eq!(all, vec!["a.md", "b.md", "c.md", "d.md"].iter().map(|s| s.to_string()).collect::<Vec<_>>());
        let _ = fs::remove_dir_all(dir);
    }
}
