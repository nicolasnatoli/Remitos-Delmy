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

        // Detección de columnas con validación por contenido
        const totalCols = headers.length;
        const firstDataRow = dataRows[0] || [];

        // Función: verificar si una columna contiene códigos de artículo válidos
        // (alfanumérico, no solo números, no vacío)
        const esColCodigo = (iCol) => {
          if (iCol < 0 || iCol >= firstDataRow.length) return false;
          const val = String(firstDataRow[iCol]||'').trim();
          return val.length > 0 && val.length < 30 && /[A-Za-z]/.test(val);
        };
        const esColDesc = (iCol) => {
          if (iCol < 0 || iCol >= firstDataRow.length) return false;
          const val = String(firstDataRow[iCol]||'').trim();
          return val.length > 10; // descripciones son largas
        };
        const esColCant = (iCol) => {
          if (iCol < 0 || iCol >= firstDataRow.length) return false;
          const val = firstDataRow[iCol];
          return !isNaN(parseFloat(val)) && parseFloat(val) > 0 && parseFloat(val) < 100000;
        };

        // Buscar código: primero por header, validar con contenido
        let iCod = -1;
        const candidatosCod = [];
        nHeaders.forEach((h,i) => {
          if (h.includes('codigo') || h === 'cod' || h.includes('código'))
            candidatosCod.push(i);
        });
        // Tomar el que realmente tenga códigos alfanuméricos
        for (const i of candidatosCod) {
          if (esColCodigo(i)) { iCod = i; break; }
        }
        // Si ningún candidato funciona, buscar por contenido en toda la fila
        if (iCod === -1) {
          for (let i = 0; i < Math.min(totalCols, 36); i++) {
            if (esColCodigo(i) && !candidatosCod.includes(i)) {
              // Verificar que la siguiente columna sea descripción larga
              if (esColDesc(i+1)) { iCod = i; break; }
            }
          }
        }

        // Descripción: columna siguiente al código, o por header
        let iDesc = nCol('descripcion') !== -1 ? nCol('descripcion') : nCol('desc');
        if (iDesc === -1 && iCod !== -1 && esColDesc(iCod + 1)) iDesc = iCod + 1;

        // Cantidad: por header primero, luego buscar número pequeño positivo
        let iCant = nCol('cantidad') !== -1 ? nCol('cantidad') : nCol('cant');
        if (iCant === -1 && iCod !== -1) {
          // Buscar en columnas posteriores al código
          for (let i = iCod + 2; i < Math.min(iCod + 10, totalCols); i++) {
            if (esColCant(i)) { iCant = i; break; }
          }
        }

        // Observaciones
        const iObsDetected = nCol('observacion') !== -1 ? nCol('observacion') : iObs;

        console.log('[ExcelParser] iCod:', iCod, '| iDesc:', iDesc, '| iCant:', iCant,
          '| val:', firstDataRow[iCod], '|', firstDataRow[iDesc]?.toString().slice(0,20), '|', firstDataRow[iCant]);

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
