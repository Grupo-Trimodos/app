import Link from "next/link";
import Cabecera from "../Cabecera";
import MiOrganizacion from "../MiOrganizacion";
import { conPermiso } from "@/lib/usuario";
import { TODOS_LOS_PERMISOS } from "@/lib/permisos";
export const dynamic = "force-dynamic";
export const metadata = { title: "Mi perfil · Grupo Trimodos" };
export default async function MiPerfil() {
  // Cualquier usuario activo con acceso a la app puede consultar SU perfil, nunca elegir otro ID.
  const { perfil } = await conPermiso(...TODOS_LOS_PERMISOS);
  return <><Cabecera nombre={perfil.nombre || perfil.codigo || ""} /><main className="contenido estrecho">
    <Link href="/">← Inicio</Link><header className="pagina-titulo"><span className="eyebrow">MI PERFIL</span><h1>{perfil.nombre || "Mi perfil"}</h1><p>Tu información de trabajo y tu vínculo con el equipo.</p></header>
    <MiOrganizacion abierto />
    <section className="panel"><h2>Tu cuenta de acceso</h2><p>{perfil.codigo ? `Código: ${perfil.codigo}` : perfil.email}</p><p className="hint">El acceso lo gestiona administración. Los datos de trabajo proceden de tu ficha de Odoo.</p></section>
  </main></>;
}
