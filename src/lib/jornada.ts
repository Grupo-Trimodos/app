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
const diaMadrid = (instante: string | Date) => new Date(instante).toLocaleDateString("sv-SE", { timeZone: ZONA });
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
