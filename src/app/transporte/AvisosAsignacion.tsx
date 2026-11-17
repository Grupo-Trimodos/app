import type { AvisosAsignacion as Avisos, VehiculoAviso } from "./tipos";
import "./transporte.css";

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

function ListaVehiculos({ filas }: { filas: VehiculoAviso[] }) {
  const tipos = [...new Set(filas.map(v => v.tipo))];
  return <>{tipos.map(tipo => {
    const delTipo = filas.filter(v => v.tipo === tipo);
    return <div key={tipo}>
      {tipos.length > 1 && <h3 className="avisos-subtitulo">{tipo} ({delTipo.length})</h3>}
      <ul className="avisos-lista">{delTipo.map(v => <li key={v.id}>
        <strong className="datos-matricula">{v.matricula}</strong>
        <span className="datos-secundario">{v.modelo || "Modelo sin indicar"} · {v.empresa || "Empresa sin indicar"}</span>
        {v.chofer_baja !== undefined && <span className="datos-secundario">Su chófer asignado está dado de baja en Odoo{v.chofer_baja ? ` (${v.chofer_baja})` : ""}.</span>}
      </li>)}</ul>
    </div>;
  })}</>;
}

/** Avisos de la flota propia: camiones sin chófer y chóferes sin camión. Si Odoo falla, solo este bloque lo dice. */
export default function AvisosAsignacion({ datos: d, error }: { datos: Avisos | null; error: string | null }) {
  return <section className="datos-panel avisos-asignacion" aria-labelledby="avisos-titulo">
    <div className="datos-panel-titulo"><h2 id="avisos-titulo">Avisos de asignación</h2><span className="datos-etiqueta">Odoo · Flota y contactos</span></div>
    {!d ? <p className="aviso" role="status">No se han podido leer los avisos de Odoo{error ? `: ${error}` : "."} El resto de la página funciona con normalidad.</p> : <>
      <details className="datos-relacion">
        <summary><span><strong>{plural(d.camiones_sin_chofer.length, "camión sin chófer", "camiones sin chófer")}</strong></span>
          <span className={`datos-estado${d.camiones_sin_chofer.length ? "" : " confirmado"}`}>{d.camiones_sin_chofer.length ? "Revisar" : "Todo asignado"}</span></summary>
        <div className="datos-relacion-detalle">
          {d.camiones_sin_chofer.length ? <ListaVehiculos filas={d.camiones_sin_chofer} /> : <p>Todos los camiones propios tienen un chófer asignado en Odoo.</p>}
        </div>
      </details>
      {d.remolques_sin_chofer.length > 0 && <details className="datos-relacion">
        <summary><span><strong>{plural(d.remolques_sin_chofer.length, "remolque sin chófer", "remolques sin chófer")}</strong></span><span className="datos-estado">Aparte</span></summary>
        <div className="datos-relacion-detalle">
          <p>Los remolques se cuentan aparte: es normal que muchos no tengan chófer.</p>
          <ListaVehiculos filas={d.remolques_sin_chofer} />
        </div>
      </details>}
      <details className="datos-relacion">
        <summary><span><strong>{plural(d.choferes_sin_camion.length, "chófer sin camión", "chóferes sin camión")}</strong></span>
          <span className={`datos-estado${d.choferes_sin_camion.length ? "" : " confirmado"}`}>{d.choferes_sin_camion.length ? "Revisar" : "Todo asignado"}</span></summary>
        <div className="datos-relacion-detalle">
          {d.choferes_sin_camion.length ? <ul className="avisos-lista">{d.choferes_sin_camion.map(c => <li key={c.id}>
            <strong>{c.nombre}</strong><span className="datos-secundario">{c.empresa}</span>
          </li>)}</ul> : <p>Todos los chóferes del grupo que aparecen en Odoo tienen un camión asignado.</p>}
        </div>
      </details>
      {d.choferes_varios_camiones.length > 0 && <details className="datos-relacion">
        <summary><span><strong>{plural(d.choferes_varios_camiones.length, "chófer con más de un vehículo", "chóferes con más de un vehículo")}</strong></span><span className="datos-estado">Comprobar</span></summary>
        <div className="datos-relacion-detalle">
          <p>Puede ser una cabeza tractora con su semirremolque. Si no es así, corrígelo en Odoo.</p>
          <ul className="avisos-lista">{d.choferes_varios_camiones.map(c => <li key={c.id}>
            <strong>{c.nombre}</strong><span className="datos-secundario">{c.matriculas.join(" · ")}</span>
          </li>)}</ul>
        </div>
      </details>}
      <p className="avisos-nota">Los datos salen de Odoo. Cuentan como chóferes del grupo los contactos conductores de cada empresa y de sus centros, y los que tienen ficha de empleado. Si falta alguien, se corrige en Odoo.
        {d.conductores > 0 && <> Conductores de camiones propios sin ficha de empleado enlazada: {d.conductores_sin_ficha} de {d.conductores}.</>}</p>
    </>}
  </section>;
}
