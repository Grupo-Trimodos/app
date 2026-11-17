import Link from "next/link";
import Cabecera from "../Cabecera";
import { conPermiso } from "@/lib/usuario";
import { anadirPersona, archivarEquipo, cambiarEquipo, crearEquipo, quitarPersona } from "./acciones";
import "./equipos.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Equipos · Grupo Trimodos" };

type Equipo = { id: number; nombre: string; descripcion: string | null; activo: boolean; creado_por: string | null };
type Persona = { id: string; nombre: string | null };

/** Equipos: grupos de trabajo que crean los responsables con personas de cualquier centro o zona. Solo organizan: no
 *  dan permisos sobre nadie. La base de datos decide qué equipos ve cada uno y quién los gestiona. */
export default async function PaginaEquipos({ searchParams }: {
  searchParams: Promise<{ ok?: string; error?: string; equipo?: string; buscar?: string }>;
}) {
  const { supabase, uid, perfil, puede } = await conPermiso("equipos.ver", "equipos.crear");
  const crear = puede("equipos.crear");
  const administra = puede("admin.usuarios");
  const { ok, error, equipo: abierto, buscar } = await searchParams;

  const { data, error: fallo } = await supabase.from("equipos_trabajo")
    .select("id,nombre,descripcion,activo,creado_por").order("nombre").returns<Equipo[]>();
  const equipos = data ?? [];
  const miembros = new Map(await Promise.all(equipos.map(async (e) => {
    const { data: m } = await supabase.rpc("miembros_equipo", { equipo: e.id });
    return [e.id, (m ?? []) as Persona[]] as const;
  })));
  const gestiona = (e: Equipo) => crear && (e.creado_por === uid || administra);
  const estoy = (e: Equipo) => miembros.get(e.id)?.some((p) => p.id === uid) ?? false;

  // Búsqueda de personas para el equipo abierto (solo quien gestiona ese equipo).
  const elegido = equipos.find((e) => String(e.id) === abierto && e.activo && gestiona(e));
  const texto = (buscar ?? "").trim().slice(0, 60);
  let encontradas: Persona[] = [];
  let falloBusqueda = false;
  if (elegido && texto.length >= 2) {
    const { data: r, error: e } = await supabase.rpc("buscar_personas_equipo", { texto });
    falloBusqueda = !!e;
    const ya = new Set((miembros.get(elegido.id) ?? []).map((p) => p.id));
    encontradas = ((r ?? []) as Persona[]).filter((p) => !ya.has(p.id));
  }

  const activos = equipos.filter((e) => e.activo && (estoy(e) || e.creado_por === uid));
  const otros = equipos.filter((e) => e.activo && !estoy(e) && e.creado_por !== uid);   // solo los ve la administración
  const archivados = equipos.filter((e) => !e.activo);

  const tarjeta = (e: Equipo) => {
    const personas = miembros.get(e.id) ?? [];
    const puedeGestionar = gestiona(e);
    return <section key={e.id} id={`equipo-${e.id}`} className="panel equipo-tarjeta">
      <div className="equipo-titulo">
        <h2>{e.nombre}</h2>
        <span className="etiqueta">{personas.length === 1 ? "1 persona" : `${personas.length} personas`}</span>
        {!e.activo && <span className="etiqueta pronto">Archivado</span>}
        {e.creado_por === uid && <span className="etiqueta ok">Lo creaste tú</span>}
      </div>
      {e.descripcion && <p className="hint">{e.descripcion}</p>}
      {personas.length === 0 ? <p className="hint">Todavía no hay nadie en este equipo.</p> : (
        <ul className="equipo-personas">
          {personas.map((p) => <li key={p.id}>
            <span>{p.nombre || "Sin nombre"}{p.id === uid && <span className="hint"> (tú)</span>}</span>
            {puedeGestionar && <form action={quitarPersona}>
              <input type="hidden" name="equipo_id" value={e.id} />
              <input type="hidden" name="usuario_id" value={p.id} />
              <button className="btn pequeno" aria-label={`Quitar a ${p.nombre || "esta persona"} del equipo`}>Quitar</button>
            </form>}
          </li>)}
        </ul>
      )}

      {puedeGestionar && e.activo && <div className="equipo-anadir">
        <h3>Añadir personas</h3>
        <form method="get" action={`/equipos#equipo-${e.id}`} className="equipo-buscar">
          <input type="hidden" name="equipo" value={e.id} />
          <label htmlFor={`buscar-${e.id}`}>Busca por nombre (al menos 2 letras). Puede ser de cualquier centro o zona.</label>
          <div>
            <input id={`buscar-${e.id}`} name="buscar" type="search" minLength={2} maxLength={60} required
              defaultValue={elegido?.id === e.id ? texto : ""} placeholder="Ej.: García" autoComplete="off" />
            <button className="btn">Buscar</button>
          </div>
        </form>
        {elegido?.id === e.id && texto.length >= 2 && (falloBusqueda
          ? <p className="error" role="alert">No se ha podido buscar. Inténtalo de nuevo.</p>
          : encontradas.length === 0 ? <p className="hint">No hay nadie más con ese nombre.</p>
          : <ul className="equipo-personas">
            {encontradas.map((p) => <li key={p.id}>
              <span>{p.nombre}</span>
              <form action={anadirPersona}>
                <input type="hidden" name="equipo_id" value={e.id} />
                <input type="hidden" name="usuario_id" value={p.id} />
                <button className="btn primario pequeno">Añadir</button>
              </form>
            </li>)}
          </ul>)}
        {elegido?.id === e.id && <Link href={`/equipos#equipo-${e.id}`} className="btn pequeno" style={{ marginTop: 10 }}>Cerrar la búsqueda</Link>}
      </div>}

      {puedeGestionar && <details className="equipo-ajustes">
        <summary>Cambiar nombre o archivar</summary>
        {e.activo && <form action={cambiarEquipo}>
          <input type="hidden" name="equipo_id" value={e.id} />
          <label htmlFor={`nombre-${e.id}`}>Nombre</label>
          <input id={`nombre-${e.id}`} name="nombre" required minLength={2} maxLength={80} defaultValue={e.nombre} />
          <label htmlFor={`descripcion-${e.id}`}>Para qué es (opcional)</label>
          <input id={`descripcion-${e.id}`} name="descripcion" maxLength={200} defaultValue={e.descripcion ?? ""} />
          <button className="btn primario ancho" style={{ marginTop: 14 }}>Guardar</button>
        </form>}
        <form action={archivarEquipo} style={{ marginTop: 14 }}>
          <input type="hidden" name="equipo_id" value={e.id} />
          <input type="hidden" name="activo" value={e.activo ? "false" : "true"} />
          {e.activo && <p className="hint">Al archivarlo, sus personas dejan de verlo. No se borra: puedes recuperarlo.</p>}
          <button className="btn ancho">{e.activo ? "Archivar equipo" : "Recuperar equipo"}</button>
        </form>
      </details>}
    </section>;
  };

  return (
    <>
      <Cabecera nombre={perfil.nombre || perfil.email || ""} />
      <main className="contenido estrecho">
        <h1>Equipos</h1>
        <p className="hint">Grupos de trabajo con personas de cualquier centro o zona. Sirven para organizaros; no dan
          permiso para aprobar, corregir ni ver los fichajes de nadie.</p>
        {ok && <p className="aviso" role="status">{ok}</p>}
        {error && <p className="error" role="alert">{error}</p>}
        {fallo && <p className="error" role="alert">No se han podido consultar los equipos. Recarga la página.</p>}

        {crear && <section className="panel">
          <h2>Crear un equipo</h2>
          <form action={crearEquipo}>
            <label htmlFor="nombre">Nombre del equipo</label>
            <input id="nombre" name="nombre" required minLength={2} maxLength={80} placeholder="Ej.: Muelle de noche" />
            <label htmlFor="descripcion">Para qué es (opcional)</label>
            <input id="descripcion" name="descripcion" maxLength={200} placeholder="Ej.: Carga y descarga del turno de noche" />
            <button className="btn primario grande ancho" style={{ marginTop: 14 }}>Crear equipo</button>
          </form>
          <p className="hint" style={{ marginTop: 10 }}>Entrarás en el equipo y después podrás añadir a las demás personas.</p>
        </section>}

        {!fallo && activos.length === 0 && <section className="panel">
          <p>{crear ? "Todavía no tienes ningún equipo. Crea el primero arriba." : "Todavía no estás en ningún equipo. Te añadirá tu responsable."}</p>
        </section>}
        {activos.map(tarjeta)}

        {otros.length > 0 && <>
          <h2 className="equipo-seccion">Otros equipos <span className="hint">(los ves por administración)</span></h2>
          {otros.map(tarjeta)}
        </>}

        {archivados.length > 0 && <details className="equipo-archivados">
          <summary>Equipos archivados ({archivados.length})</summary>
          {archivados.map(tarjeta)}
        </details>}
      </main>
    </>
  );
}
