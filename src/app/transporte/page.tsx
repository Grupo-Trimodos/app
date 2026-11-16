import Cabecera from "../Cabecera";
import { conPermiso } from "@/lib/usuario";
import { llamarPythonDetalle } from "@/lib/python";

export const dynamic = "force-dynamic";
export const metadata = { title: "Chóferes y vehículos · Grupo Trimodos" };
type Catalogo = {
  vehiculos: { id: number; matricula: string; modelo: string; empresa: string; conductor: string }[];
  choferes: { id: number; nombre: string; empresa: string }[];
  limitado: boolean;
};

export default async function Transporte({ searchParams }: { searchParams: Promise<{ buscar?: string }> }) {
  const { perfil } = await conPermiso("transporte.ver");
  const parametros = await searchParams;
  const buscar = (typeof parametros.buscar === "string" ? parametros.buscar : "").trim().slice(0, 100);
  const { datos, error } = await llamarPythonDetalle<Catalogo>(`/api/flota/catalogo-odoo?buscar=${encodeURIComponent(buscar)}`, { espera: 25000 });
  return <>
    <Cabecera nombre={perfil.nombre || perfil.codigo || ""} />
    <main className="contenido">
      <div className="pagina-titulo"><h1>Chóferes y vehículos</h1>
        <p>Datos actuales de Odoo. Las correcciones se realizan en Odoo.</p></div>
      <form className="panel" action="/transporte">
        <label htmlFor="buscar">Buscar por matrícula o nombre de chófer</label>
        <input id="buscar" name="buscar" defaultValue={buscar} maxLength={100} />
        <button className="btn primario" type="submit">Buscar</button>
      </form>
      {error && <p className="error" role="alert">{error}</p>}
      {datos && <>
        {datos.limitado && <p className="aviso">Se muestran hasta 100 registros de cada lista. Busca una matrícula o un nombre para concretar.</p>}
        <section className="panel"><h2>Vehículos ({datos.vehiculos.length})</h2>
          {!datos.vehiculos.length && <p>No hay vehículos activos que coincidan con la consulta.</p>}
          {datos.vehiculos.map(v => <details key={v.id} className="panel">
            <summary>{v.matricula} · {v.modelo}</summary>
            <p>Empresa: {v.empresa}</p><p>Conductor: {v.conductor}</p>
          </details>)}
        </section>
        <section className="panel"><h2>Chóferes ({datos.choferes.length})</h2>
          {!datos.choferes.length && <p>No hay contactos activos marcados como conductores en Odoo.</p>}
          {datos.choferes.map(c => <article key={c.id} className="panel">
            <h3>{c.nombre}</h3><p>Empresa: {c.empresa}</p>
          </article>)}
        </section>
      </>}
    </main>
  </>;
}
