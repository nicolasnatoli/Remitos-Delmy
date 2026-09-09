# App.Deposito — Depósito Delmy

App de control de recepción de mercadería: escaneo de remitos/facturas (con
lectura automática vía Claude Vision), generación de hoja de control
imprimible, impresión de etiquetas térmicas, y validación del comprobante
firmado por el transportista.

## Stack

- Flask + Postgres (Neon)
- Claude Vision API para leer remitos/facturas escaneados
- PyMuPDF para generar los PDF de hoja de control y etiquetas

## Variables de entorno

Ver `.env.example`. En Vercel hace falta configurar `DATABASE_URL`,
`SECRET_KEY` y `ANTHROPIC_API_KEY` en Settings → Environment Variables.

## Desarrollo local

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python app.py
```
