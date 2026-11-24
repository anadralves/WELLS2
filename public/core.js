/* core.js — leitura de Excel, agregação mensal e cálculo dos indicadores.
   Funciona no browser e em Node 18+ (sem dependências). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Core = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------- Leitor de .xlsx (zip + xml) ---------- */
  const td = new TextDecoder('utf-8');

  async function inflateRaw(u8) {
    const ds = new DecompressionStream('deflate-raw');
    const stream = new Blob([u8]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  function unzipIndex(u8) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let e = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 70000); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { e = i; break; }
    }
    if (e < 0) throw new Error('Ficheiro inválido (não é um .xlsx).');
    const n = dv.getUint16(e + 10, true);
    let p = dv.getUint32(e + 16, true);
    const files = {};
    for (let i = 0; i < n; i++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true);
      const csize = dv.getUint32(p + 20, true);
      const fnl = dv.getUint16(p + 28, true), exl = dv.getUint16(p + 30, true), cml = dv.getUint16(p + 32, true);
      const off = dv.getUint32(p + 42, true);
      const name = td.decode(u8.subarray(p + 46, p + 46 + fnl));
      files[name] = { method, csize, off };
      p += 46 + fnl + exl + cml;
    }
    return files;
  }

  async function unzipFile(u8, files, name) {
    const f = files[name];
    if (!f) return null;
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const start = f.off + 30 + dv.getUint16(f.off + 26, true) + dv.getUint16(f.off + 28, true);
    const data = u8.subarray(start, start + f.csize);
    return f.method === 0 ? data : inflateRaw(data);
  }

  function unescapeXml(s) {
    return s.replace(/&(#x?[0-9a-fA-F]+|amp|lt|gt|quot|apos);/g, (m, g) => {
      if (g[0] === '#') return String.fromCodePoint(g[1] === 'x' ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10));
      return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[g];
    });
  }
  const colIndex = (ref) => { let n = 0; for (const ch of ref) { const c = ch.charCodeAt(0); if (c < 65 || c > 90) break; n = n * 26 + (c - 64); } return n - 1; };

  async function readXlsx(arrayBuffer) {
    const u8 = new Uint8Array(arrayBuffer);
    const files = unzipIndex(u8);
    const txt = async (n) => { const d = await unzipFile(u8, files, n); return d ? td.decode(d) : null; };

    // folha a usar: a primeira do workbook
    let sheetPath = 'xl/worksheets/sheet1.xml';
    const wb = await txt('xl/workbook.xml'), rels = await txt('xl/_rels/workbook.xml.rels');
    if (wb && rels) {
      const m = /<sheet\b[^>]*?r:id="([^"]+)"/.exec(wb);
      if (m) {
        for (const r of rels.match(/<Relationship\b[^>]*>/g) || []) {
          if (new RegExp('Id="' + m[1] + '"').test(r)) {
            const t = /Target="([^"]+)"/.exec(r);
            if (t) sheetPath = t[1].replace(/^\//, '').replace(/^(?!xl\/)/, 'xl/');
          }
        }
      }
    }
    if (!files[sheetPath]) {
      const any = Object.keys(files).find((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k));
      if (!any) throw new Error('Não encontrei nenhuma folha no ficheiro.');
      sheetPath = any;
    }

    const shared = [];
    const ss = await txt('xl/sharedStrings.xml');
    if (ss) {
      for (const si of ss.match(/<si\b[\s\S]*?<\/si>|<si\s*\/>/g) || []) {
        let s = '';
        const clean = si.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
        clean.replace(/<t\b[^>]*>([\s\S]*?)<\/t>/g, (_, g) => { s += g; return ''; });
        shared.push(unescapeXml(s));
      }
    }

    const xml = await txt(sheetPath);
    const rows = [];
    const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
    let rm;
    while ((rm = rowRe.exec(xml))) {
      const arr = [];
      const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
      let cm;
      while ((cm = cellRe.exec(rm[1]))) {
        const attrs = cm[1], body = cm[2] || '';
        const r = /\br="([A-Z]+)\d+"/.exec(attrs);
        if (!r) continue;
        const t = (/\bt="([^"]+)"/.exec(attrs) || [])[1];
        let val = null;
        if (t === 'inlineStr') {
          let s = ''; body.replace(/<t\b[^>]*>([\s\S]*?)<\/t>/g, (_, g) => { s += g; return ''; }); val = unescapeXml(s);
        } else {
          const v = /<v>([\s\S]*?)<\/v>/.exec(body);
          if (v) {
            if (t === 's') val = shared[+v[1]];
            else if (t === 'str') val = unescapeXml(v[1]);
            else if (t === 'b') val = v[1] === '1';
            else if (t === 'e') val = null;
            else val = parseFloat(v[1]);
          }
        }
        arr[colIndex(r[1])] = val;
      }
      rows.push(arr);
    }
    return rows; // matriz de linhas (a 1.ª é o cabeçalho)
  }

  /* ---------- Normalização das linhas ---------- */
  const strip = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const REQUIRED = { data: 'Data', lojaentreposto: 'LojaEntreposto', codartigo: 'CodArtigo', dscartigo: 'DscArtigo', tipoartigo: 'TipoArtigo', marca: 'Marca', quant: 'Quant', valor: 'Valor' };
  const OPTIONAL = { categoria: 'Categoria' };

  function parseYm(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') {
      if (v > 20000) { const d = new Date(Math.round((v - 25569) * 86400000)); return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0'); }
      return null;
    }
    const s = String(v).trim();
    let m = /^(\d{1,2})\/(\d{4})$/.exec(s); if (m) return m[2] + '-' + m[1].padStart(2, '0');
    m = /^(\d{4})-(\d{1,2})/.exec(s); if (m) return m[1] + '-' + m[2].padStart(2, '0');
    m = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})/.exec(s); if (m) return m[3] + '-' + m[2].padStart(2, '0');
    return null;
  }

  /** matriz -> {records:[{ym,loja,lojaNome,cod,desc,marca,cat,tipo,q,v}], issues:[], skipped} */
  function normalizeRows(matrix) {
    const issues = [];
    const hdr = (matrix[0] || []).map((h) => (h == null ? '' : strip(h)));
    const idx = {};
    for (const [k, name] of Object.entries({ ...REQUIRED, ...OPTIONAL })) idx[name] = hdr.indexOf(k);
    const missing = Object.values(REQUIRED).filter((n) => idx[n] < 0);
    if (missing.length) return { records: [], issues: ['Faltam colunas: ' + missing.join(', ')], skipped: 0, fatal: true };
    const records = [];
    let skipped = 0, badDate = 0;
    for (let i = 1; i < matrix.length; i++) {
      const r = matrix[i];
      if (!r || r.every((x) => x == null || x === '')) continue;
      const ym = parseYm(r[idx.Data]);
      const loja = r[idx.LojaEntreposto];
      const v = Number(r[idx.Valor]), q = Number(r[idx.Quant]);
      if (!ym) { if (r[idx.Data] != null && r[idx.Data] !== '') badDate++; skipped++; continue; }
      if (loja == null || loja === '' || !isFinite(v) || !isFinite(q)) { skipped++; continue; }
      const ls = String(loja).trim();
      const lm = /^(L\d+)\s*-\s*(.*)$/i.exec(ls);
      let cod = r[idx.CodArtigo];
      cod = typeof cod === 'number' ? String(Math.round(cod)) : String(cod == null ? '' : cod).trim();
      records.push({
        ym, loja: lm ? lm[1].toUpperCase() : ls, lojaNome: lm ? lm[2].trim() : ls,
        cod, desc: String(r[idx.DscArtigo] == null ? '' : r[idx.DscArtigo]).trim(),
        marca: String(r[idx.Marca] == null ? '' : r[idx.Marca]).trim(),
        cat: idx.Categoria >= 0 && r[idx.Categoria] != null ? String(r[idx.Categoria]).trim() : '',
        tipo: String(r[idx.TipoArtigo] == null ? '' : r[idx.TipoArtigo]).trim(), q, v,
      });
    }
    if (skipped) issues.push(skipped + ' linha(s) ignorada(s) (vazias ou sem data/loja/valor)' + (badDate ? ', ' + badDate + ' com data ilegível' : ''));
    return { records, issues, skipped };
  }

  const r2 = (x) => Math.round(x * 100) / 100;

  /** records -> { 'YYYY-MM': payload } (um payload por mês, agregado por loja+artigo+tipo) */
  function buildMonths(records) {
    const byYm = new Map();
    for (const r of records) { if (!byYm.has(r.ym)) byYm.set(r.ym, []); byYm.get(r.ym).push(r); }
    const out = {};
    for (const [ym, recs] of byYm) {
      const lojas = new Map(), arts = new Map(), tipos = new Map(), agg = new Map();
      for (const r of recs) {
        if (!lojas.has(r.loja)) lojas.set(r.loja, [lojas.size, r.lojaNome]);
        if (!arts.has(r.cod)) arts.set(r.cod, [arts.size, r.desc, r.marca, r.cat]);
        if (!tipos.has(r.tipo)) tipos.set(r.tipo, tipos.size);
        const li = lojas.get(r.loja)[0], ai = arts.get(r.cod)[0], ti = tipos.get(r.tipo);
        const k = li + '|' + ai + '|' + ti;
        const a = agg.get(k);
        if (a) { a[3] += r.q; a[4] += r.v; } else agg.set(k, [li, ai, ti, r.q, r.v]);
      }
      const rows = [...agg.values()].map((a) => [a[0], a[1], a[2], r2(a[3]), r2(a[4])]);
      out[ym] = {
        ym,
        lojas: [...lojas].map(([c, [, n]]) => [c, n]),
        arts: [...arts].map(([c, [, d, m, ct]]) => [c, d, m, ct]),
        tipos: [...tipos.keys()],
        rows,
        stats: { linhas: recs.length, valor: r2(recs.reduce((s, r) => s + r.v, 0)), quant: r2(recs.reduce((s, r) => s + r.q, 0)) },
      };
    }
    return out;
  }

  /* ---------- Dataset em memória ---------- */
  function buildDataset(months) {
    const yms = months.map((m) => m.ym).sort();
    const by = Object.fromEntries(months.map((m) => [m.ym, m]));
    const lojas = [], lojaIx = new Map(), arts = [], artIx = new Map(), tipos = [], tipoIx = new Map();
    let n = 0;
    for (const ym of yms) n += by[ym].rows.length;
    const ymA = new Int32Array(n), liA = new Int32Array(n), aiA = new Int32Array(n), tiA = new Uint8Array(n), qA = new Float64Array(n), vA = new Float64Array(n);
    let p = 0;
    for (const ym of yms) {          // meses mais recentes sobrepõem nomes/descrições
      const m = by[ym], y = +ym.slice(0, 4) * 100 + +ym.slice(5, 7);
      const lm = m.lojas.map(([c, nm]) => {
        if (!lojaIx.has(c)) { lojaIx.set(c, lojas.length); lojas.push({ code: c, name: nm }); } else lojas[lojaIx.get(c)].name = nm;
        return lojaIx.get(c);
      });
      const am = m.arts.map(([c, d, mk, ct]) => {
        if (!artIx.has(c)) { artIx.set(c, arts.length); arts.push({ cod: c, desc: d, marca: mk, cat: ct }); } else Object.assign(arts[artIx.get(c)], { desc: d, marca: mk, cat: ct });
        return artIx.get(c);
      });
      const tm = m.tipos.map((t) => { if (!tipoIx.has(t)) { tipoIx.set(t, tipos.length); tipos.push(t); } return tipoIx.get(t); });
      for (const r of m.rows) { ymA[p] = y; liA[p] = lm[r[0]]; aiA[p] = am[r[1]]; tiA[p] = tm[r[2]]; qA[p] = r[3]; vA[p] = r[4]; p++; }
    }
    const years = [...new Set(yms.map((s) => +s.slice(0, 4)))].sort((a, b) => a - b);
    return { n, ym: ymA, li: liA, ai: aiA, ti: tiA, q: qA, v: vA, lojas, arts, tipos, years, yms };
  }

  /* ---------- Indicadores ---------- */
  const ONLINE_RE = /online/i;
  const isOnline = (l) => ONLINE_RE.test(l.name);

  function norm(s) { return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }

  /**
   * f: {view:'TOTAL'|'ONLINE'|'LOJAS', lojas:Set, marcas:Set, tipos:Set, cats:Set, artText:'', codText:''}
   * Y: ano; months: Set de meses (1-12) ou null => 1..último mês com dados em Y
   */
  function compute(ds, f, Y, months) {
    const P = Y - 1;
    let last = 0;
    for (let i = 0; i < ds.n; i++) if (Math.floor(ds.ym[i] / 100) === Y) last = Math.max(last, ds.ym[i] % 100);
    const sel = months && months.size ? months : new Set(Array.from({ length: last }, (_, i) => i + 1));
    const okL = new Uint8Array(ds.lojas.length), okA = new Uint8Array(ds.arts.length), okT = new Uint8Array(ds.tipos.length);
    ds.lojas.forEach((l, i) => {
      let ok = f.view === 'ONLINE' ? isOnline(l) : f.view === 'LOJAS' ? !isOnline(l) : true;
      if (ok && f.lojas && f.lojas.size && !f.lojas.has(l.code)) ok = false;
      okL[i] = ok ? 1 : 0;
    });
    const at = f.artText ? norm(f.artText) : '', ct = f.codText ? f.codText.trim() : '';
    ds.arts.forEach((a, i) => {
      let ok = true;
      if (f.marcas && f.marcas.size && !f.marcas.has(a.marca)) ok = false;
      if (ok && f.cats && f.cats.size && !f.cats.has(a.cat)) ok = false;
      if (ok && at && !norm(a.desc).includes(at)) ok = false;
      if (ok && ct && !a.cod.includes(ct)) ok = false;
      okA[i] = ok ? 1 : 0;
    });
    ds.tipos.forEach((t, i) => { okT[i] = !f.tipos || !f.tipos.size || f.tipos.has(t) ? 1 : 0; });

    const monthY = new Float64Array(13), monthP = new Float64Array(13);
    const lj = new Map(), ar = new Map();
    const tot = { vy: 0, vp: 0, qy: 0, qp: 0 };
    const bump = (map, key, isY, q, v) => {
      let o = map.get(key); if (!o) { o = { vy: 0, vp: 0, qy: 0, qp: 0 }; map.set(key, o); }
      if (isY) { o.vy += v; o.qy += q; } else { o.vp += v; o.qp += q; }
    };
    for (let i = 0; i < ds.n; i++) {
      const y = Math.floor(ds.ym[i] / 100);
      if (y !== Y && y !== P) continue;
      if (!okL[ds.li[i]] || !okA[ds.ai[i]] || !okT[ds.ti[i]]) continue;
      const m = ds.ym[i] % 100, isY = y === Y;
      (isY ? monthY : monthP)[m] += ds.v[i];
      if (!sel.has(m)) continue;
      if (isY) { tot.vy += ds.v[i]; tot.qy += ds.q[i]; } else { tot.vp += ds.v[i]; tot.qp += ds.q[i]; }
      bump(lj, ds.li[i], isY, ds.q[i], ds.v[i]);
      bump(ar, ds.ai[i], isY, ds.q[i], ds.v[i]);
    }
    return { Y, P, last, sel, monthY, monthP, tot, lojas: lj, arts: ar };
  }

  return { readXlsx, normalizeRows, buildMonths, buildDataset, compute, isOnline, parseYm };
});
