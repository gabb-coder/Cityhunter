// Sending problem reports.
//
// A report is the text js/diag.js builds: connection, GPS and error events,
// with no positions, PINs or chat. It can reach the people who run the game
// in two ways:
//
//   by hand         "Send report" in the report window
//   automatically   when something goes wrong (an error, a failed join, a
//                   long disconnection, a match lost with its host, falling
//                   back to the relay), but only once the player has said
//                   yes. They are asked once, never in the middle of a match.
//
// Reports go to an insert-only table (CONFIG.reports): phones can add a row,
// nothing can be read back with the public key.

import { $, store, uid } from './util.js';
import { CONFIG } from './config.js';
import { buildReport, note } from './diag.js';
import { app } from './state.js';
import { act, openModal, closeModal, screen, render } from './ui/core.js';

const RP = CONFIG.reports;
const CONSENT_KEY = 'ch2.reports';      // 'on' | 'off'
const DEVICE_KEY = 'ch2.device';
const SENT_KEY = 'ch2.reports.sent';

const pending = new Set();
const doneThisSession = new Set();
let asked = false;

export const reportsOn = () => !!(RP.enabled && RP.url);
export const consent = () => store.get(CONSENT_KEY, null);
export function setConsent(on) {
  store.set(CONSENT_KEY, on ? 'on' : 'off');
  if (on) flush();
  else pending.clear();
  render();
}

// A random id, so several reports from one phone can be told apart from
// reports from several phones. It says nothing about who the player is.
function device() {
  let id = store.get(DEVICE_KEY, null);
  if (!id) {
    id = uid(12);
    store.set(DEVICE_KEY, id);
  }
  return id;
}

function underDailyLimit() {
  const day = Date.now() - 24 * 3600 * 1000;
  return (store.get(SENT_KEY, []) || []).filter((t) => t > day).length < RP.maxPerDay;
}

export async function sendReport(reason, { manual = false } = {}) {
  if (!reportsOn()) return false;
  if (!manual && (consent() !== 'on' || !underDailyLimit() || doneThisSession.has(reason))) return false;
  doneThisSession.add(reason);
  const s = app.session && app.session.snap;
  let ok = false;
  try {
    const body = (await buildReport()).slice(0, RP.maxChars);
    const res = await fetch(RP.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: RP.key, Authorization: 'Bearer ' + RP.key, Prefer: 'return=minimal' },
      body: JSON.stringify({ app_version: CONFIG.version, reason: String(reason).slice(0, 60), lobby: s ? s.code : null, device: device(), body })
    });
    ok = res.ok;
  } catch (e) {
    ok = false;
  }
  if (ok) {
    const day = Date.now() - 24 * 3600 * 1000;
    store.set(SENT_KEY, (store.get(SENT_KEY, []) || []).filter((t) => t > day).concat(Date.now()));
  }
  note('report', (ok ? 'sent: ' : 'not sent: ') + reason);
  return ok;
}

// ---- automatic ----
function queue(reason) {
  if (!reportsOn() || consent() === 'off' || app.practice) return;
  pending.add(reason);
  flush();
}

async function flush() {
  if (!pending.size) return;
  if (consent() === 'on') {
    const list = Array.from(pending);
    pending.clear();
    for (const reason of list) await sendReport(reason);
    return;
  }
  // Not decided yet: ask once, away from the match.
  if (asked || !['home', 'lobby', 'results'].includes(screen()) || !$('#modal').hidden || app.ui.joining) return;
  asked = true;
  openModal(
    '<h2>Send problem reports?</h2>' +
    '<p class="muted">Something just went wrong on this phone. City Hunter can send a short report to the people who run the game when that happens, so they can fix it.</p>' +
    '<p class="muted">A report is a log of connection, GPS and error events. It has no positions, PINs or chat.</p>' +
    '<button type="button" class="btn btn-lime" data-act="reports-yes">Yes, send reports</button>' +
    '<button type="button" class="btn btn-quiet" data-act="reports-no">No thanks</button>');
}

act('reports-yes', () => {
  closeModal();
  setConsent(true);
});
act('reports-no', () => {
  closeModal();
  setConsent(false);
});
act('reports-toggle', () => setConsent(consent() !== 'on'));

window.addEventListener('error', () => queue('error'));
window.addEventListener('unhandledrejection', () => queue('error'));
app.bus.on('join-failed', () => queue('join-failed'));
app.bus.on('relay-used', () => queue('relay'));
app.bus.on('screen', () => setTimeout(flush, 600));

// A long disconnection, or a match lost because its host never came back.
setInterval(() => {
  const sess = app.session;
  if (!sess || !sess.snap) return;
  if (sess.abandoned) return queue('host-lost');
  const st = sess.link.state;
  if (st.status === 'reconnecting' && st.downSince && Date.now() - st.downSince > RP.netLostSec * 1000) queue(st.cause === 'host' ? 'host-offline' : 'connection-lost');
}, 5000);

app.reports = { send: sendReport, consent, setConsent, pending };
