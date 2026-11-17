import { conPermiso } from "@/lib/usuario";
import { llamarPythonDetalle } from "@/lib/python";
import VistaMapa from "./VistaMapa";
import type { Mapa, Cuenta } from "./tipos";
import "./mapa.css";
export default async function MapaPersonas({ empleado }: { empleado?: number }) {
  const { supabase, puede } = await conPermiso("admin.usuarios");
  // Paginar evita que el límite de Supabase haga parecer que un empleado no tiene cuenta.
  const cuentas: Cuenta[] = [];
  let errorCuentas = false;
  for (let desde = 0; ; desde += 500) {
    const { data, error } = await supabase.from("usuarios")
      .select("id,nombre,codigo,email,activo,odoo_employee_id").order("id").range(desde, desde + 499);
    if (error) { errorCuentas = true; break; }
    cuentas.push(...(data ?? []));
    if (!data || data.length < 500) break;
  }
  const { datos, error } = await llamarPythonDetalle<Mapa>("/api/odoo/mapa-empleados", { espera: 25000 });
  return <>{error && <p className="error" role="alert">{error}</p>}{datos && <VistaMapa datos={datos} cuentas={errorCuentas ? null : cuentas} empleado={empleado} editable={puede("organizacion.editar")} />}</>;
}
