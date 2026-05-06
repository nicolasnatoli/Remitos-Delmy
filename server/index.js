// ===== DELMY PARTY SRL — API SERVER + STATIC FRONTEND =====
const express     = require('express');
const cors        = require('cors');
const compression = require('compression');
const path        = require('path');
const { createClient } = require('redis');

const app  = express();
const PORT = process.env.PORT || 3000;

// ─── Redis ────────────────────────────────────────────────────────────────────
const REDIS_URL = process.env.REDIS_URL || process.env.REDIS_PRIVATE_URL || 'redis://localhost:6379';
const redis = createClient({ url: REDIS_URL });
redis.on('error', err => console.error('[Redis]', err.message));
redis.on('connect', ()  => console.log('[Redis] OK'));

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(cors({ origin: '*', methods: ['GET','POST','DELETE','OPTIONS'], allowedHeaders: ['Content-Type','x-delmy-key'] }));

// ─── Auth ─────────────────────────────────────────────────────────────────────
const DELMY_PIN = process.env.DELMY_PIN || null;
function auth(req, res, next) {
  if (!DELMY_PIN) return next();
  if (req.headers['x-delmy-key'] !== DELMY_PIN) return res.status(401).json({ error: 'PIN incorrecto' });
  next();
}

// ─── Claves permitidas ────────────────────────────────────────────────────────
const ALLOWED = new Set([
  'delmy_remitos','delmy_acumulado','delmy_rec_v3',
  'delmy_compras_v2','delmy_stock_db','delmy_stock_meta',
  'delmy_proveedores','delmy_articulos',
]);

// ─── API Routes ───────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => res.json({ ok: true, redis: redis.isReady, ts: new Date().toISOString() }));

app.get('/api/store', auth, async (req, res) => {
  try {
    const keys = await redis.keys('delmy:*');
    const info = await Promise.all(keys.map(async k => {
      const raw = await redis.get(k);
      return { key: k.replace('delmy:',''), kb: raw ? (Buffer.byteLength(raw,'utf8')/1024).toFixed(1) : '0' };
    }));
    res.json({ keys: info, total: info.length });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/store/:key', auth, async (req, res) => {
  const { key } = req.params;
  if (!ALLOWED.has(key)) return res.status(400).json({ error: 'Clave no permitida' });
  try {
    const raw = await redis.get(`delmy:${key}`);
    res.json(raw === null ? { key, value: null, exists: false } : { key, value: JSON.parse(raw), exists: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/store/:key', auth, async (req, res) => {
  const { key } = req.params;
  if (!ALLOWED.has(key)) return res.status(400).json({ error: 'Clave no permitida' });
  const { value } = req.body;
  if (value === undefined) return res.status(400).json({ error: 'Falta value' });
  try {
    await redis.set(`delmy:${key}`, JSON.stringify(value));
    res.json({ ok: true, key });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/store/:key/merge', auth, async (req, res) => {
  const { key } = req.params;
  if (!ALLOWED.has(key)) return res.status(400).json({ error: 'Clave no permitida' });
  const { value: incoming } = req.body;
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming))
    return res.status(400).json({ error: 'value debe ser objeto' });
  try {
    const raw = await redis.get(`delmy:${key}`);
    const existing = raw ? JSON.parse(raw) : {};
    const merged = { ...existing, ...incoming };
    await redis.set(`delmy:${key}`, JSON.stringify(merged));
    res.json({
      ok: true, key,
      added:   Object.keys(incoming).filter(k => !existing[k]).length,
      updated: Object.keys(incoming).filter(k =>  existing[k]).length,
      total:   Object.keys(merged).length,
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/store/:key', auth, async (req, res) => {
  const { key } = req.params;
  if (!ALLOWED.has(key)) return res.status(400).json({ error: 'Clave no permitida' });
  try { await redis.del(`delmy:${key}`); res.json({ ok: true }); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── Serve React build ────────────────────────────────────────────────────────
const BUILD_DIR = path.join(__dirname, '..', 'build');
app.use(express.static(BUILD_DIR));
app.get('*', (req, res) => res.sendFile(path.join(BUILD_DIR, 'index.html')));

// ─── Start ────────────────────────────────────────────────────────────────────
async function start() {
  try {
    await redis.connect();
    app.listen(PORT, () => {
      console.log(`[Delmy] Puerto ${PORT} · PIN: ${DELMY_PIN ? 'configurado' : 'sin PIN'}`);
    });
  } catch(e) {
    console.error('[Startup]', e.message);
    process.exit(1);
  }
}
start();
