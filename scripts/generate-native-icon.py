#!/usr/bin/env python3
from __future__ import annotations

import math
import subprocess
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "native" / "assets"
ICONSET = ASSETS / "CarthaHermes.iconset"
MASTER = ASSETS / "CarthaHermesIcon-1024.png"
ICNS = ASSETS / "CarthaHermes.icns"
SIZE = 1024


def lerp(a: int, b: int, t: float) -> int:
    return round(a + (b - a) * t)


def hex_rgb(value: str) -> tuple[int, int, int]:
    value = value.lstrip("#")
    return tuple(int(value[i : i + 2], 16) for i in (0, 2, 4))


def rounded_mask(size: int, radius: int) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(mask)
    d.rounded_rectangle((0, 0, size, size), radius=radius, fill=255)
    return mask


def radial_glow(size: int, center: tuple[float, float], color: tuple[int, int, int], radius: float, intensity: float) -> Image.Image:
    cx, cy = center
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    pix = img.load()
    for y in range(size):
        dy = y - cy
        for x in range(size):
            dx = x - cx
            dist = math.sqrt(dx * dx + dy * dy) / radius
            if dist < 1.0:
                alpha = int(255 * intensity * (1.0 - dist) ** 2.1)
                pix[x, y] = (*color, alpha)
    return img


def linear_gradient(size: int, top: str, bottom: str) -> Image.Image:
    a = hex_rgb(top)
    b = hex_rgb(bottom)
    img = Image.new("RGBA", (size, size))
    d = ImageDraw.Draw(img)
    for y in range(size):
        t = y / (size - 1)
        # Slightly ease into the darker lower edge.
        t = t * t * (3 - 2 * t)
        d.line([(0, y), (size, y)], fill=(lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t), 255))
    return img


def safe_font(paths: list[str], size: int) -> ImageFont.FreeTypeFont:
    for path in paths:
        if Path(path).exists():
            return ImageFont.truetype(path, size=size)
    return ImageFont.load_default(size=size)


def paste_with_alpha(base: Image.Image, layer: Image.Image, mask: Image.Image | None = None) -> None:
    if mask is not None:
        layer = layer.copy()
        layer.putalpha(ImageChops.multiply(layer.getchannel("A"), mask))
    base.alpha_composite(layer)


def draw_feather(draw: ImageDraw.ImageDraw, origin: tuple[int, int], angle: float, length: int, color: tuple[int, int, int, int], width: int) -> None:
    ox, oy = origin
    ex = ox + int(math.cos(angle) * length)
    ey = oy + int(math.sin(angle) * length)
    draw.line((ox, oy, ex, ey), fill=color, width=width)
    # Tapered bright edge.
    draw.line((ox, oy - width // 4, ex, ey - width // 7), fill=(255, 255, 255, min(160, color[3])), width=max(2, width // 5))


def create_icon() -> Image.Image:
    canvas = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))

    # Soft external macOS-style shadow.
    shadow = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    sm = rounded_mask(SIZE - 80, 225).filter(ImageFilter.GaussianBlur(30))
    shadow_layer = Image.new("RGBA", (SIZE - 80, SIZE - 80), (0, 0, 0, 170))
    shadow.alpha_composite(shadow_layer, (40, 58))
    shadow.putalpha(Image.new("L", (SIZE, SIZE), 0))
    shadow_alpha = Image.new("L", (SIZE, SIZE), 0)
    shadow_alpha.paste(sm, (40, 58))
    shadow.putalpha(shadow_alpha)
    canvas.alpha_composite(shadow)

    mask = rounded_mask(SIZE - 96, 212)
    base = Image.new("RGBA", (SIZE - 96, SIZE - 96), (0, 0, 0, 0))
    base.alpha_composite(linear_gradient(SIZE - 96, "#101B3B", "#030815"))
    base.alpha_composite(radial_glow(SIZE - 96, (140, 120), hex_rgb("#3BE8FF"), 520, 0.72))
    base.alpha_composite(radial_glow(SIZE - 96, (760, 230), hex_rgb("#A855F7"), 580, 0.48))
    base.alpha_composite(radial_glow(SIZE - 96, (540, 820), hex_rgb("#39FFB6"), 470, 0.38))

    # Subtle diagonal glass sheen and depth.
    sheen = Image.new("RGBA", base.size, (0, 0, 0, 0))
    sd = ImageDraw.Draw(sheen)
    sd.polygon([(-80, 0), (500, 0), (180, 420), (-140, 620)], fill=(255, 255, 255, 30))
    sd.polygon([(280, 0), (base.size[0], 0), (base.size[0], 180), (610, 120)], fill=(255, 255, 255, 18))
    base.alpha_composite(sheen)

    clipped = Image.new("RGBA", (SIZE - 96, SIZE - 96), (0, 0, 0, 0))
    clipped.alpha_composite(base)
    clipped.putalpha(ImageChops.multiply(clipped.getchannel("A"), mask))
    canvas.alpha_composite(clipped, (48, 48))

    art = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    d = ImageDraw.Draw(art)

    # Hermes wing motif behind the C: energetic but still simple at small sizes.
    wing_colors = [(98, 245, 255, 150), (110, 231, 183, 130), (196, 181, 253, 115)]
    for i, (length, width) in enumerate([(330, 34), (285, 27), (235, 22), (185, 17)]):
        draw_feather(d, (610, 416 + i * 34), -0.62 - i * 0.035, length, wing_colors[i % len(wing_colors)], width)
        draw_feather(d, (404, 416 + i * 34), math.pi + 0.62 + i * 0.035, length, wing_colors[i % len(wing_colors)], width)

    # Orb ring, hinting local model / gateway / workspace orbit.
    ring = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    rd = ImageDraw.Draw(ring)
    rd.ellipse((246, 250, 778, 782), outline=(255, 255, 255, 36), width=18)
    rd.arc((226, 230, 798, 802), start=205, end=333, fill=(70, 235, 255, 160), width=18)
    rd.arc((226, 230, 798, 802), start=30, end=122, fill=(155, 92, 246, 135), width=14)
    ring = ring.filter(ImageFilter.GaussianBlur(0.35))
    art.alpha_composite(ring)

    font = safe_font([
        "/System/Library/Fonts/SFNSRounded.ttf",
        "/System/Library/Fonts/SFNS.ttf",
        "/System/Library/Fonts/Avenir Next.ttc",
        "/System/Library/Fonts/Supplemental/Arial Rounded Bold.ttf",
    ], 565)
    text = "C"
    bbox = d.textbbox((0, 0), text, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    tx = (SIZE - tw) // 2 - 20
    ty = (SIZE - th) // 2 - 34

    text_mask = Image.new("L", (SIZE, SIZE), 0)
    td = ImageDraw.Draw(text_mask)
    td.text((tx, ty), text, font=font, fill=255)

    # Heavy glow/shadow so the monogram holds up in Dock size.
    glow = Image.new("RGBA", (SIZE, SIZE), (65, 235, 255, 0))
    glow.putalpha(text_mask.filter(ImageFilter.GaussianBlur(22)))
    art.alpha_composite(glow)
    dark_shadow = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    ds_alpha = text_mask.filter(ImageFilter.GaussianBlur(10))
    dark_shadow.putalpha(ds_alpha.point(lambda a: int(a * 0.45)))
    art.alpha_composite(dark_shadow, (0, 18))

    text_fill = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    grad = linear_gradient(SIZE, "#F7FCFF", "#93F7E9")
    text_fill.alpha_composite(grad)
    text_fill.putalpha(text_mask)
    art.alpha_composite(text_fill)

    # Inner cut sparkle and nodes.
    d = ImageDraw.Draw(art)
    for x, y, r, c in [
        (700, 304, 18, (255, 255, 255, 225)),
        (759, 365, 9, (80, 255, 217, 220)),
        (279, 687, 10, (146, 234, 255, 200)),
        (680, 714, 12, (196, 181, 253, 205)),
    ]:
        d.ellipse((x - r, y - r, x + r, y + r), fill=c)
    # Four-point star.
    cx, cy = 704, 304
    d.polygon([(cx, cy - 54), (cx + 13, cy - 13), (cx + 54, cy), (cx + 13, cy + 13), (cx, cy + 54), (cx - 13, cy + 13), (cx - 54, cy), (cx - 13, cy - 13)], fill=(255, 255, 255, 190))

    # Clip art to icon rounded rect.
    full_mask = Image.new("L", (SIZE, SIZE), 0)
    full_mask.paste(mask, (48, 48))
    art.putalpha(ImageChops.multiply(art.getchannel("A"), full_mask))
    canvas.alpha_composite(art)

    # Crisp border.
    border = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    bd = ImageDraw.Draw(border)
    bd.rounded_rectangle((48, 48, SIZE - 48, SIZE - 48), radius=212, outline=(255, 255, 255, 72), width=4)
    bd.rounded_rectangle((54, 54, SIZE - 54, SIZE - 54), radius=204, outline=(20, 255, 220, 34), width=2)
    canvas.alpha_composite(border)
    return canvas


def save_iconset(master: Image.Image) -> None:
    ASSETS.mkdir(parents=True, exist_ok=True)
    ICONSET.mkdir(parents=True, exist_ok=True)
    master.save(MASTER)
    sizes = [16, 32, 64, 128, 256, 512, 1024]
    mapping = {
        "icon_16x16.png": 16,
        "icon_16x16@2x.png": 32,
        "icon_32x32.png": 32,
        "icon_32x32@2x.png": 64,
        "icon_128x128.png": 128,
        "icon_128x128@2x.png": 256,
        "icon_256x256.png": 256,
        "icon_256x256@2x.png": 512,
        "icon_512x512.png": 512,
        "icon_512x512@2x.png": 1024,
    }
    for name, size in mapping.items():
        resized = master.resize((size, size), Image.Resampling.LANCZOS)
        resized.save(ICONSET / name)
    subprocess.run(["iconutil", "-c", "icns", str(ICONSET), "-o", str(ICNS)], check=True)


def main() -> None:
    icon = create_icon()
    save_iconset(icon)
    print(f"Generated {MASTER}")
    print(f"Generated {ICNS}")


if __name__ == "__main__":
    main()
