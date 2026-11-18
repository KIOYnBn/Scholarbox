"""Generate the demo PDF and the app icon used by the project.

Run:  python scripts/make_assets.py
Requires Pillow (bundled with the DSH python runtime).
"""

from __future__ import annotations

import os
import textwrap

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONTS = r"C:\Windows\Fonts"

SERIF = os.path.join(FONTS, "georgia.ttf")
SERIF_BOLD = os.path.join(FONTS, "georgiab.ttf")
SERIF_ITALIC = os.path.join(FONTS, "georgiai.ttf")
SANS = os.path.join(FONTS, "arial.ttf")
SANS_BOLD = os.path.join(FONTS, "arialbd.ttf")

PAGE_W, PAGE_H = 1240, 1754  # A4 @150dpi
MARGIN = 118
GUTTER = 34
COL_W = (PAGE_W - 2 * MARGIN - GUTTER) // 2

INK = (28, 26, 23)
MUTED = (105, 100, 92)
RULE = (206, 200, 189)


def font(path: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(path, size)


BODY = font(SERIF, 19)
BODY_SMALL = font(SERIF, 16)
ITALIC = font(SERIF_ITALIC, 19)
TITLE = font(SERIF_BOLD, 46)
H2 = font(SERIF_BOLD, 25)
SANS_SM = font(SANS, 15)
SANS_BOLD_SM = font(SANS_BOLD, 15)
SANS_TINY = font(SANS, 13)


BODY_TEXT = (
    "Retrieval systems for scientific literature must reconcile two competing needs: precise "
    "lexical matching for terminology, and semantic generalisation across paraphrases. We study "
    "a hybrid index that keeps token statistics for rare terms while routing frequent queries to "
    "a dense encoder. The design is deliberately boring: a single inverted index, a fixed set of "
    "learned projections, and a scoring function that can be audited term by term. On a benchmark "
    "of 41,208 papers the hybrid index improves recall at ten by 6.4 points over a dense-only "
    "baseline, and cuts median latency from 180 ms to 74 ms. Gains concentrate on long queries, "
    "where lexical anchoring prevents the drift that dense encoders exhibit. We release the index "
    "format and the evaluation harness so that results can be reproduced from a laptop."
).split()


def wrap(draw: ImageDraw.ImageDraw, text: str, f: ImageFont.FreeTypeFont, width: int) -> list[str]:
    words = text.split()
    lines: list[str] = []
    current: list[str] = []
    for word in words:
        trial = " ".join(current + [word])
        if draw.textlength(trial, font=f) <= width:
            current.append(word)
        else:
            if current:
                lines.append(" ".join(current))
            current = [word]
    if current:
        lines.append(" ".join(current))
    return lines


def paragraph(
    draw: ImageDraw.ImageDraw,
    xy: tuple[int, int],
    text: str,
    f: ImageFont.FreeTypeFont,
    width: int,
    leading: int,
    color=INK,
) -> int:
    x, y = xy
    for line in wrap(draw, text, f, width):
        draw.text((x, y), line, font=f, fill=color)
        y += leading
    return y


def draw_header(draw: ImageDraw.ImageDraw, page: int, total: int) -> None:
    draw.line((MARGIN, 74, PAGE_W - MARGIN, 74), fill=RULE, width=1)
    draw.text((MARGIN, 46), "PRETPRINT · UNDER REVIEW", font=SANS_SM, fill=MUTED)
    draw.text((PAGE_W - MARGIN - 92, 46), f"ScholarBox demo", font=SANS_SM, fill=MUTED)
    draw.line((MARGIN, PAGE_H - 74, PAGE_W - MARGIN, PAGE_H - 74), fill=RULE, width=1)
    draw.text((MARGIN, PAGE_H - 56), "arXiv:2501.00042v2  [cs.IR]  12 Jan 2025", font=SANS_TINY, fill=MUTED)
    label = f"{page} / {total}"
    draw.text((PAGE_W - MARGIN - draw.textlength(label, font=SANS_TINY), PAGE_H - 56), label, font=SANS_TINY, fill=MUTED)


def page_one(total: int) -> Image.Image:
    img = Image.new("RGB", (PAGE_W, PAGE_H), (255, 255, 255))
    d = ImageDraw.Draw(img)
    draw_header(d, 1, total)

    y = 128
    d.text((MARGIN, y), "A Hybrid Lexical–Dense Index for", font=TITLE, fill=INK)
    y += 58
    d.text((MARGIN, y), "Scientific Literature Retrieval", font=TITLE, fill=INK)
    y += 74

    authors = "Mira Halvorsen,  Daniel Okonkwo,  Lin Wei,  Sofia Fernández"
    d.text((MARGIN, y), authors, font=BODY, fill=INK)
    y += 28
    d.text((MARGIN, y), "Institute for Information Retrieval · Northfield University", font=ITALIC, fill=MUTED)
    y += 26
    d.text((MARGIN, y), "mira.h@northfield.edu · d.okonkwo@northfield.edu", font=SANS_SM, fill=MUTED)
    y += 44

    # abstract block
    d.rectangle((MARGIN, y, PAGE_W - MARGIN, y + 6), fill=(43, 106, 98))
    y += 26
    d.text((MARGIN, y), "Abstract", font=H2, fill=INK)
    y += 40
    y = paragraph(
        d,
        (MARGIN, y),
        "Retrieval over scientific corpora is dominated by two failure modes: lexical systems miss "
        "paraphrase, while dense encoders flatten rare terminology into generic regions of the "
        "embedding space. We describe HX-Index, a hybrid structure that preserves an auditable "
        "token index for long-tail terms and adds a small set of learned projections for semantic "
        "recall. The system keeps a single on-disk format, supports incremental updates without "
        "retraining, and degrades gracefully to pure BM25 when the encoder is unavailable. Across "
        "41,208 papers, HX-Index improves recall@10 by 6.4 points over a dense-only baseline while "
        "cutting median latency by 58%, and it remains within 1.2 points of the dense baseline on "
        "adversarial paraphrase queries where lexical evidence is absent.",
        BODY,
        PAGE_W - 2 * MARGIN,
        30,
    )
    y += 16
    d.text(
        (MARGIN, y),
        "Keywords: information retrieval · hybrid search · scientific literature · reproducible evaluation",
        font=ITALIC,
        fill=MUTED,
    )
    y += 54

    # two column body
    left_x, right_x = MARGIN, MARGIN + COL_W + GUTTER
    col_top = y
    ly = col_top
    d.text((left_x, ly), "1  Introduction", font=H2, fill=INK)
    ly += 42
    intro = (
        "Reading a scientific corpus is a retrieval problem before it is a reading problem. A "
        "researcher who cannot find the right four pages will never annotate them. Yet the tooling "
        "that surrounds literature review has drifted away from the underlying files: libraries are "
        "locked into proprietary databases, annotations live in sidecar stores, and the PDF itself "
        "becomes an attachment rather than a document."
    )
    ly = paragraph(d, (left_x, ly), intro, BODY, COL_W, 30)
    ly += 14
    second = (
        "This paper argues that the opposite arrangement is both simpler and more durable. If the "
        "folder is the database, then every operation a reader performs — opening, highlighting, "
        "summarising — leaves a diffable artefact behind. Version control, sync, and provenance all "
        "become file operations."
    )
    ly = paragraph(d, (left_x, ly), second, BODY, COL_W, 30)
    ly += 22
    d.text((left_x, ly), "1.1  Contributions", font=font(SERIF_BOLD, 21), fill=INK)
    ly += 34
    for item in [
        "A two-stage index that keeps lexical and dense signals separable.",
        "An incremental update path with no retraining and no index rebuild.",
        "An evaluation harness that runs offline on a single laptop.",
    ]:
        d.ellipse((left_x + 2, ly + 8, left_x + 8, ly + 14), fill=(43, 106, 98))
        ly = paragraph(d, (left_x + 20, ly), item, BODY_SMALL, COL_W - 20, 26)
        ly += 6

    ry = col_top
    d.text((right_x, ry), "2  Method", font=H2, fill=INK)
    ry += 42
    method = (
        "HX-Index stores two views of every document. The lexical view is an inverted index over "
        "normalised tokens with positional payloads. The dense view is a 256-dimensional projection "
        "produced by a frozen encoder and stored as int8 vectors in a flat file."
    )
    ry = paragraph(d, (right_x, ry), method, BODY, COL_W, 30)
    ry += 10
    ry = paragraph(
        d,
        (right_x, ry),
        "At query time both views are scored and combined with a tuned weight. Because the lexical "
        "view is intact, every ranking can be explained by pointing at matched terms.",
        ITALIC,
        COL_W,
        30,
    )
    ry += 22

    # figure
    fig_h = 232
    d.rounded_rectangle((right_x, ry, right_x + COL_W, ry + fig_h), radius=6, outline=RULE, width=1)
    # tiny diagram
    cx, cy = right_x + COL_W // 2, ry + 96
    nodes = [(-84, 34), (-30, -40), (26, -46), (80, 8), (30, 54), (-34, 56)]
    for nx, ny in nodes:
        d.ellipse((cx + nx - 15, cy + ny - 15, cx + nx + 15, cy + ny + 15), outline=(43, 106, 98), width=2)
    for i in range(len(nodes)):
        for j in range(i + 1, len(nodes)):
            if (i + j) % 3 != 0:
                ax, ay = cx + nodes[i][0], cy + nodes[i][1]
                bx, by = cx + nodes[j][0], cy + nodes[j][1]
                d.line((ax, ay, bx, by), fill=(214, 208, 197), width=1)
    for nx, ny in nodes:
        d.ellipse((cx + nx - 5, cy + ny - 5, cx + nx + 5, cy + ny + 5), fill=(43, 106, 98))
    d.text((right_x + 14, ry + fig_h - 54), "Figure 1: Query graph over the hybrid index.", font=SANS_TINY, fill=MUTED)
    d.text((right_x + 14, ry + fig_h - 34), "Lexical anchors (solid) and dense neighbours (open).", font=SANS_TINY, fill=MUTED)
    ry += fig_h + 34

    d.text((right_x, ry), "3  Results", font=H2, fill=INK)
    ry += 40
    results = (
        "Table 1 reports recall at ten and median latency on the held-out split. The hybrid index "
        "dominates in every bucket except single-term abbreviation lookups, where pure BM25 is "
        "already optimal and the encoder only adds overhead."
    )
    ry = paragraph(d, (right_x, ry), results, BODY, COL_W, 30)

    return img


def page_two(total: int) -> Image.Image:
    img = Image.new("RGB", (PAGE_W, PAGE_H), (255, 255, 255))
    d = ImageDraw.Draw(img)
    draw_header(d, 2, total)
    y = 128

    d.text((MARGIN, y), "Table 1: Retrieval quality and latency.", font=SANS_BOLD_SM, fill=INK)
    y += 30

    cols = [MARGIN, MARGIN + 300, MARGIN + 470, MARGIN + 640, MARGIN + 810]
    headers = ["System", "R@10", "MRR@10", "Median ms", "Index GB"]
    d.rectangle((MARGIN, y - 6, PAGE_W - MARGIN, y + 30), fill=(243, 241, 236))
    for x, head in zip(cols, headers):
        d.text((x, y), head, font=SANS_BOLD_SM, fill=INK)
    y += 36
    rows = [
        ["BM25 (baseline)", "0.612", "0.481", "41", "2.1"],
        ["Dense-only (256-d)", "0.655", "0.512", "180", "4.9"],
        ["HX-Index", "0.719", "0.548", "74", "5.3"],
        ["HX-Index, no encoder", "0.612", "0.481", "39", "2.1"],
    ]
    for index, row in enumerate(rows):
        f = SANS_BOLD_SM if row[0] == "HX-Index" else SANS_SM
        for x, cell in zip(cols, row):
            d.text((x, y), cell, font=f, fill=INK)
        y += 30
        if index < len(rows) - 1:
            d.line((MARGIN, y - 8, PAGE_W - MARGIN, y - 8), fill=(236, 232, 224))

    y += 40
    d.text((MARGIN, y), "4  Discussion", font=H2, fill=INK)
    y += 44
    left_x, right_x = MARGIN, MARGIN + COL_W + GUTTER
    ly = paragraph(d, (left_x, y), " ".join(BODY_TEXT[:70]), BODY, COL_W, 30)
    ly += 16
    ly = paragraph(
        d,
        (left_x, ly),
        "The hybrid design also has an operational advantage that rarely appears in papers: it can "
        "be rebuilt from the corpus in minutes, which means a reader can trust that the index is "
        "reproducible rather than an artefact of someone else's training run.",
        BODY,
        COL_W,
        30,
    )
    ry = paragraph(d, (right_x, y), " ".join(BODY_TEXT[70:140]), BODY, COL_W, 30)
    ry += 16
    ry = paragraph(
        d,
        (right_x, ry),
        "We do not claim the weight tuning is optimal. It was selected on a validation split of "
        "600 queries and is exposed as a single configuration value precisely so that it can be "
        "challenged by the reader.",
        BODY,
        COL_W,
        30,
    )

    y2 = max(ly, ry) + 48
    d.text((MARGIN, y2), "References", font=H2, fill=INK)
    y2 += 40
    refs = [
        "Robertson, S. and Zaragoza, H. (2009). The probabilistic relevance framework: BM25 and beyond. Foundations and Trends in IR, 3(4), 333–389.",
        "Karpukhin, V. et al. (2020). Dense passage retrieval for open-domain question answering. EMNLP.",
        "Thakur, N. et al. (2021). BEIR: A heterogeneous benchmark for zero-shot evaluation of information retrieval models. NeurIPS Datasets and Benchmarks.",
        "Bruch, S. et al. (2023). An analysis of fusion functions for hybrid retrieval. ACM TOIS, 42(1).",
    ]
    for ref in refs:
        d.ellipse((MARGIN, y2 + 6, MARGIN + 5, y2 + 11), fill=(206, 200, 189))
        y2 = paragraph(d, (MARGIN + 18, y2), ref, BODY_SMALL, PAGE_W - 2 * MARGIN - 18, 26) + 10

    return img


def build_pdf() -> None:
    out_dir = os.path.join(ROOT, "public", "demo")
    os.makedirs(out_dir, exist_ok=True)
    pages = [page_one(2), page_two(2)]
    out = os.path.join(out_dir, "Scholarly-Demo-Paper.pdf")
    pages[0].save(out, "PDF", resolution=150.0, save_all=True, append_images=pages[1:])
    print("pdf ->", out, os.path.getsize(out), "bytes")


def build_icon() -> None:
    size = 1024
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # teal squircle
    d.rounded_rectangle((0, 0, size, size), radius=int(size * 0.225), fill=(43, 106, 98))

    # white page block with a soft drop shadow
    left, top, right, bottom = int(size * 0.24), int(size * 0.22), int(size * 0.76), int(size * 0.79)
    d.rounded_rectangle(
        (left + 10, top + 16, right + 10, bottom + 16),
        radius=int(size * 0.03),
        fill=(34, 87, 80),
    )
    d.rounded_rectangle((left, top, right, bottom), radius=int(size * 0.03), fill=(250, 248, 242))
    # text lines
    line_color = (43, 106, 98)
    y = top + int(size * 0.10)
    widths = [0.34, 0.44, 0.28, 0.40, 0.36]
    for i, ratio in enumerate(widths):
        x0 = left + int(size * 0.075)
        x1 = x0 + int((right - left - size * 0.15) * ratio)
        thickness = int(size * 0.022)
        d.rounded_rectangle((x0, y, x1, y + thickness), radius=thickness // 2, fill=line_color)
        y += int(size * 0.078)
    # bookmark ribbon
    bw = int(size * 0.075)
    bx = right - bw - int(size * 0.055)
    by = top - int(size * 0.02)
    d.polygon(
        [
            (bx, by),
            (bx + bw, by),
            (bx + bw, by + int(size * 0.20)),
            (bx + bw // 2, by + int(size * 0.155)),
            (bx, by + int(size * 0.20)),
        ],
        fill=(216, 162, 74),
    )

    out = os.path.join(ROOT, "app-icon.png")
    img.save(out)
    print("icon ->", out)

    # favicon
    icon_small = img.resize((64, 64), Image.LANCZOS)
    icon_small.save(os.path.join(ROOT, "public", "favicon.png"))
    print("favicon png ->", os.path.join(ROOT, "public", "favicon.png"))


if __name__ == "__main__":
    build_icon()
    build_pdf()
