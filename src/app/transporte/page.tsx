import Link from "next/link";
import VistaTransporte from "./VistaTransporte";
import type { Catalogo } from "./tipos";
import "../datos.css";
import Cabecera from "../Cabecera";
import { conPermiso } from "@/lib/usuario";
import { llamarPythonDetalle } from "@/lib/python";

export const dynamic = "force-dynamic";
export const metadata = { title: "Chóferes y vehículos · Grupo Trimodos" };
export default async function Transporte({ searchParams }: { searchParams: Promise<{ buscar?: string; externos?: string }> }) {
  const { perfil, puede } = await conPermiso("transporte.ver");
  const parametros = await searchParams;
  const buscar = (typeof parametros.buscar === "string" ? parametros.buscar : "").trim().slice(0, 100);
  const externos = parametros.externos === "1" && puede("transporte.externos");
  const { datos, error } = await llamarPythonDetalle<Catalogo>(`/api/flota/catalogo-odoo?buscar=${encodeURIComponent(buscar)}&externos=${externos}`, { espera: 25000 });
  return <>
    <Cabecera nombre={perfil.nombre || perfil.codigo || ""} />
    <main className="contenido datos-page">
      <div className="datos-cabecera"><span className="datos-ceja">TRANSPORTE</span><h1>Chóferes y vehículos</h1>
        <p>{externos ? "Catálogo de transporte: incluye colaboradores externos. No representa la plantilla." : "Vehículos marcados como propios en Odoo y su conductor asignado."}</p></div>
      {puede("transporte.externos") && <nav className="datos-pestanas datos-ambito" aria-label="Ámbito de transporte">
        <Link aria-current={!externos ? "page" : undefined} href="/transporte">Flota propia</Link>
        <Link aria-current={externos ? "page" : undefined} href="/transporte?externos=1">Catálogo con externos</Link>
      </nav>}
      <form className="datos-panel datos-busqueda-servidor" action="/transporte">
        {externos && <input type="hidden" name="externos" value="1" />}
        <label htmlFor="buscar">{externos ? "Buscar por matrícula o nombre de contacto conductor" : "Buscar por matrícula"}</label>
        <input type="search" placeholder="Escribe para buscar en Odoo…" id="buscar" name="buscar" defaultValue={buscar} maxLength={100} />
        <button className="btn primario" type="submit">Buscar</button>
      </form>
      {error && <p className="error" role="alert">{error}</p>}
      {datos && <VistaTransporte key={`${buscar}-${externos}`} datos={datos} />}
    </main>
  </>;
}
