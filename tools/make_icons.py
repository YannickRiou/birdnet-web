"""Génère les icônes PNG de Piaf à partir de icons/icon.svg (oiseau en barres de spectrogramme).

Déclinaisons : arrondie (192, 512), carrée pour iOS qui arrondit lui-même (180) et « maskable »
pour Android (contenu réduit à 80 % au centre). Le rendu SVG passe par Edge ou Chrome en mode headless.
Usage : python tools/make_icons.py   (Python >= 3.8 + Pillow, Edge ou Chrome installé)
"""
import os
import pathlib
import re
import shutil
import subprocess
import tempfile

from PIL import Image

ICONS = pathlib.Path(__file__).resolve().parent.parent / "icons"
BROWSERS = [
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "google-chrome", "chromium", "msedge",
]


def browser():
    for b in BROWSERS:
        if os.path.exists(b) or shutil.which(b):
            return b
    raise SystemExit("Edge ou Chrome introuvable pour le rendu SVG.")


def variants(svg):
    """Renvoie (arrondie, carrée, maskable) à partir du SVG source (fond = premier <rect>)."""
    rect = re.search(r"<rect [^>]*/>", svg).group(0)
    fill = re.search(r'fill="([^"]+)"', rect).group(1)
    square = svg.replace(rect, f'<rect width="512" height="512" fill="{fill}"/>')
    head, body = square.split("/>", 2)[0:2], square.split("/>", 2)[2]
    inner = body.rsplit("</svg>", 1)[0]
    maskable = (f'{head[0]}/>{head[1]}/><g transform="translate(51.2 51.2) scale(0.8)">{inner}</g></svg>')
    return svg, square, maskable


def render(svg, exe, tmp):
    html = pathlib.Path(tmp) / "icon.html"
    out = pathlib.Path(tmp) / "icon.png"
    sized = svg.replace("<svg ", '<svg width="512" height="512" ', 1)
    html.write_text(f'<html><body style="margin:0;background:transparent">{sized}</body></html>', "utf8")
    subprocess.run([exe, "--headless=new", "--disable-gpu", "--hide-scrollbars", f"--screenshot={out}",
                    "--window-size=512,512", "--default-background-color=00000000", html.as_uri()],
                   check=True, capture_output=True, timeout=60)
    return Image.open(out).convert("RGBA").crop((0, 0, 512, 512))


def main():
    exe = browser()
    rounded, square, maskable = variants((ICONS / "icon.svg").read_text("utf8"))
    with tempfile.TemporaryDirectory() as tmp:
        r, s, m = (render(v, exe, tmp) for v in (rounded, square, maskable))
    s.resize((180, 180), Image.LANCZOS).save(ICONS / "apple-touch-icon.png")
    r.resize((192, 192), Image.LANCZOS).save(ICONS / "icon-192.png")
    r.save(ICONS / "icon-512.png")
    m.save(ICONS / "icon-maskable-512.png")
    print("icons/ : apple-touch-icon.png, icon-192.png, icon-512.png, icon-maskable-512.png")


if __name__ == "__main__":
    main()
