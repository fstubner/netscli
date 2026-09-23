//! Whether this particular install of the desktop app can update itself.
//!
//! The updater plugin can replace an MSI install, an AppImage and a macOS
//! .app bundle. Being *able* to is not the same as it being right to, and the
//! difference is who owns the files:
//!
//! - **Scoop** installs by extracting the MSI into its own `apps` directory
//!   and runs that copy. An in-app update would run the MSI for real and
//!   leave a second, Program Files install beside the one Scoop manages,
//!   while the app the user launches stays old.
//! - **The AUR package** puts the AppImage in `/usr/bin`. The plugin replaces
//!   an AppImage by renaming it inside its own directory, which a user cannot
//!   do there -- and pacman owns the file regardless.
//! - **A .deb** belongs to dpkg.
//!
//! Those installs keep the existing behaviour: a notice that links to the
//! release page. Everything else -- winget, a direct MSI or AppImage
//! download, the Homebrew cask -- installs in place. (A Microsoft Store
//! listing of the MSI would too: it performs an ordinary MSI install.) Winget reads
//! the installed version back from Add/Remove Programs, so an in-app MSI
//! upgrade does not confuse it, and the cask declares `auto_updates`.
//!
//! The decision is a pure function over what the process can observe, so the
//! Scoop and AUR cases are tested here rather than on real installs.

use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::utils::config::BundleType;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallSupport {
    /// True when "Install and restart" can be offered.
    pub supported: bool,
    /// Shown in place of the install button when `supported` is false.
    pub reason: Option<String>,
}

impl InstallSupport {
    fn yes() -> Self {
        Self {
            supported: true,
            reason: None,
        }
    }

    fn no(reason: &str) -> Self {
        Self {
            supported: false,
            reason: Some(reason.to_string()),
        }
    }
}

/// Everything `decide` looks at, gathered by the caller so tests can supply it.
pub struct Probe<'a> {
    /// The bundle this binary was packaged into. Written into the executable
    /// at bundling time, so it survives the AppImage being repacked later.
    pub bundle: Option<BundleType>,
    pub exe: &'a Path,
    /// `$APPIMAGE`, set by the AppImage runtime to the file being run.
    pub appimage: Option<&'a Path>,
    pub scoop_roots: &'a [PathBuf],
    pub dir_writable: &'a dyn Fn(&Path) -> bool,
}

pub fn decide(probe: &Probe) -> InstallSupport {
    match probe.bundle {
        Some(BundleType::Msi | BundleType::Nsis) => {
            if under_scoop(probe.exe, probe.scoop_roots) {
                InstallSupport::no(
                    "Installed with Scoop, so update it there: scoop update netscli-gui",
                )
            } else {
                InstallSupport::yes()
            }
        }
        Some(BundleType::AppImage) => match probe.appimage.and_then(Path::parent) {
            Some(dir) if (probe.dir_writable)(dir) => InstallSupport::yes(),
            Some(_) => InstallSupport::no(
                "Installed system-wide, so updates come through your package manager.",
            ),
            None => InstallSupport::no("Could not find the AppImage this is running from."),
        },
        Some(BundleType::Deb | BundleType::Rpm) => InstallSupport::no(
            "Installed from a Linux package, so update it by installing the new package.",
        ),
        Some(BundleType::App | BundleType::Dmg) => InstallSupport::yes(),
        None => InstallSupport::no("This is a development build, so it cannot update itself."),
        // BundleType is non-exhaustive upstream; a bundle added later is not
        // one this code has reasoned about, so it does not get to self-update.
        #[allow(unreachable_patterns)]
        Some(_) => InstallSupport::no("This install type cannot update itself."),
    }
}

/// Case-insensitive, because Windows paths are and the Scoop root can arrive
/// from an environment variable in any casing.
fn under_scoop(exe: &Path, roots: &[PathBuf]) -> bool {
    let exe = lower(exe);
    roots
        .iter()
        .any(|root| exe.starts_with(lower(&root.join("apps"))))
}

fn lower(path: &Path) -> PathBuf {
    PathBuf::from(path.to_string_lossy().to_lowercase())
}

/// Scoop's two install roots, as Scoop itself resolves them: `$SCOOP` or
/// `~/scoop` for user installs, `$SCOOP_GLOBAL` or `%ProgramData%\scoop`
/// for global ones.
fn scoop_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    for var in ["SCOOP", "SCOOP_GLOBAL"] {
        if let Some(value) = std::env::var_os(var) {
            roots.push(PathBuf::from(value));
        }
    }
    if let Some(home) = dirs::home_dir() {
        roots.push(home.join("scoop"));
    }
    if let Some(program_data) = std::env::var_os("ProgramData") {
        roots.push(PathBuf::from(program_data).join("scoop"));
    }
    roots
}

/// Asks the filesystem rather than reading permission bits, which say nothing
/// about ACLs, read-only mounts or who the effective user is.
fn probe_dir_writable(dir: &Path) -> bool {
    let probe = dir.join(format!(".netscli-update-probe-{}", std::process::id()));
    match std::fs::File::create(&probe) {
        Ok(_) => {
            let _ = std::fs::remove_file(&probe);
            true
        }
        Err(_) => false,
    }
}

#[tauri::command]
pub fn update_install_support() -> InstallSupport {
    let Ok(exe) = std::env::current_exe() else {
        return InstallSupport::no("Could not locate the running executable.");
    };
    let appimage = std::env::var_os("APPIMAGE").map(PathBuf::from);
    let roots = scoop_roots();
    decide(&Probe {
        bundle: tauri::utils::platform::bundle_type(),
        exe: &exe,
        appimage: appimage.as_deref(),
        scoop_roots: &roots,
        dir_writable: &probe_dir_writable,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(
        bundle: Option<BundleType>,
        exe: &Path,
        appimage: Option<&Path>,
        roots: &[PathBuf],
        writable: bool,
    ) -> InstallSupport {
        let dir_writable = move |_: &Path| writable;
        decide(&Probe {
            bundle,
            exe,
            appimage,
            scoop_roots: roots,
            dir_writable: &dir_writable,
        })
    }

    fn root() -> PathBuf {
        std::env::temp_dir().join("home").join("scoop")
    }

    #[test]
    fn direct_msi_install_updates_itself() {
        let exe = std::env::temp_dir()
            .join("Program Files")
            .join("NetsCLI")
            .join("NetsCLI.exe");
        assert!(run(Some(BundleType::Msi), &exe, None, &[root()], false).supported);
    }

    #[test]
    fn scoop_install_defers_to_scoop() {
        let exe = root()
            .join("apps")
            .join("netscli-gui")
            .join("current")
            .join("NetsCLI.exe");
        let got = run(Some(BundleType::Msi), &exe, None, &[root()], true);
        assert!(!got.supported);
        assert!(got.reason.unwrap().contains("scoop update"));
    }

    #[test]
    fn scoop_detection_ignores_case() {
        let upper = PathBuf::from(root().to_string_lossy().to_uppercase());
        let exe = upper.join("APPS").join("netscli-gui").join("NetsCLI.exe");
        assert!(!run(Some(BundleType::Msi), &exe, None, &[root()], true).supported);
    }

    #[test]
    fn a_directory_merely_named_scoop_is_not_scoop() {
        // Only <root>/apps counts; a sibling folder under the same root does not.
        let exe = root().join("tools").join("NetsCLI.exe");
        assert!(run(Some(BundleType::Msi), &exe, None, &[root()], false).supported);
    }

    #[test]
    fn appimage_in_a_writable_directory_updates_itself() {
        let image = std::env::temp_dir()
            .join("Apps")
            .join("netscli-gui.AppImage");
        let got = run(Some(BundleType::AppImage), &image, Some(&image), &[], true);
        assert!(got.supported);
    }

    #[test]
    fn system_wide_appimage_defers_to_the_package_manager() {
        // The AUR package: /usr/bin is not writable by the user.
        let image = PathBuf::from("/usr/bin/netscli-gui");
        let got = run(Some(BundleType::AppImage), &image, Some(&image), &[], false);
        assert!(!got.supported);
    }

    #[test]
    fn appimage_without_its_path_does_not_guess() {
        let exe = PathBuf::from("/tmp/.mount_x/netscli-gui");
        assert!(!run(Some(BundleType::AppImage), &exe, None, &[], true).supported);
    }

    #[test]
    fn linux_packages_defer_to_their_package_manager() {
        let exe = PathBuf::from("/usr/bin/netscli-gui");
        for bundle in [BundleType::Deb, BundleType::Rpm] {
            assert!(!run(Some(bundle), &exe, None, &[], true).supported);
        }
    }

    #[test]
    fn macos_app_updates_itself() {
        let exe = PathBuf::from("/Applications/NetsCLI.app/Contents/MacOS/netscli-gui");
        assert!(run(Some(BundleType::App), &exe, None, &[], false).supported);
    }

    #[test]
    fn unbundled_build_never_offers_an_install() {
        let exe = PathBuf::from("target/debug/netscli-gui");
        assert!(!run(None, &exe, None, &[], true).supported);
    }

    #[test]
    fn probe_reports_a_writable_directory() {
        assert!(probe_dir_writable(&std::env::temp_dir()));
    }

    #[test]
    fn probe_reports_a_missing_directory_as_unwritable() {
        let missing = std::env::temp_dir()
            .join("netscli-definitely-not-here")
            .join("nested");
        assert!(!probe_dir_writable(&missing));
    }
}
