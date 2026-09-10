//! Absolute paths for the operating-system tools netscli shells out to.
//!
//! Windows-only, and compiled only there. On Unix `exec` searches `PATH`
//! alone -- neither the working directory nor the executable's own directory
//! is consulted -- so there is nothing for this module to fix, and a
//! non-Windows variant would be dead code that `-D warnings` rejects.
//!
//! On Windows, launching a helper by bare name is a local privilege
//! escalation. Measured on the pinned 1.96.0 toolchain rather than inferred
//! from the platform docs, with a control run proving the planted binary
//! executes:
//!
//! - A planted `ping.exe` in the **current directory** did NOT run. Rust no
//!   longer includes the working directory in the search, so the classic
//!   version of this bug is already closed.
//! - A planted `ping.exe` in **the directory holding the running
//!   executable** DID run, in place of `C:\Windows\System32\PING.EXE`.
//!
//! The second one bites here specifically because of where netscli installs
//! and how it is used. Every Windows CLI install path is user-writable --
//! `scripts/install.ps1` defaults to `%USERPROFILE%\.cargo\bin`,
//! `cargo install` uses the same directory, Scoop shims out of the user
//! profile, and the winget package is `InstallerType: portable`. Meanwhile
//! ARP modification *requires elevation*, and the docs tell people so.
//!
//! So: an attacker with ordinary user access writes `arp.exe` next to
//! `netscli.exe` -- no administrator rights needed for that -- and the next
//! time the user runs `netscli arp --clear` from an elevated prompt, exactly
//! as documented, the planted binary executes elevated. Writing the file and
//! gaining administrator are two different privileges, which is what makes
//! it an escalation rather than "they could already run code as you".
//!
//! The desktop app is not a vector: its MSI installs under
//! `ProgramFiles64Folder`, so planting there already needs administrator.

use std::ffi::OsString;
use std::path::PathBuf;

/// Resolve an OS tool to an absolute path under `%SystemRoot%\System32`,
/// which is not user-writable.
///
/// No `is_file()` check and no fallback to the bare name, on purpose. A
/// fallback would reintroduce exactly the bug this function exists to
/// remove, and would do it silently, on whichever machine the check happened
/// to fail. Returning the absolute path unconditionally means a genuinely
/// missing tool fails to spawn with an error naming the full path it looked
/// for, which is a better answer than quietly searching somewhere an
/// attacker can write.
pub(crate) fn system_tool(program: &str) -> OsString {
    let root = std::env::var_os("SystemRoot").unwrap_or_else(|| OsString::from(r"C:\Windows"));
    let mut path = PathBuf::from(root);
    path.push("System32");
    path.push(format!("{program}.exe"));
    path.into_os_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tools_resolve_under_system32() {
        for tool in ["ping", "arp", "tracert"] {
            let resolved = system_tool(tool);
            let resolved = resolved.to_string_lossy().to_ascii_lowercase();
            assert!(
                resolved.contains("system32"),
                "{tool} should resolve under System32, got {resolved}"
            );
            assert!(
                resolved.ends_with(&format!("{tool}.exe")),
                "{tool} should resolve to {tool}.exe, got {resolved}"
            );
        }
    }

    #[test]
    fn tools_resolve_to_an_absolute_path() {
        // The whole fix is that the launched program is not a bare name, so
        // this is the assertion that actually pins it: a relative path is
        // resolved against directories an unprivileged attacker can write.
        let resolved = system_tool("arp");
        let path = std::path::Path::new(&resolved);
        assert!(
            path.is_absolute(),
            "expected an absolute path, got {resolved:?}"
        );
    }
}
