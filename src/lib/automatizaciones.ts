/**
 * Automatizaciones: herramientas que hacen solas un trabajo repetitivo. Una entrada por automatización, sin tablas.
 * Para añadir una (docs/automatizaciones.md): su entrada aquí, su permiso en el área «automatizaciones» de
 * src/lib/permisos.json y su página en src/app/automatizaciones/<id>/ con conPermiso(<permiso>).
 */
export type Automatizacion = {
  id: string;
  nombre: string;
  descripcion: string;
  ruta: string;
  permiso: string;
  icono: string;      // uno de los dibujos de src/app/Icono.tsx
  etiqueta: string;   // rótulo corto de la tarjeta
};

export const AUTOMATIZACIONES: Automatizacion[] = [
  {
    id: "gasoleo",
    nombre: "Revisión del precio por gasóleo",
    descripcion: "Calcula cuánto cambia el precio de un transporte cuando sube o baja el gasóleo, con los precios semanales del Ministerio de Transportes.",
    ruta: "/automatizaciones/gasoleo",
    permiso: "automatizaciones.gasoleo",
    icono: "combustible",
    etiqueta: "PRECIOS DEL MINISTERIO",
  },
];

/** Todos los permisos de la sección: con cualquiera de ellos se entra en la portada. */
export const PERMISOS_AUTOMATIZACIONES = AUTOMATIZACIONES.map((a) => a.permiso);
