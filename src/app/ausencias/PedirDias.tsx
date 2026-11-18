"use client";
import { useState } from "react";
import { useFormStatus } from "react-dom";
import { diasDeSolicitud, fechasSolicitud, NOMBRE_AUSENCIA, textoDiasLaborables } from "@/lib/jornada";
import { pedirAusencia } from "./acciones";

function Enviar({ listo }: { listo: boolean }) {
  const { pending } = useFormStatus();
  return <button className="btn primario ancho campo-enviar" disabled={pending || !listo}>
    {pending ? "Enviando…" : "Enviar solicitud"}
  </button>;
}

/**
 * Pedir días: tipo, primer y último día (selector de fecha del móvil) y un comentario. Mientras se eligen las fechas dice
 * cuántos días laborables son (de lunes a viernes) y avisa si entra algún fin de semana. Se guarda igual que siempre
 * (acción pedirAusencia: la misma tabla y las mismas reglas).
 */
export default function PedirDias({ hoy, quienAprueba }: { hoy: string; quienAprueba: string }) {
  const [tipo, setTipo] = useState("vacaciones");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  // El médico se puede anotar después (lo permite la acción); lo demás, desde hoy.
  const minimo = tipo === "medico" ? undefined : hoy;
  const fin = hasta || desde;
  const alReves = !!desde && !!hasta && hasta < desde;
  const dias = desde && !alReves ? diasDeSolicitud(desde, fin) : null;
  const pasado = !!desde && tipo !== "medico" && desde < hoy;

  return <form action={pedirAusencia} className="campo-tarjeta campo-pedir" aria-labelledby="pedir-t">
    <h2 id="pedir-t">Pedir días</h2>
    <fieldset className="campo-opciones">
      <legend>¿Qué pides?</legend>
      {Object.entries(NOMBRE_AUSENCIA).map(([k, v]) => <label key={k} className={tipo === k ? "elegida" : undefined}>
        <input type="radio" name="tipo" value={k} checked={tipo === k} onChange={() => setTipo(k)} /><span>{v}</span>
      </label>)}
    </fieldset>
    <div className="campo-fechas">
      <div>
        <label htmlFor="desde">Primer día</label>
        <input id="desde" name="desde" type="date" min={minimo} required value={desde}
          onChange={(e) => { setDesde(e.target.value); if (hasta && e.target.value > hasta) setHasta(""); }} />
      </div>
      <div>
        <label htmlFor="hasta">Último día (incluido)</label>
        <input id="hasta" name="hasta" type="date" min={desde || minimo} value={hasta} onChange={(e) => setHasta(e.target.value)} />
      </div>
    </div>
    <p className="hint">Si es un solo día, deja el último día vacío.</p>

    {dias && <div className="campo-cuenta" aria-live="polite">
      <b>{fechasSolicitud(desde, fin, hoy.slice(0, 4))}</b>
      <span>{textoDiasLaborables(dias.laborables)}</span>
      {dias.finDeSemana > 0 && <span className="campo-cuenta-aviso">
        {dias.finDeSemana === 1 ? "Incluye 1 día de fin de semana, que no cuenta como laborable."
          : `Incluye ${dias.finDeSemana} días de sábado o domingo, que no cuentan como laborables.`}</span>}
    </div>}
    {alReves && <p className="error" role="alert">El último día no puede ser antes del primero.</p>}
    {pasado && <p className="error" role="alert">No se pueden pedir días ya pasados. Habla con tu responsable.</p>}

    <label htmlFor="motivo">Comentario (opcional)</label>
    <input id="motivo" name="motivo" maxLength={300} placeholder="Por ejemplo: boda de mi hermana" />
    <p className="campo-quien">{quienAprueba}</p>
    <Enviar listo={!!dias && dias.naturales > 0 && !pasado} />
  </form>;
}
