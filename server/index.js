// ===== DELMY PARTY SRL — API SERVER + STATIC FRONTEND =====
const express     = require('express');
const cors        = require('cors');
const compression = require('compression');
const path        = require('path');
const { createClient } = require('redis');

const app  = express();
const PORT = process.env.PORT || 3000;

// ─── Redis ────────────────────────────────────────────────────────────────────
const REDIS_URL = process.env.REDIS_URL || process.env.REDIS_PRIVATE_URL || null;
let redis = null;
let redisReady = false;

async function connectRedis() {
  if (!REDIS_URL) {
    console.log('[Redis] Sin URL configurada — modo localStorage');
    return;
  }
  try {
    redis = createClient({ url: REDIS_URL });
    redis.on('error', err => { console.error('[Redis]', err.message); redisReady = false; });
    redis.on('ready', () => { console.log('[Redis] OK'); redisReady = true; });
    redis.on('end',   () => { redisReady = false; });
    await redis.connect();
    redisReady = true;
  } catch(e) {
    console.error('[Redis] No se pudo conectar:', e.message);
    redisReady = false;
  }
}

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(compression());
app.use(express.json({ limit: '25mb', strict: false }));
app.use(express.urlencoded({ limit: '25mb', extended: true }));
app.use(cors({ origin: '*', methods: ['GET','POST','DELETE','OPTIONS'], allowedHeaders: ['Content-Type','x-delmy-key'] }));
// Timeout global extendido para uploads grandes
app.use((req, res, next) => { req.setTimeout(120000); res.setTimeout(120000); next(); });

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
  'dm_art_v3','dm_stk_v3','dm_vs_v3','dm_vq_v3','dm_vm_v3','dm_vh_v3',
  'dm_plan_v3','dm_share_v3','dm_meta_v3','dm_ocs_v3','dm_rec_v3',
  'dm_nuevos_art','dm_pins_v3','dm_oc_estados','dm_lista_compra','dm_combos_v1',
]);

// ─── API Routes ───────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => res.json({
  ok: true, redis: redisReady, ts: new Date().toISOString()
}));

app.get('/api/store', auth, async (req, res) => {
  if (!redisReady) return res.json({ keys: [], total: 0, offline: true });
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
  if (!redisReady) return res.json({ key, value: null, exists: false, offline: true });
  try {
    const raw = await redis.get(`delmy:${key}`);
    res.json(raw === null ? { key, value: null, exists: false } : { key, value: JSON.parse(raw), exists: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/store/:key', auth, async (req, res) => {
  const { key } = req.params;
  if (!ALLOWED.has(key)) return res.status(400).json({ error: 'Clave no permitida' });
  if (!redisReady) return res.json({ ok: false, offline: true });
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
  if (!redisReady) return res.json({ ok: false, offline: true });
  const { value: incoming } = req.body;
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming))
    return res.status(400).json({ error: 'value debe ser objeto' });
  try {
    const raw = await redis.get(`delmy:${key}`);
    const existing = raw ? JSON.parse(raw) : {};
    const merged = { ...existing, ...incoming };
    await redis.set(`delmy:${key}`, JSON.stringify(merged));
    res.json({ ok: true, key, added: Object.keys(incoming).filter(k=>!existing[k]).length, updated: Object.keys(incoming).filter(k=>existing[k]).length, total: Object.keys(merged).length });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/store/:key', auth, async (req, res) => {
  const { key } = req.params;
  if (!ALLOWED.has(key)) return res.status(400).json({ error: 'Clave no permitida' });
  if (!redisReady) return res.json({ ok: false, offline: true });
  try { await redis.del(`delmy:${key}`); res.json({ ok: true }); }
  catch(e) { res.status(500).json({ error: e.message }); }
});


// ─── IA Proxy — extracción de documentos ─────────────────────────────────────
app.post('/api/ia/extract', auth, async (req, res) => {
  // Timeout extendido para Railway — la IA puede tardar hasta 55 segundos
  req.setTimeout(0);
  res.setTimeout(0);
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_KEY) {
    return res.status(503).json({ error: 'ANTHROPIC_API_KEY no configurada en Railway' });
  }
  const { base64, mediaType, prompt } = req.body;
  if (!base64 || !mediaType) {
    return res.status(400).json({ error: 'Falta base64 o mediaType' });
  }
  try {
    const isPdf = mediaType === 'application/pdf';
    const contentBlock = isPdf
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } }
      : { type: 'image',    source: { type: 'base64', media_type: mediaType, data: base64 } };

    const defaultPrompt = `Sos un extractor de datos de facturas. Analizá TODAS las páginas de este documento y extraé TODOS los artículos sin excepción.

REGLAS IMPORTANTES:
- Extraé CADA LÍNEA de artículo — el documento puede tener 100+ artículos en múltiples páginas
- El código del artículo es el número al inicio de cada línea (puede tener 6-14 dígitos, incluidos los que empiezan con ceros como 000000050581)
- La cantidad es el número en la columna "Cant."
- El precio unitario es el número en la columna "P.Unit."
- Ignorá las líneas de transporte/subtotal/total
- Si el código tiene ceros al inicio (ej: 000000050581), incluilos completos

Respondé SOLO con JSON válido, sin markdown, sin explicaciones:
{
  "proveedor": "nombre completo del proveedor",
  "nDocumento": "número de factura/remito",
  "fecha": "DD/MM/YYYY",
  "lineas": [
    {"cod": "código completo", "desc": "descripción completa", "cant": número, "precioUnit": número_o_0}
  ]
}`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 8000,
        messages: [{
          role: 'user',
          content: [contentBlock, { type: 'text', text: prompt || defaultPrompt }],
        }],
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return res.status(response.status).json({ error: err.error?.message || 'Error API Anthropic' });
    }

    const data = await response.json();
    const text = data.content?.find(c => c.type === 'text')?.text || '';
    res.json({ ok: true, text });
  } catch (e) {
    console.error('[IA Extract]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─── Serve React build ────────────────────────────────────────────────────────
const BUILD_DIR = path.join(__dirname, '..', 'build');
app.use(express.static(BUILD_DIR));
app.get('*', (req, res) => res.sendFile(path.join(BUILD_DIR, 'index.html')));

// ─── Start — arranca inmediatamente, Redis se conecta en background ───────────
app.listen(PORT, () => {
  console.log(`[Delmy] Puerto ${PORT} · PIN: ${DELMY_PIN ? 'configurado' : 'sin PIN'}`);
  // Redis se conecta después de que el servidor ya está escuchando
  connectRedis();
});
