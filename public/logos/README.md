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
- **The extension does not have to match the data file.** Team logos are resolved
  by trying `.png`, `.svg`, `.webp`, `.jpeg`, `.jpg`, `.gif` in turn, so
  `tkr.svg` is found even though the season data names `tkr.png`. Any team with no
  artwork at all logs a `[logos]` warning in the console and falls back to the
  drawn colour badge.

> These are third-party trademarks. Only add logo files you are licensed to use.

## Branding assets for the exported graphic

Two extra files are picked up automatically by the PNG/SVG/PDF export:

| File | Used for | Fallback if absent |
|---|---|---|
| `champhunt.png` (or `.svg`) | The **"Powered by"** mark, top right | a plain `champhunt` wordmark |
| `qr.png` (or `.svg`) | The QR code in the header block | a drawn placeholder that does **not** scan |

Drop the files in and they appear on the next page load — no code change. The
logo is drawn into a 92×26 box and is right-aligned, so a transparent-background
PNG with a wide aspect ratio works best. The QR is drawn into a 54×54 box.

`Willow_Sports.png` is the Willow Sports lockup shown bottom-right on every
template. It is a portrait mark (icon over wordmark) on a 16:9 transparent
canvas with navy type, so it is drawn into a near-square box on a light plate —
navy artwork is illegible on the CPL navy card and on a night feed without one.
`cpl.png` is optional: supply it for a league mark top-left on the CPL template,
otherwise the league's short code runs ahead of the title ("CPL POWER RANKINGS").

`qr.png` is now a real, verified QR encoding `https://www.champhunt.in/cpl`
(error-correction level H, 2-module quiet zone). It is deliberately NOT run
through the auto-crop that trims the other marks — cropping would eat the quiet
zone and stop it scanning. Regenerate it if the destination URL ever changes.

`CPL logo.jpeg` is the league mark shown top-left on both templates. It arrives as
a JPEG on a white field, so at load time the white background is flood-filled from
the border to transparent (a global white-key would punch holes through the star's
white gaps), then trimmed. On dark placements its near-black wordmark is lifted to
white so the mark stays visible without a plate behind it. A transparent PNG named
`cpl.png` takes precedence if you ever supply one.
