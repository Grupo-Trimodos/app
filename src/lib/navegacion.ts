/** Los enlaces del menú, con su nombre, su orden y su icono. Una sola lista para el menú de las páginas
 *  (src/app/Navegacion.tsx) y para el que pinta la PWA de DECA (/api/sesion/cabecera). */
export type Enlace = { id: string; nombre: string; ruta: string };

const NOMBRES: Record<string, string> = { flota: "Centro de flota", ausencias: "Mis ausencias", deca: "Órdenes de transporte" };
const NOMBRES_MOVIL: Record<string, string> = { inicio: "Inicio", direccion: "Dirección", organizacion: "Personas", transporte: "Transporte", flota: "Flota", chofer: "Mi camión", viajes: "Viajes", deca: "Órdenes", fichaje: "Fichajes", ausencias: "Ausencias", automatizaciones: "Herramientas" };
const ORDEN: Record<string, number> = {
  direccion: 0, organizacion: 0.5, transporte: 0.7, flota: 1, chofer: 2, viajes: 2.5, deca: 3, fichaje: 4, ausencias: 5, ropa: 6, documentos: 7, incidencias: 8, equipo: 9, equipos: 9.5, calendario: 9.7, seguridad: 10, automatizaciones: 10.5, admin: 11,
};
export const ICONOS_AREA: Record<string, string> = {
  direccion: "actividad", organizacion: "equipo", transporte: "camion", flota: "flota", fichaje: "reloj", chofer: "camion", viajes: "ruta", ausencias: "calendario", equipo: "equipo", equipos: "equipo", deca: "documento", admin: "ajustes",
  documentos: "documento", incidencias: "aviso", seguridad: "escudo", ropa: "ropa", automatizaciones: "combustible", calendario: "calendario",
};

/** «Inicio» (o el nombre que tenga para esa persona) y sus áreas, ya ordenadas y con el icono de cada una. */
export function enlacesMenu(areas: Enlace[], inicio = "Inicio") {
  return [{ id: "inicio", nombre: inicio, ruta: "/" }, ...[...areas].sort((a, b) => (ORDEN[a.id] ?? 9) - (ORDEN[b.id] ?? 9))]
    .map((a) => ({
      id: a.id, ruta: a.ruta, nombre: NOMBRES[a.id] ?? a.nombre,
      nombreMovil: NOMBRES_MOVIL[a.id] ?? a.nombre,
      icono: a.id === "inicio" && inicio !== "Inicio" ? "actividad" : ICONOS_AREA[a.id] ?? "inicio",
    }));
}

/** Mismos accesos de campo en la web y en DECA; siempre calculados con los permisos de la sesión. */
export function pestanasCampo(enMenu: (area: string) => boolean) {
  return [
    { href: "/", texto: "Inicio", icono: "inicio" },
    ...(enMenu("ausencias") ? [{ href: "/ausencias", texto: "Vacaciones", icono: "calendario" }] : []),
    ...(enMenu("fichaje") ? [{ href: "/fichaje", texto: "Mis fichajes", icono: "reloj" }] : []),
    ...(enMenu("automatizaciones") ? [{ href: "/automatizaciones", texto: "Herramientas", icono: "herramienta" }] : []),
  ];
}

/** Iniciales de las dos primeras palabras con letras (un «(ejemplo)» o un número no cuentan). */
export function iniciales(nombre: string) {
  return nombre.trim().split(/\s+/).filter((p) => /^\p{L}/u.test(p)).slice(0, 2).map((p) => p[0]).join("").toUpperCase() || "GT";
}

export const CONTEXTO = { direccion: "Dirección · Grupo Trimodos", oficina: "Tu espacio Trimodos", campo: "Grupo Trimodos" } as const;
