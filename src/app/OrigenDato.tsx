/** Procedencia accesible también por teclado y en móvil; el detalle no ocupa espacio hasta abrirlo. */
export default function OrigenDato({ fuente, children }: { fuente: string; children: React.ReactNode }) {
  return <details className="origen-dato">
    <summary>Origen: {fuente}</summary>
    <div>{children}</div>
  </details>;
}
