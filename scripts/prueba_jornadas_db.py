"""Pruebas reales de PostgreSQL en un contenedor Docker LOCAL explícito; no lee archivos de entorno.

Uso: python3 -m scripts.prueba_jornadas_db --contenedor trimodos-jornada-pruebas
Crea una base temporal con las migraciones del repo y datos ficticios. La elimina al terminar.
--sin-arreglo ejecuta la regresión contra las migraciones anteriores (debe fallar).
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import subprocess
import uuid

RAIZ = Path(__file__).resolve().parents[1]
NUEVA = '20261110000000_jornadas_pendientes.sql'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--contenedor', required=True, choices=['trimodos-jornada-pruebas'])
    parser.add_argument('--sin-arreglo', action='store_true')
    args = parser.parse_args()
    db = 'jornadas_test_' + uuid.uuid4().hex

    def sql(texto, base=db, bien=True):
        r = subprocess.run(['docker', 'exec', '-i', args.contenedor, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', base],
                           input=texto, text=True, capture_output=True)
        if bien and r.returncode:
            raise AssertionError(r.stderr)
        return r

    sql(f'create database {db};', base='postgres')
    try:
        sql("""
        do $$ begin
          if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
          if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
          if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls; end if;
        end $$;
        create schema auth; create schema extensions;
        create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
        create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
        grant usage on schema auth, public to authenticated;
        grant execute on function auth.uid() to authenticated;
        alter default privileges in schema public grant all on tables to authenticated, service_role;
        alter default privileges in schema public grant all on sequences to authenticated, service_role;
        """)
        for p in sorted((RAIZ / 'supabase/migrations').glob('*.sql')):
            if args.sin_arreglo and p.name == NUEVA:
                continue
            sql(p.read_text())
        sql("""
        insert into auth.users(id,email) select ('00000000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid, 'prueba' || n || '@example.invalid' from generate_series(1,6) n;
        update public.usuarios set activo=true;
        insert into public.centros(nombre) values ('Prueba A'), ('Prueba B');
        insert into public.usuario_perfil(usuario_id,perfil_id,centro_id)
        select u.id, p.id, c.id from public.usuarios u cross join public.perfiles p cross join public.centros c
        where p.nombre=case when u.id::text like '%000004' then 'Responsable' else 'Operario' end
          and c.nombre=case when u.id::text like '%000005' then 'Prueba B' else 'Prueba A' end;
        insert into public.fichajes(usuario_id,creado_por,tipo,momento,origen,nota)
        select ('00000000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid,
          '00000000-0000-0000-0000-000000000004', 'entrada', now() - n * interval '1 day', 'correccion', 'Datos ficticios'
        from generate_series(1,3) n;
        """)
        def sesion(n, texto):
            return f"set role authenticated; set request.jwt.claim.sub='00000000-0000-0000-0000-{n:012}';\n" + texto

        # Regresión original: al tercer día la entrada no puede colarse por el recorte a ayer.
        for n in [3, 2, 1]:
            r = sql(sesion(n, "insert into public.fichajes(tipo) values ('entrada');"), bien=False)
            assert r.returncode != 0, f'Se ha aceptado una entrada con jornada abierta de {n} días'
        print('OK: entradas bloqueadas después de 1, 2 y 3 días', flush=True)

        def valor(n, consulta):
            return sql(sesion(n, consulta)).stdout.strip()
        assert valor(1, "select count(*) from public.fichajes_para_jornada(now(), null, false);") == '1'
        assert valor(1, "select count(*) from public.fichajes_para_jornada(now(), null, true);") == '0'
        assert valor(4, "select count(*) from public.fichajes_para_jornada(now(), null, true);") == '3'
        assert valor(5, "select count(*) from public.fichajes_para_jornada(now(), null, false);") == '0'
        print('OK: lectura conserva entradas antiguas y respeta RLS y alcance de corrección', flush=True)
        entrada = valor(4, "select id from public.fichajes where usuario_id='00000000-0000-0000-0000-000000000001';")
        cerrar = f"select public.cerrar_jornada({entrada}, now()-interval '16 hours', 'Salida olvidada de prueba');"
        for n in [1, 5]:
            assert sql(sesion(n, cerrar), bien=False).returncode, 'Se ha permitido un cierre sin permiso'
        for fecha, motivo in [("now()+interval '1 hour'", "'Motivo'"), ("now()-interval '2 days'", "'Motivo'"), ("now()-interval '16 hours'", "''")]:
            assert sql(sesion(4, f'select public.cerrar_jornada({entrada}, {fecha}, {motivo});'), bien=False).returncode
        print('OK: cierre exige responsable, fecha válida y motivo', flush=True)

        # Dos transacciones concurrentes: solo una añade la corrección.
        def concurrente(_):
            return sql(sesion(4, 'begin; ' + cerrar + ' select pg_sleep(0.2); commit;'), bien=False)
        with ThreadPoolExecutor(max_workers=2) as pool:
            rs = list(pool.map(concurrente, range(2)))
        assert sorted(r.returncode == 0 for r in rs) == [False, True], [r.stderr for r in rs]
        assert valor(4, "select count(*) from public.fichajes where tipo='salida' and origen='correccion' and nota='Salida olvidada de prueba' and creado_por=auth.uid();") == '1'
        sql(sesion(1, "insert into public.fichajes(tipo) values ('entrada');"))
        print('OK: cierre concurrente único, rastro de autor y motivo, nueva entrada permitida', flush=True)
        for operacion in ["update public.fichajes set momento=now();", "delete from public.fichajes;"]:
            assert sql(sesion(1, operacion), bien=False).returncode, 'Se ha permitido editar o borrar fichajes'
        print('OK: los fichajes siguen sin poder editarse ni borrarse', flush=True)
        def entrada_concurrente(_):
            return sql(sesion(6, "begin; insert into public.fichajes(tipo) values ('entrada'); select pg_sleep(0.2); commit;"), bien=False)
        with ThreadPoolExecutor(max_workers=2) as pool:
            rs = list(pool.map(entrada_concurrente, range(2)))
        assert sorted(r.returncode == 0 for r in rs) == [False, True], [r.stderr for r in rs]
        print('OK: dos entradas simultáneas solo crean un fichaje', flush=True)

    finally:
        sql(f'drop database {db};', base='postgres')


if __name__ == '__main__':
    main()
