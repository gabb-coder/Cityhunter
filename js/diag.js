// Problem report.
//
// Keeps a short rolling log of what happened on this phone (connection,
// GPS, errors, screens) and turns it into text a player can send. It never
// records positions, PINs or chat text.

import { CONFIG } from './config.js';
import { app } from './state.js';
import { theme } from './theme.js';

const MAX = 250;
const log = [];
const started = Date.now();

export function note(kind, text) {
  log.push([Date.now(), kind, String(text).slice(0, 180)]);
  if (log.length > MAX) log.shift();
}

window.addEventListener('error', (e) => note('error', (e.message || 'error') + ' @ ' + String(e.filename || '').split('/').pop() + ':' + (e.lineno || 0)));
window.addEventListener('unhandledrejection', (e) => note('error', 'promise: ' + ((e.reason && e.reason.message) || e.reason)));
window.addEventListener('online', () => note('net', 'browser online'));
window.addEventListener('offline', () => note('net', 'browser offline'));
document.addEventListener('visibilitychange', () => note('app', 'page ' + document.visibilityState));

app.geo.on('status', (s) => note('gps', s + (app.geo.fix ? ' ±' + app.geo.fix.acc + ' m' : '')));
app.bus.on('screen', (name) => note('app', 'screen ' + name));
app.bus.on('layer', (name) => name && note('app', 'layer ' + name));
app.bus.on('joined', (info) => note('game', (info.host ? 'hosting ' : 'joined ') + info.code));
app.bus.on('cleanup', () => note('game', 'left'));
app.bus.on('join-failed', () => note('game', 'join failed'));
app.bus.on('cue', (name) => note('cue', name));
app.bus.on('session', (session) => {
  session.on('link', (st) => note('net', st.status + (st.cause ? ' cause=' + st.cause : '') + (st.attempt ? ' attempt=' + st.attempt : '') + (st.error ? ' error=' + st.error : '')));
  session.on('phase', (now, was) => note('game', 'phase ' + was + ' -> ' + now));
  session.on('role', (now, was) => note('game', 'role ' + was + ' -> ' + now));
  session.on('reject', (why) => note('game', 'rejected: ' + why));
  session.on('bye', (why) => note('game', 'bye: ' + why));
  session.on('event', (e) => e.type !== 'toast' && note('event', e.type));
});

const stamp = (t) => {
  const s = Math.max(0, (t - started) / 1000);
  return '+' + String(Math.floor(s / 60)).padStart(2, '0') + ':' + (s % 60).toFixed(1).padStart(4, '0');
};

async function permission(name) {
  try {
    return (await navigator.permissions.query({ name })).state;
  } catch (e) {
    return 'unknown';
  }
}

// The whole report as plain text.
export async function buildReport() {
  const s = app.session && app.session.snap;
  const geo = app.geo;
  const conn = navigator.connection || {};
  const out = [];
  const add = (k, v) => out.push(k + ': ' + v);

  out.push('CITY HUNTER PROBLEM REPORT');
  add('time', new Date().toISOString());
  add('version', CONFIG.version + ' (protocol ' + CONFIG.protocol + ')');
  add('page', location.host + location.pathname);
  add('browser', navigator.userAgent);
  add('screen', innerWidth + 'x' + innerHeight + ' @' + (devicePixelRatio || 1) + 'x');
  add('language', (document.documentElement.lang || 'en') + ' (device ' + navigator.language + ')');
  add('theme', theme.get());
  add('installed', String(window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true));
  add('service worker', navigator.serviceWorker && navigator.serviceWorker.controller ? 'active' : 'none');
  add('online', String(navigator.onLine) + (conn.effectiveType ? ' (' + conn.effectiveType + ')' : ''));
  add('location permission', await permission('geolocation'));
  add('microphone permission', await permission('microphone'));
  add('screen kept awake', String(app.wakeHeld ? app.wakeHeld() : false));
  add('sound', String(app.sound ? app.sound.on : '?'));
  add('battery saver', String(app.saver ? app.saver.on : false));

  out.push('', 'GPS');
  add('status', geo.status);
  add('accuracy', geo.fix ? '±' + geo.fix.acc + ' m' : 'no fix');
  add('seconds since last fix', geo.fix ? ((Date.now() - geo.fix.at) / 1000).toFixed(1) : 'never');
  add('compass', geo.compass == null ? 'no reading' : 'ok');
  add('simulated', String(!!geo.simulated));

  out.push('', 'MATCH');
  if (!s) add('state', 'not in a lobby');
  else {
    const link = app.session.link.state;
    add('lobby', s.code + (app.practice ? ' (practice)' : ''));
    add('me', s.me.name + ' / ' + s.me.role + (s.me.host ? ' / host' : ''));
    add('phase', s.phase + (s.paused ? ' (paused: ' + s.pauseReason + ')' : ''));
    add('players', s.players.length + ' (' + s.players.filter((p) => p.conn).length + ' connected)');
    add('link', link.status + (link.cause ? ' cause=' + link.cause : '') + ' attempts=' + link.attempt);
    add('seconds since host heard', ((performance.now() - app.session.recvAt) / 1000).toFixed(1));
    if (app.host && app.net) add('host signalling', String(app.net.signal));
    if (s.admin) for (const p of s.admin) out.push('  ' + p.name + ': ' + p.role + (p.conn ? '' : ' OFFLINE') + ' gpsAge=' + p.gpsAge + ' acc=' + p.acc + (p.jumps ? ' jumps=' + p.jumps : ''));
  }

  out.push('', 'LOG (' + log.length + ' entries, time since page load)');
  for (const [t, kind, text] of log) out.push(stamp(t) + ' ' + kind.padEnd(5) + ' ' + text);
  return out.join('\n');
}

app.diag = { note, buildReport, log };
