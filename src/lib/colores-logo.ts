/** Colores del logo personalizable. Aparte de src/app/LogoTrimodos.tsx («use client») para que las páginas del servidor
 *  puedan leerlos: una constante importada de un archivo de cliente llega vacía al servidor. */
export const COLORES_CORPORATIVOS = {
  trimodos: "#FDDA00",
  stinsa: "#009F92",
  transargi: "#F27C49",
  noche: "#2A2B28",
} as const;

export const COLOR_LOGO_POR_DEFECTO = COLORES_CORPORATIVOS.trimodos;

/** Un color #rrggbb válido, o el del grupo. */
export const colorLogoValido = (c: string | null | undefined): string =>
  typeof c === "string" && /^#[0-9a-fA-F]{6}$/.test(c) ? c : COLOR_LOGO_POR_DEFECTO;
