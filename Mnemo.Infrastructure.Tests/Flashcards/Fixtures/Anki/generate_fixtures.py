"""Writes the Anki packages the importer tests read, using Anki's own library.

Run with the pinned version in requirements.txt, from a virtual environment kept outside the
repository so nothing of it is committed:

    python -m venv ~/mnemo-anki-venv
    ~/mnemo-anki-venv/Scripts/python -m pip install -r requirements.txt
    ~/mnemo-anki-venv/Scripts/python generate_fixtures.py [name ...]

On macOS and Linux the interpreter is ~/mnemo-anki-venv/bin/python instead.

With names, only those builders run, so the other packages are not rewritten.

Every package is written by Anki's exporter, so the note types inside are exactly what a
current Anki puts in collection.anki21b (protobuf configs in the notetypes, fields and templates
tables). One legacy export is written too, the layout older Anki and AnkiWeb shared decks use.
"""

import os
import shutil
import struct
import sys
import tempfile
import zlib

from anki.collection import Collection, ExportAnkiPackageOptions
from anki.decks import DeckId
from anki.import_export_pb2 import ExportLimit as ExportLimitProto

HERE = os.path.dirname(os.path.abspath(__file__))


def tiny_png(width: int, height: int) -> bytes:
    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    rows = b"".join(b"\x00" + b"\xff\x80\x00" * width for _ in range(height))
    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(rows)) + chunk(b"IEND", b"")


def new_collection(work: str) -> Collection:
    return Collection(os.path.join(work, "collection.anki2"))


def deck(col: Collection, name: str) -> DeckId:
    return DeckId(col.decks.id(name))


def add(col: Collection, notetype_name: str, deck_id: DeckId, values: list[str]) -> None:
    notetype = col.models.by_name(notetype_name)
    note = col.new_note(notetype)
    for i, value in enumerate(values):
        note.fields[i] = value
    col.add_note(note, deck_id)


def export(col: Collection, deck_id: DeckId, name: str, legacy: bool = False) -> None:
    options = ExportAnkiPackageOptions(with_scheduling=True, with_deck_configs=False, with_media=True, legacy=legacy)
    limit = ExportLimitProto(deck_id=deck_id)
    col.export_anki_package(out_path=os.path.join(HERE, name), options=options, limit=limit)


def basic(work: str) -> None:
    col = new_collection(work)
    d = deck(col, "Geography")
    add(col, "Basic", d, ["Capital of France?", "Paris"])
    add(col, "Basic", d, ["Capital of Norway?", "Oslo"])
    # One answered card, so the package carries a review log and a studied card.
    col.decks.select(d)
    card = col.sched.getCard()
    col.sched.answerCard(card, 3)
    export(col, d, "anki21b-basic.apkg")
    col.close()


def basic_and_reversed(work: str) -> None:
    col = new_collection(work)
    d = deck(col, "Vocabulary")
    add(col, "Basic (and reversed card)", d, ["der Hund", "the dog"])
    export(col, d, "anki21b-basic-reversed.apkg")
    col.close()


def four_fields(work: str, legacy: bool) -> None:
    col = new_collection(work)
    models = col.models
    notetype = models.new("Vocab Four")
    for field in ("Word", "Meaning", "Example", "Notes"):
        models.add_field(notetype, models.new_field(field))
    template = models.new_template("Card 1")
    template["qfmt"] = "{{Word}}"
    template["afmt"] = "{{FrontSide}}<hr id=answer>{{Meaning}}<br>{{Example}}<br>{{Notes}}"
    models.add_template(notetype, template)
    models.add(notetype)
    d = deck(col, "Spanish")
    add(col, "Vocab Four", d, ["el gato", "the cat", "El gato duerme.", "Masculine noun"])
    export(col, d, "anki-legacy-four-field.apkg" if legacy else "anki21b-four-field.apkg", legacy=legacy)
    col.close()


def typing(work: str) -> None:
    col = new_collection(work)
    d = deck(col, "Capitals")
    add(col, "Basic (type in the answer)", d, ["Capital of France?", "Paris"])
    export(col, d, "anki21b-typing.apkg")
    col.close()


def hint(work: str) -> None:
    # No stock type uses a hint, so this one is made the way a user would make it.
    col = new_collection(work)
    models = col.models
    notetype = models.new("Hinted")
    for field in ("Question", "Answer", "Hint"):
        models.add_field(notetype, models.new_field(field))
    template = models.new_template("Card 1")
    template["qfmt"] = "{{Question}}<br>{{hint:Hint}}"
    template["afmt"] = "{{FrontSide}}<hr id=answer>{{Answer}}"
    models.add_template(notetype, template)
    models.add(notetype)
    d = deck(col, "Chemistry")
    add(col, "Hinted", d, ["Symbol for gold?", "Au", "From the Latin aurum"])
    export(col, d, "anki21b-hint.apkg")
    col.close()


def cloze(work: str) -> None:
    col = new_collection(work)
    d = deck(col, "History")
    add(col, "Cloze", d, ["{{c1::Rome}} was founded in {{c2::753 BC}}.", "Legend says so."])
    export(col, d, "anki21b-cloze.apkg")
    col.close()


def image_occlusion(work: str) -> None:
    col = new_collection(work)
    col.add_image_occlusion_notetype()
    notetype = col.models.by_name("Image Occlusion")
    image = os.path.join(work, "map.png")
    with open(image, "wb") as handle:
        handle.write(tiny_png(40, 20))
    d = deck(col, "Anatomy")
    col.decks.select(d)
    col.set_config("curDeck", d)
    occlusions = (
        "{{c1::image-occlusion:rect:left=.1:top=.1:width=.3:height=.3:oi=1}}"
        "{{c2::image-occlusion:ellipse:left=.5:top=.5:width=.2:height=.2:oi=1}}"
    )
    col.add_image_occlusion_note(notetype["id"], image, occlusions, "Label the map", "Extra text", [])
    # The note lands in the current deck; move every card into the exported one to be sure.
    col.set_deck([c for c in col.find_cards("")], d)
    export(col, d, "anki21b-image-occlusion.apkg")
    col.close()


BUILDERS = {
    "basic": basic,
    "basic-reversed": basic_and_reversed,
    "four-field": lambda w: four_fields(w, False),
    "legacy-four-field": lambda w: four_fields(w, True),
    "typing": typing,
    "hint": hint,
    "cloze": cloze,
    "image-occlusion": image_occlusion,
}


def main() -> None:
    names = sys.argv[1:] or list(BUILDERS)
    for build in (BUILDERS[name] for name in names):
        work = tempfile.mkdtemp(prefix="mnemo-anki-fixture-")
        try:
            build(work)
        finally:
            shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    main()
