// Geometry for play zones. A zone is a circle { lat, lng, r } or, when the
// host drew it, the same plus `poly`: a list of [lat, lng] corners. For a
// drawn zone lat/lng is its centre and r the distance to its farthest
// corner, so everything that only needs "roughly where and how big" (framing
// the map, saving tiles) keeps working.
//
// Corners are turned into flat metres around a nearby point. At the size of
// a play zone the error is a few centimetres.

import { dist, bearing } from './util.js';

const M = 111320;

const toXY = (o, lat, lng) => ({ x: (lng - o.lng) * M * Math.cos((o.lat * Math.PI) / 180), y: (lat - o.lat) * M });
const fromXY = (o, x, y) => ({ lat: o.lat + y / M, lng: o.lng + x / (M * Math.cos((o.lat * Math.PI) / 180)) });
const origin = (poly) => ({ lat: poly[0][0], lng: poly[0][1] });
const xy = (poly, o = origin(poly)) => poly.map((p) => toXY(o, p[0], p[1]));

// Area in square metres (always positive).
export function polyArea(poly) {
  const p = xy(poly);
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const q = p[(i + 1) % p.length];
    a += p[i].x * q.y - q.x * p[i].y;
  }
  return Math.abs(a) / 2;
}

// Centre of the shape (not just the average of its corners).
export function polyCentre(poly) {
  const o = origin(poly);
  const p = xy(poly, o);
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < p.length; i++) {
    const q = p[(i + 1) % p.length];
    const f = p[i].x * q.y - q.x * p[i].y;
    a += f;
    cx += (p[i].x + q.x) * f;
    cy += (p[i].y + q.y) * f;
  }
  if (Math.abs(a) < 1e-6) return { lat: o.lat, lng: o.lng };
  return fromXY(o, cx / (3 * a), cy / (3 * a));
}

export const polyRadius = (c, poly) => Math.max(...poly.map((p) => dist(c, { lat: p[0], lng: p[1] })));

// The same shape, k times the size, about the point c.
export function scalePoly(poly, c, k) {
  return poly.map((p) => [+(c.lat + (p[0] - c.lat) * k).toFixed(6), +(c.lng + (p[1] - c.lng) * k).toFixed(6)]);
}

export function inPoly(pt, poly) {
  const o = origin(poly);
  const p = xy(poly, o);
  const t = toXY(o, pt.lat, pt.lng);
  let inside = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    if ((p[i].y > t.y) !== (p[j].y > t.y) && t.x < ((p[j].x - p[i].x) * (t.y - p[i].y)) / (p[j].y - p[i].y) + p[i].x) inside = !inside;
  }
  return inside;
}

// Nearest point on the outline: { lat, lng, d } with d in metres.
export function nearestOnPoly(pt, poly) {
  const o = origin(poly);
  const p = xy(poly, o);
  const t = toXY(o, pt.lat, pt.lng);
  let best = null;
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = dx * dx + dy * dy;
    const u = len ? Math.max(0, Math.min(1, ((t.x - a.x) * dx + (t.y - a.y) * dy) / len)) : 0;
    const x = a.x + u * dx, y = a.y + u * dy;
    const d = Math.hypot(t.x - x, t.y - y);
    if (!best || d < best.d) best = { x, y, d };
  }
  return { ...fromXY(o, best.x, best.y), d: best.d };
}

// Do any two sides cross? (A shape drawn in the wrong corner order.)
export function selfCrossing(poly) {
  const p = xy(poly);
  const n = p.length;
  const side = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (j === i || (j + 1) % n === i || (i + 1) % n === j) continue;   // neighbours share a corner
      const a = p[i], b = p[(i + 1) % n], c = p[j], d = p[(j + 1) % n];
      if (side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0) return true;
    }
  }
  return false;
}

// A list of corners from another phone: tidy it, or null if it is not usable.
export function cleanPoly(raw, { maxCorners, minAreaM2 = 0, maxSpanM = 10000 }) {
  if (!Array.isArray(raw) || raw.length < 3 || raw.length > maxCorners) return null;
  const poly = [];
  for (const p of raw) {
    if (!Array.isArray(p)) return null;
    const lat = Number(p[0]), lng = Number(p[1]);
    if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 85 || Math.abs(lng) > 180) return null;
    poly.push([+lat.toFixed(6), +lng.toFixed(6)]);
  }
  const c = polyCentre(poly);
  if (polyRadius(c, poly) * 2 > maxSpanM || polyArea(poly) < minAreaM2 || selfCrossing(poly)) return null;
  return poly;
}

// ---- zones (circle or drawn) ----
export const zoneContains = (z, pt) => (z.poly ? inPoly(pt, z.poly) : dist(pt, z) <= z.r);

// For someone at `pt`: the nearest point of the zone's edge, how far it is
// (negative when they are inside), and which way to walk to reach it.
export function zoneEdge(z, pt) {
  if (z.poly) {
    const n = nearestOnPoly(pt, z.poly);
    const inside = inPoly(pt, z.poly);
    return { d: inside ? -n.d : n.d, edge: { lat: n.lat, lng: n.lng }, brg: bearing(pt, inside ? z : n), out: !inside };
  }
  const d = dist(pt, z) - z.r;
  const b = bearing(z, pt);
  const a = (b * Math.PI) / 180;
  const edge = { lat: z.lat + (z.r * Math.cos(a)) / M, lng: z.lng + (z.r * Math.sin(a)) / (M * Math.cos((z.lat * Math.PI) / 180)) };
  return { d, edge, brg: bearing(pt, z), out: d > 0 };
}
