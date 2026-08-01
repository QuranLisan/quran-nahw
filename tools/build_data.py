#!/usr/bin/env python3
"""
build_data.py — QUL word-by-word SQLite  ->  JSON for the Quran Nahw worksheet app.

Usage:
    python tools/build_data.py path/to/qul-words.db

Writes:
    data/index.json          surah list (number, Arabic name, ayah count)
    data/surah/001.json ...  one file per surah, word-by-word

Notes
-----
* The QUL word table is one row per word, with the LAST row of every verse being
  the ayah-end marker. We drop that row POSITIONALLY (never by glyph shape) so
  genuine words are not silently lost. A report is printed so you can sanity-check.
* Waqf / pause marks U+06D6-U+06ED are stripped from the text.
* Ayah numbers are NOT baked into the text; the app renders them separately in a
  plain font so the Quran font's `calt` medallion substitution never fires.
"""

import json
import os
import re
import sqlite3
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "data")

# U+06D6..U+06ED: small high/low waqf, sajdah, rub-el-hizb, end-of-ayah, etc.
WAQF_RE = re.compile("[\u06d6-\u06ed]")
# Arabic-Indic and Extended Arabic-Indic digits
DIGITS_RE = re.compile("^[\u0660-\u0669\u06f0-\u06f9\\s]+$")

SURAH_NAMES = [
    "الفاتحة", "البقرة", "آل عمران", "النساء", "المائدة", "الأنعام", "الأعراف",
    "الأنفال", "التوبة", "يونس", "هود", "يوسف", "الرعد", "إبراهيم", "الحجر",
    "النحل", "الإسراء", "الكهف", "مريم", "طه", "الأنبياء", "الحج", "المؤمنون",
    "النور", "الفرقان", "الشعراء", "النمل", "القصص", "العنكبوت", "الروم",
    "لقمان", "السجدة", "الأحزاب", "سبأ", "فاطر", "يس", "الصافات", "ص", "الزمر",
    "غافر", "فصلت", "الشورى", "الزخرف", "الدخان", "الجاثية", "الأحقاف", "محمد",
    "الفتح", "الحجرات", "ق", "الذاريات", "الطور", "النجم", "القمر", "الرحمن",
    "الواقعة", "الحديد", "المجادلة", "الحشر", "الممتحنة", "الصف", "الجمعة",
    "المنافقون", "التغابن", "الطلاق", "التحريم", "الملك", "القلم", "الحاقة",
    "المعارج", "نوح", "الجن", "المزمل", "المدثر", "القيامة", "الإنسان",
    "المرسلات", "النبأ", "النازعات", "عبس", "التكوير", "الانفطار", "المطففين",
    "الانشقاق", "البروج", "الطارق", "الأعلى", "الغاشية", "الفجر", "البلد",
    "الشمس", "الليل", "الضحى", "الشرح", "التين", "العلق", "القدر", "البينة",
    "الزلزلة", "العاديات", "القارعة", "التكاثر", "العصر", "الهمزة", "الفيل",
    "قريش", "الماعون", "الكوثر", "الكافرون", "النصر", "المسد", "الإخلاص",
    "الفلق", "الناس",
]

# Start of each juz as (surah, ayah). End is computed as the ayah before the
# next juz's start. Verify against your own mushaf if a boundary looks off —
# you can always adjust the ayah range by hand in the app.
JUZ_STARTS = [
    (1, 1), (2, 142), (2, 253), (3, 93), (4, 24), (4, 148), (5, 82), (6, 111),
    (7, 88), (8, 41), (9, 93), (11, 6), (12, 53), (15, 1), (17, 1), (18, 75),
    (21, 1), (23, 1), (25, 21), (27, 56), (29, 46), (33, 31), (36, 28),
    (39, 32), (41, 47), (46, 1), (51, 31), (58, 1), (67, 1), (78, 1),
]


def find_words_table(con):
    """Locate the word-by-word table and its column names."""
    tables = [r[0] for r in con.execute(
        "SELECT name FROM sqlite_master WHERE type='table'")]
    for t in tables:
        cols = {r[1].lower() for r in con.execute(f'PRAGMA table_info("{t}")')}
        if {"surah", "ayah", "word", "text"} <= cols:
            return t
    raise SystemExit(
        "Could not find a table with surah/ayah/word/text columns.\n"
        f"Tables present: {', '.join(tables)}"
    )


def clean(text):
    return WAQF_RE.sub("", text or "").strip()


def main():
    if len(sys.argv) < 2:
        raise SystemExit("Usage: python tools/build_data.py <qul-words.db>")

    db_path = sys.argv[1]
    if not os.path.exists(db_path):
        raise SystemExit(f"No such file: {db_path}")

    con = sqlite3.connect(db_path)
    table = find_words_table(con)
    print(f"Reading table: {table}")

    rows = con.execute(
        f'SELECT surah, ayah, word, text FROM "{table}" '
        f"ORDER BY surah, ayah, word"
    ).fetchall()
    print(f"{len(rows):,} word rows read")

    # Group into verses, preserving order.
    verses = {}
    for surah, ayah, word, text in rows:
        verses.setdefault((int(surah), int(ayah)), []).append(clean(text))

    os.makedirs(os.path.join(OUT, "surah"), exist_ok=True)

    index = []
    odd_markers = []
    total_words = 0

    for s in range(1, 115):
        ayah_nums = sorted(a for (ss, a) in verses if ss == s)
        if not ayah_nums:
            print(f"  ! surah {s} missing from database")
            continue

        ayahs = []
        for a in ayah_nums:
            tokens = [t for t in verses[(s, a)] if t]
            if not tokens:
                continue
            # Positional rule: the last token of a verse is the ayah marker.
            marker = tokens[-1]
            words = tokens[:-1]
            # Sanity check only — we never change behaviour based on this.
            if not DIGITS_RE.match(marker):
                odd_markers.append((s, a, marker))
            if not words:  # defensive: a verse should never be marker-only
                words = tokens
            total_words += len(words)
            ayahs.append({"n": a, "w": words})

        name = SURAH_NAMES[s - 1]
        with open(os.path.join(OUT, "surah", f"{s:03d}.json"), "w",
                  encoding="utf-8") as f:
            json.dump({"surah": s, "name": name, "ayahs": ayahs},
                      f, ensure_ascii=False, separators=(",", ":"))
        index.append({"n": s, "name": name, "ayahs": len(ayahs)})

    # Juz ranges
    juz = []
    for i, (s, a) in enumerate(JUZ_STARTS):
        if i + 1 < len(JUZ_STARTS):
            ns, na = JUZ_STARTS[i + 1]
            if na == 1:
                es, ea = ns - 1, index[ns - 2]["ayahs"]
            else:
                es, ea = ns, na - 1
        else:
            es, ea = 114, index[113]["ayahs"]
        juz.append({"n": i + 1, "from": [s, a], "to": [es, ea]})

    with open(os.path.join(OUT, "index.json"), "w", encoding="utf-8") as f:
        json.dump({"surahs": index, "juz": juz}, f,
                  ensure_ascii=False, separators=(",", ":"))

    print(f"\nWrote {len(index)} surah files + index.json")
    print(f"{total_words:,} genuine words kept (markers excluded)")
    if odd_markers:
        print(f"\n{len(odd_markers)} verse-final tokens were not plain digits.")
        print("This is normal for ornate marker glyphs. First few:")
        for s, a, m in odd_markers[:8]:
            print(f"   {s}:{a}  ->  {m!r}")
        print("If these look like real words, your DB stores markers "
              "differently — tell me and we'll adjust the rule.")


if __name__ == "__main__":
    main()
