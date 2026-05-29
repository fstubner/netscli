// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod state;

use std::sync::Mutex;

use commands::{
    cancel_operation, capture_pcap, discover_network, dns_lookup, export_text_file, get_arp_table,
    get_default_interface, get_network_stats, inspect_host_cmd, list_interfaces, scan_ports,
    sweep_network,
};
use netscli_core::NetworkMonitor;
use state::OperationManager;

fn configure_dev_oui_path() {
    // Set OUI database path for dev builds so vendor lookup works.
    // Release builds pick up the bundled resource via Tauri and the
    // library's include_bytes! fallback handles cargo install users,
    // so this is only for `npm run tauri dev` from the crate dir.
    #[cfg(debug_assertions)]
    if std::env::var("NETSCLI_OUI_PATH").is_err() {
        let candidates = [
            "data/oui.min.json.gz",
            "../../../crates/netscli-core/data/oui.min.json.gz",
            "../../crates/netscli-core/data/oui.min.json.gz",
        ];
        for cand in candidates {
            if std::path::Path::new(cand).exists() {
                unsafe { std::env::set_var("NETSCLI_OUI_PATH", cand) };
                break;
            }
        }
    }
}

fn main() {
    configure_dev_oui_path();

    let monitor = NetworkMonitor::new();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(Mutex::new(monitor))
        .manage(OperationManager::default())
        .invoke_handler(tauri::generate_handler![
            cancel_operation,
            discover_network,
            scan_ports,
            inspect_host_cmd,
            sweep_network,
            dns_lookup,
            list_interfaces,
            get_arp_table,
            capture_pcap,
            export_text_file,
            get_network_stats,
            get_default_interface
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
