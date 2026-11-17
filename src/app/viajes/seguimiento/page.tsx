import Link from "next/link";
import Cabecera from "../../Cabecera";
import OrigenDato from "../../OrigenDato";
import { conPermiso } from "@/lib/usuario";
import { llamarPythonDetalle } from "@/lib/python";
import { NOMBRE_ESTADO, fechaHora, horaPaso, type Seguimiento } from "@/lib/viajes";
import Recorrido from "../Recorrido";
import "../viajes.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Seguimiento de viajes · Grupo Trimodos" };

/** Seguimiento para tráfico: las órdenes abiertas de los chóferes de sus centros (Odoo) y el último paso que ha marcado
 *  cada uno en la app. Qué chóferes ve cada uno lo decide la base de datos («viajes.seguimiento» en sus centros). */
export default async function PaginaSeguimiento({ searchParams }: { searchParams: Promise<{ persona?: string }> }) {
  const { perfil, puede } = await conPermiso("viajes.seguimiento");
  const { persona } = await searchParams;
  const { datos, error } = await llamarPythonDetalle<Seguimiento>("/api/chofer/viajes/seguimiento", { espera: 30000 });
  const personas = datos?.personas ?? [];
  const elegida = personas.find((p) => p.id === persona);
  const ordenes = (datos?.ordenes ?? []).filter((o) => !elegida || o.persona.id === elegida.id);
  const conAviso = ordenes.filter((o) => o.aviso).length;

  return <>
    <Cabecera nombre={perfil.nombre || perfil.codigo || ""} />
    <main className="contenido viajes">
      <div className="pagina-titulo"><span className="eyebrow">Tráfico</span><h1>Seguimiento de viajes</h1>
        <p>En qué punto va cada orden de transporte de los chóferes de tus centros.</p></div>
      {puede("viajes.usar") && <p><Link href="/viajes">← Mis viajes</Link></p>}

      {error ? <section className="panel">
        <p className="error" role="alert">No se ha podido cargar el seguimiento. {error}</p>
        <a className="btn" href="/viajes/seguimiento">Volver a intentarlo</a>
      </section> : personas.length === 0 ? <section className="panel">
        <h2>No hay chóferes que seguir</h2>
        <p className="hint">Aquí salen los chóferes de tus centros cuyo enlace con Odoo ya está confirmado
          (Mi equipo → Enlazar con Odoo).</p>
      </section> : <>
        <form className="panel fila-form viajes-filtro" method="get">
          <div><label htmlFor="persona">Chófer</label>
            <select id="persona" name="persona" defaultValue={elegida?.id ?? ""}>
              <option value="">Todos ({personas.length})</option>
              {personas.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select></div>
          <button className="btn">Filtrar</button>
        </form>
        <p className="hint">{ordenes.length === 1 ? "1 orden" : `${ordenes.length} órdenes`}
          {conAviso > 0 && <> · <b className="viaje-aviso">{conAviso} con aviso</b></>}
          {datos?.consultado && <> · consultado a las {horaPaso(datos.consultado)}</>}</p>
        {ordenes.length === 0 ? <section className="panel"><p className="hint">No hay órdenes abiertas en estas fechas.</p></section> :
          <section className="panel viajes-tabla">
            <table>
              <thead><tr><th>Chófer</th><th>Orden</th><th>Recorrido</th><th>Prevista</th><th>Último paso</th></tr></thead>
              <tbody>{ordenes.map((o) => <tr key={`${o.persona.id}-${o.id}`} className={o.aviso ? "con-aviso" : ""}>
                <td><b>{o.persona.nombre}</b></td>
                <td>{o.cliente ?? "Cliente sin indicar"}<br /><small className="hint">{o.nombre}{o.pedido ? ` · ${o.pedido}` : ""}</small></td>
                <td><Recorrido o={o} /></td>
                <td>{o.inicio ? fechaHora(o.inicio) : "Sin fecha"}</td>
                <td>
                  {o.estado ? <span className={`etiqueta ${o.estado === "descargado" ? "ok" : "pronto"}`}>{NOMBRE_ESTADO[o.estado]}</span>
                    : <span className="etiqueta">Sin empezar</span>}
                  {o.momento && <small className="hint"> {horaPaso(o.momento)}</small>}
                  {o.aviso && <p className="viaje-aviso">{o.aviso}</p>}
                  {o.incidencias > 0 && <p className="viaje-aviso">
                    {o.incidencias === 1 ? "1 incidencia" : `${o.incidencias} incidencias`}
                    {o.ultima_incidencia && ` (${horaPaso(o.ultima_incidencia)})`}{o.nota && `: ${o.nota}`}</p>}
                </td>
              </tr>)}</tbody>
            </table>
          </section>}
        {datos?.limitado && <p className="hint">Hay más órdenes de las que caben: filtra por chófer.</p>}
        <OrigenDato fuente="Odoo · Órdenes de transporte y pasos marcados en la app">
          <p>Las órdenes salen de Odoo (emitidas o aprobadas, sin terminar, con inicio previsto desde hace 3 días hasta
            dentro de 14, y las empezadas sin descargar). Los pasos los marca cada chófer en la app y no van a Odoo.</p>
        </OrigenDato>
      </>}
    </main>
  </>;
}
