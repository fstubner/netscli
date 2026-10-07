//! Creating the files netscli keeps for itself so that only their owner can
//! read them.
//!
//! The history database holds every result netscli has produced: hosts,
//! MAC addresses, banners. A directory made the usual way is readable by
//! everyone else on a shared Unix machine, so these helpers set the mode when
//! they create things. They do not touch what already exists, and on Windows
//! the mode does not apply, so there they only create.

use anyhow::Result;
use std::fs::{DirBuilder, OpenOptions};
use std::path::Path;

/// Create `dir` and any missing parents. On Unix every directory this makes is
/// `0700`.
pub(crate) fn create_private_dir(dir: &Path) -> Result<()> {
    let mut builder = DirBuilder::new();
    builder.recursive(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder.create(dir)?;
    Ok(())
}

/// Create `file`, empty, if it does not exist. On Unix it is `0600`. A file
/// that is already there keeps its contents and its mode.
///
/// SQLite is going to open this next. It would create the file itself, but
/// with the default mode, and it gives its `-wal` and `-shm` companions
/// whatever mode the main file has.
pub(crate) fn create_private_file(file: &Path) -> Result<()> {
    let mut options = OpenOptions::new();
    options.append(true).create(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options.open(file)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    /// A directory of this test's own under the system temp directory.
    fn scratch(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("netscli-private-fs-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn an_existing_file_is_left_alone() {
        let dir = scratch("existing");
        create_private_dir(&dir).unwrap();
        let file = dir.join("netscli.db");
        std::fs::write(&file, b"history").unwrap();

        create_private_file(&file).unwrap();

        assert_eq!(std::fs::read(&file).unwrap(), b"history");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn new_directories_and_files_are_owner_only() {
        use std::os::unix::fs::PermissionsExt;

        let dir = scratch("modes");
        let nested = dir.join(".netscli");
        create_private_dir(&nested).unwrap();
        let file = nested.join("netscli.db");
        create_private_file(&file).unwrap();

        let mode = |path: &Path| std::fs::metadata(path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode(&nested), 0o700);
        assert_eq!(mode(&file), 0o600);
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
