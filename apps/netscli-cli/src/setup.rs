mod commands;
mod detection;
mod render;
mod state;

use anyhow::{anyhow, Result};
use chrono::Utc;
use dialoguer::{theme::ColorfulTheme, Confirm};

pub use state::{config_exists, DependencyStatus, SetupState};

use commands::{recommend_commands, run_command_line};
use detection::collect_status;
use render::{
    print_dependency_status, print_diagnostics, print_final_status, print_post_install_status,
    print_recommended_commands,
};
use state::{load_state, save_state};

pub async fn run_setup(execute: bool, print_only: bool) -> Result<()> {
    let theme = ColorfulTheme::default();

    println!("\n🚀 Welcome to NetsCLI Setup Wizard\n");

    let deps = collect_status().await;
    let mut state = SetupState {
        last_checked: Some(Utc::now()),
        deps: deps.clone(),
    };

    print_dependency_status(&deps);

    let missing: Vec<_> = deps.iter().filter(|d| !d.installed).collect();
    if missing.is_empty() {
        println!("\n✨ All optional dependencies are installed!\n");
        save_state(&state)?;
        return Ok(());
    }

    if !print_only && !execute {
        run_interactive_setup(&theme, &missing, &mut state).await?;
        return Ok(());
    }

    if print_only {
        let commands = recommend_commands();
        print_recommended_commands(&commands);
        save_state(&state)?;
        return Ok(());
    }

    if execute {
        run_non_interactive_setup(&mut state).await?;
    }

    Ok(())
}

async fn run_interactive_setup(
    theme: &ColorfulTheme,
    missing: &[&DependencyStatus],
    state: &mut SetupState,
) -> Result<()> {
    println!("\n📦 Missing dependencies detected. Let's set them up:\n");

    let commands = recommend_commands();
    let mut to_install = Vec::new();

    for (idx, dep) in missing.iter().enumerate() {
        let install_cmd = commands.get(idx).or_else(|| commands.first());
        let Some(install_cmd) = install_cmd else {
            println!("  ⚠️  No install command available for {}", dep.name);
            continue;
        };

        let should_install = Confirm::with_theme(theme)
            .with_prompt(format!("Install {}?", dep.name))
            .default(true)
            .interact()?;

        if should_install {
            to_install.push((dep.name.clone(), install_cmd.clone()));
        }
    }

    if to_install.is_empty() {
        println!("\n⏭️  Skipping installation. You can run `netscli setup --execute` later.\n");
        save_state(state)?;
        return Ok(());
    }

    println!("\n🔧 Installing dependencies...\n");
    for (name, cmdline) in &to_install {
        println!("Installing {}...", name);
        let Some(status) = run_command_line(cmdline).await? else {
            println!("  ⚠️  Nothing to run.");
            continue;
        };

        if status.success() {
            println!("  ✅ {} installed successfully", name);
        } else {
            println!("  ❌ {} installation failed (exit code: {})", name, status);
        }
    }

    let refreshed = collect_status().await;
    state.deps = refreshed.clone();
    save_state(state)?;
    print_final_status(&refreshed);

    Ok(())
}

async fn run_non_interactive_setup(state: &mut SetupState) -> Result<()> {
    let commands = recommend_commands();
    println!("\n🔧 Installing dependencies (non-interactive mode)...\n");

    if let Some(cmdline) = commands.first() {
        println!("Running: {}\n", cmdline);
        match run_command_line(cmdline).await? {
            Some(status) if status.success() => println!("✅ Install command succeeded."),
            Some(status) => println!("❌ Install command exited with status {}", status),
            None => println!("Nothing to run."),
        }
    }

    let refreshed = collect_status().await;
    state.deps = refreshed.clone();
    save_state(state)?;
    print_post_install_status(&refreshed);

    Ok(())
}

pub async fn print_status(json: bool, yaml: bool) -> Result<()> {
    // Validate flag combinations BEFORE doing any work (including writing
    // state to disk) so `--json --yaml` is a clean rejection instead of a
    // half-completed mutation.
    if json && yaml {
        return Err(anyhow!("Use only one of --json or --yaml"));
    }

    let deps = collect_status().await;
    let mut state = load_state().unwrap_or_default();
    state.last_checked = Some(Utc::now());
    state.deps = deps.clone();
    save_state(&state)?;

    if yaml {
        println!("{}", serde_yaml_ng::to_string(&state)?);
    } else if json {
        println!("{}", serde_json::to_string_pretty(&state)?);
    } else {
        print_diagnostics(&deps);
    }
    Ok(())
}
