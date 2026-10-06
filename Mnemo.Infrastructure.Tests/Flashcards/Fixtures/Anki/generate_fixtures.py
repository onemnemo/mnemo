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


def shape(ordinal: str, kind: str, *props: tuple[str, str]) -> str:
    # Written the way ts/routes/image-occlusion/shapes/to-cloze.ts does: escaped values, a <br> after each cloze.
    body = "".join(":" + key + "=" + value.replace("\\", "\\\\").replace(":", "\\:") for key, value in props)
    return "{{c" + ordinal + "::image-occlusion:" + kind + body + "}}<br>"


def rect(ordinal: str, left: str, top: str, width: str, height: str, *extra: tuple[str, str]) -> str:
    return shape(ordinal, "rect", ("left", left), ("top", top), ("width", width), ("height", height), *extra)


def ellipse(ordinal: str, left: str, top: str, rx: str, ry: str, *extra: tuple[str, str]) -> str:
    return shape(ordinal, "ellipse", ("left", left), ("top", top), ("rx", rx), ("ry", ry), *extra)


def polygon(ordinal: str, left: str, top: str, points: str, *extra: tuple[str, str]) -> str:
    return shape(ordinal, "polygon", ("left", left), ("top", top), ("points", points), *extra)


def label(left: str, top: str, text: str, *extra: tuple[str, str]) -> str:
    # The editor always gives text shapes ordinal 0, so they make no card.
    return shape("0", "text", ("left", left), ("top", top), ("text", text), ("scale", "1"), ("fs", ".04"), *extra)


OI = ("oi", "1")


def io_collection(work: str, deck_name: str) -> tuple[Collection, DeckId, dict]:
    col = new_collection(work)
    col.add_image_occlusion_notetype()
    d = deck(col, deck_name)
    col.decks.select(d)
    col.set_config("curDeck", d)
    return col, d, col.models.by_name("Image Occlusion")


def io_note(col: Collection, notetype: dict, work: str, image: str, size: tuple[int, int], occlusions: str,
            header: str = "", back_extra: str = "", comments: str | None = None):
    path = os.path.join(work, image)
    with open(path, "wb") as handle:
        handle.write(tiny_png(*size))
    col.add_image_occlusion_note(notetype["id"], path, occlusions, header, back_extra, [])
    note = col.get_note(max(col.find_notes("")))
    if comments is not None:
        note.fields[col.models.field_map(notetype)["Comments"][0]] = comments
        col.update_note(note)
    return note


def io_export(col: Collection, d: DeckId, name: str, legacy: bool = False) -> None:
    # The note lands in the current deck; move every card into the exported one to be sure.
    col.set_deck(col.find_cards(""), d)
    export(col, d, name, legacy=legacy)
    col.close()


def answer_ord(col: Collection, d: DeckId, ordinal: int) -> None:
    col.decks.select(d)
    for _ in range(10):
        card = col.sched.getCard()
        if card.ord == ordinal:
            col.sched.answerCard(card, 3)
            return
        col.sched.bury_cards([card.id])
    raise RuntimeError("card ord not reached")


def image_occlusion(work: str) -> None:
    col, d, notetype = io_collection(work, "Anatomy")
    occlusions = rect("1", ".1", ".1", ".3", ".3", OI) + ellipse("2", ".5", ".5", ".1", ".1", OI)
    io_note(col, notetype, work, "map.png", (40, 20), occlusions, "Label the map", "Extra text")
    io_export(col, d, "anki21b-image-occlusion.apkg")


def image_occlusion_shapes(work: str) -> None:
    col, d, notetype = io_collection(work, "Anatomy")
    occlusions = (
        rect("1", ".1", ".1", ".3", ".3", OI)
        + ellipse("2", ".5", ".5", ".1", ".1", OI)
        + polygon("3", ".6", ".1", ".6,.1 .8,.1 .7,.3", OI)
        # Moved: left/top sit at (.2,.6) while the points still start at (.6,.1), so the drawn outline is shifted by (-.4,+.5).
        + polygon("4", ".2", ".6", ".6,.1 .8,.1 .7,.3", OI)
        + label(".05", ".9", "Label: one", OI)
        + label(".05", ".02", "Top\\note", OI)
        + rect("5", ".7", ".5", ".2", ".1", ("angle", "2500"), OI)
    )
    io_note(col, notetype, work, "shapes.png", (80, 40), occlusions, "Shapes", "Shape notes")
    io_export(col, d, "anki21b-image-occlusion-shapes.apkg")


def image_occlusion_grouped(work: str) -> None:
    col, d, notetype = io_collection(work, "Anatomy")
    group = rect("1", ".1", ".1", ".2", ".2", OI) + rect("1", ".6", ".1", ".2", ".2", OI) + ellipse("2", ".3", ".5", ".15", ".1", OI)
    io_note(col, notetype, work, "tall.png", (30, 60), group, "Group", "Two shapes share c1")
    # A hand edit can name several ordinals; Anki's editor never writes this.
    multi = rect("1,2", ".1", ".1", ".3", ".2", OI) + rect("3", ".5", ".6", ".3", ".2", OI)
    io_note(col, notetype, work, "square.png", (50, 50), multi, "Multi", "c1,2 shape")
    io_export(col, d, "anki21b-image-occlusion-grouped.apkg")


def image_occlusion_hide_one(work: str) -> None:
    col, d, notetype = io_collection(work, "Anatomy")
    plain = rect("1", ".1", ".1", ".3", ".3") + ellipse("2", ".5", ".5", ".1", ".1")
    io_note(col, notetype, work, "hide-one.png", (60, 40), plain, "Hide one", "No oi anywhere")
    # Anki's own editor reduces a mixed note to occlude-inactive when any shape has oi=1.
    mixed = rect("1", ".1", ".1", ".3", ".3", OI) + ellipse("2", ".5", ".5", ".1", ".1")
    io_note(col, notetype, work, "mixed.png", (40, 60), mixed, "Mixed", "oi on one shape only")
    io_export(col, d, "anki21b-image-occlusion-hide-one.apkg")


def image_occlusion_history(work: str) -> None:
    col, d, notetype = io_collection(work, "Anatomy")
    occlusions = rect("1", ".1", ".1", ".2", ".2", OI) + rect("1", ".6", ".1", ".2", ".2", OI) + ellipse("2", ".3", ".5", ".15", ".1", OI)
    io_note(col, notetype, work, "history.png", (64, 48), occlusions, "History", "Card 1 is the group")
    # Answering card 1 (the group) writes a revlog row and moves it out of new.
    answer_ord(col, d, 0)
    io_export(col, d, "anki21b-image-occlusion-history.apkg")


def image_occlusion_edge(work: str) -> None:
    col, d, notetype = io_collection(work, "Anatomy")
    occlusions = rect("1", ".1", ".1", ".3", ".3", OI) + ellipse("2", ".5", ".5", ".1", ".1", OI)
    io_note(col, notetype, work, "kept.png", (48, 32), occlusions, "Kept", "Fine note")
    io_note(col, notetype, work, "commented.png", (36, 36), occlusions, "Commented", "Has comments", "Private study note")
    missing = io_note(col, notetype, work, "gone-source.png", (36, 24), occlusions, "Missing", "Image absent")
    # Point the note at a file that is not in the media, so the export has nothing to bundle for it.
    image_index = col.models.field_map(notetype)["Image"][0]
    missing.fields[image_index] = '<img src="gone.png">'
    col.update_note(missing)
    io_export(col, d, "anki21b-image-occlusion-edge.apkg")


def card_of(col: Collection, note, ordinal: int):
    return next(c for c in (col.get_card(i) for i in col.card_ids_of_note(note.id)) if c.ord == ordinal)


def image_occlusion_extras(work: str) -> None:
    col, d, notetype = io_collection(work, "Anatomy")
    fields = col.models.field_map(notetype)
    two = rect("1", ".1", ".1", ".3", ".3", OI) + ellipse("2", ".5", ".5", ".1", ".1", OI)

    # Header and Back Extra with formatting and a picture of their own.
    rich = rect("1", ".1", ".1", ".3", ".3", OI) + label(".1", ".8", "Fish &amp; chips", OI)
    io_note(col, notetype, work, "rich.png", (40, 40), rich, "<i>Heart</i>",
            "<b>Mitral</b> valve<br><img src=\"extra.png\">")
    with open(os.path.join(work, "extra.png"), "wb") as handle:
        handle.write(tiny_png(8, 8))
    col.media.add_file(os.path.join(work, "extra.png"))

    # Shape 2 is removed after its card exists, so the package keeps a card with no shape behind it.
    gap = io_note(col, notetype, work, "gap.png", (40, 40),
                  rect("1", ".1", ".1", ".2", ".2", OI) + ellipse("2", ".5", ".5", ".1", ".1", OI)
                  + rect("3", ".6", ".1", ".2", ".2", OI), "Gap", "Middle shape removed")
    gap.fields[fields["Occlusion"][0]] = rect("1", ".1", ".1", ".2", ".2", OI) + rect("3", ".6", ".1", ".2", ".2", OI)
    col.update_note(gap)

    suspended = io_note(col, notetype, work, "suspended.png", (40, 40), two, "Suspended", "Card 1 suspended")
    col.sched.suspend_cards([card_of(col, suspended, 0).id])

    io_note(col, notetype, work, "clamped.png", (40, 40), rect("1", ".8", ".8", ".5", ".5", OI), "Clamped", "Past the edge")

    # Two notes over one picture share one media file.
    io_note(col, notetype, work, "shared.png", (40, 40), two, "SharedA", "First")
    io_note(col, notetype, work, "shared.png", (40, 40), two, "SharedB", "Second")

    # A cloze that is not a shape: nothing to mask, so the cards stay plain.
    io_note(col, notetype, work, "bare.png", (40, 40), "{{c1::not a shape}}", "Bare", "No shapes")

    unquoted = io_note(col, notetype, work, "unquoted.png", (40, 40), two, "Unquoted", "Hand edited image")
    unquoted.fields[fields["Image"][0]] = "<img src=unquoted.png>"
    col.update_note(unquoted)

    io_export(col, d, "anki21b-image-occlusion-extras.apkg")


def image_occlusion_multi_history(work: str) -> None:
    col, d, notetype = io_collection(work, "Anatomy")
    # One shape on two cards, both answered, so each card has its own history.
    io_note(col, notetype, work, "multi.png", (40, 40), rect("1,2", ".1", ".1", ".3", ".2", OI),
            "MultiHistory", "Both cards answered")
    answer_ord(col, d, 0)
    answer_ord(col, d, 1)
    io_export(col, d, "anki21b-image-occlusion-multi-history.apkg")


def image_occlusion_fields(work: str, legacy: bool) -> None:
    col, d, notetype = io_collection(work, "Anatomy")
    models = col.models
    by_name = {f["name"]: f for f in notetype["flds"]}
    # Image first, Occlusion second, Comments before Header; Anki finds fields by tag so the stock kind still works.
    models.reposition_field(notetype, by_name["Image"], 0)
    models.rename_field(notetype, by_name["Occlusion"], "Masks")
    models.rename_field(notetype, by_name["Header"], "Title")
    models.reposition_field(notetype, by_name["Comments"], 2)
    models.update_dict(notetype)
    notetype = models.get(notetype["id"])
    occlusions = rect("1", ".1", ".1", ".3", ".3", OI) + ellipse("2", ".5", ".5", ".1", ".1", OI)
    io_note(col, notetype, work, "fields.png", (44, 28), occlusions, "Reordered", "Fields moved", "Comment kept")
    io_export(col, d, "anki-legacy-image-occlusion-fields.apkg" if legacy else "anki21b-image-occlusion-fields.apkg", legacy=legacy)

BUILDERS = {
    "basic": basic,
    "basic-reversed": basic_and_reversed,
    "four-field": lambda w: four_fields(w, False),
    "legacy-four-field": lambda w: four_fields(w, True),
    "typing": typing,
    "hint": hint,
    "cloze": cloze,
    "image-occlusion": image_occlusion,
    "image-occlusion-shapes": image_occlusion_shapes,
    "image-occlusion-grouped": image_occlusion_grouped,
    "image-occlusion-hide-one": image_occlusion_hide_one,
    "image-occlusion-history": image_occlusion_history,
    "image-occlusion-edge": image_occlusion_edge,
    "image-occlusion-extras": image_occlusion_extras,
    "image-occlusion-multi-history": image_occlusion_multi_history,
    "image-occlusion-fields": lambda w: image_occlusion_fields(w, False),
    "legacy-image-occlusion-fields": lambda w: image_occlusion_fields(w, True),
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
