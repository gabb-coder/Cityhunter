// Text chat (team channel + everyone) with push-to-talk next to the input.

import { $, esc, setHTML, clock } from '../util.js';
import { icon } from '../icons.js';
import { CONFIG } from '../config.js';
import { app, snap } from '../state.js';
import { act, onRender, render, setLayer } from './core.js';

const root = $('#s-chat');
let built = false;

function build() {
  built = true;
  root.innerHTML =
    '<div class="chat-backdrop" data-act="layer-close"></div>' +
    '<div class="chat-panel" role="dialog" aria-modal="true" aria-labelledby="chat-title">' +
      '<header class="chat-head">' +
        '<h1 class="head" id="chat-title">CHAT</h1>' +
        '<button type="button" class="icon-btn sm" data-act="layer-close" aria-label="Close chat">' + icon('x', 20, 2.5) + '</button>' +
      '</header>' +
      '<div class="tabs" role="group" aria-label="Channel" id="chat-tabs"></div>' +
      '<ol class="scroll chat-list" id="chat-list" aria-live="polite"></ol>' +
      '<form class="chat-form" id="chat-form">' +
        '<button type="button" class="icon-btn ptt" data-ptt aria-pressed="false" aria-label="Hold to talk to your team">' + icon('mic', 22) + '</button>' +
        '<input id="chat-input" class="chat-input" aria-label="Message" placeholder="Message" maxlength="' + CONFIG.chat.maxLength + '" autocomplete="off" enterkeyhint="send">' +
        '<button type="submit" class="icon-btn send" aria-label="Send message">' + icon('send', 22) + '</button>' +
      '</form>' +
    '</div>';
  $('#chat-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('#chat-input');
    const text = input.value.trim();
    if (!text) return;
    app.session.send({ k: 'chat', ch: app.ui.chatTab, text });
    input.value = '';
  });
}

function renderChat() {
  const s = snap();
  if (app.ui.layer !== 'chat' || !s) return;
  if (!built) build();
  const sess = app.session;
  const inMatch = sess.inMatch;
  const tab = inMatch ? app.ui.chatTab : 'all';
  const role = s.me.role;
  const teamName = role === 'hunter' ? 'Hunter chat' : 'Prey chat';
  sess.chatOpen = tab;
  sess.unread[tab] = 0;

  const badge = (n) => (n ? '<span class="badge">' + n + '</span>' : '');
  setHTML($('#chat-tabs'), inMatch
    ? '<button type="button" class="tab ' + role + '" data-act="chat-tab" data-tab="team" aria-pressed="' + (tab === 'team') + '">' + teamName + badge(sess.unread.team) + '</button>' +
      '<button type="button" class="tab all" data-act="chat-tab" data-tab="all" aria-pressed="' + (tab === 'all') + '">Everyone' + badge(sess.unread.all) + '</button>'
    : '');
  $('#chat-tabs').hidden = !inMatch;

  const list = sess.chat[tab];
  const html = list.length
    ? list.map((m) => '<li class="msg' + (m.from === sess.id ? ' mine' : '') + '">' +
        '<span class="msg-meta"><span class="mono ' + (m.role === 'hunter' ? 'hunter-ink' : 'prey-ink') + '">' + esc(m.name) + '</span>' +
        '<span class="muted">' + clock(Math.max(0, (m.T - s.headT) / 1000)) + '</span></span>' +
        '<span class="msg-text">' + esc(m.text) + '</span></li>').join('')
    : '<li class="chat-empty muted">' + (tab === 'team' ? 'Only your side can read this channel.' : 'Everyone in the match can read this channel.') + '</li>';
  const box = $('#chat-list');
  if (setHTML(box, html)) box.scrollTop = box.scrollHeight;
  for (const el of root.querySelectorAll('[data-ptt]')) el.hidden = !inMatch;
}

act('chat-tab', (el) => {
  app.ui.chatTab = el.dataset.tab;
  render();
});

app.bus.on('layer', (name, prev) => {
  if (prev === 'chat' && app.session) app.session.chatOpen = null;
  if (name === 'chat') setTimeout(() => { const b = $('#chat-list'); if (b) b.scrollTop = b.scrollHeight; }, 0);
});
app.bus.on('session', (session) => session.on('chat', render));
onRender(renderChat);
