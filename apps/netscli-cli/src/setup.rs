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
    for dep in missing {
        println!("  ✗ {}", dep.name);
    }

    let commands = recommend_commands();

    // The recommended steps are not per-dependency — one platform's set
    // installs everything we look for. Pairing them positionally against
    // `missing` meant that with both libpcap and tcpdump absent the user
    // was asked twice and the *same* command ran twice. Ask once, then
    // run the whole set in order.
    let (runnable, advisory): (Vec<_>, Vec<_>) = commands.iter().partition(|c| c.runnable);

    if !advisory.is_empty() {
        println!("\n📋 These steps have to be done manually:\n");
        for cmd in &advisory {
            println!("  {}", cmd.display);
        }
    }

    if runnable.is_empty() {
        println!("\n⏭️  Nothing can be installed automatically on this platform.\n");
        save_state(state)?;
        return Ok(());
    }

    println!("\n📋 Will run:\n");
    for cmd in &runnable {
        println!("  {}", cmd.display);
    }
    println!();

    let should_install = Confirm::with_theme(theme)
        .with_prompt("Run these install commands?")
        .default(true)
        .interact()?;

    if !should_install {
        println!("\n⏭️  Skipping installation. You can run `netscli setup --execute` later.\n");
        save_state(state)?;
        return Ok(());
    }

    println!("\n🔧 Installing dependencies...\n");
    for cmd in &runnable {
        println!("Running: {}", cmd.display);
        let Some(status) = run_command_line(&cmd.display).await? else {
            println!("  ⚠️  Nothing to run.");
            continue;
        };

        if status.success() {
            println!("  ✅ succeeded");
        } else {
            // Later steps usually depend on earlier ones (apt-get update
            // before apt-get install), so don't press on after a failure.
            println!("  ❌ failed (exit code: {})", status);
            break;
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

    // Run every runnable step, not just the first — on Linux the update
    // and the install are two separate argv invocations.
    let mut ran_any = false;
    for cmd in commands.iter().filter(|c| c.runnable) {
        ran_any = true;
        println!("Running: {}", cmd.display);
        match run_command_line(&cmd.display).await? {
            Some(status) if status.success() => println!("  ✅ succeeded"),
            Some(status) => {
                println!("  ❌ exited with status {}", status);
                break;
            }
            None => println!("  Nothing to run."),
        }
    }

    for cmd in commands.iter().filter(|c| !c.runnable) {
        println!("\n📋 Manual step required:\n  {}", cmd.display);
    }

    if !ran_any {
        println!("Nothing can be installed automatically on this platform.");
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
