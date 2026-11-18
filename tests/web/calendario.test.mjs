// Calendario (src/lib/calendario.ts): mes, agenda, hora de Madrid, cosas que cruzan la medianoche y días completos.
// Y Outlook (src/lib/outlook.ts) con Microsoft Graph SIMULADO: leer el mes, crear, cambiar y borrar eventos.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import * as jornada from "../../src/lib/jornada.ts";

/** Carga un archivo TS de src/lib con sus importaciones sustituidas (como tests/web/perfiles.test.mjs). */
function cargar(ruta, deps) {
  const fuente = readFileSync(new URL(`../../src/lib/${ruta}`, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(fuente, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const modulo = { exports: {} };
  new Function("require", "module", "exports", outputText)((n) => {
    if (!(n in deps)) throw Error(`Sin simular: ${n}`);
    return deps[n];
  }, modulo, modulo.exports);
  return modulo.exports;
}
const c = cargar("calendario.ts", { "./jornada": jornada });

test("cuadrícula del mes: de lunes a domingo, con los días que completan las semanas", () => {
  const r = c.rejillaMes("2026-11");
  assert.equal(r[0], "2026-10-26");            // lunes
  assert.equal(r.at(-1), "2026-12-06");        // domingo
  assert.equal(r.length % 7, 0);
  assert.equal(c.diasDelMes("2026-11").length, 30);
  assert.equal(c.diasDelMes("2028-02").length, 29);
  assert.deepEqual([c.rejillaMes("2027-02")[0], c.rejillaMes("2027-02").length], ["2027-02-01", 28]);   // febrero que cuadra
});

test("mes pedido, anterior y siguiente", () => {
  assert.equal(c.mesValido("2026-12", "2026-11-18"), "2026-12");
  for (const malo of [undefined, "", "2026-13", "26-11", "2026-11-01", "1999-01", "x"]) assert.equal(c.mesValido(malo, "2026-11-18"), "2026-11");
  assert.equal(c.moverMes("2026-12", 1), "2027-01");
  assert.equal(c.moverMes("2026-01", -1), "2025-12");
});

test("límites del periodo en hora de Madrid (con cambio de hora en medio)", () => {
  const { desde, hasta } = c.limites(c.rejillaMes("2026-10"));   // 28-9 al 1-11, cruza el 25-10
  assert.equal(desde.toISOString(), "2026-09-27T22:00:00.000Z");  // 00:00 de Madrid en verano
  assert.equal(hasta.toISOString(), "2026-11-01T23:00:00.000Z");  // 00:00 del 2-11 en invierno
});

const el = (empieza, termina, todoElDia = false, titulo = "x") => ({ clave: titulo, titulo, empieza, termina, todoElDia });

test("lo que cruza la medianoche sale en los dos días; acabar a las 00:00 no ocupa el día siguiente", () => {
  const noche = el("2026-11-18T21:00:00Z", "2026-11-19T05:00:00Z");   // 22:00 → 06:00 de Madrid
  assert.deepEqual(c.diasQueOcupa(noche), ["2026-11-18", "2026-11-19"]);
  assert.equal(c.textoHorario(noche, "2026-11-18"), "Desde las 22:00 (sigue el jue, 19 nov)");
  assert.equal(c.textoHorario(noche, "2026-11-19"), "Hasta las 06:00");
  const hastaMedianoche = el("2026-11-18T21:00:00Z", "2026-11-18T23:00:00Z");   // 22:00 → 00:00
  assert.deepEqual(c.diasQueOcupa(hastaMedianoche), ["2026-11-18", "2026-11-18"]);
  assert.equal(c.textoHorario(hastaMedianoche, "2026-11-18"), "22:00–00:00");
  // 23:30 UTC ya es día siguiente en Madrid.
  assert.deepEqual(c.diasQueOcupa(el("2026-11-18T23:30:00Z", null)), ["2026-11-19", "2026-11-19"]);
});

test("días completos: el fin es la medianoche del día siguiente al último", () => {
  const tres = el("2026-11-19T23:00:00Z", "2026-11-22T23:00:00Z", true);   // 20, 21 y 22 de noviembre
  assert.deepEqual(c.diasQueOcupa(tres), ["2026-11-20", "2026-11-22"]);
  assert.equal(c.textoHorario(tres, "2026-11-21"), "Todo el día, del vie, 20 nov al dom, 22 nov");
  const uno = el("2026-11-19T23:00:00Z", null, true);
  assert.equal(c.textoHorario(uno, "2026-11-20"), "Todo el día");
  const mapa = c.porDia([tres, el("2026-11-21T09:00:00Z", null, false, "cita"), uno], c.diasDelMes("2026-11"));
  assert.equal(mapa.get("2026-11-19").length, 0);
  assert.equal(mapa.get("2026-11-20").length, 2);
  assert.deepEqual(mapa.get("2026-11-21").map((e) => e.titulo), ["x", "cita"]);   // todo el día primero
  assert.equal(mapa.get("2026-11-23").length, 0);
});

test("formulario → instantes (Madrid) y vuelta", () => {
  const cita = c.leerHorario({ fecha: "2026-11-18", hora: "09:30", hora_fin: "10:15" });
  assert.deepEqual(cita, { empieza: "2026-11-18T08:30:00.000Z", termina: "2026-11-18T09:15:00.000Z", todo_el_dia: false });
  assert.deepEqual(c.camposDe(cita), { fecha: "2026-11-18", hora: "09:30", fecha_fin: "", hora_fin: "10:15", todo_el_dia: false });
  // De 22:00 a 02:00 sin decir otro día: acaba al día siguiente.
  const turno = c.leerHorario({ fecha: "2026-11-18", hora: "22:00", hora_fin: "02:00" });
  assert.equal(turno.termina, "2026-11-19T01:00:00.000Z");
  assert.equal(c.camposDe(turno).fecha_fin, "2026-11-19");
  // Verano.
  assert.equal(c.leerHorario({ fecha: "2026-07-01", hora: "09:00" }).empieza, "2026-07-01T07:00:00.000Z");
  // Varios días completos.
  const puente = c.leerHorario({ fecha: "2026-12-05", fecha_fin: "2026-12-08", todo_el_dia: true });
  assert.deepEqual(puente, { empieza: "2026-12-04T23:00:00.000Z", termina: "2026-12-08T23:00:00.000Z", todo_el_dia: true });
  assert.deepEqual(c.camposDe(puente), { fecha: "2026-12-05", hora: "", fecha_fin: "2026-12-08", hora_fin: "", todo_el_dia: true });
  assert.equal(c.leerHorario({ fecha: "2026-12-05", todo_el_dia: true }).termina, null);
  // Errores.
  for (const malo of [{}, { fecha: "2026-02-31", hora: "09:00" }, { fecha: "2026-11-18" }, { fecha: "2026-11-18", hora: "25:00" },
    { fecha: "2026-11-18", fecha_fin: "2026-11-17", todo_el_dia: true }, { fecha: "2026-11-18", hora: "10:00", fecha_fin: "2026-11-18", hora_fin: "09:00" },
    { fecha: "2026-11-18", hora: "10:00", fecha_fin: "2026-11-20" }, { fecha: "2026-01-01", fecha_fin: "2027-06-01", todo_el_dia: true }]) {
    assert.ok("error" in c.leerHorario(malo), JSON.stringify(malo));
  }
});

test("enlaces: solo http y https", () => {
  assert.equal(c.enlaceValido(""), null);
  assert.equal(c.enlaceValido(" https://teams.example.com/x?a=1 "), "https://teams.example.com/x?a=1");
  for (const malo of ["javascript:alert(1)", "ftp://x.example", "www.example.com", "https://a b.example", "data:text/html,x", "http://"]) {
    assert.equal(c.enlaceValido(malo), false, malo);
  }
});

test("evento de Outlook: hora de Madrid, días completos con fin exclusivo y media hora si no hay fin", () => {
  const e = c.eventoOutlook({ titulo: "Webinar", detalle: "Seguridad", enlace: "https://x.example", lugar: "Sala 1",
    empieza: "2026-11-18T09:00:00Z", termina: null, todo_el_dia: false }, "trimodos-fecha-7");
  assert.deepEqual(e.start, { dateTime: "2026-11-18T10:00:00", timeZone: "Europe/Madrid" });
  assert.deepEqual(e.end, { dateTime: "2026-11-18T10:30:00", timeZone: "Europe/Madrid" });
  assert.equal(e.transactionId, "trimodos-fecha-7");
  assert.equal(e.location.displayName, "Sala 1");
  assert.match(e.body.content, /Seguridad\n\nhttps:\/\/x\.example/);
  const dia = c.eventoOutlook({ titulo: "Puente", empieza: "2026-12-04T23:00:00.000Z", termina: "2026-12-08T23:00:00.000Z", todo_el_dia: true });
  assert.deepEqual([dia.isAllDay, dia.start.dateTime, dia.end.dateTime], [true, "2026-12-05T00:00:00", "2026-12-09T00:00:00"]);
  assert.equal("transactionId" in dia, false);
  assert.equal(c.instanteDeOutlook("2026-11-18T09:00:00.0000000"), "2026-11-18T08:00:00.000Z");
});

// ---------------------------------------------------------------- Outlook con Graph simulado
function outlook() {
  Object.assign(process.env, { OUTLOOK_CALENDARIO: "true", AZURE_CLIENT_ID: "cliente", AZURE_CLIENT_SECRET: "secreto",
    AZURE_TENANT_ID: "inquilino", SECRET_KEY: "clave-de-prueba", SUPABASE_SECRET_KEY: "servidor" });
  const guardado = {};
  const admin = {
    from: () => ({
      upsert: async (fila) => { guardado.token = fila.token_cifrado; return { error: null }; },
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: guardado.token ? { token_cifrado: guardado.token } : null }) }) }),
      update: () => ({ eq: async () => ({ error: null }) }),
      delete: () => ({ eq: async () => ({ error: null }) }),
    }),
  };
  const llamadas = [];
  globalThis.fetch = async (url, init = {}) => {
    llamadas.push({ url: String(url), metodo: init.method ?? "GET", cuerpo: init.body, cabeceras: init.headers });
    const json = (status, cuerpo) => ({ ok: status < 300, status, json: async () => cuerpo });
    if (String(url).includes("login.microsoftonline.com")) return json(200, { access_token: "token-graph" });
    if (String(url).includes("/me/calendarView")) return json(200, { value: [
      { id: "A1", subject: "Reunión", start: { dateTime: "2026-11-18T09:00:00.0000000" }, end: { dateTime: "2026-11-18T10:00:00.0000000" }, isAllDay: false, webLink: "https://outlook.example/A1" },
      { id: "A2", subject: "Anulada", start: { dateTime: "2026-11-19T09:00:00.0000000" }, end: { dateTime: "2026-11-19T10:00:00.0000000" }, isCancelled: true },
      { id: "A3", subject: "", start: { dateTime: "2026-11-20T00:00:00.0000000" }, end: { dateTime: "2026-11-21T00:00:00.0000000" }, isAllDay: true },
    ] });
    if (String(url).endsWith("/me/events") && init.method === "POST") return json(201, { id: "NUEVO" });
    if (init.method === "PATCH") return json(200, {});
    if (init.method === "DELETE") return json(String(url).includes("YA-NO") ? 404 : 204, {});
    return json(500, {});
  };
  const o = cargar("outlook.ts", {
    "server-only": {}, "node:crypto": require_crypto, "@/lib/supabase/admin": { createAdminClient: () => admin },
    "@/lib/calendario": c, "@/lib/jornada": jornada, "@/lib/seguridad": { sumarDias: c.sumarDiasISO },
  });
  return { o, llamadas };
}
import * as crypto from "node:crypto";
const require_crypto = crypto;

test("Outlook simulado: lee el mes en hora de Madrid y quita lo anulado", async () => {
  const { o, llamadas } = outlook();
  await o.guardarTokenMicrosoft("persona", "renovacion");
  const citas = await o.citasEntre("persona", new Date("2026-10-25T23:00:00Z"), new Date("2026-12-06T23:00:00Z"));
  assert.equal(citas.length, 2);
  assert.deepEqual([citas[0].id, citas[0].empieza, citas[0].termina], ["A1", "2026-11-18T08:00:00.000Z", "2026-11-18T09:00:00.000Z"]);
  assert.deepEqual([citas[1].asunto, citas[1].todoElDia, c.diasQueOcupa(citas[1])], ["(Sin asunto)", true, ["2026-11-20", "2026-11-20"]]);
  const vista = llamadas.find((l) => l.url.includes("calendarView"));
  assert.match(vista.url, /startDateTime=2026-10-25T23:00:00\.000Z&endDateTime=2026-12-06T23:00:00\.000Z/);
  assert.equal(vista.cabeceras.Prefer, 'outlook.timezone="Europe/Madrid"');
  assert.equal(vista.cabeceras.Authorization, "Bearer token-graph");
});

test("Outlook simulado: crear, cambiar y borrar el evento de una nota", async () => {
  const { o, llamadas } = outlook();
  await o.guardarTokenMicrosoft("persona", "renovacion");
  const datos = { titulo: "Taller", empieza: "2026-11-18T08:00:00.000Z", termina: null, todo_el_dia: false };
  assert.equal(await o.crearEventoOutlook("persona", datos, "trimodos-nota-5"), "NUEVO");
  const alta = JSON.parse(llamadas.find((l) => l.metodo === "POST" && l.url.endsWith("/me/events")).cuerpo);
  assert.deepEqual([alta.subject, alta.transactionId, alta.start.dateTime], ["Taller", "trimodos-nota-5", "2026-11-18T09:00:00"]);
  assert.equal(await o.cambiarEventoOutlook("persona", "AA/k=", datos), true);
  assert.ok(llamadas.some((l) => l.metodo === "PATCH" && l.url.endsWith("/me/events/AA%2Fk%3D")));
  assert.equal(await o.borrarEventoOutlook("persona", "AA/k="), true);
  assert.equal(await o.borrarEventoOutlook("persona", "YA-NO"), true);   // si ya no estaba, cuenta como borrado
});

test("Outlook apagado o sin conectar: no se llama a Microsoft", async () => {
  const { o, llamadas } = outlook();
  assert.equal(await o.citasEntre("sin-token", new Date(), new Date()), null);   // no ha entrado con Microsoft
  assert.equal(await o.crearEventoOutlook("sin-token", { titulo: "x", empieza: "2026-11-18T08:00:00Z", termina: null, todo_el_dia: false }, "t"), null);
  process.env.OUTLOOK_CALENDARIO = "false";
  await o.guardarTokenMicrosoft("persona", "renovacion");
  assert.equal(await o.citasEntre("persona", new Date(), new Date()), null);
  assert.equal(llamadas.length, 0);
});

test("el cambio de marzo no desplaza silenciosamente una hora inexistente", () => {
  assert.match(c.leerHorario({fecha:"2026-03-29",hora:"02:30"}).error, /hora de inicio no existe/);
  assert.match(c.leerHorario({fecha:"2026-03-29",hora:"01:30",hora_fin:"02:30"}).error, /hora de fin no existe/);
  assert.match(c.leerHorario({fecha:"2026-03-28",hora:"22:00",hora_fin:"02:30"}).error, /hora de fin no existe/);
  const valida = c.leerHorario({fecha:"2026-03-29",hora:"01:30",hora_fin:"03:30"});
  assert.equal(Date.parse(valida.termina)-Date.parse(valida.empieza), 3600000);
  assert.equal(c.horaMadrid(valida.empieza), "01:30");
  assert.equal(c.horaMadrid(valida.termina), "03:30");
});

for (const resultado of [{data:null,error:{message:"Sin conexión"}},{data:null,error:null},{data:{id:1},error:null}]) {
  test(`nota creada en Outlook: el mensaje refleja si se guardó el vínculo (${!!resultado.data})`, async () => {
    let creaciones=0;
    const supabase={from(tabla) {
      assert.equal(tabla,"calendario_notas");
      return {
        insert(){return {select(){return {single:async()=>({data:{id:1},error:null})}}}},
        update(datos){assert.equal(datos.outlook_evento_id,"evento-1");return {eq(){return {select(){return {maybeSingle:async()=>resultado}}}}}}
      };
    }};
    const acciones=cargar("../app/calendario/acciones.ts",{
      "next/cache":{revalidatePath(){}},"next/navigation":{redirect(ruta){throw new Error(decodeURIComponent(ruta))}},
      "@/lib/calendario":c,"@/lib/jornada":jornada,
      "@/lib/usuario":{conPermiso:async()=>({supabase,uid:"yo"})},
      "@/lib/outlook":{calendarioActivo:()=>true,crearEventoOutlook:async()=>{creaciones++;return "evento-1"}}
    });
    const form=new FormData();
    for(const [k,v] of Object.entries({titulo:"Taller",fecha:"2026-11-18",hora:"09:00",outlook:"on"}))form.set(k,v);
    await assert.rejects(()=>acciones.guardarNota(form),resultado.data ? /También está en tu Outlook/ : /no se pudo vincular/);
    assert.equal(creaciones,1);
  });
}
