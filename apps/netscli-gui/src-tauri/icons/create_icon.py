#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Generate NetsCLI desktop icon assets.

The source mark matches site/public/favicon.svg: a dark rounded square with
the ANSI-shadow "N" slice filled by the brand gradient
#005a1e -> #0aae7a -> #1edcff.
"""

from __future__ import annotations

from io import BytesIO
import math
import os
import struct
import zlib

try:
    from PIL import Image, ImageDraw, ImageFont
except Exception:  # pragma: no cover - fallback is for machines without Pillow.
    Image = None
    ImageDraw = None
    ImageFont = None


BG = (17, 17, 17, 255)
GRAD_START = (0, 90, 30, 255)
GRAD_MID = (10, 174, 122, 255)
GRAD_END = (30, 220, 255, 255)

ANSI_N = [
    "███╗   ██╗",
    "████╗  ██║",
    "██╔██╗ ██║",
    "██║╚██╗██║",
    "██║ ╚████║",
    "╚═╝  ╚═══╝",
]

ANSI_N_Y = [18.0, 25.4, 32.8, 40.2, 47.6, 55.0]
MARK_VIEWBOX = 64.0
MARK_RADIUS = 9.0
MARK_FONT_SIZE = 7.4

FONT_CANDIDATES = [
    os.environ.get("NETSCLI_ICON_FONT"),
    r"C:\Windows\Fonts\CascadiaMono.ttf",
    r"C:\Windows\Fonts\CascadiaMonoPL.ttf",
    r"C:\Windows\Fonts\consola.ttf",
    "/System/Library/Fonts/Menlo.ttc",
    "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
    "/usr/share/fonts/truetype/liberation2/LiberationMono-Regular.ttf",
]


def lerp_color(c1: tuple[int, int, int, int], c2: tuple[int, int, int, int], t: float):
    return tuple(int(c1[i] + (c2[i] - c1[i]) * t) for i in range(4))


def gradient_color(x_ratio: float):
    if x_ratio < 0.45:
        return lerp_color(GRAD_START, GRAD_MID, x_ratio / 0.45)
    return lerp_color(GRAD_MID, GRAD_END, (x_ratio - 0.45) / 0.55)


def load_font(size: int):
    if ImageFont is None:
        return None
    for path in FONT_CANDIDATES:
        if not path:
            continue
        try:
            if os.path.exists(path):
                return ImageFont.truetype(path, size=size)
        except OSError:
            continue
    return ImageFont.load_default()


def render_icon_pillow(size: int) -> bytes:
    assert Image is not None and ImageDraw is not None

    scale = 4 if size < 256 else 2
    canvas_size = size * scale
    image = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    radius = max(1, round(MARK_RADIUS / MARK_VIEWBOX * canvas_size))
    draw.rounded_rectangle((0, 0, canvas_size - 1, canvas_size - 1), radius=radius, fill=BG)

    mask = Image.new("L", (canvas_size, canvas_size), 0)
    mask_draw = ImageDraw.Draw(mask)
    font = load_font(max(4, round(MARK_FONT_SIZE / MARK_VIEWBOX * canvas_size)))
    for row, y in zip(ANSI_N, ANSI_N_Y):
        left, _top, right, _bottom = mask_draw.textbbox((0, 0), row, font=font)
        x = (canvas_size - (right - left)) / 2 - left
        mask_draw.text((x, y / MARK_VIEWBOX * canvas_size), row, font=font, fill=255)

    bbox = mask.getbbox()
    if bbox:
        glyph = mask.crop(bbox)
        centered_mask = Image.new("L", (canvas_size, canvas_size), 0)
        centered_mask.paste(
            glyph,
            (
                round((canvas_size - glyph.width) / 2),
                round((canvas_size - glyph.height) / 2),
            ),
        )
        mask = centered_mask

    gradient = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))
    grad_px = gradient.load()
    for x in range(canvas_size):
        color = gradient_color(x / max(1, canvas_size - 1))
        for y2 in range(canvas_size):
            grad_px[x, y2] = color
    gradient.putalpha(mask)
    image.alpha_composite(gradient)

    if scale > 1:
        image = image.resize((size, size), Image.Resampling.LANCZOS)

    out = BytesIO()
    image.save(out, format="PNG", optimize=True)
    return out.getvalue()


def rounded_rect_mask(size: int, radius: int) -> list[list[int]]:
    mask = [[0] * size for _ in range(size)]
    for y in range(size):
        for x in range(size):
            dx = dy = 0.0
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


def render_icon_fallback(size: int) -> list[list[tuple[int, int, int, int]]]:
    pixels = [[BG for _ in range(size)] for _ in range(size)]
    rows = ANSI_N
    cols = max(len(row) for row in rows)
    cell_w = max(1, int((size * 0.72) // cols))
    cell_h = max(1, int(cell_w * 0.78))
    glyph_w = cols * cell_w
    glyph_h = len(rows) * cell_h
    ox = (size - glyph_w) // 2
    oy = (size - glyph_h) // 2

    for row_index, row in enumerate(rows):
        for col_index, ch in enumerate(row):
            if ch == " ":
                continue
            for dy in range(cell_h):
                for dx in range(cell_w):
                    px = ox + col_index * cell_w + dx
                    py = oy + row_index * cell_h + dy
                    if 0 <= px < size and 0 <= py < size:
                        pixels[py][px] = gradient_color(px / max(1, size - 1))

    mask = rounded_rect_mask(size, max(2, size // 6))
    for y in range(size):
        for x in range(size):
            alpha = mask[y][x]
            if alpha == 0:
                pixels[y][x] = (0, 0, 0, 0)
            elif alpha < 255:
                r, g, b, _a = pixels[y][x]
                pixels[y][x] = (r, g, b, alpha)
    return pixels


def encode_png(pixels: list[list[tuple[int, int, int, int]]], width: int, height: int) -> bytes:
    chunks = [_make_chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))]
    raw = bytearray()
    for row in pixels:
        raw.append(0)
        for r, g, b, a in row:
            raw.extend(struct.pack("BBBB", r, g, b, a))
    chunks.append(_make_chunk(b"IDAT", zlib.compress(bytes(raw), 9)))
    chunks.append(_make_chunk(b"IEND", b""))
    return b"\x89PNG\r\n\x1a\n" + b"".join(chunks)


def _make_chunk(chunk_type: bytes, data: bytes) -> bytes:
    crc = zlib.crc32(chunk_type + data) & 0xFFFFFFFF
    return struct.pack(">I", len(data)) + chunk_type + data + struct.pack(">I", crc)


def render_png(size: int) -> bytes:
    if Image is not None:
        return render_icon_pillow(size)
    return encode_png(render_icon_fallback(size), size, size)


def encode_ico(png_data_list: list[tuple[bytes, int]]) -> bytes:
    count = len(png_data_list)
    header = struct.pack("<HHH", 0, 1, count)
    offset = 6 + count * 16
    entries = bytearray()
    data = bytearray()
    for png_bytes, size in png_data_list:
        width = 0 if size >= 256 else size
        entries.extend(struct.pack("<BBBBHHII", width, width, 0, 0, 1, 32, len(png_bytes), offset))
        data.extend(png_bytes)
        offset += len(png_bytes)
    return header + bytes(entries) + bytes(data)


def main() -> None:
    icon_dir = os.path.dirname(os.path.abspath(__file__))
    sizes = {
        "icon.png": 512,
        "32x32.png": 32,
        "64x64.png": 64,
        "128x128.png": 128,
        "128x128@2x.png": 256,
        "Square30x30Logo.png": 30,
        "Square44x44Logo.png": 44,
        "Square71x71Logo.png": 71,
        "Square89x89Logo.png": 89,
        "Square107x107Logo.png": 107,
        "Square142x142Logo.png": 142,
        "Square150x150Logo.png": 150,
        "Square284x284Logo.png": 284,
        "Square310x310Logo.png": 310,
        "StoreLogo.png": 50,
    }

    for filename, size in sizes.items():
        png_bytes = render_png(size)
        path = os.path.join(icon_dir, filename)
        with open(path, "wb") as f:
            f.write(png_bytes)
        print(f"{filename:>24s}  {size:>4d}x{size:<4d}  ({len(png_bytes):,} bytes)")

    ico_entries = [(render_png(size), size) for size in (16, 32, 48, 64, 128, 256)]
    ico_bytes = encode_ico(ico_entries)
    ico_path = os.path.join(icon_dir, "icon.ico")
    with open(ico_path, "wb") as f:
        f.write(ico_bytes)
    print(f"{'icon.ico':>24s}  multi   ({len(ico_bytes):,} bytes)")


if __name__ == "__main__":
    main()
