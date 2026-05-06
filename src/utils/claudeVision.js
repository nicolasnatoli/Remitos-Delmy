// ===== CLAUDE VISION API — MÓDULO A =====
// Extracción automática de facturas/remitos de proveedores

export const PROVEEDORES = [
  'ORIENTAL PARTY S.R.L.', 'BECHAR SRL', 'LEDEVIT', 'DISTRIBUIDORA NORTE',
  'PAPELY MÁS SRL', 'JUGUETEX SA', 'GOLOSINAS DEL SUR', 'REPOSTERÍA TOTAL',
  'COTILLÓN MAYORISTA', 'LIBRERÍA CENTRAL SA', 'ALFAPLAST SRL', 'COLORTEX',
  'PAPELERA QUILMES', 'DISTRIB. BELGRANO', 'MEGA TOYS SRL', 'CARNAVAL SHOP',
  'PASTELART', 'GLOBOMANIA', 'EDITORIAL KAPELUZ', 'SIN PROVEEDOR',
];

export async function extractFromDocument(fileBase64, mediaType, apiKey) {
  const prompt = `Sos un asistente de extracción de datos para un sistema de gestión de compras.
Analizá el documento y extraé EXACTAMENTE la siguiente información en formato JSON (sin markdown):

{
  "proveedor": "nombre del proveedor (string)",
  "documento": "número de factura o remito (string, ej: 0001-00012345)",
  "fechaDoc": "fecha del documento (string, formato DD/MM/YYYY)",
  "lineas": [
    { "cod": "código de artículo", "desc": "descripción", "cant": número }
  ],
  "confianza": "alta | media | baja"
}

Proveedores conocidos: ${PROVEEDORES.join(', ')}

Si no podés leer algo con certeza, dejalo vacío. No inventes datos.
Respondé SOLO con el JSON, sin texto adicional.`;

  const body = {
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2000,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'image',
          source: { type: 'base64', media_type: mediaType, data: fileBase64 },
        },
        { type: 'text', text: prompt },
      ],
    }],
  };

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Error API: ${res.status}`);
  }

  const data = await res.json();
  const text = data.content.map(b => b.text || '').join('');
  const clean = text.replace(/```json|```/g, '').trim();
  return JSON.parse(clean);
}

// Convierte PDF a imagen usando canvas (primera página)
export async function pdfToBase64(file) {
  // Para PDF usamos document como tipo
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const base64 = e.target.result.split(',')[1];
      resolve({ base64, mediaType: 'application/pdf' });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export async function imageToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const base64 = e.target.result.split(',')[1];
      resolve({ base64, mediaType: file.type });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Llamada con soporte PDF (envía como document)
export async function extractFromDocumentSmart(file, apiKey) {
  const isPdf = file.type === 'application/pdf';

  if (isPdf) {
    const { base64 } = await pdfToBase64(file);
    const prompt = `Sos un asistente de extracción de datos para un sistema de gestión de compras.
Analizá el documento y extraé la siguiente información en formato JSON (sin markdown):

{
  "proveedor": "nombre del proveedor",
  "documento": "número de factura o remito (ej: 0001-00012345)",
  "fechaDoc": "fecha DD/MM/YYYY",
  "lineas": [
    { "cod": "código", "desc": "descripción", "cant": número }
  ],
  "confianza": "alta | media | baja"
}

Proveedores conocidos: ${PROVEEDORES.join(', ')}
Respondé SOLO con el JSON.`;

    const body = {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: base64 },
          },
          { type: 'text', text: prompt },
        ],
      }],
    };

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `Error API: ${res.status}`);
    }

    const data = await res.json();
    const text = data.content.map(b => b.text || '').join('');
    const clean = text.replace(/```json|```/g, '').trim();
    return JSON.parse(clean);
  } else {
    const { base64, mediaType } = await imageToBase64(file);
    return extractFromDocument(base64, mediaType, apiKey);
  }
}
