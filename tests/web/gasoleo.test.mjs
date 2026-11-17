// Calculadora de gasóleo (src/lib/gasoleo.ts): resultados y textos que daba la calculadora original de GitHub para
// estas mismas entradas (generados con ella; la comparación completa, con miles de casos, es scripts/comprobar_gasoleo.mjs).
// Y el catálogo de automatizaciones: cada permiso existe en el área «automatizaciones» de permisos.json.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as g from "../../src/lib/gasoleo.ts";
import { AUTOMATIZACIONES } from "../../src/lib/automatizaciones.ts";

// Serie inventada: 60 semanas desde el 1-9-2025 con precios que tocan los tramos de C y un redondeo «del 5».
const serial = (iso) => (Date.parse(iso + "T00:00:00Z") - Date.UTC(1899, 11, 30)) / 864e5;
const rows = [];
for (let i = 0; i < 60; i++) {
  const s = serial("2025-09-01") + 7 * i, pai = [1, 1.00125, 0.85, 1.4, 1.18, 1.73, 0.95, 1.6][i % 8], pvpsin = +(pai + 0.379).toFixed(6);
  rows.push([s, +(pvpsin * 1.21).toFixed(5), pvpsin, 0.379, pai, i % 2 ? 0.037 : 0, i % 3 ? +(pvpsin - 0.01).toFixed(5) : 0, i % 4 ? +(pvpsin - 0.02).toFixed(5) : 0]);
}
const semanas = g.cargarSemanas(rows);
const periodo = (p) => ({ modo: p.mode === "date" ? "fecha" : "mes", fecha: p.date, mes: p.month });
const entrada = (S) => ({ referencia: periodo(S.ref), realizacion: periodo(S.real), vehiculo: S.veh, base: S.basis, precio: S.price,
  umbral: S.thr, redondeo: S.rnd, gp: S.gp, continuado: S.cont, cManual: S.cMan, cValor: S.cVal });

const ORIGINAL = {"julio por mes (RDL 18)":{"S":{"ref":{"mode":"date","date":"2026-01-15","month":"2025-12"},"real":{"mode":"month","date":"2026-07-01","month":"2026-07"},"veh":"A","basis":"auto","price":1000,"thr":5,"rnd":"2","gp":true,"cont":false,"cMan":false,"cVal":0.4},"G":11.51,"C":0.4,"pct":4.604,"textos":{"refVal":"1,54900","realVal":"1,72725","refWeeks":"Precio del 19/01/2026 (primera fecha publicada igual o posterior)","realWeeks":"Media de 4 semanas de julio de 2026: 06/07, 13/07, 20/07, 27/07","rG":"+11,51 %","rGs":"Pmed · MMA ≥ 7,5 t","rC":"0,40","rCs":"RDL 18/2026 · Pmed 1,727 €/l","rPct":"+4,60 %","rDP":"+46,04 €","rNP":"Nuevo precio: 1046,04 €","rFormula":"G sin redondear 11,507424 % · ΔP = 11,51 × 1000,00 × 0,40 / 100","rVerdict":"Revisión obligatoria: |G| ≥ 5,0 %","basisHint":"Precio usado para G: Pmed, según la fecha de realización del transporte.","lgSeries":"Pmed semanal (€/l)"},"clase":"pill ok"},"1 de abril (G con PAI, C fijo)":{"S":{"ref":{"mode":"date","date":"2026-01-15","month":"2025-12"},"real":{"mode":"date","date":"2026-04-01","month":""},"veh":"B","basis":"auto","price":1000,"thr":5,"rnd":"2","gp":false,"cont":false,"cMan":false,"cVal":0.4},"G":35.59,"C":0.2,"pct":7.118000000000001,"textos":{"refVal":"1,18000","realVal":"1,60000","refWeeks":"Precio del 19/01/2026 (primera fecha publicada igual o posterior)","realWeeks":"Precio del 06/04/2026 (primera fecha publicada igual o posterior)","rG":"+35,59 %","rGs":"PAI","rC":"0,20","rCs":"Coeficiente fijo anterior · verifícalo","rPct":"+7,12 %","rDP":"+71,18 €","rNP":"Nuevo precio: 1071,18 €","rFormula":"G sin redondear 35,593220 % · ΔP = 35,59 × 1000,00 × 0,20 / 100","rVerdict":"Revisión obligatoria: |G| ≥ 5,0 %","basisHint":"Precio usado para G: PAI, según la fecha de realización del transporte.","lgSeries":"PAI semanal (€/l)"},"clase":"pill ok"},"marzo (PVP, C fijo)":{"S":{"ref":{"mode":"date","date":"2026-01-15","month":"2025-12"},"real":{"mode":"date","date":"2026-03-01","month":""},"veh":"D","basis":"auto","price":1000,"thr":5,"rnd":"2","gp":false,"cont":false,"cMan":false,"cVal":0.4},"G":-21.17,"C":0.1,"pct":-2.1170000000000004,"textos":{"refVal":"1,88639","realVal":"1,48709","refWeeks":"Precio del 19/01/2026 (primera fecha publicada igual o posterior)","realWeeks":"Precio del 02/03/2026 (primera fecha publicada igual o posterior)","rG":"-21,17 %","rGs":"PVP","rC":"0,10","rCs":"Coeficiente fijo anterior · verifícalo","rPct":"-2,12 %","rDP":"-21,17 €","rNP":"Nuevo precio: 978,83 €","rFormula":"G sin redondear -21,167415 % · ΔP = -21,17 × 1000,00 × 0,10 / 100","rVerdict":"Revisión obligatoria: |G| ≥ 5,0 %","basisHint":"Precio usado para G: PVP, según la fecha de realización del transporte.","lgSeries":"PVP semanal (€/l)"},"clase":"pill ok"},"sin redondeo y continuado":{"S":{"ref":{"mode":"date","date":"2026-01-15","month":"2025-12"},"real":{"mode":"month","date":"2026-07-01","month":"2026-07"},"veh":"C","basis":"auto","price":1000,"thr":5,"rnd":"none","gp":true,"cont":true,"cMan":false,"cVal":0.4},"G":11.507424144609427,"C":0.3,"pct":3.452227243382828,"textos":{"refVal":"1,54900","realVal":"1,72725","refWeeks":"Precio del 19/01/2026 (primera fecha publicada igual o posterior)","realWeeks":"Media de 4 semanas de julio de 2026: 06/07, 13/07, 20/07, 27/07","rG":"+11,5074 %","rGs":"Pmed · MMA ≥ 7,5 t","rC":"0,30","rCs":"RDL 18/2026 · Pmed 1,727 €/l","rPct":"+3,45 %","rDP":"+34,52 €","rNP":"Nuevo precio: 1034,52 €","rFormula":"Sin redondear (G = 11,507424 %) · ΔP = 11,5074 × 1000,00 × 0,30 / 100","rVerdict":"Revisión obligatoria: contrato continuado","basisHint":"Precio usado para G: Pmed, según la fecha de realización del transporte.","lgSeries":"Pmed semanal (€/l)"},"clase":"pill ok"},"C a mano y umbral 10":{"S":{"ref":{"mode":"date","date":"2026-01-15","month":"2025-12"},"real":{"mode":"month","date":"2026-07-01","month":"2026-07"},"veh":"A","basis":"auto","price":1000,"thr":10,"rnd":"2","gp":true,"cont":false,"cMan":true,"cVal":0.35},"G":11.51,"C":0.35,"pct":4.028499999999999,"textos":{"refVal":"1,54900","realVal":"1,72725","refWeeks":"Precio del 19/01/2026 (primera fecha publicada igual o posterior)","realWeeks":"Media de 4 semanas de julio de 2026: 06/07, 13/07, 20/07, 27/07","rG":"+11,51 %","rGs":"Pmed · MMA ≥ 7,5 t","rC":"0,35","rCs":"Fijado a mano","rPct":"+4,03 %","rDP":"+40,28 €","rNP":"Nuevo precio: 1040,29 €","rFormula":"G sin redondear 11,507424 % · ΔP = 11,51 × 1000,00 × 0,35 / 100","rVerdict":"Revisión obligatoria: |G| ≥ 10,0 %","basisHint":"Precio usado para G: Pmed, según la fecha de realización del transporte.","lgSeries":"Pmed semanal (€/l)"},"clase":"pill ok"},"redondeo del 5":{"S":{"ref":{"mode":"date","date":"2025-09-01","month":""},"real":{"mode":"date","date":"2025-09-08","month":""},"veh":"A","basis":"pai","price":1000,"thr":0.13,"rnd":"2","gp":true,"cont":false,"cMan":false,"cVal":0.4},"G":0.13,"C":0.3,"pct":0.039,"textos":{"refVal":"1,00000","realVal":"1,00125","refWeeks":"Precio del 01/09/2025 (primera fecha publicada igual o posterior)","realWeeks":"Precio del 08/09/2025 (primera fecha publicada igual o posterior)","rG":"+0,13 %","rGs":"PAI","rC":"0,30","rCs":"Coeficiente fijo anterior · verifícalo","rPct":"+0,04 %","rDP":"+0,39 €","rNP":"Nuevo precio: 1000,39 €","rFormula":"G sin redondear 0,125000 % · ΔP = 0,13 × 1000,00 × 0,30 / 100","rVerdict":"Revisión obligatoria: |G| ≥ 0,1 %","basisHint":"Precio para G elegido a mano: PAI.","lgSeries":"PAI semanal (€/l)"},"clase":"pill ok"},"mes sin precios":{"S":{"ref":{"mode":"date","date":"2026-01-15","month":"2025-12"},"real":{"mode":"month","date":"","month":"2027-03"},"veh":"A","basis":"auto","price":1000,"thr":5,"rnd":"2","gp":true,"cont":false,"cMan":false,"cVal":0.4},"G":null,"C":null,"pct":null,"textos":{"refVal":"1,54900","realVal":"—","refWeeks":"Precio del 19/01/2026 (primera fecha publicada igual o posterior)","realWeeks":"El Ministerio no tiene precios publicados para ese mes.","rG":"—","rGs":"Pmed · MMA ≥ 7,5 t","rC":"—","rCs":"","rPct":"—","rDP":"—","rNP":"","rFormula":"","rVerdict":"Faltan datos para calcular","basisHint":"Precio usado para G: Pmed, según la fecha de realización del transporte.","lgSeries":"Pmed semanal (€/l)"},"clase":"pill info"},"mes incompleto":{"S":{"ref":{"mode":"date","date":"2026-01-15","month":"2025-12"},"real":{"mode":"month","date":"","month":"2026-10"},"veh":"A","basis":"auto","price":1000,"thr":5,"rnd":"2","gp":true,"cont":false,"cMan":false,"cVal":0.4},"G":-6.79,"C":0.4,"pct":-2.716,"textos":{"refVal":"1,54900","realVal":"1,44375","refWeeks":"Precio del 19/01/2026 (primera fecha publicada igual o posterior)","realWeeks":"Media de 3 semanas de octubre de 2026: 05/10, 12/10, 19/10 · El mes aún no está completo en la Excel.","rG":"-6,79 %","rGs":"Pmed · MMA ≥ 7,5 t","rC":"0,40","rCs":"RDL 18/2026 · Pmed 1,444 €/l","rPct":"-2,72 %","rDP":"-27,16 €","rNP":"Nuevo precio: 972,84 €","rFormula":"G sin redondear -6,794706 % · ΔP = -6,79 × 1000,00 × 0,40 / 100","rVerdict":"Revisión obligatoria: |G| ≥ 5,0 %","basisHint":"Precio usado para G: Pmed, según la fecha de realización del transporte.","lgSeries":"Pmed semanal (€/l)"},"clase":"pill ok"}};

for (const [nombre, o] of Object.entries(ORIGINAL)) test(`igual que la original: ${nombre}`, () => {
  const e = entrada(o.S), r = g.calcular(semanas, e), t = g.textos(e, r);
  assert.equal(r.G, o.G); assert.equal(r.C, o.C); assert.equal(r.pct, o.pct);
  assert.deepEqual({
    refVal: t.refVal, realVal: t.realVal, refWeeks: t.refSemanas, realWeeks: t.realSemanas, rG: t.G, rGs: t.Gdetalle, rC: t.C,
    rCs: t.Cdetalle, rPct: t.pct, rDP: t.dP, rNP: t.nuevoPrecio, rFormula: t.formula, rVerdict: t.veredicto, basisHint: t.pista, lgSeries: t.serie,
  }, o.textos);
  assert.equal("pill " + t.veredictoClase, o.clase);
});

test("tramos de C: justo en el límite sube al siguiente", () => {
  assert.equal(g.elegirC(g.T18.A, 1.17999), 0.3);
  assert.equal(g.elegirC(g.T18.A, 1.18), 0.4);
  assert.equal(g.elegirC(g.T18.A, 1.73), 0.5);
  assert.equal(g.elegirC(g.T9.D, 0.7), 0.2);
});

test("cambios de régimen por la fecha del transporte", () => {
  assert.equal(g.baseAutomatica(g.isoAMs("2026-03-21")), "pvp");
  assert.equal(g.baseAutomatica(g.isoAMs("2026-03-22")), "pai");
  assert.equal(g.baseAutomatica(g.isoAMs("2026-04-15")), "pai");
  assert.equal(g.baseAutomatica(g.isoAMs("2026-04-16")), "pmed");
  assert.equal(g.baseAutomatica(NaN), "pmed");
});

test("vehículo A siempre con devolución del gasóleo profesional y D nunca", () => {
  const e = g.entradaInicial(semanas);
  assert.equal(g.conVehiculo({ ...e, gp: false }, "A").gp, true);
  assert.equal(g.conVehiculo({ ...e, gp: true }, "D").gp, false);
  assert.equal(g.conVehiculo({ ...e, gp: false }, "B").gp, false);
});

test("cada automatización tiene su permiso en el área «automatizaciones» de permisos.json", () => {
  const catalogo = JSON.parse(readFileSync(new URL("../../src/lib/permisos.json", import.meta.url), "utf8"));
  const area = catalogo.areas.find((a) => a.id === "automatizaciones");
  assert.ok(area, "falta el área «automatizaciones» en src/lib/permisos.json");
  assert.equal(area.ruta, "/automatizaciones");
  const permisos = new Set(area.permisos.map((p) => p.id));
  for (const a of AUTOMATIZACIONES) {
    assert.ok(permisos.has(a.permiso), `falta el permiso ${a.permiso} en el área «automatizaciones»`);
    assert.ok(a.ruta.startsWith("/automatizaciones/"), a.ruta);
  }
});
