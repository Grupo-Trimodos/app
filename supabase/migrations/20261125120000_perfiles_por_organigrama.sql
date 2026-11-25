-- Perfiles y alcance según el organigrama de Odoo. Autorizado por Félix el 25-11-2026 (decisiones en
-- docs/acceso-y-perfiles.md, «Perfiles por organigrama»). Solo añade: no borra ni cambia ningún dato que ya exista, y
-- nada cambia para nadie hasta que la administración encienda «aplicar» (organigrama_ajustes).
--
--   · El PUESTO de la ficha de Odoo decide el perfil (tabla puestos_perfil, editable en Administración).
--   · El GERENTE de cada ficha decide quién está a cargo de quién: un responsable ve y gestiona a todo lo que tiene por
--     debajo, en cascada (el directo y los de encima), sin depender del centro.
--   · Una persona puede tener varias fichas (una por empresa). El árbol se monta por personas: lo que cuelga de
--     cualquiera de sus fichas es suyo.
--   · Administración ve y aprueba a toda su empresa aunque nadie dependa de ella (perfiles.alcance_odoo = 'empresa').
--   · De Odoo solo se lee. Las fotos del organigrama solo se añaden (AGENTS.md, base 3b).

-- ---------------------------------------------------------------- fotos del organigrama (solo se añaden)
create table public.organigrama_fotos (
  id      bigint generated always as identity primary key,
  tomada  timestamptz not null default now(),
  origen  text not null check (char_length(origen) between 1 and 80),
  huella  text not null,                     -- resumen del contenido: si no cambia, no se guarda otra foto igual
  fichas  integer not null check (fichas >= 0)
);

create table public.organigrama_fichas (
  foto_id         bigint not null references public.organigrama_fotos (id) on delete cascade,
  empleado_id     integer not null check (empleado_id > 0),
  nombre          text not null,
  empresa_id      integer,
  empresa         text,
  departamento_id integer,
  departamento    text,                      -- nombre completo («STINSA / Tráfico / Residuos Levante»)
  puesto_id       integer,
  puesto          text,
  gerente_id      integer,
  ubicacion_id    integer,
  ubicacion       text,
  primary key (foto_id, empleado_id)
);
create index organigrama_fichas_gerente_idx on public.organigrama_fichas (foto_id, gerente_id);

alter table public.organigrama_fotos enable row level security;
alter table public.organigrama_fichas enable row level security;
revoke all on public.organigrama_fotos, public.organigrama_fichas from anon, authenticated;
grant select on public.organigrama_fotos, public.organigrama_fichas to authenticated;
create policy "organigrama_fotos: la administración" on public.organigrama_fotos for select to authenticated
  using ((select privado.tengo_permiso('admin.usuarios')));
create policy "organigrama_fichas: la administración" on public.organigrama_fichas for select to authenticated
  using ((select privado.tengo_permiso('admin.usuarios')));

-- La foto en vigor: la última guardada.
create or replace function privado.foto_actual()
returns bigint language sql stable security definer set search_path = ''
as $$ select max(id) from public.organigrama_fotos; $$;
revoke all on function privado.foto_actual() from public, anon;
grant execute on function privado.foto_actual() to authenticated;

-- Guarda una foto entera de una vez (o nada). Solo la sincronización, con la clave de servidor.
create or replace function public.guardar_foto_organigrama(origen text, fichas jsonb)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $$
declare
  h text := md5(fichas::text);
  ultima record;
  nueva bigint;
begin
  if jsonb_typeof(fichas) <> 'array' or jsonb_array_length(fichas) = 0 then
    raise exception 'La foto del organigrama llega vacía: no se guarda' using errcode = '22023';
  end if;
  select id, huella into ultima from public.organigrama_fotos order by id desc limit 1;
  if ultima.huella = h then
    return jsonb_build_object('foto', ultima.id, 'nueva', false, 'fichas', jsonb_array_length(fichas));
  end if;
  insert into public.organigrama_fotos (origen, huella, fichas) values (left(origen, 80), h, jsonb_array_length(fichas))
    returning id into nueva;
  insert into public.organigrama_fichas (foto_id, empleado_id, nombre, empresa_id, empresa, departamento_id, departamento,
                                         puesto_id, puesto, gerente_id, ubicacion_id, ubicacion)
  select nueva, (f->>'empleado_id')::int, coalesce(f->>'nombre', ''), (f->>'empresa_id')::int, f->>'empresa',
         (f->>'departamento_id')::int, f->>'departamento', (f->>'puesto_id')::int, f->>'puesto',
         (f->>'gerente_id')::int, (f->>'ubicacion_id')::int, f->>'ubicacion'
  from jsonb_array_elements(fichas) f;
  return jsonb_build_object('foto', nueva, 'nueva', true, 'fichas', jsonb_array_length(fichas));
end;
$$;
revoke all on function public.guardar_foto_organigrama(text, jsonb) from public, anon, authenticated;
grant execute on function public.guardar_foto_organigrama(text, jsonb) to service_role;

-- ---------------------------------------------------------------- varias fichas por persona
-- usuarios.odoo_employee_id sigue siendo LA ficha de sus fichajes y ausencias (no cambia nada de los envíos).
-- Aquí, las demás fichas de la misma persona en otras empresas (Carmelo en STINSA y TRANSARGI, Loles en Trimodos y
-- TRANSARGI). Solo cuentan para el organigrama y el alcance; a ellas nunca se envía nada. Solo IDs: un nombre parecido
-- no prueba que sea la misma persona, la pone la administración a mano.
create table public.usuario_fichas_extra (
  usuario_id  uuid not null references public.usuarios (id) on delete cascade,
  empleado_id integer not null unique check (empleado_id > 0),
  autor       uuid references public.usuarios (id) on delete set null,
  creado      timestamptz not null default now(),
  primary key (usuario_id, empleado_id)
);
alter table public.usuario_fichas_extra enable row level security;
revoke all on public.usuario_fichas_extra from anon;
grant select, insert, delete on public.usuario_fichas_extra to authenticated;
create policy "usuario_fichas_extra: la propia y la administración" on public.usuario_fichas_extra for select to authenticated
  using (usuario_id = (select auth.uid()) or (select privado.tengo_permiso('admin.usuarios')));
create policy "usuario_fichas_extra: alta" on public.usuario_fichas_extra for insert to authenticated
  with check ((select privado.tengo_permiso('admin.usuarios')) and autor = (select auth.uid()));
create policy "usuario_fichas_extra: baja" on public.usuario_fichas_extra for delete to authenticated
  using ((select privado.tengo_permiso('admin.usuarios')));

-- Una ficha es de una sola persona: no puede ser la ficha principal de otra.
create or replace function privado.ficha_extra_libre()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if exists (select 1 from public.usuarios u where u.odoo_employee_id = new.empleado_id) then
    raise exception 'Esa ficha de Odoo ya es la ficha principal de una persona de la app' using errcode = '23505';
  end if;
  return new;
end;
$$;
revoke all on function privado.ficha_extra_libre() from public, anon, authenticated;
create trigger usuario_fichas_extra_libre before insert or update on public.usuario_fichas_extra
  for each row execute function privado.ficha_extra_libre();

-- Todas las fichas de cada persona activa: la principal y las demás.
create or replace function privado.fichas_personas()
returns table (usuario_id uuid, empleado_id integer)
language sql stable security definer set search_path = ''
as $$
  select u.id, u.odoo_employee_id from public.usuarios u where u.activo and u.odoo_employee_id is not null
  union
  select e.usuario_id, e.empleado_id from public.usuario_fichas_extra e join public.usuarios u on u.id = e.usuario_id and u.activo;
$$;
revoke all on function privado.fichas_personas() from public, anon;
grant execute on function privado.fichas_personas() to authenticated;

-- ---------------------------------------------------------------- interruptor
-- Mientras esté apagado, la sincronización guarda las fotos y la administración ve la vista previa, pero nadie gana ni
-- pierde perfiles.
create table public.organigrama_ajustes (
  id       boolean primary key default true check (id),
  aplicar  boolean not null default false,
  -- Empresas «paraguas» de Odoo (9 = TRIMODOS, S.L.): quien es de ellas cuenta como de todas para el alcance «empresa».
  empresas_grupo integer[] not null default '{9}',
  cambiado timestamptz not null default now(),
  autor    uuid references public.usuarios (id) on delete set null
);
insert into public.organigrama_ajustes (id) values (true);
alter table public.organigrama_ajustes enable row level security;
revoke all on public.organigrama_ajustes from anon;
grant select, update on public.organigrama_ajustes to authenticated;
create policy "organigrama_ajustes: los ve la administración" on public.organigrama_ajustes for select to authenticated
  using ((select privado.tengo_permiso('admin.usuarios')));
create policy "organigrama_ajustes: los cambia la administración" on public.organigrama_ajustes for update to authenticated
  using ((select privado.tengo_permiso('admin.usuarios')))
  with check ((select privado.tengo_permiso('admin.usuarios')) and autor = (select auth.uid()));

-- ---------------------------------------------------------------- quién está a cargo de quién
-- Personas que cuelgan de «jefe» en el organigrama en vigor, en cascada. Se recorre por fichas, pero al llegar a una
-- persona se sigue también por sus otras fichas (Pilar → Carmelo en STINSA → la gente de Carmelo en TRANSARGI).
create or replace function privado.a_cargo_de(jefe uuid)
returns setof uuid
language sql stable security definer set search_path = ''
as $$
  with recursive
  fp as (select * from privado.fichas_personas()),
  f as (select o.empleado_id, o.gerente_id from public.organigrama_fichas o where o.foto_id = privado.foto_actual()),
  mias as (select empleado_id from fp where usuario_id = jefe),
  abajo (empleado_id) as (
    select f.empleado_id from f where f.gerente_id in (select empleado_id from mias)
    union
    select f.empleado_id
    from abajo a
    left join fp p1 on p1.empleado_id = a.empleado_id
    left join fp p2 on p2.usuario_id = p1.usuario_id
    join f on f.gerente_id = a.empleado_id or f.gerente_id = p2.empleado_id
  )
  select distinct fp.usuario_id from abajo join fp using (empleado_id) where fp.usuario_id <> jefe;
$$;
revoke all on function privado.a_cargo_de(uuid) from public, anon;
grant execute on function privado.a_cargo_de(uuid) to authenticated;

-- Empresas de Odoo de cada persona (por sus fichas en la foto en vigor). Quien es de una empresa «paraguas» (Grupo
-- Trimodos: su personal trabaja para STINSA y TRANSARGI a la vez) cuenta como de todas las empresas de la foto.
create or replace function privado.empresas_de(persona uuid)
returns setof integer
language sql stable security definer set search_path = ''
as $$
  with suyas as (
    select distinct o.empresa_id
    from privado.fichas_personas() fp
    join public.organigrama_fichas o on o.empleado_id = fp.empleado_id and o.foto_id = privado.foto_actual()
    where fp.usuario_id = persona and o.empresa_id is not null
  )
  select empresa_id from suyas
  union
  select distinct o.empresa_id from public.organigrama_fichas o
  where o.foto_id = privado.foto_actual() and o.empresa_id is not null
    and exists (select 1 from suyas, public.organigrama_ajustes a where suyas.empresa_id = any (a.empresas_grupo));
$$;
revoke all on function privado.empresas_de(uuid) from public, anon;
grant execute on function privado.empresas_de(uuid) to authenticated;

-- ¿Es «objetivo» de alguna de las empresas de «yo»? No es simétrica: la administración de la empresa paraguas llega a
-- todas, pero la de TRANSARGI no llega al personal de la paraguas (para eso cuentan sus fichas reales, sin ampliar).
create or replace function privado.misma_empresa(yo uuid, objetivo uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from privado.empresas_de(yo) x(id)
    join privado.fichas_personas() fp on fp.usuario_id = objetivo
    join public.organigrama_fichas o on o.empleado_id = fp.empleado_id and o.foto_id = privado.foto_actual()
    where o.empresa_id = x.id);
$$;
revoke all on function privado.misma_empresa(uuid, uuid) from public, anon;
grant execute on function privado.misma_empresa(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------- alcance de cada perfil según Odoo
-- Además del centro (y de «todos los centros»), los permisos de un perfil sobre otras personas pueden valer:
--   · 'organigrama': sobre quien cuelga de mí en Odoo (Responsable).
--   · 'empresa': sobre quien comparte empresa conmigo en Odoo (Administración).
alter table public.perfiles
  add column alcance_odoo text check (alcance_odoo in ('organigrama', 'empresa'));

update public.perfiles set alcance_odoo = 'organigrama',
  descripcion = 'Quien tiene personas a su cargo en Odoo (es su gerente): ve, aprueba y corrige lo de toda la gente que cuelga de él'
 where nombre = 'Responsable';

-- Perfiles nuevos (no básicos: se editan y se pueden borrar). Empiezan con los permisos del piloto de su pantalla.
insert into public.perfiles (nombre, descripcion, permisos, todos_los_centros, pantalla, alcance_odoo)
select v.nombre, v.descripcion, coalesce((select p.permisos from public.perfiles p where p.nombre = v.copia), '{}') || v.mas,
       v.todos, v.pantalla, v.alcance
from (values
  ('Tráfico', 'Técnicos, coordinadores, encargados y jefes de tráfico y comerciales', 'Oficina', '{deca.usar}'::text[], false, 'oficina', null),
  ('Administración', 'Administrativos: ven y aprueban las vacaciones de toda su empresa', 'Oficina',
   '{equipo.ver,ausencias.aprobar}'::text[], false, 'oficina', 'empresa'),
  ('Prevención y Calidad', 'Técnicos de prevención y calidad: su trabajo es de todo el grupo', 'Oficina', '{}'::text[], true, 'oficina', null),
  ('Almacén', 'Encargados de almacén: trabajan desde el móvil', 'Operario', '{}'::text[], false, 'campo', null),
  ('Dirección', 'Dirección: entran al cuadro de mando', null, '{direccion.ver,calendario.usar,equipos.ver}'::text[], false, 'direccion', null)
) as v (nombre, descripcion, copia, mas, todos, pantalla, alcance)
on conflict (nombre) do nothing;
-- Sin permisos repetidos y en orden, como los demás.
update public.perfiles set permisos = array(select distinct x from unnest(permisos) x order by x)
 where nombre in ('Tráfico', 'Administración', 'Prevención y Calidad', 'Almacén', 'Dirección');

-- ---------------------------------------------------------------- puesto de Odoo → perfil
create table public.puestos_perfil (
  puesto    text primary key check (char_length(puesto) between 2 and 80 and puesto = lower(btrim(puesto))),
  perfil_id bigint not null references public.perfiles (id) on delete cascade,
  cambiado  timestamptz not null default now()
);
alter table public.puestos_perfil enable row level security;
revoke all on public.puestos_perfil from anon;
grant select, insert, update, delete on public.puestos_perfil to authenticated;
create policy "puestos_perfil: los ve la administración" on public.puestos_perfil for select to authenticated
  using ((select privado.tengo_permiso('admin.usuarios')));
create policy "puestos_perfil: alta" on public.puestos_perfil for insert to authenticated
  with check ((select privado.tengo_permiso('admin.usuarios')));
create policy "puestos_perfil: cambio" on public.puestos_perfil for update to authenticated
  using ((select privado.tengo_permiso('admin.usuarios'))) with check ((select privado.tengo_permiso('admin.usuarios')));
create policy "puestos_perfil: baja" on public.puestos_perfil for delete to authenticated
  using ((select privado.tengo_permiso('admin.usuarios')));

-- Lo decidido el 25-11-2026. Los puestos se emparejan por nombre (en Odoo hay puestos repetidos por empresa con ids
-- distintos: «Técnico de Tráfico», «Dirección»…).
insert into public.puestos_perfil (puesto, perfil_id)
select v.puesto, p.id from (values
  ('conductor', 'Chófer'),
  ('operario de almacén', 'Operario'),
  ('mecánico', 'Operario'),
  ('técnico de tráfico', 'Tráfico'),
  ('coordinador de tráfico', 'Tráfico'),
  ('encargado de tráfico', 'Tráfico'),
  ('jefe de tráfico', 'Tráfico'),
  ('responsable de tráfico', 'Tráfico'),
  ('comercial', 'Tráfico'),
  ('administrativo', 'Administración'),
  ('técnico de prevención y calidad', 'Prevención y Calidad'),
  ('encargado de almacén', 'Almacén'),
  ('dirección', 'Dirección'),
  ('administrador tic', 'Administrador')
) as v (puesto, perfil) join public.perfiles p on p.nombre = v.perfil
on conflict (puesto) do nothing;

-- ---------------------------------------------------------------- qué perfiles le tocan a cada persona
create or replace function privado.perfiles_segun_odoo()
returns table (usuario_id uuid, perfil_id bigint)
language sql stable security definer set search_path = ''
as $$
  select distinct fp.usuario_id, pp.perfil_id
  from privado.fichas_personas() fp
  join public.organigrama_fichas o on o.empleado_id = fp.empleado_id and o.foto_id = privado.foto_actual()
  join public.puestos_perfil pp on pp.puesto = lower(btrim(o.puesto))
  union
  select p.usuario_id, r.id
  from (select distinct fp.usuario_id from privado.fichas_personas() fp) p
  join public.perfiles r on r.nombre = 'Responsable'
  where exists (select 1 from privado.a_cargo_de(p.usuario_id));
$$;
revoke all on function privado.perfiles_segun_odoo() from public, anon, authenticated;

-- Cuántas fichas cuelgan de una ficha en Odoo (en cascada), tengan o no cuenta en la app.
create or replace function privado.fichas_debajo(empleado integer)
returns integer
language sql stable security definer set search_path = ''
as $$
  with recursive f as (select o.empleado_id, o.gerente_id from public.organigrama_fichas o where o.foto_id = privado.foto_actual()),
  abajo (empleado_id) as (
    select f.empleado_id from f where f.gerente_id = empleado
    union
    select f.empleado_id from f join abajo a on f.gerente_id = a.empleado_id
  )
  select count(*)::int from abajo where empleado_id <> empleado;
$$;
revoke all on function privado.fichas_debajo(integer) from public, anon, authenticated;

-- Vista previa para la administración: cada ficha de Odoo, con su persona de la app (si la tiene), los perfiles que le
-- tocarían y a cuántas personas tendría a su cargo.
create or replace function public.vista_previa_organigrama()
returns table (empleado_id integer, nombre text, empresa text, departamento text, puesto text, gerente_id integer, gerente text,
               usuario_id uuid, persona text, ficha_principal boolean, perfiles_odoo text[], perfiles_actuales text[],
               a_cargo integer, debajo_en_odoo integer, sin_perfil boolean)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not privado.tengo_permiso('admin.usuarios') then
    raise exception 'Solo la administración puede ver la vista previa' using errcode = '42501';
  end if;
  return query
  with f as (select * from public.organigrama_fichas o where o.foto_id = privado.foto_actual()),
       fp as (select * from privado.fichas_personas()),
       seg as (select s.usuario_id, array_agg(p.nombre order by p.nombre) as nombres
               from privado.perfiles_segun_odoo() s join public.perfiles p on p.id = s.perfil_id group by s.usuario_id),
       act as (select up.usuario_id, array_agg(distinct p.nombre order by p.nombre) as nombres
               from public.usuario_perfil up join public.perfiles p on p.id = up.perfil_id group by up.usuario_id)
  select f.empleado_id, f.nombre, f.empresa, f.departamento, f.puesto, f.gerente_id, g.nombre,
         fp.usuario_id, coalesce(nullif(u.nombre, ''), u.codigo, u.email),
         u.odoo_employee_id = f.empleado_id,
         coalesce(seg.nombres, '{}'), coalesce(act.nombres, '{}'),
         case when fp.usuario_id is null then 0 else (select count(*)::int from privado.a_cargo_de(fp.usuario_id)) end,
         privado.fichas_debajo(f.empleado_id),
         not exists (select 1 from public.puestos_perfil pp where pp.puesto = lower(btrim(f.puesto)))
  from f
  left join f g on g.empleado_id = f.gerente_id
  left join fp on fp.empleado_id = f.empleado_id
  left join public.usuarios u on u.id = fp.usuario_id
  left join seg on seg.usuario_id = fp.usuario_id
  left join act on act.usuario_id = fp.usuario_id
  order by f.departamento nulls last, f.nombre;
end;
$$;
revoke all on function public.vista_previa_organigrama() from public, anon;
grant execute on function public.vista_previa_organigrama() to authenticated;

-- Aplica los perfiles de Odoo: pone los que faltan y quita los de origen 'odoo' que ya no tocan. Las asignaciones
-- hechas a mano (origen 'manual') nunca se tocan. Lo llama la sincronización (clave de servidor) o la administración.
create or replace function public.aplicar_perfiles_organigrama()
returns jsonb language plpgsql volatile security definer set search_path = ''
as $$
declare
  puestos integer := 0;
  quitados integer := 0;
begin
  if (select auth.uid()) is not null and not privado.tengo_permiso('admin.usuarios') then
    raise exception 'Solo la administración puede aplicar los perfiles' using errcode = '42501';
  end if;
  if not (select a.aplicar from public.organigrama_ajustes a) then
    return jsonb_build_object('estado', 'apagado');
  end if;
  if privado.foto_actual() is null then
    return jsonb_build_object('estado', 'sin_foto');
  end if;
  insert into public.usuario_perfil (usuario_id, perfil_id, centro_id, origen)
  select d.usuario_id, d.perfil_id, null, 'odoo' from privado.perfiles_segun_odoo() d
  on conflict do nothing;
  get diagnostics puestos = row_count;
  delete from public.usuario_perfil up
   where up.origen = 'odoo'
     and not exists (select 1 from privado.perfiles_segun_odoo() d where d.usuario_id = up.usuario_id and d.perfil_id = up.perfil_id);
  get diagnostics quitados = row_count;
  return jsonb_build_object('estado', 'aplicado', 'puestos', puestos, 'quitados', quitados);
end;
$$;
revoke all on function public.aplicar_perfiles_organigrama() from public, anon;
grant execute on function public.aplicar_perfiles_organigrama() to authenticated, service_role;

-- ---------------------------------------------------------------- permisos sobre otras personas
-- Lo de antes (superadmin; perfil «todos los centros»; compartir centro y departamento) y, además, el alcance de Odoo.
create or replace function privado.puedo_sobre(permiso text, objetivo uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select u.activo and (u.es_admin or exists (
      select 1 from public.usuario_perfil up join public.perfiles pf on pf.id = up.perfil_id
      where up.usuario_id = u.id and permiso = any (pf.permisos)
        and (pf.todos_los_centros
          or exists (
            select 1 from public.usuario_perfil o join public.usuarios ou on ou.id = o.usuario_id
            where o.usuario_id = objetivo and o.centro_id = up.centro_id
              and (up.departamento_id is null or ou.departamento_id = up.departamento_id))
          or (pf.alcance_odoo = 'organigrama' and objetivo in (select privado.a_cargo_de(u.id)))
          or (pf.alcance_odoo = 'empresa' and objetivo <> u.id and privado.misma_empresa(u.id, objetivo))
        )))
    from public.usuarios u where u.id = (select auth.uid())), false);
$$;

create or replace function privado.personas_a_cargo(permiso text)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  with yo as (
    select u.id, u.es_admin from public.usuarios u where u.id = (select auth.uid()) and u.activo
  ), mios as (
    select up.centro_id, up.departamento_id, pf.todos_los_centros, pf.alcance_odoo
    from yo join public.usuario_perfil up on up.usuario_id = yo.id
            join public.perfiles pf on pf.id = up.perfil_id
    where permiso = any (pf.permisos)
  )
  select u.id from public.usuarios u
  where exists (select 1 from yo where yo.es_admin) or exists (select 1 from mios where mios.todos_los_centros)
  union
  select o.usuario_id
  from mios join public.usuario_perfil o on o.centro_id = mios.centro_id
            join public.usuarios ou on ou.id = o.usuario_id
  where mios.departamento_id is null or ou.departamento_id = mios.departamento_id
  union
  select privado.a_cargo_de(yo.id) from yo where exists (select 1 from mios where mios.alcance_odoo = 'organigrama')
  union
  select fp.usuario_id from yo, privado.fichas_personas() fp
  where exists (select 1 from mios where mios.alcance_odoo = 'empresa') and fp.usuario_id <> yo.id
    and privado.misma_empresa(yo.id, fp.usuario_id);
$$;

-- Quién me aprueba: los de antes y, además, mis responsables en Odoo (el directo y los de encima) y la administración
-- de mi empresa.
create or replace function public.quien_me_aprueba(permiso text)
returns table (nombre text, centro text)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct coalesce(nullif(u.nombre, ''), u.codigo, u.email) as nombre,
         case when pf.alcance_odoo = 'organigrama' and (select auth.uid()) in (select privado.a_cargo_de(u.id)) then 'tu responsable en Odoo'
              when pf.alcance_odoo = 'empresa' then 'administración de tu empresa'
              else coalesce(c.nombre, 'todos los centros') end as centro
  from public.usuario_perfil up
  join public.perfiles pf on pf.id = up.perfil_id and permiso = any (pf.permisos)
  join public.usuarios u on u.id = up.usuario_id and u.activo and u.id <> (select auth.uid())
  left join public.centros c on c.id = up.centro_id
  where permiso in ('ausencias.aprobar', 'ropa.gestionar')
    and (pf.todos_los_centros
      or exists (select 1 from public.usuario_perfil yo where yo.usuario_id = (select auth.uid()) and yo.centro_id = up.centro_id)
      or (pf.alcance_odoo = 'organigrama' and (select auth.uid()) in (select privado.a_cargo_de(u.id)))
      or (pf.alcance_odoo = 'empresa' and privado.misma_empresa(u.id, (select auth.uid()))));
$$;

-- ---------------------------------------------------------------- «Mi gente» para la pantalla Mi equipo
-- Personas a mi cargo por Odoo (organigrama o empresa) para los permisos del área «Mi equipo», con su puesto, su
-- departamento y si dependen de mí directamente. Solo nombres y datos de trabajo.
create or replace function public.mi_gente_odoo()
returns table (usuario_id uuid, nombre text, codigo text, puesto text, departamento text, directo boolean)
language sql stable security definer set search_path = ''
as $$
  with gente as (
    select privado.personas_a_cargo('equipo.ver') as id
    union select privado.personas_a_cargo('ausencias.aprobar')
    union select privado.personas_a_cargo('fichaje.corregir')
  ), odoo as (
    select privado.a_cargo_de((select auth.uid())) as id
    union
    select fp.usuario_id from privado.fichas_personas() fp
    where exists (select 1 from public.usuario_perfil up join public.perfiles pf on pf.id = up.perfil_id
                  where up.usuario_id = (select auth.uid()) and pf.alcance_odoo = 'empresa')
      and privado.misma_empresa((select auth.uid()), fp.usuario_id)
  ), mias as (select empleado_id from privado.fichas_personas() where usuario_id = (select auth.uid()))
  select u.id, coalesce(nullif(u.nombre, ''), u.codigo, u.email), u.codigo, o.puesto, o.departamento,
         exists (select 1 from privado.fichas_personas() fp2
                 join public.organigrama_fichas o2 on o2.empleado_id = fp2.empleado_id and o2.foto_id = privado.foto_actual()
                 where fp2.usuario_id = u.id and o2.gerente_id in (select empleado_id from mias))
  from public.usuarios u
  left join public.organigrama_fichas o on o.empleado_id = u.odoo_employee_id and o.foto_id = privado.foto_actual()
  where u.activo and u.id <> (select auth.uid())
    and u.id in (select id from odoo) and u.id in (select id from gente)
  order by 6 desc, 5, 2;
$$;
revoke all on function public.mi_gente_odoo() from public, anon;
grant execute on function public.mi_gente_odoo() to authenticated;
