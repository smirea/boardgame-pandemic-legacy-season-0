#!/usr/bin/env python3
"""Build archive/ records from the Pandemic Legacy Season 0 workshop save.

The checker in packages/archive reads the JSON this writes. Images are cropped
from the sheet files already in archive/media/original. Transcriptions are OCR,
then card codes and STOP/PAUSE markers are read off those faces.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import unicodedata
from collections import defaultdict
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ARCHIVE = ROOT / "archive"
WORKSHOP = Path(
    os.environ.get(
        "WORKSHOP_JSON",
        "/var/folders/77/zldz5fqx1cl4bh67jk8m060m0000gn/T/grok-goal-97b008dd21f0/implementer/sources/workshop.json",
    )
)
SCRATCH = Path(
    os.environ.get(
        "EXTRACT_SCRATCH",
        "/var/folders/77/zldz5fqx1cl4bh67jk8m060m0000gn/T/grok-goal-97b008dd21f0/implementer",
    )
)
WORKSHOP_ID = "2618224591"
VERSION = "1.17.1"

PUBLISHER = {
    "rulebook": 1,
    "board": 1,
    "pawn": 4,
    "agent": 36,
    "safehouse": 8,
    "incident": 7,
    "threat-marker": 1,
    "tracking-token": 24,
    "objective-token": 3,
    "team": 9,
    "reference-card": 4,
    "passport": 4,
    "intelligence-file": 1,
    "personnel-file": 1,
    "sticker-sheet": 3,
    "threat-card": 48,
    "player-card": 58,
    "temporary-alias": 4,
    "legacy-deck": 1,
    "legacy-card": None,
    "debrief-book": 1,
    "debrief-page": None,
    "dossier": 3,
    "operations-card": 42,
    "safe-deposit-box": 8,
}

PASSPORTS = {
    "af9fd4": ("pink", "allied"),
    "014427": ("pink", "neutral"),
    "9cd8d3": ("pink", "soviet"),
    "baf802": ("white", "allied"),
    "085004": ("white", "neutral"),
    "f777eb": ("white", "soviet"),
    "f782fb": ("green", "allied"),
    "cc97e0": ("green", "neutral"),
    "03de32": ("green", "soviet"),
    "c6bfff": ("black", "allied"),
    "578a2a": ("black", "neutral"),
    "5956cc": ("black", "soviet"),
}

# Single-image tiles identified by looking at them.
KNOWN_TILES = {
    "8da583": ("board", "board", "board", None, "World map. Regions, cities, connections, and the printed incident and surveillance reminders."),
    "474234": ("mod/rules-setup", "rule-page", "mod-extra", None, "In-mod copy of the rulebook setup spread."),
    "dbcdd2": ("mod/rules-turns", "rule-page", "mod-extra", None, "In-mod copy of the player-turn spread."),
    "629330": ("mod/rules-targets", "rule-page", "mod-extra", None, "In-mod copy of the unknown-target and threat-draw spread."),
    "71999f": ("mod/rules-incidents", "rule-page", "mod-extra", None, "In-mod copy of the incidents and game-end spread."),
    "eccabf": ("mod/rules-after", "rule-page", "mod-extra", None, "In-mod copy of the after-the-game spread."),
    "72b7c7": ("mod/rules-book", "rule-page", "mod-extra", None, "In-mod rulebook cover. Further pages are TTS states of this tile."),
    "c5f765": ("overlay/game-calendar", "overlay", "mod-extra", None, "Game calendar tile. The same table is printed in the rulebook."),
    "3d3e0f": ("debrief/index", "reference", "debrief-page", None, "Index sheet for the debrief book."),
    "beba7d": ("debrief/book", "rule-page", "debrief-book", None, "Debrief book. Pages are TTS states. Numbered entries are separate records."),
    "98312e": ("reference/1", "reference", "reference-card", None, "Reference card. Pink pawn printed on the card."),
    "70833e": ("reference/2", "reference", "reference-card", None, "Reference card. White pawn printed on the card."),
    "916d7e": ("reference/3", "reference", "reference-card", None, "Reference card. Blue pawn printed on the card."),
    "37ee75": ("reference/4", "reference", "reference-card", None, "Reference card. Black pawn printed on the card."),
    "a3b180": ("sticker-sheet/portraits", "sticker", "sticker-sheet", None, "Character portrait sticker sheet."),
    "d504a1": ("sticker-sheet/allied-upgrades", "sticker", "sticker-sheet", None, "Allied cover occupations, game-end upgrades, and surveillance sticker sheet."),
    "5ff822": ("token/objective", "token", "objective-token", 3, "Completed/failed objective token. The save stacks 3 copies on this one face (a black star)."),
    "936750": ("token/threat-marker", "token", "threat-marker", 1, "Threat level marker."),
    "aedbf8": ("dossier/1", "dossier", "dossier", 1, "Dossier folio 1. Doors on this folio include 11–20 and A, C, F, G."),
    "072b0f": ("dossier/2", "dossier", "dossier", 1, "Dossier folio 2."),
    "004322": ("dossier/3", "dossier", "dossier", 1, "Dossier folio 3."),
    "bb3648": ("overlay/confidential-alias", "overlay", "mod-extra", None, "Top Secret / Confidential Alias mat."),
    "6625fa": ("passport/pink-allied-flat", "passport", "mod-extra", 1, "Loose copy of the pink Allied passport page with no scratch states. The scratch-track page is passport/pink-allied."),
    "40eeb4": (
        "sticker-sheet/liabilities",
        "sticker",
        "sticker-sheet",
        None,
        "Liability sticker sheet. Eight stickers: Followed, Hassled, Monitored, Airports Alerted, Authorities Watching, Cipher Decoded, Tracked, Recognized.",
    ),
}

# Split cells with no NN-NN pill. Identified by reading the face.
KNOWN_CELLS = {
    "8ef8489d5a98-0": "legacy/end-of-part-1",
    "cc2c7c586e0d-0": "legacy/end-of-legacy-deck",
    "a3ad9647d9f9-0": "legacy/sealed-end-of-legacy-deck",
}

EVENTS = {
    "forecast": "1305",
    "counter-intelligence": "1307",
    "airlift": "1309",
    "cover-of-darkness": "1306",
    "a-holdover-from-the-war": "1308",
}

CODE_RE = re.compile(r"\b(\d{2}-\d{2})([a-z])?\b", re.I)
STOP_RE = re.compile(r"\b(STOP|PAUSE)\b")
DOOR_RE = re.compile(r"\bdoor\s+([0-9]{1,2}|[A-HJ-Z])\b", re.I)
BOX_RE = re.compile(r"\bbox\s+(000[1-8])\b", re.I)
ENTRY_RE = re.compile(r"\b(?:debrief\s+)?entry\s+(\d{3})\b", re.I)
DEBRIEF_NUM_RE = re.compile(r"\bdebrief(?:\s+number)?\s+(\d{3})\b", re.I)
DOOR_TOKEN_RE = re.compile(r"(?i)\s*(?:,\s*|\band\b\s*|&\s*)?([0-9]{1,2}|[A-HJ-Z])\b")
ENTRY_SPLIT_RE = re.compile(r"(?m)^[^\S\n]{0,4}(\d{3})\b")


def door_codes(text: str) -> list[str]:
    """Codes in an open-door list. A lone 0 is door O: that oval is the letter, and the save has no door 0."""
    codes: list[str] = []
    pos = 0
    while True:
        match = DOOR_TOKEN_RE.match(text, pos)
        if not match:
            break
        token = match.group(1).upper()
        if token == "0":
            token = "O"
        codes.append(token)
        pos = match.end()
    return codes


def slug(text: str) -> str:
    text = text.replace("Caiiro", "Cairo").replace("caiiro", "cairo")
    text = unicodedata.normalize("NFKD", text)
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = text.lower()
    text = re.sub(r"[^a-z0-9]+", "-", text).strip("-")
    return text or "unnamed"


def run(cmd: list[str]) -> str:
    return subprocess.check_output(cmd, text=True, stderr=subprocess.DEVNULL)


def image_size(path: Path) -> tuple[int, int]:
    width, height = run(["identify", "-format", "%w %h", str(path)]).split()
    return int(width), int(height)


def stddev(path: Path) -> float:
    return float(run(["magick", str(path), "-format", "%[fx:standard_deviation]", "info:"]))


def ocr_file(path: str) -> str:
    result = subprocess.run(
        ["tesseract", path, "stdout", "--psm", "6"],
        check=False,
        capture_output=True,
        text=True,
    )
    return result.stdout or ""


def ocr_corner(path: str) -> str:
    """Read the NN-NNf pill in the top-right of a card. Whole-face OCR misses it."""
    prepared = subprocess.run(
        [
            "magick",
            path,
            "-gravity",
            "NorthEast",
            "-crop",
            "24%x11%+0+0",
            "+repage",
            "-resize",
            "400%",
            "-colorspace",
            "Gray",
            "-contrast-stretch",
            "2%x2%",
            "png:-",
        ],
        check=False,
        capture_output=True,
    )
    if prepared.returncode != 0 or not prepared.stdout:
        return ""
    result = subprocess.run(
        ["tesseract", "stdin", "stdout", "--psm", "7"],
        input=prepared.stdout,
        check=False,
        capture_output=True,
    )
    return (result.stdout or b"").decode("utf-8", "replace")


def clean_ocr(text: str) -> str:
    lines = [re.sub(r"[ \t]+", " ", line).strip() for line in text.splitlines()]
    out: list[str] = []
    blank = 0
    for line in lines:
        if not line:
            blank += 1
            if blank == 1 and out:
                out.append("")
            continue
        blank = 0
        out.append(line)
    return "\n".join(out).strip()


def crop_sheet(src: str, dest_dir: str, prefix: str, num_w: int, num_h: int) -> int:
    source = Path(src)
    target = Path(dest_dir)
    target.mkdir(parents=True, exist_ok=True)
    width, height = image_size(source)
    cell_w = width // num_w
    cell_h = height // num_h
    # One tile command. Cells are numbered left to right, top to bottom.
    subprocess.check_call(
        [
            "magick",
            str(source),
            "-crop",
            f"{cell_w}x{cell_h}",
            "+repage",
            "-quality",
            "90",
            "+adjoin",
            str(target / f"{prefix}-%d.jpg"),
        ],
        stdout=subprocess.DEVNULL,
    )
    return num_w * num_h


class Node:
    def __init__(self, obj: dict, path: str, parent: str | None):
        self.obj = obj
        self.path = path
        self.parent = parent
        self.guid = obj.get("GUID") or ""
        self.name = obj.get("Name") or ""
        self.nick = obj.get("Nickname") or ""
        self.children = obj.get("ContainedObjects") or []
        self.child_guids = [child.get("GUID") for child in self.children if child.get("GUID")]
        states = obj.get("States") or {}
        self.state_guids = [state.get("GUID") for state in states.values() if state.get("GUID")]


def walk(nodes: list, prefix: str, parent: str | None, found: list[Node]) -> None:
    for index, obj in enumerate(nodes):
        path = str(index) if prefix == "" else f"{prefix}/{index}"
        node = Node(obj, path, parent)
        found.append(node)
        if node.children:
            walk(node.children, path, node.guid, found)


def deck_of(obj: dict, ancestors: list[dict]) -> tuple[str | None, dict | None, int | None]:
    card_id = obj.get("CardID")
    for node in [obj, *ancestors]:
        decks = node.get("CustomDeck") or {}
        if not decks or card_id is None:
            continue
        deck_id = str(card_id // 100)
        if deck_id in decks:
            return deck_id, decks[deck_id], card_id - int(deck_id) * 100
    return None, None, None


def load_ocr_cache() -> dict[str, str]:
    path = SCRATCH / "ocr-cache.json"
    if path.exists():
        return json.loads(path.read_text())
    return {}


def save_ocr_cache(cache: dict[str, str]) -> None:
    SCRATCH.mkdir(parents=True, exist_ok=True)
    (SCRATCH / "ocr-cache.json").write_text(json.dumps(cache))


def main() -> None:
    save = json.loads(WORKSHOP.read_text())
    url_map = json.loads((ARCHIVE / "media" / "url-map.json").read_text())
    nodes: list[Node] = []
    walk(save["ObjectStates"], "", None, nodes)
    by_guid: dict[str, list[Node]] = defaultdict(list)
    for node in nodes:
        if node.guid:
            by_guid[node.guid].append(node)
    primary = {guid: items[0] for guid, items in by_guid.items()}
    all_guids = set(by_guid)
    for node in nodes:
        all_guids.update(node.state_guids)

    def rel_url(url: str | None) -> str | None:
        if not url:
            return None
        meta = url_map.get(url)
        if not meta:
            raise SystemExit(f"asset URL is not in url-map.json: {url}")
        return meta["path"]

    # Ancestors for cards, by walking parent guids.
    def ancestors(node: Node) -> list[dict]:
        chain = []
        parent = node.parent
        seen = set()
        while parent and parent not in seen:
            seen.add(parent)
            parent_node = primary.get(parent)
            if not parent_node:
                break
            chain.append(parent_node.obj)
            parent = parent_node.parent
        return chain

    # Sheet cells we have to crop, keyed by face/back URL.
    sheets: dict[str, dict] = {}
    card_plan: dict[str, dict] = {}
    for guid, node in primary.items():
        if node.name not in ("Card", "CardCustom"):
            continue
        deck_id, info, index = deck_of(node.obj, ancestors(node))
        if info is None or index is None or deck_id is None:
            continue
        face_url = info["FaceURL"]
        back_url = info.get("BackURL") or ""
        sheets.setdefault(
            face_url,
            {
                "path": rel_url(face_url),
                "w": info["NumWidth"],
                "h": info["NumHeight"],
                "used": set(),
            },
        )
        sheets[face_url]["used"].add(index)
        # A shared back is one image, not a sheet. Only unique backs use the same grid.
        if info.get("UniqueBack") and back_url and back_url != face_url:
            sheets.setdefault(
                back_url,
                {
                    "path": rel_url(back_url),
                    "w": info["NumWidth"],
                    "h": info["NumHeight"],
                    "used": set(),
                },
            )
            sheets[back_url]["used"].add(index)
        card_plan[guid] = {
            "deck": deck_id,
            "index": index,
            "card_id": node.obj.get("CardID"),
            "nick": node.nick,
            "face_url": face_url,
            "back_url": back_url,
            "unique_back": bool(info.get("UniqueBack")),
            "num_w": info["NumWidth"],
            "num_h": info["NumHeight"],
            "tags": node.obj.get("Tags") or [],
        }

    split_dir = ARCHIVE / "media" / "split"
    split_dir.mkdir(parents=True, exist_ok=True)
    cell_paths: dict[tuple[str, int], str] = {}

    def ensure_sheet(url: str) -> None:
        spec = sheets[url]
        prefix = Path(spec["path"]).stem[:12]
        count = spec["w"] * spec["h"]
        first = split_dir / f"{prefix}-0.jpg"
        last = split_dir / f"{prefix}-{count - 1}.jpg"
        if not (first.exists() and last.exists()):
            crop_sheet(str(ARCHIVE / spec["path"]), str(split_dir), prefix, spec["w"], spec["h"])
        for index in range(count):
            cell_paths[(url, index)] = f"media/split/{prefix}-{index}.jpg"

    if os.environ.get("EXTRACT_PHASE") != "plan":
        for url in sheets:
            ensure_sheet(url)

    cache = load_ocr_cache()

    def cell(url: str, index: int) -> str:
        return cell_paths[(url, index)]

    def ocr_rel(relative: str | None) -> str:
        if not relative:
            return ""
        if relative in cache:
            return cache[relative]
        absolute = ARCHIVE / relative
        if not absolute.exists():
            return ""
        text = clean_ocr(ocr_file(str(absolute)))
        cache[relative] = text
        return text

    # Corner codes for cards whose nickname is empty (legacy part 2, ops, sealed cards).
    codes: dict[str, str] = {}
    if os.environ.get("EXTRACT_PHASE") != "plan":
        pending = []
        for guid, plan in card_plan.items():
            if plan["nick"]:
                match = CODE_RE.search(plan["nick"])
                if match:
                    codes[guid] = match.group(1)
                continue
            if plan["deck"] in ("8", "9", "11", "12", "17", "2192", "18"):
                pending.append(guid)
        # The printed code is a small top-right pill. Tesseract cannot read it.
        # archive/transcriptions/codes.json maps a split-image path to "NN-NN".
        code_overlay: dict[str, str] = {}
        code_path = ARCHIVE / "transcriptions" / "codes.json"
        if code_path.exists():
            code_overlay = json.loads(code_path.read_text())
        for guid in pending:
            plan = card_plan[guid]
            rel = cell(plan["face_url"], plan["index"])
            coded = code_overlay.get(rel) or ""
            if re.fullmatch(r"\d{2}-\d{2}", coded):
                codes[guid] = coded

    # ---- record assembly ----
    records: dict[str, dict] = {}
    guid_owner: dict[str, str] = {}
    consumed: set[str] = set()

    def fresh(candidate: str) -> str:
        if candidate not in records:
            return candidate
        number = 2
        while f"{candidate}-{number}" in records:
            number += 1
        return f"{candidate}-{number}"

    def add_record(record: dict, guids: list[str]) -> None:
        rid = record["id"]
        if rid in records:
            raise SystemExit(f"duplicate record id {rid}")
        owned = []
        for guid in guids:
            if not guid or guid in consumed:
                continue
            consumed.add(guid)
            owned.append(guid)
            guid_owner[guid] = rid
            node = primary.get(guid)
            if node:
                for state_guid in node.state_guids:
                    if state_guid not in consumed:
                        consumed.add(state_guid)
                        owned.append(state_guid)
                        guid_owner[state_guid] = rid
        # State guids of duplicates too.
        for guid in list(owned):
            for node in by_guid.get(guid, []):
                for state_guid in node.state_guids:
                    if state_guid not in consumed:
                        consumed.add(state_guid)
                        owned.append(state_guid)
                        guid_owner[state_guid] = rid
        primary_guid = owned[0] if owned else ""
        node = primary.get(primary_guid)
        paths = []
        for owned_guid in owned:
            for item in by_guid.get(owned_guid, []):
                paths.append(item.path)
        primary_path = node.path if node else (paths[0] if paths else "")
        dup_paths = sorted({path for path in paths if path != primary_path})
        note = record["provenance"]["note"]
        record["sourceGuid"] = primary_guid
        record["provenance"]["guids"] = sorted(set(owned))
        record["provenance"]["savePath"] = primary_path
        record["provenance"]["duplicatePaths"] = dup_paths
        record["provenance"]["note"] = note
        records[rid] = record

    def base_record(rid: str, kind: str, census: str, printed, count: int, note: str) -> dict:
        return {
            "id": rid,
            "printedCode": printed,
            "kind": kind,
            "censusKey": census,
            "sourceGuid": "",
            "provenance": {
                "workshopId": WORKSHOP_ID,
                "version": VERSION,
                "savePath": "",
                "duplicatePaths": [],
                "note": note,
                "guids": [],
            },
            "count": count,
            "faces": [],
            "states": [],
            "edges": [],
            "marker": None,
            "unreferenced": True,
            "mesh": None,
        }

    def mesh_of(obj: dict) -> dict | None:
        mesh = obj.get("CustomMesh") or {}
        mesh_url = mesh.get("MeshURL") or ""
        if not mesh_url:
            return None
        diffuse = mesh.get("DiffuseURL") or ""
        return {"file": rel_url(mesh_url), "diffuse": rel_url(diffuse) if diffuse else None}

    def image_of(obj: dict) -> str | None:
        return rel_url((obj.get("CustomImage") or {}).get("ImageURL") or "")

    def state_face_specs(obj: dict) -> list[tuple[str, int, str | None]]:
        specs = []
        base = image_of(obj)
        if base:
            specs.append(("state-1", 1, base))
        for key in sorted(obj.get("States") or {}, key=lambda item: int(item)):
            state = obj["States"][key]
            url = (state.get("CustomImage") or {}).get("ImageURL") or ""
            specs.append((f"state-{key}", int(key), rel_url(url) if url else None))
        return specs

    # Boxes: model + the fullest bag of that nickname.
    box_nicks = {f"{number:04d}" for number in range(1, 9)}
    box_bags: dict[str, Node] = {}
    for guid, node in primary.items():
        if node.name == "Bag" and node.nick in box_nicks:
            current = box_bags.get(node.nick)
            if current is None or len(node.child_guids) > len(current.child_guids):
                box_bags[node.nick] = node
    box_guid: dict[str, str] = {}
    for guid, node in primary.items():
        if node.name == "Custom_Model" and node.nick in box_nicks:
            bag = box_bags.get(node.nick)
            record = base_record(
                f"box/{node.nick}",
                "box",
                "safe-deposit-box",
                node.nick,
                1,
                "Safe deposit box. The model and the bag that holds its contents are one record."
                + (" Bag 0003 holds the September PEARL compound pieces." if node.nick == "0003" else ""),
            )
            record["mesh"] = mesh_of(node.obj)
            guids = [guid]
            if bag:
                guids.append(bag.guid)
                box_guid[node.nick] = bag.guid
            add_record(record, guids)

    # Group identical supply pieces.
    def group_key(node: Node) -> tuple | None:
        if node.name == "Custom_Model" and node.nick in ("Agent", "Incident", "Safehouse", "Tracker"):
            mesh = node.obj.get("CustomMesh") or {}
            return ("supply", node.nick, mesh.get("MeshURL") or "", mesh.get("DiffuseURL") or "")
        if node.name == "Custom_Model" and not node.nick:
            mesh = node.obj.get("CustomMesh") or {}
            diffuse = mesh.get("DiffuseURL") or ""
            # The nine team miniatures are the unnamed models whose diffuse is an allegiance icon.
            if diffuse and node.path.count("/") == 0 and node.path.isdigit() and 47 <= int(node.path) <= 55:
                return ("team", diffuse, mesh.get("MeshURL") or "")
        if node.name == "PlayerPawn":
            color = node.obj.get("ColorDiffuse") or {}
            rounded = tuple(round(color.get(channel, 0), 3) for channel in ("r", "g", "b"))
            return ("pawn", rounded)
        if node.nick == "Player Calendar":
            return ("calendar", (node.obj.get("CustomImage") or {}).get("ImageURL") or "")
        if node.nick == "Tracker" and node.name == "Custom_Tile":
            image = (node.obj.get("CustomImage") or {}).get("ImageURL") or ""
            return ("tracker-tile", image)
        return None

    groups: dict[tuple, list[Node]] = defaultdict(list)
    for guid, node in primary.items():
        if guid in consumed:
            continue
        key = group_key(node)
        if key:
            groups[key].append(node)

    supply_meta = {
        "Agent": ("token/agent", "token", "agent", "Agent miniature."),
        "Incident": ("token/incident", "token", "incident", "Incident token."),
        "Safehouse": ("token/safehouse", "token", "safehouse", "Safehouse token."),
        "Tracker": ("token/tracker", "token", "tracking-token", "Tracking token."),
    }
    for key, members in groups.items():
        kind_name = key[0]
        if kind_name == "supply":
            nick = key[1]
            rid, kind, census, blurb = supply_meta[nick]
            rid = fresh(rid)
            record = base_record(rid, kind, census, None, len(members), blurb)
            record["mesh"] = mesh_of(members[0].obj)
            diffuse = record["mesh"]["diffuse"] if record["mesh"] else None
            if diffuse:
                record["faces"] = [
                    {
                        "id": "diffuse",
                        "ttsState": None,
                        "role": "art",
                        "transcription": "",
                        "flavor": "",
                        "image": diffuse,
                    }
                ]
            add_record(record, [member.guid for member in members])
        elif kind_name == "team":
            # Classified below once we know allegiance from which diffuse group.
            pass
        elif kind_name == "pawn":
            color = key[1]
            label = "-".join(str(channel) for channel in color)
            record = base_record(
                f"pawn/{label}",
                "pawn",
                "pawn",
                None,
                len(members),
                f"Player pawn. TTS color {color}.",
            )
            record["mesh"] = mesh_of(members[0].obj)
            add_record(record, [member.guid for member in members])
        elif kind_name == "calendar":
            record = base_record(
                fresh("overlay/player-calendar"),
                "overlay",
                "mod-extra",
                None,
                len(members),
                "Per-player calendar aid.",
            )
            image = image_of(members[0].obj)
            if image:
                record["faces"] = [
                    {
                        "id": "front",
                        "ttsState": None,
                        "role": "rules",
                        "transcription": "",
                        "flavor": "",
                        "image": image,
                    }
                ]
            add_record(record, [member.guid for member in members])
        elif kind_name == "tracker-tile":
            record = base_record(
                fresh("token/tracker"),
                "token",
                "tracking-token",
                None,
                len(members),
                "Tracking token. All 24 copies in the save share this face.",
            )
            image = image_of(members[0].obj)
            if image:
                record["faces"] = [
                    {
                        "id": "front",
                        "ttsState": None,
                        "role": "art",
                        "transcription": "",
                        "flavor": "",
                        "image": image,
                    }
                ]
            add_record(record, [member.guid for member in members])

    team_groups = [(key, members) for key, members in groups.items() if key[0] == "team"]
    # Order teams by first path so allied (objects 47–49), neutral, soviet stay stable.
    team_groups.sort(key=lambda item: min(int(member.path) for member in item[1]))
    team_names = ["allied", "neutral", "soviet"]
    for index, (key, members) in enumerate(team_groups):
        name = team_names[index] if index < len(team_names) else f"team-{index + 1}"
        record = base_record(
            f"team/{name}",
            "team",
            "team",
            None,
            len(members),
            f"{name.capitalize()} team miniature. Three copies share this mesh.",
        )
        record["mesh"] = mesh_of(members[0].obj)
        diffuse = record["mesh"]["diffuse"] if record["mesh"] else None
        if diffuse:
            record["faces"] = [
                {
                    "id": "diffuse",
                    "ttsState": None,
                    "role": "art",
                    "transcription": "",
                    "flavor": "",
                    "image": diffuse,
                }
            ]
        add_record(record, [member.guid for member in members])

    # Doors: inner Bag whose parent Infinite_Bag shares the door nickname.
    door_bag_guids = set()
    for guid, node in primary.items():
        if node.name != "Bag":
            continue
        if not re.fullmatch(r"\d{1,2}|[A-Z]", node.nick):
            continue
        parent = primary.get(node.parent or "")
        if not parent or parent.name != "Infinite_Bag" or parent.nick != node.nick:
            continue
        record = base_record(
            fresh(f"door/{node.nick}"),
            "door",
            "dossier",
            node.nick,
            1,
            "Sealed dossier door. Opening it adds the components in edges.",
        )
        add_record(record, [guid])
        door_bag_guids.add(guid)

    # Cards.
    used_ids: set[str] = set(records)
    legacy_part_guids = {"part1": [], "part2": []}

    def unique_id(candidate: str) -> str:
        if candidate not in used_ids and candidate not in records:
            used_ids.add(candidate)
            return candidate
        number = 2
        while f"{candidate}-{number}" in used_ids or f"{candidate}-{number}" in records:
            number += 1
        chosen = f"{candidate}-{number}"
        used_ids.add(chosen)
        return chosen

    card_ids: dict[str, str] = {}
    clusters: dict[tuple[str, int], list[str]] = defaultdict(list)
    for guid, plan in card_plan.items():
        if guid in consumed:
            continue
        clusters[(plan["face_url"], plan["index"])].append(guid)

    def best_code(guids: list[str]) -> str:
        for member in guids:
            match = CODE_RE.search(card_plan[member]["nick"] or "")
            if match:
                return match.group(1)
        for member in guids:
            if codes.get(member):
                return codes[member]
        return ""

    def lead_guid(guids: list[str]) -> str:
        def rank(member: str) -> tuple:
            nick_hit = 0 if CODE_RE.search(card_plan[member]["nick"] or "") else 1
            loose = 1 if primary[member].path.startswith("85/") else 0
            return (nick_hit, loose, primary[member].path)

        return sorted(guids, key=rank)[0]

    for (face_url, index), guids in clusters.items():
        guid = lead_guid(guids)
        plan = card_plan[guid]
        deck = plan["deck"]
        nick = plan["nick"]
        code = best_code(guids)
        region = next((tag for tag in plan["tags"] if tag not in ("player", "prologue")), None)
        cell_stem = Path(cell(face_url, index)).stem
        known = KNOWN_CELLS.get(cell_stem)
        if known:
            rid = unique_id(known)
            kind, census = "card", "legacy-card"
            printed = None
            if known == "legacy/end-of-part-1":
                note = "Warning card at the end of legacy deck part 1. It has no NN-NN code."
            elif known == "legacy/sealed-end-of-legacy-deck":
                note = "Warning card sealed in box 0005. The part 2 deck also has this face. This copy stays because the box still holds it."
            else:
                note = "Warning card at the end of the legacy deck. It has no NN-NN code."
        elif deck == "15":
            rid = unique_id(f"threat/{slug(nick or code or str(plan['card_id']))}")
            kind, census = "card", "threat-card"
            printed = nick or code or None
            note = "Threat card. Drawing it from the bottom of the deck is the incident effect."
            if nick == "Caiiro":
                note += " The mod nickname spells Cairo as Caiiro. The player card and the board use Cairo."
        elif deck == "13" and slug(nick) in EVENTS or nick in (
            "Forecast",
            "Counter-Intelligence",
            "Airlift",
            "Cover of Darkness",
            "A Holdover from the War",
        ):
            rid = unique_id(f"event/{slug(nick)}")
            kind, census = "card", "player-card"
            printed = nick
            note = "Event. Part of the 58 player cards. Playable any time it is your turn, not between drawing and resolving a card."
        elif deck == "13" and plan["card_id"] == 1304:
            rid = unique_id("player/escalation")
            kind, census = "card", "player-card"
            printed = "Escalation"
            note = (
                "Escalation card. Setup puts one in each of the five player-deck piles. "
                "The save stores a single object; the mod clones it. This record counts the five physical cards."
            )
        elif deck in ("13", "18"):
            rid = unique_id(f"player/{slug(nick or code or str(plan['card_id']))}")
            kind, census = "card", "player-card"
            printed = nick or code or None
            note = "Player card."
            if region:
                note += f" Region: {region}."
            if deck == "18":
                note += " Sealed in safe deposit box 0008, not in the prologue player deck."
        elif deck == "4":
            rid = unique_id(f"alias/temporary-{plan['index'] + 1}")
            kind, census = "card", "temporary-alias"
            printed = nick or f"Temporary {plan['index'] + 1}"
            note = "Temporary alias, used in the prologue before passports are created."
        elif deck == "3":
            rid = unique_id("mod/introduction")
            kind, census = "card", "mod-extra"
            printed = nick or "Introduction"
            note = "Mod introduction card. The object description says it is OK to delete."
        elif deck in ("9", "11"):
            printed_code = code or nick
            rid = unique_id(f"legacy/{printed_code}" if printed_code else f"legacy/deck9-{plan['index']:02d}")
            kind, census = "card", "legacy-card"
            printed = printed_code or None
            note = "Legacy deck part 1."
        elif deck == "8":
            printed_code = code or nick
            rid = unique_id(f"legacy/{printed_code}" if printed_code else f"legacy/part2-{plan['index']:02d}")
            kind, census = "card", "legacy-card"
            printed = printed_code or None
            note = "Legacy deck part 2. The save leaves these nicknames empty; the code is read from the card."
        elif deck == "17":
            printed_code = code or nick
            rid = unique_id(
                f"legacy/sealed-{printed_code}" if printed_code else f"legacy/sealed-{plan['index']:02d}"
            )
            kind, census = "card", "legacy-card"
            printed = printed_code or None
            note = "Legacy card sealed in safe deposit box 0005, not in the starting legacy deck. Same printed code as a deck card is a second copy the mod left in the box."
        elif deck in ("12", "2192"):
            printed_code = nick or (f"Ops {code}" if code else "")
            suffix = slug(nick) if nick else (code or f"i{plan['index']:02d}")
            rid = unique_id(f"operations/{suffix}")
            kind, census = "card", "operations-card"
            printed = printed_code or None
            note = "Operations card. The book numbers operations 50–89 and counts 42 cards."
        else:
            rid = unique_id(f"card/{deck}-{plan['index']:02d}")
            kind, census = "card", "mod-extra"
            printed = nick or code or None
            note = f"Card on deck {deck}, which is not one of the publisher decks."
        record = base_record(rid, kind, census, printed, 5 if rid == "player/escalation" else 1, note)
        if census == "legacy-card":
            record["marker"] = "continue"
        front = cell(plan["face_url"], plan["index"])
        if plan["unique_back"] and plan["back_url"] and plan["back_url"] != plan["face_url"]:
            back = cell(plan["back_url"], plan["index"])
        elif plan["back_url"] and plan["back_url"] != plan["face_url"]:
            back = rel_url(plan["back_url"])
        else:
            back = front
        record["faces"] = [
            {"id": "front", "ttsState": None, "role": "both", "transcription": "", "flavor": "", "image": front},
            {"id": "back", "ttsState": None, "role": "art", "transcription": "", "flavor": "", "image": back},
        ]
        add_record(record, guids)
        for member in guids:
            card_ids[member] = rid

    # Passports with scratch states.
    for guid, (color, allegiance) in PASSPORTS.items():
        node = primary.get(guid)
        if not node or guid in consumed:
            continue
        record = base_record(
            f"passport/{color}-{allegiance}",
            "passport",
            "passport",
            None,
            1,
            f"{color.capitalize()} pawn, {allegiance} alias page. state-1 is the unscratched page. "
            "state-2 onward reveal cover pips one scratch at a time. "
            "The book counts 4 passports; the mod stores 3 allegiance pages for each of 4 pawns.",
        )
        specs = state_face_specs(node.obj)
        record["faces"] = [
            {
                "id": face_id,
                "ttsState": tts,
                "role": "rules",
                "transcription": "",
                "flavor": "",
                "image": image,
            }
            for face_id, tts, image in specs
        ]
        record["states"] = [face["id"] for face in record["faces"]]
        add_record(record, [guid])

    # Known single tiles.
    for guid, (rid, kind, census, count, note) in KNOWN_TILES.items():
        node = primary.get(guid)
        if not node or guid in consumed:
            continue
        record = base_record(rid, kind, census, None, count or 1, note)
        record["mesh"] = mesh_of(node.obj)
        if node.obj.get("States"):
            specs = state_face_specs(node.obj)
            record["faces"] = [
                {
                    "id": face_id,
                    "ttsState": tts,
                    "role": "rules",
                    "transcription": "",
                    "flavor": "",
                    "image": image,
                }
                for face_id, tts, image in specs
            ]
            record["states"] = [face["id"] for face in record["faces"]]
        else:
            image = image_of(node.obj)
            role = "art" if census in ("objective-token", "threat-marker") else "rules"
            if image:
                record["faces"] = [
                    {"id": "front", "ttsState": None, "role": role, "transcription": "", "flavor": "", "image": image}
                ]
        add_record(record, [guid])

    # Portrait stickers clipped off the sheet, and the three contact stickers beside the upgrade sheet.
    for guid, node in list(primary.items()):
        if guid in consumed:
            continue
        if node.name != "Custom_Tile":
            continue
        if node.path.isdigit() and 61 <= int(node.path) <= 84:
            record = base_record(
                f"sticker/portrait-{node.guid}",
                "sticker",
                "mod-extra",
                None,
                1,
                "Portrait sticker clipped from sticker-sheet/portraits so it can be placed on a passport.",
            )
            image = image_of(node.obj)
            if image:
                record["faces"] = [
                    {"id": "front", "ttsState": None, "role": "art", "transcription": "", "flavor": "", "image": image}
                ]
            add_record(record, [guid])
        elif node.path.isdigit() and node.path in ("87", "88", "89"):
            record = base_record(
                f"sticker/contact-{node.guid}",
                "sticker",
                "mod-extra",
                None,
                1,
                "Contact sticker (shop owner, crime boss, or politician) placed loose next to the upgrade sheet.",
            )
            image = image_of(node.obj)
            if image:
                record["faces"] = [
                    {"id": "front", "ttsState": None, "role": "rules", "transcription": "", "flavor": "", "image": image}
                ]
            add_record(record, [guid])

    # Everything still unowned.
    for guid, node in primary.items():
        if guid in consumed:
            continue
        image = image_of(node.obj)
        mesh = mesh_of(node.obj)
        kind = "note"
        census = "mod-extra"
        rid = f"mod/{slug(node.nick) if node.nick else node.name.lower()}-{guid}"
        note = ""
        printed = node.nick or None
        if node.name == "Infinite_Bag":
            kind = "note"
            census = "duplicate-shell"
            rid = f"shell/{slug(node.nick) if node.nick else guid}"
            note = "Infinite bag. The mod tells you to click a door once; the bag respawns its contents. The inner object is the real component."
        elif node.name == "Bag" and not node.child_guids:
            kind = "note"
            census = "duplicate-shell"
            rid = f"shell/empty-{slug(node.nick) if node.nick else guid}"
            note = "Empty extra bag."
        elif node.name in ("Deck", "DeckCustom"):
            kind = "deck"
            census = "mod-extra"
            rid = f"deck/{slug(node.nick) if node.nick else guid}"
            note = "Deck container. The cards are their own records."
            if node.nick == "Legacy Deck Part 1":
                census = "legacy-deck"
                rid = "deck/legacy-part-1"
                note = "Legacy deck part 1, in the save's contained order. Draw order starts at 00-01."
            elif node.nick == "Legacy Deck Part 2":
                census = "legacy-deck"
                rid = "deck/legacy-part-2"
                note = "Legacy deck part 2."
            elif node.nick == "Legacy Cards":
                census = "legacy-deck"
                rid = "deck/legacy-sealed"
                note = "Sixteen legacy cards sealed in box 0005."
        elif node.name == "Notecard":
            kind = "note"
            rid = f"note/{slug(node.nick) if node.nick else guid}"
            note = "Mod notecard. Instructions for the table, not a published rule."
        elif node.name in ("HandTrigger", "BlockRectangle", "BlockSquare"):
            kind = "overlay"
            rid = f"mod/{node.name.lower()}-{guid}"
            note = "Tabletop Simulator table geometry."
        elif node.name in ("Custom_Model_Bag", "Custom_Model"):
            kind = "mesh"
            rid = f"mod/{slug(node.nick) if node.nick else 'model'}-{guid}"
            note = node.nick or "Custom model."
            if node.nick == "Intelligence Folder":
                rid, kind, census = "file/intelligence", "file", "intelligence-file"
                note = "Intelligence file. Starts empty."
            elif node.nick == "Personnel Folder":
                rid, kind, census = "file/personnel", "file", "personnel-file"
                note = "Personnel file. Starts empty."
            elif node.nick in ("Agents", "Incidents", "Safehouses"):
                note = f"Supply bag for the {node.nick.lower()}."
        elif image or mesh:
            kind = "overlay"
            rid = f"tile/{guid}"
            note = node.nick or "Unclassified tile."
            parent = primary.get(node.parent or "")
            if parent and parent.nick == "0003":
                kind = "token"
                rid = f"pearl/{slug(node.nick) if node.nick else 'piece'}-{guid}"
                note = f"PEARL compound piece {node.nick or guid}. Taken from this mod's bag 0003. Workshop 2608806457 is not available."
            elif node.nick == "Alias Burned":
                kind = "sticker"
                rid = f"sticker/alias-burned-{guid}"
                note = "Burned-alias sticker. Covers the name and photo when an alias is fully burned."
        rid = unique_id(rid)
        record = base_record(rid, kind, census, printed if census == "mod-extra" else printed, 1, note)
        record["mesh"] = mesh
        description = (node.obj.get("Description") or "").strip()
        gm = (node.obj.get("GMNotes") or "").strip()
        text = "\n\n".join(part for part in (description, gm) if part)
        if node.obj.get("States"):
            specs = state_face_specs(node.obj)
            record["faces"] = [
                {
                    "id": face_id,
                    "ttsState": tts,
                    "role": "rules" if text or True else "art",
                    "transcription": text if face_id == "state-1" else "",
                    "flavor": "",
                    "image": image_path,
                }
                for face_id, tts, image_path in specs
            ]
            record["states"] = [face["id"] for face in record["faces"]]
        elif image or text:
            role = "rules" if (text or node.name == "Notecard") else "art"
            # Tiles that are likely to carry rules get OCR'd below, so start as rules when the image is a document.
            if image and node.name == "Custom_Tile" and node.nick not in ("Alias Burned",):
                role = "rules"
            record["faces"] = [
                {
                    "id": "front",
                    "ttsState": None,
                    "role": role,
                    "transcription": text,
                    "flavor": "",
                    "image": image,
                }
            ]
        add_record(record, [guid])

    # Rulebook and sky are not TTS objects with a component GUID.
    rulebook_md = (ARCHIVE / "rules" / "rulebook.md").read_text()
    rulebook_pages = {
        number: body.strip()
        for number, body in re.findall(
            r"<!-- page: (\d{2}) -->\n(.*?)(?=<!-- page: \d{2} -->|\Z)",
            rulebook_md,
            re.S,
        )
    }
    if set(rulebook_pages) != {f"{number:02d}" for number in range(1, 17)}:
        raise SystemExit(f"rulebook page split is {sorted(rulebook_pages)}")
    rulebook_clean = re.sub(r"<!-- page: \d{2} -->\n?", "", rulebook_md).strip()
    rulebook = base_record(
        "rulebook",
        "rule-page",
        "rulebook",
        "N4245.3",
        1,
        "Department of Sabotage Field Manual No. N4245.3. Cleaned text is archive/rules/rulebook.md. Page images are the faces.",
    )
    rulebook["sourceGuid"] = ""
    rulebook["provenance"]["guids"] = []
    rulebook["faces"] = [
        {
            "id": "field-manual",
            "ttsState": None,
            "role": "both",
            "transcription": rulebook_clean,
            "flavor": "December 1961. Camp Swampy. Project MEDUSA. You were chosen to serve.",
            "image": "rules/pages/page-01.png",
        }
    ]
    for number in range(1, 17):
        rulebook["faces"].append(
            {
                "id": f"page-{number:02d}",
                "ttsState": None,
                "role": "rules",
                "transcription": rulebook_pages[f"{number:02d}"],
                "flavor": "",
                "image": f"rules/pages/page-{number:02d}.png",
            }
        )
    records["rulebook"] = rulebook

    sky_url = save.get("SkyURL") or ""
    if sky_url and sky_url in url_map:
        sky = base_record("mod/sky", "overlay", "mod-extra", None, 1, f"Table sky {save.get('Sky')}.")
        sky["faces"] = [
            {
                "id": "front",
                "ttsState": None,
                "role": "art",
                "transcription": "",
                "flavor": "",
                "image": url_map[sky_url]["path"],
            }
        ]
        records["mod/sky"] = sky

    # Unused sheet cells that are not blank become records, so hidden art is kept.
    if os.environ.get("EXTRACT_PHASE") != "plan":
        for url, spec in sheets.items():
            count = spec["w"] * spec["h"]
            for index in range(count):
                if index in spec["used"]:
                    continue
                relative = cell_paths[(url, index)]
                absolute = ARCHIVE / relative
                if not absolute.exists():
                    continue
                try:
                    deviation = stddev(absolute)
                except subprocess.CalledProcessError:
                    continue
                if deviation < 0.02:
                    continue
                prefix = Path(spec["path"]).stem[:8]
                rid = unique_id(f"sheet/{prefix}/{index:02d}")
                record = base_record(
                    rid,
                    "card",
                    "mod-extra",
                    None,
                    1,
                    "Sheet cell that no object in the save uses. Kept because the art is not blank.",
                )
                record["faces"] = [
                    {
                        "id": "front",
                        "ttsState": None,
                        "role": "rules",
                        "transcription": "",
                        "flavor": "",
                        "image": relative,
                    }
                ]
                record["unreferenced"] = True
                records[rid] = record

    # OCR every rules/both face that has no transcription yet, and card backs.
    if os.environ.get("EXTRACT_PHASE") != "plan":
        needed = []
        for record in records.values():
            for face in record["faces"]:
                if face.get("transcription"):
                    continue
                if face["role"] in ("rules", "both", "flavor") or (
                    record["kind"] == "card" and face["id"] in ("front", "back")
                ):
                    if face.get("image"):
                        needed.append(face["image"])
        missing = [rel for rel in dict.fromkeys(needed) if rel not in cache]
        if missing:
            workers = min(8, os.cpu_count() or 4)
            with ProcessPoolExecutor(max_workers=workers) as pool:
                futures = {pool.submit(ocr_file, str(ARCHIVE / rel)): rel for rel in missing}
                done = 0
                for future in as_completed(futures):
                    rel = futures[future]
                    cache[rel] = clean_ocr(future.result())
                    done += 1
                    if done % 100 == 0:
                        print(f"ocr {done}/{len(missing)}", flush=True)
            save_ocr_cache(cache)
        for record in records.values():
            for face in record["faces"]:
                if face.get("transcription"):
                    continue
                text = cache.get(face.get("image") or "", "")
                if record["kind"] == "card" and face["id"] == "back":
                    face["role"] = "both" if len(text) > 40 else "art"
                    face["transcription"] = text if face["role"] != "art" else ""
                elif face["role"] in ("rules", "both", "flavor"):
                    decorative = record["id"].startswith(("mod/block", "mod/handtrigger", "tile/")) and len(text) < 24
                    if decorative:
                        face["role"] = "art"
                        face["transcription"] = ""
                    else:
                        face["transcription"] = text or record.get("printedCode") or record["id"]
                if record["censusKey"] == "legacy-card" and face["id"] == "front":
                    if re.search(r"(?m)^\s*STOP\b", text):
                        record["marker"] = "STOP"
                    elif re.search(r"(?m)^\s*PAUSE\b", text):
                        record["marker"] = "PAUSE"
                    else:
                        record["marker"] = "continue"

    # Debrief entries. A reviewed overlay replaces the page-OCR split.
    debrief_overlay_path = ARCHIVE / "transcriptions" / "debrief.json"
    if debrief_overlay_path.exists():
        debrief_entries = json.loads(debrief_overlay_path.read_text())
        for number, spec in debrief_entries.items():
            if not re.fullmatch(r"\d{3}", str(number)):
                continue
            rid = f"debrief/{number}"
            image = spec.get("image") or ""
            body = (spec.get("transcription") or "").strip()
            flavor = (spec.get("flavor") or "").strip()
            if not body and flavor:
                body = flavor
                role = "flavor"
            elif flavor:
                role = "both"
            else:
                role = "rules"
            if rid in records:
                record = records[rid]
            else:
                record = base_record(
                    rid,
                    "rule-page",
                    "debrief-page",
                    str(number),
                    1,
                    "Debrief entry. Text is the reviewed transcription; the image is the book page it is printed on.",
                )
                records[rid] = record
            record["faces"] = [
                {
                    "id": "front",
                    "ttsState": None,
                    "role": role,
                    "transcription": body,
                    "flavor": flavor,
                    "image": image or (record["faces"][0]["image"] if record["faces"] else None),
                }
            ]
            record["unreferenced"] = True
    book = records.get("debrief/book")
    if not debrief_overlay_path.exists() and book and os.environ.get("EXTRACT_PHASE") != "plan":
        chunks: list[tuple[str, str, str]] = []
        for face in book["faces"]:
            text = face.get("transcription") or ""
            matches = list(ENTRY_SPLIT_RE.finditer(text))
            if not matches:
                continue
            for index, match in enumerate(matches):
                number = int(match.group(1))
                if number < 100 or number > 252:
                    continue
                end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
                body = text[match.start() : end].strip()
                if len(body) < 8:
                    continue
                chunks.append((str(number), body, face["image"]))
        seen_numbers = set()
        for number, body, image in chunks:
            if number in seen_numbers:
                continue
            seen_numbers.add(number)
            rid = f"debrief/{number}"
            if rid in records:
                continue
            record = base_record(
                rid,
                "rule-page",
                "debrief-page",
                number,
                1,
                "Debrief entry split from a page of debrief/book. The image is that page.",
            )
            record["faces"] = [
                {
                    "id": "front",
                    "ttsState": None,
                    "role": "rules",
                    "transcription": body,
                    "flavor": "",
                    "image": image,
                }
            ]
            record["unreferenced"] = True
            records[rid] = record

    # Reviewed transcriptions override OCR. Edges below read the replaced text.
    overlay_path = ARCHIVE / "transcriptions" / "faces.json"
    if overlay_path.exists():
        overlay = json.loads(overlay_path.read_text())
        for rid, spec in overlay.items():
            record = records.get(rid)
            if not record:
                print("overlay miss", rid)
                continue
            marker = spec.get("marker")
            if marker in ("STOP", "PAUSE", "continue"):
                record["marker"] = marker
            note = spec.get("note")
            if isinstance(note, str) and note.strip():
                record["provenance"]["note"] = note
            for face_id, face_spec in (spec.get("faces") or {}).items():
                for face in record["faces"]:
                    if face["id"] != face_id:
                        continue
                    if "transcription" in face_spec:
                        face["transcription"] = face_spec["transcription"]
                    if "flavor" in face_spec:
                        face["flavor"] = face_spec["flavor"]
                    role = face_spec.get("role")
                    if role in ("rules", "flavor", "both", "art", "blank"):
                        face["role"] = role

    # The PEARL entrance card is printed 47. It lives in bag 0003, not in a door bag.
    entrance = records.pop("pearl/entrance-b68e82", None)
    if entrance:
        entrance["id"] = "door/47"
        entrance["kind"] = "door"
        entrance["printedCode"] = "47"
        entrance["provenance"]["note"] = (
            "Door 47, the PEARL entrance card. The mod keeps it in bag 0003 instead of a clickable dossier door. "
            "Workshop 2608806457 is not available."
        )
        records["door/47"] = entrance

    # Structural edges, then text edges.
    id_by_guid = {}
    for record in records.values():
        for guid in record["provenance"]["guids"]:
            id_by_guid[guid] = record["id"]

    dropped: list[tuple[str, str, str, str]] = []

    def edge(record: dict, kind: str, target: str, label: str) -> None:
        if target not in records:
            dropped.append((record["id"], kind, target, label))
            return
        if target == record["id"] and kind != "destroys":
            return
        item = {"type": kind, "targetId": target, "label": label}
        if item not in record["edges"]:
            record["edges"].append(item)

    for record in records.values():
        for guid in record["provenance"]["guids"]:
            node = primary.get(guid)
            if not node:
                continue
            # A container points at its children. Merged bags (boxes) use the bag's children.
            child_guids = node.child_guids
            if record["kind"] == "box":
                for owned in record["provenance"]["guids"]:
                    owned_node = primary.get(owned)
                    if owned_node and owned_node.name == "Bag":
                        child_guids = owned_node.child_guids
            targets = []
            for child in child_guids:
                target = id_by_guid.get(child)
                if target and target != record["id"]:
                    targets.append(target)
            # Dedup while keeping order.
            seen = set()
            for target in targets:
                if target in seen:
                    continue
                seen.add(target)
                label = "Contains"
                edge_type = "adds"
                edge(record, edge_type, target, label)

    if os.environ.get("EXTRACT_PHASE") != "plan":
        for record in list(records.values()):
            text = "\n".join(
                (face.get("transcription") or "") + "\n" + (face.get("flavor") or "")
                for face in record["faces"]
            )
            flat = re.sub(r"\s+", " ", text)
            seen_edge: set[tuple[str, str]] = set()

            def text_edge(kind: str, target: str, label: str) -> None:
                key = (kind, target)
                if key in seen_edge:
                    return
                seen_edge.add(key)
                edge(record, kind, target, label)

            for match in re.finditer(r"(?im)open the following doors?\s*:\s*([^\n]+)", text):
                for code in door_codes(match.group(1)):
                    text_edge("opens", f"door/{code}", f"Open door {code}")
            for match in re.finditer(r"(?i)\bopen doors?\b", flat):
                for code in door_codes(flat[match.end() :]):
                    text_edge("opens", f"door/{code}", f"Open door {code}")
            for match in BOX_RE.finditer(flat):
                text_edge("opens", f"box/{match.group(1)}", match.group(0))
            for match in ENTRY_RE.finditer(flat):
                text_edge("reads", f"debrief/{match.group(1)}", match.group(0))
            for match in DEBRIEF_NUM_RE.finditer(flat):
                text_edge("reads", f"debrief/{match.group(1)}", match.group(0))
            for match in re.finditer(r"(?i)\bdestroy\s+(000[1-8])\b", flat):
                text_edge("destroys", f"box/{match.group(1)}", match.group(0))
            if re.search(r"\bdestroy this card\b|\btear (?:up )?this card\b", flat, re.I):
                text_edge("destroys", record["id"], "Destroy this card")
            if re.search(r"\bon the board\b", flat, re.I):
                text_edge("places", "board", "On the board")
            if "pearl/piece-3cba65" in records and re.search(r"\bsecret dossier\b", flat, re.I):
                text_edge("adds", "pearl/piece-3cba65", "Take the secret dossier")
            if re.search(r"open this door if your funding", flat, re.I):
                text_edge("opens", "door/14", "Open this door if your funding would ever go above 10")

    # Referenced set.
    pointed = set()
    for record in records.values():
        for item in record["edges"]:
            pointed.add(item["targetId"])
    rulebook_text = rulebook_md.lower()
    named = set()
    for record in records.values():
        key = record["censusKey"]
        # The component list names these classes. Individual sealed doors are named only when an edge or the book cites them.
        if key in (
            "rulebook",
            "board",
            "pawn",
            "agent",
            "safehouse",
            "incident",
            "threat-marker",
            "tracking-token",
            "objective-token",
            "team",
            "reference-card",
            "passport",
            "intelligence-file",
            "personnel-file",
            "sticker-sheet",
            "threat-card",
            "player-card",
            "temporary-alias",
            "legacy-deck",
            "operations-card",
            "safe-deposit-box",
            "debrief-book",
        ):
            named.add(record["id"])
        if key == "dossier" and record["kind"] == "dossier":
            named.add(record["id"])
        if record["kind"] == "door" and record["printedCode"]:
            code = str(record["printedCode"])
            if re.search(rf"\bdoor\s+{re.escape(code)}\b", rulebook_text, re.I):
                named.add(record["id"])
    for record in records.values():
        record["unreferenced"] = record["id"] not in pointed and record["id"] not in named

    # Deck order from the save.
    def contained_ids(nick: str) -> list[str]:
        for node in nodes:
            if node.nick == nick and node.name in ("Deck", "DeckCustom"):
                return [id_by_guid[child] for child in node.child_guids if child in id_by_guid]
        return []

    part1 = contained_ids("Legacy Deck Part 1")
    part2 = contained_ids("Legacy Deck Part 2")
    # Draw order is the printed order. The save stores 00-01 at the bottom of part 1.
    def sort_key(rid: str) -> tuple:
        printed = records[rid].get("printedCode") or ""
        match = re.match(r"(\d{2})-(\d{2})", printed)
        if match:
            return (int(match.group(1)), int(match.group(2)), rid)
        return (99, 99, rid)

    coded = [rid for rid in part1 if re.match(r"\d{2}-\d{2}", records[rid].get("printedCode") or "")]
    uncoded = [rid for rid in part1 if rid not in coded]
    draw_part1 = sorted(coded, key=sort_key) + uncoded
    draw_part2 = sorted(part2, key=sort_key)
    deck_order = {
        "part1": part1,
        "part2": part2,
        "workshopOrder": part1 + part2,
        "drawOrder": draw_part1 + draw_part2,
    }

    # Census.
    totals: dict[str, int] = defaultdict(int)
    for record in records.values():
        totals[record["censusKey"]] += record["count"]
    publisher = {}
    discrepancies = {}
    notes = {
        "legacy-card": "The book does not print how many legacy cards there are. This is every legacy card in part 1, part 2, and the deck sealed in box 0005.",
        "debrief-page": "The book numbers debrief entries 100–252 (153 entries). This count is that run plus the index sheet.",
        "passport": "The book counts 4 passports. The mod stores three allegiance pages (Allied, Neutral, Soviet) for each of the four pawn colors, and each page has 11 cover-scratch states.",
        "legacy-deck": "The book counts one legacy deck supplied in two parts. The save also keeps the 16 legacy cards from box 0005 in their own deck.",
        "player-card": "The 58 player cards are the 48 city cards, 5 events, and 5 escalation cards (the save stores one escalation object and clones it). Further player cards are sealed in box 0008.",
        "dossier": "The book counts 3 dossier folios. Each sealed door on those folios is its own record, because opening one door yields its own components.",
        "sticker-sheet": "The three sheets are portraits, allied upgrades (cover occupations, game-end upgrades, surveillance), and liabilities. Stickers the mod clipped off those sheets are mod-extra records.",
        "operations-card": "The component list says 42 operations cards. The same chapter says they are numbered 50–89. Both figures are kept: the count is 42, and the numbers are on the cards.",
        "incident": "Incident tokens inside a later box are extra copies, not a replacement for the 7 that start in the supply.",
        "objective-token": "One tile image is stacked with Number 3, the completed/failed objective tokens.",
    }
    for key, published in PUBLISHER.items():
        actual = totals.get(key, 0)
        if published is None:
            publisher[key] = actual
        else:
            publisher[key] = published
            if published != actual:
                discrepancies[key] = notes.get(key, "The save does not match the publisher count. See the records.")
    for key, actual in totals.items():
        if key not in publisher:
            publisher.setdefault(key, actual)

    # Fill publisher keys that have no records yet so the checker sees them.
    for key, published in list(publisher.items()):
        totals.setdefault(key, 0)

    census = {
        "publisher": publisher,
        "totals": dict(sorted(totals.items())),
        "discrepancies": discrepancies,
        "notes": notes,
    }

    # Claim check before writing. State guids must be on a record.
    claimed = set()
    for record in records.values():
        claimed.update(record["provenance"]["guids"])
    missing = sorted(all_guids - claimed)
    if missing:
        print(f"unclaimed guids: {len(missing)} e.g. {missing[:8]}")

    if os.environ.get("EXTRACT_PHASE") == "plan":
        print("records", len(records))
        print("cards", len(card_plan))
        print("part1", len(part1), "part2", len(part2))
        print("totals", dict(sorted(totals.items())))
        print("discrepancies", list(discrepancies))
        print("unclaimed", len(missing))
        return

    # Markdown and JSON.
    records_dir = ARCHIVE / "records"
    if records_dir.exists():
        for path in records_dir.rglob("*"):
            if path.is_file():
                path.unlink()
    index = []
    for rid in sorted(records):
        record = records[rid]
        record["edges"] = sorted(record["edges"], key=lambda item: (item["type"], item["targetId"], item["label"]))
        relative = f"records/{rid}.json"
        path = ARCHIVE / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(record, indent=2, ensure_ascii=False) + "\n")
        index.append({"id": rid, "file": relative})
        md = render_markdown(record)
        path.with_suffix(".md").write_text(md)

    (ARCHIVE / "index.json").write_text(json.dumps({"records": index}, indent=2) + "\n")
    (ARCHIVE / "census.json").write_text(json.dumps(census, indent=2, ensure_ascii=False) + "\n")
    (ARCHIVE / "deck-order.json").write_text(json.dumps(deck_order, indent=2) + "\n")
    (ARCHIVE / "source" / "guids.json").write_text(json.dumps({"guids": sorted(all_guids)}, indent=2) + "\n")
    save_ocr_cache(cache)
    write_catalog(records, totals, discrepancies)
    print("wrote", len(records), "records")
    print("workshop order", len(deck_order["workshopOrder"]))
    print("unclaimed", len(missing))
    print("dropped edges", len(dropped))
    (SCRATCH / "dropped-edges.txt").write_text(
        "\n".join(f"{item[0]}\t{item[1]}\t{item[2]}\t{item[3]}" for item in dropped[:800])
    )


def render_markdown(record: dict) -> str:
    lines = [
        f"# {record['id']}",
        "",
        f"- Kind: {record['kind']}",
        f"- Census: {record['censusKey']} × {record['count']}",
        f"- Printed code: {record['printedCode'] or '—'}",
        f"- Marker: {record['marker'] or '—'}",
        f"- Source GUID: {record['sourceGuid'] or '—'}",
        f"- Unreferenced: {'yes' if record['unreferenced'] else 'no'}",
        "",
    ]
    if record["provenance"]["note"]:
        lines.append(record["provenance"]["note"])
        lines.append("")
    if record["mesh"]:
        lines.append(f"- Mesh: `{record['mesh']['file']}`")
        if record["mesh"].get("diffuse"):
            lines.append(f"- Diffuse: `{record['mesh']['diffuse']}`")
        lines.append("")
    for face in record["faces"]:
        lines.append(f"## {face['id']}")
        lines.append("")
        if face.get("image"):
            lines.append(f"![]({face['image']})")
            lines.append("")
        if face.get("transcription"):
            lines.append(face["transcription"])
            lines.append("")
        if face.get("flavor"):
            lines.append(f"Flavor: {face['flavor']}")
            lines.append("")
    if record["edges"]:
        lines.append("## Edges")
        lines.append("")
        for item in record["edges"]:
            lines.append(f"- {item['type']} `{item['targetId']}` — {item['label']}")
        lines.append("")
    return "\n".join(lines)


def write_catalog(records: dict, totals: dict, discrepancies: dict) -> None:
    lines = [
        "# Archive catalog",
        "",
        "One record per component in workshop 2618224591, plus the field manual. The checker reads the JSON beside these notes.",
        "",
        "## Census",
        "",
        "| Key | Count |",
        "| --- | ---: |",
    ]
    for key in sorted(totals):
        lines.append(f"| {key} | {totals[key]} |")
    if discrepancies:
        lines.append("")
        lines.append("## Where the save and the publisher list differ")
        lines.append("")
        for key, text in sorted(discrepancies.items()):
            lines.append(f"- **{key}.** {text}")
    lines.append("")
    lines.append("## Records")
    lines.append("")
    lines.append("| Id | Kind | Code | Marker |")
    lines.append("| --- | --- | --- | --- |")
    for rid in sorted(records):
        record = records[rid]
        code = record["printedCode"] or ""
        marker = record["marker"] or ""
        lines.append(f"| `{rid}` | {record['kind']} | {code} | {marker} |")
    lines.append("")
    (ARCHIVE / "CATALOG.md").write_text("\n".join(lines))


if __name__ == "__main__":
    main()
