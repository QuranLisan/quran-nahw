# Upload

Repository root, replacing what is there:

    index.html
    app.js
    app.css
    sw.js
    manifest.json

Into `icons/`, replacing what is there:

    icons/icon-192.png
    icons/icon-512.png
    icons/icon-maskable.png
    icons/apple-touch-icon.png
    icons/favicon-32.png
    icons/favicon-64.png

Then on the tab: Chrome > Settings > Site settings > All sites > your site >
Clear & reset. Reopen the app and check Settings > Files reads **build 14**.

If you already added the app to the home screen, remove that shortcut and add
it again — Android caches the old icon with the shortcut.

## 1. Text only layout

A fourth option under Sheet layout. Just the Quranic text, no boxes, no lines.

Line spacing is under Settings > Sizing, from 1.4 up to 4.5. It applies to the
ayah text in every layout, so it also opens up the Cards and Lines views.

Both of these already existed in the code but had never been uploaded, which is
why you could not see them.

## 2. Changing the name

Two separate names.

**The name people see** — change it in three places, all plain text:

    index.html   line 6    <title>Quran Nahw worksheets</title>
    index.html   line 22   <span class="bar__name">Quran Nahw</span>
    manifest.json          "name" and "short_name"

`short_name` is what appears under the icon on the tablet home screen, so keep
it under about 12 characters.

**The web address** — that comes from the repository name. On github.com go to
Settings > General > Repository name and rename it. `quran-nahw` becomes
whatever you choose, and the address changes to match:

    https://quranlisan.github.io/NEW-NAME/

The old address stops working, so re-add the home screen shortcut afterwards.
Your GitHub username `QuranLisan` is the first part and can be changed too,
under your account settings, but that affects every repository you own.

## 3. New icon

An open mushaf with the three grammar colours ruled across the pages — green
ism, red fi'l, blue harf. It matches what the app does and stays readable at
launcher size.
