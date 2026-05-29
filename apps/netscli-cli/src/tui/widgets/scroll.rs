pub(in crate::tui) fn scrollbar_thumb(top: u16, total: u16, viewport: u16) -> (u16, u16) {
    if viewport == 0 || total <= viewport {
        return (0, viewport);
    }

    let viewport_u32 = viewport as u32;
    let total_u32 = total as u32;
    let thumb = ((viewport_u32 * viewport_u32) / total_u32).max(1) as u16;
    let thumb = thumb.min(viewport);

    let max_scroll = total.saturating_sub(viewport);
    let max_thumb_top = viewport.saturating_sub(thumb);
    let thumb_top = if max_scroll == 0 || max_thumb_top == 0 {
        0
    } else {
        ((top as u32 * max_thumb_top as u32) / max_scroll as u32) as u16
    };

    (thumb_top, thumb)
}

pub(in crate::tui) fn next_scroll_top(prev_top: usize, cursor: usize, length: usize) -> usize {
    if length == 0 {
        return 0;
    }
    if cursor < prev_top {
        cursor
    } else if prev_top + length <= cursor {
        cursor + 1 - length
    } else {
        prev_top
    }
}
