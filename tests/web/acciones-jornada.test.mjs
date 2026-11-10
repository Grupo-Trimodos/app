import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as jornada from '../../src/lib/jornada.ts';
const require = createRequire(import.meta.url);

// Ejecuta las acciones reales con las fronteras de sesión, navegación y datos sustituidas.
// No arranca Next ni carga ningún archivo de entorno.
function cargar(archivo, dependencias) {
  const source = readFileSync(new URL(`../../${archivo}`, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } });
  const modulo = { exports: {} };
  new Function('require', 'module', 'exports', outputText)((nombre) => {
    if (nombre in dependencias) return dependencias[nombre];
    throw new Error(`Dependencia de prueba no prevista: ${nombre}`);
  }, modulo, modulo.exports);
  return modulo.exports;
}
const entrada = (dias) => ({ id: 1, usuario_id: 'yo', tipo: 'entrada', momento: new Date(Date.now() - dias * 86400000).toISOString(), origen: 'app' });

for (const dias of [1, 2, 3]) test(`acciones: ${dias} días sin salida bloquean entrada y operaciones de camión antes de escribir`, async () => {
  let escrituras = 0;
  const deps = {
    'next/cache': { revalidatePath() {} },
    'next/navigation': { redirect: (ruta) => { throw new Error(decodeURIComponent(ruta)); } },
    '@/lib/usuario': { conPermiso: async () => ({ uid: 'yo', supabase: { from() { escrituras++; throw new Error('No debe escribir'); } } }) },
    '@/lib/jornada': jornada,
    '@/lib/jornadas-servidor': { leerFichajesJornada: async () => ({ data: [entrada(dias)], error: null }) },
    '@/lib/python': { enviarFichajesDespues() { throw new Error('No debe enviar a Odoo'); } },
    '@/lib/envioOdoo': {},
  };
  const fichaje = cargar('src/app/fichaje/acciones.ts', deps);
  const camion = cargar('src/app/chofer/acciones.ts', deps);
  const form = new FormData(); form.set('tipo', 'entrada'); form.set('vehiculo_id', '2');
  for (const accion of [fichaje.fichar, camion.empezarConCamion, camion.finalizarJornada]) {
    await assert.rejects(() => accion(form), /jornada pendiente de cierre/);
  }
  assert.equal(escrituras, 0);
});

test('lectura paginada devuelve más de 1000 fichajes sin truncarlos', async () => {
  const lector = cargar('src/lib/jornadas-servidor.ts', { 'server-only': {}, './jornada': jornada });
  const filas = Array.from({ length: 1001 }, (_, i) => ({ ...entrada(3), id: i + 1 }));
  const peticiones = [];
  const supabase = { rpc(nombre, args) {
    assert.equal(nombre, 'fichajes_para_jornada');
    assert.equal(args.persona, 'yo');
    const consulta = { order() { return consulta; }, async range(a, b) { peticiones.push([a,b]); return { data: filas.slice(a,b+1), error: null }; } };
    return consulta;
  } };
  const r = await lector.leerFichajesJornada(supabase, 'yo');
  assert.equal(r.data.length, 1001);
  assert.deepEqual(peticiones, [[0,499],[500,999],[1000,1499]]);
});

test('una lectura incompleta no se presenta como una jornada válida', async () => {
  const lector = cargar('src/lib/jornadas-servidor.ts', { 'server-only': {}, './jornada': jornada });
  const supabase = { rpc() {
    const consulta = { order() { return consulta; }, async range(a) { return a ? { data: null, error: { message: 'Sin conexión' } } : { data: Array(500).fill(entrada(3)), error: null }; } };
    return consulta;
  } };
  const r = await lector.leerFichajesJornada(supabase, 'yo');
  assert.ok(r.error);
  assert.deepEqual(r.data, []);
});

test('aviso visible: horas provisionales y petición de cierre al responsable', () => {
  const { default: Aviso } = cargar('src/app/AvisoJornada.tsx', { '@/lib/jornada': jornada, 'react/jsx-runtime': require('react/jsx-runtime') });
  const { renderToStaticMarkup } = require('react-dom/server');
  const html = renderToStaticMarkup(Aviso({ resumen: jornada.calcularJornada([entrada(3)]) }));
  assert.match(html, /jornada pendiente de cierre/);
  assert.match(html, /Horas provisionales/);
  assert.match(html, /No están incluidas en las horas cerradas/);
});
