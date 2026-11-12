// Small shared helpers: DOM, formatting, geometry, storage.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

// Only touches the DOM when the markup really changed, so focus, scroll
// position and pressed buttons survive the 1 Hz re-render.
export function setHTML(el, html) {
  if (!el || el.__html === html) return false;
  el.__html = html;
  el.innerHTML = html;
  return true;
}

export function setText(el, text) {
  if (el && el.textContent !== text) el.textContent = text;
}

const pad = (n) => String(n).padStart(2, '0');

// 125 -> "02:05"
export function clock(sec) {
  const s = Math.max(0, Math.round(sec));
  return pad(Math.floor(s / 60)) + ':' + pad(s % 60);
}

// 120 -> "2 min", 45 -> "45 s"
export function span(sec) {
  if (sec < 60 || sec % 60) return sec < 120 ? sec + ' s' : Math.round(sec / 60) + ' min';
  return sec / 60 + ' min';
}

// age in ms -> "just now" / "40 s ago" / "2 min ago"
export function ago(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 10) return 'just now';
  if (s < 60) return s + ' s ago';
  return Math.floor(s / 60) + ' min ago';
}

export function metres(m) {
  if (m >= 1000) return (m / 1000).toFixed(1) + ' km';
  return Math.round(m) + ' m';
}

const R = 6371000;
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

// Haversine distance in metres between {lat,lng} points.
export function dist(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

// Initial bearing a -> b, degrees clockwise from north.
export function bearing(a, b) {
  const y = Math.sin(rad(b.lng - a.lng)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng - a.lng));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
export const compass = (b) => COMPASS[Math.round((((b % 360) + 360) % 360) / 45) % 8];

export const store = {
  get(key, fallback = null, area = localStorage) {
    try {
      const v = area.getItem(key);
      return v == null ? fallback : JSON.parse(v);
    } catch (e) {
      return fallback;
    }
  },
  set(key, value, area = localStorage) {
    try {
      area.setItem(key, JSON.stringify(value));
    } catch (e) { /* private mode or quota: the game still runs */ }
  },
  del(key, area = localStorage) {
    try {
      area.removeItem(key);
    } catch (e) { /* ignore */ }
  }
};

export function uid(n = 16) {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => (b % 36).toString(36)).join('');
}

// No 0/O/1/I/L so codes survive being read out loud.
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function makeCode(len) {
  const a = new Uint8Array(len);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
}

export const cleanCode = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// "K7Q2XM" -> "K7Q·2XM"
export function showCode(code) {
  const h = Math.ceil(code.length / 2);
  return code.slice(0, h) + '·' + code.slice(h);
}

export function randomDigits(n) {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b % 10).join('');
}

export function buzz(pattern) {
  try {
    if (navigator.vibrate) navigator.vibrate(pattern);
  } catch (e) { /* not supported */ }
}

export const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many || one + 's');

export function joinNames(names) {
  if (names.length <= 1) return names[0] || '';
  return names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
}

// Tiny event emitter used by the session, GPS and network layers.
export class Emitter {
  constructor() {
    this._h = {};
  }
  on(type, fn) {
    (this._h[type] = this._h[type] || []).push(fn);
    return () => this.off(type, fn);
  }
  off(type, fn) {
    this._h[type] = (this._h[type] || []).filter((f) => f !== fn);
  }
  emit(type, ...args) {
    for (const fn of (this._h[type] || []).slice()) {
      try {
        fn(...args);
      } catch (e) {
        console.error('[' + type + ']', e);
      }
    }
  }
}
