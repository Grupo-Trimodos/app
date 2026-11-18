-- Calendario: notas propias de cada persona y fechas señaladas (comidas, webinars, formaciones…) que publican los
-- responsables y la administración para todos, para un centro o para un equipo. Autorizado por Félix el 17-11-2026.
-- Nada de esto va a Odoo. Quien entra con Microsoft puede, además, copiar una nota o una fecha señalada en su Outlook
-- (src/lib/outlook.ts); eso es un envío a Microsoft que hace el servidor con el permiso de esa persona, no se guarda aquí
-- más que el identificador del evento de Outlook de cada nota (para poder borrarlo también).
--
-- Depende de 20261117100000_equipos.sql (equipos_trabajo, privado.mis_equipos(), privado.equipos_que_gestiono()).
-- No depende de 20261116000000_grupos_de_trabajo.sql ni de 20261117000000_ediciones_empleados.sql.
--
-- Quién hace qué:
--   · Notas: cada persona las suyas (ver, crear, cambiar y borrar). Nadie más las ve, tampoco la administración.
--   · Fechas señaladas: las publica quien tiene «calendario.publicar», para todos, para un centro en el que tenga ese
--     permiso (todos los centros si su perfil vale en todos o es de administración) o para un equipo que gestione.
--     Las cambia o archiva su autor mientras conserve ese permiso y ese alcance, o la administración.
--   · Las ven: «todos», cualquier persona activa; «centro», quien tiene algún perfil en ese centro; «equipo», sus
--     miembros. Siempre su autor y la administración. Archivadas, solo su autor y la administración.
--   · Las fechas señaladas no se borran: se archivan (activo = false).

-- ---------------------------------------------------------------- notas propias
create table public.calendario_notas (
  id                bigint generated always as identity primary key,
  usuario_id        uuid not null default auth.uid() references public.usuarios (id) on delete cascade,
  titulo            text not null check (char_length(btrim(titulo)) between 1 and 120),
  detalle           text check (detalle is null or char_length(detalle) <= 500),
  empieza           timestamptz not null,
  termina           timestamptz,
  todo_el_dia       boolean not null default false,
  outlook_evento_id text check (outlook_evento_id is null or char_length(outlook_evento_id) between 1 and 1024),
  creado            timestamptz not null default now(),
  actualizado       timestamptz not null default now(),
  constraint calendario_notas_fin check (termina is null or (termina >= empieza and termina <= empieza + interval '366 days'))
);
create index calendario_notas_usuario_idx on public.calendario_notas (usuario_id, empieza);

-- ---------------------------------------------------------------- fechas señaladas
create table public.fechas_senaladas (
  id          bigint generated always as identity primary key,
  titulo      text not null check (char_length(btrim(titulo)) between 1 and 120),
  detalle     text check (detalle is null or char_length(detalle) <= 1000),
  enlace      text check (enlace is null or (char_length(enlace) <= 500 and enlace ~* '^https?://[^[:space:]<>"]+$')),
  lugar       text check (lugar is null or char_length(lugar) <= 120),
  empieza     timestamptz not null,
  termina     timestamptz,
  todo_el_dia boolean not null default false,
  alcance     text not null check (alcance in ('todos', 'centro', 'equipo')),
  centro_id   bigint references public.centros (id) on delete cascade,
  equipo_id   bigint references public.equipos_trabajo (id) on delete cascade,
  creado_por  uuid references public.usuarios (id) on delete set null default auth.uid(),
  activo      boolean not null default true,
  creado      timestamptz not null default now(),
  actualizado timestamptz not null default now(),
  constraint fechas_senaladas_alcance check (
    (alcance = 'todos'  and centro_id is null     and equipo_id is null) or
    (alcance = 'centro' and centro_id is not null and equipo_id is null) or
    (alcance = 'equipo' and equipo_id is not null and centro_id is null)),
  constraint fechas_senaladas_fin check (termina is null or (termina >= empieza and termina <= empieza + interval '366 days'))
);
create index fechas_senaladas_empieza_idx on public.fechas_senaladas (empieza);
create index fechas_senaladas_centro_idx on public.fechas_senaladas (centro_id) where centro_id is not null;
create index fechas_senaladas_equipo_idx on public.fechas_senaladas (equipo_id) where equipo_id is not null;
create index fechas_senaladas_creado_por_idx on public.fechas_senaladas (creado_por);

-- Fecha del último cambio, la pone la base de datos.
create or replace function privado.calendario_actualizado()
returns trigger language plpgsql set search_path = ''
as $$
begin
  new.actualizado := now();
  return new;
end;
$$;
revoke all on function privado.calendario_actualizado() from public, anon, authenticated;
create trigger calendario_notas_actualizado before update on public.calendario_notas
  for each row execute function privado.calendario_actualizado();
create trigger fechas_senaladas_actualizado before update on public.fechas_senaladas
  for each row execute function privado.calendario_actualizado();

-- ---------------------------------------------------------------- conjuntos (una vez por consulta, no por fila)
-- Centros en los que tengo algún perfil (para ver las fechas de «centro»).
create or replace function privado.mis_centros_calendario()
returns setof bigint language sql stable security definer set search_path = ''
as $$
  select distinct up.centro_id from public.usuario_perfil up
  join public.usuarios u on u.id = up.usuario_id and u.activo
  where up.usuario_id = (select auth.uid()) and up.centro_id is not null;
$$;

-- Centros para los que puedo publicar: todos si administro o si un perfil mío con «calendario.publicar» vale en todos
-- los centros; si no, los centros de esos perfiles. Nada sin «calendario.publicar».
create or replace function privado.centros_donde_publico()
returns setof bigint language sql stable security definer set search_path = ''
as $$
  select c.id from public.centros c
  where (select privado.tengo_permiso('calendario.publicar'))
    and ((select privado.tengo_permiso('admin.usuarios'))
         or exists (select 1 from public.usuario_perfil up join public.perfiles pf on pf.id = up.perfil_id
                    where up.usuario_id = (select auth.uid()) and 'calendario.publicar' = any (pf.permisos)
                      and (pf.todos_los_centros or up.centro_id = c.id)));
$$;

-- Fechas señaladas que puedo ver (ver la cabecera). Security definer para no pasar por la RLS de las tablas que mira.
create or replace function privado.fechas_que_veo()
returns setof bigint language sql stable security definer set search_path = ''
as $$
  select f.id from public.fechas_senaladas f
  where exists (select 1 from public.usuarios u where u.id = (select auth.uid()) and u.activo)
    and (f.creado_por = (select auth.uid())
         or (select privado.tengo_permiso('admin.usuarios'))
         or (f.activo and (f.alcance = 'todos'
                           or (f.alcance = 'centro' and f.centro_id in (select privado.mis_centros_calendario()))
                           or (f.alcance = 'equipo' and f.equipo_id in (select privado.mis_equipos())
                               and exists (select 1 from public.equipos_trabajo e where e.id = f.equipo_id and e.activo)))));
$$;

-- Fechas señaladas que puedo cambiar o archivar: las mías mientras conserve «calendario.publicar», o todas si administro
-- (y tengo «calendario.publicar»). El alcance nuevo lo comprueba aparte la política.
create or replace function privado.fechas_que_gestiono()
returns setof bigint language sql stable security definer set search_path = ''
as $$
  select f.id from public.fechas_senaladas f
  where (select privado.tengo_permiso('calendario.publicar'))
    and (f.creado_por = (select auth.uid()) or (select privado.tengo_permiso('admin.usuarios')));
$$;

revoke all on function privado.mis_centros_calendario(), privado.centros_donde_publico(), privado.fechas_que_veo(),
  privado.fechas_que_gestiono() from public, anon;
grant execute on function privado.mis_centros_calendario(), privado.centros_donde_publico(), privado.fechas_que_veo(),
  privado.fechas_que_gestiono() to authenticated;

-- ---------------------------------------------------------------- permisos de tabla y RLS
alter table public.calendario_notas enable row level security;
alter table public.fechas_senaladas enable row level security;
revoke all on public.calendario_notas, public.fechas_senaladas from anon, authenticated;
-- Por columnas: el dueño, el autor y las fechas de registro no se cambian a mano. Sin TRUNCATE ni borrado de fechas.
grant select, delete on public.calendario_notas to authenticated;
grant insert (titulo, detalle, empieza, termina, todo_el_dia, outlook_evento_id),
      update (titulo, detalle, empieza, termina, todo_el_dia, outlook_evento_id) on public.calendario_notas to authenticated;
grant select on public.fechas_senaladas to authenticated;
grant insert (titulo, detalle, enlace, lugar, empieza, termina, todo_el_dia, alcance, centro_id, equipo_id)
  on public.fechas_senaladas to authenticated;
grant update (titulo, detalle, enlace, lugar, empieza, termina, todo_el_dia, alcance, centro_id, equipo_id, activo)
  on public.fechas_senaladas to authenticated;

create policy "calendario_notas: las ve su dueño" on public.calendario_notas
  for select to authenticated using (usuario_id = (select auth.uid()));
create policy "calendario_notas: las crea su dueño" on public.calendario_notas
  for insert to authenticated
  with check (usuario_id = (select auth.uid()) and (select privado.tengo_permiso('calendario.usar')));
create policy "calendario_notas: las cambia su dueño" on public.calendario_notas
  for update to authenticated
  using (usuario_id = (select auth.uid()) and (select privado.tengo_permiso('calendario.usar')))
  with check (usuario_id = (select auth.uid()));
create policy "calendario_notas: las borra su dueño" on public.calendario_notas
  for delete to authenticated using (usuario_id = (select auth.uid()));

-- El autor se ve aunque la lista calculada aún no incluya la fecha recién creada (insert … returning).
create policy "fechas_senaladas: las ve a quien van dirigidas" on public.fechas_senaladas
  for select to authenticated
  using ((creado_por = (select auth.uid()) and exists (select 1 from public.usuarios u where u.id = (select auth.uid()) and u.activo))
         or id in (select privado.fechas_que_veo()));
create policy "fechas_senaladas: las publica quien tiene calendario.publicar" on public.fechas_senaladas
  for insert to authenticated
  with check ((select privado.tengo_permiso('calendario.publicar')) and creado_por = (select auth.uid()) and activo
              and (alcance = 'todos'
                   or (alcance = 'centro' and centro_id in (select privado.centros_donde_publico()))
                   or (alcance = 'equipo' and equipo_id in (select privado.equipos_que_gestiono())
                       and exists (select 1 from public.equipos_trabajo e where e.id = equipo_id and e.activo))));
create policy "fechas_senaladas: las cambia o archiva su autor o la administración" on public.fechas_senaladas
  for update to authenticated
  using (id in (select privado.fechas_que_gestiono()))
  -- Archivar se puede siempre (aunque el equipo ya esté archivado); publicar o cambiar, solo con un alcance permitido.
  with check (id in (select privado.fechas_que_gestiono())
              and (not activo
                   or alcance = 'todos'
                   or (alcance = 'centro' and centro_id in (select privado.centros_donde_publico()))
                   or (alcance = 'equipo' and equipo_id in (select privado.equipos_que_gestiono())
                       and exists (select 1 from public.equipos_trabajo e where e.id = equipo_id and e.activo))));

-- ---------------------------------------------------------------- función para la web
-- Fechas señaladas que ve quien llama y que tocan el periodo [desde, hasta), con el nombre de su autor, del centro y
-- del equipo (la RLS de usuarios no deja leer fichas ajenas). Las archivadas, solo si se piden (las ve su autor y la
-- administración). Como mucho 400 días y 500 fechas.
create or replace function public.fechas_senaladas_entre(desde timestamptz, hasta timestamptz, archivadas boolean default false)
returns table (id bigint, titulo text, detalle text, enlace text, lugar text, empieza timestamptz, termina timestamptz,
               todo_el_dia boolean, alcance text, centro_id bigint, centro text, equipo_id bigint, equipo text,
               creado_por uuid, autor text, activo boolean)
language sql stable security definer set search_path = ''
as $$
  select f.id, f.titulo, f.detalle, f.enlace, f.lugar, f.empieza, f.termina, f.todo_el_dia, f.alcance,
         f.centro_id, c.nombre, f.equipo_id, e.nombre, f.creado_por, u.nombre, f.activo
  from public.fechas_senaladas f
  left join public.centros c on c.id = f.centro_id
  left join public.equipos_trabajo e on e.id = f.equipo_id
  left join public.usuarios u on u.id = f.creado_por
  where f.id in (select privado.fechas_que_veo())
    and (f.activo or archivadas)
    and desde is not null and hasta is not null and hasta > desde and hasta <= desde + interval '400 days'
    and f.empieza < hasta and coalesce(f.termina, f.empieza) >= desde
  order by f.empieza, f.id
  limit 500;
$$;
revoke all on function public.fechas_senaladas_entre(timestamptz, timestamptz, boolean) from public, anon;
grant execute on function public.fechas_senaladas_entre(timestamptz, timestamptz, boolean) to authenticated;

-- ---------------------------------------------------------------- permisos en los perfiles
with nuevos (nombre, dar) as (values
  ('Chófer', '{calendario.usar}'::text[]),
  ('Operario', '{calendario.usar}'::text[]),
  ('Oficina', '{calendario.usar}'::text[]),
  ('Responsable', '{calendario.usar,calendario.publicar}'::text[]),
  ('Administrador', '{calendario.usar,calendario.publicar}'::text[])
)
update public.perfiles p
   set permisos = array(select distinct x from unnest(p.permisos || n.dar) as x order by x)
  from nuevos n
 where p.nombre = n.nombre;
