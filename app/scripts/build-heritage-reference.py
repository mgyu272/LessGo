#!/usr/bin/env python3
"""Build a private, server-side heritage photo reference dataset from a supplied ZIP.

The output directory is intentionally versioned and must not already exist.
Source names only produce unverified candidates; this script does not verify rights
or identify a cultural asset from pixels.
"""
import argparse
import hashlib
import json
import re
import stat
import sys
import zipfile
from collections import Counter
from pathlib import Path, PurePosixPath

APP_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUT = APP_ROOT / "server-data" / "heritage_reference_4a"
FOLDER_TO_SPOT = {"심우장": "simujang", "정릉": "jeongneung", "의릉": "uiryeong"}
IMAGE_MIMES = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp"}
ANGLE_WORDS = {"정면": "정면", "측면": "측면", "뒤편": "후면", "뒷편": "후면", "탑뷰": "상부 조망", "풀샷": "전체 전경"}
SCENE_WORDS = {"실내"}
TYPE_WORDS = {
    "석물": "석물", "비석문": "비문", "능침": "능침", "봉분": "봉분", "비각": "비각",
    "정자각": "정자각", "홍살문": "홍살문", "수라간": "수라간", "숲길": "숲길",
    "신덕왕후도서관": "도서관", "왕릉": "왕릉", "재실": "재실", "제기고": "제기고",
    "전시장": "전시 공간", "입구": "출입구", "건물": "건물",
}
REQUIRED = ("id", "spotId", "spotName", "filename", "relativePath", "objectName", "objectType", "viewAngle", "source", "verificationStatus")


def image_mime(data: bytes):
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


def object_hints(filename: str, spot_name: str):
    stem = Path(filename).stem
    prefix = spot_name + "_"
    remainder = stem[len(prefix):] if stem.startswith(prefix) else stem
    tokens = [token for token in remainder.split("_") if token]
    known_tokens = set(TYPE_WORDS) | set(ANGLE_WORDS) | SCENE_WORDS
    tokens = [re.sub(r"\d+$", "", token) if re.sub(r"\d+$", "", token) in known_tokens else token for token in tokens]
    useful = [token for token in tokens if token not in ANGLE_WORDS and token not in SCENE_WORDS]
    object_name = " ".join(useful) or None
    if "석물" in useful:
        object_type = TYPE_WORDS["석물"]
    elif "비석문" in useful:
        object_type = TYPE_WORDS["비석문"]
    else:
        object_type = next((TYPE_WORDS[token] for token in useful if token in TYPE_WORDS), None)
    view_angle = next((ANGLE_WORDS[token] for token in tokens if token in ANGLE_WORDS), None)
    return object_name, object_type, view_angle


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--zip", required=True, type=Path, help="Input photo ZIP (read-only)")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT, help=f"New output directory (default: {DEFAULT_OUT})")
    args = parser.parse_args()
    zip_path = args.zip.expanduser().resolve()
    out_root = args.out.expanduser().resolve()
    if not zip_path.is_file():
        raise SystemExit(f"ZIP not found: {zip_path}")
    if out_root.exists():
        raise SystemExit(f"Refusing to overwrite existing dataset: {out_root}")

    spot_data = json.loads((APP_ROOT / "public" / "data" / "spots.json").read_text(encoding="utf-8"))
    spots = {spot["id"]: spot for spot in spot_data["spots"]}
    for spot_id in FOLDER_TO_SPOT.values():
        if spot_id not in spots:
            raise SystemExit(f"Expected spot ID is missing in spots.json: {spot_id}")

    with zipfile.ZipFile(zip_path) as archive:
        bad_member = archive.testzip()
        if bad_member:
            raise SystemExit(f"ZIP integrity error in member: {bad_member}")
        records = []
        seen_hashes = {}
        per_spot = Counter()
        for member in archive.infolist():
            if member.is_dir():
                continue
            member_path = PurePosixPath(member.filename)
            if member_path.is_absolute() or ".." in member_path.parts or len(member_path.parts) != 3 or member_path.parts[0] != "사진":
                raise SystemExit(f"Unexpected or unsafe archive path: {member.filename!r}")
            folder, filename = member_path.parts[1], member_path.parts[2]
            if folder not in FOLDER_TO_SPOT:
                raise SystemExit(f"Unknown place folder: {folder!r}")
            extension = Path(filename).suffix.lower()
            if extension not in IMAGE_MIMES:
                raise SystemExit(f"Unsupported image extension: {member.filename!r}")
            mode = (member.external_attr >> 16) & 0xFFFF
            if stat.S_ISLNK(mode):
                raise SystemExit(f"Symbolic links are not accepted: {member.filename!r}")
            content = archive.read(member)
            detected = image_mime(content)
            if detected != IMAGE_MIMES[extension]:
                raise SystemExit(f"Image content/extension mismatch: {member.filename!r} ({detected})")
            digest = hashlib.sha256(content).hexdigest()
            if digest in seen_hashes:
                raise SystemExit(f"Duplicate image content: {member.filename!r} and {seen_hashes[digest]!r}")
            seen_hashes[digest] = member.filename

            spot_id = FOLDER_TO_SPOT[folder]
            spot_name = spots[spot_id]["name"]["ko"]
            per_spot[spot_id] += 1
            record_id = f"hlref-{spot_id}-{per_spot[spot_id]:03d}"
            relative_path = PurePosixPath("photos", spot_id, record_id + extension).as_posix()
            object_name, object_type, view_angle = object_hints(filename, folder)
            records.append({
                "id": record_id,
                "spotId": spot_id,
                "spotName": spot_name,
                "filename": filename,
                "relativePath": relative_path,
                "objectName": object_name,
                "objectType": object_type,
                "viewAngle": view_angle,
                "source": "provided_archive:LessGo_사진자료.zip (creator and license not supplied)",
                "verificationStatus": "unverified_filename_only",
                "mimeType": detected,
                "sizeBytes": len(content),
                "sha256": digest,
            })

        expected_folders = set(FOLDER_TO_SPOT)
        present_folders = {PurePosixPath(member.filename).parts[1] for member in archive.infolist() if not member.is_dir() and len(PurePosixPath(member.filename).parts) > 1}
        if present_folders != expected_folders:
            raise SystemExit(f"Place folder mismatch; expected {sorted(expected_folders)}, found {sorted(present_folders)}")

    manifest = {
        "schemaVersion": 1,
        "datasetId": "lessgo-heritage-reference-4a",
        "visibility": "private_server_side_reference",
        "sourceArchive": {"filename": "LessGo_사진자료.zip", "attributionStatus": "unknown", "publicationAllowed": False},
        "verificationNote": "Filename-derived candidates only. No visual, historical, ownership, or license verification has been performed.",
        "photos": records,
    }
    for record in records:
        target = (out_root / record["relativePath"]).resolve()
        if out_root not in target.parents:
            raise SystemExit(f"Output path escapes dataset: {record['relativePath']}")
        target.parent.mkdir(parents=True, exist_ok=True)
        member_name = next(f"사진/{FOLDER_TO_SPOT_INVERSE[record['spotId']]}/{record['filename']}" for _ in [0])
        with zipfile.ZipFile(zip_path) as archive:
            target.write_bytes(archive.read(member_name))
    out_root.mkdir(parents=True, exist_ok=True)
    (out_root / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Created {len(records)} private reference images at {out_root}")
    for spot_id, count in sorted(per_spot.items()):
        print(f"{spot_id}: {count}")


FOLDER_TO_SPOT_INVERSE = {spot_id: folder for folder, spot_id in FOLDER_TO_SPOT.items()}

if __name__ == "__main__":
    main()
