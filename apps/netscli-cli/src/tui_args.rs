//! Splitting what is typed after a slash command into arguments, for the
//! commands that take a value with spaces in it: a BPF filter such as
//! `tcp port 80`, or a path such as `C:\My Scans\out.md`.
//!
//! Whitespace separates arguments. A value that starts with a quote, `"` or
//! `'`, runs to the matching quote, spaces included, and loses the quotes. A
//! backslash is an ordinary character everywhere. A shell splitter treats it as
//! an escape, which turned `C:\Users\me\out.md` into `C:Usersmeout.md` and ate
//! a backslash from a `\\server\share` path. There is no way to write a quote
//! inside quotes, and none is wanted here: a quote in the middle of a value,
//! as in `O'Brien`, is just a character.

/// Split `input` into arguments. The only way this fails is a quote that is
/// never closed.
pub(crate) fn split_args(input: &str) -> Result<Vec<String>, String> {
    let mut args = Vec::new();
    let mut current = String::new();
    // True from the first character of an argument, so that `""` still makes
    // an (empty) argument.
    let mut started = false;
    let mut quote: Option<char> = None;

    for c in input.chars() {
        match quote {
            Some(open) if c == open => quote = None,
            Some(_) => current.push(c),
            None if c.is_whitespace() => {
                if started {
                    args.push(std::mem::take(&mut current));
                    started = false;
                }
            }
            None if (c == '"' || c == '\'') && !started => {
                quote = Some(c);
                started = true;
            }
            None => {
                current.push(c);
                started = true;
            }
        }
    }

    if let Some(open) = quote {
        return Err(format!("the {open} quote is never closed"));
    }
    if started {
        args.push(current);
    }
    Ok(args)
}

#[cfg(test)]
mod tests {
    use super::split_args;

    fn split(input: &str) -> Vec<String> {
        split_args(input).unwrap()
    }

    #[test]
    fn plain_words_split_on_whitespace() {
        assert_eq!(split("/scan  host\t22,80 "), ["/scan", "host", "22,80"]);
        assert!(split("   ").is_empty());
    }

    #[test]
    fn a_quoted_filter_stays_one_argument() {
        // The case that was cut to its first word.
        assert_eq!(
            split(r#"/pcap eth0 --filter "tcp port 80" --duration 5"#),
            [
                "/pcap",
                "eth0",
                "--filter",
                "tcp port 80",
                "--duration",
                "5"
            ]
        );
        assert_eq!(
            split("/pcap eth0 --filter 'host 10.0.0.1 and port 22'"),
            ["/pcap", "eth0", "--filter", "host 10.0.0.1 and port 22"]
        );
    }

    #[test]
    fn backslashes_are_part_of_a_path() {
        assert_eq!(
            split(r"/export -o C:\Users\me\out.md"),
            ["/export", "-o", r"C:\Users\me\out.md"]
        );
        assert_eq!(
            split(r#"/export -o "C:\My Scans\out.md""#),
            ["/export", "-o", r"C:\My Scans\out.md"]
        );
        assert_eq!(
            split(r"/export -o \\server\share\out.md"),
            ["/export", "-o", r"\\server\share\out.md"]
        );
    }

    #[test]
    fn a_quote_inside_a_word_is_just_a_character() {
        assert_eq!(
            split("/export -o O'Brien.md"),
            ["/export", "-o", "O'Brien.md"]
        );
        assert_eq!(split(r#""it's here""#), ["it's here"]);
    }

    #[test]
    fn empty_quotes_are_an_empty_argument() {
        assert_eq!(
            split(r#"/pcap eth0 --filter """#),
            ["/pcap", "eth0", "--filter", ""]
        );
    }

    #[test]
    fn a_quote_that_is_never_closed_is_an_error() {
        let err = split_args(r#"/pcap eth0 --filter "tcp port 80"#).unwrap_err();
        assert!(err.contains("never closed"), "{err}");
    }
}
