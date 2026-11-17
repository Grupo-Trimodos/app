/** «Mis viajes»: pasos de carga y descarga que marca el chófer (solo en la app, tabla viajes_estados). La misma lista
 *  está en la base de datos (privado.viaje_siguiente_paso) y en servicios/viajes.py (PASOS). docs/viajes.md. */
import { ZONA } from "@/lib/jornada";

export const PASOS = ["llegada_carga", "cargando", "cargado", "llegada_descarga", "descargando", "descargado"] as const;
export type Paso = (typeof PASOS)[number];
export type Estado = Paso | "incidencia";

/** Texto del botón para marcar cada paso. */
export const BOTON_PASO: Record<Paso, string> = {
  llegada_carga: "He llegado a cargar", cargando: "Empiezo a cargar", cargado: "Cargado",
  llegada_descarga: "He llegado a descargar", descargando: "Empiezo a descargar", descargado: "Descargado",
};
/** Cómo se dice cada paso ya marcado (línea de tiempo y seguimiento). */
export const NOMBRE_ESTADO: Record<Estado, string> = {
  llegada_carga: "En el punto de carga", cargando: "Cargando", cargado: "Cargado, en camino",
  llegada_descarga: "En el punto de descarga", descargando: "Descargando", descargado: "Descargado", incidencia: "Incidencia",
};

export const esPaso = (x: unknown): x is Paso => typeof x === "string" && (PASOS as readonly string[]).includes(x);

/** El paso que toca después de los ya marcados (las incidencias no cuentan); null si ya está descargado. */
export function siguientePaso(estados: { estado: string }[]): Paso | null {
  const hechos = estados.map((e) => e.estado).filter(esPaso);
  if (!hechos.length) return PASOS[0];
  const i = PASOS.indexOf(hechos[hechos.length - 1]);
  return i + 1 < PASOS.length ? PASOS[i + 1] : null;
}

export type PasoMarcado = { estado: Estado; nota: string | null; momento: string };
export type Orden = {
  id: number; nombre: string; pedido: string | null; empresa: "stinsa" | "transargi" | null; empresa_nombre: string | null;
  cliente: string | null; origen: string | null; destino: string | null; destino_final: string | null;
  puerto_carga: string | null; puerto_descarga: string | null; inicio: string | null; fin: string | null; limite: string | null;
  referencia_carga: string | null; referencia_cliente: string | null; remolque: string | null; servicio_descarga: boolean;
  emitida: string | null; aprobada: boolean; etapa: string | null;
};
export type OrdenChofer = Orden & { pasos: PasoMarcado[]; siguiente: Paso | null; terminado: boolean };
export type MisViajes = { enlazado: boolean; aviso: string | null; ordenes: OrdenChofer[]; limitado: boolean; consultado: string };
export type OrdenSeguimiento = Orden & {
  persona: { id: string; nombre: string }; estado: Estado | null; momento: string | null; incidencias: number;
  ultima_incidencia: string | null; nota: string | null; aviso: string | null;
};
export type Seguimiento = { personas: { id: string; nombre: string }[]; ordenes: OrdenSeguimiento[]; limitado: boolean; consultado: string };

/** Fecha y hora en Madrid: «lun 17 nov, 08:30». */
export const fechaHora = (iso: string | null) => !iso ? "Sin fecha" : new Date(iso).toLocaleString("es-ES", {
  timeZone: ZONA, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
});
/** Solo la hora en Madrid, o el día y la hora si no es de hoy. */
export function horaPaso(iso: string) {
  const d = new Date(iso);
  const dia = (x: Date) => x.toLocaleDateString("sv-SE", { timeZone: ZONA });
  const hora = d.toLocaleTimeString("es-ES", { timeZone: ZONA, hour: "2-digit", minute: "2-digit" });
  return dia(d) === dia(new Date()) ? hora : `${d.toLocaleDateString("es-ES", { timeZone: ZONA, day: "numeric", month: "short" })}, ${hora}`;
}

/** Enlace a DECA con la orden ya buscada (pedido de venta y empresa). Null si DECA no la puede abrir así. */
export function enlaceDeca(o: Pick<Orden, "pedido" | "empresa">) {
  if (!o.pedido || !o.empresa || !/^S\d{5,9}$/.test(o.pedido)) return null;
  return `/deca/?pedido=${encodeURIComponent(o.pedido)}&empresa=${o.empresa}`;
}
