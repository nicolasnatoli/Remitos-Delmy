// ===== ATRIBUTOS — diccionario de artículos base + modificadores compuestos =====
// Delmy Party SRL · Industrial Partner
//
// Objetivo: evitar que el matching automático (cruzar()) confunda artículos
// que comparten casi toda la descripción pero difieren en un detalle que
// cambia el SKU real: color, medida/gramaje, sabor, o tema/personaje/uso.
//
// ARTICULOS_BASE se construyó a partir de un análisis real de 29.298 descripciones
// de tu catálogo (columna "2º Vueta" de Articulos_ERP_con_contexto_v8_AI.xlsx).
// TEMAS_PERSONAJES se armó detectando palabras que aparecen en 4+ categorías de
// artículo base distintas (señal de que es un tema/licencia transversal, no un
// atributo propio de un solo producto).

// ─── Artículos base (335 categorías reales, validadas por uso) ───────────────
export const ARTICULOS_BASE = ["AGITADOR","AIR FRYER","Abrochadora","Abroche","Adhesivo","Adorno Hallowen","Adorno decorativo","Aerosol","Aerógrafo","Afiche","Agenda","Agenda diaria","Agenda semanal","Ajedrez","Alas","Alfajor","Alisador","Andador","Anillo","Animalito","Anteojo","Antifaz","Archivador","Auto a batería","Auto a control remoto","Auto a fricción","Auto bombero","Auto con luces","Auto deportivo","Auto policía","Avión","Balde","Baldecito","Bananita","Bandana","Bandeja","Bandeja cartón","Bandera","Banderín","Barco","Barra cereal","Base giratoria","Base telgopor","Batidor","Bebote","Bengala","Bengala fría","Bibliorato","Bicicleta","Bingo","Block","Boa","Bolsa","Bolsa camiseta","Bolsa papel","Bolsa regalo","Bolígrafo","Bolígrafo borrable","Bolígrafo gel","Bombón","Bonete","Boquilla","Botella","Botella vidrio","Bowl","Broche","Caja","Cajita","Calculadora","Calendario","Camión bombero","Camión construcción","Camión volcador","Capa","Capa con capucha","Caramelo","Careta","Carpeta","Cartel","Cartuchera","Cartulina","Cartulina color","Cañón de confeti","Centro de mesa","Chicle","Chocolate","Chupaleta","Chupetín","Cinta adhesiva","Clasificador","Clips","Collar","Collar hawaiano","Colorante","Colorante en gel","Colorante líquido","Columpio","Compás","Confeti","Confite","Copa","Copita","Corneta","Corona","Corrector en cinta","Corrector líquido","Cortante","Cortante letras","Cortante navideño","Cortante números","Cortina","Cortina metalizada","Crayón de cera","Cuadernillo","Cuaderno","Cuaderno tapa dura","Cubanito","Cubiertos","Cuchara","Cucharita","Cuchillo","Damas","Dijes","Dinosaurio","Disfraz","Dominó","Dulce de leche","Ensaladera","Envase","Escarapela","Escuadra","Esencia","Espada","Espuma","Espátula","Espátula recta","Estampa","Etiqueta","Extensión","Fibra","Folio","Fondant","Frasco","Galera","Galletita","Glitter","Globo","Globo burbuja","Globo confeti","Globo corazón","Globo estrella","Globo gigante","Globo letra","Globo látex","Globo metalizado","Globo número","Golosina","Goma","Gomita","Gorro","Guantes","Guirnalda","Guirnalda plástica","Habanito","Hamaca","Helicóptero","Hielera","Hoja","Imán","Inflable","Jarra","Juego","Juego cartas","Juego de mesa","Juego didáctico","Jugo","Lata","Libreta","Libro","Lotería","Lápiz","Lápiz flexible","Manga","Manga descartable","Manga silicona","Manta de actividades","Manteca","Mantecol","Mantel","Maquillaje","Maraca","Marcador","Marcador permanente","Marcador pizarra","Masa","Matraca","Medias","Memotest","Mentita","Merengue","Mina","Mochila","Molde","Molde bombón","Molde budín","Molde corazón","Molde desmontable","Molde muffin","Molde rosca","Molde savarin","Molde silicona","Molde torta","Monopatín","Moño","Muñeca","Muñeca fashion","Muñeco","Muñeco articulado","Muñeco bebé","Máscara","Nariz","Ojalillo","Orejas","PINCHES","Palito de chupetín","Palito de helado","Palitos salados","Palote","Papas fritas","Papel afiche","Papel calco","Papel crepé","Papel fotográfico","Papel glacé","Papel madera","Paquete","Pasta de goma","Pasta frola","Pastilla","Patineta","Pechera","Pegamento","Pelota","Pelota fútbol","Peluca","Peluche","Perforadora","Pico","Pincel","Pintura acrílica","Pionono","Pirotín","Pista de autos","Pistola de agua","Pistola encoladora","Pito","Piñata","Planificador","Plantilla","Plato","Plato cartón","Plato giratorio","Plato plástico","Pluma","Pochoclera","Porra","Portaglobo","Portalápiz","Portaminas","Posatorta","Pote","Practicuna","Pulsera","Pulsera luminosa","Rallador","Rayador","Regla","Regla flexible","Regla metálica","Reloj","Repuesto de hojas","Resaltador","Resaltador pastel","Resma","Rodillo","Rompecabezas","Sacabocado","Sacapuntas","Scooter","Sello","Separador","Serpentina","Servilleta","Servilletero","Silbato","Snack","Sobre","Sombrero","Sombrero bombín","Sombrero cowboy","Sombrero vaquero","Sorbete","Sprinkles","Sticker","TAPA","Talonario","Tamiz","Tanque de helio","Tattoo","Taza","Tenedor","Termo","Termómetro repostero","Tijera","Tijera escolar","Tinta","Tirador","Tortera","Transportador","Tren","Triciclo","Turrón","Tutú","Témpera","Vainillas","Valija","Varita","Vaso","Vaso térmico","Vela","Vela LED","Vela número","Velón","Vincha","Viruta"];

// Índice normalizado (minúsculas, sin acentos) para lookup rápido
const _norm = s => String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim();
export const ARTICULOS_BASE_NORM = new Set(ARTICULOS_BASE.map(_norm));

// ─── Colores ───────────────────────────────────────────────────────────────────
// (extiende el extraerColor() histórico de ModuloRecepcion — mismo criterio,
// agrupa variantes de nombre bajo un código canónico)
export const COLORES = {
  'negro':'NE','negra':'NE','celeste':'CE','azul':'AZ','rojo':'ROJO','roja':'ROJO',
  'rosa':'RS','rosado':'RS','rosa fuerte':'RS2','blanco':'BL','blanca':'BL',
  'verde':'VE','amarillo':'AM','amarilla':'AM','naranja':'NA','violeta':'VIO',
  'lila':'LI','fucsia':'FUC','traslucido':'TRAS','traslucida':'TRAS','transparente':'TRAS',
  'marron':'MP','perlado':'MP','cristal':'CR','plata':'PLATA','plateado':'PLATA','plateada':'PLATA',
  'magenta':'MAG','dorado':'DO','dorada':'DO','gris':'GRIS','multicolor':'MULTI','fluo':'FLUO',
  'turquesa':'TQ','oro':'DO','gold':'DO',
};
export function extraerColor(desc) {
  const d = _norm(desc);
  for (const [p, c] of Object.entries(COLORES)) {
    // límite de palabra para evitar falsos positivos (ej. "rosa" dentro de "mariposa")
    if (new RegExp(`\\b${p}\\b`).test(d)) return c;
  }
  return null;
}

// ─── Medida / gramaje / tamaño numérico ────────────────────────────────────────
// Cubre: "X27GR", "27 GRS", "300cc", "N/12", "N 16", "3 COLUMNAS", "40cm", "125 GS"
const MEDIDA_RE = /(\d+(?:[.,]\d+)?)\s*(gr|grs|gramos|kg|cm|mm|ml|lts?|litros?|cc|gs|oz)\b|\bn[°º/\s]*\s*(\d+)\b|\b(\d+)\s*(columnas?|piezas?|pzas?)\b/i;
// Sinónimos de unidad — en tu catálogo "GS", "GRS" y "GR" son todos gramos.
// Sin esto, "35 GS" vs "35 GRS" se marcaba como conflicto siendo el mismo peso.
const UNIDAD_CANONICA = { gr:'g', grs:'g', gramos:'g', gs:'g', kg:'kg', cm:'cm', mm:'mm', ml:'ml', lts:'l', lt:'l', litros:'l', cc:'cc', oz:'oz' };
export function extraerMedida(desc) {
  const d = _norm(desc);
  const m = d.match(MEDIDA_RE);
  if (!m) return null;
  // Normalizar a "numero+unidad canónica" para comparar
  if (m[1] && m[2]) {
    const unidad = UNIDAD_CANONICA[m[2].replace(/s$/,'')] || UNIDAD_CANONICA[m[2]] || m[2];
    return `${parseFloat(m[1].replace(',','.'))}${unidad}`;
  }
  if (m[3]) return `n${m[3]}`;
  if (m[4] && m[5]) return `${m[4]}${m[5].replace(/s$/,'')}`;
  return null;
}

// ─── Temas / personajes / licencias ────────────────────────────────────────────
// Curado desde análisis de frecuencia cross-categoría sobre tu catálogo real
// (palabras que aparecen en 4+ artículos base distintos, filtrando proveedores,
// colores, materiales y tamaños genéricos). Lista abierta — se amplía con casos reales.
export const TEMAS_PERSONAJES = [
  'unicornio','mickey','minnie','frozen','stitch','cars','princesa','princesas',
  'dragon','peppa','sonic','zenon','pig','messi','boca','river','halloween',
  'paw patrol','paw','patrol','hello kitty','spiderman','avengers','sirenita',
  'harry potter','harry','merlina','jurassic','bombero','bomberos','policia','policía',
  'pirata','piratas','oso','ositos','mariposa','araña','dinosaurio','dinosaurios',
  'granjero','space','superheroe','superhéroe','super hero','minions','bluey',
  'toy story','cocomelon','barbie','hombre araña','navidad','navideño','navideña',
];
const TEMAS_RE = new RegExp('\\b(' + TEMAS_PERSONAJES.map(t=>t.replace(/\s+/g,'\\s+')).join('|') + ')\\b', 'i');
export function extraerTema(desc) {
  const d = _norm(desc);
  const m = d.match(TEMAS_RE);
  return m ? _norm(m[1]).replace(/\s+/g,' ') : null;
}

// ─── Usos específicos / compuestos conocidos ───────────────────────────────────
// A diferencia de TEMAS_PERSONAJES, estos modifican la FUNCIÓN del artículo base
// dentro de la misma categoría (ej: "vaso" + "fernetero" = vaso para fernet).
// Lista corta a propósito — la mayoría de las palabras -ero/-era del catálogo
// terminan siendo artículos base propios (servilletero, pochoclera, llavero),
// no modificadores. Se amplía caso a caso con ejemplos reales.
export const USOS_ESPECIFICOS = [
  'fernetero', 'trago largo', 'shot', 'sopero', 'hondo', 'playo',
];
const USOS_RE = new RegExp('\\b(' + USOS_ESPECIFICOS.map(t=>t.replace(/\s+/g,'\\s+')).join('|') + ')\\b', 'i');
export function extraerUsoEspecifico(desc) {
  const d = _norm(desc);
  const m = d.match(USOS_RE);
  return m ? _norm(m[1]).replace(/\s+/g,' ') : null;
}

// ─── Extracción combinada ──────────────────────────────────────────────────────
export function extraerAtributos(desc) {
  return {
    color: extraerColor(desc),
    medida: extraerMedida(desc),
    tema: extraerTema(desc),
    uso: extraerUsoEspecifico(desc),
  };
}

// ─── Comparación de atributos entre descripción del documento y candidato ─────
// Regla: si AMBAS descripciones mencionan un atributo de la misma categoría y
// NO coinciden → conflicto real (son artículos distintos, no confundir).
// Si el documento no menciona ese tipo de atributo, no se penaliza — evita
// falsos rechazos cuando la FC viene con descripción pobre.
export function compararAtributos(descDoc, descCandidato) {
  const a = extraerAtributos(descDoc);
  const b = extraerAtributos(descCandidato);
  const conflictos = [];
  if (a.color && b.color && a.color !== b.color) conflictos.push(`color: doc=${a.color} vs base=${b.color}`);
  if (a.medida && b.medida && a.medida !== b.medida) conflictos.push(`medida: doc=${a.medida} vs base=${b.medida}`);
  if (a.tema && b.tema && a.tema !== b.tema) conflictos.push(`tema: doc="${a.tema}" vs base="${b.tema}"`);
  if (a.uso && b.uso && a.uso !== b.uso) conflictos.push(`uso: doc="${a.uso}" vs base="${b.uso}"`);
  // Caso especial: el documento menciona un tema/uso que el candidato NO menciona en absoluto.
  // Esto es más débil (puede ser que la base tenga descripción pobre) — se marca como
  // advertencia, no como conflicto duro, salvo en 'tema' donde suele ser bastante confiable
  // (un personaje es un dato caro de omitir si realmente aplica al candidato).
  if (a.tema && !b.tema) conflictos.push(`tema: doc menciona "${a.tema}", base no menciona ningún tema`);
  return { compatible: conflictos.length === 0, conflictos };
}
