"use client";
import { useState } from "react";
import { useFormStatus } from "react-dom";

/** Botón grande de un formulario: se bloquea mientras guarda (un segundo toque no marca dos veces). Con `confirmar`,
 *  pide un segundo toque antes de enviar (para el último paso, que no se puede deshacer). */
export default function BotonPaso({ texto, confirmar, clase = "btn ancho grande primario" }: {
  texto: string; confirmar?: string; clase?: string;
}) {
  const { pending } = useFormStatus();
  const [seguro, setSeguro] = useState(false);
  if (confirmar && !seguro) {
    return <button type="button" className={clase} onClick={() => setSeguro(true)}>{texto}</button>;
  }
  return <div className="viaje-confirmar">
    {confirmar && <p>{confirmar}</p>}
    <button className={clase} disabled={pending}>{pending ? "Guardando…" : confirmar ? `Sí, ${texto.toLowerCase()}` : texto}</button>
    {confirmar && <button type="button" className="btn ancho" disabled={pending} onClick={() => setSeguro(false)}>No, volver</button>}
  </div>;
}
