// Logo "puerta de contenedor" personalizable por usuario.
// Uso: <LogoTrimodos color={perfil.colorLogo} size={40} />
import { useEffect, useId } from "react";

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

// --- geometría del símbolo Trimodos (marca de agua) ---
const R = Math.hypot(50, 64);
const ay = (u: number) => Math.sqrt(R * R - (u - 50) ** 2);

function Simbolo({ x, y, s, c }: { x: number; y: number; s: number; c: string }) {
  const f = (u: number, v: number) => [x + (s * u) / 100, y + (s * v) / 100];
  const L = (p: number[], q: number[], k: string) => (
    <line key={k} x1={p[0]} y1={p[1]} x2={q[0]} y2={q[1]} stroke={c} strokeWidth={2.6} strokeLinecap="round" />
  );
  const p = f(0, 64), q = f(100, 64), r = (R * s) / 100;
  return (
    <g>
      <rect x={x} y={y} width={s} height={s} fill="none" stroke={c} strokeWidth={2.6} />
      {L(f(0, 29), f(100, 29), "h")}
      {L(f(50, 0), f(50, 100), "v")}
      {L(f(0, 100), f(14, ay(14)), "cl")}
      {L(f(100, 100), f(86, ay(86)), "cr")}
      <path d={`M${p[0]} ${p[1]} A${r} ${r} 0 0 0 ${q[0]} ${q[1]}`} fill="none" stroke={c} strokeWidth={2.6} />
      {L(f(50, 0), f(0, 64), "ll")}
      {L(f(50, 0), f(100, 64), "lr")}
    </g>
  );
}

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
          <Simbolo x={25} y={24} s={50} c={c.marca} />
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

// Selector para la pantalla de perfil
export function SelectorColorLogo({ valor, onCambio }: { valor: string; onCambio: (c: string) => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
      {Object.entries(COLORES_CORPORATIVOS).map(([nombre, hex]) => (
        <button
          key={nombre}
          type="button"
          onClick={() => onCambio(hex)}
          aria-label={`Logo color ${nombre}`}
          aria-pressed={valor === hex}
          style={{ padding: 4, borderRadius: 14, border: valor === hex ? "2px solid #121312" : "2px solid transparent", background: "none" }}
        >
          <LogoTrimodos color={hex} size={44} />
        </button>
      ))}
      <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
        Otro color
        <input type="color" value={valor} onChange={(e) => onCambio(e.target.value)} />
      </label>
    </div>
  );
}
