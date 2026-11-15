// "A new version is ready".
//
// The page always loads the newest files when it is opened, but a tab left
// open keeps running the copy it started with, and a lobby on a newer
// version would turn it away. This checks version.json now and then and
// offers a reload: on Home, in the lobby and on the results screen, never
// in the middle of a match.

import { $, setHTML } from './util.js';
import { icon } from './icons.js';
import { CONFIG } from './config.js';
import { app } from './state.js';
import { act, onRender, screen, render } from './ui/core.js';

let newer = null;

async function check() {
  if (newer || app.practice) return;
  try {
    const res = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) return;
    const v = String((await res.json()).version || '');
    if (v && v !== CONFIG.version) {
      newer = v;
      render();
    }
  } catch (e) { /* offline: try again later */ }
}

function renderUpdate() {
  const bar = $('#update-bar');
  const show = !!newer && ['home', 'lobby', 'results'].includes(screen()) && !app.ui.joining;
  bar.hidden = !show;
  if (!show) return;
  setHTML(bar,
    '<span class="update-text">' + icon('install', 20) + '<span>A new version of City Hunter is ready.</span></span>' +
    '<button type="button" class="btn btn-sm btn-lime" data-act="update-reload">Reload</button>');
}

act('update-reload', async () => {
  try {
    const reg = navigator.serviceWorker && (await navigator.serviceWorker.getRegistration());
    if (reg) await reg.update();
  } catch (e) { /* reload anyway */ }
  location.reload();
});

app.update = { check, get newer() { return newer; } };

setTimeout(check, 20000);
setInterval(check, CONFIG.update.checkEverySec * 1000);
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && check());
onRender(renderUpdate);
app.bus.on('screen', renderUpdate);
