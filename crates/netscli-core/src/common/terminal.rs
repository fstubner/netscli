//! Making remote-controlled strings safe to print to a terminal.
//!
//! Almost everything netscli reports is supplied by something else on the
//! network: reverse-DNS hostnames, TXT record contents, service banners,
//! mDNS instance names, TLS metadata. All of it is attacker-influenced —
//! a hostile authoritative DNS server picks its own TXT bytes, and any
//! device on the local link can announce whatever mDNS name it likes.
//!
//! When that lands in a terminal via `println!`, an embedded `ESC` is not
//! inert. ANSI/OSC sequences can repaint the screen, hide or fabricate
//! output lines, set (and on some emulators read back) the window title,
//! and write the clipboard via OSC 52. For a tool whose entire value is
//! the operator trusting what it prints, forged output is the interesting
//! attack, not a cosmetic glitch.
//!
//! So: strip control characters at the point where remote data becomes a
//! displayable string.
//!
//! **Why this is not needed everywhere.** Two of netscli's output paths
//! are already structurally safe and deliberately do not call this:
//!
//! - The TUI renders through ratatui, which filters control characters
//!   out of graphemes before they reach the cell buffer.
//! - `--json` / `--yaml` go through serde, which escapes control
//!   characters as part of producing valid JSON/YAML.
//!
//! The plain-text CLI path is the one that writes bytes straight to the
//! terminal, and that is what this module protects.

/// Replace every control character with `'.'`.
///
/// Keeps the string's visual length stable (one replacement per removed
/// character) so column-aligned table output does not shift, and returns
/// `Cow::Borrowed` when there is nothing to strip, which is the
/// overwhelmingly common case.
///
/// Unlike the scan-probe sanitizer, this strips `\n`, `\r`, and `\t` too.
/// A single-line display value has no business containing them: `\n`
/// fabricates extra output lines and `\r` lets a remote host overwrite
/// the row it was printed on.
pub fn sanitize_for_terminal(value: &str) -> std::borrow::Cow<'_, str> {
    if !value.chars().any(char::is_control) {
        return std::borrow::Cow::Borrowed(value);
    }
    std::borrow::Cow::Owned(
        value
            .chars()
            .map(|c| if c.is_control() { '.' } else { c })
            .collect(),
    )
}

#[cfg(test)]
mod tests {
    use super::sanitize_for_terminal;

    #[test]
    fn clean_input_is_borrowed_unchanged() {
        let out = sanitize_for_terminal("printer.local");
        assert_eq!(out, "printer.local");
        assert!(matches!(out, std::borrow::Cow::Borrowed(_)));
    }

    #[test]
    fn ansi_escape_is_stripped() {
        // The mDNS/DNS attack: a remote name carrying a colour sequence
        // plus a cursor-up, used to repaint lines already printed.
        let hostile = "evil\u{1b}[31m\u{1b}[1Aowned";
        let out = sanitize_for_terminal(hostile);
        assert!(!out.contains('\u{1b}'), "ESC survived: {out:?}");
        assert_eq!(out, "evil.[31m.[1Aowned");
    }

    #[test]
    fn newline_and_carriage_return_are_stripped() {
        // \n fabricates output lines; \r overwrites the current one.
        assert_eq!(sanitize_for_terminal("a\nb"), "a.b");
        assert_eq!(sanitize_for_terminal("real\rfake"), "real.fake");
        assert_eq!(sanitize_for_terminal("a\tb"), "a.b");
    }

    #[test]
    fn osc_52_clipboard_write_is_defused() {
        // OSC 52 is the nastiest of the family: it writes the user's
        // clipboard. It needs both the leading ESC and the terminating
        // BEL, and we remove both.
        let hostile = "host\u{1b}]52;c;ZWNobyBwd25lZAo=\u{7}";
        let out = sanitize_for_terminal(hostile);
        assert!(!out.contains('\u{1b}'));
        assert!(!out.contains('\u{7}'));
    }

    #[test]
    fn visual_width_is_preserved() {
        // One replacement character per control character, so table
        // column alignment computed from the sanitized string holds.
        let hostile = "ab\u{1b}\u{7}cd";
        assert_eq!(sanitize_for_terminal(hostile).chars().count(), 6);
    }

    #[test]
    fn unicode_is_left_alone() {
        assert_eq!(sanitize_for_terminal("café-über-日本"), "café-über-日本");
    }
}
