"use server";
import { conPermiso } from "@/lib/usuario";
import { llamarPythonDetalle } from "@/lib/python";
import { revalidatePath } from "next/cache";
export async function leerEditor(empleado: number) {
  const u = await conPermiso("organizacion.editar");
  if (!u.puede("admin.usuarios")) return { datos: null, error: "Necesitas permiso para gestionar cuentas." };
  return llamarPythonDetalle<FichaEdicion>(`/api/odoo/empleados/${empleado}/edicion`, {espera:25000});
}
export type FichaEdicion = { historial: {id:string;creado:string;estado:string;error:string|null}[]; version: string; valores: Record<string, string | number | false>; opciones: Record<string, {id:number;nombre:string}[]> };
export async function guardarEditor(empleado:number, body:unknown) {
  const u = await conPermiso("organizacion.editar");
  if (!u.puede("admin.usuarios")) return { datos:null,error:"Necesitas permiso para gestionar cuentas." };
  const resultado = await llamarPythonDetalle<{estado:string;error:string|null;id:string}>(`/api/odoo/empleados/${empleado}/edicion`, {method:"POST",body,espera:60000});
  revalidatePath("/organizacion");
  return resultado;
}
