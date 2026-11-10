-- Jornadas completas para el cálculo de la web. Sin tablas ni cambios de RLS.
-- La lectura mantiene la sesión del usuario y filtra además el alcance de corrección cuando se solicita.
create or replace function public.fichajes_para_jornada(desde timestamptz, persona uuid default null, corregibles boolean default false)
returns setof public.fichajes
language sql stable security invoker set search_path = ''
as $$
  select f.* from public.fichajes f
  where (persona is null or f.usuario_id = persona)
    and (not corregibles or (f.usuario_id <> auth.uid() and privado.puedo_sobre('fichaje.corregir', f.usuario_id)))
    and not exists (
      select 1 from public.fichajes cierre
      where cierre.usuario_id = f.usuario_id and cierre.tipo = 'salida' and cierre.momento < desde
        and (cierre.momento, cierre.id) >= (f.momento, f.id)
    )
  order by f.momento, f.id;
$$;
revoke all on function public.fichajes_para_jornada(timestamptz, uuid, boolean) from public, anon;
grant execute on function public.fichajes_para_jornada(timestamptz, uuid, boolean) to authenticated;

-- Nunca olvidar el estado por antigüedad. El mismo bloqueo protege fichajes y correcciones.
create or replace function privado.fichaje_en_orden()
returns trigger language plpgsql set search_path = ''
as $$
declare
  previo public.fichajes;
  entrada public.fichajes;
  cierre public.fichajes;
begin
  perform pg_advisory_xact_lock(hashtextextended('fichajes:' || new.usuario_id::text, 0));
  if new.origen = 'correccion' then
    -- Una salida correctora no puede duplicar otra ni preceder a la entrada que cierra.
    if new.tipo = 'salida' then
      select * into previo from public.fichajes f where f.usuario_id = new.usuario_id
        and f.momento <= new.momento order by f.momento desc, f.id desc limit 1;
      if previo.id is null or previo.tipo = 'salida' then
        raise exception 'No hay una jornada abierta en esa fecha y hora' using errcode = '23514';
      end if;
    end if;
    return new;
  end if;
  select * into previo from public.fichajes f where f.usuario_id = new.usuario_id
    order by f.momento desc, f.id desc limit 1;
  select * into cierre from public.fichajes f where f.usuario_id = new.usuario_id and f.tipo = 'salida'
    order by f.momento desc, f.id desc limit 1;
  select * into entrada from public.fichajes f where f.usuario_id = new.usuario_id and f.tipo = 'entrada'
    and (cierre.id is null or (f.momento, f.id) > (cierre.momento, cierre.id))
    order by f.momento, f.id limit 1;
  if entrada.id is not null and now() >= entrada.momento + interval '16 hours' then
    raise exception 'Tienes una jornada pendiente de cierre. Avisa a tu responsable para poder iniciar otra.' using errcode = '23514';
  end if;
  if not ((coalesce(previo.tipo, 'salida') = 'salida' and new.tipo = 'entrada')
          or (previo.tipo in ('entrada', 'reanudar') and new.tipo in ('pausa', 'salida'))
          or (previo.tipo = 'pausa' and new.tipo in ('reanudar', 'salida'))) then
    raise exception 'Ese fichaje no corresponde ahora. Revisa tu jornada.' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function privado.fichaje_en_orden() from public, anon, authenticated;

-- Cierre explícito de UNA jornada pendiente, con comprobación bajo bloqueo y registro añadido (nunca editado).
create or replace function public.cerrar_jornada(entrada_id bigint, momento_salida timestamptz, motivo text)
returns bigint language plpgsql security invoker set search_path = ''
as $$
declare
  entrada public.fichajes;
  ultimo public.fichajes;
  nuevo_id bigint;
begin
  select * into entrada from public.fichajes where id = entrada_id and tipo = 'entrada';
  if entrada.id is null or entrada.usuario_id = auth.uid()
     or not coalesce(privado.puedo_sobre('fichaje.corregir', entrada.usuario_id), false) then
    raise exception 'No puedes cerrar esta jornada' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('fichajes:' || entrada.usuario_id::text, 0));
  if exists (select 1 from public.fichajes f where f.usuario_id = entrada.usuario_id and f.tipo = 'salida'
             and (f.momento, f.id) > (entrada.momento, entrada.id)) then
    raise exception 'La jornada ya está cerrada. Recarga la página.' using errcode = '23514';
  end if;
  if now() < entrada.momento + interval '16 hours' then
    raise exception 'La jornada todavía no está pendiente de cierre' using errcode = '23514';
  end if;
  if exists (select 1 from public.fichajes f where f.usuario_id = entrada.usuario_id and f.tipo = 'entrada'
             and (f.momento, f.id) > (entrada.momento, entrada.id)) then
    raise exception 'Hay varias entradas sin salida. Revisa y corrige los fichajes antes de cerrar.' using errcode = '23514';
  end if;
  select * into ultimo from public.fichajes f where f.usuario_id = entrada.usuario_id
    order by f.momento desc, f.id desc limit 1;
  if momento_salida is null or momento_salida < ultimo.momento or momento_salida > now() then
    raise exception 'La salida debe ser posterior al último fichaje y no puede ser futura' using errcode = '23514';
  end if;
  if nullif(btrim(motivo), '') is null or length(motivo) > 300 then
    raise exception 'Escribe un motivo de hasta 300 caracteres' using errcode = '23514';
  end if;
  insert into public.fichajes(usuario_id, tipo, momento, origen, nota, creado_por)
    values (entrada.usuario_id, 'salida', momento_salida, 'correccion', btrim(motivo), auth.uid()) returning id into nuevo_id;
  return nuevo_id;
end;
$$;
revoke all on function public.cerrar_jornada(bigint, timestamptz, text) from public, anon;
grant execute on function public.cerrar_jornada(bigint, timestamptz, text) to authenticated;
