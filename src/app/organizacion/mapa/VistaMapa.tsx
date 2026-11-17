"use client";
import { useState } from "react";
import Link from "next/link";
import EditorEmpleado from "./EditorEmpleado";
import OrigenDato from "../../OrigenDato";
import type { Mapa, Cuenta } from "./tipos";
const normalizar = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
export default function VistaMapa({ datos: d, cuentas, empleado, editable }: { datos: Mapa; cuentas: Cuenta[] | null; empleado?: number; editable: boolean }) {
  const [agrupar, setAgrupar] = useState<"zona" | "puesto" | "departamento">("zona");
  const etiquetaGrupo = {zona:"ubicación de trabajo",puesto:"puesto",departamento:"departamento"}[agrupar];
  const [zona, setZona] = useState<number | "todas">("todas");
  const [busqueda, setBusqueda] = useState("");
  const [empresa, setEmpresa] = useState("");
  const [soloPendientes, setSoloPendientes] = useState(false);
  const [personaId, setPersonaId] = useState<number | null>(empleado ?? null);
  const [pagina, setPagina] = useState(0);
  const empresas = [...new Map(d.personas.filter(p => p.empresa).map(p => [p.empresa!.id,p.empresa!])).values()];
  const cuentaDe = (id: number) => cuentas?.filter(c => c.odoo_employee_id === id) ?? [];
  const base = d.personas.filter(p => (!empresa || String(p.empresa?.id) === empresa)
    && (!soloPendientes || p.faltan.length > 0)
    && normalizar([p.nombre,p.empresa?.nombre,p.departamento?.nombre,p.puesto?.nombre,p.zona?.nombre].join(" ")).includes(normalizar(busqueda)));
  const zonas = agrupar === "zona" ? [...d.zonas] : [];
  // No perder personas cuya referencia de ubicación no esté en el catálogo visible.
  for (const p of d.personas) if (p[agrupar] && !zonas.some(z => z.id === p[agrupar]!.id)) zonas.push({id:p[agrupar]!.id,nombre:p[agrupar]!.nombre,empresa:"Referencia en ficha de empleado"});
  const filas = base.filter(p => zona === "todas" || (p[agrupar]?.id ?? 0) === zona);
  const persona = filas.find(p => p.id === personaId);
  const paginas = Math.max(1,Math.ceil(filas.length/20));
  const sinVinculo = cuentas?.filter(c => !c.odoo_employee_id) ?? [];
  const cambiarZona = (id: number | "todas") => {setZona(id);setPersonaId(null);setPagina(0);};
  const reiniciar = () => {setPersonaId(null);setPagina(0);};
  return <>
    <div className="mapa-resumen"><div><strong>{d.personas.length}</strong><span>Empleados activos · Odoo</span></div><div><strong>{d.personas.filter(p=>p.faltan.length).length}</strong><span>Fichas con datos esenciales pendientes</span></div><div><strong>{cuentas ? sinVinculo.length : "—"}</strong><span>Cuentas de la app sin emparejar</span></div></div>
    <details className="datos-panel mapa-cuentas"><summary>Cuentas por revisar {cuentas ? `· ${sinVinculo.length} sin vínculo` : "· lectura no disponible"}</summary>
      {!cuentas ? <p className="error" role="alert">No se han podido consultar las cuentas. No podemos confirmar sus vínculos.</p> : <><p>Estas cuentas todavía no tienen empleado asignado. La activación y el emparejamiento se revisan en Administración.</p><ul>{sinVinculo.map(c=><li key={c.id}><span><b>{c.nombre || c.codigo || c.email || "Sin nombre"}</b><small>{c.activo ? "Activa · falta emparejar" : "Inactiva · pendiente de revisión"}</small></span><Link className="btn pequeno" href={`/admin?ver=personas&estado=todos&cuenta=${c.id}`}>Revisar cuenta</Link></li>)}</ul>{!sinVinculo.length && <p>No hay cuentas sin emparejar.</p>}</>}
    </details>
    <div className="datos-panel mapa-filtros"><label>Buscar persona, zona o puesto<input type="search" placeholder="Nombre, centro, departamento…" value={busqueda} onChange={e=>{setBusqueda(e.target.value);cambiarZona("todas");}} /></label><label>Empresa<select value={empresa} onChange={e=>{setEmpresa(e.target.value);cambiarZona("todas");}}><option value="">Todas las empresas</option>{empresas.map(e=><option key={e.id} value={e.id}>{e.nombre}</option>)}</select></label><label className="mapa-check"><input type="checkbox" checked={soloPendientes} onChange={e=>{setSoloPendientes(e.target.checked);reiniciar();}} />Solo fichas por completar</label></div>
    <label className="mapa-agrupar">Distribuir personas por<select value={agrupar} onChange={e=>{setAgrupar(e.target.value as typeof agrupar);cambiarZona("todas");}}><option value="zona">Ubicación de trabajo</option><option value="departamento">Departamento</option><option value="puesto">Puesto</option></select></label>
    <section className="mapa-zonas" aria-label="Mapa de zonas de trabajo"><button className="mapa-zona" aria-pressed={zona==="todas"} onClick={()=>cambiarZona("todas")}><span>Vista general</span><strong>{base.length}</strong><small>Personas en los filtros actuales</small></button>
      {[{id:0,nombre:`Sin ${etiquetaGrupo}`,empresa:"Necesita revisión en Odoo"},...zonas].map(z=>{const ps=base.filter(p=>(p[agrupar]?.id??0)===z.id);const faltan=ps.filter(p=>p.faltan.length).length;return <button key={z.id} className={`mapa-zona ${z.id===0 ? "sin-zona" : ""}`} aria-pressed={zona===z.id} onClick={()=>cambiarZona(z.id)}><span>{z.nombre}</span><strong>{ps.length}</strong><small>{z.empresa || "Ubicación compartida"}</small>{faltan>0 && <em>{faltan} fichas por completar</em>}</button>;})}
    </section>
    <div className="mapa-detalle"><section className="datos-panel"><div className="datos-panel-titulo"><h2>{zona==="todas" ? "Personas" : zona===0 ? `Sin ${etiquetaGrupo}` : zonas.find(z=>z.id===zona)?.nombre}</h2><span role="status">{filas.length} personas</span></div><p className="datos-descripcion">Selecciona una persona para revisar su ficha y su cuenta.</p>
      <ul className="mapa-personas">{filas.slice(pagina*20,pagina*20+20).map(p=><li key={p.id}><button aria-pressed={personaId===p.id} onClick={()=>{setPersonaId(p.id);if(window.matchMedia("(max-width: 900px)").matches) requestAnimationFrame(()=>document.getElementById("mapa-ficha")?.scrollIntoView({block:"start"}));}}><span className="mapa-avatar" aria-hidden="true">{p.nombre.split(" ").slice(0,2).map(n=>n[0]).join("")}</span><span><b>{p.nombre}</b><small>{p.puesto?.nombre || "Puesto sin indicar"} · {p.empresa?.nombre || "Sin empresa"}</small><small>{p.zona?.nombre || "Sin ubicación"}</small></span><span className={`mapa-insignia ${p.faltan.length ? "pendiente" : ""}`}>{p.faltan.length ? `${p.faltan.length} datos pendientes` : "Datos esenciales completos"}</span></button></li>)}</ul>
      {!filas.length && <p className="datos-vacio">No hay personas con estos filtros en esta zona.</p>}
      <div className="datos-paginacion"><span>Página {pagina+1} de {paginas}</span><div><button className="btn pequeno" disabled={!pagina} onClick={()=>setPagina(pagina-1)}>Anterior</button><button className="btn pequeno" disabled={pagina+1>=paginas} onClick={()=>setPagina(pagina+1)}>Siguiente</button></div></div>
    </section><aside id="mapa-ficha" className="datos-panel mapa-ficha" aria-label="Ficha seleccionada" aria-live="polite">{!persona ? <div className="mapa-sin-seleccion"><span aria-hidden="true">↖</span><h2>La ficha, a mano</h2><p>Pulsa en un nombre para ver la información actual de Odoo y lo que falta por completar.</p></div> : <>
      <span className="datos-ceja">FICHA DE EMPLEADO · ODOO #{persona.id}</span><h2>{persona.nombre}</h2><Link href={`/organizacion?empleado=${persona.id}`}>Enlace a este perfil</Link>
      {persona.faltan.length>0 ? <div className="mapa-alerta"><strong>Completar en Odoo</strong><ul>{persona.faltan.map(f=><li key={f}>{f}</li>)}</ul></div> : <p className="mapa-completa">Los datos esenciales de esta revisión están completos.</p>}
      <dl className="mapa-campos">{[["Empresa",persona.empresa?.nombre],["Ubicación de trabajo",persona.zona?.nombre],["Departamento",persona.departamento?.nombre],["Puesto",persona.puesto?.nombre],["Responsable",persona.responsable?.nombre],["Móvil de trabajo",persona.movil],["Teléfono de trabajo",persona.telefono],["Correo de trabajo",persona.correo]].map(([k,v])=><div key={k}><dt>{k}</dt><dd>{v || "Sin indicar en Odoo"}</dd></div>)}</dl>
      {persona.completar.length>0 && <p className="datos-descripcion">También por completar: {persona.completar.join(", ")}. Estos datos no conceden permisos en la app.</p>}
      <a className="btn primario ancho" href={`${d.odoo_url}/web#id=${persona.id}&model=hr.employee&view_type=form`} target="_blank" rel="noopener noreferrer">Abrir ficha en Odoo ↗</a><p className="datos-descripcion">Guarda las correcciones en Odoo y actualiza esta página para comprobarlas.</p>
      {editable && <EditorEmpleado key={persona.id} empleado={persona.id} />}
      <h3>Cuenta de la app</h3>{cuentas===null ? <p>No se ha podido comprobar el vínculo.</p> : !cuentaDe(persona.id).length ? <p>Sin cuenta vinculada. Su ficha existe en Odoo; falta emparejar una cuenta de la app.</p> : <>{cuentaDe(persona.id).length>1 && <p className="error">Hay varias cuentas vinculadas a este empleado. Revisa el emparejamiento antes de activar cuentas.</p>}{cuentaDe(persona.id).map(c=><div className="mapa-cuenta" key={c.id}><strong>{c.nombre || c.codigo || "Cuenta"}</strong><p>{c.activo ? "Cuenta activa" : "Cuenta inactiva · revisar aprobación"}</p><Link className="btn pequeno" href={`/admin?ver=personas&estado=todos&cuenta=${c.id}`}>Revisar cuenta y permisos</Link></div>)}</>}
      <OrigenDato fuente="Odoo · Ficha de empleado"><p>Identificador #{persona.id}. Ubicación: work_location_id; empresa: company_id; contacto: mobile_phone / work_phone. No se empareja por similitud de nombres ni teléfono.</p></OrigenDato>
    </>}</aside></div>
    <OrigenDato fuente="Odoo en directo · Cuentas de la app"><p>Consulta: {new Date(d.consultado).toLocaleString("es-ES",{timeZone:"Europe/Madrid"})} (Madrid). Empleados activos de las empresas configuradas. Cada tarjeta es una ubicación de trabajo, no una posición geográfica ni un perfil de acceso. Las ubicaciones sin personas siguen visibles.</p><p>Datos esenciales de esta revisión: nombre, empresa, ubicación y algún teléfono de trabajo. Un teléfono presente no acredita que sea único, que reciba SMS ni quién lo utiliza. El alta por SMS aún no está implantada.</p></OrigenDato>
  </>;
}
