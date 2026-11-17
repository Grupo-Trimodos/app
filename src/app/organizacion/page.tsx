import Link from "next/link";
import MapaPersonas from "./mapa/MapaPersonas";
import Cabecera from "../Cabecera";
import VistaOrganizacion from "./VistaOrganizacion";
import type { Estructura } from "./tipos";
import { conPermiso } from "@/lib/usuario";
import { llamarPythonDetalle } from "@/lib/python";
import "../datos.css";
export const dynamic = "force-dynamic";
export const metadata = { title: "Organización · Grupo Trimodos" };
export default async function Organizacion({ searchParams }: { searchParams: Promise<{ver?: string; empleado?: string}> }) {
  const sp = await searchParams;
  const { perfil, puede } = await conPermiso("organizacion.ver", "admin.usuarios");
  const mapa = puede("admin.usuarios") && (sp.ver !== "estructura" || !puede("organizacion.ver"));
  const { datos, error } = mapa ? {datos:null, error:null} : await llamarPythonDetalle<Estructura>("/api/odoo/organizacion", { espera: 25000 });
  return <><Cabecera nombre={perfil.nombre || perfil.codigo || ""} /><main className="contenido datos-page">
    <header className="datos-cabecera"><span className="datos-ceja">PERSONAS Y CENTROS</span><h1>Organización</h1><p>Una visión clara de cómo se distribuye el equipo.</p></header>
    {puede("admin.usuarios") && puede("organizacion.ver") && <nav className="datos-pestanas"><Link href="/organizacion" aria-current={mapa ? "page" : undefined}>Personas y zonas</Link><Link href="/organizacion?ver=estructura" aria-current={!mapa ? "page" : undefined}>Estructura y recuentos</Link></nav>}
    {mapa && <MapaPersonas empleado={Number(sp.empleado) || undefined} />}
    {error && <p className="error" role="alert">{error}</p>}
    {datos && <VistaOrganizacion datos={datos} />}
  </main></>;
}
