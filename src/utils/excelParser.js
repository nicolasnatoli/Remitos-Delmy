// ===== PARSER EXCEL — MÓDULO B =====
import * as XLSX from 'xlsx';

export async function parseExcelRemitos(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array', cellDates: true });
        const ws = wb.Sheets[wb.SheetNames[0]];
        // Fila 1 = título, fila 2 = headers → datos desde fila 3
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
        if (rows.length < 3) { resolve({}); return; }

        const headers = rows[1].map(h => String(h).trim());
        const dataRows = rows.slice(2);

        // Mapeo de columnas
        const col = (name) => headers.findIndex(h => h.toLowerCase().includes(name.toLowerCase()));
        const iDate    = col('fecha de creación') !== -1 ? col('fecha de creación') : col('fecha de creacion');
        const iHora    = col('hora');
        const iFechaEnt= col('fecha de entrega');
        const iFechaRec= col('fecha de recepción') !== -1 ? col('fecha de recepción') : col('fecha de recepcion');
        const iCat     = col('categoría') !== -1 ? col('categoría') : col('categoria');
        const iRemito  = col('remito');
        const iOrigen  = col('sucursal de origen');
        const iDestino = col('cliente');
        const iEstado  = col('estado');
        const iFechaAn = col('fecha de anulación') !== -1 ? col('fecha de anulación') : col('anulacion');
        const iObs     = col('observaciones');
        // Búsqueda flexible — el Excel puede tener variaciones de encoding
        const iCod  = col('digo') !== -1 ? col('digo')   // có-digo sin tilde inicial
                    : col('codigo') !== -1 ? col('codigo')
                    : col('código') !== -1 ? col('código')
                    : headers.findIndex(h => /cod/i.test(h) && !/sucursal|estado|anulac/i.test(h));
        const iDesc = col('descripci') !== -1 ? col('descripci')
                    : col('descripcion') !== -1 ? col('descripcion')
                    : col('descripción') !== -1 ? col('descripción')
                    : headers.findIndex(h => /desc/i.test(h));
        const iCant = col('cantidad') !== -1 ? col('cantidad')
                    : headers.findIndex(h => /cant/i.test(h));

        // Debug — mostrar headers y columnas detectadas (solo primera carga)
        console.log('[ExcelParser] Headers:', headers);
        console.log('[ExcelParser] Cols detectadas:', {
          fecha:iDate, hora:iHora, cat:iCat, remito:iRemito,
          origen:iOrigen, destino:iDestino, estado:iEstado,
          obs:iObs, cod:iCod, desc:iDesc, cant:iCant
        });
        const primeraFila = dataRows[0];
        if(primeraFila) console.log('[ExcelParser] Primera fila:', primeraFila);

        const remitoMap = {};

        for (const row of dataRows) {
          const nRemito = String(row[iRemito] || '').trim();
          if (!nRemito) continue;

          const toDate = (v) => {
            if (!v) return '';
            if (v instanceof Date) return v.toISOString().split('T')[0];
            const s = String(v).trim();
            // DD/MM/YYYY
            const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
            if (m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
            return s;
          };

          if (!remitoMap[nRemito]) {
            remitoMap[nRemito] = {
              remito:         nRemito,
              fecha:          toDate(row[iDate]),
              hora:           String(row[iHora] || '').trim(),
              fechaEntrega:   toDate(row[iFechaEnt]),
              fechaRecepcion: toDate(row[iFechaRec]),
              tipo:           'Envío a sucursal',
              categoria:      String(row[iCat]  || '').trim().toUpperCase(),
              origen:         String(row[iOrigen]  || '').trim(),
              destino:        String(row[iDestino] || '').trim(),
              estado:         String(row[iEstado]  || '').trim(),
              fechaAnulacion: toDate(row[iFechaAn]),
              obs:            String(row[iObs] || '').trim(),
              lineas:         [],
            };
          }

          const cod  = String(row[iCod]  || '').trim();
          const desc = String(row[iDesc] || '').trim();
          const cant = Number(row[iCant] || 0);
          if (cod) {
            remitoMap[nRemito].lineas.push({ cod, desc, cant });
          }
        }

        resolve(remitoMap);
      } catch(err) {
        reject(err);
      }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}
