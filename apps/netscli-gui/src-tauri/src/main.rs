// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod state;

use std::sync::Mutex;

use commands::{
    cancel_operation, capture_pcap, choose_file_save_default_directory, clear_arp_table,
    clear_file_save_default_directory, discover_mdns, discover_network, dns_lookup,
    export_text_file, get_arp_table, get_default_interface, get_file_save_preferences,
    get_network_stats, inspect_host_cmd, list_interfaces, list_monitorable_interfaces,
    mdns_capability, open_pcap_file, open_result_bundle, open_saved_artifact, pcap_capability,
    ping_host, reveal_saved_artifact, reverse_dns_lookup, save_result_bundle, scan_ports,
    set_file_save_ask_each_time, sweep_network, trace_route_cmd,
};
use netscli_core::NetworkMonitor;
use state::{ArtifactRegistry, OperationManager};

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

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(Mutex::new(None::<NetworkMonitor>))
        .manage(OperationManager::default())
        .manage(ArtifactRegistry::default())
        .invoke_handler(tauri::generate_handler![
            cancel_operation,
            ping_host,
            trace_route_cmd,
            reverse_dns_lookup,
            discover_mdns,
            discover_network,
            scan_ports,
            inspect_host_cmd,
            sweep_network,
            dns_lookup,
            list_interfaces,
            clear_arp_table,
            get_arp_table,
            mdns_capability,
            pcap_capability,
            capture_pcap,
            open_pcap_file,
            export_text_file,
            save_result_bundle,
            open_result_bundle,
            open_saved_artifact,
            reveal_saved_artifact,
            get_file_save_preferences,
            set_file_save_ask_each_time,
            choose_file_save_default_directory,
            clear_file_save_default_directory,
            get_network_stats,
            list_monitorable_interfaces,
            get_default_interface
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
