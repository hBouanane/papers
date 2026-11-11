// Small line icons, drawn with the text colour. icon("close") gives the SVG; iconButton() a button that shows only
// the icon, with its name as the tooltip and for screen readers.
const PATHS = {
  close: `<path d="M6 6l12 12M18 6 6 18"/>`,
  plus: `<path d="M12 5v14M5 12h14"/>`,
  expand: `<path d="M14 4h6v6M20 4l-7 7M10 20H4v-6M4 20l7-7"/>`,
  wider: `<path d="M9 6 3 12l6 6M3 12h18"/><path d="M21 5v14"/>`,
  narrower: `<path d="M13 6l6 6-6 6M3 12h16"/><path d="M21 5v14"/>`,
  copy: `<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>`,
  retry: `<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>`,
  note: `<path d="M5 4h14v11l-5 5H5z"/><path d="M14 20v-5h5"/>`,
  listen: `<path d="M4 10v4h4l5 4V6L8 10z"/><path d="M16.5 9a4 4 0 0 1 0 6M19 6.5a8 8 0 0 1 0 11"/>`,
  send: `<path d="M12 19V5M6 11l6-6 6 6"/>`,
  stop: `<rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor"/>`,
  edit: `<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>`,
  trash: `<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>`,
  play: `<path d="M8 5v14l11-7z" fill="currentColor"/>`,
  pause: `<path d="M8 5v14M16 5v14"/>`,
  history: `<path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 5v4h4M12 8v4l3 2"/>`,
};

export const icon = (name, size = 16) => `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor"
  stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name] || ""}</svg>`;

// attrs: extra HTML attributes as a string (id, data-..., class names go in `cls`)
export const iconButton = (name, label, { cls = "", attrs = "", size = 16 } = {}) =>
  `<button type="button" class="icon-button ${cls}" title="${label}" aria-label="${label}" ${attrs}>${icon(name, size)}</button>`;
