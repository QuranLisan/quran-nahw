#!/usr/bin/env python3
"""
peek.py — show exactly what is in one ayah, character by character.

Against the exported JSON:
    python tools/peek.py --data data --ayah 1:7

Against the source database (this is the one that settles arguments):
    python tools/peek.py --words path/to/indopak-words.db --ayah 1:7

Use it when a box on the sheet shows something you did not expect. It prints
every token with its Unicode codepoints and names, so an ayah marker, a stray
waqf sign and a real word can be told apart without squinting at a glyph.
"""

import argparse
import json
import sqlite3
import sys
import unicodedata
from pathlib import Path

LETTER_RANGES = [
    (0x0620, 0x063F), (0x0641, 0x064A), (0x066E, 0x066F),
    (0x0671, 0x06D3), (0x06EE, 0x06EF), (0x06FA, 0x06FF),
]
DIGIT_RANGES = [(0x0660, 0x0669), (0x06F0, 0x06F9), (0x0030, 0x0039)]


def kind(ch):
    o = ord(ch)
    if any(a <= o <= b for a, b in LETTER_RANGES):
        return 'letter'
    if any(a <= o <= b for a, b in DIGIT_RANGES):
        return 'DIGIT'
    if 0x064B <= o <= 0x065F or o == 0x0670:
        return 'harakah'
    if 0x06D6 <= o <= 0x06DE or 0x06E9 <= o <= 0x06EC:
        return 'PAUSE'
    if 0x06DF <= o <= 0x06E8 or o == 0x06ED:
        return 'spelling'
    if ch.isspace():
        return 'space'
    return 'other'


def describe(token):
    parts = []
    for ch in token:
        try:
            name = unicodedata.name(ch)
        except ValueError:
            name = '?'
        parts.append(f'U+{ord(ch):04X} {kind(ch):<7} {name}')
    return parts


def verdict(token):
    kinds = {kind(c) for c in token}
    if 'letter' in kinds:
        return 'real word'
    if 'DIGIT' in kinds:
        return '>>> AYAH MARKER (digits, no letters) — will be dropped'
    return '>>> no letters — will be dropped'


def show(tokens, source):
    print(f'\n{source}: {len(tokens)} tokens\n')
    for i, t in enumerate(tokens, start=1):
        print(f'{i:>3}. {t}')
        print(f'     {verdict(t)}')
        for line in describe(t):
            print(f'       {line}')
        print()


def from_json(data, s, a):
    p = Path(data) / f'surah-{s:03d}.json'
    if not p.exists():
        sys.exit(f'{p} not found — run qul_export.py first.')
    surah = json.loads(p.read_text(encoding='utf-8'))
    verses = surah['verses']
    print(f'surah {s}: {len(verses)} verses in the export')
    if a > len(verses):
        sys.exit(f'ayah {a} is past the end — the export has {len(verses)} verses. '
                 f'If this surah should have more, your ayah numbering is shifted.')
    show(verses[a - 1]['w'], f'{data}/surah-{s:03d}.json  ayah {a}')


def from_db(dbpath, s, a):
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from qul_export import find_word_table
    con = sqlite3.connect(f'file:{dbpath}?mode=ro', uri=True)
    table, c = find_word_table(con)
    print(f'table: {table}  columns: {list(c.values())}')

    if 'location' in c:
        rows = [(loc, txt) for loc, txt in con.execute(
            f'SELECT "{c["location"]}","{c["text"]}" FROM "{table}"')
            if str(loc).startswith(f'{s}:{a}:')]
        rows.sort(key=lambda r: int(str(r[0]).split(':')[2]))
        idx = [str(r[0]) for r in rows]
        toks = [r[1] or '' for r in rows]
    else:
        rows = sorted(con.execute(
            f'SELECT "{c["word"]}","{c["text"]}" FROM "{table}" '
            f'WHERE "{c["surah"]}"=? AND "{c["ayah"]}"=?', (s, a)))
        idx = [str(r[0]) for r in rows]
        toks = [r[1] or '' for r in rows]

    n_ayahs = con.execute(
        f'SELECT COUNT(DISTINCT "{c.get("ayah", "ayah")}") FROM "{table}" '
        f'WHERE "{c.get("surah", "surah")}"=?', (s,)).fetchone()[0] if 'location' not in c else None
    con.close()

    if n_ayahs:
        print(f'surah {s} has {n_ayahs} distinct ayahs in the database')
    if not toks:
        sys.exit(f'no rows for {s}:{a} — check the surah/ayah numbering in this database.')
    print(f'raw word indices present: {", ".join(idx)}')
    show(toks, f'{dbpath}  ayah {s}:{a}')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--ayah', required=True, metavar='S:A', help='e.g. 1:7')
    ap.add_argument('--data', help='exported data folder')
    ap.add_argument('--words', help='source QUL word database')
    args = ap.parse_args()
    s, a = (int(x) for x in args.ayah.split(':'))
    if not args.data and not args.words:
        sys.exit('give --data or --words (or both)')
    if args.words:
        from_db(args.words, s, a)
    if args.data:
        from_json(args.data, s, a)


if __name__ == '__main__':
    sys.exit(main())
