# Design system

A quiet, text-first tool for reading papers: a printed page on a grey desk, with blue ink as the
only accent. The interface should get out of the way of the papers.

## Palette

Surfaces go by depth. In light mode the page is grey and cards are white; in dark mode each layer
is a little lighter than the one below it, so raised things look raised (not like holes).

| Token          | Light     | Dark      | Use |
|----------------|-----------|-----------|-----|
| `--desk`       | `#ECEEF1` | `#0F1115` | page background |
| `--sheet`      | `#FFFFFF` | `#171A1F` | cards, the reading page |
| `--raised`     | `#F1F3F6` | `#20242B` | areas inside cards (callouts, chips, hovers, Claude's answers) |
| `--field`      | `#FFFFFF` | `#121418` | text inputs (a little below the card in dark mode) |
| `--pop`        | `#262A31` | `#2A2F38` | toasts, the selection toolbar |
| `--selected`   | `#262A31` | `#2F3540` | the selected option in a segmented control |
| `--graphite`   | `#262A31` | `#E4E7EB` | text |
| `--reading`    | `#262A31` | `#D5D9DF` | paper text (slightly softer in dark mode to reduce glare) |
| `--pencil`     | `#666D78` | `#98A0AB` | secondary text |
| `--ink`        | `#1D3FBB` | `#93A9F8` | links, highlights, progress, focus |
| `--ink-fill`   | `#1D3FBB` | `#3C5ED8` | primary buttons (always with white text) |
| `--ink-tint`   | `#E8ECFA` | `#1E2640` | the "Reading" chip, your messages in Ask |
| `--done`       | `#1D7A4E` | `#5CC48E` | finished papers, good grades |

Never use a light tint as a button fill in dark mode, and never invert the text colour into a
background (it turns into a white blob in dark mode); use `--pop` and `--selected`.
PDF pages follow the theme by default (white in light mode, dark in dim and dark mode). In the reader bar, Pages offers white, dimmed or dark (sun, half circle, moon, with a sliding knob); `d` flips dark. Picking a theme hands the pages back to it. Dark pages are redrawn by PDF.js with light text on a dark page (the card colour in dim and dark mode, dark grey in light mode); photos keep their colours.

## Type

- **Atkinson Hyperlegible Next** for the interface. Headings 800, body 400.
- **STIX Two Text** for paper titles and paper text, so the reader looks like the paper.
- Quotes from a paper (where you stopped, passages you asked about) are STIX italic in `--pencil`.
- Sentence case everywhere. No all-caps labels.
- Author lines use citation style: "Vaswani et al. (2017)".

## Icons

None. Labels are words. The only glyph is the back chevron in the reader bar, drawn as an inline SVG.

## Components

- Panels: white sheet, 8px radius, 1px border, no drop shadows (except floating UI: popover, side panel, toast).
- Buttons: 6px radius, 38px tall. Primary = ink, secondary = sheet with border, quiet = text only.
- Status chips: text only. "Reading" is ink on ink-tint, "Read" is green, the rest neutral.
- Progress: 6px bar in ink.
- Passages you asked to have explained get a 2px ink underline in the text.
- Quiz grades: a small coloured score pill next to the feedback.

## Motion

Only the side panel slides in. Respect `prefers-reduced-motion`.
