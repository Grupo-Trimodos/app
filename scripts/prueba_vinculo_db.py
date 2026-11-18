"""Pruebas reales del enlace con Odoo en un PostgreSQL de un contenedor Docker LOCAL; no lee archivos de entorno.

Uso: python3 -m scripts.prueba_vinculo_db --contenedor trimodos-jornada-pruebas [--como-produccion]
Crea una base temporal con las migraciones del repo y personas ficticias, consulta la base directamente con la sesión de
cada una (como haría alguien que se salta la web y llama a la base con la clave pública y su sesión) y la elimina al
terminar. Con --como-produccion se saltan las migraciones que aún no están en producción (20261116000000 y
20261117000000), como pasará al aplicarla allí. Las funciones nuevas reciben EXECUTE por defecto para anon,
authenticated y service_role, como en Supabase: así se comprueba que la migración se lo quita a quien no debe tenerlo.

Personas (id terminado en):
  1 chófer del centro A (código y PIN)        7 superadministrador, con perfil Operario en el centro A
  2 operario del centro B (código y PIN)      8 responsable del centro A sin «personas.vincular»
  3 operario del centro A (código y PIN)      9 persona dada de baja (inactiva) del centro A (código y PIN)
  4 responsable del centro A (Microsoft)      10 operario del centro A que entra con Microsoft
  5 responsable del centro B                  11 operario del centro A (código y PIN)
  6 perfil Administrador (todos los centros)  12 perfil Seguridad (todos los centros), sin enlazar
"""
import argparse
from pathlib import Path
import subprocess
import uuid

RAIZ = Path(__file__).resolve().parents[1]
NO_EN_PRODUCCION = {'20261116000000_grupos_de_trabajo.sql', '20261117000000_ediciones_empleados.sql'}
CON_PIN = {1, 2, 3, 9, 11}


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

    def como_servidor(consulta, texto=None):
        """Con la clave de servidor (rol service_role, sin usuario), como la API Python."""
        r = sql("set role service_role;\n" + consulta, bien=False)
        if r.returncode and texto:
            assert texto in r.stderr, r.stderr
        return r

    def confirmar(autor, persona, empleado, conductor='null', texto=None):
        r = como_servidor(f"select public.confirmar_vinculo_odoo('{uid(autor)}', '{uid(persona)}', {empleado}, {conductor});", texto)
        return r.returncode == 0

    def deshacer(autor, persona, texto=None):
        r = como_servidor(f"select public.deshacer_vinculo_odoo('{uid(autor)}', '{uid(persona)}');", texto)
        return r.returncode == 0

    def fila(n):
        return servidor(f"select concat_ws('|', t.telefono, u.odoo_employee_id, u.odoo_conductor_id, right(u.vinculo_confirmado_por::text, 1), "
                        f"(u.vinculo_confirmado is not null)) from public.usuarios u left join public.telefonos_personas t on t.usuario_id = u.id "
                        f"where u.id='{uid(n)}';")

    def ultimo_historial():
        return servidor("select concat_ws(':', accion, coalesce(empleado_antes::text,'-'), coalesce(empleado_nuevo::text,'-'), "
                        "coalesce(right(autor::text,2)::int::text,'servidor')) from public.vinculos_odoo_historial order by id desc limit 1;")

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
        create function auth.uid() returns uuid language sql stable as $$
          select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                          (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
        grant usage on schema auth, public to authenticated, anon, service_role;
        grant execute on function auth.uid() to authenticated, anon, service_role;
        alter default privileges in schema public grant all on tables to authenticated, service_role;
        alter default privileges in schema public grant all on sequences to authenticated, service_role;
        alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
        """)
        aplicadas = 0
        for p in sorted((RAIZ / 'supabase/migrations').glob('*.sql')):
            if args.como_produccion and p.name in NO_EN_PRODUCCION:
                continue
            sql(p.read_text())
            aplicadas += 1
        print(f'OK: {aplicadas} migraciones aplicadas' + (' (como en producción)' if args.como_produccion else ''), flush=True)
        pin = ','.join(str(n) for n in sorted(CON_PIN))
        sql(f"""
        insert into auth.users(id,email)
        select ('00000000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid,
               case when n in ({pin}) then 'c00' || n || '@pin.grupotrimodos.com' else 'persona' || n || '@grupotrimodos.com' end
        from generate_series(1,12) n;
        update public.usuarios set activo=true;
        update public.usuarios u set nombre = v.nombre
          from (values (1,'Ana Chófer Gómez'), (2,'Bea Operaria Ruiz'), (3,'Carlos Operario Sanz'), (4,'Rosa Responsable'), (5,'Luis Responsable'),
                       (6,'Marta Administración'), (7,'Superadmin'), (8,'Pedro Responsable'), (9,'Baja Prueba'), (10,'Diego Microsoft Pérez'),
                       (11,'Eva Operaria Gil'), (12,'Sergio Seguridad')) as v(n, nombre)
         where right(u.id::text,2)::int = v.n;
        update public.usuarios set es_admin=true where id::text like '%000007';
        update public.usuarios set activo=false where id::text like '%000009';
        insert into public.centros(nombre) values ('Centro A'), ('Centro B');
        insert into public.perfiles(nombre, permisos) values ('Responsable sin enlace', '{{equipo.ver,ausencias.aprobar}}');
        insert into public.usuario_perfil(usuario_id, perfil_id, centro_id)
        select u.id, p.id, c.id
        from (values (1,'Chófer','Centro A'), (2,'Operario','Centro B'), (3,'Operario','Centro A'), (4,'Responsable','Centro A'),
                     (4,'Operario','Centro A'), (5,'Responsable','Centro B'), (6,'Administrador',null), (7,'Operario','Centro A'),
                     (8,'Responsable sin enlace','Centro A'), (9,'Operario','Centro A'), (10,'Operario','Centro A'),
                     (11,'Operario','Centro A'), (12,'Seguridad',null)) as v(n, perfil, centro)
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

        # El móvil solo se pide a quien entra con código y PIN.
        assert valor(1, 'select pide from public.mi_telefono();') == 't'
        assert valor(4, 'select pide from public.mi_telefono();') == 'f'
        assert valor(10, 'select pide from public.mi_telefono();') == 'f'
        assert valor(9, 'select count(*) from public.mi_telefono();') == '0', 'A una persona de baja se le pide el móvil'
        assert falla(10, "select public.guardar_mi_telefono('612 00 00 10');", 'Microsoft o Google'), 'Quien entra con Microsoft ha dado su móvil'
        assert falla(4, "select public.guardar_mi_telefono('612 00 00 04');", 'Microsoft o Google')
        print('OK: el móvil solo se pide a quien entra con código y PIN; con Microsoft o Google, no', flush=True)

        # La persona guarda su propio móvil y no el de otra; ni a mano.
        assert valor(1, "select public.guardar_mi_telefono('612 34 56 78');") == '34612345678'
        assert fila(1) == '34612345678|f'
        assert valor(1, "select public.guardar_mi_telefono('+34 612 34 56 79');") == '34612345679', 'No ha podido corregirlo'
        assert valor(1, 'select telefono from public.mi_telefono();') == '34612345679'
        assert falla(1, "select public.guardar_mi_telefono('hola');", 'no parece un móvil')
        assert fila(1) == '34612345679|f'
        assert falla(1, f"insert into public.telefonos_personas(usuario_id, telefono) values ('{uid(3)}', '34600000000');"), 'Ha puesto el móvil de otro'
        assert falla(1, f"update public.telefonos_personas set telefono='34600000000' where usuario_id='{uid(1)}';"), 'Ha esquivado la función'
        assert falla(1, f"delete from public.telefonos_personas where usuario_id='{uid(1)}';"), 'Ha borrado su móvil a mano'
        assert fila(3) == 'f'
        assert falla(9, "select public.guardar_mi_telefono('612 00 00 09');"), 'Una persona de baja ha guardado su móvil'
        assert valor(3, "select public.guardar_mi_telefono('699 11 22 33');") == '34699112233'
        assert valor(2, "select public.guardar_mi_telefono('699 44 55 66');") == '34699445566'
        assert valor(11, "select public.guardar_mi_telefono('+40 721 234 567');") == '40721234567'   # móvil extranjero
        print('OK: cada persona guarda y corrige solo su móvil; nadie cambia el de otro', flush=True)

        # El móvil no se ve al leer usuarios: solo la persona y quien puede enlazarla.
        assert falla(12, 'select telefono from public.usuarios;', 'telefono'), 'usuarios sigue teniendo el móvil'
        def moviles(n):
            return valor(n, "select coalesce(string_agg(right(usuario_id::text,2)::int::text, ',' order by usuario_id), '') from public.telefonos_personas;")
        assert moviles(12) == '', moviles(12)   # Seguridad: ningún móvil
        assert moviles(3) == '3'                # cada uno el suyo
        assert moviles(4) == '1,3,11', moviles(4)   # su responsable: los de su centro
        assert moviles(5) == '2'
        assert moviles(6) == '1,2,3,11'         # administración: todos
        assert moviles(8) == '', 'Un responsable sin «personas.vincular» ve móviles'
        assert sql('set role anon; select count(*) from public.telefonos_personas;', bien=False).returncode != 0
        print('OK: el móvil solo lo ven la persona, quien puede enlazarla y la administración', flush=True)

        # Quién puede ver a quién para enlazar.
        def lista(n):
            return valor(n, "select coalesce(string_agg(right(id::text,2)::int::text, ',' order by right(id::text,2)::int), '') from public.personas_para_vincular();")
        assert lista(4) == '1,3,8,10,11', lista(4)          # su centro A, sin él mismo, la baja ni el superadministrador
        assert lista(5) == '2', lista(5)
        assert lista(6) == '1,2,3,4,5,8,10,11,12', lista(6)  # administración: todos los activos menos ella y el superadministrador
        assert lista(7) == '1,2,3,4,5,6,7,8,10,11,12', lista(7)  # superadministrador: también él
        assert falla(1, 'select * from public.personas_para_vincular();', 'No tienes permiso')
        assert falla(8, 'select * from public.personas_para_vincular();', 'No tienes permiso')
        # Quien entra con PIN da su móvil; quien entra con Microsoft, su correo.
        assert valor(4, f"select concat_ws('|', con_pin, telefono, correo) from public.personas_para_vincular() where id='{uid(10)}';") == 'f|persona10@grupotrimodos.com'
        assert valor(4, f"select concat_ws('|', con_pin, telefono, correo) from public.personas_para_vincular() where id='{uid(3)}';") == 't|34699112233'
        # En el piloto el perfil Chófer no tiene «chofer.usar» (Mi camión): solo cuenta como chófer quien lo tenga.
        assert valor(4, f"select telefono || '|' || chofer from public.personas_para_vincular() where id='{uid(1)}';") == '34612345679|false'
        sql("update public.perfiles set permisos = permisos || '{chofer.usar}' where nombre = 'Chófer';")
        assert valor(4, f"select telefono || '|' || chofer from public.personas_para_vincular() where id='{uid(1)}';") == '34612345679|true'
        sql("update public.perfiles set permisos = array_remove(permisos, 'chofer.usar') where nombre = 'Chófer';")
        # Un móvil que han dado dos personas se avisa.
        assert valor(11, "select public.guardar_mi_telefono('699 11 22 33');") == '34699112233'
        assert valor(4, f"select string_agg(right(id::text,2)::int::text || ':' || telefono_repetido, ',' order by id) from public.personas_para_vincular() "
                        f"where con_pin;") == '1:false,3:true,11:true'
        assert valor(11, "select public.guardar_mi_telefono('+40 721 234 567');") == '40721234567'
        print('OK: el responsable ve para enlazar solo a las personas activas de sus centros, sin superadministradores', flush=True)

        # Confirmar y deshacer solo desde el servidor: con la sesión del navegador, nunca (ni con ids inventados).
        for n in (4, 6, 7):
            assert falla(n, f"select public.confirmar_vinculo_odoo('{uid(n)}', '{uid(3)}', 99999999, 77777777);", 'permission denied'), \
                f'La persona {n} ha confirmado desde el navegador'
            assert falla(n, f"select public.deshacer_vinculo_odoo('{uid(n)}', '{uid(3)}');", 'permission denied')
        assert sql(f"set role anon; select public.confirmar_vinculo_odoo('{uid(4)}', '{uid(3)}', 1, null);", bien=False).returncode != 0
        assert fila(3) == '34699112233|f'
        print('OK: confirmar y deshacer no se pueden llamar con la sesión del navegador (solo el servidor)', flush=True)

        # El servidor confirma en nombre de un responsable de ese centro, y no de otro.
        assert confirmar(4, 1, 501, 9001)
        assert fila(1) == '34612345679|501|9001|4|t', fila(1)
        assert not confirmar(4, 2, 502, texto='no está en tus centros')
        assert fila(2) == '34699445566|f'
        assert not deshacer(5, 1, 'no está en tus centros')
        assert not confirmar(4, 4, 504, texto='tu propia cuenta'), 'Se ha confirmado a sí mismo'
        assert not confirmar(4, 9, 509), 'Se ha enlazado a una persona de baja'
        assert not confirmar(4, 3, 'null', texto='Elige la ficha')
        assert not confirmar(4, 7, 4242, texto='No puedes enlazar'), 'Un responsable ha enlazado a un superadministrador'
        assert confirmar(7, 7, 4242), 'El superadministrador no se ha podido enlazar a sí mismo'
        assert not deshacer(4, 7, 'No puedes'), 'Un responsable ha deshecho el enlace de un superadministrador'
        assert deshacer(7, 7)
        print('OK: el servidor confirma solo en nombre de alguien con permiso sobre esa persona; a un superadministrador, solo otro', flush=True)

        # Sin el permiso, nada; ni el operario ni un responsable al que se le quita; ni sin autor.
        assert not confirmar(3, 1, 503, texto='No puedes enlazar')
        assert not confirmar(1, 1, 501), 'Alguien se ha confirmado a sí mismo'
        assert not confirmar(8, 3, 503, texto='No puedes enlazar')
        assert not deshacer(3, 1, 'No puedes')
        assert como_servidor(f"select public.confirmar_vinculo_odoo(null, '{uid(3)}', 503, null);", 'No puedes').returncode
        assert como_servidor(f"select public.confirmar_vinculo_odoo('{uid(9)}', '{uid(3)}', 503, null);", 'No puedes').returncode   # de baja
        assert fila(3) == '34699112233|f'
        print('OK: un operario, un responsable sin «personas.vincular» o alguien de baja no confirma ni deshace', flush=True)

        # Una vez confirmado, la persona no cambia su móvil.
        assert falla(1, "select public.guardar_mi_telefono('600 00 00 01');", 'ya ha confirmado')
        assert fila(1).startswith('34612345679|')
        print('OK: con el enlace confirmado la persona ya no cambia su móvil', flush=True)

        # Un mismo empleado o conductor de Odoo no se enlaza a dos personas.
        assert not confirmar(4, 3, 501, texto='ya está enlazada con otra persona')
        assert not confirmar(6, 2, 501, texto='ya está enlazada con otra persona')
        assert not confirmar(4, 3, 503, 9001, texto='contacto conductor ya está enlazado')
        assert not confirmar(4, 1, 511, texto='ya está enlazada'), 'Ha cambiado un enlace sin deshacerlo'
        assert falla(7, f"update public.usuarios set odoo_employee_id = 503, vinculo_confirmado = now(), vinculo_confirmado_por = '{uid(7)}' "
                        f"where id = '{uid(3)}';", 'se confirma desde'), 'Se ha confirmado a mano saltándose la función'
        assert fila(3) == '34699112233|f'
        assert valor(4, "select string_agg(empleado::text || '/' || coalesce(conductor::text, '-'), ',') from public.fichas_odoo_enlazadas();") == '501/9001'
        assert falla(1, 'select * from public.fichas_odoo_enlazadas();', 'No tienes permiso')
        print('OK: una ficha de empleado o un contacto conductor no se enlaza a dos personas', flush=True)

        # Historial: solo añadir, lo ven la administración y quien actuó.
        # Tras comprobar los permisos de quien confirma, la consulta sigue sin usuario (no se queda con el suyo).
        r = como_servidor(f"begin; select public.confirmar_vinculo_odoo('{uid(5)}', '{uid(2)}', 502, null); "
                          "select '[' || coalesce(auth.uid()::text, 'sin usuario') || ']'; commit;")
        assert r.returncode == 0 and '[sin usuario]' in r.stdout, r.stdout + r.stderr
        historial = ("select coalesce(string_agg(accion || ':' || right(persona::text,2)::int || ':' || coalesce(empleado_nuevo::text,'-'), ',' order by id), '') "
                     "from public.vinculos_odoo_historial where accion in ('confirmar', 'deshacer') and persona <> '" + uid(7) + "';")
        assert valor(4, historial) == 'confirmar:1:501', valor(4, historial)
        assert valor(5, historial) == 'confirmar:2:502'
        assert valor(6, historial) == 'confirmar:1:501,confirmar:2:502'
        assert valor(1, historial) == ''
        assert valor(4, "select telefono || '|' || coalesce(empleado_antes::text, '-') || '|' || right(autor::text,1) from public.vinculos_odoo_historial "
                        f"where persona = '{uid(1)}';") == '34612345679|-|4'
        assert falla(4, "insert into public.vinculos_odoo_historial(persona, accion) values (gen_random_uuid(), 'confirmar');")
        assert falla(6, 'update public.vinculos_odoo_historial set empleado_nuevo = 1;')
        assert falla(7, 'delete from public.vinculos_odoo_historial;')
        r = sql('delete from public.vinculos_odoo_historial;', bien=False)
        assert r.returncode and 'no se modifica' in r.stderr, 'El servidor ha borrado el historial'
        assert falla(7, 'truncate public.vinculos_odoo_historial;')
        print('OK: el historial anota quién confirmó qué y nadie lo cambia ni lo borra', flush=True)

        # Con la jornada abierta y la entrada ya en Odoo no se cambia la ficha.
        def fichaje(n, tipo, estado, minutos):
            servidor(f"insert into public.fichajes(usuario_id, tipo, momento, creado_por, odoo_estado) "
                     f"values ('{uid(n)}', '{tipo}', now() - interval '{minutos} minutes', '{uid(n)}', '{estado}');")
        fichaje(1, 'entrada', 'enviado', 60)
        assert not deshacer(4, 1, 'jornada abierta'), 'Ha deshecho el enlace con la jornada abierta en Odoo'
        assert fila(1) == '34612345679|501|9001|4|t'
        fichaje(1, 'salida', 'enviado', 5)
        fichaje(3, 'entrada', 'pendiente', 30)
        print('OK: con la jornada abierta y la entrada ya en Odoo, la ficha no se cambia', flush=True)

        # Deshacer: la persona queda sin ficha, la ficha queda descartada, puede corregir su móvil y se anota.
        assert deshacer(4, 1)
        assert fila(1) == '34612345679|f', fila(1)
        assert servidor(f"select vinculo_rechazado from public.usuarios where id='{uid(1)}';") == '501'
        assert not deshacer(4, 1, 'no tiene un enlace confirmado')
        assert valor(1, "select public.guardar_mi_telefono('600 00 00 01');") == '34600000001'
        assert valor(6, "select accion || ':' || coalesce(empleado_antes::text,'-') || ':' || coalesce(conductor_antes::text,'-') || ':' || right(autor::text,1) "
                        "from public.vinculos_odoo_historial order by id desc limit 1;") == 'deshacer:501:9001:4'
        # El enlace automático (servidor) no le vuelve a poner la ficha descartada; otra, sí (sin confirmar).
        servidor(f"set role service_role; update public.usuarios set odoo_employee_id = 501 where id = '{uid(1)}' and odoo_employee_id is null;")
        assert fila(1) == '34600000001|f', fila(1)
        servidor(f"set role service_role; update public.usuarios set odoo_employee_id = 601 where id = '{uid(1)}' and odoo_employee_id is null;")
        assert fila(1) == '34600000001|601|f', fila(1)
        assert ultimo_historial() == 'cambio_servidor:-:601:servidor', ultimo_historial()
        # Nadie con sesión toca a mano la ficha descartada.
        assert falla(6, f"update public.usuarios set vinculo_rechazado = null where id = '{uid(1)}';", 'se confirma desde')
        # Confirmar de nuevo (la entrada de la persona 3 aún no ha ido a Odoo: se puede) libera la ficha y quita el descarte.
        assert confirmar(6, 3, 501, 9001), 'Tras deshacer, la ficha sigue ocupada'
        assert confirmar(4, 1, 601)
        assert servidor(f"select coalesce(vinculo_rechazado::text, '-') from public.usuarios where id='{uid(1)}';") == '-'
        print('OK: deshacer deja a la persona sin ficha, la descarta para el enlace automático y queda anotado', flush=True)

        # Confirmar otra ficha con la jornada abierta en Odoo, tampoco.
        assert deshacer(6, 3)
        fichaje(10, 'entrada', 'enviado', 20)
        servidor(f"update public.usuarios set odoo_employee_id = 700 where id = '{uid(10)}';")
        assert not confirmar(4, 10, 701, texto='jornada abierta'), 'Ha cambiado la ficha con la jornada abierta en Odoo'
        assert confirmar(4, 10, 700), 'No ha dejado confirmar la misma ficha en la que tiene la jornada abierta'
        print('OK: con la jornada abierta solo se confirma la ficha en la que ya está su entrada', flush=True)

        # Cambios por otras vías: Administración → Personas o el enlace automático del servidor.
        assert not falla(6, f"update public.usuarios set odoo_employee_id = 777 where id = '{uid(10)}';")
        assert fila(10) == '777|f', fila(10)
        assert ultimo_historial() == 'cambio_administracion:700:777:6'
        assert falla(6, f"update public.usuarios set odoo_conductor_id = 9002 where id = '{uid(10)}';", 'se confirma desde')
        assert falla(6, f"update public.usuarios set vinculo_confirmado = now() where id = '{uid(10)}';", 'se confirma desde')
        assert not falla(6, f"update public.usuarios set nombre = 'Bea Operaria Ruiz' where id = '{uid(2)}';")
        assert fila(2) == '34699445566|502|5|t', fila(2)
        servidor(f"set role service_role; update public.usuarios set odoo_employee_id = 888 where id = '{uid(5)}' and odoo_employee_id is null;")
        assert ultimo_historial() == 'cambio_servidor:-:888:servidor'
        # El enlace automático puede repetir una ficha sin confirmar (como antes) sin fallar; la confirmación, no.
        servidor(f"set role service_role; update public.usuarios set odoo_employee_id = 888 where id = '{uid(8)}' and odoo_employee_id is null;")
        assert not confirmar(7, 8, 888, texto='ya está enlazada con otra persona')
        # Un cambio del móvil por fuera de la función con el enlace confirmado queda anotado.
        servidor(f"update public.telefonos_personas set telefono = '34611111111' where usuario_id = '{uid(2)}';")
        assert servidor("select accion || ':' || telefono || ':' || right(persona::text,1) from public.vinculos_odoo_historial order by id desc limit 1;") == 'cambio_telefono:34611111111:2'
        print('OK: un cambio de ficha o de móvil fuera de la confirmación queda anotado (y la ficha, sin confirmar)', flush=True)

        # Las políticas de cambio de usuarios siguen igual: un responsable no edita fichas a mano.
        assert valor(4, f"update public.usuarios set odoo_employee_id = 1 where id = '{uid(1)}' returning id;") == ''
        print('OK: el responsable no cambia nada de usuarios por fuera de las funciones', flush=True)

        # Sin sesión, nada.
        for consulta in ("select public.guardar_mi_telefono('612345678');", 'select * from public.personas_para_vincular();',
                         'select * from public.fichas_odoo_enlazadas();', 'select * from public.mi_telefono();',
                         f"select public.confirmar_vinculo_odoo('{uid(4)}', '{uid(2)}', 1, null);",
                         f"select public.deshacer_vinculo_odoo('{uid(4)}', '{uid(2)}');", 'select count(*) from public.vinculos_odoo_historial;',
                         'select count(*) from public.telefonos_personas;'):
            r = sql('set role anon; ' + consulta, bien=False)
            assert r.returncode != 0, f'Alguien sin sesión ha podido: {consulta}'
        r = sql("set role authenticated; select public.guardar_mi_telefono('612345678');", bien=False)
        assert r.returncode != 0, 'Sin usuario se ha guardado un móvil'
        print('OK: sin sesión no se lee ni se cambia nada', flush=True)
    finally:
        sql(f'drop database {db};', base='postgres')


if __name__ == '__main__':
    main()
