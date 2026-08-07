# Sources and attribution

## Morphological segmentation

The word segmentation in `data/morph-*.json` (which letters of a word form
بِ vs سْمِ, and the part-of-speech behind each نوع label) derives from:

**Quranic Arabic Corpus, version 0.4** — Copyright © 2011 Kais Dukes
Licensed under the GNU General Public License
https://corpus.quran.com

by way of the Arabic-script edition at
https://github.com/mustafa0x/quran-morphology

The corpus terms require that its source be clearly indicated and that a link
to corpus.quran.com be provided wherever the data is used. The app does this
in ترتیبات › تقطیع, and `tools/morph_import.py` writes the attribution into
`data/index.json` so it travels with the data.

The `.json` files here cover only the demo surahs. Generating the full set
means running `morph_import.py` against a copy of the morphology file you
download yourself.

## Quranic text

Supplied by you, from your own QUL export (qul.tarteel.ai). Not distributed
with this app.

## Font

AlQuran IndoPak by QuranWBW — by Ayman Siddiqui and R. Siddiqua. Supplied by
you; not distributed with this app.
