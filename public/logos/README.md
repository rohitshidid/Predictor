# Team logo drop-in folder

Place each franchise's **licensed** logo file here and it renders automatically —
no code change needed. If a file is missing, the UI falls back to the team's
brand-coloured crest badge.

## WBBL (data/wbbl_2026.json)

| Team | File |
|---|---|
| Sydney Sixers Women | `six.png` |
| Perth Scorchers Women | `sco.png` |
| Brisbane Heat Women | `hea.png` |
| Adelaide Strikers Women | `str.png` |
| Sydney Thunder Women | `thu.png` |
| Melbourne Renegades Women | `ren.png` |
| Melbourne Stars Women | `sta.png` |
| Hobart Hurricanes Women | `hur.png` |

The eight team logos are the clubs' **transparent crests** (the 6ers wordmark, the
Scorchers sun, the Heat "B", …), matching Champhunt's WBBL reference artwork, which
shows crests rather than colour tiles. They are ESPN's 500×500 club crests on alpha,
trimmed to their visible bounds (plus 4 px) so each fills its slot; the stadium rows
give them a wider-than-square slot so wordmark crests (Strikers, Thunder) are not
shrunk to a circle. They are used by every template, the Willow set included.

The previous files were the official bigbash.com.au team tiles — 300×200 PNGs of the
emblem on a filled colour gradient, from Cricket Australia's file server
(`https://static-files.cricket-australia.pulselive.com/flag/<caTeamId>.png`; `caTeamId`
is still stored per team in `data/wbbl_2026.json`, and each club's official
`teamColor` from the same data is the `colors.primary` there). They are in git history
(commit 2a916c1) if the tile look is ever wanted back. If Cricket Australia supplies
official transparent crests, drop them in under the same file names.

| Asset | File | Notes |
|---|---|---|
| WBBL league mark | `wbbl.png` | The Weber WBBL\|12 shield supplied by the Champhunt designer (`Weber_WBBL12_shield_recreation_transparent_2000px.png`, 1768×2000 on alpha), resized to 884×1000 so it stays sharp in the 4K / 3× exports without bloating every SVG/PDF it is inlined into. Drawn top-left on every template. ⚠️ The supplied file is named a *recreation* — swap in Cricket Australia's official artwork if it is obtained; `brand.leagueLogos` tries `wbbl.png` then `wbbl.svg`, so delete the PNG to let an SVG win. |
| QR | `qr-wbbl.png` | Encodes `https://www.champhunt.com/wbbl`, level H, 2-module quiet zone. Made by `node tools/make-qr.js https://www.champhunt.com/wbbl public/logos/qr-wbbl.png`; that encoder reproduces the CPL `qr.png` module for module, which is how it was verified. |
| Sponsor | — | WBBL has no presenting sponsor (`brand.sponsor: null`), so the Willow mark stands alone bottom-right. |
| Stadium backdrop | `wbbl-backdrop.jpg` (landscape) and `wbbl-backdrop-portrait.jpg` (or `.png` / `.webp`) | The designer's stills for the stadium theme (`brand.theme: "stadium"`) used by the website set (table, 16:9, social tile). Supplied as 5760×3240 and 3240×4050 PNGs; saved here as JPEG q90 at full size (1.9 MB / 1.4 MB instead of 11.5 / 8 MB) because the still is inlined into every SVG and PDF. Each frame takes whichever still is closer to its own shape — the 16:9 the landscape, the 4:5 tile and the near-square table the portrait — cover-fitted, under a dark top-and-foot wash that keeps the title readable over the floodlights. With neither file present the backdrop is drawn in vector. |
| Trophy | `wbbl-trophy.png` (or `.webp`) | The designer's transparent trophy cut-out, resized to 699×1200. It stands right of the title, under the QR, ending just above the column bar (the bar is translucent, so it must not sit behind it); the title narrows to make room. Transparent edges are trimmed automatically. ⚠️ The emblem on the trophy reads **KFC** WBBL, while WBBL\|12 is Weber-sponsored — replace when the designer supplies a corrected version, or delete the file to drop the trophy. |

## CPL (data/cpl_2026.json)

Name each file by the team's short code (lowercase), matching the `logo` field in
`data/cpl_2026.json`:

| Team | File |
|---|---|
| Trinbago Knight Riders | `tkr.png` |
| Guyana Amazon Warriors | `gaw.png` |
| Antigua & Barbuda Falcons | `abf.png` |
| Barbados Tridents | `bt.png` ⚠️ **missing** — the franchise rebranded from Barbados Royals in May 2026. `br.png` is the retired Royals crest and is no longer referenced; drop the licensed Tridents artwork in as `bt.png`, and set the real palette in `data/cpl_2026.json` (it still holds the Royals' pink/navy). Until then this team renders as a drawn colour badge. |
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

`barbados.png` / `barbados-white.png` are the **Visit Barbados** mark, presenting
sponsor of the power rankings. It sits bottom-right in one lockup with Willow,
separated by a hairline rule: **Willow Sports │ Barbados**. The rule is drawn as a
rect, not typed as a "|", so its weight does not follow whichever display face a
template happens to use.

Two colourways, picked automatically by the placement, not by hand:

| Placement | File used | Why |
|---|---|---|
| Dark card, night feed, keyed/transparent export, **4:5 social tile (dark)** | `barbados-white.png` | the stock wordmark is #29348F and disappears on navy |
| Light/solid plate, light 4:5 tile | `barbados.png` | white would be invisible on a pale plate |

Both PNGs are pre-rasterised from the supplied SVGs at export resolution
(2432px and 2928px wide) because the supplied white PNG is only 608px and would
soften at the 3× broadcast scale. `barbados.svg` / `barbados-white.svg` are kept
as fallbacks — the loader tries the PNG first, then the SVG, so re-supplying
either format needs no code change.

Barbados is a long horizontal wordmark (~6.5:1 after trim) against Willow's
near-square lockup (~0.94:1). It is drawn at 44% of the Willow height so their
cap-heights line up rather than their bounding boxes; matching box heights would
let the sponsor overwhelm the broadcaster. Both ratios are measured after the
auto-crop at load time, so re-supplied artwork re-sizes itself.

The TV deliverable still ships with **no** lockup at all (the `noWillow` path):
on air the channel's own bug already occupies that corner.
`cpl.png` is optional: supply it for a league mark top-left on the CPL template,
otherwise the league's short code runs ahead of the title ("CPL POWER RANKINGS").

`qr.png` is now a real, verified QR encoding `https://www.champhunt.com/cpl`
(error-correction level H, 2-module quiet zone). It is deliberately NOT run
through the auto-crop that trims the other marks — cropping would eat the quiet
zone and stop it scanning. Regenerate it if the destination URL ever changes.

`CPL logo.jpeg` is the league mark shown top-left on both templates. It arrives as
a JPEG on a white field, so at load time the white background is flood-filled from
the border to transparent (a global white-key would punch holes through the star's
white gaps), then trimmed. On dark placements its near-black wordmark is lifted to
white so the mark stays visible without a plate behind it. A transparent PNG named
`cpl.png` takes precedence if you ever supply one.

`cpl.png` / `cpl-dark.png` are the exported results of that process, saved so the
transparent artwork exists as a file rather than only at runtime. `cpl.png` is the
keyed, trimmed mark (RGBA, transparent background); `cpl-dark.png` is the same
with the wordmark lifted to white for dark placements. `cpl.png` takes precedence
over the JPEG on load.

Note on the lift: it is confined to the text BELOW the emblem. The CPL badge
contains a dark batsman silhouette inside a light globe, and lifting every dark
pixel turned that white and erased it. The boundary is found from the artwork —
the first fully-transparent row-gap under the topmost content block — so it is not
hardcoded to this particular logo.

## Barbados: the rename

The franchise became the **Barbados Tridents** in May 2026, so `data/cpl_2026.json`
asks for `bt.png`. That file is now present and `br.png` — the old Royals crown —
is no longer referenced by any team.

The palette moved with it, to the Tridents' blue and gold (`#0057A8` / `#F5C518`).
Those two values were read off the supplied artwork rather than a brand sheet, so
treat them as provisional until someone confirms them against a brand guide.

**The crest arrived on a white field and was keyed before being committed.** Team
crests are inlined exactly as supplied and are **not** background-keyed at load
time — only the CPL league mark is — so a logo on a white square renders as a white
square on the navy card and over a keyed feed. Every crest in this folder now ships
on alpha. The key was a border flood-fill (never a global white-to-transparent,
which would punch through any white enclosed by the artwork), followed by a trim to
the true bounding box: 500x500 on a white field became 371x449 on alpha.
