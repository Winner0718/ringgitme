// Single icon family — Tabler-style 24px, stroke 2, round caps.
// Inline SVG (self-hosted, no CDN). Never use emoji as functional icons.

const P = (paths, extra = '') =>
  `<svg class="icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}${extra}</svg>`;

export const icons = {
  today: P('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
  assets: P('<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 10h18M7 15h2"/>'),
  plus: P('<path d="M12 5v14M5 12h14"/>'),
  activity: P('<path d="M3 12h4l2-7 4 14 2-7h6"/>'),
  ledger: P('<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3 2.7-5 6-5s6 2 6 5"/><circle cx="17" cy="9" r="2.4"/><path d="M17.5 14.6c2.1.5 3.5 2 3.5 4.4"/>'),
  eye: P('<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z"/><circle cx="12" cy="12" r="3"/>'),
  eyeOff: P('<path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 22 12a17 17 0 0 1-2.7 3.3M6.6 6.6A16.9 16.9 0 0 0 2 12s3.5 6 10 6a9.9 9.9 0 0 0 4.4-1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>'),
  search: P('<circle cx="10" cy="10" r="7"/><path d="m21 21-5.2-5.2"/>'),
  chevronRight: P('<path d="m9 6 6 6-6 6"/>'),
  chevronLeft: P('<path d="m15 6-6 6 6 6"/>'),
  chevronDown: P('<path d="m6 9 6 6 6-6"/>'),
  paperclip: P('<path d="M15 7 8.5 13.5a2.1 2.1 0 0 0 3 3L18 10a4.2 4.2 0 1 0-6-6L5.5 10.5a6.4 6.4 0 0 0 9 9L21 13"/>'),
  check: P('<path d="m5 12 5 5L20 7"/>'),
  x: P('<path d="M6 6l12 12M18 6 6 18"/>'),
  backspace: P('<path d="M20 6H9L4 12l5 6h11a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1z"/><path d="m12 10 4 4M16 10l-4 4"/>'),
  arrowDown: P('<path d="M12 5v14M18 13l-6 6-6-6"/>'),
  arrowUp: P('<path d="M12 19V5M6 11l6-6 6 6"/>'),
  transfer: P('<path d="M7 10h11l-3-3M17 14H6l3 3"/>'),
  calendar: P('<rect x="4" y="5" width="16" height="16" rx="2"/><path d="M8 3v4M16 3v4M4 11h16"/>'),
  note: P('<path d="M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z"/><path d="M8 9h8M8 13h6"/>'),
  camera: P('<path d="M5 8h2l1.5-2.5h7L17 8h2a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2z"/><circle cx="12" cy="13" r="3.2"/>'),
  moon: P('<path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11z"/>'),
  dots: P('<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>'),
  trend: P('<path d="M3 17l5-5 3 3 7-8"/><path d="M14 7h4v4"/>'),
  lock: P('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'),
  user: P('<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6 8-6s8 2 8 6"/>'),
  pin: P('<path d="M9 4h6l-1 7 3 2v2H7v-2l3-2-1-7z"/><path d="M12 15v6"/>'),
  radar: P('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.5"/><path d="M12 12l6-6"/>'),
  wallet: P('<path d="M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7z"/><path d="M16 12h4v4h-4a2 2 0 0 1 0-4z"/>'),
  // category icons
  food: P('<path d="M5 3v9M8 3v9M6.5 12v9M5 3c0 3 3 3 3 0"/><path d="M17 3c-2 0-3 2.5-3 5 0 2 1 3 2 3v10M17 3c2 0 2 3 2 5"/>'),
  cart: P('<circle cx="9" cy="19" r="1.6"/><circle cx="17" cy="19" r="1.6"/><path d="M3 4h2l2.2 11h10.6L20 8H6"/>'),
  car: P('<path d="M5 16H3v-4l2-5h11l3 5h2v4h-2"/><circle cx="7.5" cy="16.5" r="2"/><circle cx="16.5" cy="16.5" r="2"/><path d="M9.5 16.5h5"/>'),
  ticket: P('<path d="M4 7h16v3a2 2 0 0 0 0 4v3H4v-3a2 2 0 0 0 0-4V7z"/><path d="M13 7v2M13 15v2M13 11v2"/>'),
  receipt: P('<path d="M6 3h12v18l-2-1.5L14 21l-2-1.5L10 21l-2-1.5L6 21V3z"/><path d="M9 8h6M9 12h6"/>'),
  heart: P('<path d="M12 20s-7-4.5-9-9c-1.2-2.8.5-6 3.7-6 2 0 3.6 1.2 4.3 2.7h2C13.7 6.2 15.3 5 17.3 5c3.2 0 4.9 3.2 3.7 6-2 4.5-9 9-9 9z"/>'),
};

export function icon(name, size = 20) {
  const svg = icons[name] || icons.note;
  return size === 20 ? svg : svg.replace('width="20" height="20"', `width="${size}" height="${size}"`);
}
