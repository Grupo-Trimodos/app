/** Utilidades de fecha (zona de Madrid) y del estado de la jornada a partir de los fichajes. */
export const ZONA = "Europe/Madrid";

export type Fichaje = {
  id: number; usuario_id: string; tipo: "entrada" | "pausa" | "reanudar" | "salida"; momento: string;
  origen: "app" | "camion" | "correccion"; nota: string | null; odoo_estado: string; odoo_error: string | null;
};
export type Estado = "fuera" | "trabajando" | "pausa" | "pendiente";

/** Medianoche (hora de Madrid) de hoy o de hace `dias` días, como instante. Respeta los cambios de hora. */
export function inicioDia(dias = 0): Date {
  const [y, m, d] = hoyISO().split("-").map(Number);
  const dia = new Date(Date.UTC(y, m - 1, d - dias)).toISOString().slice(0, 10);
  return madridAInstante(`${dia}T00:00`)!;
}

/** Lunes (hora de Madrid) de esta semana, como instante. */
export function inicioSemana(): Date {
  const diaSemana = new Date(`${hoyISO()}T12:00:00Z`).getUTCDay();   // 0 = domingo
  return inicioDia((diaSemana + 6) % 7);
}

export const hora = (iso: string) =>
  new Date(iso).toLocaleTimeString("es-ES", { timeZone: ZONA, hour: "2-digit", minute: "2-digit" });
export const fecha = (iso: string | Date) =>
  new Date(iso).toLocaleDateString("es-ES", { timeZone: ZONA, weekday: "short", day: "numeric", month: "short" });
export const hoyISO = () => new Date().toLocaleDateString("sv-SE", { timeZone: ZONA });   // AAAA-MM-DD

/** Umbral operativo aprobado: tiempo transcurrido, incluidas las pausas. No es una salida. */
export const LIMITE_JORNADA_HORAS = 16;
export type Jornada = {
  entrada: Fichaje; salida: Fichaje | null; fichajes: Fichaje[]; dia: string;
  minutos: number; pendiente: boolean; incidencias: string[];
};
/** Día (hora de Madrid) de un instante, como «AAAA-MM-DD». */
export const diaMadrid = (instante: string | Date) => new Date(instante).toLocaleDateString("sv-SE", { timeZone: ZONA });
export const duracion = (min: number) => `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")} min`;

/** Único cálculo de jornadas. Recibe secuencias completas por persona, nunca recortadas por medianoche.
 * Las horas cerradas se imputan al día de entrada; las abiertas son provisionales y se congelan a las 16 h.
 * Las anomalías se muestran para revisión: una entrada duplicada nunca reinicia el contador.
 */
export function calcularJornada(fichajes: Fichaje[], ahora = new Date()) {
  const orden = [...fichajes].sort((a, b) => Date.parse(a.momento) - Date.parse(b.momento) || a.id - b.id);
  const jornadas: Jornada[] = [];
  const incidencias: string[] = [];
  let actual: Jornada | null = null;
  let tramo: number | null = null;
  let milisegundos = 0;
  let estado: Estado = "fuera";
  const limite = () => Date.parse(actual!.entrada.momento) + LIMITE_JORNADA_HORAS * 3600000;
  // Los tramos completos se guardan para poder recortarlos al umbral SOLO mientras falta la salida.
  let tramos: [number, number][] = [];
  const advertir = (texto: string) => { incidencias.push(texto); actual?.incidencias.push(texto); };
  for (const f of orden) {
    const t = Date.parse(f.momento);
    if (!Number.isFinite(t) || t > ahora.getTime()) { advertir("Hay un fichaje con fecha no válida o futura. Revisa el registro."); continue; }
    if (f.tipo === "entrada") {
      if (actual) { actual.fichajes.push(f); advertir("Hay otra entrada antes de cerrar la jornada. Revisa los fichajes."); continue; }
      actual = { entrada: f, salida: null, fichajes: [f], dia: diaMadrid(f.momento), minutos: 0, pendiente: false, incidencias: [] };
      jornadas.push(actual); tramo = t; milisegundos = 0; tramos = []; estado = "trabajando";
      continue;
    }
    if (!actual) { advertir("Hay un fichaje sin entrada anterior. Avisa al responsable para revisarlo."); continue; }
    actual.fichajes.push(f);
    if (f.tipo === "reanudar") {
      if (tramo !== null) advertir("Hay una vuelta de pausa sin pausa anterior.");
      else tramo = t;
      estado = "trabajando";
    } else {
      if (tramo !== null) { milisegundos += t - tramo; tramos.push([tramo, t]); tramo = null; }
      else if (f.tipo === "pausa") advertir("Hay una pausa repetida. Revisa los fichajes.");
      if (f.tipo === "salida") {
        actual.salida = f; actual.minutos = Math.round(milisegundos / 60000);
        actual = null; estado = "fuera";
      } else estado = "pausa";
    }
  }
  if (actual) {
    const hasta = Math.min(ahora.getTime(), limite());
    const completos = tramos.reduce((s, [a, b]) => s + Math.max(0, Math.min(b, hasta) - a), 0);
    actual.minutos = Math.round((completos + (tramo === null ? 0 : Math.max(0, hasta - tramo))) / 60000);
    actual.pendiente = ahora.getTime() >= limite();
    if (actual.pendiente) estado = "pendiente";
  }
  const hoy = diaMadrid(ahora);
  const lunes = new Date(`${hoy}T12:00:00Z`);
  lunes.setUTCDate(lunes.getUTCDate() - (lunes.getUTCDay() + 6) % 7);
  const semana = lunes.toISOString().slice(0, 10);
  const cerradas = jornadas.filter((j) => j.salida !== null && j.incidencias.length === 0);
  const sumar = (js: Jornada[]) => js.reduce((s, j) => s + j.minutos, 0);
  return { jornadas, actual, estado, incidencias, minutosCerrados: sumar(cerradas),
    minutosHoy: sumar(cerradas.filter((j) => j.dia === hoy)),
    minutosSemana: sumar(cerradas.filter((j) => j.dia >= semana && j.dia <= hoy)),
    minutosVisibles: actual?.minutos ?? sumar(cerradas.filter((j) => j.dia === hoy)),
  };
}

export function avisoJornada(jornada: Jornada): string {
  return `Tienes una jornada pendiente de cierre desde el ${fecha(jornada.entrada.momento)} a las ${hora(jornada.entrada.momento)}. Avisa a tu responsable para poder iniciar otra.`;
}

/** Qué fichajes se pueden hacer desde cada estado. */
export const SIGUIENTES: Record<Estado, Fichaje["tipo"][]> = {
  pendiente: [],
  fuera: ["entrada"],
  trabajando: ["pausa", "salida"],
  pausa: ["reanudar", "salida"],
};
export const NOMBRE_TIPO: Record<Fichaje["tipo"], string> = {
  entrada: "Entrada", pausa: "Pausa", reanudar: "Vuelta de la pausa", salida: "Salida",
};
export const BOTON_TIPO: Record<Fichaje["tipo"], string> = {
  entrada: "Fichar entrada", pausa: "Empezar pausa", reanudar: "Volver de la pausa", salida: "Fichar salida",
};
export const NOMBRE_ESTADO: Record<Estado, string> = { pendiente: "Pendiente de cierre", fuera: "Sin fichar", trabajando: "Trabajando", pausa: "En pausa" };

export const ESTADO_ODOO: Record<string, string> = {
  pendiente: "Pendiente de enviar a Odoo", enviado: "En Odoo", simulado: "Modo prueba (no se envía a Odoo)",
  error: "No se ha podido enviar a Odoo", sin_empleado: "Sin ficha de empleado en Odoo", no_aplica: "",
};

export const NOMBRE_AUSENCIA: Record<string, string> = {
  vacaciones: "Vacaciones", asuntos_propios: "Asuntos propios", medico: "Médico", otro: "Otro motivo",
};

/** «AAAA-MM-DDTHH:MM» (hora de Madrid, como lo da un <input type="datetime-local">) → instante. */
export function madridAInstante(local: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) return null;
  const supuesto = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: ZONA, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(supuesto)).map((x) => [x.type, x.value]),
  );
  const desfase = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - supuesto;
  return new Date(supuesto - desfase);
}

/** Presentación del reloj; no altera imputación, registro ni envíos de las jornadas. */
export function presentarJornada(resumen: ReturnType<typeof calcularJornada>, ahora: Date) {
  const hoy = diaMadrid(ahora);
  const lunes = new Date(`${hoy}T12:00:00Z`);
  lunes.setUTCDate(lunes.getUTCDate() - (lunes.getUTCDay() + 6) % 7);
  const semana = lunes.toISOString().slice(0, 10);
  const ultima = resumen.jornadas.at(-1);
  const nocturna = !resumen.actual && ultima?.salida && ultima.dia !== hoy
    && diaMadrid(ultima.salida.momento) === hoy && ultima.incidencias.length === 0;
  const actualIncluida = !!resumen.actual && !resumen.actual.pendiente && !resumen.actual.incidencias.length
    && resumen.actual.dia >= semana && resumen.actual.dia <= hoy;
  return {
    etiqueta: resumen.actual ? "Llevas en esta jornada" : nocturna ? "Última jornada" : "Trabajado hoy",
    minutos: nocturna ? ultima.minutos : resumen.minutosVisibles,
    entrada: nocturna ? ultima.entrada.momento : null,
    minutosSemana: resumen.minutosSemana + (actualIncluida ? resumen.actual!.minutos : 0),
    actualIncluida,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Pantalla del trabajador (inicio de campo y «Mis fichajes»). Solo presentación: la imputación de las jornadas, los
// totales de las demás pantallas y lo que se envía a Odoo siguen saliendo de calcularJornada sin cambios.

/** Jornada semanal de referencia: 40 horas para todos (encargo de Félix, 18-11-2026). */
export const JORNADA_SEMANAL_HORAS = 40;

/** «7:02» (sin cero delante), hora de Madrid. */
export const horaCorta = (iso: string) =>
  new Date(iso).toLocaleTimeString("es-ES", { timeZone: ZONA, hour: "numeric", minute: "2-digit" });
/** «las 7:02» o «la 1:05», para «desde las…» y «a las…». */
export const lasHora = (iso: string) => {
  const h = horaCorta(iso);
  return `${h.startsWith("1:") ? "la" : "las"} ${h}`;
};

const diaUTC = (dia: string) => new Date(`${dia}T12:00:00Z`);
const mesDe = (dia: string) => diaUTC(dia).toLocaleDateString("es-ES", { timeZone: "UTC", month: "long" });
/** «lunes 16 de noviembre» a partir de «AAAA-MM-DD». */
export const diaLargo = (dia: string) =>
  diaUTC(dia).toLocaleDateString("es-ES", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }).replace(",", "");
/** «el 14 de diciembre», «del 14 al 18 de diciembre», «del 29 de diciembre al 2 de enero». */
export function rangoDias(desde: string, hasta: string) {
  if (desde === hasta) return `el ${diaYMes(desde)}`;
  if (desde.slice(0, 7) === hasta.slice(0, 7)) return `del ${diaUTC(desde).getUTCDate()} al ${diaYMes(hasta)}`;
  return `del ${diaYMes(desde)} al ${diaYMes(hasta)}`;
}
/** «14 de diciembre» a partir de «AAAA-MM-DD». */
export const diaYMes = (dia: string) => `${diaUTC(dia).getUTCDate()} de ${mesDe(dia)}`;

/** Día anterior de un «AAAA-MM-DD». */
const diaAntes = (dia: string) => { const x = diaUTC(dia); x.setUTCDate(x.getUTCDate() - 1); return x.toISOString().slice(0, 10); };
/** Lunes de la semana (de lunes a domingo) de un «AAAA-MM-DD». */
export function lunesDe(dia: string) {
  const x = diaUTC(dia);
  x.setUTCDate(x.getUTCDate() - (x.getUTCDay() + 6) % 7);
  return x.toISOString().slice(0, 10);
}

/** Milisegundos trabajados en una jornada hasta un instante, sin las pausas. Una entrada repetida no reinicia nada. */
function trabajadoHasta(j: Jornada, hasta: number) {
  let ms = 0;
  let tramo: number | null = null;
  for (const f of j.fichajes) {
    const t = Date.parse(f.momento);
    if (t > hasta) break;
    if (f === j.entrada || (f.tipo === "reanudar" && tramo === null)) tramo = t;
    else if ((f.tipo === "pausa" || f.tipo === "salida") && tramo !== null) { ms += t - tramo; tramo = null; }
  }
  return tramo === null ? ms : ms + Math.max(0, hasta - tramo);
}

/** Horas, minutos y segundos de una duración (para el contador grande). */
export function partesDuracion(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return { h: Math.floor(s / 3600), min: Math.floor(s / 60) % 60, seg: s % 60 };
}
/** «27 h 40 min» a partir de milisegundos (se descuentan los segundos sueltos). */
export const duracionMs = (ms: number) => duracion(Math.floor(Math.max(0, ms) / 60000));
/** «30 min» o «1 h 05 min» (para pausas). */
export const duracionCorta = (ms: number) => {
  const min = Math.floor(Math.max(0, ms) / 60000);
  return min < 60 ? `${min} min` : duracion(min);
};

/**
 * Lo que ve el trabajador en su tarjeta de jornada, calculado en el momento `ahora` (el reloj de la pantalla lo llama
 * cada segundo con los mismos fichajes).
 * - Con una jornada abierta, el número grande es lo que lleva en ella (aunque empezara ayer: turno de noche). Si hoy
 *   ya terminó otra (jornada partida), además «Hoy en total».
 * - Sin jornada abierta, «Hoy has trabajado» suma las jornadas que han terminado hoy: el turno de noche que acabó esta
 *   mañana cuenta hoy entero, no «0 h».
 * - «Esta semana» (de lunes a domingo) sigue la regla de toda la app: cada jornada cuenta en la semana de su día de
 *   entrada. La abierta se suma mientras no esté pendiente de cierre; las que tienen fichajes por revisar, no.
 */
export function vistaDelDia(fichajes: Fichaje[], ahora = new Date()) {
  const r = calcularJornada(fichajes, ahora);
  const t = ahora.getTime();
  const hoy = diaMadrid(ahora);
  const semana = lunesDe(hoy);
  const valida = (j: Jornada) => j.incidencias.length === 0;
  const cerradas = r.jornadas.filter((j) => j.salida && valida(j));
  const ms = (js: Jornada[]) => js.reduce((s, j) => s + j.minutos * 60000, 0);
  const actual = r.actual;
  const abierta = actual && !actual.pendiente ? actual : null;
  const msActual = actual ? trabajadoHasta(actual, Math.min(t, Date.parse(actual.entrada.momento) + LIMITE_JORNADA_HORAS * 3600000)) : 0;
  const enSemana = (j: Jornada) => j.dia >= semana && j.dia <= hoy;
  const msSemana = ms(cerradas.filter(enSemana)) + (abierta && valida(abierta) && enSemana(abierta) ? msActual : 0);

  const terminadasHoy = cerradas.filter((j) => diaMadrid(j.salida!.momento) === hoy);
  const ultima = r.jornadas.at(-1);
  const antesHoy = abierta && abierta.dia === hoy ? cerradas.filter((j) => j.dia === hoy) : [];
  let desde: string | null = null;
  if (r.estado === "trabajando" || r.estado === "pendiente") desde = actual!.entrada.momento;
  else if (r.estado === "pausa") desde = actual!.fichajes.at(-1)!.momento;
  else if (ultima?.salida && diaMadrid(ultima.salida.momento) === hoy) desde = ultima.salida.momento;

  return {
    estado: r.estado,
    /** Instante que acompaña al estado: entrada (trabajando), inicio de la pausa, salida de hoy o entrada olvidada. */
    desde,
    /** La entrada de la jornada abierta fue otro día (turno de noche). */
    desdeAyer: !!actual && actual.dia !== hoy,
    terminadaHoy: r.estado === "fuera" && !!desde,
    etiqueta: abierta ? "Llevas en esta jornada" : "Hoy has trabajado",
    msGrande: abierta ? msActual : ms(terminadasHoy),
    msHoyTotal: antesHoy.length ? ms(antesHoy) + msActual : null,
    msSemana,
    msObjetivo: JORNADA_SEMANAL_HORAS * 3600000,
    /** Jornada sin salida que ya pasó de 16 horas: no se puede fichar hasta que el responsable anote la salida. */
    olvido: actual?.pendiente ? actual : null,
    revisar: r.incidencias.length > 0,
    resumen: r,
  };
}

/** Aviso sencillo de la salida olvidada: qué pasó y qué hará su responsable. */
export function textoOlvido(j: Jornada, ahora = new Date()) {
  const hoy = diaMadrid(ahora);
  const cuando = j.dia === hoy ? "Hoy" : j.dia === diaAntes(hoy) ? "Ayer" : `El ${diaLargo(j.dia)}`;
  return `${cuando} no fichaste la salida. Tu responsable la cerrará con la hora real.`;
}

// ---------------------------------------------------------------------------------------------------------------
// «Mis fichajes» por semana y por mes, el registro para descargar y las horas trabajadas de «Vacaciones». Mismas reglas
// que el resto de la app: cada jornada cuenta en el día de su entrada (el turno de noche del 31 de diciembre es del año
// que termina), las pausas no cuentan, la jornada abierta suma lo que lleva mientras no esté pendiente de cierre y las
// que tienen fichajes por revisar no suman hasta que el responsable las arregle. Solo presentación.

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const fechaValida = (dia: unknown): dia is string =>
  typeof dia === "string" && FECHA.test(dia) && !Number.isNaN(diaUTC(dia).getTime()) && diaUTC(dia).toISOString().slice(0, 10) === dia;

/** «AAAA-MM-DD» más `n` días (negativo, para restar). */
export function sumarDias(dia: string, n: number) {
  const x = diaUTC(dia);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}
/** Último día del mes de un «AAAA-MM-DD». */
export function finDeMes(dia: string) {
  const [y, m] = dia.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}
const mayuscula = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
/** «Noviembre de 2026» a partir de «AAAA-MM» o «AAAA-MM-DD». */
export const nombreMes = (dia: string) =>
  mayuscula(diaUTC(`${dia.slice(0, 7)}-01`).toLocaleDateString("es-ES", { timeZone: "UTC", month: "long", year: "numeric" }));
/** «lunes» a partir de «AAAA-MM-DD». */
export const diaSemana = (dia: string) => diaUTC(dia).toLocaleDateString("es-ES", { timeZone: "UTC", weekday: "long" });

/** Fechas de una solicitud en lenguaje claro: «Del lunes 14 al viernes 18 de diciembre», «El martes 8 de diciembre»,
 *  «Del lunes 28 de diciembre de 2026 al viernes 1 de enero de 2027». El año sale si cruza de año o si no es el actual. */
export function fechasSolicitud(desde: string, hasta: string, anioActual?: string) {
  const anio = (d: string) => d.slice(0, 4);
  const conAnio = anio(desde) !== anio(hasta) || (!!anioActual && anio(desde) !== anioActual);
  const completo = (d: string) => `${diaSemana(d)} ${diaYMes(d)}${conAnio ? ` de ${anio(d)}` : ""}`;
  if (desde === hasta) return `El ${completo(desde)}`;
  if (desde.slice(0, 7) === hasta.slice(0, 7)) return `Del ${diaSemana(desde)} ${diaUTC(desde).getUTCDate()} al ${completo(hasta)}`;
  return `Del ${completo(desde)} al ${completo(hasta)}`;
}

/** Días de una solicitud: laborables (de lunes a viernes; los festivos todavía no se descuentan), de fin de semana y en
 *  total. Fechas no válidas o «hasta» antes de «desde»: todo a cero. */
export function diasDeSolicitud(desde: string, hasta: string) {
  if (!fechaValida(desde) || !fechaValida(hasta) || hasta < desde) return { laborables: 0, finDeSemana: 0, naturales: 0 };
  const naturales = Math.round((diaUTC(hasta).getTime() - diaUTC(desde).getTime()) / 86400000) + 1;
  let laborables = Math.floor(naturales / 7) * 5;
  for (let i = 0, d = diaUTC(desde).getUTCDay(); i < naturales % 7; i++, d = (d + 1) % 7) if (d !== 0 && d !== 6) laborables++;
  return { laborables, finDeSemana: naturales - laborables, naturales };
}
/** «Son 5 días laborables (de lunes a viernes).» */
export function textoDiasLaborables(laborables: number) {
  if (laborables === 0) return "No hay ningún día laborable (de lunes a viernes) en esas fechas.";
  return laborables === 1 ? "Es 1 día laborable (de lunes a viernes)." : `Son ${laborables} días laborables (de lunes a viernes).`;
}

export type Pausa = { desde: string; hasta: string | null };
export type JornadaDelDia = {
  jornada: Jornada;
  entrada: string;
  salida: string | null;
  /** La salida fue otro día (turno de noche): se enseña con su día. */
  salidaOtroDia: boolean;
  pausas: Pausa[];
  msPausas: number;
  /** Tiempo trabajado, sin las pausas. En la abierta, lo que lleva; en la pendiente de cierre, hasta las 16 h. */
  ms: number;
  /** Suma en los totales (no la suman las pendientes de cierre ni las que hay que revisar). */
  cuenta: boolean;
  estado: "terminada" | "trabajando" | "pausa" | "pendiente" | "revisar";
  /** Fichajes que anotó el responsable, con su motivo: así se ve qué se corrigió y por qué. */
  correcciones: { tipo: Fichaje["tipo"]; momento: string; nota: string | null }[];
};
export type DiaDelRegistro = { dia: string; jornadas: JornadaDelDia[]; ms: number };

/** Jornadas cuyo día de entrada está entre `desde` y `hasta` (ambos «AAAA-MM-DD», incluidos), agrupadas por día. */
export function registroDeJornadas(fichajes: Fichaje[], desde: string, hasta: string, ahora = new Date()) {
  const r = calcularJornada(fichajes, ahora);
  const t = ahora.getTime();
  const dias = new Map<string, DiaDelRegistro>();
  let ms = 0;
  for (const j of r.jornadas) {
    if (j.dia < desde || j.dia > hasta) continue;
    const tope = j.salida ? Date.parse(j.salida.momento)
      : Math.min(t, Date.parse(j.entrada.momento) + LIMITE_JORNADA_HORAS * 3600000);
    const revisar = j.incidencias.length > 0;
    const estado: JornadaDelDia["estado"] = revisar ? "revisar" : j.salida ? "terminada" : j.pendiente ? "pendiente"
      : r.estado === "pausa" && j === r.actual ? "pausa" : "trabajando";
    const msJ = j.salida ? j.minutos * 60000 : trabajadoHasta(j, tope);
    const cuenta = !revisar && (!!j.salida || !j.pendiente);
    const pausas: Pausa[] = [];
    let abierta: Pausa | null = null;
    for (const f of j.fichajes) {
      if (Date.parse(f.momento) > tope) break;
      if (f.tipo === "pausa" && !abierta) pausas.push(abierta = { desde: f.momento, hasta: null });
      else if ((f.tipo === "reanudar" || f.tipo === "salida") && abierta) { abierta.hasta = f.momento; abierta = null; }
    }
    const msPausas = pausas.reduce((s, p) => s + Math.max(0, (p.hasta ? Date.parse(p.hasta) : tope) - Date.parse(p.desde)), 0);
    const dia = dias.get(j.dia) ?? { dia: j.dia, jornadas: [], ms: 0 };
    dia.jornadas.push({
      jornada: j, entrada: j.entrada.momento, salida: j.salida?.momento ?? null,
      salidaOtroDia: !!j.salida && diaMadrid(j.salida.momento) !== j.dia,
      pausas, msPausas, ms: msJ, cuenta, estado,
      correcciones: j.fichajes.filter((f) => f.origen === "correccion").map((f) => ({ tipo: f.tipo, momento: f.momento, nota: f.nota })),
    });
    if (cuenta) { dia.ms += msJ; ms += msJ; }
    dias.set(j.dia, dia);
  }
  return { dias: [...dias.values()].sort((a, b) => a.dia.localeCompare(b.dia)), ms };
}

/** «7:02 – 15:04»; turno de noche: «22:00 – 6:00 del martes»; abierta: «7:02 – ahora». */
export function textoEntradaSalida(j: JornadaDelDia) {
  const salida = j.salida ? `${horaCorta(j.salida)}${j.salidaOtroDia ? ` del ${diaSemana(diaMadrid(j.salida))}` : ""}`
    : j.estado === "trabajando" || j.estado === "pausa" ? "ahora" : "sin salida";
  return `${horaCorta(j.entrada)} – ${salida}`;
}
/** «Pausa: 10:30 – 11:00 (30 min)» o «Pausas: 10:30 – 11:00, 13:00 – 13:15 (45 min)»; sin pausas, null. */
export function textoPausas(j: JornadaDelDia) {
  if (!j.pausas.length) return null;
  const tramos = j.pausas.map((p) => `${horaCorta(p.desde)} – ${p.hasta ? horaCorta(p.hasta) : "ahora"}`).join(", ");
  return `${j.pausas.length === 1 ? "Pausa" : "Pausas"}: ${tramos} (${duracionCorta(j.msPausas)})`;
}
/** «Salida a las 15:00 anotada por tu responsable: se le olvidó fichar». */
export function textoCorreccion(c: JornadaDelDia["correcciones"][number]) {
  return `${NOMBRE_TIPO[c.tipo]} a ${lasHora(c.momento)} anotada por tu responsable${c.nota ? `: ${c.nota}` : "."}`;
}

/** Horas trabajadas de este año, este mes y esta semana (de lunes a domingo), para la pantalla de Vacaciones. Necesita
 *  los fichajes desde el 1 de enero (o desde el lunes, si la semana empezó el año anterior). */
export function horasTrabajadas(fichajes: Fichaje[], ahora = new Date()) {
  const hoy = diaMadrid(ahora);
  const anio = `${hoy.slice(0, 4)}-01-01`;
  const mes = `${hoy.slice(0, 7)}-01`;
  const semana = lunesDe(hoy);
  const { dias } = registroDeJornadas(fichajes, inicioHorasTrabajadas(ahora), hoy, ahora);
  const desde = (inicio: string) => dias.filter((d) => d.dia >= inicio).reduce((s, d) => s + d.ms, 0);
  return { msAnio: desde(anio), msMes: desde(mes), msSemana: desde(semana), msObjetivo: JORNADA_SEMANAL_HORAS * 3600000 };
}
/** Primer día que hay que leer para horasTrabajadas: el 1 de enero o, si la semana empezó el año anterior, su lunes. */
export function inicioHorasTrabajadas(ahora = new Date()) {
  const hoy = diaMadrid(ahora);
  const anio = `${hoy.slice(0, 4)}-01-01`;
  const semana = lunesDe(hoy);
  return semana < anio ? semana : anio;
}

export type Periodo = {
  vista: "semana" | "mes"; desde: string; hasta: string; titulo: string;
  anterior: string; siguiente: string | null;
  /** Incluye hoy. */
  actual: boolean;
};
/** Semana o mes que se pide en «Mis fichajes» (?semana=AAAA-MM-DD o ?mes=AAAA-MM). Lo que no se entiende o es futuro
 *  vuelve a la semana o al mes de hoy. `anterior` y `siguiente` son el valor del parámetro para moverse. */
export function periodoPedido(q: { semana?: string; mes?: string }, ahora = new Date()): Periodo {
  const hoy = diaMadrid(ahora);
  const esteMes = hoy.slice(0, 7);
  if (q.mes !== undefined) {
    const valido = /^\d{4}-(0[1-9]|1[0-2])$/.test(q.mes) && q.mes >= "2020-01" && q.mes <= esteMes;
    const mes = valido ? q.mes : esteMes;
    const desde = `${mes}-01`;
    return { vista: "mes", desde, hasta: finDeMes(desde), titulo: nombreMes(desde),
      anterior: sumarDias(desde, -1).slice(0, 7), siguiente: mes < esteMes ? sumarDias(finDeMes(desde), 1).slice(0, 7) : null,
      actual: mes === esteMes };
  }
  const estaSemana = lunesDe(hoy);
  const pedida = fechaValida(q.semana) && q.semana >= "2020-01-01" ? lunesDe(q.semana) : estaSemana;
  const desde = pedida > estaSemana ? estaSemana : pedida;
  const hasta = sumarDias(desde, 6);
  return { vista: "semana", desde, hasta, titulo: mayuscula(`semana ${rangoDias(desde, hasta)}`),
    anterior: sumarDias(desde, -7), siguiente: desde < estaSemana ? sumarDias(desde, 7) : null, actual: desde === estaSemana };
}
