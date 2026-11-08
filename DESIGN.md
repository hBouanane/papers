# Design system

A quiet, text-first tool for reading papers: a printed page on a grey desk, with blue ink as the
only accent. The interface should get out of the way of the papers.

## Palette

| Token        | Light     | Dark      | Use |
|--------------|-----------|-----------|-----|
| `--desk`     | `#ECEEF1` | `#16181C` | app background |
| `--sheet`    | `#FFFFFF` | `#1F2228` | panels, the reading page |
| `--graphite` | `#262A31` | `#E7E9ED` | text |
| `--pencil`   | `#666D78` | `#9BA2AD` | secondary text |
| `--ink`      | `#1D3FBB` | `#8EA6FF` | links, primary actions, progress, the "Reading" state |
| `--ink-tint` | `#E8ECFA` | `#252C45` | background of the "Reading" chip, text selection |
| `--done`     | `#1D7A4E` | `#5CC994` | finished papers, good grades |

One accent only. No yellow highlights, no gradients, no purple, no cream.

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
