use std::io::ErrorKind;

use super::types::PortStatus;

/// Map well-known port numbers to their canonical service name.
///
/// Extended from the original 15-entry list to cover the services users
/// most commonly encounter when scanning home/office networks.
pub(super) fn guess_service(port: u16) -> Option<String> {
    let name = match port {
        20 => "ftp-data",
        21 => "ftp",
        22 => "ssh",
        23 => "telnet",
        25 => "smtp",
        53 => "dns",
        67 => "dhcp-server",
        68 => "dhcp-client",
        69 => "tftp",
        80 => "http",
        110 => "pop3",
        111 => "rpcbind",
        123 => "ntp",
        135 => "msrpc",
        137 => "netbios-ns",
        138 => "netbios-dgm",
        139 => "netbios-ssn",
        143 => "imap",
        161 => "snmp",
        162 => "snmp-trap",
        389 => "ldap",
        443 => "https",
        445 => "smb",
        465 => "smtps",
        514 => "syslog",
        587 => "smtp-submission",
        636 => "ldaps",
        873 => "rsync",
        993 => "imaps",
        995 => "pop3s",
        1080 => "socks",
        1433 => "mssql",
        1521 => "oracle",
        1723 => "pptp",
        1883 => "mqtt",
        2049 => "nfs",
        2375 => "docker",
        2376 => "docker-tls",
        3000 => "dev-http",
        3306 => "mysql",
        3389 => "rdp",
        4369 => "epmd",
        5000 => "upnp",
        5060 => "sip",
        5061 => "sips",
        5222 => "xmpp-client",
        5432 => "postgresql",
        5601 => "kibana",
        5672 => "amqp",
        5900 => "vnc",
        5984 => "couchdb",
        6379 => "redis",
        6443 => "kubernetes-api",
        6667 => "irc",
        7000 => "cassandra",
        8000 => "dev-http",
        8008 => "http-alt",
        8080 => "http-alt",
        8081 => "http-alt",
        8086 => "influxdb",
        8443 => "https-alt",
        8888 => "http-alt",
        9000 => "http-alt",
        9042 => "cassandra",
        9090 => "prometheus",
        9092 => "kafka",
        9200 => "elasticsearch",
        9418 => "git",
        11211 => "memcached",
        15672 => "rabbitmq-mgmt",
        27017 => "mongodb",
        27018 => "mongodb",
        50000 => "sap",
        _ => return None,
    };
    Some(name.to_string())
}

pub(super) fn classify_connect_error(kind: ErrorKind) -> PortStatus {
    match kind {
        ErrorKind::ConnectionRefused => PortStatus::Closed,
        ErrorKind::TimedOut => PortStatus::Filtered,
        _ => PortStatus::Error,
    }
}

pub(super) fn is_http_port(port: u16, service: Option<&str>) -> bool {
    matches!(port, 80 | 8000 | 8008 | 8080 | 8081 | 8888 | 9000)
        || service
            .map(|s| s.contains("http") && !s.contains("https"))
            .unwrap_or(false)
}

pub(super) fn is_https_port(port: u16, service: Option<&str>) -> bool {
    matches!(port, 443 | 8443 | 9443) || service.map(|s| s.contains("https")).unwrap_or(false)
}

pub(super) fn is_tls_port(port: u16, service: Option<&str>) -> bool {
    is_https_port(port, service)
        || matches!(port, 465 | 636 | 993 | 995 | 5061 | 2376)
        || service
            .map(|s| s.ends_with('s') || s.contains("tls"))
            .unwrap_or(false)
}
