"use client";
import { useState } from "react";
import OrigenDato from "../OrigenDato";
import type { Estructura } from "./tipos";
const vistas = [
  { campo: "company_id", titulo: "Empresas", detalle: "Empresa legal de cada empleado." },
  { campo: "department_id", titulo: "Departamentos", detalle: "Áreas, almacenes y zonas tal como están organizados en Odoo." },
  { campo: "work_location_id", titulo: "Ubicaciones", detalle: "Lugares de trabajo. Las ubicaciones con el mismo nombre se mantienen separadas." },
  { campo: "job_id", titulo: "Puestos", detalle: "Puesto indicado en la ficha. No determina los permisos en la app." },
];
const normalizar = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
export default function VistaOrganizacion({ datos: d }: { datos: Estructura }) {
  const [vista, setVista] = useState(0);
  const [buscar, setBuscar] = useState("");
  const [pagina, setPagina] = useState(0);
  const actual = vistas[vista];
  const grupos = [...(d.grupos[actual.campo] || [])].sort((a,b) => b.personas-a.personas);
  const filas = grupos.filter(g => normalizar(g.id === null ? "Sin indicar en Odoo" : g.nombre).includes(normalizar(buscar)));
  const paginas = Math.max(1, Math.ceil(filas.length/10));
  const pendientes = [...vistas.slice(1).map(v => ({ nombre: v.titulo, numero: (d.grupos[v.campo] || []).find(g => g.id === null)?.personas || 0 })), { nombre: "Responsable", numero: d.sin_responsable }];
  return <>
    <div className="datos-metricas">
      <article className="dato-metrica destacada"><span>Equipo activo</span><strong>{d.plantilla}</strong><small>Empleados en Odoo</small></article>
      <article className="dato-metrica"><span>Empresas</span><strong>{(d.grupos.company_id || []).filter(g => g.id !== null).length}</strong><small>Con empleados activos</small></article>
      <article className="dato-metrica"><span>Ubicaciones</span><strong>{(d.grupos.work_location_id || []).filter(g => g.id !== null).length}</strong><small>Con personal asignado</small></article>
    </div>
    <div className="datos-columnas"><section className="datos-panel">
      <div className="datos-panel-titulo"><h2>Distribución del equipo</h2><span className="datos-etiqueta">Odoo · Empleados</span></div>
      <div className="datos-pestanas" aria-label="Agrupar empleados">{vistas.map((v,i) => <button key={v.campo} aria-pressed={vista===i} onClick={() => {setVista(i);setBuscar("");setPagina(0);}}>{v.titulo}</button>)}</div>
      <p className="datos-descripcion">{actual.detalle}</p>
      <label className="datos-buscar">Buscar en {actual.titulo.toLowerCase()}<input type="search" value={buscar} placeholder="Escribe un nombre…" onChange={e => {setBuscar(e.target.value);setPagina(0);}} /></label>
      <div className="datos-lista-cabecera"><span>{actual.titulo}</span><span>Personas</span></div>
      <ul className="datos-distribucion">{filas.slice(pagina*10,pagina*10+10).map(g => <li key={g.id ?? "sin"}>
        <div><span>{g.id === null ? "Sin indicar en Odoo" : g.nombre}</span><div className="datos-barra" aria-hidden="true"><i style={{width: `${Math.min(100, d.plantilla ? g.personas/d.plantilla*100 : 0)}%`}} /></div></div><b>{g.personas}</b>
      </li>)}</ul>
      {!filas.length && <p className="datos-vacio">No hay coincidencias. Prueba con otro nombre.</p>}
      <div className="datos-paginacion"><span role="status">{filas.length} resultados · Página {pagina+1} de {paginas}</span><div><button className="btn pequeno" disabled={!pagina} onClick={() => setPagina(pagina-1)} aria-label="Página anterior">←</button><button className="btn pequeno" disabled={pagina+1>=paginas} onClick={() => setPagina(pagina+1)} aria-label="Página siguiente">→</button></div></div>
      <OrigenDato fuente="Odoo · Empleados"><p>Recuento de empleados activos de las empresas configuradas, agrupado por el identificador del campo <code>{actual.campo}</code>.</p><p>Consulta: {new Date(d.consultado).toLocaleString("es-ES", {timeZone:"Europe/Madrid"})} (Madrid). Las cuentas de acceso a la app se cuentan por separado.</p></OrigenDato>
    </section><aside className="datos-panel datos-pendientes"><span className="datos-ceja">CALIDAD DE LA INFORMACIÓN</span><h2>Datos por completar</h2><p>Personas que todavía no tienen estos datos en su ficha.</p><ul>{pendientes.map(p => <li key={p.nombre}><span>{p.nombre}</span><b className={p.numero ? "datos-aviso-numero" : ""}>{p.numero}</b></li>)}</ul><p className="datos-nota">Una persona puede aparecer en varios recuentos. Los datos se completan en Odoo.</p></aside></div>
    <section className="datos-panel datos-relaciones"><div className="datos-panel-titulo"><div><span className="datos-ceja">APP ↔ ODOO</span><h2>Centros y correspondencias</h2></div><span className="datos-etiqueta">{d.relaciones.length} centros</span></div><p className="datos-descripcion">Abre un centro para ver su correspondencia. Las propuestas necesitan revisión y no cambian los accesos.</p>
      {d.aviso && <p className="aviso" role="status">{d.aviso}</p>}
      {!d.aviso && !d.relaciones.length && <p className="datos-vacio">No hay centros disponibles para comparar.</p>}
      {d.relaciones.map(r => <details className="datos-relacion" key={r.id}><summary><span>{r.nombre}</span><span className={`datos-estado ${r.estado === "Vinculado por identificador" ? "confirmado" : ""}`}>{r.estado}</span></summary><div className="datos-relacion-detalle">{r.candidatos.map(c => <p key={c.id}><strong>{c.nombre}</strong><span className="datos-secundario">{c.empresa}</span></p>)}<OrigenDato fuente="App y Odoo"><p>Centro de la app #{r.id}. {r.modelo === "hr.department" ? "Comparación con departamentos; no confirma una ubicación de trabajo." : "Comparación con ubicaciones de trabajo."}</p>{r.candidatos.map(c => <p key={c.id}>{r.modelo} · Registro #{c.id}</p>)}</OrigenDato></div></details>)}
    </section>
  </>;
}
