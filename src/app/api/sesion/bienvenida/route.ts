import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseConfigurado } from "@/lib/supabase/env";
import { llamarPythonDetalle } from "@/lib/python";
import { usuarioActual } from "@/lib/usuario";

/**
 * Datos del saludo de la cinemática de entrada (public/deca/cinematica.js): nombre, color de su logo y, de su ficha de
 * Odoo, puesto y empresa (los mismos que «Mi perfil», /api/odoo/mi-organizacion). Solo los de quien pregunta.
 * El navegador los guarda y los usa la SIGUIENTE vez que se abre la app, así la animación no espera a la red.
 */
const sinCache = { headers: { "Cache-Control": "no-store" } };
type Ficha = { empresa: string | null; puesto: string | null };

export async function GET() {
  if (!supabaseConfigurado()) return NextResponse.json({ error: "La app no está configurada." }, { status: 503, ...sinCache });
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims?.sub) return NextResponse.json({ error: "Tienes que iniciar sesión." }, { status: 401, ...sinCache });

  const { perfil, uid } = await usuarioActual();
  if (!perfil?.activo) return NextResponse.json({ error: "Tu cuenta no está activa." }, { status: 403, ...sinCache });
  const [{ data: pref }, { datos }] = await Promise.all([
    supabase.from("preferencias_usuario").select("color_logo").eq("usuario_id", uid).maybeSingle<{ color_logo: string | null }>(),
    llamarPythonDetalle<{ ficha: Ficha | null }>("/api/odoo/mi-organizacion"),
  ]);
  return NextResponse.json({
    nombre: perfil.nombre || perfil.codigo || "",
    colorLogo: /^#[0-9a-fA-F]{6}$/.test(pref?.color_logo ?? "") ? pref!.color_logo : null,
    puesto: datos?.ficha?.puesto ?? null,
    empresa: datos?.ficha?.empresa ?? null,
  }, sinCache);
}
