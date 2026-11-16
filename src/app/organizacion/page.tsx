import Cabecera from "../Cabecera";
import VistaOrganizacion from "./VistaOrganizacion";
import type { Estructura } from "./tipos";
import { conPermiso } from "@/lib/usuario";
import { llamarPythonDetalle } from "@/lib/python";
import "../datos.css";
export const dynamic = "force-dynamic";
export const metadata = { title: "Organización · Grupo Trimodos" };
export default async function Organizacion() {
  const { perfil } = await conPermiso("organizacion.ver");
  const { datos, error } = await llamarPythonDetalle<Estructura>("/api/odoo/organizacion", { espera: 25000 });
  return <><Cabecera nombre={perfil.nombre || perfil.codigo || ""} /><main className="contenido datos-page">
    <header className="datos-cabecera"><span className="datos-ceja">PERSONAS Y CENTROS</span><h1>Organización</h1><p>Una visión clara de cómo se distribuye el equipo.</p></header>
    {error && <p className="error" role="alert">{error}</p>}
    {datos && <VistaOrganizacion datos={datos} />}
  </main></>;
}
