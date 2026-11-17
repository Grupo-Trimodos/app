-- Equipos: grupos de trabajo que crean los responsables (y la administración) para organizarse y, más adelante,
-- hablar entre ellos. Son independientes de centro, zona y departamento: un equipo puede juntar a personas de sitios
-- distintos. Autorizado por Félix (AGENTS.md, base 6: organización por grupos de trabajo).
--
-- Un equipo NO concede permisos: aprobar ausencias, corregir fichajes o ver la jornada de alguien siguen saliendo de
-- los perfiles y los centros (privado.puedo_sobre), que aquí no se tocan.
--
-- Las tablas se llaman «equipos_trabajo» porque «public.equipos» ya existe (carretillas y traspaletas de Seguridad).
-- No depende de 20261116000000_grupos_de_trabajo.sql ni de 20261117000000_ediciones_empleados.sql.
--
-- Quién hace qué:
--   · Crear un equipo: quien tiene «equipos.crear» (Responsable y Administrador). Queda como su creador.
--   · Renombrar, archivar o reactivar el equipo y añadir o quitar personas: su creador mientras conserve
--     «equipos.crear», o la administración (superadministrador o un perfil con «admin.usuarios»).
--   · Ver el equipo y quién está: sus miembros (solo si el equipo está activo), su creador y la administración.
--   · Los equipos no se borran: se archivan (activo = false). Quitar a una persona sí borra su fila.
--   · Los nombres de los compañeros y la búsqueda de personas van por funciones que solo devuelven id y nombre.
-- Pensado para un chat futuro: los mensajes colgarán de equipos_trabajo.id y su lectura usará privado.mis_equipos().

create table public.equipos_trabajo (
  id          bigint generated always as identity primary key,
  nombre      text not null check (char_length(btrim(nombre)) between 2 and 80),
  descripcion text check (descripcion is null or char_length(descripcion) <= 200),
  creado_por  uuid references public.usuarios (id) on delete set null default auth.uid(),
  activo      boolean not null default true,
  creado      timestamptz not null default now(),
  actualizado timestamptz not null default now()
);
create index equipos_trabajo_creado_por_idx on public.equipos_trabajo (creado_por);

create table public.equipos_trabajo_miembros (
  equipo_id   bigint not null references public.equipos_trabajo (id) on delete cascade,
  usuario_id  uuid not null references public.usuarios (id) on delete cascade,
  anadido_por uuid references public.usuarios (id) on delete set null default auth.uid(),
  anadido     timestamptz not null default now(),
  primary key (equipo_id, usuario_id)
);
create index equipos_trabajo_miembros_usuario_idx on public.equipos_trabajo_miembros (usuario_id);

-- Fecha del último cambio, la pone la base de datos.
create or replace function privado.equipo_trabajo_actualizado()
returns trigger language plpgsql set search_path = ''
as $$
begin
  new.actualizado := now();
  return new;
end;
$$;
revoke all on function privado.equipo_trabajo_actualizado() from public, anon, authenticated;
create trigger equipos_trabajo_actualizado before update on public.equipos_trabajo
  for each row execute function privado.equipo_trabajo_actualizado();

-- ---------------------------------------------------------------- quién ve y quién gestiona
-- Administración de equipos: superadministrador o perfil con «admin.usuarios» (tengo_permiso ya cuenta al
-- superadministrador y exige que la persona esté activa).
create or replace function privado.administro_equipos()
returns boolean language sql stable security definer set search_path = ''
as $$
  select privado.tengo_permiso('admin.usuarios');
$$;

-- Equipos que puedo ver, calculados una sola vez por consulta: activos en los que estoy, los que he creado y, para la
-- administración, todos. Security definer para leer las dos tablas sin pasar por su RLS (evita la recursión).
create or replace function privado.mis_equipos()
returns setof bigint language sql stable security definer set search_path = ''
as $$
  select e.id from public.equipos_trabajo e
  where exists (select 1 from public.usuarios u where u.id = (select auth.uid()) and u.activo)
    and ((select privado.administro_equipos())
         or e.creado_por = (select auth.uid())
         or (e.activo and exists (select 1 from public.equipos_trabajo_miembros m
                                  where m.equipo_id = e.id and m.usuario_id = (select auth.uid()))));
$$;

-- Equipos que puedo gestionar (renombrar, archivar, añadir y quitar personas): los míos mientras conserve
-- «equipos.crear», o todos si administro.
create or replace function privado.equipos_que_gestiono()
returns setof bigint language sql stable security definer set search_path = ''
as $$
  select e.id from public.equipos_trabajo e
  where (select privado.administro_equipos())
     or (e.creado_por = (select auth.uid()) and (select privado.tengo_permiso('equipos.crear')));
$$;

-- ¿Es una persona activa de la app? (la RLS de usuarios no deja leer fichas ajenas).
create or replace function privado.persona_activa(persona uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select coalesce((select u.activo from public.usuarios u where u.id = persona), false);
$$;

revoke all on function privado.administro_equipos(), privado.mis_equipos(), privado.equipos_que_gestiono(),
  privado.persona_activa(uuid) from public, anon;
grant execute on function privado.administro_equipos(), privado.mis_equipos(), privado.equipos_que_gestiono(),
  privado.persona_activa(uuid) to authenticated;

-- ---------------------------------------------------------------- permisos de tabla y RLS
alter table public.equipos_trabajo enable row level security;
alter table public.equipos_trabajo_miembros enable row level security;
revoke all on public.equipos_trabajo, public.equipos_trabajo_miembros from anon, authenticated;
-- Por columnas: el creador y las fechas no se cambian a mano; los equipos no se borran; los miembros no se editan.
grant select on public.equipos_trabajo, public.equipos_trabajo_miembros to authenticated;
grant insert (nombre, descripcion) on public.equipos_trabajo to authenticated;
grant update (nombre, descripcion, activo) on public.equipos_trabajo to authenticated;
grant insert (equipo_id, usuario_id) on public.equipos_trabajo_miembros to authenticated;
grant delete on public.equipos_trabajo_miembros to authenticated;

-- El creador se ve aunque la lista calculada aún no incluya el equipo recién creado (insert … returning).
create policy "equipos_trabajo: los ven miembros, creador y administración" on public.equipos_trabajo
  for select to authenticated
  using (creado_por = (select auth.uid()) or id in (select privado.mis_equipos()));
create policy "equipos_trabajo: los crea quien tiene equipos.crear" on public.equipos_trabajo
  for insert to authenticated
  with check ((select privado.tengo_permiso('equipos.crear')) and creado_por = (select auth.uid()) and activo);
create policy "equipos_trabajo: los cambia su creador o la administración" on public.equipos_trabajo
  for update to authenticated
  using (id in (select privado.equipos_que_gestiono()))
  with check (id in (select privado.equipos_que_gestiono()));

create policy "equipos_trabajo_miembros: los ve quien ve el equipo" on public.equipos_trabajo_miembros
  for select to authenticated
  using (equipo_id in (select privado.mis_equipos()));
create policy "equipos_trabajo_miembros: alta por quien gestiona" on public.equipos_trabajo_miembros
  for insert to authenticated
  with check (equipo_id in (select privado.equipos_que_gestiono())
              and anadido_por = (select auth.uid())
              and exists (select 1 from public.equipos_trabajo e where e.id = equipo_id and e.activo)
              and privado.persona_activa(usuario_id));
create policy "equipos_trabajo_miembros: baja por quien gestiona" on public.equipos_trabajo_miembros
  for delete to authenticated
  using (equipo_id in (select privado.equipos_que_gestiono()));

-- ---------------------------------------------------------------- funciones para la web
-- Quién está en un equipo (solo id y nombre de las personas activas), si quien llama puede ver ese equipo.
create or replace function public.miembros_equipo(equipo bigint)
returns table (id uuid, nombre text)
language sql stable security definer set search_path = ''
as $$
  select u.id, u.nombre
  from public.equipos_trabajo_miembros m
  join public.usuarios u on u.id = m.usuario_id
  where m.equipo_id = equipo
    and u.activo
    and equipo in (select privado.mis_equipos())
  order by u.nombre, u.id;
$$;

-- Buscar personas activas por nombre para añadirlas a un equipo: solo con «equipos.crear», al menos 2 letras, hasta
-- 20 resultados y solo id y nombre. No distingue mayúsculas ni tildes.
create or replace function public.buscar_personas_equipo(texto text)
returns table (id uuid, nombre text)
language plpgsql stable security definer set search_path = ''
as $$
declare
  limpio text := lower(translate(btrim(coalesce(texto, '')), 'ÁÉÍÓÚÜÑáéíóúüñ', 'aeiouunaeiouun'));
begin
  if not privado.tengo_permiso('equipos.crear') then
    raise exception 'No tienes permiso para buscar personas' using errcode = '42501';
  end if;
  if char_length(limpio) < 2 then
    return;
  end if;
  limpio := replace(replace(replace(limpio, '\', '\\'), '%', '\%'), '_', '\_');
  return query
    select u.id, u.nombre from public.usuarios u
    where u.activo and coalesce(btrim(u.nombre), '') <> ''
      and lower(translate(u.nombre, 'ÁÉÍÓÚÜÑáéíóúüñ', 'aeiouunaeiouun')) like '%' || limpio || '%'
    order by u.nombre, u.id
    limit 20;
end;
$$;

revoke all on function public.miembros_equipo(bigint), public.buscar_personas_equipo(text) from public, anon;
grant execute on function public.miembros_equipo(bigint), public.buscar_personas_equipo(text) to authenticated;

-- ---------------------------------------------------------------- permisos en los perfiles
with nuevos (nombre, dar) as (values
  ('Responsable', '{equipos.crear,equipos.ver}'::text[]),
  ('Administrador', '{equipos.crear,equipos.ver}'::text[]),
  ('Chófer', '{equipos.ver}'::text[]),
  ('Operario', '{equipos.ver}'::text[]),
  ('Oficina', '{equipos.ver}'::text[])
)
update public.perfiles p
   set permisos = array(select distinct x from unnest(p.permisos || n.dar) as x order by x)
  from nuevos n
 where p.nombre = n.nombre;
