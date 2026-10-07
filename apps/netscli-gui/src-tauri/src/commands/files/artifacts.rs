use std::path::{Path, PathBuf};

use tauri::State;
use tauri_plugin_opener::OpenerExt;

use super::preferences::{default_save_directory, read_file_save_preferences};
use crate::state::ArtifactRegistry;

#[tauri::command]
pub(crate) fn open_saved_artifact(
    app: tauri::AppHandle,
    artifact_registry: State<'_, ArtifactRegistry>,
    path: String,
) -> Result<(), String> {
    let path = validate_saved_artifact_path(&path, &artifact_registry)?;
    app.opener()
        .open_path(path.to_string_lossy().to_string(), None::<&str>)
        .map_err(|e| format!("Failed to open artifact: {e}"))
}

#[tauri::command]
pub(crate) fn reveal_saved_artifact(
    app: tauri::AppHandle,
    artifact_registry: State<'_, ArtifactRegistry>,
    path: String,
) -> Result<(), String> {
    let path = validate_saved_artifact_path(&path, &artifact_registry)?;
    app.opener()
        .reveal_item_in_dir(&path)
        .map_err(|e| format!("Failed to reveal artifact: {e}"))
}

fn validate_saved_artifact_path(
    path: &str,
    artifact_registry: &ArtifactRegistry,
) -> Result<PathBuf, String> {
    let path = PathBuf::from(path.trim());
    if path.as_os_str().is_empty() {
        return Err("Artifact path is empty".to_string());
    }

    let canonical = std::fs::canonicalize(&path)
        .map_err(|e| format!("Artifact path is not accessible: {e}"))?;
    if !canonical.is_file() {
        return Err("Artifact path must be a file".to_string());
    }
    if !has_supported_artifact_extension(&canonical) {
        return Err("Artifact type is not supported".to_string());
    }

    if artifact_registry.contains(&canonical)? || is_in_allowed_save_root(&canonical)? {
        Ok(canonical)
    } else {
        Err(
            "Artifact path was not created by NetsCLI or is outside the configured save folder"
                .to_string(),
        )
    }
}

fn has_supported_artifact_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| {
            matches!(
                ext.to_ascii_lowercase().as_str(),
                "pcap" | "json" | "csv" | "txt"
            )
        })
        .unwrap_or(false)
}

fn is_in_allowed_save_root(path: &Path) -> Result<bool, String> {
    let mut roots = Vec::new();
    if let Some(path) = std::env::var_os("NETSCLI_EXPORT_DIR") {
        roots.push(PathBuf::from(path));
    }

    if let Ok(prefs) = read_file_save_preferences() {
        if let Some(path) = prefs
            .default_directory
            .filter(|value| !value.trim().is_empty())
        {
            roots.push(PathBuf::from(path));
        }
    }

    roots.push(default_save_directory()?);

    for root in roots {
        let Ok(root) = std::fs::canonicalize(root) else {
            continue;
        };
        if path.starts_with(root) {
            return Ok(true);
        }
    }

    Ok(false)
}

// What the renderer may ask the OS to open or reveal. These stop at the checks
// that need nothing but the file and the registry; the save-folder check reads
// the user's real settings and creates the default folder, which a test
// should not do.
#[cfg(test)]
mod tests {
    use super::*;

    fn temp_file(tag: &str, name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "netscli-artifact-test-{}-{tag}",
            std::process::id()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(name);
        std::fs::write(&path, "x").unwrap();
        path
    }

    #[test]
    fn only_the_kinds_the_app_writes_can_be_opened() {
        for name in ["a.pcap", "a.json", "a.csv", "a.txt", "A.CSV"] {
            assert!(has_supported_artifact_extension(Path::new(name)), "{name}");
        }
        for name in ["a.exe", "a.ps1", "a.lnk", "a.html", "a"] {
            assert!(!has_supported_artifact_extension(Path::new(name)), "{name}");
        }
    }

    #[test]
    fn an_empty_missing_or_wrong_kind_of_path_is_refused() {
        let registry = ArtifactRegistry::default();
        assert!(validate_saved_artifact_path("  ", &registry).is_err());
        assert!(validate_saved_artifact_path("definitely/not/here.csv", &registry).is_err());

        let exe = temp_file("exe", "tool.exe");
        let err = validate_saved_artifact_path(exe.to_str().unwrap(), &registry).unwrap_err();
        assert!(err.contains("not supported"), "{err}");

        let dir = exe.parent().unwrap();
        let err = validate_saved_artifact_path(dir.to_str().unwrap(), &registry).unwrap_err();
        assert!(err.contains("must be a file"), "{err}");
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_file_this_session_wrote_is_accepted() {
        let registry = ArtifactRegistry::default();
        let file = temp_file("registered", "scan.csv");
        registry.register(&file).unwrap();

        let accepted = validate_saved_artifact_path(file.to_str().unwrap(), &registry).unwrap();
        assert_eq!(accepted, std::fs::canonicalize(&file).unwrap());
        std::fs::remove_dir_all(file.parent().unwrap()).unwrap();
    }
}
