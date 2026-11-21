#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DocumentOpenResult {
    pub path: String,
    pub content: String,
    pub last_modified_ms: u64,
    /// 磁盘原文的「排版习惯」。编辑器内部恒为 `\n` 无 BOM，这些信息只能靠这份元数据
    /// 在保存时还原（见 docs/PROPOSAL-file-fidelity.md §1 F1/F7）。
    pub layout: DocumentLayout,
}

/// 原文件的编码族。三分而非「有没有 BOM」二态：`read_text_file` 会把 UTF-16 解码成
/// 普通字符串，若只按 bool 回写 UTF-8 BOM，一个 UTF-16 另存的 .md 会被静默换族。
#[derive(Debug, Clone, Copy, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TextEncoding {
    Utf8,
    Utf8Bom,
    /// 原文件是 UTF-16（LE / BE 不必区分：保存时都按 UTF-8 写，属于**有意归一**）。
    Utf16,
}

/// 换行方式。用枚举而非裸字符串：前端只能传这三个值，传不进别的东西。
#[derive(Debug, Clone, Copy, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum LineEnding {
    Lf,
    Crlf,
    Cr,
}

impl LineEnding {
    pub fn as_str(self) -> &'static str {
        match self {
            LineEnding::Lf => "\n",
            LineEnding::Crlf => "\r\n",
            LineEnding::Cr => "\r",
        }
    }
}

/// 文件在磁盘上的排版习惯：编码族 + 主导换行 + 是否混合换行。
#[derive(Debug, Clone, Copy, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DocumentLayout {
    pub encoding: TextEncoding,
    /// 主导换行 = 出现最频繁；平局取文件中先出现的那一种；无换行 → `Lf`。
    pub ending: LineEnding,
    /// 两种及以上换行并存。保存时不会逐行保留，会统一为 `ending`。
    pub mixed: bool,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DocumentSaveResult {
    pub path: String,
    pub last_modified_ms: u64,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DocumentImageImportResult {
    pub relative_path: String,
    pub absolute_path: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ImageAssetAuthorizationResult {
    pub path: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DocumentRenameResult {
    pub path: String,
}

/// 互链 `[[` 补全候选清单。
///
/// `truncated` 是**正确性必需**的，不是提示性字段：扫描有「文件数」和「目录数」两个闸门，
/// 任一触发都意味着清单不完整。前端据此决定「能不能断言某个链接指向的文件不存在」——
/// 清单不完整时下这个断言就是误标红（实测 602 文件的目录里 `[[zzz]]` 曾被误标成死链）。
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MarkdownFileList {
    /// 相对当前文档所在目录的路径（`/` 分隔，如 `sub/B.md`），浅层优先
    pub files: Vec<String>,
    /// 清单是否可能不完整（凑满文件上限或触到目录预算）
    pub truncated: bool,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum AppOpenSource {
    Cli,
    OsOpen,
    NewWindow,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AppOpenPathsPayload {
    pub paths: Vec<String>,
    pub source: AppOpenSource,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn document_open_result_is_camel_cased() {
        let v = serde_json::to_value(DocumentOpenResult {
            path: "a.md".into(),
            content: "# hi".into(),
            last_modified_ms: 1000,
            layout: DocumentLayout {
                encoding: TextEncoding::Utf8Bom,
                ending: LineEnding::Crlf,
                mixed: false,
            },
        })
        .unwrap();
        assert_eq!(v["path"], "a.md");
        assert_eq!(v["content"], "# hi");
        assert_eq!(v["lastModifiedMs"], 1000);
        // 前端拿到的字面量：encoding / ending / mixed
        assert_eq!(v["layout"]["encoding"], "utf8Bom");
        assert_eq!(v["layout"]["ending"], "crlf");
        assert_eq!(v["layout"]["mixed"], false);
    }

    /// 前端 → Rust 这个方向也要测：Tauri 命令参数走 `Deserialize`，序列化对了
    /// 不代表反序列化对。对不上时 `save_document` 拿到 `None` ⇒ 静默退回历史行为，
    /// 功能哑掉且不报错（W1 全靠这条通道）。
    #[test]
    fn document_layout_deserializes_from_frontend_json() {
        let v: DocumentLayout =
            serde_json::from_str(r#"{"encoding":"utf8Bom","ending":"crlf","mixed":true}"#).unwrap();
        assert_eq!(v.encoding, TextEncoding::Utf8Bom);
        assert_eq!(v.ending, LineEnding::Crlf);
        assert!(v.mixed);

        // 前端不传（新建文档）→ None
        let none: Option<DocumentLayout> = serde_json::from_str("null").unwrap();
        assert!(none.is_none());
    }

    #[test]
    fn document_save_result_is_camel_cased() {        let v = serde_json::to_value(DocumentSaveResult {
            path: "a.md".into(),
            last_modified_ms: 2000,
        })
        .unwrap();
        assert_eq!(v["path"], "a.md");
        assert_eq!(v["lastModifiedMs"], 2000);
    }

    #[test]
    fn document_image_import_result_is_camel_cased() {
        let v = serde_json::to_value(DocumentImageImportResult {
            relative_path: "assets/x.png".into(),
            absolute_path: "/abs/x.png".into(),
        })
        .unwrap();
        assert_eq!(v["relativePath"], "assets/x.png");
        assert_eq!(v["absolutePath"], "/abs/x.png");
    }

    #[test]
    fn image_asset_authorization_result_is_camel_cased() {
        let v = serde_json::to_value(ImageAssetAuthorizationResult {
            path: "/safe/z.png".into(),
        })
        .unwrap();
        assert_eq!(v["path"], "/safe/z.png");
    }

    #[test]
    fn document_rename_result_is_camel_cased() {
        let v = serde_json::to_value(DocumentRenameResult {
            path: "b.md".into(),
        })
        .unwrap();
        assert_eq!(v["path"], "b.md");
    }

    #[test]
    fn app_open_source_serializes_as_kebab_case() {
        assert_eq!(serde_json::to_value(AppOpenSource::Cli).unwrap(), "cli");
        assert_eq!(serde_json::to_value(AppOpenSource::OsOpen).unwrap(), "os-open");
        assert_eq!(serde_json::to_value(AppOpenSource::NewWindow).unwrap(), "new-window");
    }

    #[test]
    fn app_open_source_roundtrips() {
        for source in &[AppOpenSource::Cli, AppOpenSource::OsOpen, AppOpenSource::NewWindow] {
            let json = serde_json::to_value(source).unwrap();
            let back: AppOpenSource = serde_json::from_value(json).unwrap();
            assert_eq!(&back, source);
        }
    }

    #[test]
    fn app_open_paths_payload_is_camel_cased() {
        let v = serde_json::to_value(AppOpenPathsPayload {
            paths: vec!["a.md".into(), "b.md".into()],
            source: AppOpenSource::OsOpen,
        })
        .unwrap();
        assert_eq!(v["paths"][0], "a.md");
        assert_eq!(v["paths"][1], "b.md");
        assert_eq!(v["source"], "os-open");
    }
}
