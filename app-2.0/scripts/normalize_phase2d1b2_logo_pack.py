#!/usr/bin/env python3
"""Deterministically decode and normalize the user-reviewed Phase 2D1B.2 logo pack.

The pipeline never redraws, recolours, stretches, removes an uncertain background,
or fetches a remote asset. Transparent outer whitespace may be trimmed while a
small safety inset is retained. Opaque sources keep their complete frame.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from PIL import Image, UnidentifiedImageError


IDS = {
    "banks": {
        "aeon-bank": "aeon-bank", "affin-bank": "affin-bank", "agrobank": "agrobank",
        "alliance-bank": "alliance-bank", "ambank": "ambank", "bank-islam": "bank-islam",
        "bank-muamalat": "bank-muamalat", "bank-rakyat": "bank-rakyat",
        "boost-bank": "boost-bank", "bsn": "bsn", "cimb": "cimb", "gxbank": "gxbank",
        "hong-leong-bank": "hong-leong-bank", "hsbc": "hsbc", "maybank": "maybank",
        "mbsb": "mbsb-bank", "ocbc": "ocbc", "public-bank": "publicbank", "rhb": "rhb",
        "ryt-bank": "ryt-bank", "standard-chartered": "standard-chartered", "uob": "uob",
    },
    "ewallets": {
        "bigpay": "bigpay", "boost-ewallet": "boost", "grabpay": "grabpay", "setel": "setel",
        "shopeepay": "shopeepay", "touch-n-go-ewallet": "tng",
    },
    "networks": {
        "visa": "visa", "mastercard": "mastercard", "american-express": "amex",
    },
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def shape_for(width: int, height: int) -> str:
    ratio = width / max(1, height)
    if 0.85 <= ratio <= 1.18:
        return "square"
    if ratio > 1.55:
        return "wide"
    return "compact"


def normalize(source: Path, destination: Path) -> dict:
    with Image.open(source) as opened:
        detected_format = opened.format or "unknown"
        opened.load()
        original_size = opened.size
        image = opened.convert("RGBA")

    crop_applied = False
    content_box = image.getchannel("A").getbbox()
    if content_box and content_box != (0, 0, image.width, image.height):
        left, top, right, bottom = content_box
        pad = max(2, round(max(right - left, bottom - top) * 0.04))
        safe_box = (
            max(0, left - pad), max(0, top - pad),
            min(image.width, right + pad), min(image.height, bottom + pad),
        )
        if safe_box != (0, 0, image.width, image.height):
            image = image.crop(safe_box)
            crop_applied = True

    if max(image.size) > 1024:
        image.thumbnail((1024, 1024), Image.Resampling.LANCZOS)

    destination.parent.mkdir(parents=True, exist_ok=True)
    image.save(destination, format="PNG", optimize=True, compress_level=9)
    return {
        "detectedFileType": f"image/{detected_format.lower().replace('jpeg', 'jpeg')}",
        "sourceDimensions": {"width": original_size[0], "height": original_size[1]},
        "normalizedDimensions": {"width": image.width, "height": image.height},
        "assetShape": shape_for(image.width, image.height),
        "cropApplied": crop_applied,
        "outputSha256": sha256(destination),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("source_root", type=Path)
    parser.add_argument("public_root", type=Path)
    parser.add_argument("manifest", type=Path)
    args = parser.parse_args()

    records = []
    skipped = []
    for group, mapping in IDS.items():
        folder = args.source_root / group
        for source in sorted(folder.glob("*")):
            if not source.is_file() or source.name == ".DS_Store":
                continue
            stem = source.name.removesuffix("-source.png")
            stable_id = mapping.get(stem)
            if not stable_id:
                skipped.append({"sourceFilename": source.name, "reason": "unmapped-source"})
                continue
            output_group = "networks/user-reviewed" if group == "networks" else f"brands/user-reviewed/{group}"
            relative = Path("assets") / output_group / f"{stable_id}.png"
            destination = args.public_root / relative
            try:
                facts = normalize(source, destination)
                records.append({
                    "sourceFilename": source.name,
                    "sourceRelativePath": str(source.relative_to(args.source_root)),
                    "sourceSha256": sha256(source),
                    "normalizedOutput": str(relative),
                    "brandId": stable_id if group != "networks" else None,
                    "networkId": stable_id if group == "networks" else None,
                    "assetGroup": group,
                    "fitMode": "contain",
                    "safePadding": "8%",
                    **facts,
                })
            except (UnidentifiedImageError, OSError, ValueError) as error:
                skipped.append({"sourceFilename": source.name, "reason": f"decode-failed:{error}"})

    manifest = {
        "schemaVersion": 1,
        "phase": "2D1B.2",
        "sourcePack": str(args.source_root),
        "policy": "user-reviewed-local-source; deterministic decode; no remote acquisition; no redraw; no recolour",
        "totals": {
            "banks": sum(record["assetGroup"] == "banks" for record in records),
            "ewallets": sum(record["assetGroup"] == "ewallets" for record in records),
            "networks": sum(record["assetGroup"] == "networks" for record in records),
            "normalized": len(records),
            "skipped": len(skipped),
        },
        "assets": records,
        "skipped": skipped,
    }
    args.manifest.parent.mkdir(parents=True, exist_ok=True)
    args.manifest.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(manifest["totals"], ensure_ascii=False))
    return 0 if not skipped else 2


if __name__ == "__main__":
    raise SystemExit(main())
