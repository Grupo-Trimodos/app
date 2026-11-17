-- Autorizado por Félix el 17-11-2026: edición de ocho campos de trabajo de hr.employee.
-- Cola de envíos; no es una copia editable de la ficha. Solo el servidor crea y procesa solicitudes.
create table public.odoo_ediciones_empleados (
  id uuid primary key,
  autor uuid not null references public.usuarios(id) on delete restrict,
  empleado_id integer not null check (empleado_id > 0),
  creado timestamptz not null default now(),
  terminado timestamptz,
  antes jsonb not null,
  cambios jsonb not null,
  lectura jsonb,
  modo text not null check (modo in ('prueba', 'real')),
  estado text not null default 'pendiente' check (estado in ('pendiente','enviando','enviado','simulado','error')),
  error text
);
alter table public.odoo_ediciones_empleados enable row level security;
revoke all on public.odoo_ediciones_empleados from public, anon, authenticated, service_role;
grant select on public.odoo_ediciones_empleados to authenticated;
grant select, insert, update on public.odoo_ediciones_empleados to service_role;
create policy "ediciones: administracion autorizada" on public.odoo_ediciones_empleados for select to authenticated
using ((select privado.tengo_permiso('admin.usuarios')) and (select privado.tengo_permiso('organizacion.editar')));
create unique index edicion_empleado_en_curso on public.odoo_ediciones_empleados(empleado_id)
where estado in ('pendiente','enviando');
create or replace function privado.proteger_edicion_empleado() returns trigger
language plpgsql set search_path = '' as $$
begin
  if row(new.id,new.autor,new.empleado_id,new.creado,new.antes,new.cambios,new.modo)
     is distinct from row(old.id,old.autor,old.empleado_id,old.creado,old.antes,old.cambios,old.modo)
     or old.estado in ('enviado','simulado') then
    raise exception 'Una solicitud enviada y su contenido no se pueden modificar';
  end if;
  return new;
end; $$;
revoke all on function privado.proteger_edicion_empleado() from public, anon, authenticated;
create trigger proteger_edicion_empleado before update on public.odoo_ediciones_empleados
for each row execute function privado.proteger_edicion_empleado();
