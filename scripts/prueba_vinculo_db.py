"""Pruebas reales del enlace con Odoo por teléfono en un PostgreSQL de un contenedor Docker LOCAL; no lee archivos de entorno.

Uso: python3 -m scripts.prueba_vinculo_db --contenedor trimodos-jornada-pruebas [--como-produccion]
Crea una base temporal con las migraciones del repo y personas ficticias, consulta la base directamente con la sesión de
cada una (como haría alguien que se salta la web) y la elimina al terminar. Con --como-produccion se saltan las
migraciones que aún no están en producción (20261116000000 y 20261117000000), como pasará al aplicarla allí.

Personas (id terminado en):
  1 chófer del centro A                 6 perfil Administrador (todos los centros, sin ser superadministrador)
  2 operario del centro B               7 superadministrador
  3 operario del centro A               8 responsable del centro A sin «personas.vincular» (se le quita en la prueba)
  4 responsable del centro A            9 persona dada de baja (inactiva) del centro A
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
    db = 'vinculo_test_' + uuid.uuid4().hex

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

    def fila(n):
        return servidor(f"select concat_ws('|', telefono, odoo_employee_id, odoo_conductor_id, right(vinculo_confirmado_por::text, 1), "
                        f"(vinculo_confirmado is not null)) from public.usuarios where id='{uid(n)}';")

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
          from (values (1,'Ana Chófer'), (2,'Bea Operaria'), (3,'Carlos Operario'), (4,'Rosa Responsable'), (5,'Luis Responsable'),
                       (6,'Marta Administración'), (7,'Superadmin'), (8,'Pedro Responsable'), (9,'Baja Prueba')) as v(n, nombre)
         where right(u.id::text,2)::int = v.n;
        update public.usuarios set es_admin=true where id::text like '%000007';
        update public.usuarios set activo=false where id::text like '%000009';
        insert into public.centros(nombre) values ('Centro A'), ('Centro B');
        insert into public.perfiles(nombre, permisos) values ('Responsable sin enlace', '{equipo.ver,ausencias.aprobar}');
        insert into public.usuario_perfil(usuario_id, perfil_id, centro_id)
        select u.id, p.id, c.id
        from (values (1,'Chófer','Centro A'), (2,'Operario','Centro B'), (3,'Operario','Centro A'), (4,'Responsable','Centro A'),
                     (4,'Operario','Centro A'), (5,'Responsable','Centro B'), (6,'Administrador',null),
                     (8,'Responsable sin enlace','Centro A'), (9,'Operario','Centro A')) as v(n, perfil, centro)
        join public.usuarios u on right(u.id::text,2)::int = v.n
        join public.perfiles p on p.nombre = v.perfil
        left join public.centros c on c.nombre = v.centro;
        """)

        # Permiso repartido: Responsable y Administrador, sin duplicados.
        for perfil, esperado in (('Responsable', 't'), ('Administrador', 't'), ('Chófer', 'f'), ('Operario', 'f'), ('Oficina', 'f')):
            assert servidor(f"select 'personas.vincular' = any(permisos) from public.perfiles where nombre='{perfil}';") == esperado, perfil
            assert servidor(f"select count(*) - count(distinct x) from public.perfiles, unnest(permisos) x where nombre='{perfil}';") == '0', perfil
        print('OK: «personas.vincular» lo tienen Responsable y Administrador', flush=True)

        # Normalización: solo dígitos y con el prefijo del país.
        for texto, esperado in (('612 34 56 78', '34612345678'), ('+34 612-345-678', '34612345678'), ('0034 (612) 345.678', '34612345678'),
                                ('34612345678', '34612345678'), ('964 12 34 56', '34964123456'), ('+44 7700 900123', '447700900123'),
                                ('6123456789', ''), ('12345', ''), ('+34 512 345 678', ''), ('abc', ''), ('', ''), ('+34 6123', '')):
            obtenido = servidor(f"select coalesce(privado.normalizar_telefono($t${texto}$t$), '');")
            assert obtenido == esperado, (texto, obtenido)
        print('OK: el móvil se guarda normalizado (34 + 9 cifras) y se rechazan números que no lo son', flush=True)

        # La persona guarda su propio móvil y no el de otra.
        assert valor(1, "select public.guardar_mi_telefono('612 34 56 78');") == '34612345678'
        assert fila(1) == '34612345678|f'
        assert valor(1, "select public.guardar_mi_telefono('+34 612 34 56 79');") == '34612345679', 'No ha podido corregirlo'
        assert falla(1, "select public.guardar_mi_telefono('hola');", 'no parece un móvil')
        assert fila(1) == '34612345679|f'
        assert valor(1, f"update public.usuarios set telefono='34600000000' where id='{uid(3)}' returning id;") == '', 'Ha cambiado el móvil de otro'
        assert valor(1, f"update public.usuarios set telefono='34600000000' where id='{uid(1)}' returning id;") == '', 'Ha esquivado la función'
        assert fila(3) == 'f'
        assert falla(9, "select public.guardar_mi_telefono('612 00 00 09');"), 'Una persona de baja ha guardado su móvil'
        assert valor(3, "select public.guardar_mi_telefono('699 11 22 33');") == '34699112233'
        assert valor(2, "select public.guardar_mi_telefono('699 44 55 66');") == '34699445566'
        print('OK: cada persona guarda y corrige solo su móvil; nadie cambia el de otro', flush=True)

        # Quién puede ver a quién para enlazar.
        def lista(n):
            return valor(n, "select coalesce(string_agg(right(id::text,1), ',' order by right(id::text,1)), '') from public.personas_para_vincular();")
        assert lista(4) == '1,3,8', lista(4)            # su centro A, sin él mismo ni la persona de baja
        assert lista(5) == '2', lista(5)
        assert lista(6) == '1,2,3,4,5,7,8', lista(6)    # administración: todos los activos menos ella
        assert lista(7) == '1,2,3,4,5,6,7,8', lista(7)  # superadministrador: también él
        assert falla(1, 'select * from public.personas_para_vincular();', 'No tienes permiso')
        assert falla(8, 'select * from public.personas_para_vincular();', 'No tienes permiso')
        # En el piloto el perfil Chófer no tiene «chofer.usar» (Mi camión): solo cuenta como chófer quien lo tenga.
        assert valor(4, f"select telefono || '|' || chofer from public.personas_para_vincular() where id='{uid(1)}';") == '34612345679|false'
        sql("update public.perfiles set permisos = permisos || '{chofer.usar}' where nombre = 'Chófer';")
        assert valor(4, f"select telefono || '|' || chofer from public.personas_para_vincular() where id='{uid(1)}';") == '34612345679|true'
        sql("update public.perfiles set permisos = array_remove(permisos, 'chofer.usar') where nombre = 'Chófer';")
        assert valor(4, f"select telefono || '|' || chofer from public.personas_para_vincular() where id='{uid(3)}';") == '34699112233|false'
        print('OK: el responsable ve para enlazar solo a las personas activas de sus centros', flush=True)

        # Un responsable confirma a alguien de su centro, y no a alguien de otro.
        assert not falla(4, f"select public.confirmar_vinculo_odoo('{uid(1)}', 501, 9001);")
        assert fila(1) == '34612345679|501|9001|4|t', fila(1)
        assert falla(4, f"select public.confirmar_vinculo_odoo('{uid(2)}', 502, null);", 'no está en tus centros')
        assert fila(2) == '34699445566|f'
        assert falla(5, f"select public.deshacer_vinculo_odoo('{uid(1)}');", 'no está en tus centros')
        assert falla(4, f"select public.confirmar_vinculo_odoo('{uid(4)}', 504, null);", 'tu propia cuenta'), 'Se ha confirmado a sí mismo'
        assert falla(4, f"select public.confirmar_vinculo_odoo('{uid(9)}', 509, null);"), 'Se ha enlazado a una persona de baja'
        assert falla(4, f"select public.confirmar_vinculo_odoo('{uid(3)}', null, null);", 'Elige la ficha')
        print('OK: el responsable confirma a alguien de su centro y no a alguien de otro, ni a sí mismo', flush=True)

        # Sin el permiso, nada; ni el operario ni un responsable al que se le quita.
        assert falla(3, f"select public.confirmar_vinculo_odoo('{uid(1)}', 503, null);", 'No puedes enlazar')
        assert falla(1, f"select public.confirmar_vinculo_odoo('{uid(1)}', 501, null);"), 'Alguien se ha confirmado a sí mismo'
        assert falla(8, f"select public.confirmar_vinculo_odoo('{uid(3)}', 503, null);", 'No puedes enlazar')
        assert falla(3, f"select public.deshacer_vinculo_odoo('{uid(1)}');", 'No puedes')
        print('OK: un operario o un responsable sin «personas.vincular» no confirma ni deshace', flush=True)

        # Una vez confirmado, la persona no cambia su móvil.
        assert falla(1, "select public.guardar_mi_telefono('600 00 00 01');", 'ya ha confirmado')
        assert fila(1).startswith('34612345679|')
        print('OK: con el enlace confirmado la persona ya no cambia su móvil', flush=True)

        # Un mismo empleado o conductor de Odoo no se enlaza a dos personas.
        assert falla(4, f"select public.confirmar_vinculo_odoo('{uid(3)}', 501, null);", 'ya está enlazada con otra persona')
        assert falla(6, f"select public.confirmar_vinculo_odoo('{uid(2)}', 501, null);", 'ya está enlazada con otra persona')
        assert falla(4, f"select public.confirmar_vinculo_odoo('{uid(3)}', 503, 9001);", 'contacto conductor ya está enlazado')
        assert falla(4, f"select public.confirmar_vinculo_odoo('{uid(1)}', 511, null);", 'ya está enlazada'), 'Ha cambiado un enlace sin deshacerlo'
        assert falla(7, f"update public.usuarios set odoo_employee_id = 503, vinculo_confirmado = now(), vinculo_confirmado_por = '{uid(7)}' "
                        f"where id = '{uid(3)}';", 'se confirma desde'), 'Se ha confirmado a mano saltándose la función'
        assert fila(3) == '34699112233|f'
        assert valor(4, f"select string_agg(empleado::text || '/' || coalesce(conductor::text, '-'), ',') from public.fichas_odoo_enlazadas();") == '501/9001'
        assert falla(1, 'select * from public.fichas_odoo_enlazadas();', 'No tienes permiso')
        print('OK: una ficha de empleado o un contacto conductor no se enlaza a dos personas', flush=True)

        # Historial: solo añadir, lo ven la administración y quien actuó.
        assert not falla(5, f"select public.confirmar_vinculo_odoo('{uid(2)}', 502, null);")
        historial = "select coalesce(string_agg(accion || ':' || right(persona::text,1) || ':' || coalesce(empleado_nuevo::text,'-'), ',' order by id), '') from public.vinculos_odoo_historial;"
        assert valor(4, historial) == 'confirmar:1:501', valor(4, historial)
        assert valor(5, historial) == 'confirmar:2:502'
        assert valor(6, historial) == 'confirmar:1:501,confirmar:2:502'
        assert valor(1, historial) == ''
        assert valor(4, "select telefono || '|' || coalesce(empleado_antes::text, '-') || '|' || right(autor::text,1) from public.vinculos_odoo_historial;") == '34612345679|-|4'
        assert falla(4, "insert into public.vinculos_odoo_historial(persona, accion) values (gen_random_uuid(), 'confirmar');")
        assert falla(6, 'update public.vinculos_odoo_historial set empleado_nuevo = 1;')
        assert falla(7, 'delete from public.vinculos_odoo_historial;')
        r = sql('delete from public.vinculos_odoo_historial;', bien=False)
        assert r.returncode and 'no se modifica' in r.stderr, 'El servidor ha borrado el historial'
        assert falla(7, 'truncate public.vinculos_odoo_historial;')
        print('OK: el historial anota quién confirmó qué y nadie lo cambia ni lo borra', flush=True)

        # Deshacer: la persona queda sin ficha, puede volver a corregir su móvil y se anota.
        assert not falla(4, f"select public.deshacer_vinculo_odoo('{uid(1)}');")
        assert fila(1) == '34612345679|f', fila(1)
        assert falla(4, f"select public.deshacer_vinculo_odoo('{uid(1)}');", 'no tiene un enlace confirmado')
        assert valor(1, "select public.guardar_mi_telefono('600 00 00 01');") == '34600000001'
        assert valor(6, "select accion || ':' || coalesce(empleado_antes::text,'-') || ':' || coalesce(conductor_antes::text,'-') || ':' || right(autor::text,1) "
                        "from public.vinculos_odoo_historial order by id desc limit 1;") == 'deshacer:501:9001:4'
        assert not falla(6, f"select public.confirmar_vinculo_odoo('{uid(3)}', 501, 9001);"), 'Tras deshacer, la ficha sigue ocupada'
        print('OK: deshacer deja a la persona sin ficha, libera la ficha y queda anotado', flush=True)

        # Cambios por otras vías: Administración → Personas o el enlace automático del servidor.
        assert not falla(6, f"update public.usuarios set odoo_employee_id = 777 where id = '{uid(3)}';")
        assert fila(3) == '34699112233|777|9001|f', fila(3)
        assert valor(6, "select accion || ':' || empleado_antes || ':' || empleado_nuevo || ':' || right(autor::text,1) from public.vinculos_odoo_historial order by id desc limit 1;") == 'cambio_administracion:501:777:6'
        assert falla(6, f"update public.usuarios set odoo_conductor_id = 9002 where id = '{uid(3)}';", 'se confirma desde')
        assert falla(6, f"update public.usuarios set vinculo_confirmado = now() where id = '{uid(3)}';", 'se confirma desde')
        assert not falla(6, f"update public.usuarios set nombre = 'Carlos Operario' where id = '{uid(2)}';")
        assert fila(2) == '34699445566|502|5|t', fila(2)
        servidor(f"set role service_role; update public.usuarios set odoo_employee_id = 888 where id = '{uid(5)}' and odoo_employee_id is null;")
        assert valor(6, "select accion || ':' || coalesce(empleado_antes::text,'-') || ':' || empleado_nuevo || ':' || coalesce(autor::text,'servidor') from public.vinculos_odoo_historial order by id desc limit 1;") == 'cambio_servidor:-:888:servidor'
        # El enlace automático puede repetir una ficha sin confirmar (como antes) sin fallar; la confirmación, no.
        servidor(f"set role service_role; update public.usuarios set odoo_employee_id = 888 where id = '{uid(8)}' and odoo_employee_id is null;")
        assert falla(7, f"select public.confirmar_vinculo_odoo('{uid(8)}', 888, null);", 'ya está enlazada con otra persona')
        print('OK: un cambio de ficha fuera de la confirmación la deja sin confirmar y se anota', flush=True)

        # Las políticas de cambio de usuarios siguen igual: un responsable no edita fichas a mano.
        assert valor(4, f"update public.usuarios set odoo_employee_id = 1 where id = '{uid(1)}' returning id;") == ''
        assert valor(4, f"update public.usuarios set telefono = '34611111111' where id = '{uid(1)}' returning id;") == ''
        print('OK: el responsable no cambia nada de usuarios por fuera de las funciones', flush=True)

        # Sin sesión, nada.
        for consulta in ("select public.guardar_mi_telefono('612345678');", 'select * from public.personas_para_vincular();',
                         'select * from public.fichas_odoo_enlazadas();', f"select public.confirmar_vinculo_odoo('{uid(2)}', 1, null);",
                         f"select public.deshacer_vinculo_odoo('{uid(2)}');", 'select count(*) from public.vinculos_odoo_historial;'):
            r = sql('set role anon; ' + consulta, bien=False)
            assert r.returncode != 0, f'Alguien sin sesión ha podido: {consulta}'
        r = sql("set role authenticated; select public.guardar_mi_telefono('612345678');", bien=False)
        assert r.returncode != 0, 'Sin usuario se ha guardado un móvil'
        print('OK: sin sesión no se lee ni se cambia nada', flush=True)
    finally:
        sql(f'drop database {db};', base='postgres')


if __name__ == '__main__':
    main()
