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
//! Control characters are not the whole of it. A bidirectional override
//! (U+202E) makes a terminal or a web page that honours it show the text
//! after it backwards, so a hostname can read as something it is not, and the
//! zero-width characters hide text that is there or let two different names
//! look the same. None of them is a control character by Unicode's
//! definition, so `char::is_control` lets every one through.
//!
//! So: strip both at the point where remote data becomes a displayable
//! string. [`is_unsafe_for_display`] is the one definition of "both", and
//! everything that cleans remote text for display uses it.
//!
//! **Where this is not called.** `--json` / `--yaml` go through serde, which
//! escapes control characters as part of producing valid JSON/YAML. It does
//! not escape the bidi and zero-width characters, and those formats are for
//! programs rather than people, so they carry the text as received. The TUI
//! cleans the lines it stores rather than each string it formats, because
//! ratatui itself only drops control characters.

/// Whether `c` has no business in text that a person will read or a
/// terminal will print.
///
/// That is every control character, plus the ones that leave the terminal
/// alone and deceive the reader instead:
///
/// - the bidirectional controls, which reorder what follows them (U+061C,
///   U+200E, U+200F, U+202A to U+202E and the isolates U+2066 to U+2069);
/// - the zero-width characters and the rest of the invisible formatting in
///   the same block (U+200B to U+200D, U+2060 to U+2064, U+206A to U+206F
///   and U+FEFF);
/// - the line and paragraph separators U+2028 and U+2029, which some
///   renderers treat as line breaks.
///
/// This costs the legitimate uses of the zero-width joiner and non-joiner
/// (emoji sequences, some Persian and Indic words), which come out as
/// separate characters with a `.` between. A hostname or a banner rarely
/// carries them, and a reordering override costs the reader more.
pub fn is_unsafe_for_display(c: char) -> bool {
    c.is_control()
        || matches!(
            c,
            '\u{061C}'
                | '\u{200B}'..='\u{200F}'
                | '\u{2028}'
                | '\u{2029}'
                | '\u{202A}'..='\u{202E}'
                | '\u{2060}'..='\u{206F}'
                | '\u{FEFF}'
        )
}

/// Replace every character [`is_unsafe_for_display`] flags with `'.'`.
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
    if !value.chars().any(is_unsafe_for_display) {
        return std::borrow::Cow::Borrowed(value);
    }
    std::borrow::Cow::Owned(
        value
            .chars()
            .map(|c| if is_unsafe_for_display(c) { '.' } else { c })
            .collect(),
    )
}

#[cfg(test)]
mod tests {
    use super::{is_unsafe_for_display, sanitize_for_terminal};

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
        // Right-to-left text is fine. It is the override characters that
        // reorder it which are not. Written as escapes so that this source
        // file does not itself reorder in an editor: Hebrew shalom, a space,
        // Arabic marhaba.
        let rtl = "\u{5E9}\u{5DC}\u{5D5}\u{5DD} \u{645}\u{631}\u{62D}\u{628}\u{627}";
        assert_eq!(sanitize_for_terminal(rtl), rtl);
    }

    #[test]
    fn bidi_overrides_are_stripped() {
        // The classic: an override that makes "evil.exe" display as
        // "evil" + the reverse of what follows it.
        assert_eq!(
            sanitize_for_terminal("invoice\u{202E}fdp.exe"),
            "invoice.fdp.exe"
        );
        // Embeddings, isolates and the directional marks.
        for c in [
            '\u{202A}', '\u{202B}', '\u{202C}', '\u{202D}', '\u{2066}', '\u{2067}', '\u{2068}',
            '\u{2069}', '\u{200E}', '\u{200F}', '\u{061C}',
        ] {
            assert_eq!(
                sanitize_for_terminal(&format!("a{c}b")),
                "a.b",
                "U+{:04X} survived",
                c as u32
            );
        }
    }

    #[test]
    fn zero_width_characters_are_stripped() {
        for c in [
            '\u{200B}', '\u{200C}', '\u{200D}', '\u{2060}', '\u{2061}', '\u{206A}', '\u{FEFF}',
            '\u{2028}', '\u{2029}',
        ] {
            assert_eq!(
                sanitize_for_terminal(&format!("a{c}b")),
                "a.b",
                "U+{:04X} survived",
                c as u32
            );
        }
    }

    #[test]
    fn characters_next_to_the_blocked_ranges_are_kept() {
        // Pins the edges of each range, so a range written one off does not
        // start eating ordinary punctuation and spaces.
        for c in [
            '\u{200A}', '\u{2010}', '\u{2027}', '\u{202F}', '\u{205F}', '\u{2070}', '\u{061B}',
            '\u{061D}', '\u{FEFE}', '\u{FF00}',
        ] {
            assert!(!is_unsafe_for_display(c), "U+{:04X} was blocked", c as u32);
        }
    }

    #[test]
    fn hidden_characters_keep_the_visual_length() {
        let hostile = "a\u{200B}b\u{202E}c";
        assert_eq!(sanitize_for_terminal(hostile).chars().count(), 5);
    }
}
