// Push-to-talk voice.
//
// While the button is held, the talker opens a one-way WebRTC audio call to
// every connected teammate and closes it on release. Teammate peer IDs come
// from the host, which only hands them to players on the same side, and an
// incoming call is only answered if the caller is on that list.

import { $, buzz } from './util.js';
import { app } from './state.js';
import { render, toast } from './ui/core.js';

const calls = new Set();     // outgoing
let stream = null;
let holding = false;
let boundPeer = null;

function mates() {
  const s = app.session && app.session.snap;
  if (!s) return [];
  return s.players.filter((p) => !p.you && p.peer && p.conn && !p.dropped && p.role === s.me.role);
}

function onCall(call) {
  const from = mates().find((p) => p.peer === call.peer);
  if (!from) return call.close();
  call.answer();
  const audio = document.createElement('audio');
  audio.autoplay = true;
  audio.playsInline = true;
  $('#voice-audio').appendChild(audio);
  const end = () => {
    audio.remove();
    if (app.ui.talking === from.name) app.ui.talking = null;
    render();
  };
  call.on('stream', (remote) => {
    audio.srcObject = remote;
    audio.play().catch(() => {});
    app.ui.talking = from.name;
    render();
  });
  call.on('close', end);
  call.on('error', end);
  setTimeout(() => !audio.srcObject && end(), 8000);
}

function bind(peer) {
  if (!peer || peer === boundPeer) return;
  boundPeer = peer;
  peer.on('call', onCall);
}

function setPressed(on, text) {
  for (const el of document.querySelectorAll('[data-ptt]')) {
    el.setAttribute('aria-pressed', String(on));
    const t = el.querySelector('.ptt-text');
    if (t) t.textContent = text;
  }
}

async function start() {
  if (holding || !app.session || !app.session.inMatch) return;
  const peer = app.session.link.peer;
  const targets = mates();
  if (!peer || !peer.open) return toast('Voice is reconnecting');
  if (!targets.length) return toast('No teammates online to hear you');
  holding = true;
  setPressed(true, 'Connecting…');
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
  } catch (e) {
    holding = false;
    setPressed(false, 'Hold to talk');
    return toast('Microphone access is needed for voice', 'hunter');
  }
  if (!holding) return release();   // let go while the permission prompt was open
  buzz(30);
  setPressed(true, 'Live…');
  for (const t of targets) {
    try {
      const call = peer.call(t.peer, stream);
      if (!call) continue;
      calls.add(call);
      call.on('close', () => calls.delete(call));
      call.on('error', () => calls.delete(call));
    } catch (e) { /* that teammate just dropped */ }
  }
}

function release() {
  holding = false;
  for (const c of calls) { try { c.close(); } catch (e) { /* gone */ } }
  calls.clear();
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = null;
  setPressed(false, 'Hold to talk');
}

// Hold-to-talk: pointer down starts, pointer up / leave / cancel stops.
document.addEventListener('pointerdown', (e) => {
  const el = e.target.closest('[data-ptt]');
  if (!el) return;
  e.preventDefault();
  try { el.setPointerCapture(e.pointerId); } catch (err) { /* older browsers */ }
  start();
});
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
  document.addEventListener(type, () => {
    if (holding) release();
  });
}
document.addEventListener('contextmenu', (e) => e.target.closest('[data-ptt]') && e.preventDefault());
// Keyboard: Space/Enter held on the focused button.
document.addEventListener('keydown', (e) => {
  if ((e.key === ' ' || e.key === 'Enter') && !e.repeat && e.target.closest && e.target.closest('[data-ptt]')) { e.preventDefault(); start(); }
});
document.addEventListener('keyup', (e) => {
  if ((e.key === ' ' || e.key === 'Enter') && holding) release();
});
document.addEventListener('visibilitychange', () => document.hidden && holding && release());

app.bus.on('session', (session) => {
  bind(session.link.peer);
  const net = app.net;
  if (net) net.on('peer', bind);
});
app.bus.on('cleanup', () => {
  release();
  boundPeer = null;
});

app.voice = { start, release, holding: () => holding };
