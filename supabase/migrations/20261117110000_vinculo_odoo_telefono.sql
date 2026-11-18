-- Enlace de cada persona de la app con Odoo, confirmado por su responsable.
-- Autorizado por Félix el 17-11-2026 (excepción a la fase de piloto, AGENTS.md base 6).
--
-- Lo que pidió: «los chóferes se enlazan con empleados de Odoo a través del número de teléfono que se añadirá al
-- registrarse el chófer, y luego el encargado tendrá que confirmar que el perfil de la app y el de Odoo son la misma
-- persona». Decisiones del 18-11-2026: el móvil solo se pide a quien entra con código y PIN; a quien entra con
-- Microsoft o Google se le propone la ficha por su correo. Solo se comparan teléfonos de empresa.
--
-- Dos ids de Odoo por persona:
--   · odoo_employee_id (ya existía): la ficha de empleado (hr.employee). De ella dependen los envíos de fichajes y
--     ausencias a Odoo (servicios/rrhh.py). Tocarla afecta a una integración con Odoo: ver docs/odoo.md.
--   · odoo_conductor_id (nuevo): el contacto conductor (res.partner con is_driver), que es el que llevan las órdenes de
--     transporte (project.task.driver_id). En Odoo no está unido a la ficha de empleado. Hoy no se envía nada con él.
--
-- Quién hace qué:
--   · Quien entra con código y PIN guarda su móvil con public.guardar_mi_telefono(texto): solo el suyo y solo mientras
--     su enlace no esté confirmado. Va a public.telefonos_personas (no a usuarios: así no lo ve quien lee usuarios).
--   · Su responsable (perfil con «personas.vincular» en un centro de esa persona) o la administración
--     (superadministrador o «admin.usuarios») confirma el enlace o lo deshace en «Mi equipo → Enlazar con Odoo». La
--     confirmación SOLO sale del servidor (servicios/organizacion.py): comprueba antes que la ficha es una de las que
--     Odoo propone para esa persona y llama a public.confirmar_vinculo_odoo(autor, …) con la clave de servidor. La
--     función vuelve a comprobar aquí los permisos de «autor» (no los de la clave de servidor). Desde el navegador no
--     se puede llamar.
--   · Nadie confirma su propio enlace (salvo un superadministrador). A un superadministrador solo lo enlaza otro.
--   · Una ficha de empleado no se confirma para dos personas, y un contacto conductor tampoco.
--   · Con la jornada abierta y su entrada ya en Odoo no se cambia la ficha (la salida iría a otra ficha).
--   · Al deshacer, la ficha queda «descartada» (usuarios.vinculo_rechazado): el enlace automático por correo o código
--     de servicios/rrhh.py no vuelve a ponerla.
--   · Todo queda en public.vinculos_odoo_historial, que solo crece.
--   · Si alguien cambia odoo_employee_id por otra vía (Administración → Personas, el enlace automático, el editor
--     SQL), el enlace deja de contar como confirmado y queda anotado. Un cambio de móvil por fuera, también.
-- Las políticas de cambio de public.usuarios no se tocan.
-- No depende de 20261116000000_grupos_de_trabajo.sql ni de 20261117000000_ediciones_empleados.sql (si están, se usa
-- su versión de privado.puedo_sobre, con el límite de departamento).

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
revoke all on function privado.normalizar_telefono(text) from public, anon, authenticated;

-- ---------------------------------------------------------------- columnas nuevas en usuarios
alter table public.usuarios
  add column odoo_conductor_id integer,
  add column vinculo_confirmado_por uuid references public.usuarios (id) on delete set null,
  add column vinculo_confirmado timestamptz,
  add column vinculo_rechazado integer,   -- ficha de empleado descartada al deshacer: el enlace automático no la pone
  add constraint usuarios_odoo_conductor_valido check (odoo_conductor_id is null or odoo_conductor_id > 0),
  add constraint usuarios_vinculo_rechazado_valido check (vinculo_rechazado is null or vinculo_rechazado > 0),
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

-- ---------------------------------------------------------------- cómo entra cada persona
-- Quien entra con código y PIN tiene en Supabase Auth un correo interno «codigo@pin.grupotrimodos.com» (src/lib/pin.ts,
-- src/app/admin/acciones.ts). Quien entra con Microsoft o Google, su correo real. Solo para las funciones de abajo.
create or replace function privado.entra_con_pin(persona uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from auth.users a where a.id = persona and lower(a.email) like '%@pin.grupotrimodos.com');
$$;
revoke all on function privado.entra_con_pin(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- quién puede enlazar a quién
-- Responsable con «personas.vincular» en un centro de esa persona, o la administración. Nunca a sí mismo, salvo un
-- superadministrador; a un superadministrador, solo otro superadministrador.
create or replace function privado.puedo_vincular(persona uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select (select auth.uid()) is not null
     and (persona <> (select auth.uid()) or (select privado.es_admin()))
     and (not coalesce((select u.es_admin from public.usuarios u where u.id = persona), false) or (select privado.es_admin()))
     and ((select privado.tengo_permiso('admin.usuarios'))
          or ((select privado.tengo_permiso('personas.vincular')) and privado.puedo_sobre('personas.vincular', persona)));
$$;
revoke all on function privado.puedo_vincular(uuid) from public, anon;
grant execute on function privado.puedo_vincular(uuid) to authenticated;   -- lo usa la política de telefonos_personas

-- Lo mismo, para quien confirma desde el servidor (clave de servidor, sin sesión): se calculan los permisos de «autor»
-- poniendo su id como usuario de la consulta solo durante la comprobación. Así vale la misma regla, con o sin el
-- límite de departamento de 20261116000000. Si auth.uid() no lo recogiera, devolvería falso: nunca deja pasar de más.
create or replace function privado.puede_vincular(autor uuid, persona uuid)
returns boolean language plpgsql volatile security definer set search_path = ''
as $$
declare
  antes_sub text := current_setting('request.jwt.claim.sub', true);
  antes_claims text := current_setting('request.jwt.claims', true);
  puede boolean;
begin
  if autor is null or persona is null then
    return false;
  end if;
  perform set_config('request.jwt.claim.sub', autor::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', autor, 'role', 'authenticated')::text, true);
  puede := coalesce(privado.puedo_vincular(persona), false) and (select auth.uid()) = autor;
  perform set_config('request.jwt.claim.sub', coalesce(antes_sub, ''), true);
  perform set_config('request.jwt.claims', coalesce(antes_claims, ''), true);
  return puede;
end;
$$;
revoke all on function privado.puede_vincular(uuid, uuid) from public, anon, authenticated;

-- ¿Tiene la jornada abierta con la entrada ya en Odoo? Entonces su salida tiene que ir a la misma ficha.
create or replace function privado.jornada_abierta_en_odoo(persona uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select coalesce((select f.tipo in ('entrada', 'reanudar') and f.odoo_estado = 'enviado'
                   from public.fichajes f where f.usuario_id = persona
                   order by f.momento desc, f.id desc limit 1), false);
$$;
revoke all on function privado.jornada_abierta_en_odoo(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- móvil de quien entra con código y PIN
-- Aparte de usuarios: las políticas de usuarios enseñan la fila entera (a Seguridad, a quien gestiona la ropa…).
-- Aquí lo ven solo la persona y quien puede enlazarla (privado.puedo_vincular, que incluye a la administración).
create table public.telefonos_personas (
  usuario_id  uuid primary key references public.usuarios (id) on delete cascade,
  telefono    text not null check (telefono ~ '^[1-9][0-9]{7,14}$' and (telefono !~ '^34' or telefono ~ '^34[6789][0-9]{8}$')),
  actualizado timestamptz not null default now()
);
create index telefonos_personas_telefono_idx on public.telefonos_personas (telefono);

alter table public.telefonos_personas enable row level security;
revoke all on public.telefonos_personas from public, anon, authenticated, service_role;
grant select on public.telefonos_personas to authenticated, service_role;   -- se cambia solo con guardar_mi_telefono
create policy "telefonos_personas: los ve la persona y quien puede enlazarla" on public.telefonos_personas
  for select to authenticated
  using (usuario_id = (select auth.uid()) or privado.puedo_vincular(usuario_id));

-- ---------------------------------------------------------------- historial (solo se añade)
create table public.vinculos_odoo_historial (
  id               bigint generated always as identity primary key,
  persona          uuid not null,          -- sin clave ajena: el historial se conserva aunque se borre la cuenta
  autor            uuid,                   -- null: el servidor o el editor SQL
  accion           text not null check (accion in ('confirmar', 'deshacer', 'cambio_administracion', 'cambio_servidor',
                                                   'cambio_telefono')),
  telefono         text,                   -- el móvil de la persona en ese momento (solo quien entra con PIN)
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
--   · Una persona con sesión no puede tocar a mano la confirmación, el contacto conductor ni la ficha descartada.
--   · El servidor (enlace automático de servicios/rrhh.py) no puede volver a poner la ficha descartada: se ignora.
--   · Si cambia la ficha de empleado sin pasar por la confirmación, el enlace deja de estar confirmado y se anota. Si la
--     cambia la administración a mano, deja de estar descartada (es una decisión expresa).
-- Security definer para escribir en el historial; quién lo hace se distingue por auth.uid() (null en el servidor y en
-- el editor SQL).
create or replace function privado.vigilar_vinculo_odoo()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  yo uuid := (select auth.uid());
  cambia_confirmacion boolean := new.vinculo_confirmado is distinct from old.vinculo_confirmado
                                 or new.vinculo_confirmado_por is distinct from old.vinculo_confirmado_por;
begin
  if coalesce(current_setting('trimodos.vinculo_odoo', true), '') = 'rpc' then
    return new;
  end if;
  if yo is not null and (cambia_confirmacion or new.odoo_conductor_id is distinct from old.odoo_conductor_id
                         or new.vinculo_rechazado is distinct from old.vinculo_rechazado) then
    raise exception 'El enlace con Odoo se confirma desde «Mi equipo → Enlazar con Odoo»' using errcode = '42501';
  end if;
  if new.odoo_employee_id is distinct from old.odoo_employee_id and not cambia_confirmacion then
    if yo is null and new.odoo_employee_id is not null and new.odoo_employee_id = old.vinculo_rechazado then
      new.odoo_employee_id := old.odoo_employee_id;   -- su responsable la descartó
      return new;
    end if;
    if yo is not null then
      new.vinculo_rechazado := null;
    end if;
    new.vinculo_confirmado := null;
    new.vinculo_confirmado_por := null;
    insert into public.vinculos_odoo_historial (persona, autor, accion, telefono, empleado_antes, empleado_nuevo,
                                                conductor_antes, conductor_nuevo)
    values (new.id, yo, case when yo is null then 'cambio_servidor' else 'cambio_administracion' end,
            (select t.telefono from public.telefonos_personas t where t.usuario_id = new.id),
            old.odoo_employee_id, new.odoo_employee_id, old.odoo_conductor_id, new.odoo_conductor_id);
  end if;
  return new;
end;
$$;
revoke all on function privado.vigilar_vinculo_odoo() from public, anon, authenticated;
create trigger usuarios_vigilar_vinculo_odoo before update on public.usuarios
  for each row execute function privado.vigilar_vinculo_odoo();

-- Un cambio del móvil fuera de guardar_mi_telefono (servidor o editor SQL) con el enlace ya confirmado queda anotado.
create or replace function privado.vigilar_telefono()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  persona uuid := coalesce(new.usuario_id, old.usuario_id);
begin
  if coalesce(current_setting('trimodos.vinculo_odoo', true), '') <> 'rpc'
     and (tg_op <> 'UPDATE' or new.telefono is distinct from old.telefono)
     and exists (select 1 from public.usuarios u where u.id = persona and u.vinculo_confirmado is not null) then
    insert into public.vinculos_odoo_historial (persona, autor, accion, telefono, empleado_antes, empleado_nuevo,
                                                conductor_antes, conductor_nuevo)
    select persona, (select auth.uid()), 'cambio_telefono', case when tg_op = 'DELETE' then null else new.telefono end,
           u.odoo_employee_id, u.odoo_employee_id, u.odoo_conductor_id, u.odoo_conductor_id
    from public.usuarios u where u.id = persona;
  end if;
  return coalesce(new, old);
end;
$$;
revoke all on function privado.vigilar_telefono() from public, anon, authenticated;
create trigger telefonos_personas_vigilar after insert or update or delete on public.telefonos_personas
  for each row execute function privado.vigilar_telefono();

-- ---------------------------------------------------------------- funciones para la web y la API
-- Mi móvil: si me lo piden (entro con código y PIN), el que he dado y si mi ficha ya está confirmada.
create or replace function public.mi_telefono()
returns table (pide boolean, telefono text, confirmado timestamptz)
language sql stable security definer set search_path = ''
as $$
  select privado.entra_con_pin(u.id), t.telefono, u.vinculo_confirmado
  from public.usuarios u left join public.telefonos_personas t on t.usuario_id = u.id
  where u.id = (select auth.uid()) and u.activo;
$$;

-- La persona que entra con código y PIN guarda su móvil (solo el suyo, solo mientras su enlace no esté confirmado).
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
  if not privado.entra_con_pin(yo) then
    raise exception 'Entras con tu cuenta de Microsoft o Google: tu responsable busca tu ficha por tu correo. No hace falta tu móvil.'
      using errcode = '42501';
  end if;
  if fila.vinculo_confirmado is not null then
    raise exception 'Tu responsable ya ha confirmado tu ficha. Si has cambiado de móvil, díselo a él.' using errcode = '42501';
  end if;
  if limpio is null then
    raise exception 'Ese número no parece un móvil. Escríbelo así: 612 345 678' using errcode = '22023';
  end if;
  perform set_config('trimodos.vinculo_odoo', 'rpc', true);
  insert into public.telefonos_personas as t (usuario_id, telefono) values (yo, limpio)
  on conflict (usuario_id) do update set telefono = excluded.telefono, actualizado = now();
  perform set_config('trimodos.vinculo_odoo', '', true);
  return limpio;
end;
$$;

-- Personas que quien llama puede enlazar (activas), con lo justo para decidir. La RLS de usuarios no se toca: esta
-- función filtra con el mismo criterio que privado.puedo_vincular. El móvil, solo de quien entra con PIN; el correo,
-- solo de quien entra con Microsoft o Google (con él se busca su ficha).
create or replace function public.personas_para_vincular()
returns table (id uuid, nombre text, con_pin boolean, telefono text, telefono_repetido boolean, correo text, chofer boolean,
               odoo_employee_id integer, odoo_conductor_id integer, vinculo_rechazado integer, confirmado timestamptz,
               confirmado_por text)
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
  return query
    select u.id, u.nombre, pin.si, case when pin.si then t.telefono end,
           pin.si and t.telefono is not null and exists (
             select 1 from public.telefonos_personas o join public.usuarios ou on ou.id = o.usuario_id
             where o.telefono = t.telefono and o.usuario_id <> u.id and ou.activo),
           case when pin.si then null else nullif(btrim(u.email), '') end,
           exists (select 1 from public.usuario_perfil up join public.perfiles pf on pf.id = up.perfil_id
                   where up.usuario_id = u.id and 'chofer.usar' = any (pf.permisos)),
           u.odoo_employee_id, u.odoo_conductor_id, u.vinculo_rechazado, u.vinculo_confirmado, c.nombre
    from public.usuarios u
    cross join lateral (select privado.entra_con_pin(u.id) as si) pin
    left join public.telefonos_personas t on t.usuario_id = u.id
    left join public.usuarios c on c.id = u.vinculo_confirmado_por
    where u.activo
      and (u.id <> yo or es_super)
      and (not u.es_admin or es_super)
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
-- SOLO desde el servidor (servicios/organizacion.py, con la clave de servidor), después de comprobar en Odoo que la
-- ficha es una de las propuestas para esa persona. «autor» es quien pulsa «Son la misma persona».
create or replace function public.confirmar_vinculo_odoo(autor uuid, persona uuid, empleado integer, conductor integer default null)
returns void language plpgsql volatile security definer set search_path = ''
as $$
declare
  fila record;
begin
  if not privado.puede_vincular(autor, persona) then
    raise exception 'No puedes enlazar a esta persona: no está en tus centros o es tu propia cuenta' using errcode = '42501';
  end if;
  if empleado is null or empleado <= 0 or (conductor is not null and conductor <= 0) then
    raise exception 'Elige la ficha de empleado de Odoo' using errcode = '22023';
  end if;
  -- De uno en uno: dos responsables no pueden dar la misma ficha a dos personas a la vez.
  perform pg_advisory_xact_lock(hashtext('trimodos.vinculo_odoo'));
  select u.activo, u.odoo_employee_id, u.odoo_conductor_id, u.vinculo_confirmado into fila
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
  if fila.odoo_employee_id is distinct from empleado and privado.jornada_abierta_en_odoo(persona) then
    raise exception 'Tiene la jornada abierta y su entrada ya está en otra ficha de Odoo. Confírmalo cuando fiche la salida.'
      using errcode = '55000';
  end if;
  perform set_config('trimodos.vinculo_odoo', 'rpc', true);
  update public.usuarios
     set odoo_employee_id = empleado, odoo_conductor_id = conductor, vinculo_rechazado = null,
         vinculo_confirmado_por = autor, vinculo_confirmado = now()
   where id = persona;
  perform set_config('trimodos.vinculo_odoo', '', true);
  insert into public.vinculos_odoo_historial (persona, autor, accion, telefono, empleado_antes, empleado_nuevo,
                                              conductor_antes, conductor_nuevo)
  values (persona, autor, 'confirmar', (select t.telefono from public.telefonos_personas t where t.usuario_id = persona),
          fila.odoo_employee_id, empleado, fila.odoo_conductor_id, conductor);
end;
$$;

-- Deshacer un enlace confirmado. SOLO desde el servidor, como confirmar. La persona queda sin ficha de Odoo hasta que
-- se vuelva a confirmar, y la ficha que tenía queda descartada: el enlace automático por correo o código
-- (servicios/rrhh.py) no se la vuelve a poner.
create or replace function public.deshacer_vinculo_odoo(autor uuid, persona uuid)
returns void language plpgsql volatile security definer set search_path = ''
as $$
declare
  fila record;
begin
  if not privado.puede_vincular(autor, persona) then
    raise exception 'No puedes cambiar el enlace de esta persona: no está en tus centros o es tu propia cuenta' using errcode = '42501';
  end if;
  select u.odoo_employee_id, u.odoo_conductor_id, u.vinculo_confirmado into fila
    from public.usuarios u where u.id = persona for update;
  if not found or fila.vinculo_confirmado is null then
    raise exception 'Esta persona no tiene un enlace confirmado' using errcode = '22023';
  end if;
  if privado.jornada_abierta_en_odoo(persona) then
    raise exception 'Tiene la jornada abierta y su entrada ya está en esa ficha de Odoo. Deshazlo cuando fiche la salida.'
      using errcode = '55000';
  end if;
  perform set_config('trimodos.vinculo_odoo', 'rpc', true);
  update public.usuarios
     set odoo_employee_id = null, odoo_conductor_id = null, vinculo_confirmado_por = null, vinculo_confirmado = null,
         vinculo_rechazado = fila.odoo_employee_id
   where id = persona;
  perform set_config('trimodos.vinculo_odoo', '', true);
  insert into public.vinculos_odoo_historial (persona, autor, accion, telefono, empleado_antes, empleado_nuevo,
                                              conductor_antes, conductor_nuevo)
  values (persona, autor, 'deshacer', (select t.telefono from public.telefonos_personas t where t.usuario_id = persona),
          fila.odoo_employee_id, null, fila.odoo_conductor_id, null);
end;
$$;

revoke all on function public.mi_telefono(), public.guardar_mi_telefono(text), public.personas_para_vincular(),
  public.fichas_odoo_enlazadas(), public.confirmar_vinculo_odoo(uuid, uuid, integer, integer),
  public.deshacer_vinculo_odoo(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.mi_telefono(), public.guardar_mi_telefono(text), public.personas_para_vincular(),
  public.fichas_odoo_enlazadas() to authenticated;
-- Confirmar y deshacer: solo el servidor (clave de servidor). Nunca la sesión del navegador.
grant execute on function public.confirmar_vinculo_odoo(uuid, uuid, integer, integer),
  public.deshacer_vinculo_odoo(uuid, uuid) to service_role;

-- ---------------------------------------------------------------- permiso en los perfiles
update public.perfiles p
   set permisos = array(select distinct x from unnest(p.permisos || '{personas.vincular}'::text[]) as x order by x)
 where p.nombre in ('Responsable', 'Administrador');
