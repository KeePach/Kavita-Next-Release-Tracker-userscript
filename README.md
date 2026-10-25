# Kavita-Next-Release-Tracker-userscript
Userscript for Kavita that tracks upcoming official volumes of licensed series, with colored cards, reminders and calendar export.


# Kavita Next Release Tracker

A userscript that adds an **upcoming official volumes** tracker to your self-hosted [Kavita](https://www.kavitareader.com) library. It finds which of your series are licensed, lets you note the date of the next volume, and colors the cards, shows reminders and exports a calendar so you don't forget to buy or check.

## Introduction

Kavita is great for reading what you own, but it has no idea what is coming next. If you collect official manga volumes, the usual routine is a spreadsheet or a notes app where you copy release dates by hand and hope you remember to look at it.

This script keeps that routine, but removes the tedious part:

- **You don't maintain a list of licensed series.** The script reads the [MangaBaka](https://mangabaka.org) database file you download, and works out which series in your Kavita library are licensed.
- **You only type what only you know:** the next volume's date, a store link, and optionally its cover.
- **Kavita shows the state at a glance.** Each licensed series gets a colored frame and a small badge on its card: has a date, coming soon, out now, or time to check again.
- **It nags you gently.** A series with no announced date gets a "check again" reminder every month, until you mark it as finished.

Everything runs in your browser. Nothing is sent anywhere except requests to your own Kavita server.

## Contents

- [Features](#features)
- [Requirements](#requirements)
- [Installation](#installation)
- [First-time setup](#first-time-setup)
- [Using it](#using-it)
- [How licensed series are detected](#how-licensed-series-are-detected)
- [Colors and statuses](#colors-and-statuses)
- [Calendar export](#calendar-export)
- [Settings](#settings)
- [Where your data is stored](#where-your-data-is-stored)
- [Privacy and network use](#privacy-and-network-use)
- [Troubleshooting](#troubleshooting)
- [Known limitations](#known-limitations)
- [Credits and disclaimer](#credits-and-disclaimer)

## Features

**Detection**
- Reads the MangaBaka database dump and keeps only a small index of licensed series (a few MB). The large file itself is never stored.
- Matches each Kavita series by, in this order: a MangaBaka ID you typed in, the MangaBaka ID in Kavita's *External Ids* tab, a MangaBaka link in the web links, then AniList, MyAnimeList, MangaUpdates, Kitsu and Anime-Planet IDs, and finally the title.
- A weekly reminder to refresh the database (configurable).

**On your library**
- A colored frame around the whole card and a badge on the cover, in five configurable colors.
- A **+ Release** button on licensed series that aren't tracked yet.
- On series pages, a **next-volume card** in the Storyline, Chapters and Volumes tabs, with your own cover image.

**Tracking**
- Per series: next volume, release date, store link, note and cover.
- **Got it - track next volume** bumps "Vol. 5" to "Vol. 6" and clears the date.
- **No more volumes expected** stops the reminders for finished series.
- **Hide** series you don't want treated as licensed, with a list to restore them.

**Reminders and export**
- A floating **📅 Releases** button that shows how many series need attention.
- A popup with the most urgent series, and a **View all** window with search, filters and sorting.
- Calendar export (`.ics`) with release dates and monthly "check for a date" events.
- Backup and restore as a `.json` file.

**Convenience**
- Drag the button (or the popup's title bar) anywhere; the position is remembered.
- Clicking a series name opens it in Kavita, the cart icon opens the store page.

## Requirements

- A **Kavita** server, accessed through its web UI in a desktop browser. Developed against a recent 0.9.x web UI.
- A userscript manager: [Tampermonkey](https://www.tampermonkey.net) or [Violentmonkey](https://violentmonkey.github.io). Developed and used with **Firefox + Tampermonkey**.
- A reasonably recent browser (the script uses IndexedDB, file streaming and, for `.gz` files, `DecompressionStream`; Firefox 113+ or a current Chromium browser).
- The **MangaBaka database file**, downloaded from [mangabaka.org/data/database](https://mangabaka.org/data/database).
- Series metadata that links your library to MangaBaka, AniList, MyAnimeList or MangaUpdates (for example from the metadata tools you already use with Kavita). Without links the script falls back to matching by title.

## Installation

1. Install Tampermonkey (or Violentmonkey) in your browser.
2. Install the script, either way:
   - Open the raw file on GitHub: [RAW FILE](https://github.com/KeePach/Kavita-Next-Release-Tracker-userscript/raw/refs/heads/main/kavitanext.user.js). Your userscript manager should offer to install it.
   - Or create a **new script** in the userscript manager, delete the template, paste the contents of `kavitanext.user.js`, and save.
3. **Tell the script where your Kavita lives.** Open the script in the editor and look at the header:

   ```js
   // @include      http://localhost:5000/*
   // @include      http://127.0.0.1:5000/*
   ```

   Add a line for every address you use to open Kavita, for example:

   ```js
   // @include      http://192.168.1.50:5000/*
   ```

   If your Kavita uses a different port, change the number in the `@include` lines **and** in this line near the top of the script:

   ```js
   const KAVITA_PORTS = ['5000'];
   ```

   Both are needed because userscript managers ignore port numbers in `@match`, so the script double-checks the port itself.
4. Reload Kavita. You should see a **📅 Releases** button in the bottom-right corner.

To update later, paste the new version over the old one and save. Keep the script's name and namespace unchanged so it keeps using the same stored data.

## First-time setup

1. **Import the MangaBaka database.**
   Click **📅 Releases → View all → MangaBaka database → Choose database file...** and pick the file you downloaded. It can be a `.json` or `.jsonl` file, or the `.gz` / `.tar.gz` of either, so you don't need to unzip it. `.zst` files cannot be read by browsers. The import runs in a few seconds to a few minutes depending on file size, and a progress bar is shown.
2. **Browse your library.** Licensed series now have a gold frame and a **+ Release** button.
3. **Track a series.** Click **+ Release** (or open a series page and use the popup), enter the next volume and its date, and save.

## Using it

### The popup

Click **📅 Releases**. The popup shows:

- the series you are viewing, with its license status,
- up to six series that need attention (out now, coming soon, or due for a date check),
- **View all**, **Export calendar** and **Settings** buttons.

Rows have three icons: the title opens the series in Kavita, 🛒 opens the store link, ✎ edits the entry, and ✔ (on series waiting for a date) marks it as finished.

### Editing a series

| Field | Purpose |
|---|---|
| Next volume | For example `Vol. 6`. Used in the badge and the calendar. |
| Release date | Leave empty if not announced yet. |
| Store link | Opened by the cart icon and by the next-volume card. |
| Note | Free text. |
| Cover of the next volume | Choose an image file, paste an image with Ctrl+V, or enter an address. Files are shrunk to small JPEGs. |
| No more volumes expected | Stops reminders for finished series. |
| Licensed status | *Automatic*, *Always treat as licensed*, or *Never treat as licensed (hide)*. |
| MangaBaka link or ID | Fixes a wrong or missing match. |

Buttons: **Save**, **Checked today, no date yet** (restarts the monthly check timer), **Got it - track next volume**, **Stop tracking**, and **Not licensed - hide this series** (for series you aren't tracking).

If you enter a date for a series marked as finished, the script assumes a new volume was announced and clears the finished mark.

### The next-volume card

On a tracked series' page, a dashed card appears at the end of the list in the Storyline, Chapters and Volumes tabs. It shows your cover, the volume name, a status badge and a ✎ button. Clicking it opens the store link, or the edit dialog if there is no link. On long series it appears when you scroll near the end of the list.

### View all

Search by title or note, filter (all, needs attention, already out, has a date, no date yet, no more volumes) and sort (priority, date, title). The footer also has calendar export, backup and restore, the database window, hidden series, re-reading metadata and settings.

### Hidden series

Series set to *Never treat as licensed* lose their frame and button. They are listed under **View all → Hidden series**, where you can restore them. A series you track stays visible regardless.

## How licensed series are detected

For each Kavita series the script reads the metadata Kavita already stores (web links and the *External Ids* tab) and looks it up in your imported MangaBaka database. The first rule that applies decides the result:

1. **A MangaBaka ID you typed in the edit dialog.**
2. **Kavita's own *MangaBaka Id*** from the series' *External Ids* tab.
3. **A MangaBaka link** in the series' web links.
4. **AniList, MyAnimeList, MangaUpdates, Kitsu or Anime-Planet** IDs (from *External Ids* or web links).
5. **The title**, only when the series has no recognizable ID at all. These matches are marked "check it is the right series".

If a MangaBaka ID exists but points to a series that MangaBaka doesn't list as licensed, the result is **Not licensed**. Other methods are not tried, so a wrong title match can't override a correct ID.

MangaBaka marks a series as licensed with its `is_licensed` flag; the script uses it as-is and shows the English publisher names for reference. Series merged into another MangaBaka entry are followed to the current entry.

Before you import a database, the script only estimates licensing from publisher names and says so in the popup.

The **Inspect** button in the popup shows exactly which links and IDs the script found for the current series, and what it concluded.

## Colors and statuses

| Status | Meaning | Default color |
|---|---|---|
| Nothing to do yet | Licensed and not tracked, or tracked with no date and not due for a check | Gold |
| Has a release date | A date in the future | Blue |
| Coming soon | The date is within 7 days | Orange |
| Out now | The date has passed or is today | Red |
| Check for a date | No date, and the last check was 30+ days ago | Red |
| No more volumes | Marked as finished | Green |

All colors can be changed in **Settings**. The frame and badge colors follow your choice automatically.

## Calendar export

**Export calendar (.ics)** creates a calendar file:

- every series with a date becomes an all-day event with a reminder at 9:00,
- every tracked series with no date becomes a **monthly** "Check release date" event,
- finished series are left out.

The file is a snapshot, not a live subscription. Calendar apps handle re-imports inconsistently, and importing again does not reliably remove events that are no longer in the file. The most dependable routine is:

1. Delete the old **Manga releases** calendar in your calendar app.
2. Create a new calendar with that name.
3. Import the new file into it.

## Settings

**📅 Releases → Settings** (also in the View all window):

- the five status colors, with reset,
- how many days before a release counts as "coming soon" (default 7),
- how often a series with no date should be re-checked (default 30),
- how often to remind you to update the database (default 7),
- show the tracker button on every series (mostly for troubleshooting),
- show the next-volume card on series pages,
- reset the button position.

## Where your data is stored

| Data | Stored in | Survives restarts |
|---|---|---|
| Tracked series, dates, covers, hidden list, manual IDs, colors, settings | The userscript manager's storage for this script | Yes |
| Cached Kavita metadata | The userscript manager's storage | Yes (re-read after 1 day) |
| The MangaBaka index (licensed series only) | IndexedDB of your Kavita address | Yes, but it is per address and is erased if you clear site data |

Because the index is stored per address, opening Kavita as both `localhost:5000` and `192.168.1.50:5000` means importing the database once for each. Your own data is shared between addresses.

Use **View all → Backup (.json)** to save a copy of your series, hidden list, manual IDs, colors and day settings. It does not include the database index (re-import it) or the cached metadata. Deleting the script removes its stored data, so keep a backup.

## Privacy and network use

- The script calls your own Kavita server's API (`/api/Series/...`) from the page you are already logged in to. To do that it reads your Kavita session token from the page's local storage and sends it only to that same server.
- It makes **no requests to other websites**. The MangaBaka database is read from the file you choose on your computer.
- Links (stores, the MangaBaka download page) open only when you click them.
- If you give a next-volume cover as an **image address**, your browser loads that image from that address. Choosing a file stores the image locally instead.

## Troubleshooting

**The 📅 button doesn't appear.**
Check that the script is enabled, and that the address in your browser's address bar is covered by an `@include` line and the port is in `KAVITA_PORTS`.

**It appears on another local site.**
Userscript managers ignore ports in `@match`. This script uses `@include` plus a port check; make sure you haven't added a port-less `@include`.

**No series are marked as licensed.**
Import the database (the popup shows a banner until you do). Then open **Inspect** on a series you know is licensed to see which IDs the script found.

**A series was matched to the wrong MangaBaka entry.**
Type the correct MangaBaka number or link in the edit dialog, or fix the *MangaBaka Id* in Kavita's *External Ids* tab. Reopen the popup (the open series is re-read from Kavita automatically).

**A series shows "Couldn't match".**
It has no MangaBaka, AniList, MyAnimeList, MangaUpdates, Kitsu or Anime-Planet link and no unique title match. Add a MangaBaka ID in the edit dialog.

**The `.tar.gz` or `.gz` file fails to import.**
Unzip it and choose the `.json` or `.jsonl` inside. A file whose lines are extremely long isn't supported; use the JSONL version.

**The import is slow.**
Large files take a while because they are read in chunks. The progress bar shows how far along it is, and you can cancel.

**The popup covers something.**
Drag the 📅 button or the popup's title bar. **Settings → Reset button position** brings it back to the corner.

**The next-volume card doesn't show.**
It needs a tracked series that isn't marked as finished, and it appears in the Storyline, Chapters and Volumes tabs. On long lists, scroll near the end. It can be turned off in Settings.

**Frames or badges are missing after a Kavita update.**
Kavita may have changed its page layout. See the limitations below and open an issue.

## Known limitations

- The script depends on Kavita's page structure (for example the `.card-item-container` and `app-entity-card` elements). A Kavita update can break it until the script is adjusted.
- The next-volume card is added to a list that Kavita builds itself. Its position on long, scrolling lists is a best effort.
- A browser can't remember the location of a file, so you choose the database file again each time you update it. There is no automatic download.
- The reminder counts from the day you import the file, not from the date of the data. The database window shows both.
- The script relies on MangaBaka's `is_licensed` flag and assumes it describes official English releases. Check the English publisher names shown in the popup if a result looks wrong.
- Title matching is a last resort and can be wrong; those matches are labeled as such.
- Release dates are entered by you. The script doesn't look them up.
- It has been tested mainly with Firefox and Tampermonkey. Other browsers and managers should work but are less tested.

## Credits and disclaimer

- Licensed-series data comes from [MangaBaka](https://mangabaka.org). Check the terms on their [database page](https://mangabaka.org/data/database) before using or redistributing the data. This project does not include any of it.
- [Kavita](https://www.kavitareader.com) is a separate open-source project.
- This project is **not affiliated with or endorsed by Kavita or MangaBaka**.
- Written with the help of [Claude](https://claude.ai) (Anthropic).
