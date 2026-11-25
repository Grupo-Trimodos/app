-- Color del logo de cada persona (autorizado por Félix el 25-11-2026).
-- · Es una preferencia de la app, no un dato de Odoo: se guarda aquí, aparte de public.usuarios, para no tocar las
--   políticas de cambio de usuarios (solo administración).
-- · Cada persona ve y cambia solo el suyo, con public.guardar_mi_color_logo(color). Sin fila: color corporativo.

create table public.preferencias_usuario (
  usuario_id  uuid primary key references public.usuarios (id) on delete cascade,
  color_logo  text check (color_logo is null or color_logo ~ '^#[0-9A-Fa-f]{6}$'),
  actualizado timestamptz not null default now()
);

alter table public.preferencias_usuario enable row level security;
revoke all on public.preferencias_usuario from anon, authenticated;
grant select on public.preferencias_usuario to authenticated;   -- se cambia solo con guardar_mi_color_logo
grant all on public.preferencias_usuario to service_role;

create policy "preferencias_usuario: cada uno la suya" on public.preferencias_usuario
  for select to authenticated
  using (usuario_id = (select auth.uid()));

create or replace function public.guardar_mi_color_logo(color text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  yo uuid := auth.uid();
begin
  if yo is null or not exists (select 1 from public.usuarios u where u.id = yo and u.activo) then
    raise exception 'Necesitas una cuenta activa.' using errcode = '42501';
  end if;
  if color is not null and color !~ '^#[0-9A-Fa-f]{6}$' then
    raise exception 'Ese color no es válido.' using errcode = '22023';
  end if;
  insert into public.preferencias_usuario as p (usuario_id, color_logo, actualizado)
  values (yo, lower(color), now())
  on conflict (usuario_id) do update set color_logo = excluded.color_logo, actualizado = now();
end;
$$;

revoke all on function public.guardar_mi_color_logo(text) from public, anon;
grant execute on function public.guardar_mi_color_logo(text) to authenticated;
