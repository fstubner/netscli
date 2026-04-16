#!/usr/bin/env python3
"""Generate NetsCLI app icons at multiple sizes.

Creates a dark rounded-rect icon with a green-to-cyan "N>" terminal prompt,
matching the NetsCLI brand gradient. Outputs PNG files for all required
Tauri icon sizes plus .ico for Windows.

No external dependencies (uses only stdlib zlib/struct).
"""

import math
import struct
import zlib
import os

# ── Brand colours (same gradient as the TUI/CLI) ──────────────────────
BG = (26, 26, 26, 255)          # #1a1a1a  (dark background)
GRAD_START = (0, 90, 30, 255)   # #005a1e  (deep green)
GRAD_MID = (10, 174, 122, 255)  # #0aae7a  (teal)
GRAD_END = (30, 220, 255, 255)  # #1edcff  (cyan)

def lerp_color(c1, c2, t):
    """Linear interpolation between two RGBA colours."""
    return tuple(int(c1[i] + (c2[i] - c1[i]) * t) for i in range(4))

def gradient_color(x_ratio):
    """Map 0..1 along x to the brand gradient."""
    if x_ratio < 0.45:
        return lerp_color(GRAD_START, GRAD_MID, x_ratio / 0.45)
    else:
        return lerp_color(GRAD_MID, GRAD_END, (x_ratio - 0.45) / 0.55)


def rounded_rect_mask(size, radius):
    """Return a 2-D list (size × size) of alpha values for a rounded rect."""
    mask = [[0] * size for _ in range(size)]
    for y in range(size):
        for x in range(size):
            # Check corners
            dx = dy = 0
            if x < radius and y < radius:
                dx, dy = radius - x - 0.5, radius - y - 0.5
            elif x >= size - radius and y < radius:
                dx, dy = x - (size - radius) + 0.5, radius - y - 0.5
            elif x < radius and y >= size - radius:
                dx, dy = radius - x - 0.5, y - (size - radius) + 0.5
            elif x >= size - radius and y >= size - radius:
                dx, dy = x - (size - radius) + 0.5, y - (size - radius) + 0.5

            if dx > 0 and dy > 0:
                dist = math.sqrt(dx * dx + dy * dy)
                if dist > radius:
                    mask[y][x] = 0
                elif dist > radius - 1.5:
                    mask[y][x] = max(0, min(255, int(255 * (radius - dist) / 1.5)))
                else:
                    mask[y][x] = 255
            else:
                mask[y][x] = 255
    return mask


# ── Bitmap font for "N>" ──────────────────────────────────────────────
# Each glyph is a list of strings; '#' = filled pixel, '.' = empty.
# Designed for a ~12px cap height so it scales well.

GLYPH_N = [
    "##....##",
    "###...##",
    "####..##",
    "##.##.##",
    "##..####",
    "##...###",
    "##....##",
]

GLYPH_GT = [
    "##......",
    "..##....",
    "....##..",
    "......##",
    "....##..",
    "..##....",
    "##......",
]

def render_icon(size):
    """Render icon at `size` × `size` pixels and return raw RGBA bytes list."""
    pixels = [[BG for _ in range(size)] for _ in range(size)]
    radius = max(2, size // 6)
    mask = rounded_rect_mask(size, radius)

    # Compute glyph placement: "N>" centred in the icon
    # Each glyph char maps to a block of scale × scale pixels
    glyph_rows = len(GLYPH_N)       # 7
    n_cols = len(GLYPH_N[0])        # 8
    gt_cols = len(GLYPH_GT[0])      # 8
    gap_cols = 2                     # 2-char gap between N and >
    total_cols = n_cols + gap_cols + gt_cols  # 18

    # Scale so glyphs fill ~60 % of the icon width
    target_w = int(size * 0.60)
    scale = max(1, target_w // total_cols)

    glyph_w = total_cols * scale
    glyph_h = glyph_rows * scale

    ox = (size - glyph_w) // 2
    oy = (size - glyph_h) // 2

    # Draw glyphs
    for row_idx in range(glyph_rows):
        n_row = GLYPH_N[row_idx]
        gt_row = GLYPH_GT[row_idx]
        full_row = n_row + ("." * gap_cols) + gt_row  # 18 chars

        for col_idx, ch in enumerate(full_row):
            if ch != '#':
                continue
            # Fill the scale×scale block
            for dy in range(scale):
                for dx in range(scale):
                    px = ox + col_idx * scale + dx
                    py = oy + row_idx * scale + dy
                    if 0 <= px < size and 0 <= py < size:
                        x_ratio = px / size
                        pixels[py][px] = gradient_color(x_ratio)

    # Apply rounded-rect mask
    for y in range(size):
        for x in range(size):
            a = mask[y][x]
            if a == 0:
                pixels[y][x] = (0, 0, 0, 0)
            elif a < 255:
                r, g, b, _ = pixels[y][x]
                pixels[y][x] = (r, g, b, a)

    return pixels


def encode_png(pixels, width, height):
    """Encode RGBA pixel grid as a PNG file (bytes)."""
    sig = b'\x89PNG\r\n\x1a\n'

    # IHDR
    ihdr = struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)
    chunks = [_make_chunk(b'IHDR', ihdr)]

    # IDAT
    raw = b''
    for row in pixels:
        raw += b'\x00'
        for r, g, b, a in row:
            raw += struct.pack('BBBB', r, g, b, a)
    compressed = zlib.compress(raw, 9)
    chunks.append(_make_chunk(b'IDAT', compressed))

    # IEND
    chunks.append(_make_chunk(b'IEND', b''))

    return sig + b''.join(chunks)


def _make_chunk(chunk_type, data):
    crc = zlib.crc32(chunk_type + data) & 0xFFFFFFFF
    return struct.pack('>I', len(data)) + chunk_type + data + struct.pack('>I', crc)


def encode_ico(png_data_list):
    """Wrap one or more PNG blobs into a .ico file."""
    count = len(png_data_list)
    header = struct.pack('<HHH', 0, 1, count)
    offset = 6 + count * 16
    entries = b''
    data = b''
    for png_bytes, size in png_data_list:
        w = 0 if size >= 256 else size
        h = w
        entries += struct.pack('<BBBBHHII', w, h, 0, 0, 1, 32, len(png_bytes), offset)
        data += png_bytes
        offset += len(png_bytes)
    return header + entries + data


def main():
    icon_dir = os.path.dirname(os.path.abspath(__file__))

    # Sizes required by Tauri
    sizes = {
        'icon.png': 512,
        '32x32.png': 32,
        '64x64.png': 64,
        '128x128.png': 128,
        '128x128@2x.png': 256,
        'Square30x30Logo.png': 30,
        'Square44x44Logo.png': 44,
        'Square71x71Logo.png': 71,
        'Square89x89Logo.png': 89,
        'Square107x107Logo.png': 107,
        'Square142x142Logo.png': 142,
        'Square150x150Logo.png': 150,
        'Square284x284Logo.png': 284,
        'Square310x310Logo.png': 310,
        'StoreLogo.png': 50,
    }

    ico_entries = []

    for filename, size in sizes.items():
        pixels = render_icon(size)
        png_bytes = encode_png(pixels, size, size)
        path = os.path.join(icon_dir, filename)
        with open(path, 'wb') as f:
            f.write(png_bytes)
        print(f'  {filename:>24s}  {size:>4d}x{size:<4d}  ({len(png_bytes):,} bytes)')

        if size in (16, 32, 48, 64, 128, 256):
            ico_entries.append((png_bytes, size))

    # Generate .ico with multiple sizes
    if ico_entries:
        ico_path = os.path.join(icon_dir, 'icon.ico')
        ico_bytes = encode_ico(ico_entries)
        with open(ico_path, 'wb') as f:
            f.write(ico_bytes)
        print(f'  {"icon.ico":>24s}  multi   ({len(ico_bytes):,} bytes)')

    print('\nDone! All icons generated.')


if __name__ == '__main__':
    main()
