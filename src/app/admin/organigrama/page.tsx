import Link from "next/link";
import Cabecera from "../../Cabecera";
import OrigenDato from "../../OrigenDato";
import { AREAS, NOMBRE_PANTALLA, RANGO_PANTALLA, type Pantalla } from "@/lib/permisos";
import { conPermiso } from "@/lib/usuario";
import { anadirFicha, aplicarAhora, cambiarInterruptor, guardarPuesto, quitarFicha } from "./acciones";

export const dynamic = "force-dynamic";
export const metadata = { title: "Perfiles por organigrama · Grupo Trimodos" };

type Fila = {
  empleado_id: number; nombre: string; empresa: string | null; departamento: string | null; puesto: string | null;
  gerente_id: number | null; gerente: string | null; usuario_id: string | null; persona: string | null; ficha_principal: boolean | null;
  perfiles_odoo: string[]; perfiles_actuales: string[]; a_cargo: number; debajo_en_odoo: number; sin_perfil: boolean;
};
type PerfilApp = { id: number; nombre: string; permisos: string[]; pantalla: Pantalla | null; alcance_odoo: string | null; todos_los_centros: boolean };
type Busqueda = { ver?: string; q?: string; ficha?: string; ok?: string; error?: string };

const fechaHora = (iso: string) => new Date(iso).toLocaleString("es-ES", { timeZone: "Europe/Madrid", dateStyle: "short", timeStyle: "short" });
const normal = (t: string | null) => (t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const ultimoTramo = (d: string | null) => (d ?? "").split(" / ").slice(-2).join(" / ") || "Sin departamento";

/** Fichas que cuelgan de una persona, en cascada, siguiendo también sus otras fichas (igual que la base de datos). */
function debajoDe(filas: Fila[], usuario: string | null, ficha: number): Fila[] {
  const hijos = new Map<number, Fila[]>();
  for (const f of filas) if (f.gerente_id) hijos.set(f.gerente_id, [...(hijos.get(f.gerente_id) ?? []), f]);
  const fichasDe = (u: string | null, e: number) => (u ? filas.filter((f) => f.usuario_id === u).map((f) => f.empleado_id) : [e]);
  const vistos = new Set<number>(fichasDe(usuario, ficha));
  const cola = [...vistos];
  const fuera: Fila[] = [];
  while (cola.length) {
    for (const h of hijos.get(cola.shift()!) ?? []) {
      if (vistos.has(h.empleado_id)) continue;
      vistos.add(h.empleado_id);
      if (!usuario || h.usuario_id !== usuario) fuera.push(h);
      for (const otra of fichasDe(h.usuario_id, h.empleado_id)) if (!vistos.has(otra)) { vistos.add(otra); cola.push(otra); }
      cola.push(h.empleado_id);
    }
  }
  return fuera;
}

export default async function Organigrama({ searchParams }: { searchParams: Promise<Busqueda> }) {
  const { supabase, perfil } = await conPermiso("admin.usuarios");
  const sp = await searchParams;
  const vista = ["puestos", "fichas"].includes(sp.ver ?? "") ? sp.ver! : sp.ficha ? "persona" : "personas";
  const [{ data: ajustes }, { data: foto }, { data: previa, error: fallo }, { data: puestos }, { data: perfiles }, { data: extras }, { data: personas }] =
    await Promise.all([
      supabase.from("organigrama_ajustes").select("aplicar,cambiado").maybeSingle<{ aplicar: boolean; cambiado: string }>(),
      supabase.from("organigrama_fotos").select("tomada,fichas").order("id", { ascending: false }).limit(1).maybeSingle<{ tomada: string; fichas: number }>(),
      supabase.rpc("vista_previa_organigrama"),
      supabase.from("puestos_perfil").select("puesto,perfil_id").returns<{ puesto: string; perfil_id: number }[]>(),
      supabase.from("perfiles").select("id,nombre,permisos,pantalla,alcance_odoo,todos_los_centros").order("nombre").returns<PerfilApp[]>(),
      supabase.from("usuario_fichas_extra").select("empleado_id,usuario_id,usuarios!usuario_fichas_extra_usuario_id_fkey(nombre,codigo)")
        .returns<{ empleado_id: number; usuario_id: string; usuarios: { nombre: string; codigo: string | null } | null }[]>(),
      supabase.from("usuarios").select("id,nombre,codigo,email").eq("activo", true).order("nombre")
        .returns<{ id: string; nombre: string; codigo: string | null; email: string | null }[]>(),
    ]);
  const filas = (previa ?? []) as Fila[];
  const sinMigracion = !!fallo && !filas.length;
  const perfilPorNombre = new Map((perfiles ?? []).map((p) => [p.nombre, p]));
  const perfilPorId = new Map((perfiles ?? []).map((p) => [p.id, p]));
  const mapa = new Map((puestos ?? []).map((p) => [p.puesto, p.perfil_id]));
  const listaPuestos = [...new Set(filas.map((f) => f.puesto?.trim()).filter((p): p is string => !!p))]
    .map((p) => ({ nombre: p, clave: p.toLowerCase(), personas: filas.filter((f) => f.puesto?.trim() === p).length }))
    .sort((a, b) => b.personas - a.personas || a.nombre.localeCompare(b.nombre));
  const conCuenta = filas.filter((f) => f.usuario_id);
  const responsables = new Set(filas.filter((f) => f.debajo_en_odoo > 0).map((f) => f.usuario_id ?? `f${f.empleado_id}`)).size;
  const sinPerfil = filas.filter((f) => f.sin_perfil).length;
  const distintos = conCuenta.filter((f) => f.ficha_principal && f.perfiles_odoo.join() !== f.perfiles_actuales.join()).length;
  const q = normal(sp.q ?? "");
  const visibles = q ? filas.filter((f) => normal(`${f.nombre} ${f.puesto} ${f.departamento} ${f.persona} ${f.gerente}`).includes(q)) : filas;
  const porDepartamento = new Map<string, Fila[]>();
  for (const f of visibles) {
    const d = f.departamento ?? "Sin departamento";
    porDepartamento.set(d, [...(porDepartamento.get(d) ?? []), f]);
  }
  const elegida = sp.ficha ? filas.find((f) => String(f.empleado_id) === sp.ficha) : undefined;

  return <>
    <Cabecera nombre={perfil.nombre || perfil.email || ""} />
    <main className="contenido">
      <p><Link href="/admin">← Administración</Link></p>
      <h1>Perfiles por organigrama</h1>
      <p className="lead">El organigrama de Odoo decide qué ve cada persona: el <b>puesto</b> de su ficha le da el perfil, y su
        <b> gerente</b> dice quién está a cargo de quién. Un responsable ve y aprueba a toda la gente que cuelga de él, en cascada.
        Para cambiar a alguien de sitio, se cambia en Odoo; la app lo recoge en la siguiente sincronización.</p>
      {sp.ok && <p className="aviso" role="status">{sp.ok}</p>}
      {sp.error && <p className="error" role="alert">{sp.error}</p>}
      {sinMigracion && <p className="error" role="alert">Falta aplicar la migración del organigrama en la base de datos.</p>}

      <OrigenDato fuente="Odoo · Empleados (foto diaria, solo lectura)">
        <p>Cada sincronización guarda una foto del organigrama: puesto, departamento, gerente y ubicación de cada ficha. De Odoo
          solo se lee. Si un dato está mal, se corrige en Odoo y la siguiente foto lo recoge.</p>
      </OrigenDato>

      <section className="panel">
        <h2>{ajustes?.aplicar ? "Encendido" : "Apagado"}</h2>
        <p>{ajustes?.aplicar
          ? "Cada sincronización pone a cada persona los perfiles de su puesto y el de Responsable si tiene gente a su cargo. Lo puesto a mano no se toca."
          : "Mientras esté apagado, nadie gana ni pierde perfiles: revisa la vista previa de abajo y enciéndelo cuando esté bien."}</p>
        <p className="hint">Última foto: {foto ? `${fechaHora(foto.tomada)} · ${foto.fichas} fichas` : "ninguna todavía (lanza la sincronización con Odoo)"}.</p>
        <div className="chips">
          <form action={cambiarInterruptor}>
            <input type="hidden" name="aplicar" value={ajustes?.aplicar ? "no" : "si"} />
            <button className={`btn ${ajustes?.aplicar ? "" : "primario"} grande`}>{ajustes?.aplicar ? "Apagar" : "Encender y aplicar"}</button>
          </form>
          {ajustes?.aplicar && <form action={aplicarAhora}><button className="btn grande">Aplicar ahora</button></form>}
          <Link className="btn grande" href="/admin/sincronizacion">Sincronización con Odoo</Link>
        </div>
      </section>

      <div className="cifras">
        <div className="panel"><b>{filas.length}</b><span>Fichas en Odoo</span></div>
        <div className="panel"><b>{conCuenta.length}</b><span>Con cuenta en la app</span></div>
        <div className="panel"><b>{responsables}</b><span>Responsables (tienen gente a su cargo)</span></div>
        <div className="panel"><b>{sinPerfil}</b><span>Fichas con un puesto que no da perfil</span></div>
        <div className="panel"><b>{distintos}</b><span>Personas a las que cambiaría el perfil</span></div>
      </div>

      <nav className="pestanas" aria-label="Secciones">
        {[["personas", "Personas"], ["puestos", "Puesto → perfil"], ["fichas", "Varias fichas"]].map(([id, nombre]) =>
          <Link key={id} href={`/admin/organigrama${id === "personas" ? "" : `?ver=${id}`}`} className={vista === id ? "activa" : ""}
            aria-current={vista === id ? "page" : undefined}>{nombre}</Link>)}
      </nav>

      {vista === "persona" && elegida && <VerComo f={elegida} filas={filas} perfiles={perfilPorNombre} />}
      {vista === "persona" && !elegida && <p className="error">No se encuentra esa ficha en la última foto.</p>}

      {vista === "personas" && <>
        <form className="chips" style={{ margin: "8px 0 16px" }}>
          <input name="q" defaultValue={sp.q ?? ""} placeholder="Buscar persona, puesto o departamento" aria-label="Buscar" />
          <button className="btn">Buscar</button>
        </form>
        <p className="hint">Toca un nombre para ver la app como esa persona: su pantalla, su menú y a quién tiene a su cargo.</p>
        {[...porDepartamento.entries()].map(([dep, gente]) => <section key={dep} className="panel">
          <h2 style={{ fontSize: 17 }}>{dep}</h2>
          <div className="cm-tabla-caja"><table className="admin-personas">
            <thead><tr><th>Ficha de Odoo</th><th>Puesto</th><th>Gerente</th><th>Persona en la app</th><th>Perfiles según Odoo</th><th>A su cargo</th></tr></thead>
            <tbody>{gente.map((f) => <tr key={f.empleado_id}>
              <td><Link href={`/admin/organigrama?ficha=${f.empleado_id}`}>{f.nombre}</Link><br /><span className="hint">{f.empresa}</span></td>
              <td>{f.puesto ?? <span className="etiqueta mal">Sin puesto</span>}{f.puesto && f.sin_perfil && <><br /><span className="etiqueta mal">No da perfil</span></>}</td>
              <td>{f.gerente ?? "—"}</td>
              <td>{f.persona ?? <span className="etiqueta">Sin cuenta</span>}{f.usuario_id && !f.ficha_principal && <><br /><span className="etiqueta">Segunda ficha</span></>}</td>
              <td>{f.perfiles_odoo.length ? f.perfiles_odoo.join(", ") : "—"}
                {f.usuario_id && f.ficha_principal && f.perfiles_odoo.join() !== f.perfiles_actuales.join() &&
                  <><br /><span className="hint">Ahora: {f.perfiles_actuales.join(", ") || "ninguno"}</span></>}</td>
              <td>{f.debajo_en_odoo || "—"}</td>
            </tr>)}</tbody>
          </table></div>
        </section>)}
      </>}

      {vista === "puestos" && <section className="panel">
        <h2>Qué perfil da cada puesto de Odoo</h2>
        <p className="hint">Los puestos se emparejan por su nombre (en Odoo hay puestos repetidos en cada empresa). Elegir «Ninguno»
          deja ese puesto sin perfil. Los cambios se notan al aplicar.</p>
        <div className="cm-tabla-caja"><table>
          <thead><tr><th>Puesto en Odoo</th><th>Fichas</th><th>Perfil en la app</th></tr></thead>
          <tbody>{listaPuestos.map((p) => <tr key={p.clave}>
            <td>{p.nombre}</td><td>{p.personas}</td>
            <td><form action={guardarPuesto} className="chips">
              <input type="hidden" name="puesto" value={p.clave} />
              <select name="perfil" defaultValue={mapa.get(p.clave) ?? ""} aria-label={`Perfil de ${p.nombre}`}>
                <option value="">Ninguno</option>
                {(perfiles ?? []).filter((x) => x.nombre !== "Responsable").map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}
              </select>
              <button className="btn pequeno">Guardar</button>
            </form></td>
          </tr>)}</tbody>
        </table></div>
        <p className="hint">«Responsable» no se elige aquí: lo tiene sola quien es gerente de alguien en Odoo.
          {[...mapa.entries()].filter(([k]) => !listaPuestos.some((p) => p.clave === k)).length > 0 &&
            ` También hay puestos guardados que hoy no tiene nadie: ${[...mapa.entries()].filter(([k]) => !listaPuestos.some((p) => p.clave === k))
              .map(([k, v]) => `${k} → ${perfilPorId.get(v)?.nombre ?? "?"}`).join(", ")}.`}</p>
      </section>}

      {vista === "fichas" && <section className="panel">
        <h2>Personas con varias fichas</h2>
        <p className="hint">Quien trabaja para dos empresas tiene una ficha en cada una. Aquí se añade la segunda: cuenta para el
          organigrama y para lo que ve (lo que cuelga de cualquiera de sus fichas es suyo). Los fichajes y las ausencias siguen
          yendo a su ficha principal. Solo por el número de ficha: un nombre parecido no prueba que sea la misma persona.</p>
        {(extras ?? []).length > 0 && <ul>
          {(extras ?? []).map((x) => {
            const ficha = filas.find((f) => f.empleado_id === x.empleado_id);
            return <li key={x.empleado_id} className="chips" style={{ alignItems: "center" }}>
              <span><b>{x.usuarios?.nombre || x.usuarios?.codigo}</b>: ficha {x.empleado_id}{ficha ? ` (${ficha.nombre}, ${ficha.empresa})` : " (no está en la última foto)"}</span>
              <form action={quitarFicha}><input type="hidden" name="empleado" value={x.empleado_id} /><button className="btn pequeno">Quitar</button></form>
            </li>;
          })}
        </ul>}
        <form action={anadirFicha} className="chips">
          <select name="persona" required aria-label="Persona" defaultValue="">
            <option value="" disabled>Persona de la app…</option>
            {(personas ?? []).map((p) => <option key={p.id} value={p.id}>{p.nombre || p.codigo || p.email}</option>)}
          </select>
          <select name="empleado" required aria-label="Segunda ficha" defaultValue="">
            <option value="" disabled>Su otra ficha de Odoo…</option>
            {filas.filter((f) => !f.usuario_id).map((f) => <option key={f.empleado_id} value={f.empleado_id}>{f.nombre} · {f.empresa} · ficha {f.empleado_id}</option>)}
          </select>
          <button className="btn primario">Añadir</button>
        </form>
      </section>}
    </main>
  </>;
}

/** «Ver la app como…»: pantalla, menú y gente a cargo que tendría esta persona con los perfiles que le da Odoo. */
function VerComo({ f, filas, perfiles }: { f: Fila; filas: Fila[]; perfiles: Map<string, PerfilApp> }) {
  const suyos = f.usuario_id ? [...new Set(filas.filter((x) => x.usuario_id === f.usuario_id).flatMap((x) => x.perfiles_odoo))] : f.perfiles_odoo;
  const ps = suyos.map((n) => perfiles.get(n)).filter((p): p is PerfilApp => !!p);
  const permisos = new Set(ps.flatMap((p) => p.permisos));
  const pantallas = ps.map((p) => p.pantalla).filter((p): p is Pantalla => !!p);
  const pantalla = pantallas.length ? pantallas.reduce((a, b) => (RANGO_PANTALLA[b] > RANGO_PANTALLA[a] ? b : a)) : null;
  const areas = AREAS.filter((a) => a.permisos.some((p) => permisos.has(p.id)));
  const abajo = debajoDe(filas, f.usuario_id, f.empleado_id);
  const directos = abajo.filter((x) => filas.some((m) => m.empleado_id === x.gerente_id && (m.empleado_id === f.empleado_id || (f.usuario_id && m.usuario_id === f.usuario_id))));
  const empresa = ps.some((p) => p.alcance_odoo === "empresa");
  const otras = f.usuario_id ? filas.filter((x) => x.usuario_id === f.usuario_id && x.empleado_id !== f.empleado_id) : [];
  const porRama = new Map<string, Fila[]>();
  for (const x of abajo) porRama.set(ultimoTramo(x.departamento), [...(porRama.get(ultimoTramo(x.departamento)) ?? []), x]);

  return <section className="panel">
    <h2>Así vería la app {f.persona ?? f.nombre}</h2>
    <p className="hint">{f.puesto ?? "Sin puesto"} · {f.departamento ?? "Sin departamento"} · {f.empresa}
      {otras.length > 0 && ` · también: ${otras.map((o) => `${o.puesto ?? "sin puesto"} en ${o.empresa}`).join(", ")}`}
      {!f.usuario_id && " · todavía no tiene cuenta en la app"}</p>
    <div className="cifras">
      <div className="panel"><b style={{ fontSize: 18 }}>{pantalla ? NOMBRE_PANTALLA[pantalla].split(":")[0] : "Ninguna"}</b><span>Pantalla al entrar</span></div>
      <div className="panel"><b style={{ fontSize: 18 }}>{suyos.join(", ") || "Ninguno"}</b><span>Perfiles según Odoo</span></div>
      <div className="panel"><b>{abajo.length}</b><span>Personas a su cargo ({directos.length} directas)</span></div>
    </div>
    <h3>Su menú</h3>
    {areas.length ? <ul className="chips" style={{ listStyle: "none", padding: 0 }}>{areas.map((a) => <li key={a.id} className="etiqueta ok">{a.nombre}</li>)}</ul>
      : <p>Nada: su puesto no da ningún perfil. Elígelo en «Puesto → perfil».</p>}
    {permisos.has("ausencias.aprobar") && <p>Aprueba las vacaciones de {empresa ? "toda su empresa" : abajo.length ? "las personas a su cargo" : "nadie todavía"}
      {abajo.length > 0 && !empresa && " (el directo y, si no está, cualquiera de encima)"}.</p>}
    {abajo.length > 0 && <>
      <h3>A su cargo en Odoo</h3>
      {[...porRama.entries()].map(([rama, gente]) => <details key={rama}>
        <summary><b>{rama}</b> · {gente.length}</summary>
        <ul>{gente.map((x) => <li key={x.empleado_id}><Link href={`/admin/organigrama?ficha=${x.empleado_id}`}>{x.nombre}</Link>
          <span className="hint"> · {x.puesto ?? "sin puesto"}{x.usuario_id ? "" : " · sin cuenta en la app"}</span></li>)}</ul>
      </details>)}
    </>}
    <p className="hint" style={{ marginTop: 16 }}>Lo que ve se calcula con la última foto. Lo que se le haya puesto a mano en Administración → Personas se suma a esto.</p>
  </section>;
}
