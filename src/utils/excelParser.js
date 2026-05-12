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
        // Detección de columnas — tolerante a acentos y columnas extra
        const normalize = s => String(s||'').toLowerCase()
          .normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim();
        const nHeaders = headers.map(normalize);
        const nCol = term => nHeaders.findIndex(h => h.includes(normalize(term)));

        // Código: buscar por header, si no encontrado usar posición conocida (col 22 en export estándar)
        const iCodByHeader = nCol('codigo') !== -1 ? nCol('codigo')
          : headers.findIndex((h,i) => normalize(h) === 'codigo' || (normalize(h).startsWith('cod') && !normalize(h).includes('sucursal') && !normalize(h).includes('estado') && !normalize(h).includes('postal')));
        
        // Si el header falla, detectar por contenido de primera fila de datos
        // El código del artículo es alfanumérico corto, la descripción es texto largo
        // En el export de Delmy: cod=col22, desc=col23, cant=col27
        const totalCols = headers.length;
        const iCod  = iCodByHeader !== -1 ? iCodByHeader 
                    : totalCols >= 23 ? 22 : nCol('cod');
        const iDesc = nCol('descripcion') !== -1 ? nCol('descripcion')
                    : nCol('desc') !== -1 ? nCol('desc')
                    : totalCols >= 24 ? 23 : -1;
        // Cantidad: en export estándar col27, pero buscar primero por header
        const iCantByHeader = nCol('cantidad') !== -1 ? nCol('cantidad') : nCol('cant');
        const iCant = iCantByHeader !== -1 ? iCantByHeader
                    : totalCols >= 28 ? 27 : -1;
        // Observaciones: puede estar en col 13 en el export extendido
        const iObsDetected = nCol('observacion') !== -1 ? nCol('observacion') : iObs;

        console.log('[ExcelParser] totalCols:', totalCols, '| iCod:', iCod, '| iDesc:', iDesc, '| iCant:', iCant, '| iObs:', iObsDetected);
        if(dataRows[0]) console.log('[ExcelParser] Fila1[cod]:', dataRows[0][iCod], '| desc:', dataRows[0][iDesc], '| cant:', dataRows[0][iCant]);

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
              obs:            String(row[iObsDetected] || '').trim(),
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
