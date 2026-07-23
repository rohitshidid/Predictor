# Team logo drop-in folder

Place each franchise's **licensed** logo file here and it renders automatically —
no code change needed. If a file is missing, the UI falls back to the team's
brand-coloured crest badge.

## Naming

Name each file by the team's short code (lowercase), matching the `logo` field in
`data/cpl_2026.json`:

| Team | File |
|---|---|
| Trinbago Knight Riders | `tkr.png` |
| Guyana Amazon Warriors | `gaw.png` |
| Antigua & Barbuda Falcons | `abf.png` |
| Barbados Royals | `br.png` |
| Saint Lucia Kings | `slk.png` |
| St Kitts & Nevis Patriots | `snp.png` |
| Jamaica Kingsmen | `jam.png` |

## Format

- **PNG with a transparent background** works best (square-ish, ~128px+).
- `.svg`, `.webp`, `.jpg`, and `.gif` are also served.
- To use a different extension, update that team's `logo` path in the data file
  (and in `src/generateSeason.js` if you regenerate the season).

> These are third-party trademarks. Only add logo files you are licensed to use.
