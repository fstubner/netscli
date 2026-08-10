use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DeviceCategory {
    Router,
    Printer,
    NAS,
    SmartTV,
    Mobile,
    Server,
    Workstation,
    Unknown,
}

impl DeviceCategory {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Router => "router",
            Self::Printer => "printer",
            Self::NAS => "nas",
            Self::SmartTV => "smart_tv",
            Self::Mobile => "mobile",
            Self::Server => "server",
            Self::Workstation => "workstation",
            Self::Unknown => "unknown",
        }
    }

    pub fn display_name(&self) -> &'static str {
        match self {
            Self::Router => "Router / Gateway",
            Self::Printer => "Printer",
            Self::NAS => "Network Attached Storage",
            Self::SmartTV => "Smart TV / Media",
            Self::Mobile => "Mobile Device",
            Self::Server => "Server",
            Self::Workstation => "Workstation / Desktop",
            Self::Unknown => "Network Device",
        }
    }
}

pub fn fingerprint_device(
    vendor: Option<&str>,
    hostname: Option<&str>,
    open_ports: &[u16],
) -> DeviceCategory {
    let vendor_lower = vendor.unwrap_or("").to_ascii_lowercase();
    let host_lower = hostname.unwrap_or("").to_ascii_lowercase();

    // 1. Check Port Signatures
    let has_print = open_ports.iter().any(|&p| matches!(p, 9100 | 515 | 631));
    let has_nas = open_ports.iter().any(|&p| matches!(p, 5000 | 5001 | 32400 | 8080));
    let has_tv = open_ports.iter().any(|&p| matches!(p, 8008 | 8009 | 8001 | 1900));
    let has_server_ports = open_ports
        .iter()
        .any(|&p| matches!(p, 22 | 3306 | 5432 | 6379 | 27017 | 8443));

    // 2. Check Hostname Hints
    if host_lower.contains("printer") || host_lower.contains("epson") || host_lower.contains("canon") || host_lower.contains("hp-") {
        return DeviceCategory::Printer;
    }
    if host_lower.contains("nas") || host_lower.contains("synology") || host_lower.contains("qnap") || host_lower.contains("truenas") {
        return DeviceCategory::NAS;
    }
    if host_lower.contains("tv") || host_lower.contains("chromecast") || host_lower.contains("sonos") || host_lower.contains("roku") || host_lower.contains("appletv") {
        return DeviceCategory::SmartTV;
    }
    if host_lower.contains("router") || host_lower.contains("gateway") || host_lower.contains("unifi") || host_lower.contains("openwrt") {
        return DeviceCategory::Router;
    }
    if host_lower.contains("iphone") || host_lower.contains("android") || host_lower.contains("ipad") || host_lower.contains("galaxy") {
        return DeviceCategory::Mobile;
    }

    // 3. Check Vendor Hints
    if vendor_lower.contains("canon") || vendor_lower.contains("epson") || vendor_lower.contains("lexmark") || vendor_lower.contains("brother") {
        return DeviceCategory::Printer;
    }
    if vendor_lower.contains("synology") || vendor_lower.contains("qnap") {
        return DeviceCategory::NAS;
    }
    if vendor_lower.contains("sonos") || vendor_lower.contains("roku") || vendor_lower.contains("lg electronics") {
        return DeviceCategory::SmartTV;
    }
    if vendor_lower.contains("cisco") || vendor_lower.contains("ubiquiti") || vendor_lower.contains("tp-link") || vendor_lower.contains("netgear") || vendor_lower.contains("asus") {
        return DeviceCategory::Router;
    }
    if vendor_lower.contains("apple") && (host_lower.contains("phone") || host_lower.contains("watch")) {
        return DeviceCategory::Mobile;
    }

    // 4. Fallback to Port-based Rules
    if has_print {
        return DeviceCategory::Printer;
    }
    if has_nas && (vendor_lower.contains("synology") || vendor_lower.contains("qnap") || host_lower.contains("storage")) {
        return DeviceCategory::NAS;
    }
    if has_tv {
        return DeviceCategory::SmartTV;
    }
    if has_server_ports {
        return DeviceCategory::Server;
    }

    DeviceCategory::Unknown
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_printer_fingerprint() {
        assert_eq!(
            fingerprint_device(Some("Canon Inc."), None, &[9100]),
            DeviceCategory::Printer
        );
        assert_eq!(
            fingerprint_device(None, Some("office-epson-printer.local"), &[]),
            DeviceCategory::Printer
        );
    }

    #[test]
    fn test_router_fingerprint() {
        assert_eq!(
            fingerprint_device(Some("TP-Link Corporation"), Some("tplinkwifi.net"), &[80, 443, 53]),
            DeviceCategory::Router
        );
    }

    #[test]
    fn test_nas_fingerprint() {
        assert_eq!(
            fingerprint_device(Some("Synology Inc."), Some("DS920plus"), &[5000, 5001]),
            DeviceCategory::NAS
        );
    }
}
