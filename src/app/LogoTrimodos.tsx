"use client";
// Logo "puerta de contenedor" personalizable por usuario.
// Uso: <LogoTrimodos color={perfil.colorLogo} size={40} />
import { useEffect, useId, useState } from "react";

export const COLORES_CORPORATIVOS = {
  trimodos: "#FDDA00",
  stinsa: "#009F92",
  transargi: "#F27C49",
  noche: "#2A2B28",
};

// --- utilidades de color ---
const hexToRgb = (h: string) => {
  const n = parseInt(h.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const rgbToHex = (r: number[]) =>
  "#" + r.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
const mezclar = (a: string, b: string, t: number) => {
  const A = hexToRgb(a), B = hexToRgb(b);
  return rgbToHex(A.map((v, i) => v + (B[i] - v) * t));
};
const luminancia = (h: string) => {
  const [r, g, b] = hexToRgb(h).map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

// Calcula marco, estrías y marca de agua a partir de un único color
export function paleta(color: string) {
  const claro = luminancia(color) > 0.35;
  return {
    puerta: color,
    marco: mezclar(color, "#121312", claro ? 0.92 : 0.7),
    estria: mezclar(color, "#FFFFFF", 0.45),
    marca: claro ? "#121312" : "#FFFFFF",
    opacidadMarca: claro ? 0.13 : 0.18,
  };
}

// Símbolo original de Grupo Trimodos, recortado de trimodos.png y pasado a blanco para usarlo de máscara: la marca de
// agua toma el color que toque (negro o blanco) sin redibujar el símbolo.
export const SIMBOLO_MASCARA = "/deca/img/trimodos-simbolo-mascara.png";

const ESTRIAS = [13, 17, 21, 25, 29, 33, 37, 41, 45, 53.6, 57.6, 61.6, 65.6, 69.6, 73.6, 77.6, 81.6, 85.6];
const BARRAS = [20, 40, 60, 80];

export function LogoTrimodos({ color = COLORES_CORPORATIVOS.trimodos, size = 40 }: { color?: string; size?: number }) {
  const id = useId().replace(/:/g, "");
  const c = paleta(color);
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" role="img" aria-label="Trimodos">
      <defs>
        <filter id={`b${id}`} x="-10%" y="-10%" width="120%" height="120%">
          <feGaussianBlur stdDeviation="0.7" />
        </filter>
        <mask id={`m${id}`} maskUnits="userSpaceOnUse" x="25" y="24" width="50" height="50">
          <image href={SIMBOLO_MASCARA} x="25" y="24" width="50" height="50" />
        </mask>
        <clipPath id={`c${id}`}>
          <rect width="100" height="100" rx="24" />
        </clipPath>
      </defs>
      <g clipPath={`url(#c${id})`}>
        <rect width="100" height="100" fill={c.marco} />
        <rect x="10" y="12" width="39.4" height="76" rx="1.5" fill={c.puerta} />
        <rect x="50.6" y="12" width="39.4" height="76" rx="1.5" fill={c.puerta} />
        {ESTRIAS.map((x) => (
          <rect key={x} x={x} y="14" width="2" height="72" fill={c.estria} opacity="0.35" />
        ))}
        <g filter={`url(#b${id})`} opacity={c.opacidadMarca}>
          <rect x="25" y="24" width="50" height="50" fill={c.marca} mask={`url(#m${id})`} />
        </g>
        {BARRAS.map((x) => (
          <g key={x} fill={c.marco}>
            <rect x={x - 0.9} y="11" width="1.8" height="78" rx="0.9" />
            <rect x={x - 2} y="13" width="4" height="3.2" rx="0.8" />
            <rect x={x - 2} y="83.8" width="4" height="3.2" rx="0.8" />
          </g>
        ))}
        <g fill={c.marco}>
          <rect x="38.4" y="52" width="3.2" height="5" rx="1" />
          <rect x="31" y="53.3" width="8" height="2.4" rx="1.2" />
          <rect x="58.4" y="52" width="3.2" height="5" rx="1" />
          <rect x="61" y="53.3" width="8" height="2.4" rx="1.2" />
        </g>
      </g>
    </svg>
  );
}

// Cambia el favicon de la pestaña al color del usuario.
// Llamarlo una vez al cargar el perfil: useFaviconLogo(perfil.colorLogo)
export function useFaviconLogo(color?: string) {
  useEffect(() => {
    if (!color) return;
    const c = paleta(color);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="24" fill="${c.marco}"/><rect x="10" y="12" width="39.4" height="76" rx="1.5" fill="${c.puerta}"/><rect x="50.6" y="12" width="39.4" height="76" rx="1.5" fill="${c.puerta}"/>${BARRAS.map((x) => `<rect x="${x - 1.5}" y="11" width="3" height="78" fill="${c.marco}"/>`).join("")}</svg>`;
    let link = document.querySelector<HTMLLinkElement>("link[rel='icon']");
    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      document.head.appendChild(link);
    }
    link.type = "image/svg+xml";
    link.href = "data:image/svg+xml," + encodeURIComponent(svg);
  }, [color]);
}

// Selector para «Mi perfil»: va dentro de un <form> con la acción del servidor; envía el campo «color».
export function SelectorColorLogo({ inicial }: { inicial: string }) {
  const [valor, setValor] = useState(inicial);
  return (
    <div className="selector-logo">
      <LogoTrimodos color={valor} size={72} />
      <div className="selector-logo-opciones" role="group" aria-label="Colores del grupo">
        {Object.entries(COLORES_CORPORATIVOS).map(([nombre, hex]) => (
          <button key={nombre} type="button" onClick={() => setValor(hex)} aria-pressed={valor.toLowerCase() === hex.toLowerCase()}
            aria-label={`Color ${NOMBRES[nombre]}`} title={NOMBRES[nombre]}>
            <LogoTrimodos color={hex} size={44} />
          </button>
        ))}
        <label className="selector-logo-otro">
          <span>Otro color</span>
          <input type="color" value={valor} onChange={(e) => setValor(e.target.value)} />
        </label>
      </div>
      <input type="hidden" name="color" value={valor} />
    </div>
  );
}

const NOMBRES: Record<string, string> = { trimodos: "Trimodos", stinsa: "Stinsa", transargi: "Transargi", noche: "Noche" };

/** Pone el favicon de la pestaña con el color de la persona. Se pinta desde la cabecera. */
export function FaviconLogo({ color }: { color: string }) {
  useFaviconLogo(color);
  return null;
}
