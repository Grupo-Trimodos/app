// Compara la calculadora de gasóleo de la app (src/lib/gasoleo.ts) con la original de GitHub (index.html de
// Revision-Gasoleo) en miles de combinaciones: mismos números, mismos textos, misma gráfica y misma tabla de semanas.
//
// Uso:  node --experimental-strip-types scripts/comprobar_gasoleo.mjs <index.html original> <data.json>
// Sale con código 1 si hay alguna diferencia. La lógica original se ejecuta sin navegador: se recortan del <script>
// las partes de cálculo (textos, datos, calc, gráfica y tabla) y se les da una página de mentira que guarda los textos.
// Además de los precios reales, prueba dos series inventadas que caen justo en los tramos de C, en los redondeos
// «del 5» y en el límite de «el mes aún no está completo».
import { readFileSync } from "node:fs";
import * as g from "../src/lib/gasoleo.ts";

const [, , rutaHtml, rutaDatos] = process.argv;
if (!rutaHtml || !rutaDatos) { console.error("Uso: node --experimental-strip-types scripts/comprobar_gasoleo.mjs <index.html> <data.json>"); process.exit(2); }
const html = readFileSync(rutaHtml, "utf8");
const REAL = JSON.parse(readFileSync(rutaDatos, "utf8"));

// ---- La original, recortada ----
const script = html.slice(html.lastIndexOf("<script>") + 8, html.lastIndexOf("</script>"));
const trozo = (desde, hasta) => {
  const i = script.indexOf(desde), j = script.indexOf(hasta, i + 1);
  if (i < 0 || j < 0) throw new Error(`No encuentro el trozo ${desde} … ${hasta}`);
  return script.slice(i, j);
};
const codigo = [
  trozo("const TX={", "// Textos fijos de la página"),
  "let LANG='es'; let L=TX.es;",
  trozo("const MIN_URL=", "// ---- Datos ----"),
  trozo("let DATA={...SEED", "// ---- Estado de la interfaz ----"),
  trozo("const lastMs=", "try{const s=JSON.parse"),   // estado inicial (const S=…)
  "function restaurar(guardado){const localStorage={getItem:()=>guardado};" + trozo("try{const s=JSON.parse", "function save()") + "}",
  "function save(){}",
  trozo("const BN=", "// ---- Gráfica ----"),
  trozo("function drawChart(){", "window.addEventListener(\"resize\""),
  trozo("function drawTable(){", "// ---- Estado de los datos ----"),
  `drawCTables();
   const inicial = JSON.parse(JSON.stringify(S));
   return {
     L, inicial,
     restaurar(guardado){ for(const k in S) delete S[k]; Object.assign(S, JSON.parse(JSON.stringify(inicial))); restaurar(guardado); return JSON.parse(JSON.stringify(S)); },
     calcular(estado){ for(const k in S) delete S[k]; Object.assign(S, estado); calc(); return LAST; },
   };`,
].join("\n");

/** La original sobre unos datos, con su página de mentira. */
function crearOriginal(seed) {
  const pagina = { ancho: 900, elementos: {} };
  const elemento = (id) => pagina.elementos[id] ??= {
    id, textContent: "", className: "", innerHTML: "", hidden: false,
    get clientWidth() { return pagina.ancho; },
    setAttribute() {}, querySelector() { return elemento(id + ">tbody"); },
  };
  const api = new Function("SEED", "document", codigo)(seed, { getElementById: elemento });
  return { ...api, pagina, elemento, texto: (id) => elemento(id).textContent };
}
// specLabel/specDetail de la original (textos para compartir), con su propio objeto de textos L.
const cuerpo = (inicio, fin) => trozo(inicio, fin).slice(inicio.length).replace(/\}\s*$/, "");
const specLabel = new Function("spec", "fmtDate", "isoToMs", "L", cuerpo("function specLabel(spec){", "function specDetail"));
const specDetail = new Function("ws", "spec", "fmtDate", "L", cuerpo("function specDetail(ws,spec){", "function roundRect"));

// ---- Traducción de nombres entre la original y la nueva ----
const aPeriodo = (p) => ({ modo: p.mode === "date" ? "fecha" : "mes", fecha: p.date, mes: p.month });
const aEntrada = (S) => ({
  referencia: aPeriodo(S.ref), realizacion: aPeriodo(S.real), vehiculo: S.veh, base: S.basis, precio: S.price, umbral: S.thr,
  redondeo: S.rnd, gp: S.gp, continuado: S.cont, cManual: S.cMan, cValor: S.cVal,
});
const deEntrada = (e) => ({
  ref: { mode: e.referencia.modo === "fecha" ? "date" : "month", date: e.referencia.fecha, month: e.referencia.mes },
  real: { mode: e.realizacion.modo === "fecha" ? "date" : "month", date: e.realizacion.fecha, month: e.realizacion.mes },
  veh: e.vehiculo, basis: e.base, price: e.precio, thr: e.umbral, rnd: e.redondeo, gp: e.gp, cont: e.continuado, cMan: e.cManual, cVal: e.cValor,
});
function aGuardadoNuevo(s) {
  const p = (x) => x && { modo: x.mode === "date" ? "fecha" : x.mode === "month" ? "mes" : x.mode, fecha: x.date, mes: x.month };
  const r = {};
  if ("ref" in s) r.referencia = p(s.ref);
  if ("real" in s) r.realizacion = p(s.real);
  const nombres = { veh: "vehiculo", basis: "base", price: "precio", thr: "umbral", rnd: "redondeo", gp: "gp", cont: "continuado", cMan: "cManual", cVal: "cValor" };
  for (const [a, b] of Object.entries(nombres)) if (a in s) r[b] = s[a];
  return r;
}
// La gráfica de la nueva, escrita con la misma plantilla SVG que la original, para comparar la cadena entera.
function svgNueva(gr) {
  if (!gr) return "";
  const { W, H, m } = gr; let h = "";
  for (const b of gr.bandas) h += `<rect x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" fill="${b.tipo === "ref" ? "var(--band-a)" : "var(--band-b)"}"/>`;
  for (const r of gr.rejilla) h += `<line x1="${m.l}" x2="${W - m.r}" y1="${r.y}" y2="${r.y}" stroke="var(--line)" stroke-width="1"/><text x="${m.l - 6}" y="${r.y + 4}" text-anchor="end">${r.texto}</text>`;
  for (const t of gr.meses) h += `<line x1="${t.x}" x2="${t.x}" y1="${H - m.b}" y2="${H - m.b + 4}" stroke="var(--muted)"/><text x="${t.x}" y="${H - 8}" text-anchor="middle">${t.texto}</text>`;
  h += `<path d="${gr.area}" fill="var(--accent)" opacity=".08"/>`;
  h += `<path d="${gr.linea}" fill="none" stroke="var(--accent)" stroke-width="2"/>`;
  h += `<circle cx="${gr.ultimo.cx}" cy="${gr.ultimo.cy}" r="4" fill="var(--accent)"/>`;
  return h;
}
const nf = g.nf;
const tablaNueva = (filas) => filas.map(({ semana: r, clase }) => `<tr class="${clase}"><td>${g.fmtFecha(r.ms)}</td><td>${nf(r.pvp, 5)}</td><td>${nf(r.pvpsin, 5)}</td><td>${nf(r.ieh, 5)}</td><td>${nf(r.pai, 5)}</td><td>${nf(r.gp, 3)}</td><td>${nf(r.pge, 5)}</td><td>${nf(r.plt, 5)}</td></tr>`).join("");
const filasC = (t) => g.VEHICULOS.map((v) => `<tr><td>${v.corto}</td><td class="mono">${g.textoTramos(t[v.id])}</td></tr>`).join("");

// ---- Comparación ----
let casos = 0, diferencias = 0;
const porSerie = {};
const iguales = (a, b) => Object.is(a, b) || JSON.stringify(a) === JSON.stringify(b);
function comparar(nombre, a, b, caso) {
  if (iguales(a, b)) return;
  diferencias++;
  if (diferencias <= 15) console.log(`DIFERENCIA en ${nombre}\n  original: ${JSON.stringify(a)}\n  nueva:    ${JSON.stringify(b)}\n  caso: ${JSON.stringify(caso)}`);
}

function probar(ctx, S, ancho) {
  casos++; porSerie[ctx.nombre] = (porSerie[ctx.nombre] ?? 0) + 1;
  const { original: o, semanas } = ctx;
  o.pagina.ancho = ancho;
  const L0 = o.calcular(structuredClone(S));
  const e = aEntrada(S), r = g.calcular(semanas, e), t = g.textos(e, r);
  const caso = { serie: ctx.nombre, ancho, ...S };
  // Números
  comparar("base", L0.basis, r.base, caso); comparar("ge", L0.ge, r.ge, caso);
  comparar("semanas ref", L0.wr.map((w) => w.ms), r.wr.map((w) => w.ms), caso);
  comparar("semanas real", L0.wt.map((w) => w.ms), r.wt.map((w) => w.ms), caso);
  comparar("rv", L0.rv, r.rv, caso); comparar("tv", L0.tv, r.tv, caso);
  comparar("G", L0.G, r.G, caso); comparar("gd", L0.gd, r.gd, caso); comparar("C", L0.C, r.C, caso); comparar("pct", L0.pct, r.pct, caso);
  if (r.G != null) ctx.conG++;
  // Textos de la pantalla
  const pares = [["refVal", t.refVal], ["realVal", t.realVal], ["refWeeks", t.refSemanas], ["realWeeks", t.realSemanas],
    ["rG", t.G], ["rGs", t.Gdetalle], ["rC", t.C], ["rCs", t.Cdetalle], ["rPct", t.pct], ["rDP", t.dP], ["rNP", t.nuevoPrecio],
    ["rFormula", t.formula], ["rVerdict", t.veredicto], ["basisHint", t.pista], ["lgSeries", t.serie]];
  for (const [id, nuevo] of pares) comparar(id, o.texto(id), nuevo, caso);
  comparar("clase del veredicto", o.elemento("rVerdict").className, "pill " + t.veredictoClase, caso);
  comparar("cNote", L0.cNote, t.Cdetalle, caso);
  // Gráfica y tabla de semanas
  comparar("gráfica", o.elemento("svg").innerHTML, svgNueva(g.grafica(semanas, r.base, r.ge, r.wr, r.wt, ancho)), caso);
  comparar("tabla", o.elemento("tbl>tbody").innerHTML, tablaNueva(g.semanasUsadas(semanas, r.wr, r.wt)), caso);
  // Textos para compartir
  comparar("etiqueta ref", specLabel(S.ref, g.fmtFecha, g.isoAMs, o.L), g.etiquetaPeriodo(e.referencia), caso);
  comparar("etiqueta real", specLabel(S.real, g.fmtFecha, g.isoAMs, o.L), g.etiquetaPeriodo(e.realizacion), caso);
  comparar("detalle real", specDetail(r.wt, S.real, g.fmtFecha, o.L), g.detallePeriodo(r.wt, e.realizacion), caso);
}

// Generador fijo (mismas combinaciones en cada ejecución)
let semilla = 20261117;
const azar = () => ((semilla = (semilla * 1103515245 + 12345) % 2147483648) / 2147483648);
const uno = (lista) => lista[Math.floor(azar() * lista.length)];
const vehiculos = ["A", "B", "C", "D"], bases = ["auto", "pmed", "pai", "pvpsin", "pvp"], redondeos = ["none", "0", "1", "2", "3", "4"];
const base = { ref: { mode: "date", date: "2026-01-15", month: "2025-12" }, veh: "A", basis: "auto", price: 1000, thr: 5, rnd: "2", gp: true, cont: false, cMan: false, cVal: 0.4 };

function serie(nombre, seed) {
  return { nombre, seed, original: crearOriginal(seed), semanas: g.cargarSemanas(seed.rows), conG: 0 };
}

// Series inventadas: cada semana con un PAI y un Pmed sacados de los límites de los tramos de C (justo en el límite y
// a una cienmilésima por cada lado) y de precios que dan G «del 5» (1 → 1,00125 = +0,125 %).
const SERIAL0 = Date.UTC(1899, 11, 30);
const serialDe = (iso) => (g.isoAMs(iso) - SERIAL0) / g.DIA;
const limitesC = [...new Set([...Object.values(g.T18), ...Object.values(g.T9)].flat().map(([l]) => l).filter(isFinite))];
const PRECIOS = [...limitesC.flatMap((l) => [l, +(l - 1e-5).toFixed(5), +(l + 1e-5).toFixed(5)]), 1, 1.00125, 1.000125, 1.0125, 0.99875, 1.05, 0.95, 1.5, 1.575, 1.0005, 0.9995];
function sintetica(ultimoIso, semanasN = 70) {
  const fin = serialDe(ultimoIso), rows = [];
  for (let i = 0; i < semanasN; i++) {
    const s = fin - 7 * (semanasN - 1 - i), pai = PRECIOS[i % PRECIOS.length], pvpsin = +(pai + 0.379).toFixed(6);
    rows.push([s, +(pvpsin * 1.21).toFixed(5), pvpsin, 0.379, pai, i % 2 ? 0.037 : 0, i % 6 === 0 ? 0 : PRECIOS[(i * 7 + 3) % PRECIOS.length], i % 5 === 0 ? 0 : PRECIOS[(i * 3 + 1) % PRECIOS.length]]);
  }
  return { fileDate: ultimoIso, source: "sintetica", checkedAt: 0, rows };
}

const series = [serie("real", REAL), serie("sintética 23-11", sintetica("2026-11-23")), serie("sintética 24-11", sintetica("2026-11-24"))];

for (const ctx of series) {
  const { semanas } = ctx;
  const ultima = g.ultimaSemana(semanas).ms;
  const fechas = [
    "2018-01-01", "2018-01-02", "2019-06-15", "2020-04-20", "2021-12-31", "2022-03-14", "2023-08-01", "2024-02-29", "2025-01-15", "2025-12-31",
    "2026-01-15", "2026-03-15", "2026-03-21", "2026-03-22", "2026-03-23", "2026-04-15", "2026-04-16", "2026-04-17", "2026-05-31",
    "2026-06-29", "2026-06-30", "2026-07-01", "2026-07-02", "2026-09-10", "2026-10-31", g.msAIso(ultima - g.DIA), g.msAIso(ultima),
    g.msAIso(ultima + g.DIA), "2027-01-01", "", "2017-12-01", "2026-02-30",
  ];
  for (const s of semanas.slice(-40)) { fechas.push(g.msAIso(s.ms)); fechas.push(g.msAIso(s.ms - 3 * g.DIA)); }
  const meses = ["2018-01", "2019-07", "2020-04", "2022-03", "2024-02", "2025-12", "2026-01", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07",
    "2026-08", "2026-10", "2026-11", "2026-12", "2027-01", "", "2026-1", "2017-12"];
  const periodo = () => ({ mode: uno(["date", "month"]), date: uno(fechas), month: uno(meses) });

  // 1) Rejilla: fechas límite de cada régimen × vehículo × base × MMA, por fecha y por mes.
  const limites = ["2026-03-21", "2026-03-22", "2026-04-15", "2026-04-16", "2026-06-30", "2026-07-01", g.msAIso(ultima)];
  const mesesLimite = ["2026-03", "2026-04", "2026-06", "2026-07", "2026-11"];
  for (const veh of vehiculos) for (const basis of bases) for (const gp of [true, false]) {
    for (const d of limites) probar(ctx, { ...base, real: { mode: "date", date: d, month: "2026-07" }, veh, basis, gp }, 900);
    for (const m of mesesLimite) probar(ctx, { ...base, ref: { mode: "month", date: "2026-01-15", month: "2025-12" }, real: { mode: "month", date: "2026-01-01", month: m }, veh, basis, price: 1234.56, rnd: "none", gp }, 700);
  }
  // 2) Redondeo, umbral y precio del transporte (también vacíos: NaN y null).
  for (const rnd of redondeos) for (const thr of [5, 0, 2.5, 4.999, NaN, null]) for (const price of [1000, 0, -50, 1234.567, NaN, null])
    probar(ctx, { ...base, ref: { mode: "date", date: "2025-12-31", month: "2025-12" }, real: { mode: "month", date: "2026-01-01", month: "2026-10" }, price, thr, rnd }, 900);
  // 3) Cada semana contra cada semana (las inventadas tocan todos los tramos de C y los redondeos «del 5»).
  const ultimas = semanas.slice(-(ctx.nombre === "real" ? 25 : 70));
  for (const a of ultimas) for (const b of ultimas)
    probar(ctx, { ...base, ref: { mode: "date", date: g.msAIso(a.ms), month: "2025-12" }, real: { mode: "date", date: g.msAIso(b.ms), month: "2026-01" },
      veh: uno(vehiculos), basis: uno(bases), rnd: uno(redondeos), gp: azar() < .5, thr: uno([5, 0.125, 0.13, 0.12]), price: uno([1000, 800]) }, 900);
  // 4) Combinaciones al azar.
  for (let i = 0; i < 2000; i++) {
    probar(ctx, {
      ref: periodo(), real: periodo(), veh: uno(vehiculos), basis: uno(bases), price: uno([1000, 0, 250.5, 1e6, -10, NaN, null]),
      thr: uno([5, 0, 1, 3.3, 10, NaN, null]), rnd: uno(redondeos), gp: azar() < .5, cont: azar() < .2, cMan: azar() < .2,
      cVal: uno([0.4, 0, 1, 0.35, NaN, null]),
    }, uno([0, 320, 560, 900, 1200]));
  }
}

// 5) Estado inicial, lo guardado en el navegador y las tablas de C (con los precios reales).
const real = series[0];
casos++; comparar("estado inicial", real.original.inicial, deEntrada(g.entradaInicial(real.semanas)), "inicial");
const guardados = [
  null, "null", "{}", "no es json",
  JSON.stringify({ ref: { mode: "month", month: "2026-02" }, veh: "C", price: 99 }),
  JSON.stringify({ ref: { mode: "raro", date: "2026-03-01" }, real: { date: "" }, rnd: "none", gp: false }),
  JSON.stringify({ real: { mode: "date", date: "2026-07-02", month: "" }, cMan: true, cVal: 0.25, thr: null }),
];
for (const gu of guardados) {
  casos++;
  const o = real.original.restaurar(gu);
  let nuevo;
  try { const s = JSON.parse(gu ?? "null"); nuevo = deEntrada(g.restaurarEntrada(s && aGuardadoNuevo(s), g.entradaInicial(real.semanas))); }
  catch { nuevo = deEntrada(g.entradaInicial(real.semanas)); }
  comparar("restaurar " + gu, o, nuevo, gu);
}
casos++; comparar("tabla C RDL 18", real.original.elemento("ct18").innerHTML, filasC(g.T18), "ct18");
casos++; comparar("tabla C RDL 9", real.original.elemento("ct9").innerHTML, filasC(g.T9), "ct9");
// 6) Cambio de vehículo: A siempre con devolución GP y D nunca (como el «change» del selector original).
for (const v of vehiculos) for (const gp of [true, false]) {
  casos++;
  const esperado = v === "A" ? true : v === "D" ? false : gp;
  comparar("vehículo " + v, esperado, g.conVehiculo({ ...g.entradaInicial(real.semanas), gp }, v).gp, { v, gp });
}

for (const s of series) console.log(`  ${s.nombre}: ${porSerie[s.nombre]} combinaciones, ${s.conG} con resultado (G calculado), ${s.semanas.length} semanas`);
console.log(`${casos} casos comparados (Excel real del ${REAL.fileDate}); diferencias: ${diferencias}`);
process.exit(diferencias ? 1 : 0);
