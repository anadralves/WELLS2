'use strict';
const $ = (s, r = document) => r.querySelector(s);
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const eur0 = new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const int = new Intl.NumberFormat('pt-PT', { maximumFractionDigits: 0 });
const pctF = new Intl.NumberFormat('pt-PT', { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1, signDisplay: 'exceptZero' });
const sgn = new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0, signDisplay: 'exceptZero' });
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const cls = (x) => (x > 0.0001 ? 'pos' : x < -0.0001 ? 'neg' : '');
const pct = (a, b) => (b ? a / b - 1 : null);
const pctTxt = (x) => (x == null ? '–' : pctF.format(x));

/* ---------------- Armazenamento (servidor ou local) ---------------- */
const Store = {
  mode: 'local', writable: true,
  async load() {
    try {
      const r = await fetch('/api/data', { cache: 'no-store' });
      if (r.ok) { const j = await r.json(); this.mode = 'remote'; this.writable = !!j.writable; return j.months; }
    } catch (e) { /* sem servidor: modo local */ }
    this.mode = 'local'; this.writable = true;
    return idbAll();
  },
  async save(month, password) {
    if (this.mode === 'local') return idbPut(month);
    const r = await fetch('/api/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password, month }) });
    await apiCheck(r);
  },
  async remove(ym, password) {
    if (this.mode === 'local') return idbDel(ym);
    const r = await fetch('/api/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password, action: 'delete', ym }) });
    await apiCheck(r);
  },
};
async function apiCheck(r) {
  if (r.ok) return;
  let e = ''; try { e = (await r.json()).error; } catch {}
  if (r.status === 401) throw new Error('Palavra-passe errada.');
  if (e === 'no_admin_password') throw new Error('Falta definir a variável ADMIN_PASSWORD no Vercel.');
  throw new Error('Erro do servidor (' + r.status + ') ' + (e || ''));
}
function idb() {
  return new Promise((res, rej) => {
    const q = indexedDB.open('wells-dashboard', 1);
    q.onupgradeneeded = () => q.result.createObjectStore('months', { keyPath: 'ym' });
    q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
  });
}
const idbTx = async (mode, fn) => { const db = await idb(); return new Promise((res, rej) => { const t = db.transaction('months', mode); const out = fn(t.objectStore('months')); t.oncomplete = () => res(out.result); t.onerror = () => rej(t.error); }); };
const idbAll = () => idbTx('readonly', (s) => s.getAll());
const idbPut = (m) => idbTx('readwrite', (s) => s.put(m));
const idbDel = (ym) => idbTx('readwrite', (s) => s.delete(ym));

/* ---------------- Estado ---------------- */
const S = {
  months: [], ds: null, view: 'TOTAL', year: null, selMonths: new Set(),
  f: { lojas: new Set(), marcas: new Set(), tipos: new Set(), cats: new Set(), artText: '', codText: '' },
  sort: { lojas: { k: 'vy', d: -1 }, arts: { k: 'vy', d: -1 } },
};

async function boot() {
  S.months = await Store.load();
  afterData();
}

function afterData() {
  S.ds = Core.buildDataset(S.months);
  const has = S.ds.n > 0;
  $('#empty').hidden = has; $('#content').hidden = !has; $('.bar').hidden = !has; $('#filters').hidden = !has;
  const b = $('#modeBadge'), bn = $('#banner');
  b.hidden = false; b.textContent = Store.mode === 'remote' ? 'Dados partilhados' : 'Modo local';
  bn.hidden = Store.mode === 'remote';
  bn.innerHTML = 'Modo local: os dados ficam guardados <b>só neste browser</b>. Para todos verem os mesmos dados, liga a base de dados no Vercel (ver LEIA-ME).';
  $('#lastData').textContent = S.ds.yms.length ? 'Dados até ' + MESES[+S.ds.yms.at(-1).slice(5) - 1] + '/' + S.ds.yms.at(-1).slice(0, 4) : '';
  if (has) {
    if (!S.year || !S.ds.years.includes(S.year)) S.year = S.ds.years.at(-1);
    buildYear(); buildMonths(); buildFilters(); render();
  }
}

/* ---------------- Controlos ---------------- */
function buildYear() {
  const sel = $('#year');
  sel.innerHTML = [...S.ds.years].reverse().map((y) => `<option ${y === S.year ? 'selected' : ''}>${y}</option>`).join('');
  sel.onchange = () => { S.year = +sel.value; S.selMonths.clear(); buildMonths(); render(); };
}
function buildMonths() {
  const c = Core.compute(S.ds, { view: 'TOTAL' }, S.year, null);
  const box = $('#months');
  box.innerHTML = MESES.map((m, i) => `<button class="chip ${S.selMonths.has(i + 1) ? 'on' : ''} ${i + 1 > c.last ? 'dis' : ''}" data-m="${i + 1}">${m}</button>`).join('');
  box.onclick = (e) => { const b = e.target.closest('.chip'); if (!b) return; const m = +b.dataset.m; S.selMonths.has(m) ? S.selMonths.delete(m) : S.selMonths.add(m); buildMonths(); render(); };
}
$('#tabs').onclick = (e) => {
  const b = e.target.closest('button'); if (!b) return;
  S.view = b.dataset.view;
  document.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('on', x === b));
  S.f.lojas.clear(); buildFilters(); render();
};
$('#btnClear').onclick = () => { for (const k of ['lojas', 'marcas', 'tipos', 'cats']) S.f[k].clear(); S.f.artText = S.f.codText = ''; S.selMonths.clear(); buildMonths(); buildFilters(); render(); };

function checklist(host, title, key, options) {
  const set = S.f[key];
  host.innerHTML = `<h4>${title}<a data-clear hidden>limpar</a></h4><input type="text" placeholder="Pesquisar…"><div class="opts"></div>`;
  const inp = $('input', host), list = $('.opts', host), clr = $('[data-clear]', host);
  const upd = () => { clr.hidden = !set.size; clr.textContent = 'limpar (' + set.size + ')'; };
  const draw = () => {
    const q = inp.value.trim().toLowerCase();
    const shown = options.filter((o) => !q || o.label.toLowerCase().includes(q)).slice(0, 150);
    list.innerHTML = shown.map((o) => `<label class="opt" title="${esc(o.label)}"><input type="checkbox" value="${esc(o.value)}" ${set.has(o.value) ? 'checked' : ''}><span>${esc(o.label)}</span></label>`).join('') || '<div class="muted small">Sem resultados</div>';
    upd();
  };
  list.onchange = (e) => { const v = e.target.value; e.target.checked ? set.add(v) : set.delete(v); upd(); render(); };
  clr.onclick = () => { set.clear(); draw(); render(); };
  inp.oninput = draw; draw();
}
function buildFilters() {
  const ds = S.ds, host = $('#filters');
  const lojas = ds.lojas.filter((l) => (S.view === 'ONLINE' ? Core.isOnline(l) : S.view === 'LOJAS' ? !Core.isOnline(l) : true))
    .sort((a, b) => a.name.localeCompare(b.name)).map((l) => ({ value: l.code, label: l.code + ' · ' + l.name }));
  const uniq = (arr) => [...new Set(arr)].filter(Boolean).sort().map((v) => ({ value: v, label: v }));
  host.innerHTML = [0, 1, 2, 3].map((i) => `<div class="fbox" id="fb${i}"></div>`).join('') +
    `<div class="fbox"><h4>Artigo</h4><input type="text" id="artText" placeholder="Nome do artigo…" value="${esc(S.f.artText)}"></div>` +
    `<div class="fbox"><h4>Cód. artigo</h4><input type="text" id="codText" placeholder="Código…" value="${esc(S.f.codText)}"></div>`;
  checklist($('#fb0'), 'Loja', 'lojas', lojas);
  checklist($('#fb1'), 'Marca', 'marcas', uniq(ds.arts.map((a) => a.marca)));
  checklist($('#fb2'), 'Tipo de artigo', 'tipos', ds.tipos.filter(Boolean).sort().map((v) => ({ value: v, label: v })));
  checklist($('#fb3'), 'Tipo de produto', 'cats', uniq(ds.arts.map((a) => a.cat)));
  let t; const deb = (id, k) => { $(id).oninput = (e) => { clearTimeout(t); t = setTimeout(() => { S.f[k] = e.target.value; render(); }, 200); }; };
  deb('#artText', 'artText'); deb('#codText', 'codText');
}

/* ---------------- Render ---------------- */
let raf = 0;
function render() { cancelAnimationFrame(raf); raf = requestAnimationFrame(doRender); }
function doRender() {
  if (!S.ds || !S.ds.n) return;
  const f = { view: S.view, ...S.f };
  const c = Core.compute(S.ds, f, S.year, S.selMonths);
  const periodo = S.selMonths.size ? [...S.selMonths].sort((a, b) => a - b).map((m) => MESES[m - 1]).join(', ') : (c.last ? 'jan–' + MESES[c.last - 1] : '');
  const { vy, vp, qy, qp } = c.tot, d = vy - vp;
  $('#kpis').innerHTML =
    kpi('Faturação ' + c.Y, eur0.format(vy), periodo, 'hi') +
    kpi('Faturação ' + c.P, eur0.format(vp), 'mesmo período') +
    kpi('YtD (diferença)', sgn.format(d), 'vs ' + c.P, '', cls(d)) +
    kpi('% YtD', pctTxt(pct(vy, vp)), 'vs ' + c.P, '', cls(d)) +
    kpi('Quantidade ' + c.Y, int.format(qy), pctTxt(pct(qy, qp)) + ' vs ' + c.P + ' (' + int.format(qp) + ')');
  $('#chartLegend').innerHTML = `<span style="color:#d97fb8">■</span> ${c.Y} &nbsp;<span style="color:#999">■</span> ${c.P}`;
  chart(c); monthly(c); tableLojas(c); tableArts(c); bars(c);
  $('#barsCard').hidden = S.view !== 'TOTAL';
  $('#lojasCard').classList.toggle('wide', S.view !== 'TOTAL');
}
const kpi = (l, v, s, extra = '', vc = '') => `<div class="kpi ${extra}"><div class="l">${l}</div><div class="v ${extra ? '' : vc}">${v}</div><div class="s">${s || '&nbsp;'}</div></div>`;

function showTip(e, html) { const t = $('#tip'); t.hidden = false; t.innerHTML = html; t.style.left = Math.min(e.clientX + 14, innerWidth - t.offsetWidth - 8) + 'px'; t.style.top = e.clientY + 14 + 'px'; }
const hideTip = () => { $('#tip').hidden = true; };
const niceMax = (v) => { const p = 10 ** Math.floor(Math.log10(v)), n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p; };
const short = (v) => (v >= 1e6 ? (v / 1e6).toFixed(1).replace('.0', '') + ' M' : v >= 1e3 ? Math.round(v / 1e3) + ' k' : Math.round(v));

function chart(c) {
  const W = 640, H = 270, L = 52, R = 10, T = 12, B = 26, iw = W - L - R, ih = H - T - B;
  const ys = [...c.monthY.slice(1, c.last + 1), ...c.monthP.slice(1)];
  const max = niceMax(Math.max(1, ...ys)), x = (i) => L + (iw * (i - 1)) / 11, y = (v) => T + ih - (ih * v) / max;
  let g = '';
  for (let i = 0; i <= 4; i++) { const v = (max * i) / 4; g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="#eee"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${short(v)}</text>`; }
  g += MESES.map((m, i) => `<text x="${x(i + 1)}" y="${H - 8}" text-anchor="middle">${m}</text>`).join('');
  const line = (arr, n) => Array.from({ length: n }, (_, i) => `${x(i + 1)},${y(arr[i + 1])}`).join(' ');
  const area = (arr, n) => `${x(1)},${y(0)} ${line(arr, n)} ${x(n)},${y(0)}`;
  g += `<polygon points="${area(c.monthP, 12)}" fill="#e9e6e9" opacity=".7"/><polyline points="${line(c.monthP, 12)}" fill="none" stroke="#999" stroke-width="2"/>`;
  if (c.last) g += `<polygon points="${area(c.monthY, c.last)}" fill="#f3b4dc" opacity=".6"/><polyline points="${line(c.monthY, c.last)}" fill="none" stroke="#111" stroke-width="2.2"/>` + Array.from({ length: c.last }, (_, i) => `<circle cx="${x(i + 1)}" cy="${y(c.monthY[i + 1])}" r="3" fill="#111"/>`).join('');
  g += Array.from({ length: 12 }, (_, i) => `<rect data-i="${i + 1}" x="${x(i + 1) - iw / 22}" y="${T}" width="${iw / 11}" height="${ih}" fill="transparent"/>`).join('');
  const el = $('#chart'); el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%">${g}</svg>`;
  el.onmousemove = (e) => { const r = e.target.closest('rect[data-i]'); if (!r) return hideTip(); const i = +r.dataset.i; showTip(e, `<b>${MESES[i - 1]}</b><br>${c.Y}: ${i <= c.last ? eur0.format(c.monthY[i]) : '–'}<br>${c.P}: ${eur0.format(c.monthP[i])}`); };
  el.onmouseleave = hideTip;
}

function monthly(c) {
  let rows = '';
  for (let m = 1; m <= 12; m++) {
    const y = c.monthY[m], p = c.monthP[m], has = m <= c.last, d = y - p, dim = c.sel.has(m) ? '' : 'dim';
    rows += `<tr><td class="l ${dim}">${MESES[m - 1]}</td><td class="${dim}">${eur0.format(p)}</td><td class="${dim}">${has ? eur0.format(y) : '–'}</td><td class="${has && !dim ? cls(d) : dim}">${has ? sgn.format(d) : '–'}</td><td class="${has && !dim ? cls(d) : dim}">${has ? pctTxt(pct(y, p)) : '–'}</td></tr>`;
  }
  $('#monthly').innerHTML = `<table><thead><tr><th class="l">Mês</th><th>${c.P}</th><th>${c.Y}</th><th>YtD</th><th>%YtD</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function table(host, key, cols, rows, totalRow, onRow, selFn) {
  const so = S.sort[key];
  rows.sort((a, b) => (typeof a[so.k] === 'string' ? a[so.k].localeCompare(b[so.k]) : (a[so.k] ?? -Infinity) - (b[so.k] ?? -Infinity)) * so.d);
  const MAX = 300, shown = rows.slice(0, MAX);
  const th = cols.map((c) => `<th class="${c.l ? 'l' : ''} ${so.k === c.k ? 'sorted' : ''}" data-k="${c.k}">${c.t}${so.k === c.k ? (so.d < 0 ? ' ↓' : ' ↑') : ''}</th>`).join('');
  const body = shown.map((r, i) => `<tr data-i="${i}" class="${onRow ? 'click' : ''} ${selFn && selFn(r) ? 'sel' : ''}">${cols.map((c) => `<td class="${c.l ? 'l' : ''} ${c.name ? 'name' : ''} ${c.cc ? cls(r[c.k]) : ''}" ${c.name ? `title="${esc(r[c.k])}"` : ''}>${c.f(r[c.k], r)}</td>`).join('')}</tr>`).join('');
  const tot = totalRow ? `<tr class="tot">${cols.map((c, i) => `<td class="${c.l ? 'l' : ''} ${c.cc ? cls(totalRow[c.k]) : ''}">${i === 0 ? 'Total' : c.tf ? c.tf(totalRow[c.k], totalRow) : ''}</td>`).join('')}</tr>` : '';
  host.innerHTML = `<table><thead><tr>${th}</tr></thead><tbody>${body}</tbody><tfoot>${tot}</tfoot></table>` + (rows.length > MAX ? `<p class="muted small">A mostrar ${MAX} de ${rows.length}. Usa os filtros para refinar.</p>` : '');
  host.querySelector('thead').onclick = (e) => { const t = e.target.closest('th'); if (!t) return; const k = t.dataset.k; so.d = so.k === k ? -so.d : -1; so.k = k; render(); };
  if (onRow) host.querySelector('tbody').onclick = (e) => { const tr = e.target.closest('tr'); if (tr) onRow(shown[+tr.dataset.i]); };
}

function tableLojas(c) {
  const rows = [...c.lojas].map(([i, o]) => ({ code: S.ds.lojas[i].code, name: S.ds.lojas[i].name, ...o, d: o.vy - o.vp, p: pct(o.vy, o.vp) }));
  const t = { ...c.tot, d: c.tot.vy - c.tot.vp, p: pct(c.tot.vy, c.tot.vp) };
  const e0 = (v) => eur0.format(v);
  const cols = [
    { k: 'code', t: 'Loja', l: 1, f: (v) => v }, { k: 'name', t: 'Nome', l: 1, name: 1, f: (v) => esc(v) },
    { k: 'vp', t: 'Fat. ' + c.P, f: e0, tf: e0 }, { k: 'vy', t: 'Fat. ' + c.Y, f: e0, tf: e0 },
    { k: 'd', t: 'YtD', cc: 1, f: (v) => sgn.format(v), tf: (v) => sgn.format(v) }, { k: 'p', t: '%YtD', cc: 1, f: pctTxt, tf: pctTxt },
  ];
  table($('#tblLojas'), 'lojas', cols, rows, t, (r) => { const s = S.f.lojas; if (s.has(r.code) && s.size === 1) s.clear(); else { s.clear(); s.add(r.code); } buildFilters(); render(); }, (r) => S.f.lojas.size === 1 && S.f.lojas.has(r.code));
}
function tableArts(c) {
  const rows = [...c.arts].map(([i, o]) => ({ desc: S.ds.arts[i].desc, cod: S.ds.arts[i].cod, ...o, p: pct(o.vy, o.vp) }));
  const t = { ...c.tot, p: pct(c.tot.vy, c.tot.vp) };
  const e0 = (v) => eur0.format(v), n0 = (v) => int.format(v);
  const cols = [
    { k: 'desc', t: 'Artigo', l: 1, name: 1, f: (v) => esc(v) }, { k: 'cod', t: 'Cód.', l: 1, f: (v) => v },
    { k: 'vp', t: 'Fat. ' + c.P, f: e0, tf: e0 }, { k: 'vy', t: 'Fat. ' + c.Y, f: e0, tf: e0 },
    { k: 'qp', t: 'Qtd ' + c.P, f: n0, tf: n0 }, { k: 'qy', t: 'Qtd ' + c.Y, f: n0, tf: n0 },
    { k: 'p', t: '%YtD', cc: 1, f: pctTxt, tf: pctTxt },
  ];
  table($('#tblArts'), 'arts', cols, rows, t);
}

function bars(c) {
  const rows = [...c.lojas].map(([i, o]) => ({ n: S.ds.lojas[i].name, ...o })).sort((a, b) => b.vy - a.vy).slice(0, 12);
  if (!rows.length) { $('#bars').innerHTML = '<p class="muted">Sem dados.</p>'; return; }
  const W = 460, rh = 30, L = 130, H = rows.length * rh + 6, max = Math.max(...rows.map((r) => Math.max(r.vy, r.vp)), 1);
  const w = (v) => ((W - L - 50) * v) / max;
  const g = rows.map((r, i) => {
    const y = i * rh + 3;
    return `<text x="${L - 6}" y="${y + 17}" text-anchor="end">${esc(r.n.length > 17 ? r.n.slice(0, 16) + '…' : r.n)}</text>
      <rect x="${L}" y="${y + 2}" width="${w(r.vp)}" height="10" fill="#d4d0d4"/><rect x="${L}" y="${y + 13}" width="${w(r.vy)}" height="10" fill="#111"/>
      <text x="${L + w(r.vy) + 5}" y="${y + 22}">${short(r.vy)}</text><rect data-i="${i}" x="0" y="${y}" width="${W}" height="${rh}" fill="transparent"/>`;
  }).join('');
  const el = $('#bars'); el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%">${g}</svg>`;
  el.onmousemove = (e) => { const r = e.target.closest('rect[data-i]'); if (!r) return hideTip(); const o = rows[+r.dataset.i]; showTip(e, `<b>${esc(o.n)}</b><br>${c.Y}: ${eur0.format(o.vy)}<br>${c.P}: ${eur0.format(o.vp)}`); };
  el.onmouseleave = hideTip;
}

/* ---------------- Importação ---------------- */
const dlg = $('#dlg');
let pending = {};
$('#btnImport').onclick = () => { resetImport(); dlg.showModal(); };
function resetImport() {
  pending = {}; $('#preview').innerHTML = ''; setMsg(''); $('#btnDo').disabled = true; $('#btnDo').textContent = 'Importar'; $('#file').value = '';
  $('#pwRow').hidden = Store.mode !== 'remote'; renderExisting();
}
function setMsg(t, kind = '') { const m = $('#msg'); m.hidden = !t; m.className = 'msg ' + kind; m.innerHTML = t; }
const drop = $('#drop');
drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
drop.ondragleave = () => drop.classList.remove('over');
drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); handleFiles([...e.dataTransfer.files]); };
$('#file').onchange = (e) => handleFiles([...e.target.files]);

async function handleFiles(files) {
  files = files.filter((f) => /\.xlsx$/i.test(f.name));
  if (!files.length) return setMsg('Escolhe ficheiros .xlsx.', 'err');
  setMsg('A ler ' + files.length + ' ficheiro(s)…'); $('#btnDo').disabled = true;
  const all = [], issues = [], filesBy = {};
  for (const f of files) {
    try {
      const n = Core.normalizeRows(await Core.readXlsx(await f.arrayBuffer()));
      if (n.fatal) { issues.push(`<b>${esc(f.name)}</b>: ${n.issues.join('; ')}`); continue; }
      n.issues.forEach((i) => issues.push(`<b>${esc(f.name)}</b>: ${i}`));
      const yms = new Set();
      for (const r of n.records) { all.push(r); yms.add(r.ym); }
      yms.forEach((ym) => (filesBy[ym] = [...(filesBy[ym] || []), f.name]));
    } catch (e) { issues.push(`<b>${esc(f.name)}</b>: ${esc(e.message)}`); }
  }
  pending = Core.buildMonths(all);
  const yms = Object.keys(pending).sort();
  const ex = Object.fromEntries(S.months.map((m) => [m.ym, m]));
  $('#preview').innerHTML = yms.length ? `<table><thead><tr><th class="l">Mês</th><th>Linhas</th><th>Faturação</th><th class="l">Estado</th><th class="l">Ficheiro</th></tr></thead><tbody>${yms.map((ym) => {
    const m = pending[ym], e = ex[ym], multi = filesBy[ym].length > 1;
    return `<tr><td class="l">${MESES[+ym.slice(5) - 1]}/${ym.slice(0, 4)}</td><td>${int.format(m.stats.linhas)}</td><td>${eur0.format(m.stats.valor)}</td><td class="l">${e ? `<span class="warn">substitui (antes: ${int.format(e.stats.linhas)} linhas, ${eur0.format(e.stats.valor)})</span>` : 'novo'}</td><td class="l">${esc(filesBy[ym].join(', '))}${multi ? ' <span class="warn">⚠ mês em vários ficheiros: foram somados</span>' : ''}</td></tr>`;
  }).join('')}</tbody></table>` : '';
  setMsg(issues.join('<br>'), issues.length && !yms.length ? 'err' : '');
  $('#btnDo').disabled = !yms.length; $('#btnDo').textContent = yms.length ? `Importar ${yms.length} mês(es)` : 'Importar';
}

$('#btnDo').onclick = async () => {
  const yms = Object.keys(pending).sort(), pw = $('#pw').value;
  if (Store.mode === 'remote' && !pw) return setMsg('Escreve a palavra-passe de administração.', 'err');
  $('#btnDo').disabled = true;
  try {
    for (let i = 0; i < yms.length; i++) { setMsg(`A guardar ${yms[i]} (${i + 1}/${yms.length})…`); await Store.save(pending[yms[i]], pw); }
    S.months = await Store.load(); afterData();
    resetImport(); setMsg(`✔ ${yms.length} mês(es) importado(s). O dashboard já está atualizado.`, 'ok');
  } catch (e) { setMsg('Falhou: ' + esc(e.message), 'err'); $('#btnDo').disabled = false; }
};

function renderExisting() {
  const l = $('#existingList');
  l.innerHTML = S.months.length ? `<table><tbody>${[...S.months].sort((a, b) => b.ym.localeCompare(a.ym)).map((m) => `<tr><td class="l">${MESES[+m.ym.slice(5) - 1]}/${m.ym.slice(0, 4)}</td><td>${int.format(m.stats.linhas)} linhas</td><td>${eur0.format(m.stats.valor)}</td><td><button class="link" data-del="${m.ym}">eliminar</button></td></tr>`).join('')}</tbody></table>` : '<p class="muted">Nada carregado.</p>';
  l.onclick = async (e) => {
    const ym = e.target.dataset.del; if (!ym || !confirm('Eliminar o mês ' + ym + '?')) return;
    try { await Store.remove(ym, $('#pw').value); S.months = await Store.load(); afterData(); renderExisting(); setMsg('Mês ' + ym + ' eliminado.', 'ok'); } catch (er) { setMsg('Falhou: ' + esc(er.message), 'err'); }
  };
}

boot();
