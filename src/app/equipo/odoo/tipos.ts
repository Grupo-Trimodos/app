/** Respuesta de GET /api/odoo/vinculos/pendientes (servicios/organizacion.py, proponer_vinculos). Sin teléfonos ni
 *  correos de Odoo: como mucho las 3 últimas cifras del teléfono. `con_pin`: entra con código y PIN (se compara su móvil);
 *  si no, entra con Microsoft o Google (se compara su correo). */
export type Candidato = {
  id: number; nombre: string; empresa: string | null; departamento: string | null; puesto: string | null;
  por: "telefono" | "correo" | "nombre" | "actual"; telefono_fin: string | null; compartido: boolean; disponible: boolean;
  actual: boolean; ocupada: boolean; descartada: boolean; seguro: boolean; aviso: string | null;
};
type Persona = { id: string; nombre: string; chofer: boolean; con_pin: boolean; telefono: string | null; correo: string | null };
export type Pendiente = Persona & { empleados: Candidato[]; conductores: Candidato[] };
type Ficha = { id: number; nombre: string; empresa?: string | null; departamento?: string | null; puesto?: string | null; disponible: boolean };
export type Enlazada = Persona & { confirmado: string; confirmado_por: string | null; empleado: Ficha; conductor: Ficha | null };
export type RespuestaVinculos = { pendientes: Pendiente[]; enlazadas: Enlazada[]; consultado: string; origen: string };

/** Se puede elegir: está activa en Odoo y no la tiene otra persona de la app (servicios/organizacion.py, `elegible`,
 *  lo vuelve a comprobar al confirmar). */
export const elegible = (c: Candidato) => c.disponible && !c.ocupada;
