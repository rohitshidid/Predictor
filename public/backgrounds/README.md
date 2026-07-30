# Broadcast backdrop drop-in folder

Stills used by the **1080p frame** export, which composites the keyed overlay onto
a photograph and gives you the finished 1920×1080 picture rather than a bare table
the gallery has to lay up itself.

Drop a `.png`, `.jpg`, `.jpeg` or `.webp` in here and it appears in the **Backdrop**
picker on the next page load — no code change. With the folder empty the frame
button is disabled and says so, rather than exporting a table on black.

## What makes a good still

- **1920×1080 or larger.** Smaller images are scaled up and go soft.
- **Landscape.** The still is *cover*-fitted — scaled to fill the frame and cropped,
  never letterboxed — so an aspect far from 16:9 loses more off the sides.
- **Quiet through the middle.** The table sits centred and occupies roughly the
  middle 60% of the width and 83% of the height. A still whose subject is dead
  centre will be covered by it.
- **Darker rather than brighter.** The overlay's row plates are translucent dark
  with white type. Over a bright sky the type still carries — the drop shadow is
  there for exactly that — but a night or dusk frame reads best.

## Naming

Anything readable. The filename is what shows in the picker, so name stills for
what they are: `mcg-dusk.jpg`, `providence-night.jpg`, `generic-wide.png`.

> Match photography is almost always **third-party licensed material**. Only add
> stills you hold the rights to use in a broadcast or published graphic — the same
> rule the team logos in `../logos/` are under.

## How the composite is built

`downloadFrame()` in `public/index.html`:

1. Draws the backdrop cover-fitted into 1920×1080.
2. Renders the **transparent** build of the current template at frame resolution —
   the vector is rasterized at its true target size, so the type is sharp rather
   than being scaled up from a small bitmap.
3. Centres the overlay with an 8.5% inset top and bottom.

Both templates work. The Willow overlay is the intended one; the CPL card also
composites, in its translucent-navy mode.
