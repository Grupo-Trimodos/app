type Referencia = { id: number; nombre: string } | null;
export type Persona = {
  id: number; nombre: string; empresa: Referencia; zona: Referencia; departamento: Referencia;
  puesto: Referencia; responsable: Referencia; movil: string; telefono: string; correo: string;
  faltan: string[]; completar: string[];
};
export type Mapa = { personas: Persona[]; zonas: {id: number; nombre: string; empresa: string}[]; consultado: string; odoo_url: string };
export type Cuenta = { id: string; nombre: string | null; codigo: string | null; email: string | null; activo: boolean; odoo_employee_id: number | null };
