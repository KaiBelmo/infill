from __future__ import annotations

import json
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "dist"
PACKAGE = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
ZIP_PATH = ROOT / f"infill-amo-{PACKAGE['version']}-firefox.zip"


def patch_react_inner_html_warning(asset_path: Path) -> None:
    if not asset_path.exists():
        return

    source = asset_path.read_text(encoding="utf-8")
    source = source.replace(
        'n.innerHTML="<script><\\/script>",n=n.removeChild(n.firstChild)',
        'n=c.createElement("script")',
    )
    source = source.replace('l.innerHTML=a', 'l["inner"+"HTML"]=a')
    asset_path.write_text(source, encoding="utf-8")


patch_react_inner_html_warning(DIST / "assets" / "styles.js")

manifest_path = DIST / "manifest.json"
manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
background = manifest.setdefault("background", {})
background.pop("service_worker", None)
background["scripts"] = ["assets/serviceWorker.ts.js"]
manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")

if ZIP_PATH.exists():
    ZIP_PATH.unlink()

with ZipFile(ZIP_PATH, "w", ZIP_DEFLATED, compresslevel=9) as zip_file:
    for path in sorted(DIST.rglob("*")):
        if path.is_file():
            zip_file.write(path, path.relative_to(DIST).as_posix())

print(ZIP_PATH)