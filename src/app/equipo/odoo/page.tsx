import Link from "next/link";
import Cabecera from "../../Cabecera";
import OrigenDato from "../../OrigenDato";
import { fecha, hora } from "@/lib/jornada";
import { llamarPythonDetalle } from "@/lib/python";
import { conPermiso } from "@/lib/usuario";
import { confirmarVinculo, deshacerVinculo } from "./acciones";
import { elegible, type Candidato, type Pendiente, type RespuestaVinculos } from "./tipos";
import "./vinculos.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Enlazar con Odoo · Grupo Trimodos" };

/** Datos de la ficha de Odoo para reconocerla: empresa, departamento y puesto. */
function detalle(c: { empresa?: string | null; departamento?: string | null; puesto?: string | null }) {
  return [c.empresa, c.departamento, c.puesto].filter(Boolean).join(" · ") || "Sin empresa ni departamento en Odoo";
}

function Opcion({ nombre, c, marcada }: { nombre: string; c: Candidato; marcada: boolean }) {
  return <label className={`vinculo-opcion ${elegible(c) ? "" : "no-elegible"}`}>
    <input type="radio" name={nombre} value={c.id} required={nombre === "empleado"} defaultChecked={marcada} disabled={!elegible(c)} />
    <span>
      <b>{c.nombre}</b>
      <small>{detalle(c)}</small>
      <span className="vinculo-etiquetas">
        {c.seguro && <span className="etiqueta ok">{c.por === "correo" ? "Coincide su correo" : `Coincide su móvil (acaba en ${c.telefono_fin})`}</span>}
        {c.por === "telefono" && !c.seguro && c.telefono_fin && <span className="etiqueta">Coincide el teléfono (acaba en {c.telefono_fin})</span>}
        {c.por === "correo" && !c.seguro && <span className="etiqueta">Coincide el correo</span>}
        {c.aviso && <span className={`etiqueta ${c.ocupada || !c.disponible ? "mal" : "pronto"}`}>{c.disponible ? c.aviso : "No está activa en Odoo."}</span>}
      </span>
    </span>
  </label>;
}

/** Se marca sola la única ficha segura (su móvil o su correo coincide con una sola ficha libre y el nombre se parece);
 *  si no, hay que elegir. */
const unicaSegura = (lista: Candidato[]) => (lista.filter((c) => c.seguro).length === 1 ? lista.find((c) => c.seguro)!.id : null);

function PorEnlazar({ p }: { p: Pendiente }) {
  const empleado = unicaSegura(p.empleados);
  const conductor = unicaSegura(p.conductores);
  const hayFicha = p.empleados.some(elegible);
  return <article className="panel vinculo-persona">
    <h3>{p.nombre}</h3>
    <p className="hint">{!p.con_pin ? (p.correo ? <>Entra con su cuenta de Microsoft o Google: <b>{p.correo}</b></>
      : "Entra con su cuenta de Microsoft o Google, sin correo guardado: solo se proponen fichas con un nombre parecido.")
      : p.telefono ? <>Móvil que ha dado: <b>{p.telefono}</b></> : "Todavía no ha dado su móvil: solo se proponen fichas con un nombre parecido."}</p>
    {!hayFicha ? <p className="aviso">{p.con_pin
      ? "No hay ninguna ficha libre en Odoo con su móvil ni con un nombre parecido. Revisa su ficha en Odoo o pídele que corrija su móvil en «Mi perfil»."
      : "No hay ninguna ficha libre en Odoo con su correo ni con un nombre parecido. Revisa en Odoo el correo de trabajo de su ficha."}</p>
      : <form action={confirmarVinculo}>
      <input type="hidden" name="persona" value={p.id} />
      <fieldset className="vinculo-grupo">
        <legend>Su ficha de empleado (fichajes y vacaciones)</legend>
        {p.empleados.map((c) => <Opcion key={c.id} nombre="empleado" c={c} marcada={c.id === empleado} />)}
      </fieldset>
      {(p.conductores.length > 0 || p.chofer) && <fieldset className="vinculo-grupo">
        <legend>Su contacto conductor (órdenes de transporte)</legend>
        {p.conductores.map((c) => <Opcion key={c.id} nombre="conductor" c={c} marcada={c.id === conductor} />)}
        <label className="vinculo-opcion">
          <input type="radio" name="conductor" value="" defaultChecked={conductor === null} />
          <span><b>Ninguno</b><small>{p.conductores.length ? "No conduce o no es ninguno de estos." : "No hay ningún contacto conductor parecido en Odoo."}</small></span>
        </label>
      </fieldset>}
      <button className="btn primario ancho grande">Son la misma persona</button>
    </form>}
  </article>;
}

/** «Enlazar con Odoo»: el responsable confirma que cada persona de sus centros es la de su ficha de Odoo. */
export default async function EnlazarOdoo({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { perfil } = await conPermiso("personas.vincular");
  const { ok, error } = await searchParams;
  const { datos, error: fallo } = await llamarPythonDetalle<RespuestaVinculos>("/api/odoo/vinculos/pendientes", { espera: 25000 });

  return <>
    <Cabecera nombre={perfil.nombre || perfil.email || ""} />
    <main className="contenido estrecho vinculos">
      <p className="inicio-antetitulo"><Link href="/equipo">Mi equipo</Link> · ENLAZAR CON ODOO</p>
      <h1>Enlazar con Odoo</h1>
      <p className="lead">Comprueba que cada persona de la app es la misma que su ficha de empleado en Odoo. Cuando lo confirmes,
        sus fichajes y sus vacaciones irán a esa ficha.</p>
      <OrigenDato fuente="Odoo · Empleados y contactos conductores">
        <p>Quien entra con código y PIN da su móvil en la app, y se compara con los teléfonos de empresa de las fichas de Odoo.
          Quien entra con Microsoft o Google no da su móvil: se compara su correo con el de las fichas. Si no coincide ninguno,
          se proponen fichas con un nombre parecido: compruébalas bien. De Odoo solo se enseñan las tres últimas cifras del teléfono.</p>
        <p>Solo salen las personas de tus centros. Una ficha no se puede enlazar con dos personas. Si alguien tiene la jornada
          abierta, su ficha se cambia cuando fiche la salida.</p>
      </OrigenDato>
      {ok && <p className="aviso" role="status">{ok}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {!datos ? <p className="error" role="alert">{fallo ?? "No se ha podido consultar Odoo. Inténtalo de nuevo en un momento."}</p> : <>
        <section aria-labelledby="pendientes-t">
          <h2 id="pendientes-t">Por enlazar ({datos.pendientes.length})</h2>
          {datos.pendientes.length === 0 ? <p className="panel hint">No hay nadie pendiente en tus centros.</p>
            : datos.pendientes.map((p) => <PorEnlazar key={p.id} p={p} />)}
        </section>
        {datos.enlazadas.length > 0 && <section className="panel" aria-labelledby="enlazadas-t">
          <h2 id="enlazadas-t">Ya enlazadas ({datos.enlazadas.length})</h2>
          <ul className="vinculo-lista">{datos.enlazadas.map((e) => <li key={e.id}>
            <div>
              <b>{e.nombre}</b>{(e.telefono ?? e.correo) && <span className="hint"> · {e.telefono ?? e.correo}</span>}
              <small>Ficha: {e.empleado.nombre}{e.empleado.disponible ? ` · ${detalle(e.empleado)}` : ""}
                {!e.empleado.disponible && <span className="etiqueta mal">Revísala en Odoo</span>}</small>
              {e.conductor && <small>Contacto conductor: {e.conductor.nombre}</small>}
              <small className="hint">Confirmado{e.confirmado_por ? ` por ${e.confirmado_por}` : ""} el {fecha(e.confirmado)} a las {hora(e.confirmado)}</small>
            </div>
            <form action={deshacerVinculo}>
              <input type="hidden" name="persona" value={e.id} />
              <button className="btn pequeno">Deshacer</button>
            </form>
          </li>)}</ul>
        </section>}
      </>}
    </main>
  </>;
}
