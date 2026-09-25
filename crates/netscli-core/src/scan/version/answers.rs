//! Product and version from services that don't announce themselves as a
//! line of text: MySQL's binary greeting, and the replies Redis and Memcached
//! give to the read-only question in `probes/asked.rs`.

use super::product_and_version;

type Found = Option<(String, Option<String>)>;

/// MySQL and MariaDB greet every connection with a handshake packet: three
/// length bytes, a sequence number, protocol version 10 (0x0a), then the
/// server version as a NUL-terminated string. MariaDB prefixes its version
/// with `5.5.5-` for old clients and names itself after it:
/// `5.5.5-10.11.6-MariaDB-0+deb12u1`.
///
/// A server refusing this client sends an error packet (0xff) instead, whose
/// message usually still names the server.
pub(in crate::scan) fn from_mysql_greeting(bytes: &[u8]) -> Found {
    let (header, payload) = (bytes.get(..4)?, bytes.get(4..)?);
    let length =
        usize::from(header[0]) | usize::from(header[1]) << 8 | usize::from(header[2]) << 16;
    if header[3] != 0 || !(5..=1024).contains(&length) {
        return None;
    }
    match payload.first()? {
        0x0a => {
            let end = payload[1..].iter().position(|&b| b == 0)?;
            let version = std::str::from_utf8(&payload[1..=end]).ok()?;
            if let Some(rest) = version.find("-MariaDB").map(|at| &version[..at]) {
                let rest = rest.strip_prefix("5.5.5-").unwrap_or(rest);
                return product_and_version("MariaDB", Some(rest));
            }
            let number = version.split('-').next()?;
            product_and_version("MySQL", Some(number))
        }
        0xff => {
            let message = String::from_utf8_lossy(payload);
            if message.contains("MariaDB") {
                product_and_version("MariaDB", None)
            } else if message.contains("MySQL") {
                product_and_version("MySQL", None)
            } else {
                None
            }
        }
        _ => None,
    }
}

/// The reply to `INFO server`. Valkey reports a `redis_version` too, for
/// compatibility, so its own field is checked first. A server that wants a
/// password, or is in protected mode, refuses the command but has still said
/// it's Redis.
pub(in crate::scan) fn from_redis_info(reply: &str) -> Found {
    let field = |name: &str| {
        reply
            .lines()
            .find_map(|line| line.trim().strip_prefix(name).map(str::to_string))
    };
    if let Some(version) = field("valkey_version:") {
        return product_and_version("Valkey", Some(&version));
    }
    if let Some(version) = field("redis_version:") {
        return product_and_version("Redis", Some(&version));
    }
    let refused = ["-NOAUTH", "-DENIED"]
        .iter()
        .any(|prefix| reply.starts_with(prefix));
    if refused {
        return product_and_version("Redis", None);
    }
    None
}

/// The reply to `version`: `VERSION 1.6.21`.
pub(in crate::scan) fn from_memcached(reply: &str) -> Found {
    let version = reply.trim().strip_prefix("VERSION ")?;
    product_and_version("Memcached", Some(version))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn found(product: &str, version: Option<&str>) -> Found {
        Some((product.to_string(), version.map(str::to_string)))
    }

    fn mysql_packet(payload: &[u8]) -> Vec<u8> {
        let len = payload.len();
        let mut packet = vec![len as u8, (len >> 8) as u8, (len >> 16) as u8, 0];
        packet.extend_from_slice(payload);
        packet
    }

    fn greeting(version: &str) -> Vec<u8> {
        let mut payload = vec![0x0a];
        payload.extend_from_slice(version.as_bytes());
        payload.push(0);
        payload.extend_from_slice(&[0x2a, 0, 0, 0, b'a', b'b', b'c', 0]);
        mysql_packet(&payload)
    }

    #[test]
    fn a_mysql_greeting_gives_the_server_version() {
        assert_eq!(
            from_mysql_greeting(&greeting("8.0.36-0ubuntu0.22.04.1")),
            found("MySQL", Some("8.0.36"))
        );
        assert_eq!(
            from_mysql_greeting(&greeting("5.5.5-10.11.6-MariaDB-0+deb12u1")),
            found("MariaDB", Some("10.11.6"))
        );
    }

    #[test]
    fn a_mysql_refusal_still_names_the_server() {
        let mut payload = vec![0xff, 0x6a, 0x04];
        payload
            .extend_from_slice(b"Host '10.0.0.5' is not allowed to connect to this MySQL server");
        assert_eq!(
            from_mysql_greeting(&mysql_packet(&payload)),
            found("MySQL", None)
        );
    }

    #[test]
    fn bytes_that_are_not_a_mysql_packet_give_nothing() {
        assert_eq!(from_mysql_greeting(b"SSH-2.0-OpenSSH_9.6\r\n"), None);
        assert_eq!(from_mysql_greeting(&[0x05, 0, 0, 0]), None);
        // A greeting whose version string is never terminated.
        assert_eq!(from_mysql_greeting(&mysql_packet(b"\x0a8.0.36")), None);
    }

    #[test]
    fn redis_and_valkey_answer_info() {
        let redis = "$3500\r\n# Server\r\nredis_version:7.2.4\r\nredis_git_sha1:00000000\r\n";
        assert_eq!(from_redis_info(redis), found("Redis", Some("7.2.4")));
        let valkey = "$3700\r\n# Server\r\nredis_version:7.2.4\r\nserver_name:valkey\r\nvalkey_version:8.0.1\r\n";
        assert_eq!(from_redis_info(valkey), found("Valkey", Some("8.0.1")));
    }

    #[test]
    fn a_redis_that_wants_a_password_is_still_redis() {
        assert_eq!(
            from_redis_info("-NOAUTH Authentication required.\r\n"),
            found("Redis", None)
        );
        assert_eq!(from_redis_info("+OK\r\n"), None);
    }

    #[test]
    fn memcached_answers_version() {
        assert_eq!(
            from_memcached("VERSION 1.6.21\r\n"),
            found("Memcached", Some("1.6.21"))
        );
        assert_eq!(from_memcached("ERROR\r\n"), None);
    }
}
