use mac_address::MacAddress;
use std::net::IpAddr;

use super::command;
use crate::error::{Error, Result};

/// Run an `arp` mutation on Windows and fail when it reports a problem.
///
/// `arp.exe` exits 0 even when it changed nothing. Unelevated, all three
/// mutations print "The requested operation requires elevation." and return
/// success:
///
/// ```text
/// > arp -s 192.0.2.77 aa-bb-cc-dd-ee-ff
/// The ARP entry addition failed: The requested operation requires elevation.
/// > echo %ERRORLEVEL%
/// 0
/// ```
///
/// Checking the exit status alone therefore reports a table change that never
/// happened, and the CLI printed "ARP entry added for 192.0.2.77" (and
/// `"ok": true` in JSON) after doing nothing -- a silent wrong answer, which
/// is the worst kind. `clear_table` was fixed for this; `add_entry` and
/// `delete_entry` were left with the same fault one function away, so the
/// check lives here where all three must pass through it.
///
/// On success these commands print nothing, so any output at all is a
/// failure. That test is locale-independent, unlike matching the message
/// text, and it fails loudly rather than quietly if a future Windows build
/// becomes chattier on success.
#[cfg(target_os = "windows")]
fn run_arp_mutation(args: &[&str], failure: &str) -> Result<()> {
    let output = command::arp_command().args(args).output()?;
    interpret_arp_output(&output, failure)
}

/// The decision `run_arp_mutation` makes, split from the process call so a
/// test can pin it. Running `arp` for real would need an elevated machine to
/// exercise the success arm and an unelevated one for the failure arm.
#[cfg(target_os = "windows")]
fn interpret_arp_output(output: &std::process::Output, failure: &str) -> Result<()> {
    let mut reported = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if reported.is_empty() {
        reported = String::from_utf8_lossy(&output.stdout).trim().to_string();
    }
    if !output.status.success() || !reported.is_empty() {
        return Err(Error::Other(format!(
            "{failure}: {}",
            if reported.is_empty() {
                "arp reported no reason (run as administrator?)".to_string()
            } else {
                reported
            }
        )));
    }
    Ok(())
}

pub(super) fn add_entry(ip: IpAddr, mac: MacAddress) -> Result<()> {
    #[cfg(target_os = "windows")]
    {
        run_arp_mutation(
            &["-s", &ip.to_string(), &mac.to_string().replace(":", "-")],
            "Failed to add ARP entry",
        )?;
    }
    #[cfg(not(target_os = "windows"))]
    {
        let status = command::arp_command()
            .args(["-s", &ip.to_string(), &mac.to_string()])
            .status()?;
        if !status.success() {
            return Err(Error::Other(
                "Failed to add ARP entry (requires root/admin privileges)".into(),
            ));
        }
    }
    Ok(())
}

pub(super) fn delete_entry(ip: IpAddr) -> Result<()> {
    #[cfg(target_os = "windows")]
    {
        run_arp_mutation(&["-d", &ip.to_string()], "Failed to delete ARP entry")?;
    }
    #[cfg(not(target_os = "windows"))]
    {
        let status = command::arp_command()
            .args(["-d", &ip.to_string()])
            .status()?;
        if !status.success() {
            return Err(Error::Other(
                "Failed to delete ARP entry (requires root/admin privileges)".into(),
            ));
        }
    }
    Ok(())
}

pub(super) fn clear_table() -> Result<()> {
    #[cfg(target_os = "windows")]
    {
        run_arp_mutation(&["-d", "*"], "Failed to clear ARP table")
    }
    #[cfg(target_os = "macos")]
    {
        let status = command::arp_command().args(["-d", "-a"]).status()?;
        if !status.success() {
            return Err(Error::Other("Failed to clear ARP table".into()));
        }
        Ok(())
    }
    #[cfg(target_os = "linux")]
    {
        // `ip neigh flush all` rather than a loop of `arp -d`: iproute2
        // clears the whole neighbour table in one call, and Linux's `arp -d`
        // takes no wildcard.
        let status = command::command("ip")
            .args(["neigh", "flush", "all"])
            .status()?;
        if !status.success() {
            return Err(Error::Other(
                "Failed to clear ARP table (iproute2 required)".into(),
            ));
        }
        Ok(())
    }
    // Anything else -- the BSDs, Solaris, an unusual target -- had no branch
    // at all. The nested `cfg`s fell through to a bare `Ok(())`, so a build
    // for such a target reported a cleared table having run nothing. Say what
    // is true instead.
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        Err(Error::Other(format!(
            "Clearing the ARP table is not implemented on {}",
            std::env::consts::OS
        )))
    }
}

#[cfg(all(test, target_os = "windows"))]
mod tests {
    use super::*;
    use std::os::windows::process::ExitStatusExt;
    use std::process::{ExitStatus, Output};

    fn output(code: u32, stdout: &str, stderr: &str) -> Output {
        Output {
            status: ExitStatus::from_raw(code),
            stdout: stdout.as_bytes().to_vec(),
            stderr: stderr.as_bytes().to_vec(),
        }
    }

    #[test]
    fn a_zero_exit_with_a_complaint_is_a_failure() {
        // The whole point. `arp -s` and `arp -d` unelevated print this and
        // exit 0, and checking the status alone reported an ARP entry the
        // machine never got.
        let result = interpret_arp_output(
            &output(
                0,
                "The ARP entry addition failed: The requested operation requires elevation.",
                "",
            ),
            "Failed to add ARP entry",
        );

        let message = result
            .expect_err("a zero exit with output must not pass")
            .to_string();
        assert!(message.starts_with("Failed to add ARP entry:"), "{message}");
        assert!(message.contains("requires elevation"), "{message}");
    }

    #[test]
    fn a_complaint_on_stderr_counts_too() {
        assert!(interpret_arp_output(&output(0, "", "something went wrong"), "Failed").is_err());
    }

    #[test]
    fn a_silent_zero_exit_is_the_only_success() {
        assert!(interpret_arp_output(&output(0, "", ""), "Failed").is_ok());
        assert!(interpret_arp_output(&output(0, "   \r\n", ""), "Failed").is_ok());
    }

    #[test]
    fn a_nonzero_exit_still_fails_when_it_says_nothing() {
        let message = interpret_arp_output(&output(1, "", ""), "Failed to clear ARP table")
            .expect_err("a non-zero exit must fail")
            .to_string();
        assert!(message.contains("run as administrator?"), "{message}");
    }
}
