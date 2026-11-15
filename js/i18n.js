// Languages.
//
// The UI is written in English. Instead of wrapping every string in the
// code, this module translates the page as it is drawn: a MutationObserver
// watches the app, and every piece of visible text (and aria-label,
// placeholder, title) is looked up in the active dictionary. Host messages,
// toasts and map labels are covered the same way, with no changes to them.
//
// A dictionary (js/lang/*.js) has two parts:
//   exact     { 'Lobby code': '...' }                 whole strings
//   patterns  [ ['{} is now a hunter on your side.', '...{0}...'] ]
//             {}  matches anything (names, already-formatted values); the
//                 captured part is itself translated, so units nest
//             {n} matches a number or clock
//             a third item 'inner' limits a pattern to captured parts
// Anything inside an element marked translate="no" is left alone: player
// names, chat messages, codes.
//
// To add a language: copy js/lang/zh.js, translate the right-hand sides and
// register it in LANGS below.

import { store, Emitter } from './util.js';
import { ZH } from './lang/zh.js';

const KEY = 'ch2.lang';
const LANGS = {
  en: { code: 'en', name: 'English', aria: 'Switch language to English', dict: null },
  zh: { code: 'zh', name: '中文', aria: '切换到简体中文', htmlLang: 'zh-Hans', dict: ZH }
};
const ORDER = ['en', 'zh'];
const ATTRS = ['aria-label', 'placeholder', 'title', 'alt'];
const SKIP = '[translate="no"], .leaflet-control-attribution, .smap-attr, textarea, script, style, noscript';

function initial() {
  const saved = store.get(KEY);
  if (saved && LANGS[saved]) return saved;
  return String(navigator.language || '').toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

let lang = initial();
let compiled = null;            // { exact: Map, patterns: [{ re, out, lit }] }
const cache = new Map();
const missing = new Set();      // English text we had no translation for
// ?harvest collects every string the app shows (for translators): CH.i18n.harvest
const harvest = new URLSearchParams(location.search).has('harvest') ? new Set() : null;
const sources = new WeakMap();  // text node -> { src, out }
const attrSources = new WeakMap(); // element -> { attr: { src, out } }

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function compile(dict) {
  const exact = new Map(Object.entries(dict.exact));
  const patterns = dict.patterns.map(([src, out, where]) => {
    const parts = src.split(/(\{n\}|\{\})/);
    const re = new RegExp('^' + parts.map((p) => (p === '{}' ? '(.+?)' : p === '{n}' ? '([-+−±]?[\\d][\\d.,:]*)' : escapeRe(p))).join('') + '$');
    return { re, out, lit: src.replace(/\{n?\}/g, '').length, innerOnly: where === 'inner' };
  });
  // Most specific first, so "{} · {}" never beats a full sentence.
  patterns.sort((a, b) => b.lit - a.lit);
  return { exact, patterns };
}

const hasLetters = (s) => /[A-Za-z]/.test(s);

// Translate one string. Unknown text comes back unchanged.
// `inner` marks a captured part of a pattern (a name or a value), which is
// allowed to have no translation.
export function tr(text, inner = false) {
  if (text == null) return text;
  const str = String(text);
  const core = str.trim().replace(/\s+/g, ' ');
  if (!core || !hasLetters(core)) return str;
  if (harvest && !inner) harvest.add(core);
  if (lang === 'en') return str;
  let out = cache.get(core);
  if (out == null) {
    out = compiled.exact.get(core);
    if (out == null) {
      for (const p of compiled.patterns) {
        if (p.innerOnly && !inner) continue;
        const m = p.re.exec(core);
        if (!m) continue;
        out = p.out.replace(/\{(\d)\}/g, (_, i) => tr(m[Number(i) + 1], true));
        break;
      }
    }
    if (out == null) {
      out = core;
      if (!inner) missing.add(core);
    }
    if (cache.size > 4000) cache.clear();
    cache.set(core, out);
  }
  return str.replace(str.trim(), () => out);
}

// ---- DOM ----
function textNode(node) {
  const el = node.parentElement;
  if (!el || el.closest(SKIP)) return;
  const cur = node.nodeValue;
  const rec = sources.get(node);
  if (rec && rec.out === cur) return;          // still showing our own output
  const out = tr(cur);
  sources.set(node, { src: cur, out });
  if (out !== cur) node.nodeValue = out;
}

function attributes(el) {
  if (el.closest(SKIP)) return;
  for (const name of ATTRS) {
    if (!el.hasAttribute(name)) continue;
    const cur = el.getAttribute(name);
    const recs = attrSources.get(el) || {};
    if (recs[name] && recs[name].out === cur) continue;
    const out = tr(cur);
    recs[name] = { src: cur, out };
    attrSources.set(el, recs);
    if (out !== cur) el.setAttribute(name, out);
  }
}

function walk(root) {
  if (root.nodeType === Node.TEXT_NODE) return textNode(root);
  if (root.nodeType !== Node.ELEMENT_NODE) return;
  attributes(root);
  for (const el of root.querySelectorAll('[aria-label], [placeholder], [title], [alt]')) attributes(el);
  const it = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = it.nextNode(); n; n = it.nextNode()) textNode(n);
}

// Put the English back (before switching language).
function restore(root) {
  const it = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = it.nextNode(); n; n = it.nextNode()) {
    const rec = sources.get(n);
    if (rec && rec.out === n.nodeValue) n.nodeValue = rec.src;
    sources.delete(n);
  }
  for (const el of root.querySelectorAll('[aria-label], [placeholder], [title], [alt]')) {
    const recs = attrSources.get(el);
    if (!recs) continue;
    for (const name of Object.keys(recs)) if (el.getAttribute(name) === recs[name].out) el.setAttribute(name, recs[name].src);
    attrSources.delete(el);
  }
}

const observer = new MutationObserver((list) => {
  if (lang === 'en' && !harvest) return;
  for (const m of list) {
    if (m.type === 'characterData') textNode(m.target);
    else if (m.type === 'attributes') attributes(m.target);
    else for (const node of m.addedNodes) walk(node);
  }
});

function apply() {
  const def = LANGS[lang];
  document.documentElement.lang = def.htmlLang || def.code;
  document.documentElement.dataset.lang = def.code;
  cache.clear();
  compiled = def.dict ? compile(def.dict) : null;
  if (compiled || harvest) walk(document.body);
}

export const i18n = new Emitter();
i18n.get = () => lang;
i18n.missing = missing;
i18n.harvest = harvest;
i18n.next = () => LANGS[ORDER[(ORDER.indexOf(lang) + 1) % ORDER.length]];
i18n.set = (code) => {
  if (!LANGS[code] || code === lang) return;
  restore(document.body);
  lang = code;
  store.set(KEY, code);
  apply();
  i18n.emit('change', code);
};

observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
apply();
