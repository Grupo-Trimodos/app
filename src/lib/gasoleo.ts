/**
 * Revisión del precio del transporte por la variación del gasóleo: toda la lógica, sin pantalla (funciones puras).
 *
 * Es la misma calculadora que estaba en GitHub (Revision-Gasoleo, index.html), trasladada tal cual: mismas fórmulas,
 * umbrales, redondeos y textos. No «mejorar» nada aquí sin comprobarlo con scripts/comprobar_gasoleo.mjs, que compara
 * esta versión con la original con cientos de combinaciones.
 *
 * Base legal: Ley 15/2009, art. 38; Orden FOM/1882/2012, condición 3.4, en la redacción del RD-ley 9/2026 y del
 * RD-ley 18/2026. Precios: evolución semanal del gasóleo de automoción del Ministerio de Transportes.
 * Los datos llegan de la API Python (servicios/gasoleo.py) con el formato de data.json.
 */

export const URL_MINISTERIO = "https://www.transportes.gob.es/transporte-terrestre/servicios-al-transportista/indice-de-variacion-semanal-de-los-precios-medios-del-gasoleo-en-espana";
export const URL_CALCULADORA_OFICIAL = "https://apps.fomento.gob.es/preciogasoleo/angular_proyecto/client/gasoleoCambio";
export const URL_NOTA_METODOLOGICA = "https://www.transportes.gob.es/recursos_mfom/comodin/recursos/20260702_nota_metodologica_variacion_precio_transporte.pdf";

/** Fila de la Excel: [serial de Excel, PVP, PVP sin IVA, impuesto hidrocarburos, PAI, devolución GP, Pmed ≥ 7,5 t, Pmed < 7,5 t]. */
export type FilaExcel = (number | null)[];
export type DatosGasoleo = { fileDate: string; source: string; checkedAt: number | null; rows: FilaExcel[]; aviso?: string | null };

export type Semana = { ms: number; pvp: number | null; pvpsin: number | null; ieh: number | null; pai: number | null; gp: number | null; pge: number | null; plt: number | null };
export type Base = "pmed" | "pai" | "pvpsin" | "pvp";
export type BaseElegida = Base | "auto";
export type Vehiculo = "A" | "B" | "C" | "D";
/** Un precio puntual (la primera semana publicada desde ese día) o la media de un mes. */
export type Periodo = { modo: "fecha" | "mes"; fecha: string; mes: string };
export type Entrada = {
  referencia: Periodo;          // fecha del contrato
  realizacion: Periodo;         // realización del transporte
  vehiculo: Vehiculo;
  base: BaseElegida;            // precio para calcular G
  precio: number | null;        // precio pactado del transporte (€)
  umbral: number | null;        // umbral de revisión (%)
  redondeo: string;             // "none" o número de decimales del % de G
  gp: boolean;                  // MMA ≥ 7,5 t, con devolución del gasóleo profesional
  continuado: boolean;          // contrato continuado: revisión en cada facturación
  cManual: boolean;
  cValor: number | null;
};

// ---- Fechas (la Excel cuenta los días desde el 30-12-1899; todo en UTC para no mover el día) ----
export const DIA = 864e5;
const EPOCA = Date.UTC(1899, 11, 30);
export const serialAMs = (s: number) => EPOCA + s * DIA;
export const isoAMs = (s: string | null | undefined) => {
  if (!s) return NaN;
  const [y, m, d] = s.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};
export const msAIso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const fmtFecha = (ms: number) => {
  const d = new Date(ms);
  return String(d.getUTCDate()).padStart(2, "0") + "/" + String(d.getUTCMonth() + 1).padStart(2, "0") + "/" + d.getUTCFullYear();
};
/** Igual que el isFinite global del original: null cuenta como 0 (un campo vacío guardado como null). */
const finito = (x: unknown) => isFinite(x as number);

// ---- Números en formato español ----
export const nf = (v: number | null | undefined, d: number) =>
  v == null || !isFinite(v) ? "—" : v.toLocaleString("es-ES", { minimumFractionDigits: d, maximumFractionDigits: d });
export const pc = (v: number | null | undefined, d: number, signo?: boolean) => (signo && (v as number) > 0 ? "+" : "") + nf(v, d) + " %";

export const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
export const MESES_CORTOS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

// ---- Cambios de régimen ----
export const D_RDL18 = isoAMs("2026-07-01");   // RD-ley 18/2026: C según el Pmed
export const D_RDL9 = isoAMs("2026-04-16");    // RD-ley 9/2026: G con el Pmed; C según el PAI
export const D_RDL7 = isoAMs("2026-03-22");    // del 22-03 al 15-04-2026, G con el PAI

// ---- Coeficiente C: tramos [precio por debajo del cual se aplica, C] por tipo de vehículo ----
type Tramos = [number, number][];
/** RD-ley 18/2026 (desde el 1-7-2026): según el Pmed del transporte (€/l). */
export const T18: Record<Vehiculo, Tramos> = { A: [[1.18, .3], [1.73, .4], [Infinity, .5]], B: [[1.28, .2], [2.13, .3], [Infinity, .4]], C: [[1.08, .2], [1.78, .3], [Infinity, .4]], D: [[1.08, .1], [2.33, .2], [Infinity, .3]] };
/** RD-ley 9/2026 (16-4 al 30-6-2026): según el PAI del transporte (€/l). */
export const T9: Record<Vehiculo, Tramos> = { A: [[0.85, .3], [1.40, .4], [Infinity, .5]], B: [[0.95, .2], [1.80, .3], [Infinity, .4]], C: [[0.75, .2], [1.45, .3], [Infinity, .4]], D: [[0.70, .1], [1.95, .2], [Infinity, .3]] };
/** Antes: coeficiente fijo por vehículo. */
export const FIJO: Record<Vehiculo, number> = { A: .3, B: .2, C: .2, D: .1 };
export const elegirC = (t: Tramos, v: number) => { for (const [lim, c] of t) if (v < lim) return c; return t[t.length - 1][1]; };

export const VEHICULOS: { id: Vehiculo; nombre: string; corto: string }[] = [
  { id: "A", nombre: "A · MMA ≥ 20.000 kg (salvo obras)", corto: "A · ≥ 20 t" },
  { id: "B", nombre: "B · MMA entre 3.500 y 20.000 kg (salvo obras)", corto: "B · 3,5–20 t" },
  { id: "C", nombre: "C · Obras con MMA > 3.500 kg", corto: "C · Obras" },
  { id: "D", nombre: "D · MMA ≤ 3.500 kg", corto: "D · ≤ 3,5 t" },
];
export const BASES: { id: BaseElegida; nombre: string }[] = [
  { id: "auto", nombre: "Automático según fecha del transporte" },
  { id: "pmed", nombre: "Pmed (PVP sin IVA ni devolución gasóleo profesional)" },
  { id: "pai", nombre: "Precio antes de impuestos (PAI)" },
  { id: "pvpsin", nombre: "PVP sin IVA" },
  { id: "pvp", nombre: "PVP en surtidor" },
];
export const REDONDEOS: { id: string; nombre: string }[] = [
  { id: "none", nombre: "Sin redondeo" },
  { id: "0", nombre: "0 decimales (43 %)" },
  { id: "1", nombre: "1 decimal (42,6 %)" },
  { id: "2", nombre: "2 decimales (42,57 %)" },
  { id: "3", nombre: "3 decimales (42,573 %)" },
  { id: "4", nombre: "4 decimales (42,5731 %)" },
];
export const NOMBRE_BASE: Record<Base, string> = { pmed: "Pmed", pai: "PAI", pvpsin: "PVP sin IVA", pvp: "PVP" };

// ---- Datos ----
/** Filas de la Excel a semanas ordenadas. Un Pmed a 0 es que esa semana no lo tiene. */
export function cargarSemanas(rows: FilaExcel[]): Semana[] {
  return rows.map((r) => ({ ms: serialAMs(r[0] as number), pvp: r[1], pvpsin: r[2], ieh: r[3], pai: r[4], gp: r[5], pge: r[6] || null, plt: r[7] || null }))
    .sort((a, b) => a.ms - b.ms);
}
/** Última semana con PVP publicado. */
export function ultimaSemana(semanas: Semana[]): Semana {
  for (let i = semanas.length - 1; i >= 0; i--) if (semanas[i].pvp != null) return semanas[i];
  return semanas[semanas.length - 1];
}

/** Precio de una semana según la base. Pmed: el de la hoja PRECIOS DE REFERENCIA; si no está, PVP sin IVA menos la
 *  devolución del gasóleo profesional (solo para MMA ≥ 7,5 t). */
export function precioSemana(row: Semana, base: Base, ge75: boolean): number | null {
  if (base === "pvp") return row.pvp;
  if (base === "pai") return row.pai;
  if (base === "pvpsin") return row.pvpsin;
  let p = ge75 ? row.pge : row.plt;
  if (p == null && row.pvpsin != null) p = row.pvpsin - (ge75 ? (row.gp || 0) : 0);
  return p;
}

/** Fecha: la primera semana de la Excel igual o posterior al día. Mes: las semanas cuya fecha cae en ese mes. */
export function semanasDe(semanas: Semana[], p: Periodo): Semana[] {
  if (p.modo === "fecha") {
    const t = isoAMs(p.fecha); if (!isFinite(t)) return [];
    const w = semanas.find((r) => r.ms >= t) || null;
    return w ? [w] : [];
  }
  if (!/^\d{4}-\d{2}$/.test(p.mes || "")) return [];
  const [y, m] = p.mes.split("-").map(Number);
  return semanas.filter((r) => { const d = new Date(r.ms); return d.getUTCFullYear() === y && d.getUTCMonth() + 1 === m; });
}

/** Media simple de los precios disponibles. */
export function media(ws: Semana[], base: Base, ge75: boolean): { v: number | null; n: number } {
  const v = ws.map((w) => precioSemana(w, base, ge75)).filter((x): x is number => x != null && isFinite(x));
  return v.length ? { v: v.reduce((s, x) => s + x, 0) / v.length, n: v.length } : { v: null, n: 0 };
}

/** Día que decide el régimen: la fecha indicada o el último día del mes. */
export function finDe(p: Periodo): number {
  if (p.modo === "fecha") return isoAMs(p.fecha);
  if (!/^\d{4}-\d{2}$/.test(p.mes || "")) return NaN;
  const [y, m] = p.mes.split("-").map(Number);
  return Date.UTC(y, m, 0);
}

/** Precio para G en automático: desde el 16-4-2026 Pmed; del 22-3 al 15-4-2026 PAI; antes PVP. */
export const baseAutomatica = (tFin: number): Base => (!isFinite(tFin) ? "pmed" : tFin >= D_RDL9 ? "pmed" : tFin >= D_RDL7 ? "pai" : "pvp");

/** Redondeo aritmético (5 o más sube, también en negativo), con un margen para el ruido de coma flotante. */
export const redondearMitadArriba = (x: number, n: number) => { const f = Math.pow(10, n); return Math.sign(x) * Math.round(Math.abs(x) * f + 1e-9) / f; };

export type OrigenC = { tipo: "manual" } | { tipo: "rdl18"; pmed: number } | { tipo: "rdl9"; pai: number } | { tipo: "fijo" } | null;
export type Veredicto = "faltan" | "continuado" | "obligatoria" | "debajo";
export type Resultado = {
  base: Base; ge: boolean; wr: Semana[]; wt: Semana[]; rv: number | null; tv: number | null; mesIncompleto: boolean;
  C: number | null; origenC: OrigenC; G0: number | null; G: number | null; nd: number | null; gd: number;
  pct: number | null; dP: number | null; umbral: number; veredicto: Veredicto;
};

/** ΔP = G × P × C / 100 · G = (P cálculo − P referencia) / P referencia × 100. */
export function calcular(semanas: Semana[], e: Entrada): Resultado {
  const ge = e.gp;
  const tFin = finDe(e.realizacion);
  const base = e.base === "auto" ? baseAutomatica(tFin) : e.base;
  const wr = semanasDe(semanas, e.referencia), wt = semanasDe(semanas, e.realizacion);
  const r = media(wr, base, ge), t = media(wt, base, ge);
  // Mes del transporte posterior a la última semana publicada (+6 días): todavía faltan semanas en la Excel.
  const mesIncompleto = e.realizacion.modo === "mes" && isFinite(tFin) && tFin > ultimaSemana(semanas).ms + 6 * DIA && wt.length > 0;

  // C: desde el 1-7-2026 según el Pmed del transporte; del 16-4 al 30-6-2026 según el PAI; antes, fijo por vehículo.
  // Si el transporte va por mes, con la media de ese mes.
  let C: number | null = null, origenC: OrigenC = null;
  if (e.cManual) { C = e.cValor; origenC = { tipo: "manual" }; }
  else if (isFinite(tFin) && tFin >= D_RDL18) { const pm = media(wt, "pmed", ge).v; if (pm != null) { C = elegirC(T18[e.vehiculo], pm); origenC = { tipo: "rdl18", pmed: pm }; } }
  else if (isFinite(tFin) && tFin >= D_RDL9) { const pa = media(wt, "pai", ge).v; if (pa != null) { C = elegirC(T9[e.vehiculo], pa); origenC = { tipo: "rdl9", pai: pa }; } }
  else if (isFinite(tFin)) { C = FIJO[e.vehiculo]; origenC = { tipo: "fijo" }; }

  const G0 = (r.v && t.v != null) ? (t.v - r.v) / r.v * 100 : null;
  const nd = e.redondeo === "none" ? null : parseInt(e.redondeo, 10);
  // G se redondea antes de multiplicar por C, y ese G redondeado es el que se compara con el umbral.
  const G = G0 == null ? null : (nd == null ? G0 : redondearMitadArriba(G0, nd));
  const gd = nd == null ? 4 : nd;
  const pct = (G != null && C != null) ? G * C : null;
  const dP = (pct != null && finito(e.precio)) ? (e.precio as number) * pct / 100 : null;
  // Revisión obligatoria si |G| ≥ 5 % (o el umbral menor pactado) y siempre en los contratos continuados.
  const umbral = (finito(e.umbral) ? e.umbral : 5) as number;
  const veredicto: Veredicto = G == null ? "faltan" : e.continuado ? "continuado" : Math.abs(G) >= umbral ? "obligatoria" : "debajo";
  return { base, ge, wr, wt, rv: r.v, tv: t.v, mesIncompleto, C, origenC, G0, G, nd, gd, pct, dP, umbral, veredicto };
}

// ---- Textos del resultado (los mismos que la calculadora original) ----
export function textoSemanas(ws: Semana[], p: Periodo): string {
  if (!ws.length) return p.modo === "mes" ? "El Ministerio no tiene precios publicados para ese mes." : "El Ministerio aún no ha publicado ningún precio en esa fecha o después.";
  if (p.modo === "fecha") return "Precio del " + fmtFecha(ws[0].ms) + " (primera fecha publicada igual o posterior)";
  const d = new Date(ws[0].ms), mes = MESES[d.getUTCMonth()] + " de " + d.getUTCFullYear();
  const n = ws.length;
  return "Media de " + n + (n === 1 ? " semana" : " semanas") + " de " + mes + ": " + ws.map((w) => fmtFecha(w.ms).slice(0, 5)).join(", ");
}

export type Textos = {
  refVal: string; realVal: string; refSemanas: string; realSemanas: string;
  G: string; Gdetalle: string; C: string; Cdetalle: string; pct: string; dP: string; nuevoPrecio: string; formula: string;
  veredicto: string; veredictoClase: "ok" | "warn" | "info"; pista: string; serie: string;
};

export function textos(e: Entrada, r: Resultado): Textos {
  const bn = NOMBRE_BASE[r.base];
  const Cdetalle = !r.origenC ? "" : r.origenC.tipo === "manual" ? "Fijado a mano"
    : r.origenC.tipo === "rdl18" ? "RDL 18/2026 · Pmed " + nf(r.origenC.pmed, 3) + " €/l"
    : r.origenC.tipo === "rdl9" ? "RDL 9/2026 · " + NOMBRE_BASE.pai + " " + nf(r.origenC.pai, 3) + " €/l"
    : "Coeficiente fijo anterior · verifícalo";
  const formula = (r.G != null && r.C != null)
    ? ((r.nd == null ? "Sin redondear (G = " + pc(r.G0, 6) + ") · " : "G sin redondear " + pc(r.G0, 6) + " · ")
      + "ΔP = " + nf(r.G, r.gd) + " × " + (finito(e.precio) ? nf(e.precio, 2) : "P") + " × " + nf(r.C, 2) + " / 100")
    : "";
  const [veredicto, veredictoClase]: [string, Textos["veredictoClase"]] =
    r.veredicto === "faltan" ? ["Faltan datos para calcular", "info"]
    : r.veredicto === "continuado" ? ["Revisión obligatoria: contrato continuado", "ok"]
    : r.veredicto === "obligatoria" ? ["Revisión obligatoria: |G| ≥ " + pc(r.umbral, 1), "ok"]
    : ["Por debajo del umbral del " + pc(r.umbral, 1) + ": no es obligatoria", "warn"];
  return {
    refVal: nf(r.rv, 5), realVal: nf(r.tv, 5),
    refSemanas: textoSemanas(r.wr, e.referencia),
    realSemanas: textoSemanas(r.wt, e.realizacion) + (r.mesIncompleto ? " · El mes aún no está completo en la Excel." : ""),
    G: r.G == null ? "—" : pc(r.G, r.gd, true),
    Gdetalle: bn + (r.base === "pmed" ? " · " + (r.ge ? "MMA ≥ 7,5 t" : "MMA < 7,5 t") : ""),
    C: r.C == null ? "—" : nf(r.C, 2), Cdetalle,
    pct: r.pct == null ? "—" : pc(r.pct, 2, true),
    dP: r.dP == null ? "—" : (r.dP > 0 ? "+" : "") + nf(r.dP, 2) + " €",
    nuevoPrecio: r.dP == null ? "" : "Nuevo precio: " + nf((e.precio as number) + r.dP, 2) + " €",
    formula, veredicto, veredictoClase,
    pista: e.base === "auto" ? "Precio usado para G: " + bn + ", según la fecha de realización del transporte." : "Precio para G elegido a mano: " + bn + ".",
    serie: bn + " semanal (€/l)",
  };
}

/** Texto de los tramos de C para la explicación, p. ej. «< 1,18 → 0,3 · 1,18–1,73 → 0,4 · ≥ 1,73 → 0,5». */
export const textoTramos = (t: Tramos) => t.map(([lim, c], i) => {
  const prev = i ? t[i - 1][0] : null;
  return (prev == null ? "< " + nf(lim, 2) : lim === Infinity ? "≥ " + nf(prev, 2) : nf(prev, 2) + "–" + nf(lim, 2)) + " → " + nf(c, 1);
}).join(" · ");

/** Semanas usadas, por fecha: las de la referencia marcadas «ref» (también si coinciden con la realización). */
export function semanasUsadas(semanas: Semana[], wr: Semana[], wt: Semana[]): { semana: Semana; clase: "in-ref" | "in-real" }[] {
  const marca = new Map<number, "in-ref" | "in-real">();
  wr.forEach((w) => marca.set(w.ms, "in-ref"));
  wt.forEach((w) => marca.set(w.ms, marca.has(w.ms) ? "in-ref" : "in-real"));
  return [...marca.keys()].sort((a, b) => a - b).map((ms) => ({ semana: semanas.find((r) => r.ms === ms) as Semana, clase: marca.get(ms)! }));
}

// ---- Gráfica «Evolución del precio usado para G» (solo números; la pinta la pantalla) ----
export type Grafica = {
  W: number; H: number; m: { l: number; r: number; t: number; b: number };
  bandas: { x: number; y: number; width: number; height: number; tipo: "ref" | "real" }[];
  rejilla: { y: number; texto: string }[];
  meses: { x: number; texto: string }[];
  linea: string; area: string; ultimo: { cx: number; cy: number };
};

export function grafica(semanas: Semana[], base: Base, ge: boolean, wr: Semana[], wt: Semana[], ancho: number): Grafica | null {
  const W = Math.max(560, ancho || 900), H = 260, m = { l: 52, r: 14, t: 12, b: 28 };
  const ult = ultimaSemana(semanas).ms;
  const todas = [...wr, ...wt].map((w) => w.ms);
  let a = todas.length ? Math.min(...todas) : ult - 365 * DIA, b = todas.length ? Math.max(...todas) : ult;
  const margen = Math.max(28 * DIA, (b - a) * 0.15); a -= margen; b = Math.min(b + margen, ult + 7 * DIA); if (b - a < 60 * DIA) a = b - 60 * DIA;
  const pts = semanas.filter((r) => r.ms >= a && r.ms <= b).map((r) => ({ ms: r.ms, v: precioSemana(r, base, ge) })).filter((p): p is { ms: number; v: number } => p.v != null);
  if (pts.length < 2) return null;
  let lo = Math.min(...pts.map((p) => p.v)), hi = Math.max(...pts.map((p) => p.v)); const sp = (hi - lo) || 0.1; lo -= sp * .1; hi += sp * .1;
  const x = (ms: number) => m.l + (ms - a) / (b - a) * (W - m.l - m.r), y = (v: number) => m.t + (hi - v) / (hi - lo) * (H - m.t - m.b);
  const bandas: Grafica["bandas"] = [];
  for (const [ws, tipo] of [[wr, "ref"], [wt, "real"]] as const) {
    if (!ws.length) continue;
    const x0 = x(ws[0].ms), x1 = x(ws[ws.length - 1].ms + 7 * DIA);
    bandas.push({ x: Math.max(m.l, x0), y: m.t, width: Math.max(3, Math.min(W - m.r, x1) - Math.max(m.l, x0)), height: H - m.t - m.b, tipo });
  }
  const paso = (hi - lo) / 4, rejilla: Grafica["rejilla"] = [];
  for (let i = 0; i <= 4; i++) { const v = lo + paso * i; rejilla.push({ y: y(v), texto: nf(v, 3) }); }
  const meses: Grafica["meses"] = [];
  const span = b - a, nMeses = span / (30 * DIA), cada = nMeses > 36 ? 12 : nMeses > 14 ? 3 : nMeses > 6 ? 2 : 1;
  const d0 = new Date(a); let cur = Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + 1, 1);
  while (cur < b) {
    const d = new Date(cur);
    if (d.getUTCMonth() % cada === 0) meses.push({ x: x(cur), texto: MESES_CORTOS[d.getUTCMonth()] + " " + String(d.getUTCFullYear()).slice(2) });
    cur = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  }
  const linea = pts.map((p, i) => (i ? "L" : "M") + x(p.ms).toFixed(1) + " " + y(p.v).toFixed(1)).join(" ");
  const area = `${linea} L${x(pts[pts.length - 1].ms).toFixed(1)} ${H - m.b} L${x(pts[0].ms).toFixed(1)} ${H - m.b} Z`;
  const e = pts[pts.length - 1];
  return { W, H, m, bandas, rejilla, meses, linea, area, ultimo: { cx: x(e.ms), cy: y(e.v) } };
}

// ---- Estado de la pantalla ----
/** Lo que se ve al abrir por primera vez: contrato el 15-1-2026 y transporte en el mes de la última semana publicada. */
export function entradaInicial(semanas: Semana[]): Entrada {
  const ult = msAIso(ultimaSemana(semanas).ms);
  return {
    referencia: { modo: "fecha", fecha: "2026-01-15", mes: "2025-12" },
    realizacion: { modo: "mes", fecha: ult, mes: ult.slice(0, 7) },
    vehiculo: "A", base: "auto", precio: 1000, umbral: 5, redondeo: "2", gp: true, continuado: false, cManual: false, cValor: 0.4,
  };
}

/** Lo guardado en el navegador sobre lo inicial (mismas reglas que el original: un periodo sin modo válido va por mes). */
export function restaurarEntrada(guardado: unknown, inicial: Entrada): Entrada {
  if (!guardado || typeof guardado !== "object") return inicial;
  const s = { ...(guardado as Record<string, unknown>) } as Record<string, unknown>;
  for (const k of ["referencia", "realizacion"] as const) {
    const p = s[k] as Partial<Periodo> | undefined;
    if (p && typeof p === "object") {
      s[k] = { modo: p.modo === "fecha" ? "fecha" : "mes", fecha: p.fecha || inicial[k].fecha, mes: p.mes || inicial[k].mes };
    }
  }
  return { ...inicial, ...(s as Partial<Entrada>) };
}

/** Cambiar de vehículo: el A siempre lleva devolución del gasóleo profesional y el D nunca. */
export function conVehiculo(e: Entrada, v: Vehiculo): Entrada {
  return { ...e, vehiculo: v, gp: v === "A" ? true : v === "D" ? false : e.gp };
}
export const gpFijo = (v: Vehiculo) => v === "A" || v === "D";

/** Etiqueta corta de un periodo para compartir: «15/01/2026» o «Diciembre 2025». */
export function etiquetaPeriodo(p: Periodo): string {
  if (p.modo === "fecha") return fmtFecha(isoAMs(p.fecha));
  if (!/^\d{4}-\d{2}$/.test(p.mes || "")) return "—";
  const [y, m] = p.mes.split("-").map(Number);
  return MESES[m - 1].charAt(0).toUpperCase() + MESES[m - 1].slice(1) + " " + y;
}
export function detallePeriodo(ws: Semana[], p: Periodo): string {
  if (!ws.length) return "Sin precio publicado";
  if (p.modo === "fecha") return "Precio publicado el " + fmtFecha(ws[0].ms);
  return "Media de " + ws.length + (ws.length === 1 ? " semana" : " semanas");
}
