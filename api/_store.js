// Armazenamento dos meses importados.
//  - Em produção (Vercel): base de dados Upstash Redis via REST (variáveis KV_REST_API_URL / KV_REST_API_TOKEN).
//  - Em local (node server.js): ficheiros JSON na pasta ./dados-locais.
const fs = require('fs');
const path = require('path');

const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const LOCAL = process.env.LOCAL_DATA_DIR;
const KEY = (ym) => 'wells:m:' + ym;
const SET = 'wells:months';

const configured = () => !!(LOCAL || (URL_ && TOKEN));

async function pipeline(cmds) {
  const r = await fetch(URL_.replace(/\/$/, '') + '/pipeline', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmds),
  });
  if (!r.ok) throw new Error('Base de dados respondeu ' + r.status);
  const out = await r.json();
  const bad = out.find((x) => x.error);
  if (bad) throw new Error(bad.error);
  return out.map((x) => x.result);
}

async function getAllMonths() {
  if (LOCAL) {
    if (!fs.existsSync(LOCAL)) return [];
    return fs.readdirSync(LOCAL).filter((f) => /^\d{4}-\d{2}\.json$/.test(f)).sort()
      .map((f) => JSON.parse(fs.readFileSync(path.join(LOCAL, f), 'utf8')));
  }
  const [yms] = await pipeline([['SMEMBERS', SET]]);
  if (!yms || !yms.length) return [];
  yms.sort();
  const res = await pipeline(yms.map((ym) => ['GET', KEY(ym)]));
  return res.filter(Boolean).map((s) => JSON.parse(s));
}

async function saveMonth(m) {
  if (LOCAL) {
    fs.mkdirSync(LOCAL, { recursive: true });
    fs.writeFileSync(path.join(LOCAL, m.ym + '.json'), JSON.stringify(m));
    return;
  }
  await pipeline([['SET', KEY(m.ym), JSON.stringify(m)], ['SADD', SET, m.ym]]);
}

async function deleteMonth(ym) {
  if (LOCAL) { const f = path.join(LOCAL, ym + '.json'); if (fs.existsSync(f)) fs.unlinkSync(f); return; }
  await pipeline([['DEL', KEY(ym)], ['SREM', SET, ym]]);
}

module.exports = { configured, getAllMonths, saveMonth, deleteMonth };
