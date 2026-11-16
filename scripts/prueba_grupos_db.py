"""Pruebas reales de la seguridad por grupos en un PostgreSQL de un contenedor Docker LOCAL; no lee archivos de entorno.

Uso: python3 -m scripts.prueba_grupos_db --contenedor trimodos-jornada-pruebas
Crea una base temporal con las migraciones del repo y personas ficticias, consulta la base directamente con la sesión de
cada una (como haría alguien que se salta la web) y la elimina al terminar.

Personas (id terminado en):
  1 operario del centro A, departamento Almacén        6 responsable SOLO de Almacén en el centro A
  2 operario del centro B                              7 chófer de la zona Valencia
  3 operario de los centros A y B                      8 chófer de la zona Sevilla
  4 responsable del centro A                           9 responsable de la zona Valencia
  5 operario del centro A, departamento Administración 10 superadministrador
"""
import argparse
from pathlib import Path
import subprocess
import uuid

RAIZ = Path(__file__).resolve().parents[1]


def uid(n):
    return f'00000000-0000-0000-0000-{n:012}'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--contenedor', required=True, choices=['trimodos-jornada-pruebas'])
    args = parser.parse_args()
    db = 'grupos_test_' + uuid.uuid4().hex

    def sql(texto, base=db, bien=True):
        r = subprocess.run(['docker', 'exec', '-i', args.contenedor, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', base],
                           input=texto, text=True, capture_output=True)
        if bien and r.returncode:
            raise AssertionError(r.stderr)
        return r

    def sesion(n, texto):
        return f"set role authenticated; set request.jwt.claim.sub='{uid(n)}';\n" + texto

    def valor(n, consulta):
        return sql(sesion(n, consulta)).stdout.strip()

    def ve(n, tabla):
        """Ids (último número) de las personas cuyas filas de esa tabla puede leer la persona n."""
        return valor(n, f"select coalesce(string_agg(distinct right(usuario_id::text, 2)::int::text, ',' order by right(usuario_id::text, 2)::int::text), '') from public.{tabla};")

    def falla(n, consulta):
        return sql(sesion(n, consulta), bien=False).returncode != 0

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
            sql(p.read_text())
        sql("""
        insert into auth.users(id,email) select ('00000000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid, 'prueba' || n || '@example.invalid' from generate_series(1,10) n;
        update public.usuarios set activo=true;
        update public.usuarios set es_admin=true where id::text like '%000010';
        insert into public.centros(nombre, tipo) values ('Centro A','centro'), ('Centro B','centro'), ('Zona Valencia','zona'), ('Zona Sevilla','zona');
        insert into public.departamentos(nombre) values ('Almacén'), ('Administración');
        insert into public.tipos_transporte(nombre) values ('Nacional'), ('Contenedor');
        update public.usuarios set departamento_id=(select id from public.departamentos where nombre='Almacén') where right(id::text,2)::int in (1,6);
        update public.usuarios set departamento_id=(select id from public.departamentos where nombre='Administración') where right(id::text,2)::int = 5;
        update public.usuarios set tipo_transporte_id=(select id from public.tipos_transporte where nombre='Nacional') where right(id::text,2)::int = 7;
        insert into public.usuario_perfil(usuario_id, perfil_id, centro_id, departamento_id)
        select u.id, p.id, c.id, d.id
        from (values (1,'Operario','Centro A',null), (2,'Operario','Centro B',null), (3,'Operario','Centro A',null), (3,'Operario','Centro B',null),
                     (4,'Responsable','Centro A',null), (5,'Operario','Centro A',null), (6,'Responsable','Centro A','Almacén'),
                     (7,'Chófer','Zona Valencia',null), (8,'Chófer','Zona Sevilla',null), (9,'Responsable','Zona Valencia',null)) as v(n, perfil, centro, depto)
        join public.usuarios u on right(u.id::text,2)::int = v.n
        join public.perfiles p on p.nombre = v.perfil
        join public.centros c on c.nombre = v.centro
        left join public.departamentos d on d.nombre = v.depto;
        insert into public.fichajes(usuario_id, creado_por, tipo, momento, origen, nota)
        select u.id, '00000000-0000-0000-0000-000000000010', 'entrada', now() - interval '1 hour', 'correccion', 'Datos ficticios' from public.usuarios u;
        insert into public.ausencias(usuario_id, tipo, desde, hasta)
        select u.id, 'vacaciones', current_date + 30, current_date + 31 from public.usuarios u;
        """)

        for tabla in ('fichajes', 'ausencias'):
            # Una persona sin gente a su cargo solo lee lo suyo, aunque consulte la base directamente.
            assert ve(1, tabla) == '1', ve(1, tabla)
            assert ve(2, tabla) == '2', ve(2, tabla)
            assert ve(3, tabla) == '3', ve(3, tabla)
            assert ve(7, tabla) == '7', ve(7, tabla)
            # El responsable del centro A ve a todo el centro A (incluida la persona con dos centros) y a nadie de B ni de las zonas.
            assert ve(4, tabla) == '1,3,4,5,6', ve(4, tabla)
            # El responsable solo de Almacén ve a los de Almacén del centro A (y a sí mismo), no a Administración ni al resto.
            assert ve(6, tabla) == '1,6', ve(6, tabla)
            # El responsable de la zona Valencia ve a sus chóferes, no a los de Sevilla ni a los centros.
            assert ve(9, tabla) == '7,9', ve(9, tabla)
            # El superadministrador lo ve todo.
            assert ve(10, tabla) == '1,10,2,3,4,5,6,7,8,9', ve(10, tabla)
        print('OK: cada persona lee solo los fichajes y ausencias de su ámbito (centro, zona y departamento)', flush=True)

        # La persona con dos centros la ve el responsable de cualquiera de los dos.
        sql("""insert into public.usuario_perfil(usuario_id, perfil_id, centro_id)
               select '00000000-0000-0000-0000-000000000002', p.id, c.id from public.perfiles p, public.centros c where p.nombre='Responsable' and c.nombre='Centro B';""")
        assert ve(2, 'fichajes') == '2,3', ve(2, 'fichajes')
        assert ve(4, 'fichajes') == '1,3,4,5,6'
        print('OK: quien está en dos centros aparece en los dos y no arrastra al resto', flush=True)

        # Aprobar ausencias: solo las de su ámbito.
        aprobar = "update public.ausencias set estado='aprobada', resuelto_por=auth.uid(), resuelto_en=now() where usuario_id='{}' returning id;"
        assert valor(4, aprobar.format(uid(1))) != '', 'El responsable del centro A no puede aprobar a alguien de su centro'
        assert valor(4, aprobar.format(uid(2))) == '', 'El responsable del centro A ha aprobado a alguien del centro B'
        assert valor(6, aprobar.format(uid(5))) == '', 'El responsable de Almacén ha aprobado a alguien de Administración'
        assert valor(9, aprobar.format(uid(8))) == '', 'El responsable de Valencia ha aprobado a un chófer de Sevilla'
        assert valor(9, aprobar.format(uid(7))) != '', 'El responsable de Valencia no puede aprobar a su chófer'
        assert valor(1, aprobar.format(uid(5))) == '', 'Un operario ha aprobado una ausencia'
        print('OK: las ausencias solo las aprueba el responsable de ese centro, zona o departamento', flush=True)

        # Corregir fichajes: solo a su gente.
        corregir = "insert into public.fichajes(usuario_id, tipo, momento, origen, nota) values ('{}', 'salida', now() - interval '1 minute', 'correccion', 'Prueba');"
        assert not falla(4, corregir.format(uid(1)))
        assert falla(4, corregir.format(uid(2))), 'El responsable del centro A ha corregido a alguien del centro B'
        assert falla(6, corregir.format(uid(5))), 'El responsable de Almacén ha corregido a alguien de Administración'
        assert falla(1, corregir.format(uid(5))), 'Un operario ha corregido un fichaje ajeno'
        print('OK: los fichajes solo los corrige el responsable de esa persona', flush=True)

        # La lista calculada una vez coincide con la comprobación persona a persona, para todos y todos los permisos.
        for permiso in ('equipo.ver', 'fichaje.corregir', 'ausencias.aprobar'):
            for n in range(1, 11):
                dif = valor(n, f"""select count(*) from public.usuarios u
                    where privado.puedo_sobre('{permiso}', u.id) <> (u.id in (select privado.personas_a_cargo('{permiso}')));""")
                # Con la sesión de n solo se comparan las fichas que n puede leer; se repite sin RLS más abajo.
                assert dif == '0', (permiso, n, dif)
        sql("""do $$ declare v record; d int; begin
          for v in select id from public.usuarios loop
            perform set_config('request.jwt.claim.sub', v.id::text, true);
            select count(*) into d from public.usuarios u, unnest(array['equipo.ver','fichaje.corregir','ausencias.aprobar']) p
              where privado.puedo_sobre(p, u.id) <> (u.id in (select privado.personas_a_cargo(p)));
            if d > 0 then raise exception 'personas_a_cargo y puedo_sobre no coinciden para %', v.id; end if;
          end loop; end $$;""")
        print('OK: la lista calculada una vez da lo mismo que la comprobación persona a persona', flush=True)

        # Los catálogos y la ficha solo los cambia la administración.
        assert falla(1, "insert into public.departamentos(nombre) values ('Inventado');")
        assert falla(4, "insert into public.tipos_transporte(nombre) values ('Inventado');")
        assert valor(4, "update public.departamentos set nombre='Otro' returning id;") == ''
        assert valor(1, "update public.usuarios set departamento_id=null where id=auth.uid() returning id;") == ''
        assert valor(4, "update public.usuario_perfil set departamento_id=null returning id;") == ''
        assert valor(1, "select count(*) from public.departamentos;") == '2'
        assert not falla(10, "insert into public.departamentos(nombre) values ('Tráfico');")
        print('OK: departamentos, tipos de transporte y pertenencias solo los cambia la administración', flush=True)

        # Sin sesión no se lee nada.
        r = sql("set role anon; select count(*) from public.fichajes;", bien=False)
        assert r.returncode != 0 or r.stdout.strip() == '0', 'Alguien sin sesión ha leído fichajes'
        print('OK: sin sesión no se lee nada', flush=True)
    finally:
        sql(f'drop database {db};', base='postgres')


if __name__ == '__main__':
    main()
