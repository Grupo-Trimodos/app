import Link from "next/link";
import { redirect } from "next/navigation";
import Cabecera from "../Cabecera";
import Icono from "../Icono";
import OrigenDato from "../OrigenDato";
import { conPermiso } from "@/lib/usuario";
import { llamarPythonDetalle } from "@/lib/python";
import { BOTON_PASO, NOMBRE_ESTADO, enlaceDeca, fechaHora, horaPaso, type MisViajes, type OrdenChofer } from "@/lib/viajes";
import { marcarIncidencia, marcarPaso } from "./acciones";
import BotonPaso from "./BotonPaso";
import Recorrido from "./Recorrido";
import "./viajes.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Mis viajes · Grupo Trimodos" };

function Tarjeta({ o, primera }: { o: OrdenChofer; primera: boolean }) {
  const deca = enlaceDeca(o);
  const datos: [string, string | null][] = [
    ["Fecha prevista", o.inicio ? fechaHora(o.inicio) : null], ["Referencia de carga", o.referencia_carga],
    ["Referencia del cliente", o.referencia_cliente], ["Remolque", o.remolque], ["Pedido", o.pedido],
  ];
  return <section id={`orden-${o.id}`} className={`panel viaje ${primera ? "viaje-primera" : ""}`} aria-labelledby={`orden-${o.id}-t`}>
    <div className="viaje-cabecera">
      <h2 id={`orden-${o.id}-t`}>{o.cliente ?? "Cliente sin indicar"}</h2>
      {o.pasos.length > 0 ? <span className="etiqueta pronto">En curso</span> : <span className="etiqueta">Por empezar</span>}
      {o.empresa_nombre && <span className="etiqueta">{o.empresa_nombre}</span>}
    </div>
    <Recorrido o={o} />
    <dl className="viaje-datos">
      {datos.filter(([, v]) => v).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
      {o.servicio_descarga && <div><dt>Descarga</dt><dd>Con servicio de descarga</dd></div>}
    </dl>

    {o.pasos.length > 0 && <ol className="viaje-tiempo" aria-label="Lo que has marcado">
      {o.pasos.map((p, i) => <li key={i} className={p.estado === "incidencia" ? "incidencia" : ""}>
        <time dateTime={p.momento}>{horaPaso(p.momento)}</time>
        <span>{NOMBRE_ESTADO[p.estado]}{p.nota && <small>{p.nota}</small>}</span>
      </li>)}
    </ol>}

    {o.siguiente && <form action={marcarPaso}>
      <input type="hidden" name="tarea" value={o.id} />
      <input type="hidden" name="estado" value={o.siguiente} />
      <BotonPaso texto={BOTON_PASO[o.siguiente]} clase={`btn ancho grande ${primera ? "primario" : ""}`}
        confirmar={o.siguiente === "descargado" ? "¿Has terminado de descargar? No se puede deshacer." : undefined} />
    </form>}

    <div className="viaje-acciones">
      {deca ? <a className="btn ancho" href={deca}><Icono nombre="documento" size={20} />Abrir en DECA</a> : <>
        <a className="btn ancho" href="/deca/"><Icono nombre="documento" size={20} />Abrir DECA</a>
        <p className="hint">{o.pedido && o.empresa && !o.deca_por_pedido ? `El pedido ${o.pedido} tiene varias órdenes de transporte. ` : ""}En DECA, escanea el
          código QR de esta orden ({o.nombre}) para abrir justo esta.</p>
      </>}
      <details className="viaje-incidencia">
        <summary className="btn ancho"><Icono nombre="aviso" size={20} />Incidencia</summary>
        <form action={marcarIncidencia}>
          <input type="hidden" name="tarea" value={o.id} />
          <label htmlFor={`nota-${o.id}`}>¿Qué ha pasado?</label>
          <textarea id={`nota-${o.id}`} name="nota" required maxLength={200} rows={3}
            placeholder="Ej.: la carga no está lista, retraso en el muelle, he marcado un paso por error…" />
          <BotonPaso texto="Enviar incidencia" clase="btn ancho primario" />
        </form>
      </details>
    </div>
  </section>;
}

/** «Mis viajes»: las órdenes de transporte que le han llegado al chófer (Odoo) y los pasos que marca (solo en la app). */
export default async function PaginaViajes({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { perfil, puede } = await conPermiso("viajes.usar", "viajes.seguimiento");
  if (!puede("viajes.usar")) redirect("/viajes/seguimiento");
  const { ok, error } = await searchParams;
  const { datos, error: fallo } = await llamarPythonDetalle<MisViajes>("/api/chofer/viajes", { espera: 25000 });
  const activas = datos?.ordenes.filter((o) => !o.terminado) ?? [];
  const terminadas = datos?.ordenes.filter((o) => o.terminado) ?? [];

  return <>
    <Cabecera nombre={perfil.nombre || perfil.codigo || ""} />
    <main className="contenido estrecho viajes">
      <div className="pagina-titulo"><span className="eyebrow">En carretera</span><h1>Mis viajes</h1>
        <p>Tus órdenes de transporte. Marca cuándo llegas, cargas y descargas.</p></div>
      {ok && <p className="aviso" role="status">{ok}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {puede("viajes.seguimiento") && <p><Link href="/viajes/seguimiento">Ver el seguimiento de todos los viajes →</Link></p>}

      {fallo ? <section className="panel">
        <p className="error" role="alert">No se han podido cargar tus viajes. {fallo}</p>
        <p className="hint">Si estás sin cobertura, espera a tenerla y vuelve a intentarlo.</p>
        <a className="btn ancho grande" href="/viajes">Volver a intentarlo</a>
      </section> : !datos?.enlazado ? <section className="panel">
        <h2>Todavía no puedes ver tus viajes</h2>
        <p>{datos?.aviso ?? "Tu encargado tiene que confirmar tu ficha de Odoo."}</p>
        <p className="hint">Si aún no lo has hecho, guarda tu móvil en la pantalla de inicio para que pueda encontrarte.</p>
      </section> : <>
        {activas.length === 0 && <section className="panel">
          <h2>No tienes viajes pendientes</h2>
          <p className="hint">Aquí aparecen las órdenes de transporte en cuanto la oficina las emite en Odoo.</p>
        </section>}
        {activas.map((o, i) => <Tarjeta key={o.id} o={o} primera={i === 0} />)}
        {datos.limitado && <p className="hint">Se muestran tus {datos.ordenes.length} órdenes más próximas.</p>}
        {terminadas.length > 0 && <details className="panel viaje-terminados">
          <summary>Descargados ({terminadas.length})</summary>
          <ul>{terminadas.map((o) => <li key={o.id}>
            <b>{o.cliente ?? "Cliente sin indicar"}</b>
            <span>{o.origen ?? "—"} → {o.destino ?? "—"}</span>
            <small>Descargado {horaPaso(o.pasos.filter((p) => p.estado === "descargado").at(-1)?.momento ?? o.pasos.at(-1)!.momento)}</small>
          </li>)}</ul>
        </details>}
        <OrigenDato fuente="Odoo · Órdenes de transporte">
          <p>Las órdenes salen de Odoo en cuanto se emiten o se aprueban. Lo que marcas aquí (llegada, carga, descarga e
            incidencias) se guarda solo en la app; no cambia nada en Odoo.</p>
        </OrigenDato>
      </>}
    </main>
  </>;
}
