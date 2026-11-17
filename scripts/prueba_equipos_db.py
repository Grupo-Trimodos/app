"""Pruebas reales de los Equipos (grupos de trabajo) en un PostgreSQL de un contenedor Docker LOCAL; no lee archivos de entorno.

Uso: python3 -m scripts.prueba_equipos_db --contenedor trimodos-jornada-pruebas
Crea una base temporal con las migraciones del repo y personas ficticias, consulta la base directamente con la sesión de
cada una (como haría alguien que se salta la web) y la elimina al terminar.

Personas (id terminado en):
  1 operario del centro A                    6 perfil Administrador (con admin.usuarios, sin ser superadministrador)
  2 operario del centro B                    7 superadministrador
  3 chófer de la zona Valencia               8 operario del centro A que no está en el equipo
  4 responsable del centro A (crea equipo)   9 persona dada de baja (inactiva)
  5 responsable del centro B
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
    db = 'equipos_test_' + uuid.uuid4().hex

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

    def personas(n, consulta):
        """Últimos números de los ids que devuelve la consulta (columna «id»), ordenados."""
        return valor(n, f"select coalesce(string_agg(right(id::text, 2)::int::text, ',' order by right(id::text, 2)::int), '') from ({consulta}) q;")

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
        insert into auth.users(id,email) select ('00000000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid, 'prueba' || n || '@example.invalid' from generate_series(1,9) n;
        update public.usuarios set activo=true;
        update public.usuarios u set nombre = v.nombre
          from (values (1,'Ana Prueba'), (2,'José Núñez Prueba'), (3,'Carlos Prueba'), (4,'Rosa Prueba'), (5,'Luis Prueba'),
                       (6,'Marta Prueba'), (7,'Superadmin Prueba'), (8,'Pedro Prueba'), (9,'Baja Prueba')) as v(n, nombre)
         where right(u.id::text,2)::int = v.n;
        update public.usuarios set es_admin=true where id::text like '%000007';
        update public.usuarios set activo=false where id::text like '%000009';
        insert into public.centros(nombre, tipo) values ('Centro A','centro'), ('Centro B','centro'), ('Zona Valencia','zona');
        insert into public.usuario_perfil(usuario_id, perfil_id, centro_id)
        select u.id, p.id, c.id
        from (values (1,'Operario','Centro A'), (2,'Operario','Centro B'), (3,'Chófer','Zona Valencia'), (4,'Responsable','Centro A'),
                     (5,'Responsable','Centro B'), (6,'Administrador',null), (8,'Operario','Centro A'), (9,'Operario','Centro A')) as v(n, perfil, centro)
        join public.usuarios u on right(u.id::text,2)::int = v.n
        join public.perfiles p on p.nombre = v.perfil
        left join public.centros c on c.nombre = v.centro;
        """)

        # Permisos repartidos en los perfiles, sin duplicados.
        for perfil, esperados in (('Responsable', 'equipos.crear,equipos.ver'), ('Administrador', 'equipos.crear,equipos.ver'),
                                  ('Chófer', 'equipos.ver'), ('Operario', 'equipos.ver'), ('Oficina', 'equipos.ver')):
            tiene = sql(f"select string_agg(x, ',' order by x) from public.perfiles, unnest(permisos) x where nombre='{perfil}' and x like 'equipos.%';").stdout.strip()
            assert tiene == esperados, (perfil, tiene)
            dup = sql(f"select count(*) - count(distinct x) from public.perfiles, unnest(permisos) x where nombre='{perfil}';").stdout.strip()
            assert dup == '0', (perfil, dup)
        print('OK: Responsable y Administrador pueden crear equipos; Chófer, Operario y Oficina, verlos', flush=True)

        # Crear: el responsable sí (y queda como creador), el operario no, nadie se hace pasar por otro.
        equipo = valor(4, "insert into public.equipos_trabajo(nombre, descripcion) values ('Muelle de noche', 'Turno de noche') returning id;")
        assert equipo.isdigit(), equipo
        assert sql(f"select right(creado_por::text,2)::int from public.equipos_trabajo where id={equipo};").stdout.strip() == '4'
        assert falla(1, "insert into public.equipos_trabajo(nombre) values ('Inventado');"), 'Un operario ha creado un equipo'
        assert falla(4, f"insert into public.equipos_trabajo(nombre, creado_por) values ('Ajeno', '{uid(5)}');"), 'Se ha creado un equipo a nombre de otro'
        assert falla(4, "insert into public.equipos_trabajo(nombre) values ('A');"), 'Se ha creado un equipo con nombre de una letra'
        assert falla(9, "insert into public.equipos_trabajo(nombre) values ('De baja');")
        print('OK: crea equipos quien tiene permiso y queda como creador; un operario no puede', flush=True)

        # Añadir personas de cualquier centro o zona; nunca a alguien de baja.
        anadir = "insert into public.equipos_trabajo_miembros(equipo_id, usuario_id) values ({}, '{}');"
        for n in (1, 2, 3):
            assert not falla(4, anadir.format(equipo, uid(n))), n
        assert sql(f"select count(*) from public.equipos_trabajo_miembros where equipo_id={equipo} and anadido_por='{uid(4)}';").stdout.strip() == '3'
        assert falla(4, anadir.format(equipo, uid(9))), 'Se ha añadido a una persona de baja'
        assert falla(4, f"insert into public.equipos_trabajo_miembros(equipo_id, usuario_id, anadido_por) values ({equipo}, '{uid(8)}', '{uid(5)}');")
        print('OK: el creador añade a personas de otros centros y zonas, nunca a alguien de baja', flush=True)

        # Los miembros ven su equipo y los nombres de sus compañeros (y nada más de ellos).
        for n in (1, 2, 3, 4):
            assert valor(n, 'select count(*) from public.equipos_trabajo;') == '1', n
            assert personas(n, f'select * from public.miembros_equipo({equipo})') == '1,2,3', n
            assert personas(n, f'select usuario_id as id from public.equipos_trabajo_miembros where equipo_id={equipo}') == '1,2,3', n
        assert valor(2, f"select string_agg(nombre, '|' order by nombre) from public.miembros_equipo({equipo});") == 'Ana Prueba|Carlos Prueba|José Núñez Prueba'
        claves = valor(2, f"select string_agg(distinct k, ',' order by k) from public.miembros_equipo({equipo}) m, json_object_keys(row_to_json(m)) k;")
        assert claves == 'id,nombre', claves
        assert valor(2, f"select count(*) from public.usuarios where id <> auth.uid();") == '0', 'Un miembro lee fichas ajenas'
        print('OK: cada miembro ve su equipo y solo el nombre de sus compañeros', flush=True)

        # Quien no está no ve el equipo ni puede pedir quién está.
        for n in (5, 8):
            assert valor(n, 'select count(*) from public.equipos_trabajo;') == '0', n
            assert valor(n, 'select count(*) from public.equipos_trabajo_miembros;') == '0', n
            assert valor(n, f'select count(*) from public.miembros_equipo({equipo});') == '0', n
        print('OK: quien no está en el equipo no lo ve ni puede pedir sus miembros', flush=True)

        # Otro responsable no toca un equipo ajeno; un miembro tampoco.
        for n in (5, 1):
            assert valor(n, f"update public.equipos_trabajo set nombre='Robado' where id={equipo} returning id;") == '', n
            assert falla(n, anadir.format(equipo, uid(8))), n
            assert valor(n, f"delete from public.equipos_trabajo_miembros where equipo_id={equipo} returning usuario_id;") == '', n
        assert falla(4, f"update public.equipos_trabajo set creado_por='{uid(5)}' where id={equipo};"), 'Se ha cambiado el creador'
        assert falla(4, f"update public.equipos_trabajo_miembros set usuario_id='{uid(8)}' where equipo_id={equipo};")
        print('OK: ni otro responsable ni un miembro cambian un equipo ajeno', flush=True)

        # La administración (perfil Administrador o superadministrador) ve y gestiona cualquier equipo.
        for n in (6, 7):
            assert valor(n, f"update public.equipos_trabajo set nombre='Muelle noche {n}' where id={equipo} returning id;") == equipo, n
            assert personas(n, f'select * from public.miembros_equipo({equipo})') == '1,2,3', n
        assert not falla(6, anadir.format(equipo, uid(8)))
        assert valor(7, f"delete from public.equipos_trabajo_miembros where equipo_id={equipo} and usuario_id='{uid(8)}' returning 1;") == '1'
        assert valor(4, f"update public.equipos_trabajo set nombre='Muelle de noche' where id={equipo} returning nombre;") == 'Muelle de noche'
        print('OK: la administración ve y gestiona cualquier equipo; el creador renombra el suyo', flush=True)

        # Buscar personas: solo con equipos.crear, mínimo 2 letras, solo id y nombre, sin personas de baja, sin tildes.
        assert falla(1, "select * from public.buscar_personas_equipo('prueba');"), 'Un operario ha buscado personas'
        assert valor(4, "select count(*) from public.buscar_personas_equipo('p');") == '0'
        assert personas(4, "select * from public.buscar_personas_equipo('PRUEBA')") == '1,2,3,4,5,6,7,8'
        assert personas(4, "select * from public.buscar_personas_equipo('nunez')") == '2'
        assert personas(4, "select * from public.buscar_personas_equipo('%')") == ''
        claves = valor(4, "select string_agg(distinct k, ',' order by k) from public.buscar_personas_equipo('prueba') b, json_object_keys(row_to_json(b)) k;")
        assert claves == 'id,nombre', claves
        print('OK: buscar personas exige permiso y solo devuelve id y nombre de personas activas', flush=True)

        # Archivar: los miembros dejan de verlo, el creador lo sigue viendo, no se añade a nadie y se puede reactivar.
        assert valor(4, f"update public.equipos_trabajo set activo=false where id={equipo} returning id;") == equipo
        assert valor(2, 'select count(*) from public.equipos_trabajo;') == '0'
        assert valor(2, f'select count(*) from public.miembros_equipo({equipo});') == '0'
        assert valor(4, 'select count(*) from public.equipos_trabajo where not activo;') == '1'
        assert falla(4, anadir.format(equipo, uid(8))), 'Se ha añadido a alguien a un equipo archivado'
        assert valor(4, f"update public.equipos_trabajo set activo=true where id={equipo} returning id;") == equipo
        assert valor(2, 'select count(*) from public.equipos_trabajo;') == '1'
        assert falla(4, f'delete from public.equipos_trabajo where id={equipo};'), 'Se ha borrado un equipo'
        print('OK: los equipos se archivan y se reactivan, nunca se borran', flush=True)

        # Quitar a una persona.
        assert valor(4, f"delete from public.equipos_trabajo_miembros where equipo_id={equipo} and usuario_id='{uid(3)}' returning 1;") == '1'
        assert valor(3, 'select count(*) from public.equipos_trabajo;') == '0'
        assert personas(1, f'select * from public.miembros_equipo({equipo})') == '1,2'
        print('OK: quien sale del equipo deja de verlo', flush=True)

        # Una persona dada de baja no ve nada, aunque siga apuntada.
        sql(f"insert into public.equipos_trabajo_miembros(equipo_id, usuario_id) values ({equipo}, '{uid(9)}');")
        assert valor(9, 'select count(*) from public.equipos_trabajo;') == '0'
        assert valor(9, f'select count(*) from public.miembros_equipo({equipo});') == '0'
        assert personas(1, f'select * from public.miembros_equipo({equipo})') == '1,2'
        print('OK: una persona de baja no ve equipos ni aparece en ellos', flush=True)

        # Quien pierde «equipos.crear» sigue viendo su equipo, pero ya no lo gestiona.
        sql("update public.perfiles set permisos = array_remove(permisos, 'equipos.crear') where nombre='Responsable';")
        assert valor(4, 'select count(*) from public.equipos_trabajo;') == '1'
        assert valor(4, f"update public.equipos_trabajo set nombre='Otro' where id={equipo} returning id;") == ''
        assert falla(4, anadir.format(equipo, uid(8)))
        assert falla(4, "insert into public.equipos_trabajo(nombre) values ('Sin permiso');")
        sql("update public.perfiles set permisos = array(select distinct x from unnest(permisos || '{equipos.crear}'::text[]) x order by x) where nombre='Responsable';")
        print('OK: sin «equipos.crear» el creador ya no gestiona su equipo', flush=True)

        # Un equipo no da permisos: ser compañero no deja ver fichajes ni ausencias del otro.
        sql("""insert into public.fichajes(usuario_id, creado_por, tipo, momento, origen, nota)
               select u.id, '00000000-0000-0000-0000-000000000007', 'entrada', now() - interval '1 hour', 'correccion', 'Datos ficticios'
               from public.usuarios u where u.activo;""")
        assert valor(1, 'select count(*) from public.fichajes where usuario_id <> auth.uid();') == '0'
        assert valor(4, f"select count(*) from public.fichajes where usuario_id = '{uid(2)}';") == '0', 'El equipo ha dado acceso a fichajes de otro centro'
        print('OK: estar en un equipo no da acceso a fichajes ajenos', flush=True)

        # Ni vaciar tablas ni nada sin sesión.
        assert falla(4, 'truncate public.equipos_trabajo_miembros;')
        assert falla(7, 'truncate public.equipos_trabajo cascade;')
        for consulta in ('select count(*) from public.equipos_trabajo;', 'select count(*) from public.equipos_trabajo_miembros;',
                         f'select count(*) from public.miembros_equipo({equipo});', "select count(*) from public.buscar_personas_equipo('prueba');"):
            r = sql('set role anon; ' + consulta, bien=False)
            assert r.returncode != 0 or r.stdout.strip() == '0', f'Alguien sin sesión ha leído: {consulta}'
        print('OK: sin sesión no se lee nada y nadie vacía las tablas', flush=True)
    finally:
        sql(f'drop database {db};', base='postgres')


if __name__ == '__main__':
    main()
