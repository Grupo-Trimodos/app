-- Perfiles base = los del organigrama (decisión de Félix del 25-11-2026).
-- Hasta ahora los «cuatro básicos» eran Administrador, Oficina, Chófer y Operario. Desde que el puesto de la ficha de
-- Odoo decide el perfil (20261125120000_perfiles_por_organigrama.sql), los perfiles base pasan a ser los que da algún
-- puesto (tabla puestos_perfil) más Responsable, que se suma solo a quien tiene gente a su cargo.
-- Administración → Perfiles queda para ajustar lo que ve cada perfil base (sus permisos).
--
--   · Base: no se borran, no cambian de nombre ni de pantalla (lo impide la base de datos, como antes).
--   · Oficina y Seguridad dejan de ser base: ningún puesto los da. Se pueden borrar cuando nadie los tenga.
--   · Nuevo: no se puede borrar un perfil al que apunta algún puesto (antes el borrado quitaba el emparejamiento
--     sin avisar). Primero se cambia el puesto a otro perfil en Perfiles por organigrama → Puesto → perfil.
-- No cambia ningún permiso ni ninguna asignación de personas.

create or replace function privado.proteger_perfil_base()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.base then raise exception 'El perfil «%» es un perfil base y no se puede borrar', old.nombre; end if;
    if exists (select 1 from public.puestos_perfil pp where pp.perfil_id = old.id) then
      raise exception 'El perfil «%» lo da algún puesto de Odoo: cambia antes ese puesto a otro perfil', old.nombre;
    end if;
    return old;
  end if;
  if old.base and (new.nombre <> old.nombre or not new.base or new.pantalla is distinct from old.pantalla) then
    raise exception 'El perfil «%» es un perfil base: no cambia de nombre ni de pantalla', old.nombre;
  end if;
  return new;
end;
$$;
revoke all on function privado.proteger_perfil_base() from public, anon, authenticated;

-- El propio cambio de marca necesita saltarse la protección un momento (solo en esta migración).
alter table public.perfiles disable trigger perfiles_proteger_base;

update public.perfiles pf set base = true
 where pf.nombre = 'Responsable'
    or exists (select 1 from public.puestos_perfil pp where pp.perfil_id = pf.id);

update public.perfiles set base = false where nombre in ('Oficina', 'Seguridad');

alter table public.perfiles enable trigger perfiles_proteger_base;
