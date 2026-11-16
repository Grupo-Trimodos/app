"use client";
import { useState } from "react";
import OrigenDato from "../OrigenDato";
import type { Catalogo } from "./tipos";
export default function VistaTransporte({datos:d}: {datos:Catalogo}) {
  const [contactos,setContactos] = useState(false);
  const [pagina,setPagina] = useState(0);
  const filas = contactos ? d.choferes : d.vehiculos;
  const paginas = Math.max(1,Math.ceil(filas.length/20));
  return <>
    <div className="datos-metricas transporte-metricas"><article className="dato-metrica destacada"><span>Vehículos</span><strong>{d.vehiculos.length}</strong><small>En esta consulta</small></article>{d.incluye_externos && <article className="dato-metrica"><span>Contactos conductores</span><strong>{d.choferes.length}</strong><small>Incluye colaboradores externos</small></article>}</div>
    {d.limitado && <p className="aviso">Se muestran hasta 100 registros de cada lista. Concreta la búsqueda para encontrar los demás.</p>}
    <section className="datos-panel"><div className="datos-panel-titulo"><h2>{contactos ? "Contactos conductores" : "Vehículos"}</h2><span className="datos-etiqueta">Odoo · {contactos ? "Contactos" : "Flota"}</span></div>
      {d.incluye_externos && <div className="datos-pestanas" aria-label="Tipo de registro"><button aria-pressed={!contactos} onClick={() => {setContactos(false);setPagina(0);}}>Vehículos</button><button aria-pressed={contactos} onClick={() => {setContactos(true);setPagina(0);}}>Contactos conductores</button></div>}
      {contactos && <p className="datos-descripcion">Contactos marcados como conductores. Esta lista no representa la plantilla.</p>}
      {!filas.length ? <p className="datos-vacio">No hay coincidencias en esta consulta. Prueba otra búsqueda.</p> : contactos ? <table className="datos-tabla"><caption className="sr-only">Contactos conductores de la consulta</caption><thead><tr><th>Nombre</th><th>Empresa</th></tr></thead><tbody>{d.choferes.slice(pagina*20,pagina*20+20).map(c => <tr key={c.id}><td><strong>{c.nombre}</strong></td><td><span className="datos-etiqueta-movil">Empresa</span>{c.empresa || "Sin indicar"}</td></tr>)}</tbody></table> : <table className="datos-tabla"><caption className="sr-only">Vehículos de la consulta</caption><thead><tr><th>Vehículo</th><th>Empresa</th><th>Conductor asignado</th></tr></thead><tbody>{d.vehiculos.slice(pagina*20,pagina*20+20).map(v => <tr key={v.id}><td><strong className="datos-matricula">{v.matricula || "Sin matrícula"}</strong><span className="datos-secundario">{v.modelo || "Modelo sin indicar"}</span></td><td><span className="datos-etiqueta-movil">Empresa</span>{v.empresa || "Sin indicar"}</td><td><span className="datos-etiqueta-movil">Conductor</span>{v.conductor || "Sin asignar"}</td></tr>)}</tbody></table>}
      <div className="datos-paginacion"><span role="status">{filas.length} resultados · Página {pagina+1} de {paginas}</span><div><button className="btn pequeno" disabled={!pagina} onClick={() => setPagina(pagina-1)} aria-label="Página anterior">←</button><button className="btn pequeno" disabled={pagina+1>=paginas} onClick={() => setPagina(pagina+1)} aria-label="Página siguiente">→</button></div></div>
      <OrigenDato fuente="Odoo · Flota y contactos"><p>{d.incluye_externos ? "Vehículos activos y contactos marcados como conductores de las empresas configuradas o compartidos. No se identifica a los empleados por su nombre." : "Vehículos activos marcados como propios, filtrados por su empresa propietaria. El conductor es el asignado en la ficha del vehículo."}</p></OrigenDato>
    </section>
  </>;
}
