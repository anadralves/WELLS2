// Uso: node test/verify.js "<pasta com os .xlsx>"
const fs = require('fs'), path = require('path'), Core = require('../public/core.js');
(async () => {
  const dir = process.argv[2];
  const recs = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.xlsx')).sort()) {
    const b = fs.readFileSync(path.join(dir, f));
    const m = await Core.readXlsx(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
    const n = Core.normalizeRows(m);
    console.log(f.padEnd(14), 'linhas', String(n.records.length).padStart(6), n.issues.join(';'));
    for (const r of n.records) recs.push(r);
  }
  const months = Core.buildMonths(recs);
  const list = Object.values(months);
  let tot = 0; for (const m of list) tot += m.stats.valor;
  console.log('meses', list.length, 'linhas agregadas', list.reduce((s, m) => s + m.rows.length, 0), 'valor total', tot.toFixed(2));
  for (const k of ['2023-01', '2024-04', '2025-07', '2026-09']) console.log(k, months[k].stats, 'json KB', (JSON.stringify(months[k]).length / 1024).toFixed(0));
  console.log('json total MB', (JSON.stringify(list).length / 1048576).toFixed(2));
  const ds = Core.buildDataset(list);
  const c = Core.compute(ds, { view: 'TOTAL' }, 2026, null);
  console.log('2026 vs 2025 (jan..' + c.last + ')', c.tot, 'lojas', c.lojas.size, 'artigos', c.arts.size);
  const o = Core.compute(ds, { view: 'ONLINE' }, 2026, null); console.log('ONLINE', o.tot);
  const l = Core.compute(ds, { view: 'LOJAS' }, 2026, null); console.log('LOJAS', l.tot, 'soma', l.tot.vy + o.tot.vy, 'vs total', c.tot.vy);
  fs.writeFileSync('/tmp/months.json', JSON.stringify(list));
})().catch((e) => { console.error(e); process.exit(1); });
