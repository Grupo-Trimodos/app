-- «Mis viajes»: el chófer ve sus órdenes de transporte de Odoo y marca en la app cómo va la carga y la descarga.
-- Autorizado por Félix el 17-11-2026 (excepción a la fase de piloto, AGENTS.md base 6).
--
-- Lo que pidió: «el cargando y descargando se guarda solamente en la app, con un registro en Supabase»; «la orden llega
-- al chófer cuando se emite o aprueba». Nada de esto va a Odoo: las órdenes se leen de Odoo en directo (servicios/viajes.py)
-- y aquí solo se guarda cada paso que marca el chófer. Documentación: docs/viajes.md.
--
-- Quién hace qué:
--   · El chófer (permiso «viajes.usar», con su contacto conductor de Odoo confirmado por su encargado,
--     public.usuarios.odoo_conductor_id) añade sus pasos. Solo los suyos y en orden: llegada a carga → cargando → cargado →
--     llegada a descarga → descargando → descargado. Una «incidencia» (con nota) se puede añadir en cualquier momento.
--   · Quien tiene «viajes.seguimiento» ve los pasos de las personas sobre las que tiene ese permiso
--     (privado.puedo_sobre: su centro, o todos si su perfil vale en todos los centros).
--   · Nadie cambia ni borra un paso: la tabla solo crece. Un paso marcado por error se aclara con una incidencia.
-- Límite: la base de datos no puede preguntar a Odoo si una orden es de ese chófer. La web lo comprueba antes de guardar
-- (src/app/viajes/acciones.ts llama a GET /api/chofer/viajes/{tarea}); alguien que se salte la web solo podría añadir
-- pasos a su propio nombre, y esos pasos no salen en ninguna pantalla salvo que la orden sea de verdad suya en Odoo.
-- No depende de 20261116000000_grupos_de_trabajo.sql ni de 20261117000000_ediciones_empleados.sql.

-- ---------------------------------------------------------------- tabla (solo se añade)
create table public.viajes_estados (
  id                bigint generated always as identity primary key,
  odoo_task_id      integer not null check (odoo_task_id > 0),              -- project.task (orden de transporte)
  usuario_id        uuid not null default auth.uid(),                       -- sin clave ajena: el registro se conserva
  odoo_conductor_id integer not null check (odoo_conductor_id > 0),         -- el contacto conductor de esa persona al marcarlo
  estado            text not null check (estado in ('llegada_carga', 'cargando', 'cargado', 'llegada_descarga',
                                                    'descargando', 'descargado', 'incidencia')),
  nota              text check (nota is null or char_length(nota) between 1 and 200),
  momento           timestamptz not null default now(),                     -- cuándo lo marcó (lo pone la base de datos)
  creado            timestamptz not null default now(),
  constraint viajes_estados_incidencia_con_nota check (estado <> 'incidencia' or nota is not null)
);
create index viajes_estados_tarea_idx on public.viajes_estados (odoo_task_id, usuario_id, momento desc, id desc);
create index viajes_estados_usuario_idx on public.viajes_estados (usuario_id, momento desc);

-- ---------------------------------------------------------------- el siguiente paso
-- Una sola lista para la base de datos; la web tiene la misma en src/lib/viajes.ts.
create or replace function privado.viaje_siguiente_paso(ultimo text)
returns text language sql immutable set search_path = ''
as $$
  select case coalesce(ultimo, '')
    when '' then 'llegada_carga'
    when 'llegada_carga' then 'cargando'
    when 'cargando' then 'cargado'
    when 'cargado' then 'llegada_descarga'
    when 'llegada_descarga' then 'descargando'
    when 'descargando' then 'descargado'
    else null end;
$$;
revoke all on function privado.viaje_siguiente_paso(text) from public, anon;
grant execute on function privado.viaje_siguiente_paso(text) to authenticated;

-- ---------------------------------------------------------------- comprobaciones al guardar un paso
-- Security definer para leer la ficha de la persona y sus pasos anteriores aunque la RLS no se los enseñe.
create or replace function privado.viajes_estado_al_alta()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  ficha record;
  ultimo text;
  toca text;
begin
  if (select auth.uid()) is not null and new.usuario_id is distinct from (select auth.uid()) then
    raise exception 'Solo puedes marcar tus propios viajes' using errcode = '42501';
  end if;
  select u.activo, u.odoo_conductor_id, u.vinculo_confirmado into ficha
    from public.usuarios u where u.id = new.usuario_id;
  if not found or not coalesce(ficha.activo, false) then
    raise exception 'Tu cuenta no está activa' using errcode = '42501';
  end if;
  if ficha.odoo_conductor_id is null or ficha.vinculo_confirmado is null then
    raise exception 'Tu encargado tiene que confirmar tu ficha de Odoo' using errcode = '42501';
  end if;
  new.odoo_conductor_id := ficha.odoo_conductor_id;
  new.momento := now();
  new.creado := now();
  new.nota := nullif(btrim(new.nota), '');
  if new.estado = 'incidencia' and new.nota is null then
    raise exception 'Escribe qué ha pasado' using errcode = '23514';
  end if;
  if new.estado = 'incidencia' then
    return new;
  end if;
  -- De uno en uno por orden y persona: dos toques seguidos no pueden marcar el mismo paso dos veces.
  perform pg_advisory_xact_lock(hashtext('trimodos.viajes'), hashtext(new.usuario_id::text || ':' || new.odoo_task_id));
  select e.estado into ultimo from public.viajes_estados e
   where e.usuario_id = new.usuario_id and e.odoo_task_id = new.odoo_task_id and e.estado <> 'incidencia'
   order by e.momento desc, e.id desc limit 1;
  toca := privado.viaje_siguiente_paso(ultimo);
  if toca is null then
    raise exception 'Este viaje ya está descargado' using errcode = '23514';
  end if;
  if new.estado <> toca then
    raise exception 'Ese paso no toca ahora. Recarga la pantalla.' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function privado.viajes_estado_al_alta() from public, anon, authenticated;
create trigger viajes_estados_al_alta before insert on public.viajes_estados
  for each row execute function privado.viajes_estado_al_alta();

create or replace function privado.viajes_solo_crece()
returns trigger language plpgsql set search_path = ''
as $$
begin
  raise exception 'Los pasos de un viaje no se cambian ni se borran' using errcode = '42501';
end;
$$;
revoke all on function privado.viajes_solo_crece() from public, anon, authenticated;
create trigger viajes_estados_solo_crece before update or delete on public.viajes_estados
  for each row execute function privado.viajes_solo_crece();
create trigger viajes_estados_sin_vaciar before truncate on public.viajes_estados
  for each statement execute function privado.viajes_solo_crece();

-- ---------------------------------------------------------------- a quién sigue cada uno
-- Las personas sobre las que tengo «viajes.seguimiento», calculadas una vez por consulta (no fila a fila). Usa
-- privado.puedo_sobre, así que sigue el mismo criterio de centros que el resto de la app (y el de departamentos si se
-- aplica 20261116000000_grupos_de_trabajo.sql).
create or replace function privado.viajes_a_mi_cargo()
returns setof uuid language sql stable security definer set search_path = ''
as $$
  select u.id from public.usuarios u
  where (select privado.tengo_permiso('viajes.seguimiento')) and privado.puedo_sobre('viajes.seguimiento', u.id);
$$;
revoke all on function privado.viajes_a_mi_cargo() from public, anon;
grant execute on function privado.viajes_a_mi_cargo() to authenticated;

-- ---------------------------------------------------------------- permisos (RLS)
alter table public.viajes_estados enable row level security;
revoke all on public.viajes_estados from public, anon, authenticated, service_role;
grant select, insert on public.viajes_estados to authenticated;
grant select on public.viajes_estados to service_role;

create policy "viajes_estados: el chófer añade los suyos" on public.viajes_estados for insert to authenticated
  with check (usuario_id = (select auth.uid()) and (select privado.tengo_permiso('viajes.usar')));
create policy "viajes_estados: los propios y los de quien sigue" on public.viajes_estados for select to authenticated
  using (usuario_id = (select auth.uid()) or usuario_id in (select privado.viajes_a_mi_cargo()));

-- ---------------------------------------------------------------- funciones para la API
-- Chóferes con su contacto conductor confirmado que sigue quien llama (para leer sus órdenes en Odoo).
create or replace function public.viajes_conductores_a_mi_cargo()
returns table (id uuid, nombre text, odoo_conductor_id integer)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not privado.tengo_permiso('viajes.seguimiento') then
    raise exception 'No tienes permiso para seguir los viajes' using errcode = '42501';
  end if;
  return query
    select u.id, u.nombre, u.odoo_conductor_id from public.usuarios u
    where u.activo and u.odoo_conductor_id is not null and u.vinculo_confirmado is not null
      and u.id in (select privado.viajes_a_mi_cargo())
    order by u.nombre, u.id;
end;
$$;

-- Órdenes empezadas y sin descargar desde una fecha (con la RLS de quien llama). Sirve para no perder un viaje largo
-- cuando su fecha prevista ya ha quedado atrás. Con «persona», solo las de esa persona.
create or replace function public.viajes_en_curso(desde timestamptz, persona uuid default null)
returns table (usuario_id uuid, odoo_task_id integer)
language sql stable security invoker set search_path = ''
as $$
  select t.usuario_id, t.odoo_task_id from (
    select distinct on (e.usuario_id, e.odoo_task_id) e.usuario_id, e.odoo_task_id, e.estado
    from public.viajes_estados e
    where e.momento >= desde and e.estado <> 'incidencia' and (persona is null or e.usuario_id = persona)
    order by e.usuario_id, e.odoo_task_id, e.momento desc, e.id desc) t
  where t.estado <> 'descargado'
  limit 1000;
$$;

-- Último paso de cada persona en cada una de estas órdenes, y su última incidencia (con la RLS de quien llama).
create or replace function public.viajes_ultimo_estado(tareas integer[])
returns table (usuario_id uuid, odoo_task_id integer, estado text, momento timestamptz, incidencias integer,
               ultima_incidencia timestamptz, nota text)
language sql stable security invoker set search_path = ''
as $$
  with filas as (
    select e.* from public.viajes_estados e where e.odoo_task_id = any (tareas[1:1000])
  ), pasos as (
    select distinct on (f.usuario_id, f.odoo_task_id) f.usuario_id, f.odoo_task_id, f.estado, f.momento
    from filas f where f.estado <> 'incidencia'
    order by f.usuario_id, f.odoo_task_id, f.momento desc, f.id desc
  ), incid as (
    select distinct on (f.usuario_id, f.odoo_task_id) f.usuario_id, f.odoo_task_id, f.momento, f.nota,
           (count(*) over (partition by f.usuario_id, f.odoo_task_id))::integer as n
    from filas f where f.estado = 'incidencia'
    order by f.usuario_id, f.odoo_task_id, f.momento desc, f.id desc
  )
  select coalesce(p.usuario_id, i.usuario_id), coalesce(p.odoo_task_id, i.odoo_task_id), p.estado, p.momento,
         coalesce(i.n, 0), i.momento, i.nota
  from pasos p full join incid i on i.usuario_id = p.usuario_id and i.odoo_task_id = p.odoo_task_id;
$$;

revoke all on function public.viajes_conductores_a_mi_cargo(), public.viajes_en_curso(timestamptz, uuid),
  public.viajes_ultimo_estado(integer[]) from public, anon;
grant execute on function public.viajes_conductores_a_mi_cargo(), public.viajes_en_curso(timestamptz, uuid),
  public.viajes_ultimo_estado(integer[]) to authenticated;

-- ---------------------------------------------------------------- permisos en los perfiles
update public.perfiles p
   set permisos = array(select distinct x from unnest(p.permisos || '{viajes.usar}'::text[]) as x order by x)
 where p.nombre = 'Chófer';
update public.perfiles p
   set permisos = array(select distinct x from unnest(p.permisos || '{viajes.seguimiento}'::text[]) as x order by x)
 where p.nombre in ('Administrador', 'Responsable');
