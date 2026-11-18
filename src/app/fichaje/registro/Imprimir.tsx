"use client";
import Icono from "../../Icono";

/** Abre el cuadro de imprimir del navegador; desde ahí se imprime o se guarda como PDF. */
export default function Imprimir() {
  return <button type="button" className="btn primario ancho campo-enviar" onClick={() => window.print()}>
    <Icono nombre="documento" size={24} />Guardar como PDF o imprimir
  </button>;
}
