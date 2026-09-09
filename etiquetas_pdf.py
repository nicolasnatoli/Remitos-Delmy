import fitz  # PyMuPDF
import io
import barcode
from barcode.writer import ImageWriter

# Impresoras térmicas de etiquetas baratas (ej. Xprinter XP-470) suelen tener
# problemas para imprimir HTML directo desde el navegador: el driver de
# Windows no siempre respeta el tamaño de página que pide el CSS. Generar acá
# el PDF ya armado (en vez de depender de window.print() sobre la página web)
# es el mismo camino que funciona a mano guardando como PDF primero, pero en
# un solo clic.

_MM_A_PT = 2.834645669
# Margen generoso: en una prueba real con la Xprinter, la fecha quedaba
# pegada al borde y se cortaba (el área imprimible física es un poco más
# chica que el tamaño nominal de la etiqueta). 3mm de aire de sobra.
_PADDING_MM = 3


def _texto_bulto(numero: int, total: int) -> str:
    return f"{numero}/{total}"


def _texto_articulo(item: dict) -> str:
    codigo = item["codigo_articulo"] or "—"
    return f"N°{item['nro_orden']} · {codigo}"


_INTERLINEADO = 1.0  # default de PyMuPDF (~1.7x) dejaba mucho aire arriba/abajo
# de cada línea; con esto el texto crece más y queda todo más "pegado".


def _tam_maximo(rect, texto, fontname, tam_min=3, tam_max=200):
    """Busca el tamaño de letra más grande que entra (ancho y alto) dentro
    del rect — así cada línea llena todo el espacio que se le dio, sin
    importar cuánto mida el texto real (número corto, proveedor largo,
    etc.). Se mide en una página descartable para no dibujar de más
    mientras se busca el tamaño."""
    medidor = fitz.open()
    try:
        pagina_medidora = medidor.new_page(width=rect.x1 + 10, height=rect.y1 + 10)

        def cabe(tam):
            return pagina_medidora.insert_textbox(
                rect, texto, fontsize=tam, fontname=fontname,
                align=fitz.TEXT_ALIGN_CENTER, lineheight=_INTERLINEADO,
            ) >= 0

        if not cabe(tam_min):
            # Caso límite: ni el tamaño mínimo entra (texto extremadamente
            # largo en un espacio muy chico). No hay un tamaño mejor para
            # ofrecer — se devuelve igual, es preferible a dejar la etiqueta
            # vacía. En la práctica no debería pasar con los tamaños de
            # etiqueta y textos reales del depósito.
            return tam_min

        lo, hi, mejor = tam_min, tam_max, tam_min
        while lo <= hi:
            medio = (lo + hi) // 2
            if cabe(medio):
                mejor = medio
                lo = medio + 1
            else:
                hi = medio - 1
        return mejor
    finally:
        medidor.close()


_CAP_RATIO = 0.72  # fracción del tamaño de letra hasta la línea base. Ni
# insert_textbox ni un padding chico logran que el texto quede pegado arriba:
# insert_textbox siempre deja lugar de sobra para acentos/descendentes,
# aunque el texto sea solo dígitos. Dibujando a mano con insert_text (que
# ubica por línea de base, no por caja) se evita ese aire reservado.


def _dibujar(page, rect, texto, fontname, tam):
    fuente = fitz.Font(fontname)
    ancho_texto = fuente.text_length(texto, fontsize=tam)
    if ancho_texto <= rect.width:
        # Entra en una sola línea: se dibuja a mano, pegado arriba y centrado.
        x = rect.x0 + (rect.width - ancho_texto) / 2
        y = rect.y0 + _CAP_RATIO * tam
        page.insert_text((x, y), texto, fontsize=tam, fontname=fontname)
    else:
        # Necesita más de una línea (ej. código de artículo largo, o un
        # nombre de proveedor muy largo): se deja el ajuste automático de
        # insert_textbox, que sí sabe hacer el salto de línea.
        page.insert_textbox(
            rect, texto, fontsize=tam, fontname=fontname,
            align=fitz.TEXT_ALIGN_CENTER, lineheight=_INTERLINEADO,
        )


def generar_pdf_etiquetas(
    remito: dict,
    items: list[dict],
    fecha_txt: str,
    tipo: str,
    ancho_mm: float,
    alto_mm: float,
    espacio_numero: float,
    espacio_proveedor: float,
    espacio_fecha: float,
) -> bytes:
    ancho_pt = ancho_mm * _MM_A_PT
    alto_pt = alto_mm * _MM_A_PT
    pad = _PADDING_MM * _MM_A_PT
    proveedor = remito["proveedor_nombre"] or "—"

    if tipo == "articulos":
        textos = [_texto_articulo(it) for it in items]
    else:
        total = remito["cantidad_bultos_declarados"] or 0
        textos = [_texto_bulto(i, total) for i in range(1, total + 1)]

    doc = fitz.open()
    if not textos:
        page = doc.new_page(width=ancho_pt, height=alto_pt)
        page.insert_textbox(
            fitz.Rect(pad, pad, ancho_pt - pad, alto_pt - pad),
            "Sin etiquetas para imprimir",
            fontsize=8, fontname="helv", align=fitz.TEXT_ALIGN_CENTER,
        )
    else:
        # Tres líneas apiladas y centradas: número grande, proveedor debajo,
        # fecha más chica al pie. El espacio de cada franja se reparte según
        # lo pedido (70/20/10 por defecto). Un respiro chico entre franjas
        # evita que un código de artículo largo (2 líneas) quede pegado
        # contra el proveedor.
        gap = 1 * _MM_A_PT
        alto_util = alto_pt - 2 * pad - 2 * gap
        total_espacio = espacio_numero + espacio_proveedor + espacio_fecha
        franja_numero = alto_util * (espacio_numero / total_espacio)
        franja_proveedor = alto_util * (espacio_proveedor / total_espacio)
        franja_fecha = alto_util - franja_numero - franja_proveedor

        for texto in textos:
            page = doc.new_page(width=ancho_pt, height=alto_pt)

            rect_numero = fitz.Rect(pad, pad, ancho_pt - pad, pad + franja_numero)
            y = pad + franja_numero + gap
            rect_proveedor = fitz.Rect(pad, y, ancho_pt - pad, y + franja_proveedor)
            y += franja_proveedor + gap
            rect_fecha = fitz.Rect(pad, y, ancho_pt - pad, alto_pt - pad)

            # Cada franja calcula su propio tamaño máximo en función del
            # largo real de su texto (así un proveedor con nombre largo se
            # achica solo, sin desbordar su columna). Después se fuerza la
            # jerarquía: el número siempre queda igual o más grande que el
            # proveedor, y el proveedor igual o más grande que la fecha —
            # aunque el texto del número sea corto y el del proveedor largo.
            # Achicar un tamaño que ya entraba nunca hace que desborde, así
            # que este recorte es seguro.
            tam_numero = _tam_maximo(rect_numero, texto, "hebo")
            tam_proveedor = min(_tam_maximo(rect_proveedor, proveedor, "hebo"), tam_numero)
            tam_fecha = min(_tam_maximo(rect_fecha, fecha_txt, "helv"), tam_proveedor)

            _dibujar(page, rect_numero, texto, "hebo", tam_numero)
            _dibujar(page, rect_proveedor, proveedor, "hebo", tam_proveedor)
            _dibujar(page, rect_fecha, fecha_txt, "helv", tam_fecha)

    pdf_bytes = doc.tobytes()
    doc.close()
    return pdf_bytes


def _codigo_de_barras_png(texto: str) -> bytes:
    codigo = barcode.get("code128", texto, writer=ImageWriter())
    buf = io.BytesIO()
    codigo.write(buf, options={"write_text": False, "quiet_zone": 1.5, "module_height": 12})
    return buf.getvalue()


def generar_pdf_etiquetas_ubicaciones(
    codigos: list[str],
    ancho_mm: float = 55,
    alto_mm: float = 45,
) -> bytes:
    """Una etiqueta por código: código de barras (Code128 — soporta el guion
    del formato 01-10-10) arriba, y el mismo código como texto grande abajo,
    para que sirva tanto para pegar y leer a simple vista como para
    escanearla con un lector de código de barras o el celular."""
    ancho_pt = ancho_mm * _MM_A_PT
    alto_pt = alto_mm * _MM_A_PT
    pad = _PADDING_MM * _MM_A_PT

    doc = fitz.open()
    if not codigos:
        page = doc.new_page(width=ancho_pt, height=alto_pt)
        page.insert_textbox(
            fitz.Rect(pad, pad, ancho_pt - pad, alto_pt - pad),
            "Sin etiquetas para imprimir", fontsize=8, fontname="helv", align=fitz.TEXT_ALIGN_CENTER,
        )
        pdf_bytes = doc.tobytes()
        doc.close()
        return pdf_bytes

    gap = 1.5 * _MM_A_PT
    alto_util = alto_pt - 2 * pad - gap
    franja_barras = alto_util * 0.55

    for codigo in codigos:
        page = doc.new_page(width=ancho_pt, height=alto_pt)

        rect_barras = fitz.Rect(pad, pad, ancho_pt - pad, pad + franja_barras)
        y = pad + franja_barras + gap
        rect_texto = fitz.Rect(pad, y, ancho_pt - pad, alto_pt - pad)

        png = _codigo_de_barras_png(codigo)
        img = fitz.open("png", png)
        rel_ancho = img.load_page(0).rect.width / img.load_page(0).rect.height
        img.close()
        # Se ajusta el rectángulo del código de barras para no deformarlo:
        # se centra dentro de la franja respetando su proporción real.
        ancho_deseado = min(rect_barras.width, rect_barras.height * rel_ancho)
        alto_deseado = ancho_deseado / rel_ancho
        x0 = rect_barras.x0 + (rect_barras.width - ancho_deseado) / 2
        y0 = rect_barras.y0 + (rect_barras.height - alto_deseado) / 2
        rect_barras_final = fitz.Rect(x0, y0, x0 + ancho_deseado, y0 + alto_deseado)
        page.insert_image(rect_barras_final, stream=png)

        tam_texto = _tam_maximo(rect_texto, codigo, "hebo")
        _dibujar(page, rect_texto, codigo, "hebo", tam_texto)

    pdf_bytes = doc.tobytes()
    doc.close()
    return pdf_bytes
