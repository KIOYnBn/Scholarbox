"""Generate every icon Tauri needs from the single 1024px master.

Run:  python scripts/make_icons.py
"""

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
MASTER = ROOT / "app-icon.png"
OUT = ROOT / "src-tauri" / "icons"
OUT.mkdir(parents=True, exist_ok=True)

master = Image.open(MASTER).convert("RGBA")

PNG_SIZES = {
    "32x32.png": 32,
    "128x128.png": 128,
    "128x128@2x.png": 256,
    "icon.png": 512,
    # Windows store logos, referenced by `tauri build` on Windows.
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

for name, size in PNG_SIZES.items():
    master.resize((size, size), Image.LANCZOS).save(OUT / name, "PNG")

# Windows .ico (multi-resolution) and macOS .icns
master.save(OUT / "icon.ico", sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
try:
    master.save(OUT / "icon.icns")
except Exception as exc:  # Pillow without ICNS support
    print(f"icns skipped: {exc}")

# Android launcher icons — only once `tauri android init` has created the project.
density = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
res = ROOT / "src-tauri" / "gen" / "android" / "app" / "src" / "main" / "res"
if res.parent.exists():
    for name, size in density.items():
        folder = res / f"mipmap-{name}"
        folder.mkdir(parents=True, exist_ok=True)
        icon = master.resize((size, size), Image.LANCZOS)
        icon.save(folder / "ic_launcher.png", "PNG")
        icon.save(folder / "ic_launcher_round.png", "PNG")
        fg = size * 2
        canvas = Image.new("RGBA", (fg, fg), (0, 0, 0, 0))
        side = int(fg * 0.6)
        canvas.paste(master.resize((side, side), Image.LANCZOS), ((fg - side) // 2, (fg - side) // 2))
        canvas.save(folder / "ic_launcher_foreground.png", "PNG")
else:
    print("android project not initialised — skipped mipmaps (run `npm run tauri android init`)")

print(f"icons written to {OUT.relative_to(ROOT)}")
