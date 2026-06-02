use super::state::DependencyStatus;

pub(super) fn print_dependency_status(deps: &[DependencyStatus]) {
    println!("📋 Checking dependencies...\n");
    for d in deps {
        let status = if d.installed { "✓" } else { "✗" };
        let icon = if d.installed { "✅" } else { "❌" };
        println!("  {} {} {}", icon, status, d.name);
        if let Some(info) = &d.details {
            println!("      {}", info);
        }
    }
}

pub(super) fn print_final_status(deps: &[DependencyStatus]) {
    println!("\n📊 Final status:\n");
    print_compact_status(deps);
}

pub(super) fn print_post_install_status(deps: &[DependencyStatus]) {
    println!("\n📊 Post-install status:\n");
    print_compact_status(deps);
}

pub(super) fn print_recommended_commands(commands: &[String]) {
    println!("\n📋 Recommended install commands:\n");
    for cmd in commands {
        println!("  {}", cmd);
    }
    println!("\n💡 Copy and paste these commands to install dependencies.\n");
}

pub(super) fn print_diagnostics(deps: &[DependencyStatus]) {
    println!("NetsCLI diagnostics:");
    for d in deps {
        let status = if d.installed { "✓" } else { "✗" };
        println!("  {} {}", status, d.name);
        if let Some(info) = &d.details {
            println!("      {}", info);
        }
    }
}

fn print_compact_status(deps: &[DependencyStatus]) {
    for d in deps {
        let icon = if d.installed { "✅" } else { "❌" };
        println!("  {} {}", icon, d.name);
    }
    println!();
}
