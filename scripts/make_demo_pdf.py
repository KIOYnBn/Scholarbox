"""Generates the demo paper as a *real text* PDF (selectable, highlightable).

The previous demo file was built from Pillow-rendered images, which meant the
pdf.js text layer stayed empty — fine for looks, useless for testing
划词翻译 / 高亮. reportlab gives us a proper text layer.

    python scripts/make_demo_pdf.py
"""

from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_JUSTIFY
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import cm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfgen import canvas as pdfcanvas
from reportlab.graphics.shapes import Circle, Drawing, Line
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    FrameBreak,
    KeepTogether,
    NextPageTemplate,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "demo" / "Scholarly-Demo-Paper.pdf"

PAGE_W, PAGE_H = A4
MARGIN = 2.1 * cm
TEXT_W = PAGE_W - 2 * MARGIN
GUTTER = 0.7 * cm
COL_W = (TEXT_W - GUTTER) / 2

TOTAL_PAGES = [0]

INK = colors.HexColor("#1f1c17")
MUTED = colors.HexColor("#6a6357")
ACCENT = colors.HexColor("#2b6a62")

BODY = ParagraphStyle(
    "body",
    fontName="Times-Roman",
    fontSize=9.6,
    leading=13.2,
    alignment=TA_JUSTIFY,
    textColor=INK,
)
BODY_FIRST = ParagraphStyle("bodyFirst", parent=BODY, firstLineIndent=0)
TITLE = ParagraphStyle(
    "title",
    fontName="Times-Bold",
    fontSize=21,
    leading=25,
    textColor=INK,
    spaceAfter=10,
)
AUTHOR = ParagraphStyle("author", fontName="Times-Roman", fontSize=10.5, leading=14, textColor=INK)
AFFIL = ParagraphStyle("affil", fontName="Times-Italic", fontSize=9, leading=12, textColor=MUTED)
SECTION = ParagraphStyle(
    "section",
    fontName="Times-Bold",
    fontSize=12.5,
    leading=15,
    textColor=INK,
    spaceBefore=8,
    spaceAfter=4,
)
CAPTION = ParagraphStyle(
    "caption",
    fontName="Times-Roman",
    fontSize=8.2,
    leading=10.5,
    textColor=MUTED,
    spaceBefore=3,
)
QUOTE = ParagraphStyle(
    "quote",
    fontName="Times-Italic",
    fontSize=9.2,
    leading=12.6,
    textColor=colors.HexColor("#3d4a48"),
    leftIndent=6,
    borderPadding=(0, 0, 0, 6),
)


def bullet(text: str) -> Paragraph:
    return Paragraph(f"•&nbsp;&nbsp;{text}", ParagraphStyle("bul", parent=BODY, leftIndent=10, spaceAfter=2))


def figure() -> Drawing:
    """A tiny query-graph drawing so the reader has something to 框选."""
    width = COL_W
    height = 118
    drawing = Drawing(width, height)
    nodes = [(0.16, 0.26), (0.40, 0.12), (0.64, 0.28), (0.86, 0.60), (0.58, 0.80), (0.24, 0.68)]
    edges = [(0, 1), (1, 2), (2, 3), (3, 4), (4, 5), (5, 0), (1, 4), (2, 5)]
    for a, b in edges:
        drawing.add(
            Line(
                nodes[a][0] * width,
                nodes[a][1] * height,
                nodes[b][0] * width,
                nodes[b][1] * height,
                strokeColor=colors.HexColor("#b7c8c5"),
                strokeWidth=0.7,
            )
        )
    for index, (x, y) in enumerate(nodes):
        filled = index % 2 == 0
        drawing.add(
            Circle(
                x * width,
                y * height,
                5.2,
                fillColor=ACCENT if filled else colors.white,
                strokeColor=ACCENT,
                strokeWidth=1,
            )
        )
    return drawing


def results_table() -> Table:
    data = [
        ["System", "R@10", "MRR@10", "Median ms", "Index GB"],
        ["BM25 (baseline)", "0.612", "0.481", "41", "2.1"],
        ["Dense-only (256-d)", "0.655", "0.512", "180", "4.9"],
        ["HX-Index", "0.719", "0.548", "74", "5.3"],
        ["HX-Index, no encoder", "0.612", "0.481", "39", "2.1"],
    ]
    table = Table(data, colWidths=[COL_W * 0.38, COL_W * 0.14, COL_W * 0.17, COL_W * 0.17, COL_W * 0.14])
    table.setStyle(
        TableStyle(
            [
                ("FONTNAME", (0, 0), (-1, 0), "Times-Bold"),
                ("FONTNAME", (0, 1), (-1, -1), "Times-Roman"),
                ("FONTSIZE", (0, 0), (-1, -1), 7.6),
                ("TEXTCOLOR", (0, 0), (-1, -1), INK),
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#efece3")),
                ("LINEBELOW", (0, 0), (-1, 0), 0.6, colors.HexColor("#c9c3b4")),
                ("LINEBELOW", (0, -1), (-1, -1), 0.6, colors.HexColor("#c9c3b4")),
                ("ALIGN", (1, 1), (-1, -1), "RIGHT"),
                ("TOPPADDING", (0, 0), (-1, -1), 2.5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 2.5),
            ]
        )
    )
    return table


def header_footer(c: pdfcanvas.Canvas, doc, page: int, total: int) -> None:
    c.saveState()
    c.setStrokeColor(colors.HexColor("#c9c3b4"))
    c.setLineWidth(0.5)
    c.line(MARGIN, PAGE_H - MARGIN + 8, PAGE_W - MARGIN, PAGE_H - MARGIN + 8)
    c.setFont("Helvetica", 7)
    c.setFillColor(MUTED)
    c.drawString(MARGIN, PAGE_H - MARGIN + 12, "PREPRINT · UNDER REVIEW")
    c.drawRightString(PAGE_W - MARGIN, PAGE_H - MARGIN + 12, "ScholarBox demo")
    c.line(MARGIN, MARGIN - 10, PAGE_W - MARGIN, MARGIN - 10)
    c.drawString(MARGIN, MARGIN - 20, "arXiv:2501.00042v2 [cs.IR]  12 Jan 2025")
    c.drawRightString(PAGE_W - MARGIN, MARGIN - 20, f"{page} / {total}")
    c.restoreState()


def story_parts():
    """Page 1: title block + Introduction / Method. Page 2: Results onward."""
    page1 = [
        Paragraph("A Hybrid Lexical–Dense Index for Scientific Literature Retrieval", TITLE),
        Paragraph("Mira Halvorsen, Daniel Okonkwo, Lin Wei, Sofia Fernández", AUTHOR),
        Paragraph(
            "Institute for Information Retrieval · Northfield University<br/>"
            "mira.h@northfield.edu · d.okonkwo@northfield.edu",
            AFFIL,
        ),
        Spacer(1, 10),
        Paragraph("Abstract", SECTION),
        Paragraph(
            "Retrieval over scientific corpora is dominated by two failure modes: lexical systems "
            "miss paraphrase, while dense encoders flatten rare terminology into generic regions of "
            "the embedding space. We describe HX-Index, a hybrid structure that preserves an auditable "
            "token index for long-tail terms and adds a small set of learned projections for semantic "
            "recall. The system keeps a single on-disk format, supports incremental updates without "
            "retraining, and degrades gracefully to pure BM25 when the encoder is unavailable. Across "
            "41,208 papers, HX-Index improves recall@10 by 6.4 points over a dense-only baseline while "
            "cutting median latency by 58%, and it remains within 1.2 points of the dense baseline on "
            "adversarial paraphrase queries where lexical evidence is absent.",
            BODY_FIRST,
        ),
        Spacer(1, 6),
        Paragraph(
            "<i>Keywords: information retrieval · hybrid search · scientific literature · "
            "reproducible evaluation</i>",
            ParagraphStyle("kw", parent=BODY, textColor=MUTED, fontSize=8.8, alignment=0),
        ),
        FrameBreak(),
        Paragraph("1&nbsp;&nbsp;Introduction", SECTION),
        Paragraph(
            "Reading a scientific corpus is a retrieval problem before it is a reading problem. A "
            "researcher who cannot find the right four pages will never annotate them. Yet the tooling "
            "that surrounds literature review has drifted away from the underlying files: libraries are "
            "locked into proprietary databases, annotations live in sidecar stores, and the PDF itself "
            "becomes an attachment rather than a document.",
            BODY_FIRST,
        ),
        Spacer(1, 4),
        Paragraph(
            "This paper argues that the opposite arrangement is both simpler and more durable. If the "
            "folder is the database, then every operation a reader performs — opening, highlighting, "
            "summarising — leaves a diffable artifact behind. Version control, sync, and provenance all "
            "become file operations.",
            BODY,
        ),
        Spacer(1, 6),
        Paragraph("1.1&nbsp;&nbsp;Contributions", SECTION),
        bullet("A two-stage index that keeps lexical and dense signals separable."),
        bullet("An incremental update path with no retraining and no index rebuild."),
        bullet("An evaluation harness that runs offline on a single laptop."),
        Spacer(1, 8),
        Paragraph("1.2&nbsp;&nbsp;Reading order", SECTION),
        Paragraph(
            "Because the index is rebuilt from the corpus, a reader can point at any ranking and ask "
            "which tokens produced it. We treat that auditability as a product requirement rather than "
            "a debugging convenience.",
            BODY,
        ),
        FrameBreak(),
        Paragraph("2&nbsp;&nbsp;Method", SECTION),
        Paragraph(
            "HX-Index stores two views of every document. The lexical view is an inverted index over "
            "normalised tokens with positional payloads. The dense view is a 256-dimensional projection "
            "produced by a frozen encoder and stored as int8 vectors in a flat file.",
            BODY_FIRST,
        ),
        Spacer(1, 4),
        Paragraph(
            "<i>At query time both views are scored and combined with a tuned weight. Because the "
            "lexical view is intact, every ranking can be explained by pointing at matched terms.</i>",
            QUOTE,
        ),
        Spacer(1, 8),
        figure(),
        Paragraph(
            "Figure 1. Query graph over the hybrid index. Lexical anchors (solid) and dense neighbours "
            "(open).",
            CAPTION,
        ),
        Spacer(1, 8),
        Paragraph(
            "The projection is trained once on 200k query–document pairs and then frozen; incremental "
            "updates only touch the inverted index, which is why a rebuild takes minutes rather than "
            "hours.",
            BODY,
        ),
    ]

    page2 = [
        Paragraph("3&nbsp;&nbsp;Results", SECTION),
        results_table(),
        Paragraph(
            "Table 1. Retrieval quality and latency on the held-out split (41,208 papers).",
            CAPTION,
        ),
        Spacer(1, 6),
        Paragraph(
            "The hybrid index dominates in every bucket except single-term abbreviation lookups, where "
            "pure BM25 is already optimal and the encoder only adds overhead.",
            BODY,
        ),
        Spacer(1, 10),
        Paragraph("4&nbsp;&nbsp;Discussion", SECTION),
        Paragraph(
            "Retrieval systems for scientific literature must reconcile two competing needs: precise "
            "lexical matching for terminology, and semantic generalisation across paraphrases. We study a "
            "hybrid index that keeps token statistics for rare terms while routing frequent queries to a "
            "dense encoder. The design is deliberately boring: a single inverted index, a fixed set of "
            "learned projections, and a scoring function that can be audited term by term.",
            BODY_FIRST,
        ),
        Spacer(1, 4),
        Paragraph(
            "The hybrid design also has an operational advantage that rarely appears in papers: it can be "
            "rebuilt from the corpus in minutes, which means a reader can trust that the index is "
            "reproducible rather than an artefact of someone else's training run.",
            BODY,
        ),
        FrameBreak(),
        Paragraph("5&nbsp;&nbsp;Conclusion", SECTION),
        Paragraph(
            "A literature tool should leave the documents as it found them: plain folders, plain PDFs, "
            "plain markdown. HX-Index shows that the retrieval layer can follow the same rule — the "
            "hybrid structure is small enough to commit alongside the papers it indexes, and every "
            "ranking it produces can be audited by opening a text file.",
            BODY_FIRST,
        ),
        Spacer(1, 4),
        Paragraph(
            "We therefore treat the index as an artifact of the reading session rather than a service. "
            "It travels with the corpus, it can be rebuilt offline, and when the encoder is missing the "
            "system simply stops pretending to be semantic.",
            BODY,
        ),
        Spacer(1, 10),
        Paragraph("References", SECTION),
        Paragraph(
            "Robertson, S. and Zaragoza, H. (2009). The probabilistic relevance framework: BM25 and "
            "beyond. <i>Foundations and Trends in IR</i>, 3(4), 333–389.",
            ParagraphStyle("ref", parent=BODY, fontSize=8.6, leading=11.4, spaceAfter=3),
        ),
        Paragraph(
            "Karpukhin, V. et al. (2020). Dense passage retrieval for open-domain question answering. "
            "EMNLP.",
            ParagraphStyle("ref", parent=BODY, fontSize=8.6, leading=11.4, spaceAfter=3),
        ),
        Paragraph(
            "Thakur, N. et al. (2021). BEIR: A heterogeneous benchmark for zero-shot evaluation of "
            "information retrieval models. NeurIPS Datasets and Benchmarks.",
            ParagraphStyle("ref", parent=BODY, fontSize=8.6, leading=11.4, spaceAfter=3),
        ),
        Paragraph(
            "Bruch, S. et al. (2023). An analysis of fusion functions for hybrid retrieval. "
            "<i>ACM TOIS</i>, 42(1).",
            ParagraphStyle("ref", parent=BODY, fontSize=8.6, leading=11.4),
        ),
    ]
    return page1, page2


def make_doc(target: Path, page_index: int, total: int) -> BaseDocTemplate:
    """One document == one page: far more predictable than template switching."""

    def footer(c: pdfcanvas.Canvas, doc) -> None:
        header_footer(c, doc, page_index, total)

    head_h = 268
    col_h = PAGE_H - 2 * MARGIN - head_h - 22
    if page_index == 1:
        frames = [
            Frame(MARGIN, PAGE_H - MARGIN - head_h, TEXT_W, head_h, id="head", showBoundary=0),
            Frame(MARGIN, MARGIN, COL_W, col_h, id="c1", showBoundary=0),
            Frame(MARGIN + COL_W + GUTTER, MARGIN, COL_W, col_h, id="c2", showBoundary=0),
        ]
    else:
        frames = [
            Frame(MARGIN, MARGIN, COL_W, PAGE_H - 2 * MARGIN, id="d1", showBoundary=0),
            Frame(MARGIN + COL_W + GUTTER, MARGIN, COL_W, PAGE_H - 2 * MARGIN, id="d2", showBoundary=0),
        ]

    doc = BaseDocTemplate(
        str(target),
        pagesize=A4,
        leftMargin=MARGIN,
        rightMargin=MARGIN,
        topMargin=MARGIN,
        bottomMargin=MARGIN,
        title="A Hybrid Lexical–Dense Index for Scientific Literature Retrieval",
        author="Mira Halvorsen, Daniel Okonkwo, Lin Wei, Sofia Fernández",
    )
    doc.addPageTemplates([PageTemplate(id=f"p{page_index}", frames=frames, onPage=footer)])
    return doc


def build() -> None:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    page1, page2 = story_parts()
    total = 2
    parts = []
    for index, story in enumerate((page1, page2), start=1):
        part = OUT.with_name(f".part{index}.pdf")
        make_doc(part, index, total).build(story)
        parts.append(part)

    from pypdf import PdfWriter

    writer = PdfWriter()
    for part in parts:
        writer.append(str(part))
        part.unlink()
    with OUT.open("wb") as handle:
        writer.write(handle)
    writer.close()
    print(f"wrote {OUT} ({OUT.stat().st_size:,} bytes, {len(parts)} pages)")


if __name__ == "__main__":
    build()
