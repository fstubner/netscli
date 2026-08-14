//! Width handling for the TUI input line (B-08).
//!
//! The textarea reports the cursor as a character index while everything
//! downstream works in terminal cells. Every case here fails if those two are
//! conflated again — which is what put the cursor in the wrong place and let
//! the input overflow its box as soon as a wide character was typed.

use super::input::{display_col, slice_cols};
use unicode_width::UnicodeWidthStr;

#[test]
fn display_col_counts_cells_not_chars() {
    // ASCII: cells and chars agree.
    assert_eq!(display_col("abcdef", 3), 3);

    // CJK: each character is two cells wide, so three chars is six cells.
    assert_eq!(display_col("日本語", 3), 6);

    // Mixed: "ab" (2) + "日" (2) = 4.
    assert_eq!(display_col("ab日c", 3), 4);
}

#[test]
fn display_col_handles_out_of_range_index() {
    assert_eq!(display_col("abc", 99), 3);
    assert_eq!(display_col("", 5), 0);
}

#[test]
fn slice_cols_never_exceeds_the_requested_width() {
    // The whole point: the result must fit the box it is rendered into.
    for text in ["abcdef", "日本語です", "a日b本c", "🎉🎉🎉"] {
        for width in 0..10 {
            let out = slice_cols(text, 0, width);
            assert!(
                UnicodeWidthStr::width(out.as_str()) <= width,
                "slice_cols({text:?}, 0, {width}) = {out:?} exceeded {width} cells",
            );
        }
    }
}

#[test]
fn slice_cols_drops_rather_than_splits_a_wide_char() {
    // A wide character cannot be half-rendered, so asking for one cell of a
    // two-cell character yields nothing rather than a broken glyph.
    assert_eq!(slice_cols("日本", 0, 1), "");
    assert_eq!(slice_cols("日本", 0, 2), "日");
    assert_eq!(slice_cols("日本", 0, 3), "日");
    assert_eq!(slice_cols("日本", 0, 4), "日本");
}

#[test]
fn slice_cols_offsets_by_cells() {
    // Starting at cell 2 skips the first CJK char, not the first two chars.
    assert_eq!(slice_cols("日本語", 2, 2), "本");
    assert_eq!(slice_cols("ab日", 2, 2), "日");
}

#[test]
fn slice_cols_empty_width_is_empty() {
    assert_eq!(slice_cols("anything", 0, 0), "");
}

// Regression for the specific failure: a CJK hostname in the input box used to
// render more cells than `width`, pushing the border off screen.
#[test]
fn a_wide_string_never_overflows_the_input_width() {
    let width = 10;
    let visible = slice_cols("日本語のホスト名", 0, width);
    assert!(UnicodeWidthStr::width(visible.as_str()) <= width);
}
