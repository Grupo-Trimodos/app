"""Pruebas reales del Calendario (notas propias y fechas señaladas) en un PostgreSQL de un contenedor Docker LOCAL; no lee
archivos de entorno.

Uso: python3 -m scripts.prueba_calendario_db --contenedor trimodos-jornada-pruebas [--como-produccion]
Crea una base temporal con las migraciones del repo y personas ficticias, consulta la base directamente con la sesión de
cada una (como haría alguien que se salta la web) y la elimina al terminar. Con --como-produccion se saltan las
migraciones que aún no están en producción y de las que esta no puede depender (20261116000000 y 20261117000000). Las
funciones nuevas reciben EXECUTE por defecto para anon, authenticated y service_role, como en Supabase: así se comprueba
que la migración se lo quita a quien no debe tenerlo.

Personas (id terminado en):
  1 operario del centro A (en el equipo)       6 perfil Administrador (admin.usuarios, todos los centros)
  2 operario del centro B                      7 superadministrador
  3 chófer del centro B (en el equipo)         8 operario del centro A (fuera del equipo)
  4 responsable del centro A (crea el equipo)  9 persona dada de baja, operario del centro A
  5 responsable del centro B
"""
import argparse
from pathlib import Path
import subprocess
import uuid

RAIZ = Path(__file__).resolve().parents[1]
NO_EN_PRODUCCION = {'20261116000000_grupos_de_trabajo.sql', '20261117000000_ediciones_empleados.sql'}


def uid(n):
    return f'00000000-0000-0000-0000-{n:012}'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--contenedor', required=True, choices=['trimodos-jornada-pruebas'])
    parser.add_argument('--como-produccion', action='store_true')
    args = parser.parse_args()
    db = 'calendario_test_' + uuid.uuid4().hex

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

    def falla(n, consulta):
        return sql(sesion(n, consulta), bien=False).returncode != 0

    def servidor(consulta):
        return sql(consulta).stdout.strip()

    def ve(n, fecha):
        """¿La persona n ve esa fecha señalada? (tabla y función de la web deben coincidir)"""
        tabla = valor(n, f'select count(*) from public.fechas_senaladas where id={fecha};')
        funcion = valor(n, f"select count(*) from public.fechas_senaladas_entre(now() - interval '10 days', now() + interval '60 days', true) where id={fecha};")
        assert tabla == funcion, (n, fecha, tabla, funcion)
        return tabla == '1'

    def publicar(n, alcance, centro='null', equipo='null', titulo='Comida de Navidad', enlace='null'):
        r = sql(sesion(n, f"insert into public.fechas_senaladas(titulo, empieza, todo_el_dia, alcance, centro_id, equipo_id, enlace) "
                          f"values ('{titulo}', now() + interval '3 days', true, '{alcance}', {centro}, {equipo}, {enlace}) returning id;"), bien=False)
        return r.stdout.strip() if r.returncode == 0 else None

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
        grant usage on schema auth, public to authenticated, anon, service_role;
        grant execute on function auth.uid() to authenticated, anon, service_role;
        alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
        alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
        alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
        """)
        aplicadas = 0
        for p in sorted((RAIZ / 'supabase/migrations').glob('*.sql')):
            if args.como_produccion and p.name in NO_EN_PRODUCCION:
                continue
            sql(p.read_text())
            aplicadas += 1
        print(f'OK: {aplicadas} migraciones aplicadas' + (' (como en producción)' if args.como_produccion else ''), flush=True)
        sql("""
        insert into auth.users(id,email) select ('00000000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid, 'prueba' || n || '@example.invalid' from generate_series(1,9) n;
        update public.usuarios set activo=true;
        update public.usuarios u set nombre = 'Persona ' || right(u.id::text,1);
        update public.usuarios set es_admin=true where id::text like '%000007';
        update public.usuarios set activo=false where id::text like '%000009';
        insert into public.centros(nombre) values ('Centro A'), ('Centro B');
        insert into public.usuario_perfil(usuario_id, perfil_id, centro_id)
        select u.id, p.id, c.id
        from (values (1,'Operario','Centro A'), (2,'Operario','Centro B'), (3,'Chófer','Centro B'), (4,'Responsable','Centro A'),
                     (4,'Operario','Centro A'), (5,'Responsable','Centro B'), (6,'Administrador',null), (8,'Operario','Centro A'),
                     (9,'Operario','Centro A')) as v(n, perfil, centro)
        join public.usuarios u on right(u.id::text,2)::int = v.n
        join public.perfiles p on p.nombre = v.perfil
        left join public.centros c on c.nombre = v.centro;
        """)
        centro_a = servidor("select id from public.centros where nombre='Centro A';")
        centro_b = servidor("select id from public.centros where nombre='Centro B';")

        # Permisos repartidos en los perfiles, sin duplicados.
        for perfil, esperados in (('Responsable', 'calendario.publicar,calendario.usar'), ('Administrador', 'calendario.publicar,calendario.usar'),
                                  ('Chófer', 'calendario.usar'), ('Operario', 'calendario.usar'), ('Oficina', 'calendario.usar')):
            tiene = servidor(f"select string_agg(x, ',' order by x) from public.perfiles, unnest(permisos) x where nombre='{perfil}' and x like 'calendario.%';")
            assert tiene == esperados, (perfil, tiene)
            dup = servidor(f"select count(*) - count(distinct x) from public.perfiles, unnest(permisos) x where nombre='{perfil}';")
            assert dup == '0', (perfil, dup)
        print('OK: todos usan el calendario; Responsable y Administrador publican fechas señaladas', flush=True)

        # ------------------------------------------------------------ notas propias
        nota = valor(1, "insert into public.calendario_notas(titulo, empieza) values ('Taller', now()) returning id;")
        assert nota.isdigit(), nota
        assert servidor(f"select right(usuario_id::text,1) from public.calendario_notas where id={nota};") == '1'
        valor(4, "insert into public.calendario_notas(titulo, empieza, todo_el_dia) values ('Médico', now(), true);")
        for n in (2, 4, 5, 6, 7, 8):
            assert valor(n, f'select count(*) from public.calendario_notas where id={nota};') == '0', f'{n} ve una nota ajena'
            assert valor(n, f"update public.calendario_notas set titulo='Mía' where id={nota} returning id;") == '', n
            assert valor(n, f'delete from public.calendario_notas where id={nota} returning id;') == '', n
        assert valor(1, 'select count(*) from public.calendario_notas;') == '1'
        assert falla(1, f"insert into public.calendario_notas(titulo, empieza, usuario_id) values ('Ajena', now(), '{uid(2)}');"), 'Nota a nombre de otro'
        assert falla(1, f"update public.calendario_notas set usuario_id='{uid(2)}' where id={nota};"), 'Nota regalada a otro'
        assert falla(1, "insert into public.calendario_notas(titulo, empieza, termina) values ('Al revés', now(), now() - interval '1 hour');")
        assert falla(1, "insert into public.calendario_notas(titulo, empieza) values ('   ', now());")
        assert falla(1, f"insert into public.calendario_notas(titulo, empieza) values ('{'x' * 121}', now());")
        assert falla(9, "insert into public.calendario_notas(titulo, empieza) values ('De baja', now());"), 'Una persona de baja apunta notas'
        assert valor(1, f"update public.calendario_notas set titulo='Taller (cambiado)', outlook_evento_id='AAMk1' where id={nota} returning titulo;") == 'Taller (cambiado)'
        assert valor(1, f'delete from public.calendario_notas where id={nota} returning id;') == nota
        print('OK: cada nota solo la ve, cambia y borra su dueño; nadie apunta a nombre de otro', flush=True)

        # ------------------------------------------------------------ fechas señaladas: quién publica
        equipo = valor(4, "insert into public.equipos_trabajo(nombre) values ('Muelle de noche') returning id;")
        for n in (1, 3):
            valor(4, f"insert into public.equipos_trabajo_miembros(equipo_id, usuario_id) values ({equipo}, '{uid(n)}') returning 1;")
        otro_equipo = valor(5, "insert into public.equipos_trabajo(nombre) values ('Equipo del B') returning id;")

        assert publicar(1, 'todos') is None, 'Un operario ha publicado una fecha señalada'
        assert publicar(3, 'centro', centro=centro_b) is None, 'Un chófer ha publicado para su centro'
        todos = publicar(4, 'todos', titulo='Comida de empresa')
        para_a = publicar(4, 'centro', centro=centro_a, titulo='Simulacro centro A')
        para_equipo = publicar(4, 'equipo', equipo=equipo, titulo='Webinar del equipo')
        assert all(x and x.isdigit() for x in (todos, para_a, para_equipo)), (todos, para_a, para_equipo)
        assert publicar(4, 'centro', centro=centro_b) is None, 'Un responsable ha publicado para un centro ajeno'
        assert publicar(4, 'equipo', equipo=otro_equipo) is None, 'Un responsable ha publicado para un equipo que no gestiona'
        assert publicar(1, 'equipo', equipo=equipo) is None, 'Un miembro ha publicado para su equipo'
        assert falla(4, f"insert into public.fechas_senaladas(titulo, empieza, alcance, creado_por) values ('Suplantada', now(), 'todos', '{uid(5)}');")
        assert falla(4, f"insert into public.fechas_senaladas(titulo, empieza, alcance, centro_id) values ('Incoherente', now(), 'todos', {centro_a});")
        assert falla(4, "insert into public.fechas_senaladas(titulo, empieza, alcance) values ('Sin centro', now(), 'centro');")
        assert falla(4, f"insert into public.fechas_senaladas(titulo, empieza, alcance, centro_id, equipo_id) values ('Doble', now(), 'equipo', {centro_a}, {equipo});")
        assert falla(4, "insert into public.fechas_senaladas(titulo, empieza, alcance, activo) values ('Archivada', now(), 'todos', false);")
        assert falla(9, "insert into public.fechas_senaladas(titulo, empieza, alcance) values ('De baja', now(), 'todos');")
        assert publicar(6, 'centro', centro=centro_b, titulo='Formación B') is not None, 'La administración no publica en cualquier centro'
        assert publicar(7, 'equipo', equipo=equipo, titulo='Aviso del superadministrador') is not None
        print('OK: publica quien tiene permiso; un responsable no publica para un centro ajeno ni para un equipo que no gestiona', flush=True)

        # Enlaces: solo http y https.
        for malo in ("'javascript:alert(1)'", "'ftp://x.example'", "'https://x.example/a b'", "'data:text/html,hola'", "'www.example.com'"):
            assert publicar(4, 'todos', enlace=malo) is None, f'Enlace aceptado: {malo}'
        assert publicar(4, 'todos', titulo='Con enlace', enlace="'https://teams.example.com/reunion?id=1'") is not None
        print('OK: un enlace que no es http ni https se rechaza', flush=True)

        # ------------------------------------------------------------ fechas señaladas: quién las ve
        esperado = {
            todos: {1, 2, 3, 4, 5, 6, 7, 8},
            para_a: {1, 4, 6, 7, 8},           # centro A: 1, 4, 8 (9 de baja); autor 4; administración 6 y 7
            para_equipo: {1, 3, 4, 6, 7},      # miembros 1 y 3; autor 4; administración
        }
        for fecha, quienes in esperado.items():
            for n in range(1, 10):
                assert ve(n, fecha) == (n in quienes), (fecha, n)
        autor = valor(1, f"select concat_ws('|', autor, centro, equipo, alcance) from public.fechas_senaladas_entre(now(), now() + interval '30 days') where id={para_equipo};")
        assert autor == 'Persona 4|Muelle de noche|equipo', autor
        assert valor(1, 'select count(*) from public.usuarios where id <> auth.uid();') == '0', 'La función ha abierto las fichas ajenas'
        assert valor(1, "select count(*) from public.fechas_senaladas_entre(now(), now() + interval '500 days');") == '0', 'Periodo demasiado largo'
        print('OK: «todos», «centro» y «equipo» los ve quien toca y nadie más; siempre el autor y la administración', flush=True)

        # Quien sale del equipo deja de verla; si el equipo se archiva, sus miembros tampoco.
        valor(4, f"delete from public.equipos_trabajo_miembros where equipo_id={equipo} and usuario_id='{uid(3)}' returning 1;")
        assert not ve(3, para_equipo)
        valor(4, f"update public.equipos_trabajo set activo=false where id={equipo} returning id;")
        assert not ve(1, para_equipo) and ve(4, para_equipo)
        valor(4, f"update public.equipos_trabajo set activo=true where id={equipo} returning id;")
        assert ve(1, para_equipo)
        print('OK: al salir del equipo o archivarse el equipo se deja de ver', flush=True)

        # ------------------------------------------------------------ cambiar y archivar
        for n in (1, 5, 8):
            assert valor(n, f"update public.fechas_senaladas set titulo='Robada' where id={todos} returning id;") == '', n
            assert valor(n, f"update public.fechas_senaladas set activo=false where id={todos} returning id;") == '', n
        assert falla(4, f"update public.fechas_senaladas set alcance='centro', centro_id={centro_b} where id={para_a};"), 'Pasada a un centro ajeno'
        assert falla(4, f"update public.fechas_senaladas set alcance='equipo', centro_id=null, equipo_id={otro_equipo} where id={para_a};")
        assert falla(4, f"update public.fechas_senaladas set creado_por='{uid(5)}' where id={para_a};"), 'Autor cambiado'
        assert valor(4, f"update public.fechas_senaladas set titulo='Simulacro (nueva hora)' where id={para_a} returning titulo;") == 'Simulacro (nueva hora)'
        assert valor(4, f"update public.fechas_senaladas set activo=false where id={para_a} returning id;") == para_a
        assert not ve(1, para_a) and not ve(8, para_a) and ve(4, para_a) and ve(6, para_a)
        assert valor(1, "select count(*) from public.fechas_senaladas_entre(now(), now() + interval '30 days', true) where not activo;") == '0'
        assert valor(4, f"update public.fechas_senaladas set activo=true where id={para_a} returning id;") == para_a
        assert ve(1, para_a)
        assert valor(6, f"update public.fechas_senaladas set activo=false where id={todos} returning id;") == todos, 'La administración no archiva'
        assert valor(6, f"update public.fechas_senaladas set activo=true where id={todos} returning id;") == todos
        assert falla(4, f'delete from public.fechas_senaladas where id={todos};'), 'Se ha borrado una fecha señalada'
        assert falla(7, f'delete from public.fechas_senaladas where id={todos};'), 'Se ha borrado una fecha señalada'
        print('OK: solo el autor o la administración cambian y archivan; archivada solo la ven ellos; nunca se borran', flush=True)

        # Quien pierde «calendario.publicar» ya no cambia lo suyo (pero lo sigue viendo).
        sql("update public.perfiles set permisos = array_remove(permisos, 'calendario.publicar') where nombre='Responsable';")
        assert valor(4, f"update public.fechas_senaladas set titulo='Sin permiso' where id={todos} returning id;") == ''
        assert publicar(4, 'todos') is None
        assert ve(4, todos)
        sql("update public.perfiles set permisos = array(select distinct x from unnest(permisos || '{calendario.publicar}'::text[]) x order by x) where nombre='Responsable';")
        print('OK: sin «calendario.publicar» no se publica ni se cambia nada', flush=True)

        # Una persona de baja no ve nada.
        assert valor(9, 'select count(*) from public.fechas_senaladas;') == '0'
        assert valor(9, "select count(*) from public.fechas_senaladas_entre(now() - interval '1 day', now() + interval '30 days');") == '0'
        print('OK: una persona de baja no ve fechas señaladas', flush=True)

        # ------------------------------------------------------------ sin sesión, nada; nadie vacía las tablas
        assert falla(4, 'truncate public.calendario_notas;')
        assert falla(7, 'truncate public.fechas_senaladas cascade;')
        for consulta in ('select count(*) from public.calendario_notas;', 'select count(*) from public.fechas_senaladas;',
                         "select count(*) from public.fechas_senaladas_entre(now() - interval '1 day', now() + interval '30 days');",
                         'select count(*) from privado.fechas_que_veo();',
                         "insert into public.calendario_notas(titulo, empieza) values ('anon', now());",
                         "insert into public.fechas_senaladas(titulo, empieza, alcance) values ('anon', now(), 'todos');"):
            r = sql('set role anon; ' + consulta, bien=False)
            assert r.returncode != 0 or r.stdout.strip() == '0', f'Alguien sin sesión ha llegado: {consulta}'
        print('OK: sin sesión no se lee ni se escribe nada y nadie vacía las tablas', flush=True)
    finally:
        sql(f'drop database {db};', base='postgres')


if __name__ == '__main__':
    main()
