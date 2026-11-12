// Screen 5: Ability shop.

import { $, esc, setHTML } from '../util.js';
import { icon } from '../icons.js';
import { ABILITIES } from '../config.js';
import { app, snap } from '../state.js';
import { act, onRender, render, setLayer } from './core.js';

const root = $('#s-shop');

function renderShop() {
  const s = snap();
  if (app.ui.layer !== 'shop' || !s) return;
  const me = s.me;
  const tab = app.ui.shopTab || me.role;
  const items = Object.values(ABILITIES).filter((a) => a.side === tab);

  const cards = items.map((a) => {
    const can = me.gc >= a.cost;
    const owned = me.inv[a.id] || 0;
    return '<li class="card shop-item">' +
      '<span class="glyph ' + a.side + '">' + icon(a.icon, 26) + '</span>' +
      '<span class="shop-main">' +
        '<span class="shop-title"><span class="shop-name">' + esc(a.name) + '</span><span class="mono shop-owned">owned ×' + owned + '</span></span>' +
        '<span class="small muted">' + esc(a.effect) + '</span>' +
      '</span>' +
      '<button type="button" class="buy' + (can ? ' can' : '') + '" data-act="buy" data-id="' + a.id + '"' + (can ? '' : ' disabled') +
        ' aria-label="Buy ' + esc(a.name) + ' for ' + a.cost + ' Glowcoin' + (can ? '' : ', you need ' + (a.cost - me.gc) + ' more') + '">' +
        '<span class="mono">' + a.cost + '</span><span class="buy-text">' + (can ? 'BUY' : 'NEED ' + (a.cost - me.gc)) + '</span></button>' +
    '</li>';
  }).join('');

  setHTML(root,
    '<header class="shop-head">' +
      '<button type="button" class="icon-btn sm" data-act="layer-close" aria-label="Back to map">' + icon('chevLeft', 22, 2.5) + '</button>' +
      '<h1 class="head">ABILITY SHOP</h1>' +
      '<span class="pill mono" aria-live="polite">' + icon('coin', 18) + me.gc + ' GC</span>' +
    '</header>' +
    '<div class="tabs" role="group" aria-label="Ability side">' +
      '<button type="button" class="tab prey" data-act="shop-tab" data-tab="prey" aria-pressed="' + (tab === 'prey') + '">Prey abilities</button>' +
      '<button type="button" class="tab hunter" data-act="shop-tab" data-tab="hunter" aria-pressed="' + (tab === 'hunter') + '">Hunter abilities</button>' +
    '</div>' +
    '<ul class="scroll shop-list">' + cards + '</ul>' +
    '<footer class="foot-bar pad-b">' +
      '<p class="small muted foot-note">Earn Glowcoin by surviving pings as prey and landing catches as a hunter. Abilities stay with you if you switch sides.</p>' +
      '<button type="button" class="btn btn-line head shop-back" data-act="layer-close">BACK TO MAP</button>' +
    '</footer>');
}

act('shop-tab', (el) => {
  app.ui.shopTab = el.dataset.tab;
  render();
});
act('buy', (el) => app.session.send({ k: 'buy', id: el.dataset.id }));
act('layer-close', () => setLayer(null));

app.bus.on('layer', (name) => {
  if (name === 'shop') app.ui.shopTab = null;
});
onRender(renderShop);
