"""Pruebas reales de «Mis viajes» (public.viajes_estados) en un PostgreSQL de un contenedor Docker LOCAL; no lee archivos de
entorno.

Uso: python3 -m scripts.prueba_viajes_db --contenedor trimodos-jornada-pruebas [--como-produccion]
Crea una base temporal con las migraciones del repo y personas ficticias, consulta la base directamente con la sesión de
cada una (como haría alguien que se salta la web) y la elimina al terminar. Con --como-produccion se saltan las
migraciones que aún no están en producción (20261116000000 y 20261117000000), como pasará al aplicarla allí.

Personas (id terminado en):
  1 chófer del centro A, enlazado con el conductor 900     6 perfil Administrador (todos los centros)
  2 chófer del centro B, enlazado con el conductor 901     7 superadministrador
  3 chófer del centro A sin enlace confirmado              8 operario del centro A (sin «viajes.usar»)
  4 responsable del centro A                               9 chófer dado de baja
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
    db = 'viajes_test_' + uuid.uuid4().hex

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

    def falla(n, consulta, texto=None):
        r = sql(sesion(n, consulta), bien=False)
        if r.returncode and texto:
            assert texto in r.stderr, r.stderr
        return r.returncode != 0

    def servidor(consulta):
        return sql(consulta).stdout.strip()

    def paso(n, tarea, estado, nota=None):
        nota_sql = 'null' if nota is None else f"$n${nota}$n$"
        return f"insert into public.viajes_estados(odoo_task_id, estado, nota) values ({tarea}, '{estado}', {nota_sql}) returning id;"

    def visibles(n, donde='true'):
        """Últimos números de las personas cuyos pasos ve n (sin repetir), ordenados."""
        return valor(n, f"select coalesce(string_agg(distinct right(usuario_id::text, 1), ',' order by right(usuario_id::text, 1)), '') "
                        f"from public.viajes_estados where {donde};")

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
        grant usage on schema auth, public to authenticated, anon;
        grant execute on function auth.uid() to authenticated, anon;
        alter default privileges in schema public grant all on tables to authenticated, service_role;
        alter default privileges in schema public grant all on sequences to authenticated, service_role;
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
        update public.usuarios u set nombre = v.nombre
          from (values (1,'Ana Chófer'), (2,'Bea Chófer'), (3,'Carlos Chófer'), (4,'Rosa Responsable'), (5,'Luis Responsable'),
                       (6,'Marta Administración'), (7,'Superadmin'), (8,'Pedro Operario'), (9,'Baja Prueba')) as v(n, nombre)
         where right(u.id::text,2)::int = v.n;
        update public.usuarios set es_admin=true where id::text like '%000007';
        insert into public.centros(nombre) values ('Centro A'), ('Centro B');
        insert into public.usuario_perfil(usuario_id, perfil_id, centro_id)
        select u.id, p.id, c.id
        from (values (1,'Chófer','Centro A'), (2,'Chófer','Centro B'), (3,'Chófer','Centro A'), (4,'Responsable','Centro A'),
                     (5,'Responsable','Centro B'), (6,'Administrador',null), (8,'Operario','Centro A'), (9,'Chófer','Centro A')) as v(n, perfil, centro)
        join public.usuarios u on right(u.id::text,2)::int = v.n
        join public.perfiles p on p.nombre = v.perfil
        left join public.centros c on c.nombre = v.centro;
        """)

        # Permisos repartidos en los perfiles, sin duplicados.
        for perfil, esperado in (('Chófer', 'viajes.usar'), ('Responsable', 'viajes.seguimiento'), ('Administrador', 'viajes.seguimiento'),
                                 ('Operario', ''), ('Oficina', '')):
            tiene = servidor(f"select coalesce(string_agg(x, ',' order by x), '') from public.perfiles, unnest(permisos) x where nombre='{perfil}' and x like 'viajes.%';")
            assert tiene == esperado, (perfil, tiene)
            assert servidor(f"select count(*) - count(distinct x) from public.perfiles, unnest(permisos) x where nombre='{perfil}';") == '0', perfil
        print('OK: «viajes.usar» lo tiene Chófer; «viajes.seguimiento», Responsable y Administrador', flush=True)

        # Enlaces confirmados por cada responsable (TAREA 1). La 9 se enlaza antes de darla de baja. La confirmación solo
        # la hace el servidor (clave de servidor) en nombre de quien confirma: scripts/prueba_vinculo_db.py.
        for autor, persona, empleado, conductor in ((4, 1, 10, 900), (5, 2, 20, 901), (4, 9, 90, 909)):
            servidor(f"set role service_role; select public.confirmar_vinculo_odoo('{uid(autor)}', '{uid(persona)}', {empleado}, {conductor});")
        servidor(f"update public.usuarios set activo=false where id='{uid(9)}';")

        # El chófer marca su paso; la base de datos pone su conductor y la hora (no se puede antedatar).
        assert valor(1, paso(1, 100, 'llegada_carga')).isdigit()
        assert servidor(f"select concat_ws('|', right(usuario_id::text,1), odoo_conductor_id, estado) from public.viajes_estados;") == '1|900|llegada_carga'
        assert valor(1, "insert into public.viajes_estados(odoo_task_id, estado, momento, creado, odoo_conductor_id) "
                        "values (100, 'cargando', now() - interval '3 days', now() - interval '3 days', 999) returning odoo_conductor_id;") == '900'
        assert servidor("select count(*) from public.viajes_estados where momento < now() - interval '1 hour' or creado < now() - interval '1 hour';") == '0', 'Se ha antedatado un paso'
        print('OK: el chófer marca su paso; su conductor y la hora los pone la base de datos', flush=True)

        # Nunca a nombre de otro, ni sin permiso, ni sin enlace confirmado, ni de baja.
        assert falla(1, f"insert into public.viajes_estados(odoo_task_id, estado, usuario_id) values (200, 'llegada_carga', '{uid(2)}');", 'propios viajes')
        assert falla(8, paso(8, 300, 'llegada_carga')), 'Un operario sin «viajes.usar» ha marcado un paso'
        assert falla(3, paso(3, 300, 'llegada_carga'), 'encargado tiene que confirmar'), 'Un chófer sin enlace ha marcado un paso'
        assert falla(9, paso(9, 300, 'llegada_carga')), 'Una persona de baja ha marcado un paso'
        assert servidor("select count(*) from public.viajes_estados;") == '2'
        print('OK: nadie marca a nombre de otro; sin permiso, sin enlace confirmado o de baja, tampoco', flush=True)

        # En orden: no se salta ni se repite un paso.
        assert falla(1, paso(1, 100, 'descargado'), 'no toca'), 'Se ha marcado «descargado» sin «cargado»'
        assert falla(1, paso(1, 100, 'cargando'), 'no toca'), 'Se ha repetido un paso'
        assert falla(1, paso(1, 101, 'cargando'), 'no toca'), 'Se ha empezado una orden por la mitad'
        assert falla(1, paso(1, 100, 'incidencia')), 'Incidencia sin nota'
        assert falla(1, paso(1, 100, 'incidencia', '   ')), 'Incidencia con nota vacía'
        assert falla(1, paso(1, 100, 'incidencia', 'x' * 201)), 'Incidencia con nota larguísima'
        assert falla(1, paso(1, 100, 'parado')), 'Estado inventado'
        assert valor(1, paso(1, 100, 'incidencia', '  Muelle lleno  ')).isdigit()
        assert servidor("select nota from public.viajes_estados where estado='incidencia';") == 'Muelle lleno'
        for estado in ('cargado', 'llegada_descarga', 'descargando', 'descargado'):
            assert valor(1, paso(1, 100, estado)).isdigit(), estado
        assert falla(1, paso(1, 100, 'llegada_carga'), 'ya está descargado'), 'Se ha seguido marcando tras «descargado»'
        assert valor(1, paso(1, 100, 'incidencia', 'Albarán sin firmar')).isdigit()
        print('OK: los pasos van en orden, sin saltos ni repeticiones; la incidencia pide nota y vale siempre', flush=True)

        # Solo se añade: ni cambiar, ni borrar, ni vaciar; tampoco el superadministrador ni el servidor.
        for n in (1, 4, 7):
            assert falla(n, "update public.viajes_estados set estado='cargado' where true;"), n
            assert falla(n, "delete from public.viajes_estados where true;"), n
            assert falla(n, "truncate public.viajes_estados;"), n
        assert sql("update public.viajes_estados set nota='cambiada' where true;", bien=False).returncode != 0
        assert sql("delete from public.viajes_estados where true;", bien=False).returncode != 0
        assert sql("truncate public.viajes_estados;", bien=False).returncode != 0
        print('OK: nadie cambia, borra ni vacía los pasos, ni siquiera el servidor', flush=True)

        # Bea (centro B) marca los suyos. Cada chófer ve solo lo suyo.
        assert valor(2, paso(2, 200, 'llegada_carga')).isdigit()
        assert valor(2, paso(2, 200, 'cargando')).isdigit()
        assert visibles(1) == '1' and visibles(2) == '2'
        assert visibles(3) == '' and visibles(8) == '' and visibles(9) == ''
        print('OK: cada chófer ve solo sus pasos; un operario no ve ninguno', flush=True)

        # Seguimiento: cada responsable, los de su centro; la administración y el superadministrador, todos.
        assert visibles(4) == '1', visibles(4)
        assert visibles(5) == '2', visibles(5)
        assert visibles(6) == '1,2' and visibles(7) == '1,2'
        assert valor(4, "select coalesce(string_agg(right(id::text,1), ',' order by nombre), '') from public.viajes_conductores_a_mi_cargo();") == '1'
        assert valor(5, "select coalesce(string_agg(right(id::text,1) || ':' || odoo_conductor_id, ',' order by nombre), '') from public.viajes_conductores_a_mi_cargo();") == '2:901'
        assert valor(7, "select string_agg(right(id::text,1), ',' order by nombre) from public.viajes_conductores_a_mi_cargo();") == '1,2'
        assert falla(1, "select * from public.viajes_conductores_a_mi_cargo();", 'No tienes permiso'), 'Un chófer ha pedido la lista de conductores'
        assert falla(8, "select * from public.viajes_conductores_a_mi_cargo();")
        print('OK: el responsable ve los pasos y los conductores de su centro, no los de otro; la administración, todos', flush=True)

        # Lo que usa la API: viajes empezados sin descargar y último paso de cada orden (con la RLS de quien llama).
        assert valor(1, "select count(*) from public.viajes_en_curso(now() - interval '30 days');") == '0'   # la 100 ya está descargada
        assert valor(2, f"select string_agg(odoo_task_id::text, ',') from public.viajes_en_curso(now() - interval '30 days', '{uid(2)}');") == '200'
        assert valor(4, "select count(*) from public.viajes_en_curso(now() - interval '30 days');") == '0'
        assert valor(5, "select string_agg(odoo_task_id::text, ',') from public.viajes_en_curso(now() - interval '30 days');") == '200'
        ultimo = "select string_agg(concat_ws('|', right(usuario_id::text,1), odoo_task_id, estado, incidencias, nota), ',' order by odoo_task_id) from public.viajes_ultimo_estado(array[100, 200]);"
        assert valor(4, ultimo) == '1|100|descargado|2|Albarán sin firmar', valor(4, ultimo)
        assert valor(7, ultimo) == '1|100|descargado|2|Albarán sin firmar,2|200|cargando|0', valor(7, ultimo)
        assert valor(8, ultimo) == ''
        print('OK: las consultas de la API respetan quién ve qué', flush=True)

        # Quien pierde «viajes.seguimiento» deja de ver los pasos de los demás.
        sql("update public.perfiles set permisos = array_remove(permisos, 'viajes.seguimiento') where nombre='Responsable';")
        assert visibles(4) == '' and visibles(5) == ''
        assert falla(4, "select * from public.viajes_conductores_a_mi_cargo();")
        sql("update public.perfiles set permisos = array(select distinct x from unnest(permisos || '{viajes.seguimiento}'::text[]) x order by x) where nombre='Responsable';")
        print('OK: sin «viajes.seguimiento» no se ven los pasos de otros', flush=True)

        # Sin sesión, nada.
        for consulta in ('select count(*) from public.viajes_estados;', "select count(*) from public.viajes_en_curso(now() - interval '30 days');",
                         'select count(*) from public.viajes_ultimo_estado(array[100, 200]);', 'select count(*) from public.viajes_conductores_a_mi_cargo();'):
            r = sql('set role anon; ' + consulta, bien=False)
            assert r.returncode != 0 or r.stdout.strip() == '0', f'Alguien sin sesión ha leído: {consulta}'
        assert sql("set role anon; insert into public.viajes_estados(odoo_task_id, estado, usuario_id, odoo_conductor_id) "
                   f"values (100, 'llegada_carga', '{uid(1)}', 900);", bien=False).returncode != 0
        print('OK: sin sesión no se lee ni se escribe nada', flush=True)
    finally:
        sql(f'drop database {db};', base='postgres')


if __name__ == '__main__':
    main()
