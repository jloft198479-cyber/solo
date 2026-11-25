use crate::error::AppError;
use crate::models::{
    DocumentImageImportResult, DocumentLayout, DocumentOpenResult, DocumentRenameResult,
    DocumentSaveResult, ImageAssetAuthorizationResult, LineEnding, MarkdownFileList, TextEncoding,
};
use base64::{engine::general_purpose, Engine as _};
use fs2::FileExt;
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

/// 进程内自增序号，参与 `.tmp` 命名（见 `temp_path`）。
static TMP_SEQ: AtomicU32 = AtomicU32::new(0);

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
const DOCUMENT_LOCK_DIR: &str = "document-locks";
const CONTENT_HASH_HEX_LEN: usize = 64;

// 互链作用域的目录层数：当前文档所在目录算第 0 层，向下最多这么多层。
// 2 层覆盖「一个文件夹一个项目」的常见结构（根索引页 → 项目子目录 → 年份子目录）；
// 再深就是 node_modules 一类病态树下场，而补全本身也用不上。
// ⚠️ 三处**必须同值**：列候选（向下递归这么多层）、标红判定（前端 WIKILINK_SCAN_DEPTH，
// 段数超过就不判）、改名后同步入链（**向上**找这么多层引用方，见 `rename_scan_dirs`）。
// 范围不对称会造出「拖进来的能点、敲 [[ 找不到」这类两个入口打架的坑。
const WIKILINK_SCAN_DEPTH: usize = 2;

// 互链相关扫描的数量上限：既是**收集上限**（凑满即停，不问剩余目录），
// 也是改名后同步入链的**扫描上限**（跨层合计）。防 node_modules 一类病态目录拖垮 IPC。
const WIKILINK_SCAN_LIMIT: usize = 500;

// 列候选时一次扫描最多访问多少个目录。与文件上限**互补**：只管文件数挡不住
// 「目录树巨大但 .md 很少」——那种树下每一个空目录都要 read_dir 一次，
// 而早停在文件计数上永远不触发。
// 触发时 `MarkdownFileList::truncated` 会置真，前端据此放弃「失效判定」（宁可漏标不误标）。
const WIKILINK_SCAN_MAX_DIRS: usize = 2000;

/// 一次目录扫描的三个闸门。打包成一个值，让「列候选」和「改名同步」用**同一份**参数，
/// 不靠各处散落的字面量（范围不对称正是 2026-09 那次两个入口打架的根因）。
/// `max_dirs` 只作用于列候选的向下递归；改名同步是平铺扫 ≤3 个目录（`depth` 在那边
/// 表示向上的层数，`max_dirs` 用不上）。
#[derive(Clone, Copy)]
struct ScanBudget {
    depth: usize,
    max_files: usize,
    max_dirs: usize,
}

impl Default for ScanBudget {
    fn default() -> Self {
        Self {
            depth: WIKILINK_SCAN_DEPTH,
            max_files: WIKILINK_SCAN_LIMIT,
            max_dirs: WIKILINK_SCAN_MAX_DIRS,
        }
    }
}

/// 校验文件扩展名在白名单内（大小写不敏感）。
/// 在 IPC 入口把关，避免恶意文档内容诱导前端读写任意类型文件；
/// 本地绝对路径本身是合法用例（用户引用 D:/docs/x.md），故只卡扩展名不做目录约束。
/// 编码不受支持时的可读原因（M-01）。
///
/// 曾用 `fs::read_to_string`（严格 UTF-8）⇒ 记事本「ANSI」另存的 .md 打不开，
/// 且只抛裸 IO 错误，用户不知道是编码问题。此处把「打不开」变成「为什么打不开」。
const ENCODING_ERROR_MSG: &str = "该文件不是 UTF-8 / UTF-16 编码（常见于用记事本以「ANSI」另存的文件）。solo 暂不支持该编码，请先用其它编辑器另存为 UTF-8 后重试";

/// 读取文本并尽量解码（M-01），**同时报出原文的排版习惯**（W1）：
/// - UTF-8 BOM（EF BB BF）→ 去 BOM 后按 UTF-8 解码（BOM 不再漏进正文），encoding = Utf8Bom
/// - UTF-16 LE / BE BOM（FF FE / FE FF）→ 按 UTF-16 解码，encoding = Utf16
/// - 其它 → 严格 UTF-8，encoding = Utf8
///
/// 不猜编码：GBK 一类本地代码页需第三方库才能可靠解码，宁可不支持也不乱解。
///
/// 返回的 `TextEncoding` 只用来回答「原文是不是带 BOM / 是不是 UTF-16」——
/// 保存时据此决定要不要补 BOM（UTF-16 不回写，属于有意归一，见 `encode_with_layout`）。
fn decode_text_with_encoding(bytes: &[u8]) -> Result<(String, TextEncoding), AppError> {
    if let Some(rest) = bytes.strip_prefix(&[0xEFu8, 0xBB, 0xBF]) {
        return String::from_utf8(rest.to_vec())
            .map(|text| (text, TextEncoding::Utf8Bom))
            .map_err(|_| AppError::validation(ENCODING_ERROR_MSG));
    }
    if let Some(rest) = bytes.strip_prefix(&[0xFFu8, 0xFE]) {
        let units: Vec<u16> = rest
            .chunks_exact(2)
            .map(|c| u16::from_le_bytes([c[0], c[1]]))
            .collect();
        return String::from_utf16(&units)
            .map(|text| (text, TextEncoding::Utf16))
            .map_err(|_| AppError::validation(ENCODING_ERROR_MSG));
    }
    if let Some(rest) = bytes.strip_prefix(&[0xFEu8, 0xFF]) {
        let units: Vec<u16> = rest
            .chunks_exact(2)
            .map(|c| u16::from_be_bytes([c[0], c[1]]))
            .collect();
        return String::from_utf16(&units)
            .map(|text| (text, TextEncoding::Utf16))
            .map_err(|_| AppError::validation(ENCODING_ERROR_MSG));
    }

    String::from_utf8(bytes.to_vec())
        .map(|text| (text, TextEncoding::Utf8))
        .map_err(|_| AppError::validation(ENCODING_ERROR_MSG))
}

/// 某一种换行在**解码后**的文本里第一次出现的位置。
/// 单独 LF / 单独 CR 要排除 CRLF 的另一半，否则会把 `\r\n` 重复算成两种。
fn first_occurrence(text: &str, kind: LineEnding) -> Option<usize> {
    let bytes = text.as_bytes();
    match kind {
        LineEnding::Crlf => text.find("\r\n"),
        LineEnding::Cr => {
            (0..bytes.len()).find(|&i| bytes[i] == b'\r' && bytes.get(i + 1) != Some(&b'\n'))
        }
        LineEnding::Lf => {
            (0..bytes.len()).find(|&i| bytes[i] == b'\n' && (i == 0 || bytes[i - 1] != b'\r'))
        }
    }
}

/// 统计排版习惯（纯函数）。必须在解码后的文本上做：UTF-16 的换行在字节层是 `0A 00`，
/// 按字节数会数错。
///
/// 主导换行 = 出现最频繁；平局取文件中**先出现**的那一种；一个换行都没有 → `Lf`。
fn layout_of(text: &str, encoding: TextEncoding) -> DocumentLayout {
    let crlf = text.matches("\r\n").count();
    // 单独 LF / 单独 CR = 总数减去 CRLF 占掉的那一份
    let lf = text.matches('\n').count() - crlf;
    let cr = text.matches('\r').count() - crlf;

    let counts = [
        (LineEnding::Crlf, crlf),
        (LineEnding::Lf, lf),
        (LineEnding::Cr, cr),
    ];
    let mixed = counts.iter().filter(|(_, n)| *n > 0).count() >= 2;

    let mut best: Option<(LineEnding, usize)> = None;
    for (kind, n) in counts {
        if n == 0 {
            continue;
        }
        best = match best {
            None => Some((kind, n)),
            Some((_, best_n)) if n > best_n => Some((kind, n)),
            Some((best_kind, best_n)) if n == best_n => {
                // 平局：谁先出现取谁
                match (first_occurrence(text, kind), first_occurrence(text, best_kind)) {
                    (Some(a), Some(b)) if a < b => Some((kind, n)),
                    _ => Some((best_kind, best_n)),
                }
            }
            kept => kept,
        };
    }

    DocumentLayout {
        encoding,
        ending: best.map(|(kind, _)| kind).unwrap_or(LineEnding::Lf),
        mixed,
    }
}

fn content_hash(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .fold(String::with_capacity(64), |mut hash, byte| {
            hash.push_str(&format!("{byte:02x}"));
            hash
        })
}

fn read_document_with_hash(path: &Path) -> Result<(String, DocumentLayout, String), AppError> {
    let bytes = fs::read(path)?;
    let (text, encoding) = decode_text_with_encoding(&bytes)?;
    let layout = layout_of(&text, encoding);
    let hash = content_hash(&bytes);
    Ok((text, layout, hash))
}

/// 按排版习惯把编辑器文本编码成要落盘的字节（W1）。
///
/// `None` = 不携带布局的调用方（新建文档等）→ 保持历史行为：UTF-8 无 BOM、LF。
/// 有了布局就照它来：`Utf8Bom` 补 BOM；`Crlf` / `Cr` 展开行尾；`Utf16` **不补 BOM**
/// （写 UTF-8 —— 有意归一，不假装还给它 UTF-16）。
fn encode_with_layout(text: &str, layout: Option<&DocumentLayout>) -> Vec<u8> {
    let ending = layout.map(|l| l.ending).unwrap_or(LineEnding::Lf);
    // 编辑器内部恒为 LF。这一步只防脏输入（内容里混进 \r 时避免写出 \r\r\n）。
    let normalized = if text.contains('\r') {
        text.replace("\r\n", "\n").replace('\r', "\n")
    } else {
        text.to_string()
    };
    let body = if ending == LineEnding::Lf {
        normalized
    } else {
        normalized.replace('\n', ending.as_str())
    };

    let mut bytes = Vec::with_capacity(body.len() + 3);
    if matches!(layout.map(|l| l.encoding), Some(TextEncoding::Utf8Bom)) {
        bytes.extend_from_slice(&[0xEF, 0xBB, 0xBF]);
    }
    bytes.extend_from_slice(body.as_bytes());
    bytes
}

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
    let (content, layout, content_hash, last_modified_ms) =
        tauri::async_runtime::spawn_blocking(move || {
            let (content, layout, content_hash) =
                read_document_with_hash(Path::new(&path_for_io))?;
            let last_modified_ms = read_modified_time_ms(Path::new(&path_for_io))?;
            // 兜底清理：同目录下 solo 崩溃残留的 .tmp 文件（静默，不阻塞）
            cleanup_stale_tmp_files(Path::new(&path_for_io));
            Ok::<_, AppError>((content, layout, content_hash, last_modified_ms))
        })
    .await
    .map_err(|e| AppError::Native(format!("任务调度失败: {}", e)))??;

    Ok(DocumentOpenResult {
        path,
        content,
        last_modified_ms,
        content_hash,
        layout,
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

/// 在系统文件管理器中定位当前文档（Windows 资源管理器 / macOS Finder 选中该文件）。
///
/// 路径来自前端 `currentFile.path`；未保存的新文档没有路径，前端直接置灰，不进这里。
/// 先做存在性检查：文件被外部移动/删除时给出可读文案，而不是把插件错误原样甩给用户。
#[tauri::command]
pub fn reveal_document_in_folder(app: AppHandle, path: String) -> Result<(), AppError> {
    use tauri_plugin_opener::OpenerExt;

    if path.trim().is_empty() {
        return Err(AppError::validation("当前文档还没有保存路径"));
    }
    if !Path::new(&path).exists() {
        return Err(AppError::Io("文件已不存在，可能已被移动或删除".into()));
    }
    app.opener()
        .reveal_item_in_dir(path)
        .map_err(|error| AppError::Native(format!("打开文件管理器失败: {error}")))?;
    Ok(())
}

/// 互链 `[[` 补全候选：列出当前文档所在目录**及其下若干层子目录**里的 .md，
/// 返回**相对路径**（`/` 分隔，如 `sub/B.md`），按「层级浅的先、同层按名字」排序。
///
/// - 不递归符号链接 / junction：`DirEntry::file_type()` 不解析链接，`is_dir()` 对链接
///   返回 false ⇒ 天然不跟进，避免目录环与「扫到目录树之外」。
/// - **凑满 `max_files` 立即停**，不问剩余目录：上限同时是性能闸门（旧实现整目录 collect
///   + 全量排序后才截断，1 万文件目录里的开销只被返回值截断、没被工作量截断）。
/// - 目录数另有闸门（`WIKILINK_SCAN_MAX_DIRS`），任一触发都置 `truncated`。
/// - 同目录优先：先收当前层再下探，排序键也把层级放在名字之前 ⇒ 菜单前排永远是
///   最近的文件，跨目录候选只负责补足。
/// - 排除「当前文档自身」由前端做（Rust 不感知「谁是当前文件」的语义，保持命令可复用）。
#[tauri::command]
pub async fn list_markdown_files(path: String) -> Result<MarkdownFileList, AppError> {
    validate_document_extension(&path, &OPEN_EXTENSIONS, "列出")?;
    tauri::async_runtime::spawn_blocking(move || {
        let dir = Path::new(&path)
            .parent()
            .ok_or_else(|| AppError::validation("文档不在任何目录下"))?;
        Ok(collect_markdown_files(dir, ScanBudget::default()))
    })
    .await
    .map_err(|e| AppError::Native(format!("任务调度失败: {}", e)))?
}

/// 递归收集的游标：已访问目录数 + 已收集文件。抽出来只为让递归函数参数保持可读。
struct CollectCursor {
    visited_dirs: usize,
    files: Vec<String>,
}

/// 递归收集 `root` 下的 .md，返回相对路径（统一 `/` 分隔）+ 完整性标志。
/// 同步执行，便于小样本单测（用自定义 `ScanBudget` 验证深度/文件数/目录数三个闸门）。
fn collect_markdown_files(root: &Path, budget: ScanBudget) -> MarkdownFileList {
    let mut cursor = CollectCursor {
        visited_dirs: 0,
        files: Vec::new(),
    };
    collect_markdown_into(root, root, budget.depth, budget, &mut cursor);

    // 完整性必须在排序前判定：排序不改长度，但「第 500 个文件正好是最后一个」与
    // 「还有目录没扫」是两种截断，任一都要置真
    let truncated = cursor.files.len() >= budget.max_files
        || cursor.visited_dirs >= budget.max_dirs;

    let mut files = cursor.files;
    // 层级浅的排前面（同目录候选稳定占前排），同层按名字大小写不敏感。
    // sort_by_cached_key 让 key 只算 N 次（旧实现每次比较两次 to_lowercase）。
    files.sort_by_cached_key(|p| (p.matches('/').count(), p.to_lowercase()));
    MarkdownFileList { files, truncated }
}

fn collect_markdown_into(
    root: &Path,
    dir: &Path,
    depth: usize,
    budget: ScanBudget,
    cursor: &mut CollectCursor,
) {
    if cursor.files.len() >= budget.max_files || cursor.visited_dirs >= budget.max_dirs {
        return;
    }
    cursor.visited_dirs += 1;
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        // 读不了（权限/被删）：跳过这一层，不影响其它目录
        Err(_) => return,
    };
    let mut subdirs: Vec<PathBuf> = Vec::new();
    for entry in entries.flatten() {
        if cursor.files.len() >= budget.max_files {
            break;
        }
        let ft = match entry.file_type() {
            Ok(ft) => ft,
            Err(_) => continue,
        };
        if ft.is_dir() {
            // 深度用完就不再收集子目录（仍然跳过，避免变成文件判断）
            if depth > 0 {
                subdirs.push(entry.path());
            }
            continue;
        }
        if !ft.is_file() {
            continue;
        }
        let name = match entry.file_name().to_str() {
            Some(n) => n.to_string(),
            None => continue,
        };
        // 只列 .md：互链 target 无扩展名时统一补 .md（resolveWikilinkTarget），
        // .markdown 等其他可编辑类型无法被互链指向
        if !name.to_ascii_lowercase().ends_with(".md") || name.len() <= 3 {
            continue;
        }
        let rel = match entry.path().strip_prefix(root).ok().and_then(|p| p.to_str()) {
            Some(rel) => rel.replace('\\', "/"),
            None => continue,
        };
        cursor.files.push(rel);
    }
    for sub in subdirs {
        if cursor.files.len() >= budget.max_files || cursor.visited_dirs >= budget.max_dirs {
            break;
        }
        collect_markdown_into(root, &sub, depth - 1, budget, cursor);
    }
}

fn normalized_absolute_path(path: &Path) -> Result<PathBuf, AppError> {
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()?.join(path)
    };
    let mut normalized = PathBuf::new();
    for component in absolute.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                normalized.pop();
            }
            _ => normalized.push(component.as_os_str()),
        }
    }
    Ok(normalized)
}

fn document_lock_path(lock_root: &Path, path: &Path) -> Result<PathBuf, AppError> {
    let identity = match path.canonicalize() {
        Ok(path) => path,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            normalized_absolute_path(path)?
        }
        Err(error) => return Err(error.into()),
    };
    #[cfg(any(target_os = "windows", target_os = "macos"))]
    let identity = identity.to_string_lossy().to_lowercase();
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    let identity = identity.to_string_lossy().into_owned();

    Ok(lock_root.join(format!("{}.lock", content_hash(identity.as_bytes()))))
}

fn acquire_document_lock(lock_root: &Path, path: &Path) -> Result<fs::File, AppError> {
    fs::create_dir_all(lock_root)?;
    let lock_path = document_lock_path(lock_root, path)?;
    let lock = fs::OpenOptions::new()
        .create(true)
        .read(true)
        .write(true)
        .open(lock_path)?;
    lock.lock_exclusive()?;
    Ok(lock)
}

fn validate_content_hash(hash: &str) -> Result<(), AppError> {
    if hash.len() == CONTENT_HASH_HEX_LEN
        && hash
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        Ok(())
    } else {
        Err(AppError::validation("内容哈希格式无效"))
    }
}

fn save_document_locked(
    path: &Path,
    content: &str,
    expected_content_hash: Option<&str>,
    force: bool,
    layout: Option<&DocumentLayout>,
    lock_root: &Path,
) -> Result<DocumentSaveResult, AppError> {
    if let Some(expected) = expected_content_hash {
        validate_content_hash(expected)?;
    }

    let _lock = acquire_document_lock(lock_root, path)?;

    match (expected_content_hash, force) {
        (Some(expected), _) => {
            let current = match fs::read(path) {
                Ok(bytes) => bytes,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                    return Err(AppError::conflict(
                        "文件已被移动或删除，不会在旧路径重新创建；请重新加载或另存为",
                    ));
                }
                Err(error) => return Err(error.into()),
            };
            if !force && content_hash(&current) != expected {
                return Err(AppError::conflict(
                    "文件已被外部修改，请重新加载或选择强制覆盖",
                ));
            }
        }
        (None, false) => match fs::symlink_metadata(path) {
            Ok(_) => {
                return Err(AppError::conflict("目标文件已存在，未覆盖现有内容"));
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        },
        (None, true) => {}
    }

    let bytes = encode_with_layout(content, layout);
    atomic_write(path, &bytes)?;
    Ok(DocumentSaveResult {
        path: path.to_string_lossy().into_owned(),
        last_modified_ms: read_modified_time_ms(path)?,
        content_hash: content_hash(&bytes),
    })
}

#[tauri::command]
pub async fn save_document(
    app: AppHandle,
    path: String,
    content: String,
    expected_content_hash: Option<String>,
    force: bool,
    layout: Option<DocumentLayout>,
) -> Result<DocumentSaveResult, AppError> {
    validate_document_extension(&path, &WRITE_EXTENSIONS, "保存")?;
    let lock_root = app
        .path()
        .app_local_data_dir()?
        .join(DOCUMENT_LOCK_DIR);
    let path_for_io = path.clone();
    let mut result = tauri::async_runtime::spawn_blocking(move || {
        save_document_locked(
            Path::new(&path_for_io),
            &content,
            expected_content_hash.as_deref(),
            force,
            layout.as_ref(),
            &lock_root,
        )
    })
    .await
    .map_err(|error| AppError::Native(format!("任务调度失败: {error}")))??;
    result.path = path;
    Ok(result)
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

/// 把文档正文里指向被改名文档的互链目标改成新名；无改动返回 `None`。
///
/// `forms` 是「同一篇目标在这篇文档里的**写法**」列表（旧 → 新），由调用方按引用方所在
/// 目录层级算好（见 `wikilink_target_forms`）——这里只认字面、不猜目录，才能防住
/// 「按裸名误改子目录里指向另一篇的链接」（2026-10-20 审核 R-1）。
///
/// 只动 `[[目标]]` 与 `[[目标|别名]]` 的**目标段**（`|` 后的别名原样保留）。
/// 精确整词匹配——目标 `笔记` 时不会误伤 `[[笔记本]]`，也不碰普通链接 `[x](y)`
/// 或正文里出现的同名词。
/// **围栏代码块（``` / ~~~）内的 `[[旧名]]` 一律跳过**——那是给人看的示例、不是真链接
/// （互链目标不含换行，故逐行判定安全）。
/// 已知限制：缩进式代码块与行内代码（单反引号）不在保护范围（误伤需同时满足
/// 「代码里恰好举例写了旧名」+「旧名正是被改名文档」，概率极低，见方案文档）。
fn rewrite_wikilink_targets(content: &str, forms: &[(&str, &str)]) -> Option<String> {
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
            (None, None) => out.push_str(&replace_targets_in_line(line, forms)),
        }
    }
    if out == content {
        None
    } else {
        Some(out)
    }
}

/// 对围栏外的单行做精确目标替换：把 `forms` 里每个旧写法换成新写法，
/// 别名段（`|` 后）原样保留。
///
/// 只认 `[[目标]]` / `[[目标|` 两种收尾，故裸名形态 `[[B]]` 与带后缀形态 `[[B.md]]`
/// 字面不重叠（后者 `B` 之后是 `.`，前者要求紧跟 `]]`），一条行里两种都在也不会改错。
fn replace_targets_in_line(line: &str, forms: &[(&str, &str)]) -> String {
    let mut out = line.to_string();
    for (old_t, new_t) in forms {
        out = out
            .replace(&format!("[[{}]]", old_t), &format!("[[{}]]", new_t))
            .replace(&format!("[[{}|", old_t), &format!("[[{}|", new_t));
    }
    out
}

/// 「同一篇目标在某个引用方目录里会怎么写」的写法对（旧 → 新）。
///
/// `prefix` 是引用方目录到改名文档所在目录的**相对路径前缀**（`/` 分隔，本层为空串，
/// 上一层是 `sub/`，上两层是 `a/sub/`）。互链 target 相对引用方文档存，所以同一篇文档
/// 被不同层级的引用方链接时，字面写法不同，必须逐层算。
///
/// 覆盖的两种写法与解析器口径严格对齐（`wikilink.ts::resolveWikilinkTarget`）：
/// - **带文件全名** `[[B.md]]` / `[[B.markdown]]`：解析器遇带后缀目标原样拼路径 ⇒ 任何
///   可链接的扩展名都能被这样指到；
/// - **去后缀裸名** `[[B]]`：解析器**只补 `.md`** ⇒ 仅当被改名的就是 `.md` 时这种写法
///   才真的指向它。旧实现无条件按裸名匹配，于是 `B.markdown` 改名会把指向
///   `B.md`（往往根本不存在）的链接一起改掉。
///
/// 前提：`rename_file` 保证同目录、同扩展名，只换文件名段 ⇒ 两侧前缀相同。
fn wikilink_target_forms(old_ref: &Path, new_ref: &Path, prefix: &str) -> Vec<(String, String)> {
    let (Some(old_name), Some(new_name)) = (
        old_ref.file_name().and_then(|n| n.to_str()),
        new_ref.file_name().and_then(|n| n.to_str()),
    ) else {
        return Vec::new();
    };
    let mut forms = vec![(
        format!("{prefix}{old_name}"),
        format!("{prefix}{new_name}"),
    )];
    let old_stem = old_ref.file_stem().and_then(|s| s.to_str()).unwrap_or_default();
    let new_stem = new_ref.file_stem().and_then(|s| s.to_str()).unwrap_or_default();
    if !old_stem.is_empty() && !new_stem.is_empty() && old_name.to_ascii_lowercase().ends_with(".md")
    {
        forms.push((
            format!("{prefix}{old_stem}"),
            format!("{prefix}{new_stem}"),
        ));
    }
    forms
}

/// 改名同步要扫的目录：改名文档所在目录 + **向上**最多 `depth` 层，各自带上该层的写法前缀。
///
/// 为什么只往上、不再向下（2026-10-20 审核 R-1 的根因）：互链 target 一律是「相对引用方
/// 文档所在目录、**向下**若干层」的写法（补全与拖入都只产这种，见 `wikilink-suggest.ts` /
/// `wikilink-drop.ts`）。反过来推，能指到 `dir/B.md` 的引用方只可能在 `dir`、`dir` 的父、
/// `dir` 的祖父目录里（深度 2 = `WIKILINK_SCAN_DEPTH`）；更深目录里的文档要指回来必须写
/// `../`，而 `../` 在标红侧已明写「判不了不标」（`wikilink-existence.ts`）、补全也产不出来
/// ⇒ 不属于互链承诺的范围。
/// 之前的向下递归正是事故来源：子目录文档里的 `[[B]]` 指的是**它自己那层的** `B.md`，
/// 按裸名整词替换会把这条好链接改成指向不存在文件的 `[[C]]`，还静默落盘。
fn rename_scan_dirs(dir: &Path, depth: usize) -> Vec<(PathBuf, String)> {
    let mut roots: Vec<(PathBuf, String)> = vec![(dir.to_path_buf(), String::new())];
    let mut segments: Vec<String> = Vec::new();
    let mut current = dir.to_path_buf();
    for _ in 0..depth {
        let Some(seg) = current.file_name().and_then(|n| n.to_str()) else { break };
        let Some(parent) = current.parent() else { break };
        segments.push(seg.to_string());
        // 前缀按「从引用方往下看」的顺序拼：越早压栈的目录名越靠前
        let prefix = segments
            .iter()
            .rev()
            .map(|s| format!("{s}/"))
            .collect::<String>();
        roots.push((parent.to_path_buf(), prefix));
        current = parent.to_path_buf();
    }
    roots
}

/// 改名后同步「指向本文档」的互链：扫描**改名文档所在目录及其上若干层祖先目录**
/// （引用方只可能在这些层，见 `rename_scan_dirs`），按各层真实写法把 `[[旧名]]` 改成 `[[新名]]`。
///
/// 直接改写并返回**已改动文件的绝对路径**（升序；空表示无改动），每个文件走 `atomic_write`
/// （整篇写成功才算数，绝不出现半篇）。
/// **不再先预览让用户确认**（2026-10-20 改）：改名就是要链接跟着走，
/// 弹框问一次用户要么没注意、要么被自动保存打断，答过「先不动」之后就再没有第二次机会，
/// 链接会一直指着旧名且界面毫无提示 —— 实测踩过。代价是这里会改用户没正眼看过的文件，
/// 但改的是「指向被改名文档」的互链目标，本就是改名的自然结果。
///
/// 边界与安全：路径解析全在本函数（从 `old_path` 取所在目录、从两路径取文件名与词干）；
/// **跳过改名后的这篇自身**（按完整路径比对）；只处理扩展名白名单（`OPEN_EXTENSIONS`）内的
/// 文档，按**已扫描文档数**跨层合计限流（`WIKILINK_SCAN_LIMIT`）；改写保护围栏代码块（见
/// `rewrite_wikilink_targets`）；不跟进符号链接（用 `file_type()` 判类型，链接既不跟也不读）。
/// 单个文件读/写失败一律静默跳过，**任何情况都不阻断改名主流程**。
/// 为什么返回绝对路径而不是相对：跨层之后「相对改名文档所在目录」的路径会带 `..`，前端拼完
/// 不做归一就对不上接收方窗口的 `docPath` ⇒ 少一处能算错的换算。
/// 跨窗口若另有窗口正开着被改的文件：前端在改写后广播 `solo:wikilinks-synced`
/// （携带被改路径），那个窗口收到后自行重载（脏态则改提示），本命令不感知窗口；
/// 保存侧另有 mtime 乐观锁兜底。
#[tauri::command]
pub async fn sync_wikilinks_on_rename(
    old_path: String,
    new_path: String,
) -> Result<Vec<String>, AppError> {
    validate_document_extension(&new_path, &OPEN_EXTENSIONS, "同步链接")?;

    let new_ref = Path::new(&new_path);
    let old_ref = Path::new(&old_path);
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
    // 跳过自身用的完整路径（跨目录后不能再按文件名判：子目录里的同名文件是另一篇）
    let self_path = new_ref.to_path_buf();

    // 名字为空或没变（如仅大小写、扩展名不同的等价改名）→ 无需同步
    if old_stem.is_empty() || new_stem.is_empty() || old_stem == new_stem {
        return Ok(Vec::new());
    }

    // 链接是按**旧位置**写的 ⇒ 扫描根与写法前缀都从 old_path 推
    let roots = rename_roots(old_ref, new_ref);
    let affected = tauri::async_runtime::spawn_blocking(move || {
        scan_and_rewrite_wikilinks(&roots, &self_path, ScanBudget::default())
    })
    .await
    .map_err(|e| AppError::Native(format!("任务调度失败: {}", e)))?;

    Ok(affected)
}

/// 改名同步的扫描计划单元：一个目录 + 该目录里的文档指向被改名文档时会用的目标字面。
struct RenameRoot {
    dir: PathBuf,
    forms: Vec<(String, String)>,
}

/// 生成扫描计划（本层 + 向上 `WIKILINK_SCAN_DEPTH` 层）。抽成独立函数便于单测直接拿它跑
/// 小预算，也让「扫哪几层」与「每层怎么写」两件事各自可验。
fn rename_roots(old_ref: &Path, new_ref: &Path) -> Vec<RenameRoot> {
    let Some(dir) = old_ref.parent() else {
        return Vec::new();
    };
    rename_scan_dirs(dir, WIKILINK_SCAN_DEPTH)
        .into_iter()
        .map(|(d, prefix)| RenameRoot {
            forms: wikilink_target_forms(old_ref, new_ref, &prefix),
            dir: d,
        })
        .filter(|root| !root.forms.is_empty())
        .collect()
}

/// 按扫描计划逐层改写，返回**被改动文件的绝对路径**（升序）。
/// 同步执行（由命令包进 `spawn_blocking`）。范围与 `list_markdown_files` 用同一个
/// `ScanBudget` 常量组 —— 三处口径必须一致，否则又造出「补全看得见、改名改不到」这类不对称。
fn scan_and_rewrite_wikilinks(
    roots: &[RenameRoot],
    self_path: &Path,
    budget: ScanBudget,
) -> Vec<String> {
    let mut affected: Vec<String> = Vec::new();
    // `scanned` 跨层合计：上限是「这次改名总共读多少篇」，不是「每层多少篇」
    let mut scanned = 0usize;
    for root in roots {
        if scanned >= budget.max_files {
            break;
        }
        scan_and_rewrite_dir(root, self_path, budget.max_files, &mut scanned, &mut affected);
    }
    affected.sort();
    affected
}

/// 平铺扫一个目录（不递归 —— 递归是 R-1 的来源，见 `rename_scan_dirs`）。
fn scan_and_rewrite_dir(
    root: &RenameRoot,
    self_path: &Path,
    limit: usize,
    scanned: &mut usize,
    affected: &mut Vec<String>,
) {
    let entries = match fs::read_dir(&root.dir) {
        Ok(entries) => entries,
        // 目录读不了（被删/权限）：静默跳过，不报错、不阻断改名
        Err(_) => return,
    };
    // 写法对取一次 &str 视图，避免每行重建 String
    let forms: Vec<(&str, &str)> = root
        .forms
        .iter()
        .map(|(old, new)| (old.as_str(), new.as_str()))
        .collect();
    for entry in entries.flatten() {
        if *scanned >= limit {
            return;
        }
        let path = entry.path();
        let ft = match entry.file_type() {
            Ok(ft) => ft,
            Err(_) => continue,
        };
        if !ft.is_file() {
            continue;
        }
        // 跳过正在改名的这篇自身：它的内存态/基线此刻正被编辑器持有，改写会被下次保存回写。
        // 按**完整路径**比而不是文件名——同名文件在别的目录就是另一篇，该处理的处理。
        if path.as_path() == self_path {
            continue;
        }
        let name = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) => n.to_string(),
            None => continue,
        };
        // 只碰可编辑文档类型（扩展名闸门），防越权读写任意文件
        if validate_document_extension(&name, &OPEN_EXTENSIONS, "同步链接").is_err() {
            continue;
        }
        *scanned += 1;
        let content = match fs::read_to_string(&path) {
            Ok(c) => c,
            // 非 UTF-8 / 权限等读失败：跳过这一个，继续处理其它文件
            Err(_) => continue,
        };
        if let Some(updated) = rewrite_wikilink_targets(&content, &forms) {
            // 写失败则跳过（不计入 affected）
            if atomic_write(&path, updated.as_bytes()).is_err() {
                continue;
            }
            affected.push(path.to_string_lossy().to_string());
        }
    }
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

        // 生成唯一文件名：pasted-image-{毫秒}.{pid}.{序号}.ext
        // 连字符而非空格：`Pasted image xxx.png` 里的空格在 Markdown 链接语法中
        // 需要尖括号包裹才能落盘（历史版本曾因此丢图），新文件从源头消灭空格。
        // pid + 进程内原子序号与 temp_path 同法（#39）：双窗口同毫秒粘贴曾会撞
        // 同一个名字——unique_asset_target 的 exists 检查与 fs::write 之间有窗口，
        // 后写覆盖先写（一篇的图变成另一篇的，审计 R-6）；掺入后碰撞面归零。
        let timestamp_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0);
        let base_name = format!(
            "pasted-image-{}-{}-{}",
            timestamp_ms,
            std::process::id(),
            TMP_SEQ.fetch_add(1, Ordering::Relaxed)
        );
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
/// 匹配模式 `.{原文件名}.{毫秒}.{pid}.tmp`，只删 mtime 超过 1h 的残留，
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
            // 提取中间部分：.{file_name}.{millis}.{pid}.tmp —— 各段必须全为数字
            // （带 PID 后中间是「数字.数字」，故按 '.' 分段逐段校验）
            let middle = &name[prefix.len()..];
            if let Some(stem) = middle.strip_suffix(".tmp") {
                let ours = !stem.is_empty()
                    && stem
                        .split('.')
                        .all(|seg| !seg.is_empty() && seg.bytes().all(|b| b.is_ascii_digit()));
                if ours {
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
    // 命名 .{名}.{毫秒}.{pid}.{序号}.tmp：
    // - PID 防「双开进程」同毫秒撞名（M-45）；
    // - 序号防「同进程多窗口」撞名——一个进程可有多窗口（lib.rs create_editor_window），
    //   PID 相同，同毫秒保存同一文件时后者 File::create 会截断前者正在写的 tmp。
    // 序号段同样是纯数字，cleanup_stale_tmp_files 的「各段全数字」识别不受影响。
    let seq = TMP_SEQ.fetch_add(1, Ordering::Relaxed);
    path.with_file_name(format!(
        ".{}.{}.{}.{}.tmp",
        file_name,
        millis,
        std::process::id(),
        seq
    ))
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
        acquire_document_lock, atomic_write, collect_markdown_files, content_hash,
        document_lock_path, encode_with_layout, import_document_image, layout_of,
        list_markdown_files, open_document, read_document_with_hash, rename_file, rename_roots,
        rename_scan_dirs, resolve_image_src, rewrite_wikilink_targets, save_document_locked,
        scan_and_rewrite_wikilinks, sync_wikilinks_on_rename, validate_document_extension,
        validate_image_asset_path, wikilink_target_forms, ScanBudget, OPEN_EXTENSIONS,
        WRITE_EXTENSIONS,
    };
    use crate::error::AppError;
    use crate::models::{DocumentLayout, DocumentSaveResult, LineEnding, TextEncoding};
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::thread;
    use std::time::{Duration, SystemTime, UNIX_EPOCH};

    fn read_text_with_layout(path: &Path) -> Result<(String, DocumentLayout), AppError> {
        read_document_with_hash(path).map(|(text, layout, _)| (text, layout))
    }

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

    async fn save_document_for_test(
        path: String,
        content: String,
        expected_content_hash: Option<String>,
        force: bool,
        layout: Option<DocumentLayout>,
    ) -> Result<DocumentSaveResult, AppError> {
        validate_document_extension(&path, &WRITE_EXTENSIONS, "保存")?;
        let lock_dir = test_dir();
        let result = save_document_locked(
            Path::new(&path),
            &content,
            expected_content_hash.as_deref(),
            force,
            layout.as_ref(),
            &lock_dir,
        );
        let _ = fs::remove_dir_all(lock_dir);
        result
    }

    // ── 读入侧：解码 + 排版习惯（阶段 0 钉子 → W1 起读入即记录 layout）──────
    // 这四条兼作 W1 的输入前提：W1 要回写 BOM / 换行，前提就是读入侧确实把原文
    // 送进来了、且只剥了 BOM 没动换行，并如实报出它是哪一种。

    #[test]
    fn read_text_file_keeps_lf_untouched() {
        let dir = test_dir();
        let path = dir.join("lf.md");
        atomic_write(&path, b"# a\n\nb\n").unwrap();

        let (text, layout) = read_text_with_layout(&path).unwrap();
        assert_eq!(text, "# a\n\nb\n");
        assert_eq!(layout.encoding, TextEncoding::Utf8);
        assert_eq!(layout.ending, LineEnding::Lf);
        assert!(!layout.mixed);

        let _ = fs::remove_dir_all(dir);
    }

    /// CRLF 必须原样出来。归一发生在 markdown-it（前端），Rust 不碰——
    /// 这是「主导换行统计」能读到真实值的唯一前提。
    #[test]
    fn read_text_file_keeps_crlf_untouched() {
        let dir = test_dir();
        let path = dir.join("crlf.md");
        atomic_write(&path, b"# a\r\n\r\nb\r\n").unwrap();

        let (text, layout) = read_text_with_layout(&path).unwrap();
        assert_eq!(text, "# a\r\n\r\nb\r\n");
        assert_eq!(layout.encoding, TextEncoding::Utf8);
        assert_eq!(layout.ending, LineEnding::Crlf);
        assert!(!layout.mixed);

        let _ = fs::remove_dir_all(dir);
    }

    /// UTF-8 BOM 仍从正文剥掉（BOM 不能漏进正文），但**现在被记进 layout**，
    /// 保存时据此补回来。
    #[test]
    fn read_text_file_strips_utf8_bom_and_records_it() {
        let dir = test_dir();
        let path = dir.join("bom.md");
        let mut bytes = vec![0xEFu8, 0xBB, 0xBF];
        bytes.extend_from_slice(b"# a\n");
        atomic_write(&path, &bytes).unwrap();

        let (text, layout) = read_text_with_layout(&path).unwrap();
        assert_eq!(text, "# a\n");
        assert_eq!(layout.encoding, TextEncoding::Utf8Bom);
        assert_eq!(layout.ending, LineEnding::Lf);

        let _ = fs::remove_dir_all(dir);
    }

    /// UTF-16 LE（记事本「Unicode」另存）会被解码成普通字符串，layout 标 Utf16。
    /// 保存时**不回写 UTF-16**（有意归一为 UTF-8），但至少不再假装不认识它。
    #[test]
    fn read_text_file_decodes_utf16le() {
        let dir = test_dir();
        let path = dir.join("utf16.md");
        let mut bytes = vec![0xFFu8, 0xFE];
        for unit in "# a\n".encode_utf16() {
            bytes.extend_from_slice(&unit.to_le_bytes());
        }
        atomic_write(&path, &bytes).unwrap();

        let (text, layout) = read_text_with_layout(&path).unwrap();
        assert_eq!(text, "# a\n");
        assert_eq!(layout.encoding, TextEncoding::Utf16);

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn layout_of_counts_dominant_ending_and_mixed() {
        assert_eq!(
            layout_of("a\nb\n", TextEncoding::Utf8).ending,
            LineEnding::Lf
        );
        assert_eq!(
            layout_of("a\r\nb\r\n", TextEncoding::Utf8).ending,
            LineEnding::Crlf
        );
        assert_eq!(
            layout_of("a\rb\r", TextEncoding::Utf8).ending,
            LineEnding::Cr
        );
        // 无换行 → LF（默认，不因缺失而改行为）
        assert_eq!(layout_of("abc", TextEncoding::Utf8).ending, LineEnding::Lf);

        // 混合：CRLF 更多 → 主导 CRLF，mixed 真
        let l = layout_of("a\r\nb\r\nc\n", TextEncoding::Utf8);
        assert_eq!(l.ending, LineEnding::Crlf);
        assert!(l.mixed);

        // 平局取「文件中先出现」的那一种
        assert_eq!(
            layout_of("a\nb\r\n", TextEncoding::Utf8).ending,
            LineEnding::Lf
        );
        assert_eq!(
            layout_of("a\r\nb\n", TextEncoding::Utf8).ending,
            LineEnding::Crlf
        );
    }

    #[test]
    fn encode_with_layout_restores_ending_and_bom() {
        // 无布局 ⇒ 历史行为（UTF-8 无 BOM、LF）
        assert_eq!(encode_with_layout("a\nb\n", None), b"a\nb\n".to_vec());

        let crlf = DocumentLayout {
            encoding: TextEncoding::Utf8,
            ending: LineEnding::Crlf,
            mixed: false,
        };
        assert_eq!(encode_with_layout("a\nb\n", Some(&crlf)), b"a\r\nb\r\n".to_vec());

        let bom = DocumentLayout {
            encoding: TextEncoding::Utf8Bom,
            ending: LineEnding::Lf,
            mixed: false,
        };
        assert_eq!(encode_with_layout("a\n", Some(&bom)), b"\xEF\xBB\xBFa\n".to_vec());

        // UTF-16 不回写：写 UTF-8 无 BOM（有意归一）
        let utf16 = DocumentLayout {
            encoding: TextEncoding::Utf16,
            ending: LineEnding::Lf,
            mixed: false,
        };
        assert_eq!(encode_with_layout("a\n", Some(&utf16)), b"a\n".to_vec());

        // 脏输入（内容里混进 \r）不会写出 \r\r\n
        assert_eq!(encode_with_layout("a\r\nb", Some(&crlf)), b"a\r\nb".to_vec());
    }

    /// 端到端：CRLF 文件改一个字再存 → 盘上仍是 CRLF（W1 的靶子）。
    #[tokio::test]
    async fn save_document_keeps_crlf_file_crlf() {
        let dir = test_dir();
        let path = dir.join("crlf.md");
        atomic_write(&path, b"# a\r\n\r\nb\r\n").unwrap();

        let (_, layout) = read_text_with_layout(&path).unwrap();
        let expected_hash = content_hash(&fs::read(&path).unwrap());
        // 编辑器产物恒为 LF
        save_document_for_test(
            path.to_string_lossy().to_string(),
            "# a\n\nb 改了一个字\n".to_string(),
            Some(expected_hash),
            false,
            Some(layout),
        )
        .await
        .unwrap();

        assert_eq!(fs::read(&path).unwrap(), b"# a\r\n\r\nb \xe6\x94\xb9\xe4\xba\x86\xe4\xb8\x80\xe4\xb8\xaa\xe5\xad\x97\r\n");
        let _ = fs::remove_dir_all(dir);
    }

    /// 端到端：带 BOM 的文件改字再存 → BOM 还在。
    #[tokio::test]
    async fn save_document_writes_bom_back() {
        let dir = test_dir();
        let path = dir.join("bom.md");
        let mut bytes = vec![0xEFu8, 0xBB, 0xBF];
        bytes.extend_from_slice(b"# a\n");
        atomic_write(&path, &bytes).unwrap();

        let (_, layout) = read_text_with_layout(&path).unwrap();
        let expected_hash = content_hash(&fs::read(&path).unwrap());
        save_document_for_test(
            path.to_string_lossy().to_string(),
            "# a\nb\n".to_string(),
            Some(expected_hash),
            false,
            Some(layout),
        )
        .await
        .unwrap();

        let saved = fs::read(&path).unwrap();
        assert_eq!(saved, b"\xEF\xBB\xBF# a\nb\n");
        let _ = fs::remove_dir_all(dir);
    }

    /// **W1 端到端验收**：完全按前端的调用顺序与参数形状走一遍——
    /// `open_document` → layout 序列化成 JSON（这才是 IPC 真正传的东西）→ 反序列化 →
    /// 改一个字（编辑器产物是 LF 全文）→ `save_document` → 比对盘上字节。
    ///
    /// 造的是「记事本另存」的典型形态：UTF-8 BOM + CRLF 换行 + 中文。
    #[tokio::test]
    async fn w1_end_to_end_frontend_json_roundtrip() {
        let dir = test_dir();
        let path = dir.join("notepad.md");
        let mut original = vec![0xEFu8, 0xBB, 0xBF];
        original.extend_from_slice("# 标题\r\n\r\n正文一行\r\n".as_bytes());
        atomic_write(&path, &original).unwrap();

        // ① 打开：内容与排版习惯一起回来
        let opened = open_document(path.to_string_lossy().to_string())
            .await
            .unwrap();
        assert_eq!(opened.content, "# 标题\r\n\r\n正文一行\r\n");
        assert_eq!(opened.layout.encoding, TextEncoding::Utf8Bom);
        assert_eq!(opened.layout.ending, LineEnding::Crlf);
        assert!(!opened.layout.mixed);

        // ② 前端存进 FileState.layout，保存时经 IPC 传回（JSON 往返 = 真实形状）
        let ipc = serde_json::to_string(&opened.layout).unwrap();
        println!("[W1] IPC 传回的 layout = {}", ipc);
        let layout: DocumentLayout = serde_json::from_str(&ipc).unwrap();

        // ③ 用户改了一个字：编辑器序列化产物恒为 LF 全文
        let edited = "# 标题\n\n正文改了一个字\n";

        // ④ 保存
        save_document_for_test(
            path.to_string_lossy().to_string(),
            edited.to_string(),
            Some(opened.content_hash.clone()),
            false,
            Some(layout),
        )
        .await
        .unwrap();

        // ⑤ 盘上：暗号还在、折法还是 Windows 的、只有那个词变了
        let saved = fs::read(&path).unwrap();
        let mut expected = vec![0xEFu8, 0xBB, 0xBF];
        expected.extend_from_slice("# 标题\r\n\r\n正文改了一个字\r\n".as_bytes());
        println!(
            "[W1] 原始 {} 字节 / 保存后 {} 字节",
            original.len(),
            saved.len()
        );
        assert_eq!(saved, expected);
        // 没有任何「裸 LF」：每个 \n 前面都必须是 \r
        for i in 0..saved.len() {
            if saved[i] == b'\n' {
                assert!(
                    i > 0 && saved[i - 1] == b'\r',
                    "第 {} 字节是裸 LF，换行没还原",
                    i
                );
            }
        }

        let _ = fs::remove_dir_all(dir);
    }

    /// 端到端：不带 layout（新建文档等）→ 历史行为不变，仍是 UTF-8 无 BOM、LF。
    #[tokio::test]
    async fn save_document_without_layout_keeps_legacy_behavior() {
        let dir = test_dir();
        let path = dir.join("new.md");
        atomic_write(&path, b"").unwrap();

        save_document_for_test(
            path.to_string_lossy().to_string(),
            "# new\n".to_string(),
            Some(content_hash(b"")),
            false,
            None,
        )
        .await
        .unwrap();

        assert_eq!(fs::read(&path).unwrap(), b"# new\n");
        let _ = fs::remove_dir_all(dir);
    }

    #[tokio::test]
    async fn open_document_reports_sha256_of_original_bytes() {
        let fixtures: &[(&[u8], &str)] = &[
            (b"# demo", "1a8a2cb5db6432f94ba888a7e2d2c2c025073fedcd24813d5f68cff83ae0c326"),
            (
                b"\xEF\xBB\xBF# demo\r\n",
                "bc9d1ed8b31646130a6345ce60f4a7d05a4098d79865183d2b55711b78f25b88",
            ),
            (
                b"\xFF\xFE#\x00 \x00d\x00e\x00m\x00o\x00\r\x00\n\x00",
                "5bb1a48cd47539302515f9219d87162893d779c952906abf485e5101018d2331",
            ),
        ];

        for (bytes, expected_hash) in fixtures {
            let dir = test_dir();
            let path = dir.join("demo.md");
            atomic_write(&path, bytes).unwrap();

            let opened = open_document(path.to_string_lossy().to_string())
                .await
                .unwrap();

            assert_eq!(opened.content_hash, *expected_hash);
            let _ = fs::remove_dir_all(dir);
        }
    }

    #[tokio::test]
    async fn ordinary_save_compares_raw_bytes_even_when_mtime_is_unchanged() {
        let fixtures: &[(&[u8], &[u8])] = &[
            (b"first", b"other"),
            (b"\xEF\xBB\xBFsame", b"same"),
            (b"same\r\n", b"same\n"),
            (
                b"\xFF\xFEs\x00a\x00m\x00e\x00",
                b"same",
            ),
        ];

        for (baseline, external) in fixtures {
            let dir = test_dir();
            let path = dir.join("demo.md");
            let lock_root = dir.join("locks");
            atomic_write(&path, baseline).unwrap();
            let opened = open_document(path.to_string_lossy().to_string())
                .await
                .unwrap();
            let modified = fs::metadata(&path).unwrap().modified().unwrap();

            atomic_write(&path, external).unwrap();
            fs::File::options()
                .write(true)
                .open(&path)
                .unwrap()
                .set_times(fs::FileTimes::new().set_modified(modified))
                .unwrap();
            assert_eq!(
                crate::document::read_modified_time_ms(&path).unwrap(),
                opened.last_modified_ms,
            );

            let error = save_document_locked(
                &path,
                "edited",
                Some(&opened.content_hash),
                false,
                None,
                &lock_root,
            )
            .unwrap_err();

            assert!(matches!(error, AppError::Conflict(_)), "{error:?}");
            assert_eq!(fs::read(&path).unwrap(), *external);
            let _ = fs::remove_dir_all(dir);
        }
    }

    #[test]
    fn concurrent_ordinary_saves_with_different_outputs_allow_exactly_one() {
        let dir = test_dir();
        let path = dir.join("race.md");
        let lock_root = dir.join("locks");
        let baseline = b"baseline";
        let expected_hash = content_hash(baseline);

        for _ in 0..12 {
            atomic_write(&path, baseline).unwrap();
            let barrier = std::sync::Barrier::new(8);
            let successes = std::thread::scope(|scope| {
                let handles: Vec<_> = (0..8)
                    .map(|index| {
                        let path = path.clone();
                        let lock_root = lock_root.clone();
                        let expected_hash = expected_hash.clone();
                        let barrier = &barrier;
                        scope.spawn(move || {
                            barrier.wait();
                            save_document_locked(
                                &path,
                                &format!("writer-{index}"),
                                Some(&expected_hash),
                                false,
                                None,
                                &lock_root,
                            )
                        })
                    })
                    .collect();
                handles
                    .into_iter()
                    .filter_map(|handle| handle.join().unwrap().ok())
                    .count()
            });

            assert_eq!(successes, 1, "同一磁盘基线只能被一个并发保存覆盖");
            let written = fs::read_to_string(&path).unwrap();
            assert!(written.starts_with("writer-"));
            assert_ne!(written, "baseline");
        }

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn concurrent_identical_saves_are_idempotent() {
        let dir = test_dir();
        let path = dir.join("same.md");
        let lock_root = dir.join("locks");
        atomic_write(&path, b"same").unwrap();
        let expected_hash = content_hash(b"same");
        let barrier = std::sync::Barrier::new(2);

        let results = std::thread::scope(|scope| {
            let handles: Vec<_> = (0..2)
                .map(|_| {
                    let path = path.clone();
                    let lock_root = lock_root.clone();
                    let expected_hash = expected_hash.clone();
                    let barrier = &barrier;
                    scope.spawn(move || {
                        barrier.wait();
                        save_document_locked(
                            &path,
                            "same",
                            Some(&expected_hash),
                            false,
                            None,
                            &lock_root,
                        )
                    })
                })
                .collect();
            handles
                .into_iter()
                .map(|handle| handle.join().unwrap())
                .collect::<Vec<_>>()
        });

        assert!(results.iter().all(Result::is_ok), "{results:?}");
        assert_eq!(fs::read(&path).unwrap(), b"same");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn force_overwrites_existing_target_but_never_recreates_missing_target() {
        let dir = test_dir();
        let path = dir.join("force.md");
        let lock_root = dir.join("locks");
        atomic_write(&path, b"external").unwrap();
        let expected_hash = content_hash(b"baseline");

        let saved = save_document_locked(
            &path,
            "forced",
            Some(&expected_hash),
            true,
            None,
            &lock_root,
        )
        .unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"forced");
        assert_eq!(saved.content_hash, content_hash(b"forced"));

        fs::remove_file(&path).unwrap();
        let error = save_document_locked(
            &path,
            "forced-again",
            Some(&expected_hash),
            true,
            None,
            &lock_root,
        )
        .unwrap_err();
        assert!(matches!(error, AppError::Conflict(_)), "{error:?}");
        assert!(!path.exists());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn ordinary_save_without_expected_hash_fails_closed() {
        let dir = test_dir();
        let path = dir.join("demo.md");
        let lock_root = dir.join("locks");
        atomic_write(&path, b"baseline").unwrap();

        let error = save_document_locked(
            &path,
            "overwrite",
            None,
            false,
            None,
            &lock_root,
        )
        .unwrap_err();

        assert!(matches!(error, AppError::Conflict(_)), "{error:?}");
        assert_eq!(fs::read(&path).unwrap(), b"baseline");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn create_only_save_never_overwrites_a_racing_creator() {
        let dir = test_dir();
        let path = dir.join("new.md");
        let lock_root = dir.join("locks");
        let barrier = std::sync::Barrier::new(2);

        let successes = std::thread::scope(|scope| {
            let handles: Vec<_> = (0..2)
                .map(|index| {
                    let path = path.clone();
                    let lock_root = lock_root.clone();
                    let barrier = &barrier;
                    scope.spawn(move || {
                        barrier.wait();
                        save_document_locked(
                            &path,
                            &format!("creator-{index}"),
                            None,
                            false,
                            None,
                            &lock_root,
                        )
                    })
                })
                .collect();
            handles
                .into_iter()
                .filter_map(|handle| handle.join().unwrap().ok())
                .count()
        });

        assert_eq!(successes, 1);
        let written = fs::read_to_string(&path).unwrap();
        assert!(written.starts_with("creator-"));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn legacy_force_save_can_still_create_and_overwrite() {
        let dir = test_dir();
        let path = dir.join("legacy.md");
        let lock_root = dir.join("locks");

        save_document_locked(&path, "first", None, true, None, &lock_root).unwrap();
        save_document_locked(&path, "second", None, true, None, &lock_root).unwrap();

        assert_eq!(fs::read(&path).unwrap(), b"second");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn document_lock_contends_across_processes_with_different_temp_dirs() {
        use std::io::BufRead;

        let dir = test_dir();
        let path = dir.join("locked.md");
        let lock_root = dir.join("locks");
        atomic_write(&path, b"baseline").unwrap();
        let expected_hash = content_hash(b"baseline");
        let lock = acquire_document_lock(&lock_root, &path).unwrap();

        let child_temp = dir.join("child-temp");
        fs::create_dir_all(&child_temp).unwrap();
        let mut child = std::process::Command::new(std::env::current_exe().unwrap())
            .arg("--exact")
            .arg("commands::document::tests::cross_process_lock_child")
            .arg("--ignored")
            .arg("--nocapture")
            .env("SOLO_TEST_LOCK_ROOT", &lock_root)
            .env("SOLO_TEST_TARGET", &path)
            .env("SOLO_TEST_EXPECTED_HASH", &expected_hash)
            .env("TMP", &child_temp)
            .env("TEMP", &child_temp)
            .env("TMPDIR", &child_temp)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .unwrap();

        let mut ready = String::new();
        loop {
            ready.clear();
            let read = std::io::BufReader::new(child.stdout.as_mut().unwrap())
                .read_line(&mut ready)
                .unwrap();
            if read == 0 || ready.trim() == "BLOCKED" {
                break;
            }
        }
        atomic_write(&path, b"external").unwrap();
        drop(lock);

        let output = child.wait_with_output().unwrap();
        assert!(
            output.status.success() && ready.trim() == "BLOCKED",
            "cross-process lock child failed:\nready: {ready:?}\n{}\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr),
        );
        assert_eq!(fs::read(&path).unwrap(), b"external");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    #[ignore = "由 document_lock_contends_across_processes_with_different_temp_dirs 启动"]
    fn cross_process_lock_child() {
        use fs2::FileExt;
        use std::io::Write;

        let (Some(lock_root), Some(target), Ok(expected_hash)) = (
            std::env::var_os("SOLO_TEST_LOCK_ROOT"),
            std::env::var_os("SOLO_TEST_TARGET"),
            std::env::var("SOLO_TEST_EXPECTED_HASH"),
        ) else {
            return;
        };

        std::io::stdout().flush().unwrap();
        println!("READY");
        std::io::stdout().flush().unwrap();

        let target = PathBuf::from(target);
        let lock_root = PathBuf::from(lock_root);
        let lock_path = document_lock_path(&lock_root, &target).unwrap();
        let contender = fs::OpenOptions::new()
            .read(true)
            .write(true)
            .open(lock_path)
            .unwrap();
        assert!(contender.try_lock_exclusive().is_err());
        println!("BLOCKED");
        std::io::stdout().flush().unwrap();
        drop(contender);

        let result = save_document_locked(
            &target,
            "child",
            Some(&expected_hash),
            false,
            None,
            &lock_root,
        );
        assert!(matches!(result, Err(AppError::Conflict(_))), "{result:?}");
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
    async fn list_markdown_files_returns_relative_paths_with_subdirs() {
        let dir = test_dir();
        let doc = dir.join("demo.md");
        atomic_write(&doc, b"# demo").unwrap();
        atomic_write(&dir.join("b.md"), b"").unwrap();
        atomic_write(&dir.join("A.md"), b"").unwrap();
        atomic_write(&dir.join("notes.txt"), b"").unwrap();
        atomic_write(&dir.join("image.png"), b"").unwrap();
        // 子目录递归列出，路径用 `/` 分隔；恰好名为 ".md" 的文件跳过（target 为空）
        let sub = dir.join("sub");
        fs::create_dir_all(&sub).unwrap();
        atomic_write(&sub.join("c.md"), b"").unwrap();
        atomic_write(&dir.join(".md"), b"").unwrap();

        let list = list_markdown_files(doc.to_string_lossy().to_string())
            .await
            .unwrap();

        // 同层按名字（大小写不敏感）排在前面，子目录候选排在后面（层级浅者优先）。
        // demo.md（当前文档自身）在列——排除自身是前端的职责
        assert_eq!(
            list.files,
            vec![
                "A.md".to_string(),
                "b.md".to_string(),
                "demo.md".to_string(),
                "sub/c.md".to_string(),
            ]
        );
        assert!(!list.truncated, "没触发任何闸门时不得报「清单不完整」");

        let _ = fs::remove_dir_all(dir);
    }

    #[tokio::test]
    async fn list_markdown_files_stops_at_depth_limit() {
        let dir = test_dir();
        let doc = dir.join("a.md");
        atomic_write(&doc, b"").unwrap();
        fs::create_dir_all(dir.join("l1")).unwrap();
        atomic_write(&dir.join("l1").join("b.md"), b"").unwrap();
        fs::create_dir_all(dir.join("l1/l2")).unwrap();
        atomic_write(&dir.join("l1/l2/c.md"), b"").unwrap();
        // 第 3 层超出 WIKILINK_SCAN_DEPTH(2) —— 不能出现在候选里
        fs::create_dir_all(dir.join("l1/l2/l3")).unwrap();
        atomic_write(&dir.join("l1/l2/l3/d.md"), b"").unwrap();

        let list = list_markdown_files(doc.to_string_lossy().to_string())
            .await
            .unwrap();

        assert_eq!(
            list.files,
            vec![
                "a.md".to_string(),
                "l1/b.md".to_string(),
                "l1/l2/c.md".to_string(),
            ],
            "深度上限外的文件不该进入候选（范围必须与前端标红判定同深度）"
        );

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn collect_markdown_files_stops_at_limit() {
        let dir = test_dir();
        for i in 0..5 {
            atomic_write(&dir.join(format!("f{}.md", i)), b"").unwrap();
        }

        let list = collect_markdown_files(
            &dir,
            ScanBudget {
                max_files: 3,
                ..Default::default()
            },
        );

        // 凑满上限即停：长度不超上限（早停的意义是「不问剩余目录」，不再是收完再截断）
        assert_eq!(list.files.len(), 3);
        assert!(list.truncated, "触发文件闸门必须标「清单不完整」——前端据此不判死链");
        for name in &list.files {
            assert!(name.ends_with(".md"));
        }

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn collect_markdown_files_stops_at_dir_budget() {
        let dir = test_dir();
        atomic_write(&dir.join("root.md"), b"").unwrap();
        for sub in ["a", "b", "c"] {
            fs::create_dir_all(dir.join(sub)).unwrap();
            atomic_write(&dir.join(sub).join("x.md"), b"").unwrap();
        }

        // 只允许访问 1 个目录 → 只收到根目录那一层
        let list = collect_markdown_files(
            &dir,
            ScanBudget {
                max_dirs: 1,
                ..Default::default()
            },
        );

        assert_eq!(list.files, vec!["root.md".to_string()]);
        assert!(
            list.truncated,
            "目录闸门触发同样是「清单不完整」——只管文件数挡不住空目录树"
        );

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn collect_markdown_files_prefers_shallow_entries() {
        let dir = test_dir();
        fs::create_dir_all(dir.join("aaa")).unwrap();
        atomic_write(&dir.join("aaa").join("z.md"), b"").unwrap();
        atomic_write(&dir.join("zzz.md"), b"").unwrap();

        let list = collect_markdown_files(&dir, ScanBudget::default());

        // 子目录名 "aaa" 字母序在前，但层级浅的候选必须排前面 ——
        // 菜单前 50 条要优先显示离当前文档最近的文件
        assert_eq!(list.files, vec!["zzz.md".to_string(), "aaa/z.md".to_string()]);

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

        let error = save_document_for_test(
            opened.path.clone(),
            "third".to_string(),
            Some(opened.content_hash.clone()),
            false,
            None, // 不关心排版习惯：走历史行为
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
        save_document_for_test(
            json_path.to_string_lossy().to_string(),
            "{\"id\":\"demo\"}".into(),
            None,
            true,
            None,
        )
        .await
        .unwrap();
        assert!(json_path.exists());

        let script_path = dir.join("startup.bat");
        let error = save_document_for_test(
            script_path.to_string_lossy().to_string(),
            "@echo off".into(),
            None,
            true,
            None,
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

        // force=true should succeed despite a content-hash mismatch
        let result = save_document_for_test(
            opened.path.clone(),
            "forced content".into(),
            Some(opened.content_hash.clone()),
            true,
            None,
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
        let result = save_document_for_test(
            nested.to_string_lossy().to_string(),
            "new file".into(),
            None,
            true,
            None,
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
        // 注意：文件名含扩展名 ⇒ 前缀是「.demo.md.」（不是「.demo.」）
        assert!(filename.starts_with(".demo.md."));
        assert!(filename.ends_with(".tmp"));
        // 中间必须是「毫秒.pid.序号」三段纯数字（PID 防双进程、序号防同进程多窗口撞名）
        let stem = filename
            .strip_prefix(".demo.md.")
            .and_then(|s| s.strip_suffix(".tmp"))
            .expect("tmp 名应为 .demo.md.{毫秒}.{pid}.{序号}.tmp");
        let parts: Vec<&str> = stem.split('.').collect();
        assert_eq!(parts.len(), 3, "应为「毫秒」「pid」「序号」三段：{}", filename);
        assert!(
            parts
                .iter()
                .all(|p| !p.is_empty() && p.bytes().all(|b| b.is_ascii_digit())),
            "三段都必须是非空纯数字：{}",
            filename
        );

        // 同进程连拿两个 tmp 名必须不同：同毫秒的多窗口保存靠这一段分开
        let other = super::temp_path(&path);
        assert_ne!(tmp, other, "同进程内 temp_path 不得重名");

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
        // （新格式与 temp_path 生成格式一致：.{文件名含扩展名}.{毫秒}.{pid}.tmp）
        let stale_tmp = dir.join(".demo.md.1000000.4242.tmp");
        fs::write(&stale_tmp, b"stale").unwrap();
        set_modified_hours_ago(&stale_tmp, 2);

        // 新格式（带 PID + 序号）的 stale 残留同样要认出并清理
        let stale_seq_tmp = dir.join(".demo.md.1000002.4242.7.tmp");
        fs::write(&stale_seq_tmp, b"stale-seq").unwrap();
        set_modified_hours_ago(&stale_seq_tmp, 2);

        // fresh 残留：mtime 当前 → 应保留（双开进程可能正在写入）
        let fresh_tmp = dir.join(".demo.md.1000001.4242.tmp");
        fs::write(&fresh_tmp, b"fresh").unwrap();

        // 旧格式残留（加 PID 之前生成的、没有 pid 段）：仍应被识别并清理（向后兼容）
        let legacy_stale = dir.join(".demo.md.999999.tmp");
        fs::write(&legacy_stale, b"legacy").unwrap();
        set_modified_hours_ago(&legacy_stale, 2);

        // 段内混入非数字（pid 位置写成 abc）→ 应保留，绝不误删用户文件
        let bad_num_tmp = dir.join(".demo.md.1000000.abc.tmp");
        fs::write(&bad_num_tmp, b"bad").unwrap();

        super::cleanup_stale_tmp_files(&doc_path);

        assert!(!stale_tmp.exists(), "stale tmp (mtime > 1h) should be deleted");
        assert!(
            !stale_seq_tmp.exists(),
            "带序号的新格式 stale 残留也应被清理"
        );
        assert!(fresh_tmp.exists(), "fresh tmp should be kept");
        assert!(!legacy_stale.exists(), "旧格式（无 pid）stale 残留也应被清理");
        assert!(bad_num_tmp.exists(), "含非数字段的名字应保留");

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
        // 目标「笔记」：[[笔记]] 改，[[笔记本]] 不动（精确整词，不误伤近名）
        let out =
            rewrite_wikilink_targets("见 [[笔记]] 与 [[笔记本]]", &[("笔记", "文章")]).unwrap();
        assert_eq!(out, "见 [[文章]] 与 [[笔记本]]");
    }

    #[test]
    fn rewrite_wikilink_keeps_alias_and_ignores_plain_link() {
        // 别名段（| 后）原样保留；普通 markdown 链接 [x](y) 不碰
        let out = rewrite_wikilink_targets(
            "[[笔记|我的笔记]] 和 [笔记](笔记.md)",
            &[("笔记", "文章")],
        )
        .unwrap();
        assert_eq!(out, "[[文章|我的笔记]] 和 [笔记](笔记.md)");
    }

    #[test]
    fn rewrite_wikilink_handles_md_suffix_and_multiple_occurrences() {
        // 同一层的两种写法（带全名 + 裸名）一起给：两种形态都改，同一篇多处全改
        let out = rewrite_wikilink_targets(
            "[[笔记.md]] 见 [[笔记]] 再看 [[笔记]]",
            &[("笔记.md", "文章.md"), ("笔记", "文章")],
        )
        .unwrap();
        assert_eq!(out, "[[文章.md]] 见 [[文章]] 再看 [[文章]]");
    }

    #[test]
    fn rewrite_wikilink_returns_none_when_no_match() {
        assert!(rewrite_wikilink_targets("正文没有链接", &[("笔记", "文章")]).is_none());
    }

    #[test]
    fn target_forms_only_lists_shapes_the_resolver_accepts() {
        let old = Path::new("D:/notes/sub/B.md");
        let new = Path::new("D:/notes/sub/C.md");
        // 本层：带全名 + 裸名两种
        assert_eq!(
            wikilink_target_forms(old, new, ""),
            vec![
                ("B.md".to_string(), "C.md".to_string()),
                ("B".to_string(), "C".to_string()),
            ]
        );
        // 上一层：同一篇文件、两种写法都带目录前缀（`[[` 补全插的就是 sub/B 这种）
        assert_eq!(
            wikilink_target_forms(old, new, "sub/"),
            vec![
                ("sub/B.md".to_string(), "sub/C.md".to_string()),
                ("sub/B".to_string(), "sub/C".to_string()),
            ]
        );
        // 非 .md：解析器只给「无后缀目标」补 .md ⇒ 裸名形态压根不成立，不能给。
        // 给了就会去改 `[[B]]`（那指的是不存在的 B.md），而真正指向本篇的
        // `[[B.markdown]]` 反而漏掉。
        assert_eq!(
            wikilink_target_forms(
                Path::new("D:/notes/sub/B.markdown"),
                Path::new("D:/notes/sub/C.markdown"),
                "sub/",
            ),
            vec![(
                "sub/B.markdown".to_string(),
                "sub/C.markdown".to_string()
            )]
        );
    }

    #[test]
    fn rename_scan_dirs_walks_up_only_and_stays_within_depth() {
        let dir = test_dir();
        let deep = dir.join("a/b");
        fs::create_dir_all(&deep).unwrap();

        let roots = rename_scan_dirs(&deep, 2);
        // 本层 + 上两层，各自的前缀就是「那层的文档会怎么写这条链接」
        assert_eq!(
            roots,
            vec![
                (deep.clone(), String::new()),
                (dir.join("a"), "b/".to_string()),
                (dir.clone(), "a/b/".to_string()),
            ]
        );
        // depth = 0 退化成只看本层
        assert_eq!(rename_scan_dirs(&deep, 0).len(), 1);

        let _ = fs::remove_dir_all(dir);
    }

    #[tokio::test]
    async fn sync_wikilinks_rewrites_matching_links_only() {
        let dir = test_dir();
        // 被改名的这篇放在 dir/a/b 下：命令扫「本层 + 向上两层」，三层全在测试目录内，
        // 不会去碰系统临时目录
        let work = dir.join("a").join("b");
        fs::create_dir_all(&work).unwrap();
        let new_path = work.join("new.md");
        atomic_write(&new_path, b"# new").unwrap();
        // ① 同层引用：裸名与带全名两种写法都要改
        let link = work.join("link.md");
        atomic_write(&link, b"see [[old]] and [[old.md]]").unwrap();
        // ② 干扰项：近名 oldbook、普通链接 —— 都不该被动
        atomic_write(&work.join("near.md"), b"[[oldbook]] and [old](x)").unwrap();
        // ③ 上一层、上两层的引用方：写法各带一段前缀（本轮补全产出的主要形态）
        let upper = dir.join("a").join("上层.md");
        atomic_write(&upper, "见 [[b/old]]".as_bytes()).unwrap();
        let top = dir.join("上二层.md");
        atomic_write(&top, "见 [[a/b/old.md]]".as_bytes()).unwrap();
        // ④ 出界的两种：子目录文档的 [[old]] 指的是**它自己那层**的 old.md（另一篇）；
        //    更深目录要指回来必须写 ../，不在互链承诺范围内 ⇒ 都不动
        let child = work.join("child");
        fs::create_dir_all(&child).unwrap();
        atomic_write(&child.join("deep.md"), b"see [[old]]").unwrap();
        fs::create_dir_all(dir.join("x").join("y")).unwrap();
        let far = dir.join("x").join("y").join("deep.md");
        atomic_write(&far, b"see [[../../a/b/old]]").unwrap();

        let old_str = work.join("old.md").to_string_lossy().to_string();
        let new_str = new_path.to_string_lossy().to_string();
        let changed = sync_wikilinks_on_rename(old_str, new_str).await.unwrap();

        // 返回值是绝对路径（跨层后相对路径会带 `..`，前端比对不上）
        let mut expected = vec![
            link.to_string_lossy().to_string(),
            upper.to_string_lossy().to_string(),
            top.to_string_lossy().to_string(),
        ];
        expected.sort();
        assert_eq!(changed, expected);
        assert_eq!(
            fs::read_to_string(&link).unwrap(),
            "see [[new]] and [[new.md]]"
        );
        assert_eq!(fs::read_to_string(&upper).unwrap(), "见 [[b/new]]");
        assert_eq!(fs::read_to_string(&top).unwrap(), "见 [[a/b/new.md]]");
        assert_eq!(
            fs::read_to_string(work.join("near.md")).unwrap(),
            "[[oldbook]] and [old](x)"
        );
        // ⚠️ R-1 守卫：这两条一个字都不许动
        assert_eq!(fs::read_to_string(&child.join("deep.md")).unwrap(), "see [[old]]");
        assert_eq!(
            fs::read_to_string(&far).unwrap(),
            "see [[../../a/b/old]]"
        );

        let _ = fs::remove_dir_all(dir);
    }

    #[tokio::test]
    async fn sync_wikilinks_does_not_touch_same_name_in_subdir() {
        // 审核 R-1：根目录那篇改名，**不能**顺手改子目录文档里的同名裸名链接。
        // 上一版把扫描扩成向下递归后，`sub/deep.md` 里指向 `sub/old.md` 的好链接
        // 会被整词替换成 `[[new]]`（指向不存在的文件）并静默落盘 ——
        // 而旧测试还把那个错误行为断言成了预期。
        let dir = test_dir();
        let work = dir.join("a").join("b");
        fs::create_dir_all(&work).unwrap();
        let new_path = work.join("new.md");
        atomic_write(&new_path, b"# new").unwrap();
        let sub = work.join("sub");
        fs::create_dir_all(&sub).unwrap();
        // 与根目录旧名同名的一篇，和引用它的那篇
        atomic_write(&sub.join("old.md"), "# 另一篇，与本次改名无关".as_bytes()).unwrap();
        atomic_write(&sub.join("deep.md"), b"see [[old]]").unwrap();

        let changed = sync_wikilinks_on_rename(
            work.join("old.md").to_string_lossy().to_string(),
            new_path.to_string_lossy().to_string(),
        )
        .await
        .unwrap();

        assert!(
            changed.is_empty(),
            "子目录的 [[old]] 指的是 sub/old.md，与本篇无关 ⇒ 一篇都不该改"
        );
        assert_eq!(fs::read_to_string(sub.join("deep.md")).unwrap(), "see [[old]]");
        assert_eq!(fs::read_to_string(&new_path).unwrap(), "# new");

        let _ = fs::remove_dir_all(dir);
    }

    #[tokio::test]
    async fn sync_wikilinks_renames_markdown_explicit_form_only() {
        // 被改名的是 .markdown：能指到它的写法只有带全名那一种（裸名 [[B]] 指的是
        // 不存在的 B.md）。同时验证上一层目录里的 [[sub/B.markdown]] 也跟着走。
        let dir = test_dir();
        let work = dir.join("a").join("b");
        fs::create_dir_all(&work).unwrap();
        let new_path = work.join("C.markdown");
        atomic_write(&new_path, b"# C").unwrap();
        let same_dir = work.join("同层.md");
        atomic_write(&same_dir, "见 [[B.markdown]] 与 [[B]]".as_bytes()).unwrap();
        let upper = dir.join("a").join("上层.md");
        atomic_write(&upper, "见 [[b/B.markdown]]".as_bytes()).unwrap();

        let changed = sync_wikilinks_on_rename(
            work.join("B.markdown").to_string_lossy().to_string(),
            new_path.to_string_lossy().to_string(),
        )
        .await
        .unwrap();

        let mut expected = vec![
            same_dir.to_string_lossy().to_string(),
            upper.to_string_lossy().to_string(),
        ];
        expected.sort();
        assert_eq!(changed, expected);
        // 裸名那半句原样留着：它不是指向本篇的链接
        assert_eq!(
            fs::read_to_string(&same_dir).unwrap(),
            "见 [[C.markdown]] 与 [[B]]"
        );
        assert_eq!(fs::read_to_string(&upper).unwrap(), "见 [[b/C.markdown]]");

        let _ = fs::remove_dir_all(dir);
    }

    #[tokio::test]
    async fn sync_wikilinks_noop_when_name_unchanged() {
        let dir = test_dir();
        let link = dir.join("link.md");
        atomic_write(&link, b"[[same]]").unwrap();
        // 新旧名相同 → 直接返回空，不扫描不改写
        let p = dir.join("same.md").to_string_lossy().to_string();
        let res = sync_wikilinks_on_rename(p.clone(), p).await.unwrap();
        assert!(res.is_empty());
        assert_eq!(fs::read_to_string(&link).unwrap(), "[[same]]");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn rewrite_wikilink_skips_fenced_code_block() {
        // 围栏内的 [[笔记]] 是给人看的示例，不该改；围栏外的真链接才改
        let content =
            "见 [[笔记]] 有效。\n```\n示例 [[笔记]] 不该动\n```\n再来 [[笔记]]\n~~~\n[[笔记]] 也不动\n~~~\n";
        let out = rewrite_wikilink_targets(content, &[("笔记", "文章")]).unwrap();
        assert_eq!(
            out,
            "见 [[文章]] 有效。\n```\n示例 [[笔记]] 不该动\n```\n再来 [[文章]]\n~~~\n[[笔记]] 也不动\n~~~\n"
        );
    }

    #[tokio::test]
    async fn sync_wikilinks_skips_the_renamed_file_itself() {
        let dir = test_dir();
        let work = dir.join("a").join("b");
        fs::create_dir_all(&work).unwrap();
        let new_path = work.join("new.md");
        // 改名后的当前文档：正文含指向自己旧名的自链，也不该被动（用户正在编辑的这篇）
        atomic_write(&new_path, b"see [[old]] and [[new]] here").unwrap();
        let link = work.join("link.md");
        atomic_write(&link, b"points [[old]]").unwrap();

        let old_str = work.join("old.md").to_string_lossy().to_string();
        let new_str = new_path.to_string_lossy().to_string();
        let changed = sync_wikilinks_on_rename(old_str, new_str).await.unwrap();

        assert_eq!(changed, vec![link.to_string_lossy().to_string()]);
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
        let work = dir.join("a").join("b");
        fs::create_dir_all(&work).unwrap();
        let self_path = work.join("new.md");
        atomic_write(&self_path, b"# new").unwrap(); // 当前改名文档，跳过、不计入扫描数
        for f in ["a.md", "b.md", "c.md", "d.md"] {
            atomic_write(&work.join(f), b"see [[old]]").unwrap();
        }
        let old_ref = work.join("old.md");
        let roots = rename_roots(&old_ref, &self_path);

        // limit=2：只处理 2 个候选（读目录顺序不定，仅断言命中数=2）；
        // 证明按「已扫描文档数」而非「命中数」限流，且限流是**跨层合计**
        let affected = scan_and_rewrite_wikilinks(
            &roots,
            &self_path,
            ScanBudget {
                max_files: 2,
                ..Default::default()
            },
        );
        assert_eq!(affected.len(), 2);
        // 上面那次已把命中的改写成 [[new]]，重置后再跑全量（大 limit）：四个都命中
        for f in ["a.md", "b.md", "c.md", "d.md"] {
            atomic_write(&work.join(f), b"see [[old]]").unwrap();
        }
        let all = scan_and_rewrite_wikilinks(&roots, &self_path, ScanBudget::default());
        let mut expected: Vec<String> = ["a.md", "b.md", "c.md", "d.md"]
            .iter()
            .map(|s| work.join(s).to_string_lossy().to_string())
            .collect();
        expected.sort();
        assert_eq!(all, expected);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn scan_wikilinks_covers_ancestors_within_depth_only() {
        // 引用方只在「本层 + 向上 WIKILINK_SCAN_DEPTH(2) 层」这三层里被扫到；
        // 上 3 层那篇要指过来只能写 `[[../../..]]` 这类出界路径，而它既不被标红判、
        // 也不是 `[[` 补全产得出来的写法 ⇒ 不属于互链承诺的范围，与标红侧同一口径。
        let dir = test_dir();
        let level2 = dir.join("a");
        let level1 = level2.join("b");
        let work = level1.join("c");
        fs::create_dir_all(&work).unwrap();
        let self_path = work.join("new.md");
        atomic_write(&self_path, b"# new").unwrap();
        // 上 1 层（b）与上 2 层（a）：范围内，各自用本层写法链接
        let upper1 = level1.join("上层一.md");
        atomic_write(&upper1, "见 [[c/old]]".as_bytes()).unwrap();
        let upper2 = level2.join("上层二.md");
        atomic_write(&upper2, "见 [[b/c/old]]".as_bytes()).unwrap();
        // 上 3 层（dir）：范围外，且它真写出了出界形态
        let too_far = dir.join("上层三.md");
        atomic_write(&too_far, "见 [[../a/b/c/old]]".as_bytes()).unwrap();

        let roots = rename_roots(&work.join("old.md"), &self_path);
        // 三层计划：c（本层）、b（前缀 c/）、a（前缀 b/c/）—— dir 不在其中
        assert_eq!(roots.len(), 3);

        let all = scan_and_rewrite_wikilinks(&roots, &self_path, ScanBudget::default());
        let mut expected = vec![
            upper1.to_string_lossy().to_string(),
            upper2.to_string_lossy().to_string(),
        ];
        expected.sort();
        assert_eq!(all, expected);
        assert_eq!(fs::read_to_string(&upper1).unwrap(), "见 [[c/new]]");
        assert_eq!(fs::read_to_string(&upper2).unwrap(), "见 [[b/c/new]]");
        assert_eq!(
            fs::read_to_string(&too_far).unwrap(),
            "见 [[../a/b/c/old]]",
            "超出向上范围的出界写法不该被顺手改（也不该被假装支持）"
        );
        let _ = fs::remove_dir_all(dir);
    }
}
