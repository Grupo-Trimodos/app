import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as j from '../../src/lib/jornada.ts';

// Vacaciones (horas trabajadas y días de una solicitud) y «Mis fichajes» por semana y mes. Horas de Madrid con su desfase.
const fichajes = (pares) => pares.map(([tipo, momento, extra], i) => ({ id: i + 1, usuario_id: 'persona', tipo, momento, origen: 'app',
  nota: null, odoo_estado: 'pendiente', odoo_error: null, ...extra }));
const H = 3600000;

test('horas trabajadas: año, mes y semana con pausas, turno de noche entre meses y jornada abierta', () => {
  const ahora = new Date('2026-11-18T12:00:00Z');   // miércoles, 13:00 en Madrid
  const f = fichajes([
    ['entrada', '2026-01-05T08:00:00+01:00'], ['salida', '2026-01-05T16:00:00+01:00'],     // enero: 8 h
    ['entrada', '2026-10-31T22:00:00+01:00'], ['salida', '2026-11-01T06:00:00+01:00'],     // noche del 31 de octubre: 8 h, cuenta en octubre
    ['entrada', '2026-11-02T08:00:00+01:00'], ['pausa', '2026-11-02T10:00:00+01:00'],
    ['reanudar', '2026-11-02T10:30:00+01:00'], ['salida', '2026-11-02T14:00:00+01:00'],   // 5 h 30 min
    ['entrada', '2026-11-16T08:00:00+01:00'], ['salida', '2026-11-16T16:00:00+01:00'],     // lunes de esta semana: 8 h
    ['entrada', '2026-11-18T08:00:00+01:00'], ['pausa', '2026-11-18T09:00:00+01:00'],
    ['reanudar', '2026-11-18T09:30:00+01:00'],                                             // abierta: 4 h 30 min hasta las 13:00
  ]);
  const h = j.horasTrabajadas(f, ahora);
  assert.equal(h.msSemana, 12.5 * H);
  assert.equal(h.msMes, 18 * H);
  assert.equal(h.msAnio, 34 * H);
  assert.equal(h.msObjetivo, 40 * H);
  assert.equal(j.inicioHorasTrabajadas(ahora), '2026-01-01');
});

test('horas trabajadas: el turno de noche del 31 de diciembre es del año que termina', () => {
  const f = fichajes([
    ['entrada', '2026-12-31T22:00:00+01:00'], ['salida', '2027-01-01T06:00:00+01:00'],
    ['entrada', '2027-01-02T08:00:00+01:00'], ['salida', '2027-01-02T12:00:00+01:00'],
  ]);
  const lunes = j.horasTrabajadas(f, new Date('2027-01-04T12:00:00Z'));
  assert.deepEqual([lunes.msAnio, lunes.msMes, lunes.msSemana], [4 * H, 4 * H, 0]);
  // El viernes 1 de enero la semana empezó el lunes 28 de diciembre: hay que leer desde ese lunes y la noche cuenta en ella.
  const viernes = new Date('2027-01-01T12:00:00Z');
  assert.equal(j.inicioHorasTrabajadas(viernes), '2026-12-28');
  const v = j.horasTrabajadas(f, viernes);
  assert.deepEqual([v.msAnio, v.msMes, v.msSemana], [0, 0, 8 * H]);
});

test('horas trabajadas: no suman la jornada pendiente de cierre ni la que hay que revisar', () => {
  const ahora = new Date('2026-11-18T12:00:00Z');
  const f = fichajes([
    ['entrada', '2026-11-16T08:00:00+01:00'], ['entrada', '2026-11-16T09:00:00+01:00'], ['salida', '2026-11-16T16:00:00+01:00'],
    ['entrada', '2026-11-17T08:00:00+01:00'],   // sin salida: pasa de 16 h
  ]);
  const h = j.horasTrabajadas(f, ahora);
  assert.deepEqual([h.msAnio, h.msMes, h.msSemana], [0, 0, 0]);
  const r = j.registroDeJornadas(f, '2026-11-16', '2026-11-22', ahora);
  assert.deepEqual(r.dias.map((d) => d.jornadas[0].estado), ['revisar', 'pendiente']);
  assert.equal(r.dias[1].jornadas[0].ms, 16 * H);
  assert.equal(r.ms, 0);
});

test('registro del mes: cada jornada en su día de entrada, con pausas, turno de noche y correcciones', () => {
  const ahora = new Date('2026-11-18T12:00:00Z');
  const f = fichajes([
    ['entrada', '2026-10-31T22:00:00+01:00'], ['salida', '2026-11-01T06:00:00+01:00'],
    ['entrada', '2026-11-02T08:00:00+01:00'], ['pausa', '2026-11-02T10:00:00+01:00'],
    ['reanudar', '2026-11-02T10:30:00+01:00'], ['salida', '2026-11-02T14:00:00+01:00', { origen: 'correccion', nota: 'Se olvidó fichar' }],
    ['entrada', '2026-11-18T08:00:00+01:00'],
  ]);
  const octubre = j.registroDeJornadas(f, '2026-10-01', '2026-10-31', ahora);
  assert.equal(octubre.dias.length, 1);
  const noche = octubre.dias[0].jornadas[0];
  assert.equal(noche.salidaOtroDia, true);
  assert.equal(j.textoEntradaSalida(noche), '22:00 – 6:00 del domingo');
  assert.equal(octubre.ms, 8 * H);

  const noviembre = j.registroDeJornadas(f, '2026-11-01', '2026-11-30', ahora);
  assert.deepEqual(noviembre.dias.map((d) => d.dia), ['2026-11-02', '2026-11-18']);
  const lunes = noviembre.dias[0].jornadas[0];
  assert.equal(lunes.ms, 5.5 * H);
  assert.equal(lunes.msPausas, 0.5 * H);
  assert.equal(j.textoPausas(lunes), 'Pausa: 10:00 – 10:30 (30 min)');
  assert.equal(j.textoEntradaSalida(lunes), '8:00 – 14:00');
  assert.deepEqual(lunes.correcciones.map(j.textoCorreccion), ['Salida a las 14:00 anotada por tu responsable: Se olvidó fichar']);
  const hoy = noviembre.dias[1].jornadas[0];
  assert.equal(hoy.estado, 'trabajando');
  assert.equal(j.textoEntradaSalida(hoy), '8:00 – ahora');
  assert.equal(hoy.ms, 5 * H);
  assert.equal(noviembre.ms, 10.5 * H);
});

test('registro: la pausa que termina con la salida y la jornada en pausa', () => {
  const ahora = new Date('2026-11-18T12:00:00Z');
  const f = fichajes([
    ['entrada', '2026-11-17T08:00:00+01:00'], ['pausa', '2026-11-17T12:00:00+01:00'], ['salida', '2026-11-17T12:30:00+01:00'],
    ['entrada', '2026-11-18T08:00:00+01:00'], ['pausa', '2026-11-18T12:00:00+01:00'],
  ]);
  const r = j.registroDeJornadas(f, '2026-11-16', '2026-11-22', ahora);
  const [martes, miercoles] = r.dias.map((d) => d.jornadas[0]);
  assert.equal(martes.ms, 4 * H);
  assert.equal(j.textoPausas(martes), 'Pausa: 12:00 – 12:30 (30 min)');
  assert.equal(miercoles.estado, 'pausa');
  assert.equal(miercoles.ms, 4 * H);
  assert.equal(j.textoPausas(miercoles), 'Pausa: 12:00 – ahora (1 h 00 min)');
});

test('días de una solicitud: laborables de lunes a viernes, fin de semana y cruce de año', () => {
  assert.deepEqual(j.diasDeSolicitud('2026-12-14', '2026-12-18'), { laborables: 5, finDeSemana: 0, naturales: 5 });
  assert.deepEqual(j.diasDeSolicitud('2026-12-14', '2026-12-21'), { laborables: 6, finDeSemana: 2, naturales: 8 });
  assert.deepEqual(j.diasDeSolicitud('2026-12-15', '2026-12-15'), { laborables: 1, finDeSemana: 0, naturales: 1 });
  assert.deepEqual(j.diasDeSolicitud('2026-12-19', '2026-12-19'), { laborables: 0, finDeSemana: 1, naturales: 1 });
  assert.deepEqual(j.diasDeSolicitud('2026-12-28', '2027-01-08'), { laborables: 10, finDeSemana: 2, naturales: 12 });
  assert.deepEqual(j.diasDeSolicitud('2026-01-01', '2026-12-31'), { laborables: 261, finDeSemana: 104, naturales: 365 });
  assert.deepEqual(j.diasDeSolicitud('2026-12-18', '2026-12-14'), { laborables: 0, finDeSemana: 0, naturales: 0 });
  assert.deepEqual(j.diasDeSolicitud('2026-02-30', '2026-03-02'), { laborables: 0, finDeSemana: 0, naturales: 0 });
  assert.equal(j.textoDiasLaborables(5), 'Son 5 días laborables (de lunes a viernes).');
  assert.equal(j.textoDiasLaborables(1), 'Es 1 día laborable (de lunes a viernes).');
  assert.equal(j.textoDiasLaborables(0), 'No hay ningún día laborable (de lunes a viernes) en esas fechas.');
});

test('fechas en español claro', () => {
  assert.equal(j.fechasSolicitud('2026-12-14', '2026-12-18', '2026'), 'Del lunes 14 al viernes 18 de diciembre');
  assert.equal(j.fechasSolicitud('2026-12-15', '2026-12-15', '2026'), 'El martes 15 de diciembre');
  assert.equal(j.fechasSolicitud('2026-11-30', '2026-12-04', '2026'), 'Del lunes 30 de noviembre al viernes 4 de diciembre');
  assert.equal(j.fechasSolicitud('2026-12-28', '2027-01-08', '2026'), 'Del lunes 28 de diciembre de 2026 al viernes 8 de enero de 2027');
  assert.equal(j.fechasSolicitud('2027-01-04', '2027-01-08', '2026'), 'Del lunes 4 al viernes 8 de enero de 2027');
  assert.equal(j.nombreMes('2026-11-18'), 'Noviembre de 2026');
  assert.equal(j.nombreMes('2027-01'), 'Enero de 2027');
  assert.equal(j.diaSemana('2026-11-18'), 'miércoles');
  assert.equal(j.duracionCorta(45 * 60000), '45 min');
  assert.equal(j.duracionCorta(65 * 60000), '1 h 05 min');
});

test('«Mis fichajes»: semana o mes pedidos, anterior y siguiente, sin ir al futuro', () => {
  const ahora = new Date('2026-11-18T12:00:00Z');
  const semana = j.periodoPedido({}, ahora);
  assert.deepEqual(semana, { vista: 'semana', desde: '2026-11-16', hasta: '2026-11-22', titulo: 'Semana del 16 al 22 de noviembre',
    anterior: '2026-11-09', siguiente: null, actual: true });
  const pasada = j.periodoPedido({ semana: '2026-11-04' }, ahora);   // un miércoles: se lleva a su lunes
  assert.deepEqual([pasada.desde, pasada.hasta, pasada.siguiente, pasada.actual], ['2026-11-02', '2026-11-08', '2026-11-09', false]);
  assert.equal(j.periodoPedido({ semana: '2026-10-26' }, ahora).titulo, 'Semana del 26 de octubre al 1 de noviembre');
  assert.equal(j.periodoPedido({ semana: '2027-05-03' }, ahora).desde, '2026-11-16');
  assert.equal(j.periodoPedido({ semana: 'cualquier cosa' }, ahora).desde, '2026-11-16');
  const mes = j.periodoPedido({ mes: '2026-11' }, ahora);
  assert.deepEqual([mes.vista, mes.desde, mes.hasta, mes.anterior, mes.siguiente, mes.titulo], ['mes', '2026-11-01', '2026-11-30', '2026-10', null, 'Noviembre de 2026']);
  const enero = j.periodoPedido({ mes: '2026-01' }, ahora);
  assert.deepEqual([enero.anterior, enero.siguiente], ['2025-12', '2026-02']);
  assert.equal(j.periodoPedido({ mes: '2026-02' }, ahora).hasta, '2026-02-28');
  assert.equal(j.periodoPedido({ mes: '2026-13' }, ahora).desde, '2026-11-01');
  assert.equal(j.periodoPedido({ mes: '2027-01' }, ahora).desde, '2026-11-01');
});
