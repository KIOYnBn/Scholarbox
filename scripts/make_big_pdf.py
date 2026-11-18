"""生成一个 100MB+ 的“真实”PDF，用来验证大文件打开与翻页。

每页一张 1400x1900 的随机噪声 JPEG（噪声不可压缩，所以文件会真的大），
再叠一行页码与标题，保持文字层可用（划词/标注仍能工作）。
"""
from __future__ import annotations

import io
import os
import sys

from PIL import Image
from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas

PAGES = int(os.environ.get("BIG_PDF_PAGES", "150"))
OUT = os.environ.get("BIG_PDF_OUT", "origin.pdf")
TARGET_MB = float(os.environ.get("BIG_PDF_TARGET_MB", "110"))


def noise_jpeg(width: int, height: int, seed: int, quality: int = 70) -> io.BytesIO:
    import random

    rnd = random.Random(seed)
    # 低分辨率噪声再放大：比逐像素 random 快得多，而且几乎不可压缩
    small = Image.frombytes("RGB", (width // 4, height // 4), bytes(
        rnd.getrandbits(8) for _ in range((width // 4) * (height // 4) * 3)
    ))
    big = small.resize((width, height), Image.NEAREST)
    buffer = io.BytesIO()
    big.save(buffer, format="JPEG", quality=quality)
    buffer.seek(0)
    return buffer


def main() -> None:
    out_dir = os.path.dirname(os.path.abspath(OUT))
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)

    c = canvas.Canvas(OUT, pagesize=A4)
    width, height = A4
    for page in range(1, PAGES + 1):
        image = noise_jpeg(1400, 1900, seed=page)
        c.drawImage(ImageReader(image), 0, 0, width=width, height=height, preserveAspectRatio=False)
        c.setFillColorRGB(1, 1, 1)
        c.rect(24, height - 46, 330, 22, stroke=0, fill=1)
        c.setFillColorRGB(0.1, 0.1, 0.1)
        c.setFont("Helvetica-Bold", 11)
        c.drawString(30, height - 40, "Large PDF stress test")
        c.setFont("Helvetica", 9)
        c.drawString(30, height - 64, f"page {page} of {PAGES}")
        c.showPage()

    c.save()
    size_mb = os.path.getsize(OUT) / (1024 * 1024)
    print(f"wrote {OUT}: {size_mb:.1f} MB, {PAGES} pages")
    if size_mb < TARGET_MB * 0.6:
        print(f"warning: 只有 {size_mb:.1f} MB，低于目标 {TARGET_MB} MB", file=sys.stderr)


if __name__ == "__main__":
    main()
