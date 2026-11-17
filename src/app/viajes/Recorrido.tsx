import Icono from "../Icono";
import type { Orden } from "@/lib/viajes";

/** Recorrido de la orden: origen → destino, con los puertos si los hay. */
export default function Recorrido({ o }: { o: Pick<Orden, "origen" | "destino" | "destino_final" | "puerto_carga" | "puerto_descarga"> }) {
  return <div className="viaje-ruta">
    <p><span>{o.origen ?? "Origen sin indicar"}</span><Icono nombre="flecha" size={16} /><span>{o.destino ?? "Destino sin indicar"}</span></p>
    {o.destino_final && o.destino_final !== o.destino && <p className="hint">Destino final: {o.destino_final}</p>}
    {(o.puerto_carga || o.puerto_descarga) && <p className="hint">
      {o.puerto_carga && <>Puerto de carga: {o.puerto_carga}</>}{o.puerto_carga && o.puerto_descarga && " · "}
      {o.puerto_descarga && <>Puerto de descarga: {o.puerto_descarga}</>}</p>}
  </div>;
}
