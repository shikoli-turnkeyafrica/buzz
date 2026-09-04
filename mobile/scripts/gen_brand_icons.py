#!/usr/bin/env python3
"""Regenerate every launcher/splash asset from the 1024px Cybota tile.

Sizes are read from the existing files (Android) and Contents.json (iOS) so the
script cannot drift from what the platforms expect. Run from mobile/:
    python3 scripts/gen_brand_icons.py
"""
import json
import pathlib
from PIL import Image, ImageDraw

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = Image.open(ROOT / "assets/images/cybercare-icon-source-1024.png").convert("RGBA")
GROUND = (0xFA, 0xFA, 0xFA, 255)
RES = ROOT / "android/app/src/main/res"
DPI = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}


def square(size: int) -> Image.Image:
    return SRC.resize((size, size), Image.LANCZOS)


def circle(size: int) -> Image.Image:
    """Round adaptive icon: tile at 92% scale so the source's edge-bleeding
    navy border doesn't clip against the inscribed circle mask."""
    inner = round(size * 0.92)
    tile = square(inner)
    offset = (size - inner) // 2
    base = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    base.paste(tile, (offset, offset), tile)
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, size - 1, size - 1), fill=255)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(base, (0, 0), mask)
    return out


def foreground(size: int) -> Image.Image:
    """Adaptive-icon foreground: mark centred in the 66/108 safe zone on transparent.
    The background layer supplies the #FAFAFA ground (ic_launcher_background.xml)."""
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    inner = round(size * 66 / 108)
    out.paste(square(inner), ((size - inner) // 2, (size - inner) // 2))
    return out


def app_icon(size: int) -> Image.Image:
    """iOS AppIcon.appiconset render: tile composited onto the #FAFAFA ground and
    saved opaque RGB. Xcode archive / App Store Connect validation rejects app
    icons carrying an alpha channel, most strictly the 1024x1024 marketing icon."""
    out = Image.new("RGB", (size, size), GROUND[:3])
    tile = square(size)
    out.paste(tile, (0, 0), tile)
    return out


def on_ground(size: int) -> Image.Image:
    """Splash image: tile at 60% on the light ground."""
    out = Image.new("RGBA", (size, size), GROUND)
    inner = round(size * 0.6)
    tile = square(inner)
    out.paste(tile, ((size - inner) // 2, (size - inner) // 2), tile)
    return out


def write(path: pathlib.Path, im: Image.Image) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    im.save(path, "PNG", optimize=True)
    print(f"{path.relative_to(ROOT)} {im.size[0]}x{im.size[1]}")


for name, scale in DPI.items():
    d = RES / f"mipmap-{name}"
    write(d / "ic_launcher.png", square(round(48 * scale)))
    write(d / "ic_launcher_round.png", circle(round(48 * scale)))
    write(d / "ic_launcher_foreground.png", foreground(round(108 * scale)))
    write(d / "launch_image.png", on_ground(round(288 * scale)))

for setname, render in [("AppIcon.appiconset", app_icon), ("LaunchImage.imageset", on_ground)]:
    d = ROOT / "ios/Runner/Assets.xcassets" / setname
    contents = json.loads((d / "Contents.json").read_text())
    for entry in contents["images"]:
        if "filename" not in entry:
            continue
        if "size" in entry:
            w = float(entry["size"].split("x")[0])
            px = round(w * int(entry["scale"].rstrip("x")))
        else:  # LaunchImage entries carry only scale; base is 168pt (LaunchScreen.storyboard)
            px = 168 * int(entry["scale"].rstrip("x"))
        write(d / entry["filename"], render(px))
