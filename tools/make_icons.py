"""Generate LiftLog's PNG app icons with only the Python standard library.

Run from the project root:  python3 tools/make_icons.py
Draws a lime dumbbell on a near-black background, 4x supersampled for smooth edges.
"""
import struct
import zlib
from pathlib import Path

BG = (11, 13, 16)
FG = (212, 255, 58)
OUT = Path(__file__).resolve().parent.parent / "icons"


def rounded_rect(px, py, x0, y0, x1, y1, r):
    if px < x0 or px > x1 or py < y0 or py > y1:
        return False
    cx = min(max(px, x0 + r), x1 - r)
    cy = min(max(py, y0 + r), y1 - r)
    return (px - cx) ** 2 + (py - cy) ** 2 <= r * r


def dumbbell(u, v, scale):
    """u, v in 0..1 icon space; scale shrinks the glyph toward the centre."""
    u = (u - 0.5) / scale + 0.5
    v = (v - 0.5) / scale + 0.5
    shapes = [
        (0.30, 0.47, 0.70, 0.53, 0.02),   # bar
        (0.22, 0.28, 0.31, 0.72, 0.035),  # inner plates
        (0.69, 0.28, 0.78, 0.72, 0.035),
        (0.13, 0.36, 0.22, 0.64, 0.03),   # outer plates
        (0.78, 0.36, 0.87, 0.64, 0.03),
    ]
    return any(rounded_rect(u, v, *s) for s in shapes)


def render(size, scale, corner):
    ss = 4
    rows = []
    for y in range(size):
        row = bytearray([0])  # filter byte
        for x in range(size):
            fg = bg = out = 0
            for sy in range(ss):
                for sx in range(ss):
                    u = (x + (sx + 0.5) / ss) / size
                    v = (y + (sy + 0.5) / ss) / size
                    if corner and not rounded_rect(u, v, 0, 0, 1, 1, corner):
                        out += 1
                    elif dumbbell(u, v, scale):
                        fg += 1
                    else:
                        bg += 1
            n = ss * ss
            inside = fg + bg
            color = [((FG[i] * fg + BG[i] * bg) // inside) if inside else 0 for i in range(3)]
            row += bytes(color) + bytes([round(255 * inside / n)])
        rows.append(bytes(row))
    return png(size, size, b"".join(rows))


def png(w, h, raw):
    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    ihdr = struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)  # 8-bit RGBA
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")


if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    jobs = {
        "icon-192.png": (192, 1.0, 0.22),          # rounded square, "any"
        "icon-512.png": (512, 1.0, 0.22),
        "icon-maskable-512.png": (512, 0.78, 0),   # full bleed, glyph inside the safe zone
        "apple-touch-icon.png": (180, 0.9, 0),     # iOS applies its own rounding
    }
    for name, (size, scale, corner) in jobs.items():
        (OUT / name).write_bytes(render(size, scale, corner))
        print("wrote", OUT / name)
