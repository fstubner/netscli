use pcap::Device;
use std::{collections::HashSet, net::IpAddr};

use crate::error::{Error, Result};
use crate::NetworkManager;

pub(super) fn resolve_capture_device(devices: &[Device], requested: &str) -> Result<Device> {
    let requested = requested.trim();
    if requested.is_empty() {
        return Err(Error::invalid_input("capture interface is required"));
    }

    if let Some(device) = devices
        .iter()
        .find(|device| device_matches_label(device, requested))
    {
        return Ok(device.clone());
    }

    if let Some(device) = resolve_by_platform_adapter(devices, requested) {
        return Ok(device);
    }

    if let Some(device) = resolve_by_interface_addresses(devices, requested) {
        return Ok(device);
    }

    let available = devices
        .iter()
        .map(device_display_name)
        .collect::<Vec<_>>()
        .join(", ");
    Err(Error::invalid_input(format!(
        "Interface not found: {requested}. Available capture interfaces: {available}",
    )))
}

fn device_matches_label(device: &Device, requested: &str) -> bool {
    let requested = normalized_name(requested);
    if normalized_name(&device.name) == requested {
        return true;
    }

    device
        .desc
        .as_deref()
        .map(normalized_name)
        .is_some_and(|desc| desc == requested || desc.contains(&requested))
}

fn resolve_by_interface_addresses(devices: &[Device], requested: &str) -> Option<Device> {
    let requested = normalized_name(requested);
    let iface = NetworkManager::get_interfaces()
        .into_iter()
        .find(|iface| normalized_name(&iface.name) == requested)?;
    let ips = iface.ips.iter().map(|ip| ip.addr()).collect::<HashSet<_>>();

    device_by_addresses(devices, &ips)
}

fn device_by_addresses(devices: &[Device], ips: &HashSet<IpAddr>) -> Option<Device> {
    if ips.is_empty() {
        return None;
    }

    devices
        .iter()
        .find(|device| {
            device
                .addresses
                .iter()
                .any(|address| ips.contains(&address.addr))
        })
        .cloned()
}

#[cfg(target_os = "windows")]
fn resolve_by_platform_adapter(devices: &[Device], requested: &str) -> Option<Device> {
    let requested = normalized_name(requested);
    let adapters = ipconfig::get_adapters().ok()?;

    for adapter in adapters {
        let friendly_name = adapter.friendly_name();
        let adapter_name = adapter.adapter_name();
        let requested_matches_adapter = normalized_name(friendly_name) == requested
            || normalized_name(adapter_name) == requested;

        if !requested_matches_adapter {
            continue;
        }

        let adapter_token = adapter_name.trim_matches(|c| c == '{' || c == '}');
        if let Some(device) = devices.iter().find(|device| {
            device.name.contains(adapter_name)
                || device.name.contains(adapter_token)
                || device_matches_label(device, friendly_name)
        }) {
            return Some(device.clone());
        }

        let ips = adapter
            .ip_addresses()
            .iter()
            .copied()
            .collect::<HashSet<IpAddr>>();
        if let Some(device) = device_by_addresses(devices, &ips) {
            return Some(device);
        }
    }

    None
}

#[cfg(not(target_os = "windows"))]
fn resolve_by_platform_adapter(_devices: &[Device], _requested: &str) -> Option<Device> {
    None
}

fn normalized_name(value: &str) -> String {
    value.trim().to_ascii_lowercase()
}

fn device_display_name(device: &Device) -> String {
    match device
        .desc
        .as_deref()
        .filter(|desc| !desc.trim().is_empty())
    {
        Some(desc) => format!("{desc} ({})", device.name),
        None => device.name.clone(),
    }
}
