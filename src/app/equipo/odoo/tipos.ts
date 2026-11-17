/** Respuesta de GET /api/odoo/vinculos/pendientes (servicios/organizacion.py, proponer_vinculos). Sin teléfonos de
 *  Odoo: como mucho sus 3 últimas cifras. */
export type Candidato = {
  id: number; nombre: string; empresa: string | null; departamento: string | null; puesto: string | null;
  por: "telefono" | "nombre" | "actual"; telefono_fin: string | null; compartido: boolean; disponible: boolean;
  actual: boolean; ocupada: boolean; seguro: boolean; aviso: string | null;
};
export type Pendiente = { id: string; nombre: string; chofer: boolean; telefono: string | null; empleados: Candidato[]; conductores: Candidato[] };
type Ficha = { id: number; nombre: string; empresa?: string | null; departamento?: string | null; puesto?: string | null; disponible: boolean };
export type Enlazada = {
  id: string; nombre: string; chofer: boolean; telefono: string | null; confirmado: string; confirmado_por: string | null;
  empleado: Ficha; conductor: Ficha | null;
};
export type RespuestaVinculos = { pendientes: Pendiente[]; enlazadas: Enlazada[]; consultado: string; origen: string };

/** Se puede elegir: está activa en Odoo y no la tiene otra persona de la app. */
export const elegible = (c: Candidato) => c.disponible && !c.ocupada;
