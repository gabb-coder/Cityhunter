// Theme: data-theme="dark|sun" on <html>, persisted in localStorage.
// index.html sets the attribute before first paint; this module owns changes.

import { Emitter, store } from './util.js';

const KEY = 'ch2.theme';
const META = { dark: '#0A0C0B', sun: '#EEEDE6' };

export const theme = new Emitter();

theme.get = () => (document.documentElement.dataset.theme === 'sun' ? 'sun' : 'dark');

theme.set = (name) => {
  const next = name === 'sun' ? 'sun' : 'dark';
  document.documentElement.dataset.theme = next;
  store.set(KEY, next);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', META[next]);
  theme.emit('change', next);
};

theme.toggle = () => theme.set(theme.get() === 'dark' ? 'sun' : 'dark');

// Label for the toggle button: it names the theme you would switch to.
theme.nextLabel = () => (theme.get() === 'dark' ? 'Switch to sunlight theme' : 'Switch to dark theme');
theme.nextIcon = () => (theme.get() === 'dark' ? 'sun' : 'moon');
