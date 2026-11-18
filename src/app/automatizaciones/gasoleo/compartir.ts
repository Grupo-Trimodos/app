/**
 * «Compartir resultado»: una imagen con el cálculo para mandarla por WhatsApp (como la calculadora original).
 * Móvil: el menú de compartir del sistema. Ordenador: la imagen al portapapeles para pegarla con Ctrl+V; si no se puede,
 * se descarga y se copia el resumen en texto. La imagen y el texto llevan la dirección de la calculadora en la app.
 * Solo en el navegador; no sale nada hacia el servidor.
 */
import {
  NOMBRE_BASE, VEHICULOS, detallePeriodo, etiquetaPeriodo, fmtFecha, isoAMs, nf, pc, textos,
  type Entrada, type Resultado,
} from "@/lib/gasoleo";

const ARCHIVO = "revision-gasoleo.png";
/** Página de la calculadora en la app: va al pie de la imagen y al final del texto (como la original con la suya). */
const RUTA = "/automatizaciones/gasoleo";
const direccion = () => location.origin + RUTA;
const FUENTE = 'Atkinson, system-ui, "Segoe UI", sans-serif';
const TINTA = "#182737", SUAVE = "#617082", AZUL = "#182d3e", AMARILLO = "#fcda00", REF = "#355d85", REAL = "#8a6b0a", VERDE = "#16734f";

type Mensaje = { texto: string; descargar?: () => void };

function cargarImagen(src: string): Promise<HTMLImageElement | null> {
  return new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = src; });
}
function rect(x: CanvasRenderingContext2D, px: number, py: number, w: number, h: number, r: number) {
  x.beginPath(); x.moveTo(px + r, py); x.arcTo(px + w, py, px + w, py + h, r); x.arcTo(px + w, py + h, px, py + h, r);
  x.arcTo(px, py + h, px, py, r); x.arcTo(px, py, px + w, py, r); x.closePath();
}
/** Letra más pequeña hasta que el texto quepa. */
function ajustar(x: CanvasRenderingContext2D, texto: string, maxW: number, tam: number, peso: number) {
  let s = tam;
  do { x.font = `${peso} ${s}px ${FUENTE}`; s -= 2; } while (x.measureText(texto).width > maxW && s > 12);
}

async function imagen(e: Entrada, r: Resultado, fechaExcel: string): Promise<Blob> {
  await document.fonts?.ready;
  const [gt, st, tr] = await Promise.all(["trimodos", "stinsa", "transargi"].map((n) => cargarImagen(`/deca/img/${n}.png`)));
  const t = textos(e, r);
  const W = 1080, H = 1350, c = document.createElement("canvas"); c.width = W; c.height = H;
  const x = c.getContext("2d");
  if (!x) throw new Error("el navegador no permite dibujar");
  x.fillStyle = "#f4f5f7"; x.fillRect(0, 0, W, H);
  // Banda de marca con los tres logotipos y la raya amarilla.
  x.fillStyle = "#fff"; x.fillRect(0, 0, W, 180);
  const dibujar = (im: HTMLImageElement, h: number, px: number, py: number) => { const w = im.naturalWidth * h / im.naturalHeight; x.drawImage(im, px, py, w, h); return w; };
  if (gt) dibujar(gt, 84, 60, 48); else { x.fillStyle = TINTA; x.font = `800 40px ${FUENTE}`; x.fillText("GRUPO TRIMODOS", 60, 105); }
  let rx = W - 60;
  if (tr) { rx -= tr.naturalWidth * 54 / tr.naturalHeight; dibujar(tr, 54, rx, 63); }
  if (st) { x.fillStyle = "#dde3e9"; x.fillRect(rx - 26, 62, 2, 56); rx -= st.naturalWidth * 54 / st.naturalHeight + 52; dibujar(st, 54, rx, 63); }
  x.fillStyle = AMARILLO; x.fillRect(0, 180, W, 12);
  // Título, vehículo y precio usado.
  x.fillStyle = TINTA; x.font = `800 54px ${FUENTE}`; x.fillText("Revisión del precio del", 60, 290); x.fillText("transporte por gasóleo", 60, 354);
  const veh = (VEHICULOS.find((v) => v.id === e.vehiculo)?.nombre ?? e.vehiculo).replace(" · ", " · Vehículo ");
  x.fillStyle = SUAVE; ajustar(x, veh, W - 120, 28, 600); x.fillText(veh, 60, 410);
  const usado = "Precio del gasóleo usado: " + NOMBRE_BASE[r.base] + (r.base === "pmed" ? " (" + (r.ge ? "MMA ≥ 7,5 t" : "MMA < 7,5 t") + ")" : "") + " · €/litro";
  ajustar(x, usado, W - 120, 26, 500); x.fillText(usado, 60, 450);
  // Tarjetas de referencia y de cálculo.
  const tarjeta = (cx: number, rotulo: string, color: string, fondo: string, titulo: string, valor: string, detalle: string) => {
    const y = 490, w = 465, h = 270;
    x.fillStyle = "#fff"; rect(x, cx, y, w, h, 22); x.fill(); x.strokeStyle = "#dde3e9"; x.lineWidth = 2; x.stroke();
    x.font = `800 22px ${FUENTE}`; const tw = x.measureText(rotulo).width;
    x.fillStyle = fondo; rect(x, cx + 30, y + 30, tw + 28, 40, 8); x.fill(); x.fillStyle = color; x.fillText(rotulo, cx + 44, y + 58);
    x.fillStyle = TINTA; ajustar(x, titulo, w - 60, 34, 800); x.fillText(titulo, cx + 30, y + 122);
    x.font = `700 60px ${FUENTE}`; x.fillText(valor, cx + 30, y + 200); const vw = x.measureText(valor).width;
    x.fillStyle = SUAVE; x.font = `500 24px ${FUENTE}`; x.fillText("€/litro", cx + 40 + vw, y + 200); x.fillText(detalle, cx + 30, y + 242);
  };
  tarjeta(60, "REFERENCIA · CONTRATO", REF, "#e6eef6", etiquetaPeriodo(e.referencia), nf(r.rv, 5), detallePeriodo(r.wr, e.referencia));
  tarjeta(555, "CÁLCULO · TRANSPORTE", REAL, "#fff6c2", etiquetaPeriodo(e.realizacion), nf(r.tv, 5), detallePeriodo(r.wt, e.realizacion));
  // Resultado.
  const ry = 800, rh = 380;
  x.fillStyle = AZUL; rect(x, 60, ry, W - 120, rh, 26); x.fill();
  x.save(); rect(x, 60, ry, W - 120, rh, 26); x.clip(); x.fillStyle = AMARILLO; x.fillRect(60, ry, W - 120, 12); x.restore();
  x.fillStyle = AMARILLO; x.font = `800 26px ${FUENTE}`; x.fillText("VARIACIÓN DEL PRECIO DEL TRANSPORTE", 100, ry + 72);
  x.fillStyle = "#fff"; x.font = `800 124px ${FUENTE}`; x.fillText(t.pct, 96, ry + 196);
  x.fillStyle = "rgba(255,255,255,.22)"; x.fillRect(100, ry + 232, W - 200, 2);
  x.fillStyle = AMARILLO; x.font = `800 24px ${FUENTE}`; x.fillText("VARIACIÓN DEL GASÓLEO (G)", 100, ry + 282); x.fillText("COEFICIENTE C", 620, ry + 282);
  x.fillStyle = "#fff"; x.font = `800 72px ${FUENTE}`; x.fillText(t.G, 96, ry + 354); x.fillText(t.C, 616, ry + 354);
  // Pie: veredicto y origen de los precios.
  x.fillStyle = t.veredictoClase === "ok" ? VERDE : REAL; x.font = `800 28px ${FUENTE}`; x.fillText(t.veredicto, 60, 1232);
  const pie = "Precios: Ministerio de Transportes (Excel del " + fmtFecha(isoAMs(fechaExcel)) + ") · Ley 15/2009, art. 38 · Cálculo orientativo";
  x.fillStyle = SUAVE; ajustar(x, pie, W - 120, 22, 500); x.fillText(pie, 60, 1274);
  const web = location.host + RUTA;
  x.fillStyle = VERDE; ajustar(x, web, W - 120, 24, 700); x.fillText(web, 60, 1312);
  return new Promise((ok, mal) => c.toBlob((b) => (b ? ok(b) : mal(new Error("imagen vacía"))), "image/png"));
}

function resumen(e: Entrada, r: Resultado) {
  return "Revisión del precio del transporte por gasóleo\n"
    + `Referencia (${etiquetaPeriodo(e.referencia)}): ${nf(r.rv, 5)} €/l\n`
    + `Cálculo (${etiquetaPeriodo(e.realizacion)}): ${nf(r.tv, 5)} €/l\n`
    + `Variación del gasóleo (G): ${pc(r.G, r.gd, true)}\nCoeficiente C: ${nf(r.C, 2)}\nVariación del transporte: ${pc(r.pct, 2, true)}\n${direccion()}`;
}

function descargar(blob: Blob) {
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = ARCHIVO;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

const esMovil = () => matchMedia("(pointer:coarse)").matches && /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

export async function compartirResultado(e: Entrada, r: Resultado, fechaExcel: string): Promise<Mensaje | null> {
  const promesa = imagen(e, r, fechaExcel);
  if (esMovil()) {
    const blob = await promesa, archivo = new File([blob], ARCHIVO, { type: "image/png" });
    if (navigator.canShare?.({ files: [archivo] })) {
      try { await navigator.share({ files: [archivo], title: "Revisión del precio por gasóleo", text: resumen(e, r) }); }
      catch (err) { if (!(err instanceof Error && err.name === "AbortError")) throw err; }
      return null;
    }
    descargar(blob);
    return { texto: "Imagen descargada. Adjúntala en WhatsApp." };
  }
  // El menú de compartir de Windows tiene un «Copiar» que no deja la imagen en el portapapeles: en el ordenador, se copia.
  let copiado = false;
  if (navigator.clipboard && typeof ClipboardItem !== "undefined") {
    // El ClipboardItem se crea en el mismo clic, con la imagen aún generándose (necesario en Safari).
    try { await navigator.clipboard.write([new ClipboardItem({ "image/png": promesa })]); copiado = true; } catch { /* sin permiso */ }
  }
  const blob = await promesa;
  if (copiado) return { texto: "Imagen copiada. Pégala con Ctrl+V (⌘+V en Mac) en el chat de WhatsApp Web.", descargar: () => descargar(blob) };
  descargar(blob);
  try { await navigator.clipboard.writeText(resumen(e, r)); return { texto: "Imagen descargada y resumen copiado. Adjunta la imagen en WhatsApp." }; }
  catch { return { texto: "Imagen descargada. Adjúntala en WhatsApp." }; }
}
