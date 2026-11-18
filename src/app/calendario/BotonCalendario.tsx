"use client";
import { useFormStatus } from "react-dom";

/** Evita repetir la pulsación mientras la acción está guardando. */
export default function BotonCalendario({ children, className }: { children: React.ReactNode; className?: string }) {
  const { pending } = useFormStatus();
  return <button type="submit" className={className} disabled={pending} aria-disabled={pending}>
    {pending ? "Guardando…" : children}
  </button>;
}
