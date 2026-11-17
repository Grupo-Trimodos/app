/** Móvil guardado en la app (solo dígitos con el prefijo del país, «34612345678») → «+34 612 345 678». */
export function formatoTelefono(t: string | null | undefined): string {
  if (!t) return "";
  const m = /^34(\d{3})(\d{3})(\d{3})$/.exec(t);
  return m ? `+34 ${m[1]} ${m[2]} ${m[3]}` : `+${t}`;
}
