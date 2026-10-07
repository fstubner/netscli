pub(super) fn column_width(values: impl Iterator<Item = usize>, min: usize, max: usize) -> usize {
    let widest = values.max().unwrap_or(min);
    widest.clamp(min, max)
}

/// How wide a cell is, counted the way `{:<w$}` pads, in characters. Bytes
/// were counted here before, which is wider than the cell is for any name
/// with an accent in it.
pub(super) fn cell_width(text: Option<&str>) -> usize {
    text.map_or(1, |text| text.chars().count())
}

/// `text` cut to `width` characters, ending in `…` when it was longer. A cell
/// that is wider than its column pushes everything after it to the right.
pub(super) fn fit(text: &str, width: usize) -> String {
    if text.chars().count() <= width {
        return text.to_string();
    }
    text.chars()
        .take(width.saturating_sub(1))
        .chain(std::iter::once('…'))
        .collect()
}

/// "1 host", "0 hosts", "12 hosts".
pub(super) fn count_hosts(count: usize) -> String {
    if count == 1 {
        "1 host".to_string()
    } else {
        format!("{count} hosts")
    }
}
