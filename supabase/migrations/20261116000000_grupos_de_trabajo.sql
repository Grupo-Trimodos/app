-- Organización por grupos de trabajo. Solo añade; no borra ni cambia ningún dato que ya exista.
-- Cada ficha responde a cuatro preguntas, y Odoo manda en las cuatro (docs/acceso-y-perfiles.md):
--   · dónde           → centros (oficina y almacén) o zonas (chóferes). Odoo: «Ubicación de trabajo».
--   · en qué área     → departamentos. Odoo: «Departamento».
--   · qué hace        → tipos de transporte, solo chóferes. Odoo: «Puesto de trabajo».
--   · su responsable  → centros.responsable_id y departamentos.responsable_id. Odoo: «Gerente» / responsable del departamento.
-- Esta migración prepara la estructura. La sincronización desde Odoo llegará después y rellenará los campos «odoo_*»
-- y las filas con origen = 'odoo'. Lo creado a mano (origen = 'manual') queda para las excepciones.

-- ---------------------------------------------------------------- centros y zonas
-- Un chófer no tiene centro de trabajo, tiene zona. Zona y centro son lo mismo para los permisos: el grupo en el que
-- está la persona y en el que su responsable ve y aprueba. Por eso comparten tabla, con «tipo».
-- (No confundir con public.zonas, que agrupa chóferes por cliente o ruta y está oculta en el piloto.)
alter table public.centros
  add column tipo              text not null default 'centro' check (tipo in ('centro', 'zona')),
  add column origen            text not null default 'manual' check (origen in ('odoo', 'manual')),
  add column odoo_ubicacion_id integer unique,
  add column responsable_id    uuid references public.usuarios (id) on delete set null;
create index centros_responsable_idx on public.centros (responsable_id);

-- ---------------------------------------------------------------- departamentos (un solo nivel)
create table public.departamentos (
  id                   bigint generated always as identity primary key,
  nombre               text not null unique check (char_length(nombre) between 2 and 80),
  origen               text not null default 'manual' check (origen in ('odoo', 'manual')),
  odoo_departamento_id integer unique,
  responsable_id       uuid references public.usuarios (id) on delete set null,
  activo               boolean not null default true,
  creado               timestamptz not null default now()
);
create index departamentos_responsable_idx on public.departamentos (responsable_id);

-- ---------------------------------------------------------------- tipos de transporte (qué hace cada chófer)
create table public.tipos_transporte (
  id             bigint generated always as identity primary key,
  nombre         text not null unique check (char_length(nombre) between 2 and 80),
  origen         text not null default 'manual' check (origen in ('odoo', 'manual')),
  odoo_puesto_id integer unique,
  activo         boolean not null default true,
  creado         timestamptz not null default now()
);

alter table public.departamentos enable row level security;
alter table public.tipos_transporte enable row level security;
revoke all on public.departamentos, public.tipos_transporte from anon;
grant select, insert, update, delete on public.departamentos, public.tipos_transporte to authenticated;

create policy "departamentos: los ve cualquier usuario" on public.departamentos for select to authenticated using (true);
create policy "departamentos: alta" on public.departamentos for insert to authenticated
  with check ((select privado.tengo_permiso('admin.usuarios')));
create policy "departamentos: cambio" on public.departamentos for update to authenticated
  using ((select privado.tengo_permiso('admin.usuarios'))) with check ((select privado.tengo_permiso('admin.usuarios')));
create policy "departamentos: baja" on public.departamentos for delete to authenticated
  using ((select privado.tengo_permiso('admin.usuarios')));

create policy "tipos de transporte: los ve cualquier usuario" on public.tipos_transporte for select to authenticated using (true);
create policy "tipos de transporte: alta" on public.tipos_transporte for insert to authenticated
  with check ((select privado.tengo_permiso('admin.usuarios')));
create policy "tipos de transporte: cambio" on public.tipos_transporte for update to authenticated
  using ((select privado.tengo_permiso('admin.usuarios'))) with check ((select privado.tengo_permiso('admin.usuarios')));
create policy "tipos de transporte: baja" on public.tipos_transporte for delete to authenticated
  using ((select privado.tengo_permiso('admin.usuarios')));

-- ---------------------------------------------------------------- a qué grupo pertenece cada persona
-- Departamento y tipo de transporte: uno por persona, en su ficha (solo los cambia la administración o la sincronización).
alter table public.usuarios
  add column departamento_id    bigint references public.departamentos (id) on delete set null,
  add column tipo_transporte_id bigint references public.tipos_transporte (id) on delete set null;
create index usuarios_departamento_idx on public.usuarios (departamento_id);
create index usuarios_tipo_transporte_idx on public.usuarios (tipo_transporte_id);

-- Centro o zona: sigue en usuario_perfil (una persona puede estar en varios). Se añade:
--   · origen: 'odoo' lo pone la sincronización; 'manual', la administración (excepciones y equipos temporales).
--   · departamento_id: si se rellena, los permisos de ese perfil sobre otras personas valen solo para ese
--     departamento dentro del centro. Vacío = todo el centro, como hasta ahora.
alter table public.usuario_perfil
  add column origen          text not null default 'manual' check (origen in ('odoo', 'manual')),
  add column departamento_id bigint references public.departamentos (id) on delete set null;
create index usuario_perfil_departamento_idx on public.usuario_perfil (departamento_id);

-- ---------------------------------------------------------------- permisos sobre otras personas
-- Igual que antes (superadmin; perfil «todos los centros»; o compartir centro), con el límite de departamento.
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
        and (pf.todos_los_centros or exists (
          select 1 from public.usuario_perfil o join public.usuarios ou on ou.id = o.usuario_id
          where o.usuario_id = objetivo and o.centro_id = up.centro_id
            and (up.departamento_id is null or ou.departamento_id = up.departamento_id)))))
    from public.usuarios u where u.id = (select auth.uid())), false);
$$;

-- Las mismas personas que puedo_sobre(permiso, …) acepta, calculadas UNA vez por consulta y no una por fila: con 200
-- personas y miles de fichajes, preguntar fila a fila tardaba segundos a un responsable.
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
    select up.centro_id, up.departamento_id, pf.todos_los_centros
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
  where mios.departamento_id is null or ou.departamento_id = mios.departamento_id;
$$;
revoke all on function privado.personas_a_cargo(text) from public, anon;
grant execute on function privado.personas_a_cargo(text) to authenticated;

-- Fichajes y ausencias son las tablas que crecen: su lectura usa la lista calculada una vez. Ven lo mismo que antes.
drop policy "fichajes: los propios y los de su equipo" on public.fichajes;
create policy "fichajes: los propios y los de su equipo" on public.fichajes for select to authenticated
  using (usuario_id = (select auth.uid())
         or usuario_id in (select privado.personas_a_cargo('equipo.ver'))
         or usuario_id in (select privado.personas_a_cargo('fichaje.corregir')));

drop policy "ausencias: las propias y las de su equipo" on public.ausencias;
create policy "ausencias: las propias y las de su equipo" on public.ausencias for select to authenticated
  using (usuario_id = (select auth.uid())
         or usuario_id in (select privado.personas_a_cargo('equipo.ver'))
         or usuario_id in (select privado.personas_a_cargo('ausencias.aprobar')));
