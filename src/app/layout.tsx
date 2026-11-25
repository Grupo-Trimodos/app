import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import BarraCarga from "./BarraCarga";
import "../../public/deca/marca.css";
import "./globals.css";
import "../../public/deca/cabecera.css";   // cabecera y menú: la misma hoja que usa la PWA de DECA
import "./shell.css";
import "../../public/deca/cinematica.css";   // cinemática de entrada (la misma que DECA)

export const metadata: Metadata = {
  title: "Grupo Trimodos",
  description: "App interna de Grupo Trimodos",
  robots: { index: false, follow: false },
  icons: { icon: "/deca/favicon.png?v=2", apple: "/deca/icons/apple-touch-icon.png?v=2" },   // ?v: que los móviles cojan el logo nuevo
};

export const viewport: Viewport = { themeColor: "#fcda00", colorScheme: "light" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>
        <Suspense fallback={null}><BarraCarga /></Suspense>
        {children}
      </body>
    </html>
  );
}
