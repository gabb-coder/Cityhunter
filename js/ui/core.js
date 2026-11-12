// UI plumbing: click actions, screens, layers, toasts, the modal picker.

import { $, esc, setHTML } from '../util.js';
import { icon } from '../icons.js';
import { app } from '../state.js';
import { theme } from '../theme.js';

// ---- actions: <button data-act="name"> ----
const actions = {};
export function act(name, fn) {
  actions[name] = fn;
}

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled || el.getAttribute('aria-disabled') === 'true') return;
  const fn = actions[el.dataset.act];
  if (!fn) return;
  e.preventDefault();
  fn(el, e);
});

// ---- render loop ----
const renderers = [];
const tickers = [];
export const onRender = (fn) => renderers.push(fn);
export const onTick = (fn) => tickers.push(fn);

let queued = false;
export function render() {
  if (queued) return;
  queued = true;
  queueMicrotask(() => {
    queued = false;
    for (const fn of renderers) {
      try {
        fn();
      } catch (e) {
        console.error('render', e);
      }
    }
    tick();
  });
}

// Clocks and countdowns only; runs 4x a second.
export function tick() {
  for (const fn of tickers) {
    try {
      fn();
    } catch (e) {
      console.error('tick', e);
    }
  }
}
setInterval(tick, 250);

// ---- screens and layers ----
const SCREENS = ['home', 'lobby', 'reveal', 'game', 'results'];
const LAYERS = ['shop', 'chat', 'catch', 'tagged', 'converted', 'admin'];
let current = null;

export function showScreen(name) {
  if (current === name) return;
  current = name;
  for (const s of SCREENS) $('#s-' + s).hidden = s !== name;
  app.bus.emit('screen', name);
}
export const screen = () => current;

export function setLayer(name) {
  if (app.ui.layer === name) return;
  const prev = app.ui.layer;
  app.ui.layer = name;
  for (const l of LAYERS) $('#s-' + l).hidden = l !== name;
  app.bus.emit('layer', name, prev);
  render();
}

// ---- toasts ----
export function toast(text, tone = '', ms = 3800) {
  const box = $('#toasts');
  const el = document.createElement('div');
  el.className = 'toast ' + tone;
  el.innerHTML = (tone === 'hunter' ? icon('warn', 20, 2.5) : '') + '<span>' + esc(text) + '</span>';
  box.appendChild(el);
  while (box.children.length > 3) box.firstChild.remove();
  setTimeout(() => el.remove(), ms);
}

// ---- modal ----
export function openModal(html) {
  const m = $('#modal');
  m.__html = null;
  setHTML(m, '<div class="modal-card" role="dialog" aria-modal="true">' + html + '</div>');
  m.hidden = false;
  const first = m.querySelector('button, input');
  if (first) first.focus({ preventScroll: true });
}
export function closeModal() {
  $('#modal').hidden = true;
}
$('#modal').addEventListener('click', (e) => {
  if (e.target.id === 'modal') closeModal();
});
act('modal-close', closeModal);

// Ask before something that cannot be undone.
export function confirmModal({ title, body, yes, tone = 'btn-lime' }, onYes) {
  openModal(
    '<h2>' + esc(title) + '</h2>' +
    (body ? '<p class="muted">' + esc(body) + '</p>' : '') +
    '<button type="button" class="btn ' + tone + '" data-act="modal-yes">' + esc(yes) + '</button>' +
    '<button type="button" class="btn btn-quiet" data-act="modal-close">Cancel</button>'
  );
  act('modal-yes', () => {
    closeModal();
    onYes();
  });
}

// ---- theme toggle (used on Home and both map screens) ----
export function themeButton(extraClass = '') {
  return '<button type="button" class="icon-btn ' + extraClass + '" data-act="theme" aria-label="' +
    theme.nextLabel() + '">' + icon(theme.nextIcon(), 22) + '</button>';
}
act('theme', () => theme.toggle());
theme.on('change', render);

export const roleName = (role) => (role === 'hunter' ? 'HUNTER' : 'PREY');
export const roleChip = (role, cls = '') =>
  '<span class="chip chip-' + role + ' ' + cls + '">' + roleName(role) + '</span>';
