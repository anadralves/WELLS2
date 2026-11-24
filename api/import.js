const crypto = require('crypto');
const store = require('./_store');

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();
const YM = /^\d{4}-(0[1-9]|1[0-2])$/;

function validMonth(m) {
  return m && YM.test(m.ym) && Array.isArray(m.lojas) && Array.isArray(m.arts) && Array.isArray(m.tipos) && Array.isArray(m.rows) &&
    m.rows.every((r) => Array.isArray(r) && r.length === 5 && r[0] < m.lojas.length && r[1] < m.arts.length && r[2] < m.tipos.length && isFinite(r[3]) && isFinite(r[4]));
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
  if (!store.configured()) return res.status(503).json({ error: 'not_configured' });
  const admin = process.env.ADMIN_PASSWORD;
  if (!admin) return res.status(503).json({ error: 'no_admin_password' });
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }
  if (!body) return res.status(400).json({ error: 'bad_body' });
  if (!crypto.timingSafeEqual(sha(body.password || ''), sha(admin))) return res.status(401).json({ error: 'wrong_password' });
  try {
    if (body.action === 'delete') {
      if (!YM.test(body.ym || '')) return res.status(400).json({ error: 'bad_month' });
      await store.deleteMonth(body.ym);
      return res.status(200).json({ ok: true });
    }
    if (!validMonth(body.month)) return res.status(400).json({ error: 'bad_month' });
    await store.saveMonth(body.month);
    res.status(200).json({ ok: true, ym: body.month.ym });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
};
