const store = require('./_store');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!store.configured()) return res.status(503).json({ error: 'not_configured' });
  try {
    const months = await store.getAllMonths();
    res.status(200).json({ months, writable: !!process.env.ADMIN_PASSWORD });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
};
