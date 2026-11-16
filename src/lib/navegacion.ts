/** Los enlaces del menú, con su nombre, su orden y su icono. Una sola lista para el menú de las páginas
 *  (src/app/Navegacion.tsx) y para el que pinta la PWA de DECA (/api/sesion/cabecera). */
export type Enlace = { id: string; nombre: string; ruta: string };

const NOMBRES: Record<string, string> = { flota: "Centro de flota", ausencias: "Mis ausencias", deca: "Órdenes de transporte" };
const ORDEN: Record<string, number> = {
  direccion: 0, flota: 1, chofer: 2, deca: 3, fichaje: 4, ausencias: 5, ropa: 6, documentos: 7, incidencias: 8, equipo: 9, seguridad: 10, admin: 11,
};
export const ICONOS_AREA: Record<string, string> = {
  direccion: "actividad", flota: "flota", fichaje: "reloj", chofer: "camion", ausencias: "calendario", equipo: "equipo", deca: "documento", admin: "ajustes",
  documentos: "documento", incidencias: "aviso", seguridad: "escudo", ropa: "ropa",
};

/** «Inicio» (o el nombre que tenga para esa persona) y sus áreas, ya ordenadas y con el icono de cada una. */
export function enlacesMenu(areas: Enlace[], inicio = "Inicio") {
  return [{ id: "inicio", nombre: inicio, ruta: "/" }, ...[...areas].sort((a, b) => (ORDEN[a.id] ?? 9) - (ORDEN[b.id] ?? 9))]
    .map((a) => ({
      id: a.id, ruta: a.ruta, nombre: NOMBRES[a.id] ?? a.nombre,
      icono: a.id === "inicio" && inicio !== "Inicio" ? "actividad" : ICONOS_AREA[a.id] ?? "inicio",
    }));
}

/** Iniciales de las dos primeras palabras con letras (un «(ejemplo)» o un número no cuentan). */
export function iniciales(nombre: string) {
  return nombre.trim().split(/\s+/).filter((p) => /^\p{L}/u.test(p)).slice(0, 2).map((p) => p[0]).join("").toUpperCase() || "GT";
}

export const CONTEXTO = { direccion: "Dirección · Grupo Trimodos", oficina: "Tu espacio Trimodos", campo: "Grupo Trimodos" } as const;
