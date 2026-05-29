pub(super) fn column_width(values: impl Iterator<Item = usize>, min: usize, max: usize) -> usize {
    let widest = values.max().unwrap_or(min);
    widest.clamp(min, max)
}
