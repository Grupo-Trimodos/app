import Link from "next/link";
import Cabecera from "../../Cabecera";
import { conPermiso } from "@/lib/usuario";
import { llamarPythonDetalle } from "@/lib/python";
import VistaMapa from "./VistaMapa";
import type { Mapa, Cuenta } from "./tipos";
import "../../datos.css";
import "./mapa.css";
export const dynamic = "force-dynamic";
export const metadata = { title: "Mapa de personas · Grupo Trimodos" };
export default async function MapaPersonas() {
  const { supabase, perfil } = await conPermiso("admin.usuarios");
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
  return <><Cabecera nombre={perfil.nombre || perfil.codigo || ""} /><main className="contenido datos-page">
    <header className="datos-cabecera"><Link href="/admin">← Administración</Link><span className="datos-ceja">PERSONAS · REVISIÓN DE CUENTAS</span><h1>El equipo, zona a zona</h1><p>Localiza a cada persona, revisa su ficha y comprueba su acceso a la app.</p></header>
    {error && <p className="error" role="alert">{error}</p>}
    {datos && <VistaMapa datos={datos} cuentas={errorCuentas ? null : cuentas} />}
  </main></>;
}
