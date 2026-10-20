#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DocumentOpenResult {
    pub path: String,
    pub content: String,
    pub last_modified_ms: u64,
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
        })
        .unwrap();
        assert_eq!(v["path"], "a.md");
        assert_eq!(v["content"], "# hi");
        assert_eq!(v["lastModifiedMs"], 1000);
    }

    #[test]
    fn document_save_result_is_camel_cased() {
        let v = serde_json::to_value(DocumentSaveResult {
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
