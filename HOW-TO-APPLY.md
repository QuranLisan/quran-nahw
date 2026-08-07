# Update — app code only

This bundle deliberately contains **no `data/`, no `fonts/`, no `icons/`,
no `manifest.json`**. Copy these files over your existing folder and nothing
of yours is touched.

    index.html
    app.css
    app.js
    sw.js
    tools/qul_export.py
    tools/peek.py

That is the whole update.

## After copying

Hard-refresh once — Ctrl+Shift+R on Windows, or pull down to refresh on the
tablet. The service worker cache name changed, so the old files are discarded
and the new ones load.

## In this update

Interface is in English, left-to-right. The sheet itself stays right-to-left.

Boxes carry no labels. If you ever want them back, tick **Field labels** under
Settings › Show — that also restores the header row in the table layout.

Fields keep their order top to bottom: Type, Form, I'rab, Structure, then Root
and Meaning if you switch those on.

## What this fixes

Tokens with no Arabic letters — ayah markers and waqf signs your database
stores as word rows — are no longer drawn as boxes. Surviving words are
renumbered 1..n so nothing downstream shifts.

`qul_export.py` also no longer strips U+06E1, the IndoPak sukun. The previous
version removed the whole U+06D6–U+06ED block, which took the sukun, madda,
small waw and small yeh with it.

## What this does NOT change

Nothing is removed from the interface. Word splitting (تقطیع) is off unless
you tick it in ترتیبات, and it needs a separate import to do anything at all.

Your typed answers live in the browser's storage, not in these files, so they
survive. You can back them up any time from ترتیبات › جوابات محفوظ کریں.

## If you already overwrote your data folder

The earlier full zip shipped demo text under the same filenames as your
export, so extracting it in place replaced your IndoPak text with imlā'ī
demo text. Sorry — that was a bad way to package it.

To restore:

1. Put your font back at `fonts/quran.ttf`.
2. Re-run your export:

       python tools\qul_export.py --words "path\to\indopak-words.db" --out data

Re-exporting is worth doing regardless, because of the sukun fix above.
