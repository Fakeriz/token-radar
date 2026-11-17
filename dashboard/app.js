// Token Radar radar-2 dashboard. Reads window.RADAR (written beside dashboard/ by main.ts):
// the ranked board, the live-token set and the comparables multiples the model computed from
// the snapshot. No network: every byte shown is in data.js. Farm steps come from board.json
// verbatim (data.js carries them), so the page and the board can never disagree.
(function () {
  'use strict';
  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var PAGE = 50;
  var state = { q: '', category: 'all', chain: 'all', watch: false, tab: 'pre-token', sort: 'implied', dir: -1, selected: null, page: 0 };
  var usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd0.format(n);
  }
  function fmtPct(n) { if (n === null || n === undefined || !isFinite(n)) return 'n/a'; return (n > 0 ? '+' : '') + n.toFixed(2) + '%'; }
  function fmtAge(d) { if (d === null || d === undefined) return 'unknown'; if (d >= 365) return (d / 365).toFixed(1) + 'y'; return Math.max(0, Math.round(d)) + 'd'; }
  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'class') node.className = attrs[k];
      else if (k === 'text') node.textContent = attrs[k];
      else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
    });
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c === null || c === undefined) continue;
      if (Array.isArray(c)) c.forEach(function (x) { if (x) node.appendChild(x); });
      else if (typeof c === 'string') node.appendChild(document.createTextNode(c));
      else node.appendChild(c);
    }
    return node;
  }
  // impliedOf recomputes a row from the snapshot figures (impliedValue in lib/model.ts) and
  // checks it against the board's number, so code and data are visibly the same arithmetic.
  function impliedOf(r, m) {
    var g = Math.min(m.growth_cap, Math.max(m.growth_floor, r.change_7d === null ? 0 : r.change_7d));
    var gm = 1 + (g / 100) * m.growth_weight;
    var age = r.age_days === null ? m.unknown_age_days : r.age_days;
    var mat = m.maturity_floor + m.maturity_range * (Math.log1p(Math.min(Math.max(age, 0), m.maturity_days)) / Math.log1p(m.maturity_days));
    var br = 1 + m.breadth_step * Math.min(Math.max((r.chains || []).length - 1, 0), m.breadth_max_extra);
    return Math.max(1, Math.round(r.tvl_usd * r.multiple * m.launch_haircut * gm * mat * br));
  }
  function readHash() {
    var h = window.location.hash.replace(/^#/, '');
    if (!h) return;
    var p = new URLSearchParams(h);
    if (p.get('q')) state.q = p.get('q');
    if (p.get('p')) state.selected = p.get('p');
    if (p.get('category')) state.category = p.get('category');
    if (p.get('chain')) state.chain = p.get('chain');
    if (p.get('watch') === '1') state.watch = true;
    if (p.get('tab')) state.tab = p.get('tab');
  }
  function writeHash() {
    var p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.category !== 'all') p.set('category', state.category);
    if (state.chain !== 'all') p.set('chain', state.chain);
    if (state.watch) p.set('watch', '1');
    if (state.tab !== 'pre-token') p.set('tab', state.tab);
    if (state.selected) p.set('p', state.selected);
    var s = p.toString();
    window.history.replaceState(null, '', s ? '#' + s : window.location.pathname + window.location.search);
  }
  function filtered() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && !(r.chains || []).includes(state.chain)) return false;
      if (state.watch && !r.watchlist) return false;
      if (!q) return true;
      return [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase().indexOf(q) >= 0;
    });
  }
  function sorted(list) {
    var k = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (k === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (k === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (k === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (k === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (k === 'multiple') { av = a.multiple; bv = b.multiple; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : 1;
    });
  }
  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'pulse' }), el('b', { text: 'Token Radar' }), el('span', { text: 'RADAR-2 · LIVE' })),
      el('div', { class: 'top-meta' },
        el('span', { text: 'SNAPSHOT ' + DATA.as_of }),
        el('span', { text: 'SOURCE: DEFILLAMA PROTOCOL INDEX' }),
        el('span', { text: DATA.board_size + ' PRE-TOKEN ROWS' })));
  }
  function lede() {
    var tot = DATA.rows.reduce(function (s, r) { return s + r.implied_value_usd; }, 0);
    var wl = DATA.rows.filter(function (r) { return r.watchlist; });
    var wlTot = wl.reduce(function (s, r) { return s + r.implied_value_usd; }, 0);
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: 'Which protocol launches next — and what would it be worth?' }),
        el('p', null, 'Every protocol in the snapshot that ', el('b', { text: 'records no token' }), ' and is not a wrapped, staked or bridged product of one that trades, ranked by an implied launch value priced off the tokens that already trade in its own sector. The watchlist — ', el('b', { text: DATA.watchlist_size + ' protocols at $50M+ TVL' }), ' — is the floor, not the ceiling: the board adds every smaller pre-token protocol the radar could find.')),
      el('div', { class: 'kpis' },
        el('div', { class: 'kpi' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size }), el('small', { text: 'every watchlist slug is ranked' })),
        el('div', { class: 'kpi' }, el('span', { text: 'Board total implied' }), el('b', { text: fmtUsd(tot) }), el('small', { text: 'sum of all ' + DATA.board_size + ' rows' })),
        el('div', { class: 'kpi' }, el('span', { text: 'Watchlist implied' }), el('b', { text: fmtUsd(wlTot) }), el('small', { text: 'the 40 watchlist rows alone' })),
        el('div', { class: 'kpi' }, el('span', { text: 'Median sector multiple' }), el('b', { text: DATA.overall_multiple.toFixed(3) + 'x' }), el('small', { text: 'median mcap / TVL, all live tokens' }))));
  }
  function spotlight() {
    var top = DATA.rows.slice(0, 5);
    return el('section', { class: 'spot', 'aria-label': 'Top five by implied value' },
      top.map(function (r) {
        return el('button', { type: 'button', class: 'card', onclick: function () { openDetail(r.slug); } },
          el('span', { class: 'rk', text: '#' + r.rank + (r.watchlist ? ' · WATCHLIST' : '') }),
          el('b', { text: r.name }),
          el('span', { class: 'v', text: fmtUsd(r.implied_value_usd) }),
          el('span', { class: 's', text: (r.category || 'Other') + ' · TVL ' + fmtUsd(r.tvl_usd) }));
      }));
  }
  function controls() {
    var cats = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.flatMap(function (r) { return r.chains || []; }))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category, chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; state.page = 0; writeHash(); render(); });
    var catSel = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      cats.map(function (c) { return el('option', { value: c, text: c + ' (' + DATA.rows.filter(function (r) { return (r.category || 'Other') === c; }).length + ')', selected: c === state.category ? 'selected' : null }); }));
    catSel.addEventListener('change', function () { state.category = catSel.value; state.page = 0; writeHash(); render(); });
    var chainSel = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); }));
    chainSel.addEventListener('change', function () { state.chain = chainSel.value; state.page = 0; writeHash(); render(); });
    var watchBtn = el('label', { class: 'check' + (state.watch ? ' on' : '') },
      el('input', { type: 'checkbox', checked: state.watch ? 'checked' : null, 'aria-label': 'Watchlist only' }), 'Watchlist only');
    watchBtn.querySelector('input').addEventListener('change', function (e) { state.watch = e.target.checked; state.page = 0; writeHash(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; state.page = 0; render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; state.page = 0; render(); } });
    var sortSel = el('select', { id: 'sort', 'aria-label': 'Sort by' },
      [['implied', 'Implied value'], ['tvl', 'TVL'], ['growth', '7d growth'], ['age', 'Age'], ['multiple', 'Sector multiple'], ['name', 'Name']].map(function (o) {
        return el('option', { value: o[0], text: 'Sort: ' + o[1], selected: state.sort === o[0] ? 'selected' : null });
      }));
    sortSel.addEventListener('change', function () { state.sort = sortSel.value; render(); });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), catSel),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSel),
      el('div', { class: 'field' }, el('label', { text: 'Scope' }), watchBtn),
      el('div', { class: 'field' }, el('label', { text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('div', { class: 'field' }, el('label', { for: 'sort', text: 'Order' }), sortSel),
      el('span', { class: 'count', text: state.tab === 'pre-token' ? filtered().length + ' rows match' : DATA.live.length + ' live-token protocols' }));
  }
  function sortHeader(key, label) {
    return el('th', { scope: 'col' }, el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
      label, state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' ▼' : ' ▲' }) : null));
  }
  function boardTable() {
    var list = sorted(filtered());
    var pages = Math.max(1, Math.ceil(list.length / PAGE));
    if (state.page >= pages) state.page = pages - 1;
    var slice = list.slice(state.page * PAGE, state.page * PAGE + PAGE);
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search, the chain or the watchlist toggle to see the board again.' }),
        el('button', { class: 'btn primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.watch = false; state.page = 0; writeHash(); render(); } })));
    }
    var max = DATA.rows[0].implied_value_usd || 1;
    var tbody = el('tbody');
    slice.forEach(function (r) {
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false', class: r.watchlist ? 'watch' : '',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }),
          el('span', { text: (r.category || 'Other') + ' · ' + (r.chains && r.chains.length ? r.chains.slice(0, 3).join(', ') : 'unnamed chain') + (r.chains && r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', { class: 'num', text: r.multiple.toFixed(2) + 'x' }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) }))),
        el('td', null, r.watchlist ? el('span', { class: 'tag wl', text: 'WATCHLIST' }) : el('span', { class: 'tag', text: 'RECORDS NO TOKEN' })));
      tbody.appendChild(tr);
    });
    var pager = el('div', { class: 'pager' },
      el('span', { text: 'Page ' + (state.page + 1) + ' of ' + pages + ' — rows ' + (state.page * PAGE + 1) + '–' + Math.min(list.length, (state.page + 1) * PAGE) + ' of ' + list.length }),
      el('span', null,
        el('button', { type: 'button', disabled: state.page === 0 ? 'disabled' : null, text: '← Prev', onclick: function () { state.page--; render(); } }),
        ' ',
        el('button', { type: 'button', disabled: state.page >= pages - 1 ? 'disabled' : null, text: 'Next →', onclick: function () { state.page++; render(); } })));
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' }, el('table', null,
        el('caption', { class: 'muted', text: 'Pre-token protocols, strongest implied value first. Select a row for its model breakdown and farm plan.' }),
        el('thead', null, el('tr', null,
          sortHeader('implied', 'Rank'), sortHeader('name', 'Protocol'), sortHeader('tvl', 'TVL'),
          sortHeader('growth', '7d'), sortHeader('age', 'Age'), sortHeader('multiple', 'Sector ×'),
          sortHeader('implied', 'Implied value'), el('th', { scope: 'col', text: 'Status' }))),
        tbody)),
      pager);
  }
  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', null, el('span', { class: 'tag live', text: 'LIVE' })),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { text: (r.category || 'Other') + ' · ' + (r.chains || []).slice(0, 2).join(', ') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num', text: r.mcap_usd && r.tvl_usd ? (r.mcap_usd / r.tvl_usd).toFixed(2) + 'x' : 'n/a' }),
        el('td', { class: 'muted', text: 'Priced by the market, not the model — excluded from the ranking.' })));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' }, el('table', null,
        el('caption', { class: 'muted', text: 'These protocols already trade. Their market caps are the comparables the model prices the pre-token board against.' }),
        el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Mcap / TVL' }), el('th', { scope: 'col', text: 'Note' }))),
        tbody)));
  }
  function modelPanel() {
    var m = DATA.model;
    var rows = DATA.multiples.map(function (x) {
      return el('tr', null, el('td', { text: x.category }), el('td', { class: 'num', text: x.multiple.toFixed(3) + 'x' }), el('td', { class: 'num', text: String(x.peers) }), el('td', { class: 'muted', text: x.source }));
    });
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed — the working, shown' }),
      el('p', null, 'One function scores every protocol. No name is special-cased, no row is hand-picked. The sector multiple is the median market-cap-to-TVL of the tokens that already trade in that sector, computed from this snapshot at run time — not a number typed in by hand.'),
      el('div', { class: 'formula' },
        el('b', { text: 'implied = round( TVL × sector-multiple × 0.55 launch haircut × growth × maturity × breadth )' }),
        el('div', { text: 'growth = 1 + clamp(change_7d, −40, +80)% / 100 × 0.6' }),
        el('div', { text: 'maturity = 0.70 + 0.30 × ln(1 + min(age_days, 1095)) / ln(1 + 1095) — log age: early years matter most' }),
        el('div', { text: 'breadth = 1 + 0.03 × min(chains − 1, 8) — more chains, more distribution surface' }),
        el('div', { text: 'age = days since DefiLlama first listed the protocol; unknown age uses 365 days. Categories with fewer than 3 live peers use the snapshot-wide median ' + DATA.overall_multiple.toFixed(3) + 'x.' })),
      el('div', { class: 'note', text: 'What the board leaves out, on purpose: wrapped, staked and bridged products (WBTC, exchange bridges, staked-ETH wrappers) and centralised exchanges. Their underlying token already trades, so there is no launch left to rank — and a board that put a $2.3B wrapped-Bitcoin wrapper at #1 would be ranking a token that exists.' }),
      el('h3', { text: 'Sector multiples used (median mcap / TVL of live tokens, this snapshot)' }),
      el('div', { class: 'table-wrap' }, el('table', { class: 'mult' },
        el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Category' }), el('th', { scope: 'col', text: 'Multiple' }), el('th', { scope: 'col', text: 'Live peers' }), el('th', { scope: 'col', text: 'Source' }))),
        el('tbody', null, rows))),
      el('p', null, 'Implied value is the entry\u2019s own claim about what a launch would be worth if the protocol\u2019s record stayed as it is. It does not predict whether or when a token is issued, and it is not a price. Farm plans carry no airdrop guarantee: they say what to do, what it costs and how long it takes.'));
  }
  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });
  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var recomputed = impliedOf(row, DATA.model);
    var m = DATA.model;
    var g = Math.min(m.growth_cap, Math.max(m.growth_floor, row.change_7d === null ? 0 : row.change_7d));
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'tag' + (row.watchlist ? ' wl' : ''), text: 'RANK ' + row.rank + ' OF ' + DATA.board_size + (row.watchlist ? ' · WATCHLIST' : ' · EARLY RADAR') }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'muted', text: (row.category || 'Other') + ' on ' + ((row.chains || []).join(', ') || 'an unnamed chain') + ' · listed ' + (row.listed_at || 'date unknown') })),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: '✕', onclick: function () { dialog.close(); } })));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value — every input, shown' }),
      el('div', { class: 'eq' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Sector multiple (' + (row.category || 'Other') + ', ' + row.multiple_peers + ' live peers)' }), el('b', { class: 'num', text: row.multiple.toFixed(3) + 'x' })),
        el('div', null, el('span', { text: 'Launch haircut' }), el('b', { class: 'num', text: '× ' + m.launch_haircut })),
        el('div', null, el('span', { text: '7d growth ' + fmtPct(row.change_7d) + ' (clamped ' + g + '%)' }), el('b', { class: 'num', text: '× ' + row.growth_multiplier })),
        el('div', null, el('span', { text: 'Maturity — ' + fmtAge(row.age_days) + ' with no token on record' }), el('b', { class: 'num', text: '× ' + row.maturity_multiplier })),
        el('div', null, el('span', { text: 'Breadth — ' + (row.chains || []).length + ' chain' + ((row.chains || []).length === 1 ? '' : 's') }), el('b', { class: 'num', text: '× ' + row.breadth_multiplier })),
        el('div', { class: 'tot' }, el('span', { text: 'Implied launch value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))),
      el('p', { class: 'muted', text: 'The page recomputes this row as ' + fmtUsd(recomputed) + (recomputed === row.implied_value_usd ? ' — the same number board.json carries.' : ' — which differs from the board: the data would be stale.') + ' This protocol records no token in the snapshot; that is a record, not a promise that none exists.' })));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan — 7 steps, with cost and time' }),
      el('ol', { class: 'steps' }, row.farm_steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('div', null, el('b', { text: action }), el('span', { class: 'cost', text: tail })));
      }))));
    if (typeof dialog.showModal === 'function') { if (!dialog.open) dialog.showModal(); }
    else dialog.setAttribute('open', '');
  }
  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    if (state.tab === 'pre-token') shell.appendChild(spotlight());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') shell.appendChild(modelPanel());
    shell.appendChild(el('p', { class: 'foot', text: 'Snapshot ' + DATA.as_of + ' · ' + DATA.source + ' · Model ' + DATA.model_version + ' · Implied values are the entry\u2019s own claim, never a price and never a prediction that a token will be issued.' }));
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }
  readHash();
  render();
  window.addEventListener('keydown', function (e) { if (e.key === 'Escape' && dialog.open) dialog.close(); });
})();
