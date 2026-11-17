-- Enlace de cada persona de la app con Odoo, a través de su móvil y confirmado por su responsable.
-- Autorizado por Félix el 17-11-2026 (excepción a la fase de piloto, AGENTS.md base 6).
--
-- Lo que pidió: «los chóferes se enlazan con empleados de Odoo a través del número de teléfono que se añadirá al
-- registrarse el chófer, y luego el encargado tendrá que confirmar que el perfil de la app y el de Odoo son la misma
-- persona».
--
-- Dos ids de Odoo por persona:
--   · odoo_employee_id (ya existía): la ficha de empleado (hr.employee). De ella dependen los envíos de fichajes y
--     ausencias a Odoo (servicios/rrhh.py). Tocarla afecta a una integración con Odoo: ver docs/odoo.md.
--   · odoo_conductor_id (nuevo): el contacto conductor (res.partner con is_driver), que es el que llevan las órdenes de
--     transporte (project.task.driver_id). En Odoo no está unido a la ficha de empleado. Hoy no se envía nada con él.
--
-- Quién hace qué:
--   · La persona guarda su móvil con public.guardar_mi_telefono(texto), solo el suyo y solo mientras su enlace no esté
--     confirmado. Se guarda normalizado: solo dígitos, con el prefijo del país (34 para España).
--   · Su responsable (perfil con «personas.vincular» en un centro de esa persona) o la administración
--     (superadministrador o «admin.usuarios») confirma el enlace con public.confirmar_vinculo_odoo(...) y lo deshace con
--     public.deshacer_vinculo_odoo(...). Nadie confirma su propio enlace (salvo un superadministrador).
--   · Una ficha de empleado no se confirma para dos personas, y un contacto conductor tampoco.
--   · Todo queda en public.vinculos_odoo_historial, que solo crece.
--   · Si alguien cambia odoo_employee_id por otra vía (Administración → Personas, el enlace automático por correo o
--     código de servicios/rrhh.py, el editor SQL), el enlace deja de contar como confirmado y queda anotado.
-- Las políticas de cambio de public.usuarios no se tocan.
-- No depende de 20261116000000_grupos_de_trabajo.sql ni de 20261117000000_ediciones_empleados.sql.

-- ---------------------------------------------------------------- normalizar un teléfono
-- «612 34 56 78», «+34 612345678», «0034-612-345-678» → «34612345678». Con «+» o «00» se acepta otro país.
-- Devuelve null si no es un número válido.
create or replace function privado.normalizar_telefono(texto text)
returns text language plpgsql immutable set search_path = ''
as $$
declare
  t text := regexp_replace(replace(coalesce(texto, ''), chr(160), ''), '[[:space:]().·/-]', '', 'g');
begin
  if t ~ '^\+[0-9]+$' then
    t := substr(t, 2);
  elsif t ~ '^00[0-9]+$' then
    t := substr(t, 3);
  elsif t ~ '^[6789][0-9]{8}$' then
    t := '34' || t;
  elsif t !~ '^34[6789][0-9]{8}$' then
    return null;
  end if;
  if t !~ '^[1-9][0-9]{7,14}$' or (t ~ '^34' and t !~ '^34[6789][0-9]{8}$') then
    return null;
  end if;
  return t;
end;
$$;
revoke all on function privado.normalizar_telefono(text) from public, anon;
grant execute on function privado.normalizar_telefono(text) to authenticated;

-- ---------------------------------------------------------------- columnas nuevas en usuarios
alter table public.usuarios
  add column telefono text,
  add column odoo_conductor_id integer,
  add column vinculo_confirmado_por uuid references public.usuarios (id) on delete set null,
  add column vinculo_confirmado timestamptz,
  add constraint usuarios_telefono_formato check (
    telefono is null or (telefono ~ '^[1-9][0-9]{7,14}$' and (telefono !~ '^34' or telefono ~ '^34[6789][0-9]{8}$'))),
  add constraint usuarios_odoo_conductor_valido check (odoo_conductor_id is null or odoo_conductor_id > 0),
  add constraint usuarios_vinculo_coherente check (
    (vinculo_confirmado is not null or vinculo_confirmado_por is null)
    and (vinculo_confirmado is null or odoo_employee_id is not null));

-- Un contacto conductor, para una sola persona.
create unique index usuarios_odoo_conductor_unico on public.usuarios (odoo_conductor_id)
  where odoo_conductor_id is not null;
-- Una ficha de empleado CONFIRMADA, para una sola persona. Solo las confirmadas: el enlace automático por correo o
-- código (servicios/rrhh.py) escribe odoo_employee_id sin confirmar y no debe fallar por un duplicado ya existente
-- (eso pararía los envíos de fichajes de todos). Además, confirmar_vinculo_odoo rechaza una ficha que ya tenga otra
-- persona, confirmada o no.
create unique index usuarios_odoo_empleado_confirmado_unico on public.usuarios (odoo_employee_id)
  where odoo_employee_id is not null and vinculo_confirmado is not null;
create index usuarios_odoo_empleado_idx on public.usuarios (odoo_employee_id) where odoo_employee_id is not null;
create index usuarios_vinculo_confirmado_por_idx on public.usuarios (vinculo_confirmado_por)
  where vinculo_confirmado_por is not null;

-- ---------------------------------------------------------------- historial (solo se añade)
create table public.vinculos_odoo_historial (
  id               bigint generated always as identity primary key,
  persona          uuid not null,          -- sin clave ajena: el historial se conserva aunque se borre la cuenta
  autor            uuid,                   -- null: el servidor o el editor SQL
  accion           text not null check (accion in ('confirmar', 'deshacer', 'cambio_administracion', 'cambio_servidor')),
  telefono         text,                   -- el móvil de la persona en ese momento
  empleado_antes   integer,
  empleado_nuevo   integer,
  conductor_antes  integer,
  conductor_nuevo  integer,
  creado           timestamptz not null default now()
);
create index vinculos_odoo_historial_persona_idx on public.vinculos_odoo_historial (persona, creado desc);
create index vinculos_odoo_historial_autor_idx on public.vinculos_odoo_historial (autor);

alter table public.vinculos_odoo_historial enable row level security;
revoke all on public.vinculos_odoo_historial from public, anon, authenticated, service_role;
grant select on public.vinculos_odoo_historial to authenticated, service_role;
create policy "vinculos_odoo_historial: lo ven la administración y quien actuó" on public.vinculos_odoo_historial
  for select to authenticated
  using (autor = (select auth.uid()) or (select privado.tengo_permiso('admin.usuarios')));

create or replace function privado.historial_solo_crece()
returns trigger language plpgsql set search_path = ''
as $$
begin
  raise exception 'El historial de enlaces con Odoo no se modifica ni se borra' using errcode = '42501';
end;
$$;
revoke all on function privado.historial_solo_crece() from public, anon, authenticated;
create trigger vinculos_odoo_historial_solo_crece before update or delete on public.vinculos_odoo_historial
  for each row execute function privado.historial_solo_crece();
create trigger vinculos_odoo_historial_sin_vaciar before truncate on public.vinculos_odoo_historial
  for each statement execute function privado.historial_solo_crece();

-- ---------------------------------------------------------------- vigilancia de los cambios en usuarios
-- Las funciones de abajo marcan su propia escritura con «trimodos.vinculo_odoo = rpc». Cualquier otro cambio:
--   · Una persona con sesión no puede tocar a mano la confirmación ni el contacto conductor.
--   · Si cambia la ficha de empleado sin pasar por la confirmación, el enlace deja de estar confirmado y se anota.
-- Security definer para escribir en el historial; quién lo hace se distingue por auth.uid() (null en el servidor y en
-- el editor SQL).
create or replace function privado.vigilar_vinculo_odoo()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  cambia_confirmacion boolean := new.vinculo_confirmado is distinct from old.vinculo_confirmado
                                 or new.vinculo_confirmado_por is distinct from old.vinculo_confirmado_por;
begin
  if coalesce(current_setting('trimodos.vinculo_odoo', true), '') = 'rpc' then
    return new;
  end if;
  if (select auth.uid()) is not null
     and (cambia_confirmacion or new.odoo_conductor_id is distinct from old.odoo_conductor_id) then
    raise exception 'El enlace con Odoo se confirma desde «Mi equipo → Enlazar con Odoo»' using errcode = '42501';
  end if;
  if new.odoo_employee_id is distinct from old.odoo_employee_id and not cambia_confirmacion then
    new.vinculo_confirmado := null;
    new.vinculo_confirmado_por := null;
    insert into public.vinculos_odoo_historial (persona, autor, accion, telefono, empleado_antes, empleado_nuevo,
                                                conductor_antes, conductor_nuevo)
    values (new.id, (select auth.uid()),
            case when (select auth.uid()) is null then 'cambio_servidor' else 'cambio_administracion' end,
            new.telefono, old.odoo_employee_id, new.odoo_employee_id, old.odoo_conductor_id, new.odoo_conductor_id);
  end if;
  return new;
end;
$$;
revoke all on function privado.vigilar_vinculo_odoo() from public, anon, authenticated;
create trigger usuarios_vigilar_vinculo_odoo before update on public.usuarios
  for each row execute function privado.vigilar_vinculo_odoo();

-- ---------------------------------------------------------------- quién puede enlazar a quién
-- Responsable con «personas.vincular» en un centro de esa persona, o la administración. Nunca a sí mismo, salvo un
-- superadministrador.
create or replace function privado.puedo_vincular(persona uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select (select auth.uid()) is not null
     and (persona <> (select auth.uid()) or (select privado.es_admin()))
     and ((select privado.tengo_permiso('admin.usuarios'))
          or ((select privado.tengo_permiso('personas.vincular')) and privado.puedo_sobre('personas.vincular', persona)));
$$;
revoke all on function privado.puedo_vincular(uuid) from public, anon;
grant execute on function privado.puedo_vincular(uuid) to authenticated;

-- ---------------------------------------------------------------- funciones para la web y la API
-- La persona guarda su propio móvil (solo el suyo, solo mientras su enlace no esté confirmado).
create or replace function public.guardar_mi_telefono(texto text)
returns text language plpgsql volatile security definer set search_path = ''
as $$
declare
  yo uuid := (select auth.uid());
  fila record;
  limpio text := privado.normalizar_telefono(texto);
begin
  if yo is null then
    raise exception 'Tienes que iniciar sesión con una cuenta activa' using errcode = '42501';
  end if;
  select u.activo, u.vinculo_confirmado into fila from public.usuarios u where u.id = yo for update;
  if not found or not coalesce(fila.activo, false) then
    raise exception 'Tienes que iniciar sesión con una cuenta activa' using errcode = '42501';
  end if;
  if fila.vinculo_confirmado is not null then
    raise exception 'Tu responsable ya ha confirmado tu ficha. Si has cambiado de móvil, díselo a él.' using errcode = '42501';
  end if;
  if limpio is null then
    raise exception 'Ese número no parece un móvil. Escríbelo así: 612 345 678' using errcode = '22023';
  end if;
  update public.usuarios set telefono = limpio where id = yo;
  return limpio;
end;
$$;

-- Personas que quien llama puede enlazar (activas), con lo justo para decidir. La RLS de usuarios no se toca: esta
-- función filtra con privado.puedo_vincular.
create or replace function public.personas_para_vincular()
returns table (id uuid, nombre text, telefono text, chofer boolean, odoo_employee_id integer, odoo_conductor_id integer,
               confirmado timestamptz, confirmado_por text)
language plpgsql stable security definer set search_path = ''
as $$
declare
  yo uuid := (select auth.uid());
  administro boolean := privado.tengo_permiso('admin.usuarios');
  vinculo boolean := privado.tengo_permiso('personas.vincular');
  es_super boolean := privado.es_admin();
begin
  if yo is null or not (administro or vinculo) then
    raise exception 'No tienes permiso para enlazar personas con Odoo' using errcode = '42501';
  end if;
  -- Mismo criterio que privado.puedo_vincular, con los permisos de quien llama calculados una sola vez.
  return query
    select u.id, u.nombre, u.telefono,
           exists (select 1 from public.usuario_perfil up join public.perfiles pf on pf.id = up.perfil_id
                   where up.usuario_id = u.id and 'chofer.usar' = any (pf.permisos)),
           u.odoo_employee_id, u.odoo_conductor_id, u.vinculo_confirmado, c.nombre
    from public.usuarios u
    left join public.usuarios c on c.id = u.vinculo_confirmado_por
    where u.activo
      and (u.id <> yo or es_super)
      and (administro or privado.puedo_sobre('personas.vincular', u.id))
    order by u.nombre, u.id;
end;
$$;

-- Fichas de Odoo que ya tiene alguien en la app (solo los ids), para no proponerlas a otra persona.
create or replace function public.fichas_odoo_enlazadas()
returns table (empleado integer, conductor integer)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not ((select privado.tengo_permiso('personas.vincular')) or (select privado.tengo_permiso('admin.usuarios'))) then
    raise exception 'No tienes permiso para enlazar personas con Odoo' using errcode = '42501';
  end if;
  return query
    select u.odoo_employee_id, u.odoo_conductor_id from public.usuarios u
    where u.odoo_employee_id is not null or u.odoo_conductor_id is not null;
end;
$$;

-- Confirmar que la persona de la app y la ficha de Odoo (y su contacto conductor, si es chófer) son la misma.
create or replace function public.confirmar_vinculo_odoo(persona uuid, empleado integer, conductor integer default null)
returns void language plpgsql volatile security definer set search_path = ''
as $$
declare
  fila record;
begin
  if not privado.puedo_vincular(persona) then
    raise exception 'No puedes enlazar a esta persona: no está en tus centros o es tu propia cuenta' using errcode = '42501';
  end if;
  if empleado is null or empleado <= 0 or (conductor is not null and conductor <= 0) then
    raise exception 'Elige la ficha de empleado de Odoo' using errcode = '22023';
  end if;
  -- De uno en uno: dos responsables no pueden dar la misma ficha a dos personas a la vez.
  perform pg_advisory_xact_lock(hashtext('trimodos.vinculo_odoo'));
  select u.activo, u.telefono, u.odoo_employee_id, u.odoo_conductor_id, u.vinculo_confirmado into fila
    from public.usuarios u where u.id = persona for update;
  if not found or not fila.activo then
    raise exception 'Esta persona no está activa en la app' using errcode = '22023';
  end if;
  if fila.vinculo_confirmado is not null then
    raise exception 'Esta persona ya está enlazada. Deshaz el enlace antes de cambiarlo.' using errcode = '23505';
  end if;
  if exists (select 1 from public.usuarios o where o.id <> persona and o.odoo_employee_id = empleado) then
    raise exception 'Esa ficha de Odoo ya está enlazada con otra persona de la app. Avisa a administración.' using errcode = '23505';
  end if;
  if conductor is not null and exists (select 1 from public.usuarios o where o.id <> persona and o.odoo_conductor_id = conductor) then
    raise exception 'Ese contacto conductor ya está enlazado con otra persona de la app. Avisa a administración.' using errcode = '23505';
  end if;
  perform set_config('trimodos.vinculo_odoo', 'rpc', true);
  update public.usuarios
     set odoo_employee_id = empleado, odoo_conductor_id = conductor,
         vinculo_confirmado_por = (select auth.uid()), vinculo_confirmado = now()
   where id = persona;
  perform set_config('trimodos.vinculo_odoo', '', true);
  insert into public.vinculos_odoo_historial (persona, autor, accion, telefono, empleado_antes, empleado_nuevo,
                                              conductor_antes, conductor_nuevo)
  values (persona, (select auth.uid()), 'confirmar', fila.telefono, fila.odoo_employee_id, empleado,
          fila.odoo_conductor_id, conductor);
end;
$$;

-- Deshacer un enlace confirmado: la persona queda sin ficha de Odoo hasta que se vuelva a confirmar (el enlace
-- automático por correo o código de servicios/rrhh.py puede volver a ponerle una ficha sin confirmar).
create or replace function public.deshacer_vinculo_odoo(persona uuid)
returns void language plpgsql volatile security definer set search_path = ''
as $$
declare
  fila record;
begin
  if not privado.puedo_vincular(persona) then
    raise exception 'No puedes cambiar el enlace de esta persona: no está en tus centros o es tu propia cuenta' using errcode = '42501';
  end if;
  select u.telefono, u.odoo_employee_id, u.odoo_conductor_id, u.vinculo_confirmado into fila
    from public.usuarios u where u.id = persona for update;
  if not found or fila.vinculo_confirmado is null then
    raise exception 'Esta persona no tiene un enlace confirmado' using errcode = '22023';
  end if;
  perform set_config('trimodos.vinculo_odoo', 'rpc', true);
  update public.usuarios
     set odoo_employee_id = null, odoo_conductor_id = null, vinculo_confirmado_por = null, vinculo_confirmado = null
   where id = persona;
  perform set_config('trimodos.vinculo_odoo', '', true);
  insert into public.vinculos_odoo_historial (persona, autor, accion, telefono, empleado_antes, empleado_nuevo,
                                              conductor_antes, conductor_nuevo)
  values (persona, (select auth.uid()), 'deshacer', fila.telefono, fila.odoo_employee_id, null, fila.odoo_conductor_id, null);
end;
$$;

revoke all on function public.guardar_mi_telefono(text), public.personas_para_vincular(), public.fichas_odoo_enlazadas(),
  public.confirmar_vinculo_odoo(uuid, integer, integer), public.deshacer_vinculo_odoo(uuid) from public, anon;
grant execute on function public.guardar_mi_telefono(text), public.personas_para_vincular(), public.fichas_odoo_enlazadas(),
  public.confirmar_vinculo_odoo(uuid, integer, integer), public.deshacer_vinculo_odoo(uuid) to authenticated;

-- ---------------------------------------------------------------- permiso en los perfiles
update public.perfiles p
   set permisos = array(select distinct x from unnest(p.permisos || '{personas.vincular}'::text[]) as x order by x)
 where p.nombre in ('Responsable', 'Administrador');
