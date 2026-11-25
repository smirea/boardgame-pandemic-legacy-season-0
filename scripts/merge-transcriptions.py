#!/usr/bin/env python3
"""Merge batch transcriptions into the two files the extractor reads.

A batch is either card-shaped (record id -> faces) or debrief-shaped
(entry number -> text). The extractor applies faces.json and debrief.json.
"""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ARCHIVE = ROOT / "archive"
BATCHES = ARCHIVE / "transcriptions" / "batches"
ASSIGNMENTS = ARCHIVE / "transcriptions" / "assignments"
ROLES = {"rules", "flavor", "both", "art", "blank"}
MARKERS = {"STOP", "PAUSE", "continue"}


def main() -> None:
    faces: dict = {}
    debrief: dict = {}
    problems: list[str] = []
    for path in sorted(BATCHES.glob("*.json")):
        data = json.loads(path.read_text())
        if not isinstance(data, dict) or not data:
            problems.append(f"{path.name}: empty")
            continue
        keys = list(data)
        if all(isinstance(key, str) and key.isdigit() and len(key) == 3 for key in keys):
            for number, spec in data.items():
                if not isinstance(spec, dict) or not (spec.get("transcription") or spec.get("flavor")):
                    problems.append(f"{path.name}: entry {number} has no text")
                    continue
                if number in debrief:
                    problems.append(f"{path.name}: duplicate entry {number}")
                debrief[number] = spec
            continue
        for rid, spec in data.items():
            if not isinstance(spec, dict) or "faces" not in spec:
                problems.append(f"{path.name}: {rid} is not a face record")
                continue
            for face_id, face in spec["faces"].items():
                role = face.get("role")
                if role not in ROLES:
                    problems.append(f"{path.name}: {rid} {face_id} role {role}")
                text = (face.get("transcription") or "").strip()
                if role in ("rules", "flavor", "both") and not text:
                    problems.append(f"{path.name}: {rid} {face_id} empty transcription")
            marker = spec.get("marker")
            if marker is not None and marker not in MARKERS:
                problems.append(f"{path.name}: {rid} marker {marker}")
            if rid in faces:
                problems.append(f"{path.name}: duplicate record {rid}")
            faces[rid] = spec

    expected: set[str] = set()
    for path in sorted(ASSIGNMENTS.glob("*.json")):
        data = json.loads(path.read_text())
        if "pages" in data:
            continue
        for item in data["items"]:
            expected.add(item["id"])
    missing = sorted(expected - set(faces))
    for rid in missing:
        problems.append(f"missing record {rid}")

    (ARCHIVE / "transcriptions" / "faces.json").write_text(json.dumps(faces, indent=2, ensure_ascii=False) + "\n")
    (ARCHIVE / "transcriptions" / "debrief.json").write_text(
        json.dumps(debrief, indent=2, ensure_ascii=False) + "\n"
    )
    print(f"faces {len(faces)}")
    print(f"debrief {len(debrief)}")
    print(f"missing-records {len(missing)}")
    print(f"problems {len(problems)}")
    for line in problems[:80]:
        print(line)


if __name__ == "__main__":
    main()
