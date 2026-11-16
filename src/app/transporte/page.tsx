import Link from "next/link";
import OrigenDato from "../OrigenDato";
import Cabecera from "../Cabecera";
import { conPermiso } from "@/lib/usuario";
import { llamarPythonDetalle } from "@/lib/python";

export const dynamic = "force-dynamic";
export const metadata = { title: "Chóferes y vehículos · Grupo Trimodos" };
type Catalogo = {
  vehiculos: { id: number; matricula: string; modelo: string; empresa: string; conductor: string }[];
  choferes: { id: number; nombre: string; empresa: string }[];
  limitado: boolean; incluye_externos: boolean;
};

export default async function Transporte({ searchParams }: { searchParams: Promise<{ buscar?: string; externos?: string }> }) {
  const { perfil, puede } = await conPermiso("transporte.ver");
  const parametros = await searchParams;
  const buscar = (typeof parametros.buscar === "string" ? parametros.buscar : "").trim().slice(0, 100);
  const externos = parametros.externos === "1" && puede("transporte.externos");
  const { datos, error } = await llamarPythonDetalle<Catalogo>(`/api/flota/catalogo-odoo?buscar=${encodeURIComponent(buscar)}&externos=${externos}`, { espera: 25000 });
  return <>
    <Cabecera nombre={perfil.nombre || perfil.codigo || ""} />
    <main className="contenido">
      <div className="pagina-titulo"><h1>Chóferes y vehículos</h1>
        <p>{externos ? "Catálogo de transporte: incluye colaboradores externos. No representa la plantilla." : "Vehículos marcados como propios en Odoo y su conductor asignado."}</p></div>
      {puede("transporte.externos") && <nav className="chips" aria-label="Ámbito de transporte">
        <Link className="btn" href="/transporte">Flota propia</Link>
        <Link className="btn" href="/transporte?externos=1">Catálogo con externos</Link>
      </nav>}
      <form className="panel" action="/transporte">
        {externos && <input type="hidden" name="externos" value="1" />}
        <label htmlFor="buscar">{externos ? "Buscar por matrícula o nombre de contacto conductor" : "Buscar por matrícula"}</label>
        <input id="buscar" name="buscar" defaultValue={buscar} maxLength={100} />
        <button className="btn primario" type="submit">Buscar</button>
      </form>
      {error && <p className="error" role="alert">{error}</p>}
      {datos && <>
        <OrigenDato fuente="Odoo · Flota y contactos">
          <p>{externos ? "Vehículos activos y contactos marcados como conductores, de las empresas configuradas o compartidos. No se identifica a los empleados por su nombre." : "Vehículos activos marcados como propios, filtrados por su empresa propietaria. El conductor es el asignado en la ficha del vehículo."}</p>
        </OrigenDato>
        {datos.limitado && <p className="aviso">Se muestran hasta 100 registros de cada lista. Busca una matrícula o un nombre para concretar.</p>}
        <section className="panel"><h2>Vehículos ({datos.vehiculos.length})</h2>
          {!datos.vehiculos.length && <p>No hay vehículos activos que coincidan con la consulta.</p>}
          {datos.vehiculos.map(v => <details key={v.id} className="panel">
            <summary>{v.matricula} · {v.modelo}</summary>
            <p>Empresa: {v.empresa}</p><p>Conductor: {v.conductor}</p>
          </details>)}
        </section>
        {datos.incluye_externos && <section className="panel"><h2>Contactos conductores ({datos.choferes.length})</h2>
          {!datos.choferes.length && <p>No hay contactos activos marcados como conductores en Odoo.</p>}
          {datos.choferes.map(c => <article key={c.id} className="panel">
            <h3>{c.nombre}</h3><p>Empresa: {c.empresa}</p>
          </article>)}
        </section>}
      </>}
    </main>
  </>;
}
