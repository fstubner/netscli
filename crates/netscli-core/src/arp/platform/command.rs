use std::process::Command;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

pub(super) fn command(program: &str) -> Command {
    #[cfg(target_os = "windows")]
    {
        let mut command = Command::new(program);
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
