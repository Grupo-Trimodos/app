import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as j from '../../src/lib/jornada.ts';
const fichajes = (pares) => pares.map(([tipo, momento], i) => ({ id: i + 1, usuario_id: 'persona', tipo, momento, origen: 'app', nota: null, odoo_estado: 'pendiente', odoo_error: null }));
const calcular = (pares, ahora = '2026-11-10T12:00:00Z') => j.calcularJornada(fichajes(pares), new Date(ahora));

for (const [nombre, entrada, salida, minutos, dia] of [
  ['noche', '2026-11-08T22:00:00+01:00', '2026-11-09T06:00:00+01:00', 480, '2026-11-08'],
  ['marzo', '2026-03-28T22:00:00+01:00', '2026-03-29T06:00:00+02:00', 420, '2026-03-28'],
  ['octubre', '2026-10-24T22:00:00+02:00', '2026-10-25T06:00:00+01:00', 540, '2026-10-24'],
]) test(`turno de ${nombre}: duración real y día de entrada`, () => {
  const r = calcular([['entrada', entrada], ['salida', salida]]);
  assert.equal(r.jornadas[0].minutos, minutos);
  assert.equal(r.jornadas[0].dia, dia);
  assert.equal(r.jornadas[0].salida.momento, salida);
  assert.equal(r.estado, 'fuera');
});
test('dos tramos con pausa, incluso después de medianoche', () => {
  const r = calcular([['entrada', '2026-11-08T22:00:00+01:00'], ['pausa', '2026-11-09T01:00:00+01:00'], ['reanudar', '2026-11-09T02:00:00+01:00'], ['salida', '2026-11-09T06:00:00+01:00']]);
  assert.equal(r.jornadas.length, 1);
  assert.equal(r.jornadas[0].minutos, 420);
  assert.equal(r.jornadas[0].dia, '2026-11-08');
});
for (const dias of [1, 2, 3]) test(`salida olvidada de ${dias} días: congelada y entrada bloqueada`, () => {
  const r = calcular([['entrada', '2026-11-01T08:00:00Z']], `2026-11-0${1 + dias}T08:00:00Z`);
  assert.equal(r.estado, 'pendiente');
  assert.equal(r.actual.minutos, 960);
  assert.equal(r.actual.salida, null);
  assert.equal(r.minutosCerrados, 0);
  assert.equal(j.SIGUIENTES[r.estado].includes('entrada'), false);
});
test('límite exacto y pausas descontadas en el provisional', () => {
  const pares = [['entrada', '2026-11-01T08:00:00Z'], ['pausa', '2026-11-01T10:00:00Z']];
  assert.equal(calcular(pares, '2026-11-01T23:59:59Z').estado, 'pausa');
  const r = calcular(pares, '2026-11-02T00:00:00Z');
  assert.equal(r.estado, 'pendiente');
  assert.equal(r.actual.minutos, 120);
});
test('cierre corregido calcula la duración real, aunque supere 16 horas', () => {
  const r = calcular([['entrada', '2026-11-01T08:00:00Z'], ['salida', '2026-11-02T02:00:00Z']]);
  assert.equal(r.minutosCerrados, 1080);
  assert.equal(r.estado, 'fuera');
  assert.deepEqual(j.SIGUIENTES[r.estado], ['entrada']);
});
test('la semana se imputa por entrada, no por salida', () => {
  const r = calcular([['entrada', '2026-11-08T22:00:00+01:00'], ['salida', '2026-11-09T06:00:00+01:00']], '2026-11-09T12:00:00Z');
  assert.equal(r.minutosSemana, 0);
  assert.equal(r.minutosHoy, 0);
});
test('dos jornadas el mismo día se suman', () => {
  const r = calcular([['entrada', '2026-11-10T08:00:00Z'], ['salida', '2026-11-10T10:00:00Z'], ['entrada', '2026-11-10T11:00:00Z'], ['salida', '2026-11-10T12:00:00Z']]);
  assert.equal(r.minutosHoy, 180);
});
test('ordena por instante y después por id, sin modificar los datos', () => {
  const fs = fichajes([['entrada', '2026-10-25T02:30:00+02:00'], ['salida', '2026-10-25T02:15:00+01:00']]).reverse();
  assert.equal(j.calcularJornada(fs).minutosCerrados, 45);
  assert.equal(fs[0].tipo, 'salida');
});
test('una entrada duplicada no oculta una jornada olvidada', () => {
  const r = calcular([['entrada', '2026-11-01T08:00:00Z'], ['entrada', '2026-11-04T08:00:00Z']], '2026-11-04T09:00:00Z');
  assert.equal(r.estado, 'pendiente');
  assert.equal(r.actual.entrada.id, 1);
  assert.ok(r.incidencias.length);
});

test('dos tramos en el mismo día con una hora de pausa', () => {
  const r = calcular([['entrada', '2026-11-10T08:00:00+01:00'], ['pausa', '2026-11-10T12:00:00+01:00'], ['reanudar', '2026-11-10T13:00:00+01:00'], ['salida', '2026-11-10T17:00:00+01:00']], '2026-11-10T18:00:00Z');
  assert.equal(r.minutosHoy, 480);
  assert.equal(r.jornadas.length, 1);
});
test('Madrid: se conservan las conversiones en las noches de cambio de hora', () => {
  assert.equal(j.madridAInstante('2026-03-29T06:00').toISOString(), '2026-03-29T04:00:00.000Z');
  assert.equal(j.madridAInstante('2026-10-25T06:00').toISOString(), '2026-10-25T05:00:00.000Z');
});
