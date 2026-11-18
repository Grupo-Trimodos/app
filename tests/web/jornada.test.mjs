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

test('presentación: al terminar un turno nocturno se ve su duración sin moverla de semana', () => {
  const ahora = new Date('2026-11-09T08:00:00+01:00');
  const r = calcular([['entrada','2026-11-08T22:00:00+01:00'], ['salida','2026-11-09T06:00:00+01:00']], ahora.toISOString());
  const v = j.presentarJornada(r, ahora);
  assert.equal(v.etiqueta, 'Última jornada');
  assert.equal(v.minutos, 480);
  assert.equal(v.minutosSemana, 0);
  assert.equal(r.minutosHoy, 0);
});
test('presentación: el reloj avanza, descuenta pausas e incluye el tramo abierto en la semana', () => {
  const pares = [['entrada','2026-11-10T08:00:00Z'], ['pausa','2026-11-10T09:00:00Z'], ['reanudar','2026-11-10T09:30:00Z']];
  for (const [instante, minutos] of [['2026-11-10T10:00:00Z',90], ['2026-11-10T10:15:00Z',105]]) {
    const ahora = new Date(instante);
    const r = calcular(pares, instante), v = j.presentarJornada(r, ahora);
    assert.equal(v.minutos, minutos);
    assert.equal(v.minutosSemana, minutos);
    assert.equal(v.actualIncluida, true);
    assert.equal(r.minutosSemana, 0);
  }
});
test('presentación: congelar a las 16 horas excluye la jornada pendiente de la semana', () => {
  const ahora = new Date('2026-11-11T00:00:00Z');
  const r = calcular([['entrada','2026-11-10T08:00:00Z']], ahora.toISOString());
  const v = j.presentarJornada(r, ahora);
  assert.equal(v.minutos, 960);
  assert.equal(v.actualIncluida, false);
  assert.equal(v.minutosSemana, 0);
  assert.deepEqual(j.SIGUIENTES[r.estado], []);
});
test('presentación: jornada abierta del domingo no suma a la semana del lunes', () => {
  const ahora = new Date('2026-11-09T02:00:00+01:00');
  const r = calcular([['entrada','2026-11-08T22:00:00+01:00']], ahora.toISOString());
  const v = j.presentarJornada(r, ahora);
  assert.equal(v.minutos, 240);
  assert.equal(v.actualIncluida, false);
  assert.equal(v.minutosSemana, 0);
});
test('presentación: no presentar como última jornada válida un turno con incidencias', () => {
  const ahora = new Date('2026-11-10T08:00:00+01:00');
  const r = calcular([['entrada','2026-11-09T22:00:00+01:00'], ['entrada','2026-11-09T23:00:00+01:00'], ['salida','2026-11-10T06:00:00+01:00']], ahora.toISOString());
  assert.equal(j.presentarJornada(r, ahora).minutos, 0);
  assert.equal(r.incidencias.length, 1);
});

// ---- Pantalla del trabajador: vistaDelDia (contador grande, «Hoy», la semana frente a las 40 h) ----
const vista = (pares, ahora) => j.vistaDelDia(fichajes(pares), new Date(ahora));
const H = 3600000;

test('trabajador: turno de noche terminado cuenta «hoy» entero y la semana por su día de entrada', () => {
  // Martes 22:00 → miércoles 6:00. El miércoles a las 8:00: 8 h hoy, nunca «0 h».
  const pares = [['entrada', '2026-11-17T22:00:00+01:00'], ['salida', '2026-11-18T06:00:00+01:00']];
  const v = vista(pares, '2026-11-18T08:00:00+01:00');
  assert.equal(v.estado, 'fuera');
  assert.equal(v.terminadaHoy, true);
  assert.equal(v.etiqueta, 'Hoy has trabajado');
  assert.equal(v.msGrande, 8 * H);
  assert.equal(v.msSemana, 8 * H);
  assert.equal(j.horaCorta(v.desde), '6:00');
  // Al día siguiente ya no es «hoy», pero sigue en la semana.
  const jueves = vista(pares, '2026-11-19T08:00:00+01:00');
  assert.equal(jueves.msGrande, 0);
  assert.equal(jueves.terminadaHoy, false);
  assert.equal(jueves.msSemana, 8 * H);
});
test('trabajador: turno de noche abierto avanza solo y dice que empezó ayer', () => {
  const pares = [['entrada', '2026-11-17T22:00:00+01:00']];
  const a = vista(pares, '2026-11-18T01:00:00+01:00');
  const b = vista(pares, '2026-11-18T01:00:07+01:00');
  assert.equal(a.estado, 'trabajando');
  assert.equal(a.desdeAyer, true);
  assert.equal(a.etiqueta, 'Llevas en esta jornada');
  assert.equal(a.msGrande, 3 * H);
  assert.equal(b.msGrande - a.msGrande, 7000);
  assert.deepEqual(j.partesDuracion(b.msGrande), { h: 3, min: 0, seg: 7 });
  assert.equal(a.msSemana, 3 * H);
});
test('trabajador: domingo noche a lunes no entra en la semana nueva (regla de imputación de la app)', () => {
  const pares = [['entrada', '2026-11-15T22:00:00+01:00'], ['salida', '2026-11-16T06:00:00+01:00']];
  const v = vista(pares, '2026-11-16T09:00:00+01:00');
  assert.equal(v.msGrande, 8 * H);
  assert.equal(v.msSemana, 0);
});
for (const [nombre, entrada, salida, ahora, horas] of [
  ['octubre', '2026-10-24T22:00:00+02:00', '2026-10-25T06:00:00+01:00', '2026-10-25T09:00:00+01:00', 9],
  ['marzo', '2027-03-27T22:00:00+01:00', '2027-03-28T06:00:00+02:00', '2027-03-28T09:00:00+02:00', 7],
]) test(`trabajador: cambio de hora de ${nombre}, tiempo real transcurrido`, () => {
  const v = vista([['entrada', entrada], ['salida', salida]], ahora);
  assert.equal(v.msGrande, horas * H);
  // El sábado de entrada y el domingo del cambio son de la misma semana (de lunes a domingo).
  assert.equal(v.msSemana, horas * H);
  // Abierta a mitad de la noche del cambio: también cuenta horas reales.
  const abierta = vista([['entrada', entrada]], salida);
  assert.equal(abierta.msGrande, horas * H);
});
test('trabajador: las pausas no cuentan y la pausa dice desde cuándo', () => {
  const pares = [['entrada', '2026-11-18T07:00:00+01:00'], ['pausa', '2026-11-18T10:30:00+01:00']];
  const enPausa = vista(pares, '2026-11-18T11:00:00+01:00');
  assert.equal(enPausa.estado, 'pausa');
  assert.equal(j.lasHora(enPausa.desde), 'las 10:30');
  assert.equal(enPausa.msGrande, 3.5 * H);
  const vuelta = vista([...pares, ['reanudar', '2026-11-18T11:00:00+01:00']], '2026-11-18T12:00:00+01:00');
  assert.equal(vuelta.estado, 'trabajando');
  assert.equal(j.lasHora(vuelta.desde), 'las 7:00');
  assert.equal(vuelta.msGrande, 4.5 * H);
});
test('trabajador: jornada partida suma «hoy en total» y deja volver a fichar la entrada', () => {
  const manana = [['entrada', '2026-11-18T08:00:00+01:00'], ['salida', '2026-11-18T14:00:00+01:00']];
  const entre = vista(manana, '2026-11-18T15:00:00+01:00');
  assert.equal(entre.estado, 'fuera');
  assert.deepEqual(j.SIGUIENTES[entre.estado], ['entrada']);
  assert.equal(entre.msGrande, 6 * H);
  const tarde = vista([...manana, ['entrada', '2026-11-18T16:00:00+01:00']], '2026-11-18T18:00:00+01:00');
  assert.equal(tarde.msGrande, 2 * H);
  assert.equal(tarde.msHoyTotal, 8 * H);
  assert.equal(tarde.msSemana, 8 * H);
  const fin = vista([...manana, ['entrada', '2026-11-18T16:00:00+01:00'], ['salida', '2026-11-18T18:30:00+01:00']], '2026-11-18T19:00:00+01:00');
  assert.equal(fin.msGrande, 8.5 * H);
  assert.equal(j.lasHora(fin.desde), 'las 18:30');
});
test('trabajador: jornada abierta de otro día pasada de 16 h queda como olvido y sin botones', () => {
  const v = vista([['entrada', '2026-11-17T07:00:00+01:00']], '2026-11-18T08:00:00+01:00');
  assert.equal(v.estado, 'pendiente');
  assert.ok(v.olvido);
  assert.equal(v.msGrande, 0);
  assert.equal(v.msSemana, 0);
  assert.deepEqual(j.SIGUIENTES[v.estado], []);
  assert.equal(j.textoOlvido(v.olvido, new Date('2026-11-18T08:00:00+01:00')), 'Ayer no fichaste la salida. Tu responsable la cerrará con la hora real.');
  const antes = vista([['entrada', '2026-11-16T07:00:00+01:00']], '2026-11-18T08:00:00+01:00');
  assert.match(j.textoOlvido(antes.olvido, new Date('2026-11-18T08:00:00+01:00')), /^El lunes 16 de noviembre no fichaste la salida/);
});
test('trabajador: semana de lunes a domingo, objetivo de 40 horas', () => {
  const dia = (d) => [['entrada', `2026-11-${d}T08:00:00+01:00`], ['salida', `2026-11-${d}T16:00:00+01:00`]];
  const pares = ['15', '16', '17', '18', '19', '20', '21', '22'].flatMap(dia);   // domingo 15 → domingo 22
  const domingo = vista(pares, '2026-11-22T20:00:00+01:00');
  assert.equal(domingo.msSemana, 7 * 8 * H);   // del lunes 16 al domingo 22
  assert.equal(domingo.msObjetivo, 40 * H);
  assert.equal(j.lunesDe('2026-11-22'), '2026-11-16');
  assert.equal(j.lunesDe('2026-11-16'), '2026-11-16');
  const lunes = vista([...pares, ...dia('23')], '2026-11-23T20:00:00+01:00');
  assert.equal(lunes.msSemana, 8 * H);
  assert.equal(j.duracionMs(27 * H + 40 * 60000 + 59000), '27 h 40 min');
});
test('trabajador: fichajes por revisar no se suman y se avisa', () => {
  const v = vista([['entrada', '2026-11-18T07:00:00+01:00'], ['entrada', '2026-11-18T08:00:00+01:00'], ['salida', '2026-11-18T15:00:00+01:00']], '2026-11-18T16:00:00+01:00');
  assert.equal(v.revisar, true);
  assert.equal(v.msGrande, 0);
  assert.equal(v.msSemana, 0);
});
test('textos de fechas y horas para el trabajador', () => {
  assert.equal(j.rangoDias('2026-12-14', '2026-12-18'), 'del 14 al 18 de diciembre');
  assert.equal(j.rangoDias('2026-12-29', '2027-01-02'), 'del 29 de diciembre al 2 de enero');
  assert.equal(j.rangoDias('2026-12-14', '2026-12-14'), 'el 14 de diciembre');
  assert.equal(j.lasHora('2026-11-18T00:05:00Z'), 'la 1:05');
  assert.equal(j.lasHora('2026-11-18T06:02:00Z'), 'las 7:02');
  assert.equal(j.diaLargo('2026-11-16'), 'lunes 16 de noviembre');
});
