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
pub struct DocumentImageResolveResult {
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
    fn document_image_resolve_result_is_camel_cased() {
        let v = serde_json::to_value(DocumentImageResolveResult {
            absolute_path: "/abs/y.png".into(),
        })
        .unwrap();
        assert_eq!(v["absolutePath"], "/abs/y.png");
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
