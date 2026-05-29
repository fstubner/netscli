use anyhow::{Context, Result};
use clap::CommandFactory;
use clap_complete::Shell;
use std::io;

pub(super) fn print_completions<T: CommandFactory>(shell: Shell) {
    let mut cmd = T::command();
    let name = cmd.get_name().to_string();
    clap_complete::generate(shell, &mut cmd, name, &mut io::stdout());
}

pub(super) fn print_man<T: CommandFactory>() -> Result<()> {
    let cmd = T::command();
    let man = clap_mangen::Man::new(cmd);
    man.render(&mut io::stdout())
        .context("rendering man page")?;
    Ok(())
}
