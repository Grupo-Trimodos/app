import { redirect } from "next/navigation";
import { conPermiso } from "@/lib/usuario";
export default async function MapaAnterior() {
  await conPermiso("admin.usuarios");
  redirect("/organizacion");
}
