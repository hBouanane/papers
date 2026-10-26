# Design system

The look comes from the desk where papers get read: a printed page on a grey desk,
royal-blue ink for notes, and a yellow highlighter for the passages you are stuck on.
Keep to these rules so the UI doesn't drift back to generic defaults.

## Palette

| Token         | Light     | Dark      | Use |
|---------------|-----------|-----------|-----|
| `--desk`      | `#ECEEF1` | `#16181C` | app background |
| `--sheet`     | `#FFFFFF` | `#1F2228` | panels, the reading page |
| `--graphite`  | `#262A31` | `#E7E9ED` | text |
| `--pencil`    | `#666D78` | `#9BA2AD` | secondary text, borders at 30% |
| `--ink`       | `#1D3FBB` | `#8EA6FF` | links, primary actions, progress |
| `--highlight` | `#FFE45C` | `#E9CF45` | selections, explained passages, "Reading" state (always with graphite text) |
| `--done`      | `#1D7A4E` | `#5CC994` | finished papers, good grades |

No gradients, no purple, no cream. Yellow is only ever a highlight behind text, never text itself.

## Type

- **Atkinson Hyperlegible Next** for the interface. Headings 800, body 400. No middle weights for emphasis.
- **STIX Two Text** for paper titles and paper text. It is the face scientific journals use, so the reading
  view looks like the paper.
- Sentence case everywhere. No all-caps labels, no letter-spacing tricks.
- Author lines use citation style: "Vaswani et al. (2017)". No middle-dot meta strings.

## Icons

Phosphor, bold weight, only where the icon tells you something (nav, status, actions). No decorative icons,
no trailing arrows on links.

## Components

- Panels: white sheet, 8px radius, 1px border, no drop shadows (except floating UI: popover, side panel, toast).
- Buttons: 6px radius, 38px tall. Primary = ink, secondary = sheet with border, quiet = text only.
- Status chips: icon + label. "Reading" is highlighted yellow; "Read" is green; others neutral.
- Progress: 6px bar in ink, on a pencil-tinted track.
- Highlights: `<mark>` with the highlighter colour for quoted passages and the skim verdict.
  No coloured left-border blocks.

## Motion

Only in response to the reader: the side panel slides in, and an explained passage gets highlighted.
Respect `prefers-reduced-motion`.
