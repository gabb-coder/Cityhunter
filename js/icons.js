// Stroke SVG icons (24x24 grid). No emoji anywhere in the UI.
// All icons inherit colour from `currentColor` and are aria-hidden;
// icon-only buttons carry their own aria-label.

const P = {
  logo: '<circle cx="12" cy="12" r="7.5"/><path d="M12 1v6M12 17v6M1 12h6M17 12h6"/>',
  arrowRight: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  chevLeft: '<path d="M15 6l-6 6 6 6"/>',
  chevRight: '<path d="M9 6l6 6-6 6"/>',
  share: '<path d="M12 3v13M7 8l5-5 5 5M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="M12 12l5-3"/><circle cx="12" cy="12" r="1.5"/>',
  bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7Z"/>',
  lock: '<path d="M7 11V8a5 5 0 0 1 10 0v3"/><rect x="5" y="11" width="14" height="10" rx="2"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z"/>',
  recenter: '<circle cx="12" cy="12" r="4"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>',
  coin: '<circle cx="12" cy="12" r="9"/><path d="M15 9.5A3.5 3.5 0 1 0 15.5 14H12"/>',
  ghost: '<path d="M6 20V10a6 6 0 0 1 12 0v10l-2-1.5L14 20l-2-1.5L10 20l-2-1.5Z"/><circle cx="10" cy="11" r="1"/><circle cx="14" cy="11" r="1"/>',
  decoy: '<path d="M12 21s-6-5.5-6-11a6 6 0 0 1 12 0c0 5.5-6 11-6 11Z"/><path d="M10 9.5a2 2 0 1 1 2.8 1.8c-.5.3-.8.7-.8 1.2"/><path d="M12 15h.01"/>',
  jammer: '<path d="M12 20V11"/><circle cx="12" cy="9" r="2"/><path d="M7.5 13.5a6.5 6.5 0 0 1 0-9M16.5 4.5a6.5 6.5 0 0 1 0 9M4.5 16a10.5 10.5 0 0 1 0-14M19.5 2a10.5 10.5 0 0 1 0 14"/>',
  shield: '<path d="M12 3l8 3v6c0 4.5-3.2 7.8-8 9-4.8-1.2-8-4.5-8-9V6Z"/><path d="M9 12l2 2 4-4"/>',
  scan: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><path d="M12 12l6-6"/>',
  tracker: '<path d="M12 2l7 19-7-4-7 4Z"/>',
  radar: '<path d="M12 12L19 5"/><circle cx="12" cy="12" r="1.5"/><path d="M16.2 7.8A6 6 0 1 0 18 12M19.1 4.9A10 10 0 1 0 22 12"/>',
  lockdown: '<circle cx="12" cy="12" r="9" stroke-dasharray="3 3"/><circle cx="12" cy="12" r="4"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  chat: '<path d="M4 5h16v11H9l-5 4Z"/>',
  warn: '<path d="M12 3l10 18H2Z"/><path d="M12 10v5M12 18h.01"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2.5"/><path d="M12 1v4M12 19v4M1 12h4M19 12h4"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  backspace: '<path d="M9 5h11v14H9l-6-7Z"/><path d="M13 9l4 6M17 9l-4 6"/>',
  check: '<path d="M5 12l5 5 9-10"/>',
  noGps: '<path d="M12 21s-6-5.5-6-11a6 6 0 0 1 12 0c0 5.5-6 11-6 11Z"/><path d="M4 4l16 16"/>',
  home: '<path d="M4 11l8-7 8 7v9h-5v-6H9v6H4Z"/>',
  replay: '<path d="M4 12a8 8 0 1 0 2.6-5.9"/><path d="M4 4v5h5"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
  send: '<path d="M4 20l17-8L4 4l3 8Z"/><path d="M7 12h8"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  play: '<path d="M7 4l13 8-13 8Z"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.2a6.5 6.5 0 0 1 3.5 5.8"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>'
};

export function icon(name, size = 22, strokeWidth = 2) {
  return '<svg class="ico" aria-hidden="true" focusable="false" width="' + size + '" height="' + size +
    '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' + strokeWidth +
    '" stroke-linecap="round" stroke-linejoin="round">' + (P[name] || '') + '</svg>';
}
