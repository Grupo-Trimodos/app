import Link from "next/link";
import Icono from "./Icono";
import Recorrido from "./viajes/Recorrido";
import { llamarPythonDetalle } from "@/lib/python";
import { BOTON_PASO, NOMBRE_ESTADO, fechaHora, horaPaso, type MisViajes } from "@/lib/viajes";
import "./viajes/viajes.css";

/** Inicio de los chóferes: la orden en curso (o la siguiente) y el paso que toca. Va dentro de un Suspense: Odoo no
 *  retrasa el resto de la pantalla. */
export default async function TarjetaViajes() {
  const { datos, error } = await llamarPythonDetalle<MisViajes>("/api/chofer/viajes", { espera: 25000 });
  const activas = datos?.ordenes.filter((o) => !o.terminado) ?? [];
  const o = activas[0];
  const ultimo = o?.pasos.filter((p) => p.estado !== "incidencia").at(-1);
  return <Link href={o ? `/viajes#orden-${o.id}` : "/viajes"} className="campo-viaje" aria-label="Mis viajes">
    <h2><Icono nombre="ruta" size={20} />Mis viajes{activas.length > 1 ? ` · ${activas.length} órdenes` : ""}</h2>
    {error ? <p className="hint">No se han podido cargar tus viajes. Toca para volver a intentarlo.</p>
      : !datos?.enlazado ? <p className="hint">{datos?.aviso ?? "Tu encargado tiene que confirmar tu ficha de Odoo."}</p>
      : !o ? <p className="hint">No tienes viajes pendientes.</p>
      : <>
        <strong>{o.cliente ?? "Cliente sin indicar"}</strong>
        <Recorrido o={o} />
        <p className="hint">{ultimo ? `${NOMBRE_ESTADO[ultimo.estado]} desde las ${horaPaso(ultimo.momento)}`
          : o.inicio ? `Previsto: ${fechaHora(o.inicio)}` : "Por empezar"}</p>
        {o.siguiente && <span className="btn ancho grande primario">{BOTON_PASO[o.siguiente]}</span>}
      </>}
  </Link>;
}
