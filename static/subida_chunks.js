// Sube un archivo en trozos de a ~3MB, para esquivar el límite duro de
// 4.5MB por request que tiene cualquier función serverless de Vercel — no
// es configurable, hay que partir el archivo del lado del navegador.
//
// Uso: envolvé el <form> con esta función en vez de dejar que el navegador
// lo mande directo. Ver admin_laboratorio_articulos.html para el ejemplo
// completo de wiring (barra de progreso, deshabilitar botón, etc).
async function subirArchivoEnTrozos(archivo, urlDestino, camposExtra, onProgreso) {
  const TAMANO_CHUNK = 3 * 1024 * 1024; // 3MB por trozo — bien debajo del límite de 4.5MB
  const subidaId = (crypto.randomUUID ? crypto.randomUUID() : 'subida-' + Date.now() + '-' + Math.random());
  const total = Math.max(1, Math.ceil(archivo.size / TAMANO_CHUNK));

  for (let i = 0; i < total; i++) {
    const trozo = archivo.slice(i * TAMANO_CHUNK, (i + 1) * TAMANO_CHUNK);
    const fd = new FormData();
    fd.append('subida_id', subidaId);
    fd.append('indice', i);
    fd.append('total', total);
    fd.append('nombre_archivo', archivo.name);
    fd.append('chunk', trozo, archivo.name);

    const resp = await fetch('/admin/laboratorio/subir-chunk', { method: 'POST', body: fd });
    if (!resp.ok) {
      const datos = await resp.json().catch(() => ({}));
      throw new Error(datos.error || `Error subiendo la parte ${i + 1} de ${total}.`);
    }
    if (onProgreso) onProgreso(i + 1, total);
  }

  // Con todos los trozos ya guardados en el servidor, se manda un pedido
  // chiquito (nada de archivo adentro) pidiendo que los junte y procese.
  const fdFinal = new FormData();
  fdFinal.append('subida_id', subidaId);
  for (const [clave, valor] of Object.entries(camposExtra || {})) {
    fdFinal.append(clave, valor);
  }
  const respFinal = await fetch(urlDestino, { method: 'POST', body: fdFinal });
  return respFinal;
}

// Envuelve un <form> para que, si el archivo elegido es grande, use la
// subida en trozos en vez del submit normal del navegador (que fallaría
// con 413 en archivos de más de ~4.5MB).
function conectarFormularioConTrozos(formId, inputArchivoId, opciones = {}) {
  const UMBRAL_DIRECTO = 4 * 1024 * 1024; // por debajo de esto, submit normal — no hace falta complicar
  const form = document.getElementById(formId);
  const inputArchivo = document.getElementById(inputArchivoId);
  if (!form || !inputArchivo) return;

  form.addEventListener('submit', async (e) => {
    const archivo = inputArchivo.files[0];
    if (!archivo || archivo.size <= UMBRAL_DIRECTO) return; // deja que el form haga submit normal

    e.preventDefault();
    const boton = form.querySelector('button[type="submit"]');
    const textoOriginal = boton ? boton.textContent : '';
    if (boton) boton.disabled = true;

    try {
      const camposExtra = {};
      form.querySelectorAll('input[type="hidden"], input[type="text"]').forEach((el) => {
        if (el.name) camposExtra[el.name] = el.value;
      });

      const resp = await subirArchivoEnTrozos(archivo, form.action, camposExtra, (hecho, total) => {
        if (boton) boton.textContent = `Subiendo... ${hecho}/${total}`;
      });

      const html = await resp.text();
      document.open();
      document.write(html);
      document.close();
    } catch (err) {
      alert('No se pudo subir el archivo: ' + err.message);
      if (boton) { boton.disabled = false; boton.textContent = textoOriginal; }
    }
  });
}
