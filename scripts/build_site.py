"""Build only the public web interface; never copy local data or credentials."""
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "dist"
ASSETS = (
    "index.html", "app.js", "visuals.js", "style.css", "sw.js", "manifest.webmanifest",
    "icon.svg", "icon-192.png", "icon-512.png", "apple-touch-icon.png",
)


def build():
    OUTPUT.mkdir(exist_ok=True)
    for name in ASSETS:
        shutil.copyfile(ROOT / "static" / name, OUTPUT / name)
    index = OUTPUT / "index.html"
    index.write_text(index.read_text().replace(
        "<head>", '<head>\n  <meta name="casa-hosting" content="static">', 1
    ))
    print("Casa Universal: interface pública criada em dist/ (central local separada).")


if __name__ == "__main__":
    build()
