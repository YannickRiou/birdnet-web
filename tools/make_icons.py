"""Génère les icônes de Piaf (SVG + PNG) : silhouette d'un rougegorge de profil, posé sur une branche.

Le contour est une spline de Catmull-Rom fermée ; la même géométrie sert au SVG et aux PNG.
Usage : python tools/make_icons.py   (Python >= 3.8 + Pillow)
"""
import pathlib

from PIL import Image, ImageChops, ImageDraw

OUT = pathlib.Path(__file__).resolve().parent.parent / "icons"
FOREST, PAPER, ROBIN, INK, MOSS = "#24503A", "#F7F2E7", "#E07A3F", "#1E2B22", "#7E9A5A"

# Contour du corps (repère 512 × 512), de la base du bec vers la nuque, le dos, la queue, le ventre.
BODY = [(372, 158), (345, 136), (306, 136), (276, 156), (238, 196), (196, 236), (160, 280), (126, 322),
        (84, 366), (70, 384), (92, 388), (138, 360), (180, 340), (228, 336), (280, 324), (324, 296),
        (356, 252), (376, 200)]
BEAK = [(368, 156), (414, 172), (372, 190)]
BREAST = (292, 150, 398, 322)          # ellipse orange, découpée par le contour du corps
EYE = (343, 166, 6.5)
LEGS = [((240, 334), (232, 392)), ((268, 330), (264, 388))]
BRANCH = ((36, 412), (484, 366))


def catmull_rom(points, steps=24):
    """Échantillonne une spline fermée passant par tous les points."""
    out = []
    n = len(points)
    for i in range(n):
        p0, p1, p2, p3 = points[i - 1], points[i], points[(i + 1) % n], points[(i + 2) % n]
        for s in range(steps):
            t = s / steps
            t2, t3 = t * t, t * t * t
            out.append(tuple(0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2
                                    + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3) for k in (0, 1)))
    return out


def svg():
    outline = " ".join(f"{x:.1f},{y:.1f}" for x, y in catmull_rom(BODY))
    x0, y0, x1, y1 = BREAST
    legs = "".join(f'<line x1="{a[0]}" y1="{a[1]}" x2="{b[0]}" y2="{b[1]}"/>' for a, b in LEGS)
    (bx0, by0), (bx1, by1) = BRANCH
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">'
        f'<rect width="512" height="512" rx="112" fill="{FOREST}"/>'
        f'<defs><clipPath id="b"><polygon points="{outline}"/></clipPath></defs>'
        f'<g stroke="{INK}" stroke-width="7" stroke-linecap="round">{legs}</g>'
        f'<line x1="{bx0}" y1="{by0}" x2="{bx1}" y2="{by1}" stroke="{MOSS}" stroke-width="14" stroke-linecap="round"/>'
        f'<polygon points="{" ".join(f"{x},{y}" for x, y in BEAK)}" fill="{INK}"/>'
        f'<polygon points="{outline}" fill="{PAPER}"/>'
        f'<ellipse cx="{(x0 + x1) / 2}" cy="{(y0 + y1) / 2}" rx="{(x1 - x0) / 2}" ry="{(y1 - y0) / 2}" fill="{ROBIN}" clip-path="url(#b)"/>'
        f'<circle cx="{EYE[0]}" cy="{EYE[1]}" r="{EYE[2]}" fill="{INK}"/>'
        "</svg>\n"
    )


def png(size, scale=1.0, rounded=True):
    """scale < 1 : marge de sécurité pour les icônes « maskable » d'Android."""
    S = size * 4  # sur-échantillonnage pour des bords lisses
    k = S / 512 * scale
    off = S * (1 - scale) / 2
    t = lambda p: (off + p[0] * k, off + p[1] * k)  # noqa: E731

    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((0, 0, S - 1, S - 1), radius=112 * S / 512 if rounded else 0, fill=FOREST)
    for a, b in LEGS:
        d.line([t(a), t(b)], fill=INK, width=round(7 * k))
    (a, b) = BRANCH
    d.line([t(a), t(b)], fill=MOSS, width=round(14 * k))
    for p in (a, b):
        cx, cy = t(p)
        d.ellipse((cx - 7 * k, cy - 7 * k, cx + 7 * k, cy + 7 * k), fill=MOSS)
    d.polygon([t(p) for p in BEAK], fill=INK)

    outline = [t(p) for p in catmull_rom(BODY)]
    d.polygon(outline, fill=PAPER)
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).polygon(outline, fill=255)
    breast = Image.new("L", (S, S), 0)
    ImageDraw.Draw(breast).ellipse((*t(BREAST[:2]), *t(BREAST[2:])), fill=255)
    img.paste(Image.new("RGBA", (S, S), ROBIN), (0, 0), ImageChops.multiply(mask, breast))
    ex, ey = t(EYE[:2])
    r = EYE[2] * k
    d.ellipse((ex - r, ey - r, ex + r, ey + r), fill=INK)
    return img.resize((size, size), Image.LANCZOS)


def main():
    OUT.mkdir(exist_ok=True)
    (OUT / "icon.svg").write_text(svg(), "utf8")
    png(180, rounded=False).save(OUT / "apple-touch-icon.png")  # iOS arrondit lui-même
    png(192).save(OUT / "icon-192.png")
    png(512).save(OUT / "icon-512.png")
    png(512, scale=0.8, rounded=False).save(OUT / "icon-maskable-512.png")
    print("icons/ : icon.svg, apple-touch-icon.png, icon-192.png, icon-512.png, icon-maskable-512.png")


if __name__ == "__main__":
    main()
