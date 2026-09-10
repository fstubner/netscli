use std::process::Command;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

pub(super) fn command(program: &str) -> Command {
    #[cfg(target_os = "windows")]
    {
        // Absolute System32 path, not the bare name: the directory holding
        // netscli.exe is user-writable on every Windows CLI install path,
        // Windows searches it, and `arp` mutations run elevated. See
        // `common::system_tools`.
        let mut command = Command::new(crate::common::system_tool(program));
        command.creation_flags(CREATE_NO_WINDOW);
        command
    }

    #[cfg(not(target_os = "windows"))]
    {
        Command::new(program)
    }
}

pub(super) fn arp_command() -> Command {
    command("arp")
}
