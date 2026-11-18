import { madridAInstante, ZONA } from "./jornada";

/**
 * Calendario (/calendario): cuentas de fechas en hora de Madrid, sin dependencias del servidor (se prueban en
 * tests/web/calendario.test.mjs). Convención para todo lo que se pinta (notas, fechas señaladas, ausencias y Outlook):
 *   · «empieza» y «termina» son instantes; «termina» puede faltar (una hora suelta o un solo día).
 *   · Un día completo empieza a las 00:00 de Madrid y, si dura varios días, termina a las 00:00 del día SIGUIENTE al
 *     último (como Outlook). Acabar justo a las 00:00 no ocupa ese día.
 */
export type Horario = { empieza: string; termina: string | null; todo_el_dia: boolean };
export type Elemento = { clave: string; titulo: string; empieza: string; termina: string | null; todoElDia: boolean };

const MES_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
const DIA_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const HORA_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DURACION_MAXIMA = 366 * 864e5;
const MEDIA_HORA = 30 * 60000;

/** Día (AAAA-MM-DD) de Madrid de un instante. */
export const diaMadrid = (instante: string | Date | number) => new Date(instante).toLocaleDateString("sv-SE", { timeZone: ZONA });
/** «HH:MM» de Madrid de un instante. */
export const horaMadrid = (instante: string | Date | number) =>
  new Date(instante).toLocaleTimeString("en-GB", { timeZone: ZONA, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
/** «AAAA-MM-DDTHH:MM:00» de Madrid (lo que espera Outlook junto a timeZone «Europe/Madrid»). */
export const localMadrid = (instante: string | Date | number) => `${diaMadrid(instante)}T${horaMadrid(instante)}:00`;

const mediodia = (dia: string) => new Date(`${dia}T12:00:00Z`);
export function sumarDiasISO(dia: string, n: number) {
  const d = mediodia(dia);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/** ¿Es un día que existe (no 31 de febrero)? */
export const esDia = (texto: string) => DIA_RE.test(texto) && mediodia(texto).toISOString().slice(0, 10) === texto;
/** Medianoche de Madrid de ese día, como instante (respeta los cambios de hora). */
export const inicioDiaMadrid = (dia: string) => madridAInstante(`${dia}T00:00`)!;

/** Mes pedido (AAAA-MM) si es válido; si no, el de hoy. */
export function mesValido(texto: string | undefined | null, hoy: string) {
  const m = MES_RE.exec(texto ?? "");
  return m && +m[1] >= 2000 && +m[1] <= 2100 ? m[0] : hoy.slice(0, 7);
}
export function moverMes(mes: string, n: number) {
  const [y, m] = mes.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
}
/** Días del mes, del 1 al último. */
export function diasDelMes(mes: string) {
  const dias: string[] = [];
  for (let d = `${mes}-01`; d.startsWith(mes); d = sumarDiasISO(d, 1)) dias.push(d);
  return dias;
}
const lunesA0 = (dia: string) => (mediodia(dia).getUTCDay() + 6) % 7;   // lunes 0 … domingo 6
/** Días de la cuadrícula del mes: de lunes a domingo, con los del mes anterior y siguiente que completan semanas. */
export function rejillaMes(mes: string) {
  const delMes = diasDelMes(mes);
  const primero = delMes[0], ultimo = delMes.at(-1)!;
  const dias: string[] = [];
  for (let d = sumarDiasISO(primero, -lunesA0(primero)); d <= sumarDiasISO(ultimo, 6 - lunesA0(ultimo)); d = sumarDiasISO(d, 1)) dias.push(d);
  return dias;
}
/** Periodo [desde, hasta) que cubren esos días (ordenados), como instantes. */
export function limites(dias: string[]) {
  return { desde: inicioDiaMadrid(dias[0]), hasta: inicioDiaMadrid(sumarDiasISO(dias.at(-1)!, 1)) };
}

/** Primer y último día (Madrid) que ocupa algo. */
export function diasQueOcupa(e: { empieza: string; termina: string | null }): [string, string] {
  const inicio = diaMadrid(e.empieza);
  if (!e.termina || Date.parse(e.termina) <= Date.parse(e.empieza)) return [inicio, inicio];
  const fin = diaMadrid(Date.parse(e.termina) - 1);
  return [inicio, fin < inicio ? inicio : fin];
}

const ordenar = (x: Elemento, y: Elemento) =>
  Number(y.todoElDia) - Number(x.todoElDia) || Date.parse(x.empieza) - Date.parse(y.empieza) || x.titulo.localeCompare(y.titulo, "es");

/** Lo de cada día: todo el día primero y luego por hora. Lo que dura varios días sale en cada uno. */
export function porDia<T extends Elemento>(elementos: T[], dias: string[]) {
  const mapa = new Map<string, T[]>(dias.map((d) => [d, []]));
  for (const e of elementos) {
    const [a, b] = diasQueOcupa(e);
    for (const d of dias) if (d >= a && d <= b) mapa.get(d)!.push(e);
  }
  for (const lista of mapa.values()) lista.sort(ordenar);
  return mapa;
}

const CORTO = new Intl.DateTimeFormat("es-ES", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });
const LARGO = new Intl.DateTimeFormat("es-ES", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" });
const MES = new Intl.DateTimeFormat("es-ES", { timeZone: "UTC", month: "long", year: "numeric" });
/** «mié, 18 nov» */
export const diaCorto = (dia: string) => CORTO.format(mediodia(dia));
/** «miércoles, 18 de noviembre» */
export const diaLargo = (dia: string) => LARGO.format(mediodia(dia));
/** «noviembre de 2026» */
export const nombreMes = (mes: string) => MES.format(mediodia(`${mes}-01`));

/** Cuándo es, visto desde un día concreto: «09:00–10:30», «Todo el día», «Desde las 22:00», «Hasta las 06:00»… */
export function textoHorario(e: { empieza: string; termina: string | null; todoElDia: boolean }, dia: string) {
  const [a, b] = diasQueOcupa(e);
  if (e.todoElDia) return a === b ? "Todo el día" : `Todo el día, del ${diaCorto(a)} al ${diaCorto(b)}`;
  const hi = horaMadrid(e.empieza);
  const hf = e.termina && Date.parse(e.termina) > Date.parse(e.empieza) ? horaMadrid(e.termina) : null;
  if (a === b) return hf ? `${hi}–${hf}` : hi;
  if (dia === a) return `Desde las ${hi} (sigue el ${diaCorto(sumarDiasISO(a, 1))})`;
  if (dia === b) return `Hasta las ${hf}`;
  return "Todo el día (sigue)";
}

/** Lo que llega del formulario (todo texto). */
export type CamposHorario = { fecha?: string; hora?: string; fecha_fin?: string; hora_fin?: string; todo_el_dia?: boolean };

/** La conversión inicial puede tomar el desfase del otro lado del cambio horario.
 * Contrastamos la hora local, sin normalizar silenciosamente las horas inexistentes de marzo.
 * En la hora repetida de octubre se conserva la elección de madridAInstante.
 */
function instanteHorario(dia: string, hora: string): Date | null {
  const base = madridAInstante(`${dia}T${hora}`);
  if (!base) return null;
  for (const ajuste of [0, -3600000, 3600000]) {
    const candidato = new Date(base.getTime() + ajuste);
    if (diaMadrid(candidato) === dia && horaMadrid(candidato) === hora) return candidato;
  }
  return null;
}

/** Del formulario (hora de Madrid) a instantes. Si la hora de fin es anterior a la de inicio y no se ha puesto otro día,
 *  se entiende que acaba al día siguiente (p. ej. de 22:00 a 02:00). */
export function leerHorario(c: CamposHorario): Horario | { error: string } {
  const fecha = (c.fecha ?? "").trim(), fechaFin = (c.fecha_fin ?? "").trim();
  if (!esDia(fecha)) return { error: "Elige el día." };
  if (fechaFin && !esDia(fechaFin)) return { error: "El último día no es una fecha válida." };
  if (fechaFin && fechaFin < fecha) return { error: "El último día no puede ser anterior al primero." };
  let empieza: Date, termina: Date | null = null;
  if (c.todo_el_dia) {
    empieza = inicioDiaMadrid(fecha);
    if (fechaFin && fechaFin > fecha) termina = inicioDiaMadrid(sumarDiasISO(fechaFin, 1));
  } else {
    const hora = (c.hora ?? "").trim(), horaFin = (c.hora_fin ?? "").trim();
    if (!HORA_RE.test(hora)) return { error: "Pon la hora de inicio, o marca «Todo el día»." };
    if (horaFin && !HORA_RE.test(horaFin)) return { error: "La hora de fin no es válida." };
    const inicio = instanteHorario(fecha, hora);
    if (!inicio) return { error: "Esa hora de inicio no existe en Madrid por el cambio de hora. Elige otra." };
    empieza = inicio;
    if (horaFin) {
      let diaFin = fechaFin || fecha;
      // Comparar horas locales evita que una hora inexistente cambie el día elegido.
      if (!fechaFin && horaFin < hora) diaFin = sumarDiasISO(fecha, 1);
      termina = instanteHorario(diaFin, horaFin);
      if (!termina)
        return { error: "Esa hora de fin no existe en Madrid por el cambio de hora. Elige otra." };
      if (termina < empieza) return { error: "El final no puede ser antes del principio." };
    } else if (fechaFin && fechaFin !== fecha) return { error: "Si dura varios días, pon también la hora de fin." };
  }
  if (termina && termina.getTime() - empieza.getTime() > DURACION_MAXIMA) return { error: "Como mucho, un año." };
  return { empieza: empieza.toISOString(), termina: termina?.toISOString() ?? null, todo_el_dia: !!c.todo_el_dia };
}

/** Al revés: para rellenar el formulario al editar. */
export function camposDe(h: Horario): Required<CamposHorario> {
  const fecha = diaMadrid(h.empieza);
  if (h.todo_el_dia) {
    const [, ultimo] = diasQueOcupa(h);
    return { fecha, hora: "", fecha_fin: ultimo === fecha ? "" : ultimo, hora_fin: "", todo_el_dia: true };
  }
  const fin = h.termina && Date.parse(h.termina) > Date.parse(h.empieza) ? h.termina : null;
  return { fecha, hora: horaMadrid(h.empieza), fecha_fin: fin && diaMadrid(fin) !== fecha ? diaMadrid(fin) : "",
    hora_fin: fin ? horaMadrid(fin) : "", todo_el_dia: false };
}

/** Enlace de una fecha señalada: solo http o https. null si no hay; «false» si no vale. */
export function enlaceValido(texto: string | null | undefined): string | null | false {
  const t = (texto ?? "").trim();
  if (!t) return null;
  if (t.length > 500 || /[\s<>"]/.test(t)) return false;
  try {
    const u = new URL(t);
    return (u.protocol === "http:" || u.protocol === "https:") && !!u.hostname ? t : false;
  } catch { return false; }
}

/** Instante de una fecha de Outlook (pedida con «Prefer: outlook.timezone="Europe/Madrid"»: viene en hora de Madrid,
 *  sin zona, p. ej. «2026-11-18T09:00:00.0000000»). */
export function instanteDeOutlook(fechaHora: string) {
  const d = madridAInstante(fechaHora.slice(0, 16));
  return d ? d.toISOString() : null;
}

export type DatosEvento = Horario & { titulo: string; detalle?: string | null; lugar?: string | null; enlace?: string | null };

/** Cuerpo del evento de Outlook (Microsoft Graph) para una nota o una fecha señalada. Sin hora de fin, dura media hora. */
export function eventoOutlook(d: DatosEvento, transaccion?: string) {
  const [a, b] = diasQueOcupa(d);
  const fin = d.termina && Date.parse(d.termina) > Date.parse(d.empieza) ? d.termina : new Date(Date.parse(d.empieza) + MEDIA_HORA).toISOString();
  return {
    subject: d.titulo,
    isAllDay: d.todo_el_dia,
    start: { dateTime: d.todo_el_dia ? `${a}T00:00:00` : localMadrid(d.empieza), timeZone: ZONA },
    end: { dateTime: d.todo_el_dia ? `${sumarDiasISO(b, 1)}T00:00:00` : localMadrid(fin), timeZone: ZONA },
    ...(d.lugar ? { location: { displayName: d.lugar } } : {}),
    body: { contentType: "text", content: [d.detalle, d.enlace, "Apuntado desde la app de Grupo Trimodos."].filter(Boolean).join("\n\n") },
    ...(transaccion ? { transactionId: transaccion } : {}),
  };
}
