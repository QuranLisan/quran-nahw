Your exported Quranic text goes here.

    python tools/qul_export.py --words "path/to/indopak-words.db" --out data

This folder must be committed for the site to work on a phone — the app cannot
read a database, only these JSON files.

Until data/index.json exists, the app falls back to the sample text in demo/
and shows a banner saying so.
