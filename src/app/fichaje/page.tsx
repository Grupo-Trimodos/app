import OrigenDato from "../OrigenDato";
import AvisoJornada from "../AvisoJornada";
import { leerFichajesJornada } from "@/lib/jornadas-servidor";
import Cabecera from "../Cabecera";
import EstadoOdoo from "../EstadoOdoo";
import { conPermiso } from "@/lib/usuario";
import {
  BOTON_TIPO, duracion, calcularJornada, fecha, hora, inicioDia, NOMBRE_ESTADO, NOMBRE_TIPO, SIGUIENTES,
} from "@/lib/jornada";
import { fichar, reintentarOdoo } from "./acciones";

export const dynamic = "force-dynamic";
export const metadata = { title: "Fichaje · Grupo Trimodos" };

export default async function PaginaFichaje({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { supabase, uid, perfil } = await conPermiso("fichaje.fichar");
  const { ok, error } = await searchParams;
  const { data: todos, error: errorLeer } = await leerFichajesJornada(supabase, uid, inicioDia(7));
  const resumen = calcularJornada(todos);
  const { estado, minutosVisibles: llevas } = resumen;
  const hoy = todos.filter((f) => new Date(f.momento).getTime() >= inicioDia().getTime());
  const pendientes = todos.some((f) => f.odoo_estado === "error" || f.odoo_estado === "pendiente");
  const historico = resumen.jornadas.filter((j) => new Date(j.entrada.momento) >= inicioDia(7) || !j.salida);

  return (
    <>
      <Cabecera nombre={perfil.nombre || perfil.codigo || ""} />
      <main className="contenido estrecho">
        <h1>Fichaje</h1>
        <OrigenDato fuente="App · Registro de jornada"><p>Entradas, pausas y salidas registradas en la app. Cada movimiento indica si está pendiente, enviado a Odoo o necesita revisión.</p></OrigenDato>
        {ok && <p className="aviso" role="status">{ok}</p>}
        {error && <p className="error" role="alert">{error}</p>}

        <section className={`panel estado-jornada ${estado}`}>
          <p className="hint">Ahora mismo</p>
          <p className="estado-grande">{errorLeer ? "Sin datos de jornada" : NOMBRE_ESTADO[estado]}</p>
          <p>{estado === "fuera" ? "Hoy has trabajado" : "Llevas"} <b>{errorLeer ? "—" : duracion(llevas)}</b></p>
          <AvisoJornada resumen={resumen} error={!!errorLeer} />
          <div className="botones-fichar">
            {(errorLeer ? [] : SIGUIENTES[estado]).map((t, i) => (
              <form key={t} action={fichar}>
                <input type="hidden" name="tipo" value={t} />
                <button className={`btn ancho grande ${i === 0 ? "primario" : ""}`}>{BOTON_TIPO[t]}</button>
              </form>
            ))}
          </div>
        </section>

        <section className="panel">
          <h2>Hoy</h2>
          {hoy.length === 0 ? <p className="hint">Todavía no has fichado hoy.</p> : (
            <ul className="lista-fichajes">
              {hoy.map((f) => (
                <li key={f.id}>
                  <b>{hora(f.momento)}</b> {NOMBRE_TIPO[f.tipo]}
                  {f.origen === "camion" && <span className="hint"> · al confirmar el camión</span>}
                  {f.origen === "correccion" && <span className="hint"> · corregido por tu responsable: {f.nota}</span>}
                  <div><EstadoOdoo estado={f.odoo_estado} error={f.odoo_error} detalle /></div>
                </li>
              ))}
            </ul>
          )}
          {pendientes && (
            <form action={reintentarOdoo}><button className="btn pequeno">Reintentar envío a Odoo</button></form>
          )}
        </section>

        {historico.length > 0 && (
          <section className="panel">
            <h2>Jornadas · día de entrada</h2>
            <table>
              <tbody>
                {[...historico].reverse().map((j) => (
                  <tr key={j.entrada.id}><td>{fecha(j.entrada.momento)}</td>
                    <td>{hora(j.entrada.momento)} – {j.salida ? `${fecha(j.salida.momento)} ${hora(j.salida.momento)}` : "Sin salida"}</td>
                    <td><b>{duracion(j.minutos)}</b>{j.incidencias.length ? " · Revisar fichajes" : !j.salida ? j.pendiente ? " · Pendiente de cierre (provisional)" : " · Provisional" : ""}</td></tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
        <p className="hint">Si te has equivocado o se te olvidó fichar, díselo a tu responsable: él lo corrige y queda anotado.</p>
      </main>
    </>
  );
}
