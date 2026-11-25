"""Pruebas reales de los perfiles y el alcance por organigrama de Odoo en un PostgreSQL LOCAL; no lee archivos de entorno.

Uso: python3 -m scripts.prueba_organigrama_db --contenedor trimodos-jornada-pruebas     (Docker, como las demás)
     python3 -m scripts.prueba_organigrama_db --local /tmp/pg:5433                      (servidor local: socket:puerto)
Crea una base temporal con las migraciones del repo y un organigrama ficticio, consulta la base con la sesión de cada
persona (como haría alguien que se salta la web) y la elimina al terminar.

Organigrama ficticio (persona n = ficha 100+n; la persona 6 tiene además la ficha 206 en la empresa 7):
  1 directora (empresa 1, sin gerente)
  ├─ 2 jefe de tráfico ─ 3 encargado de tráfico ─ 4 y 5 conductores
  ├─ 6 gerente de la empresa 7 (fichas 106 en la 1 y 206 en la 7) ─ (206) ─ 7 técnico de tráfico y 9 administrativa (empresa 7)
  ├─ 8 administrativa de la empresa 9 («paraguas»: cuenta como de todas)
  └─ 11 operario de almacén
  10 superadministrador sin ficha
"""
import argparse
import json
from pathlib import Path
import subprocess
import uuid

RAIZ = Path(__file__).resolve().parents[1]
FICHAS = [
    # empleado, persona, empresa, puesto, gerente
    (101, 1, 1, "Dirección", None),
    (102, 2, 1, "Jefe de Tráfico", 101),
    (103, 3, 1, "Encargado de Tráfico", 102),
    (104, 4, 1, "Conductor", 103),
    (105, 5, 1, "Conductor", 103),
    (106, 6, 1, "Dirección", 101),
    (206, 6, 7, "Dirección", None),
    (107, 7, 7, "Técnico de Tráfico", 206),
    (108, 8, 9, "Administrativo", 101),
    (109, 9, 7, "Administrativo", 206),
    (111, 11, 1, "Operario de Almacén", 101),
]


def uid(n):
    return f'00000000-0000-0000-0000-{n:012}'


def foto(cambios=None):
    cambios = cambios or {}
    return json.dumps([{"empleado_id": e, "nombre": f"Ficha {e}", "empresa_id": emp, "empresa": f"Empresa {emp}",
                        "departamento_id": None, "departamento": None, "puesto_id": None,
                        "puesto": cambios.get(e, puesto), "gerente_id": g} for e, _, emp, puesto, g in FICHAS])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    grupo = parser.add_mutually_exclusive_group(required=True)
    grupo.add_argument('--contenedor', choices=['trimodos-jornada-pruebas'])
    grupo.add_argument('--local', help='socket:puerto de un PostgreSQL local de pruebas, p. ej. /tmp/pg:5433')
    args = parser.parse_args()
    db = 'organigrama_test_' + uuid.uuid4().hex

    def sql(texto, base=db, bien=True):
        if args.contenedor:
            orden = ['docker', 'exec', '-i', args.contenedor, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', base]
        else:
            host, puerto = args.local.rsplit(':', 1)
            orden = ['psql', '-h', host, '-p', puerto, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', base]
        r = subprocess.run(orden, input=texto, text=True, capture_output=True)
        if bien and r.returncode:
            raise AssertionError(r.stderr)
        return r

    def sesion(n, texto):
        return f"set role authenticated; set request.jwt.claim.sub='{uid(n)}';\n" + texto

    def valor(n, consulta):
        return sql(sesion(n, consulta)).stdout.strip()

    def falla(n, consulta):
        return sql(sesion(n, consulta), bien=False).returncode != 0

    def a_cargo(n, permiso='ausencias.aprobar'):
        """Personas (número) sobre las que n tiene ese permiso."""
        return valor(n, f"select coalesce(string_agg(right(x::text, 2)::int::text, ',' order by right(x::text, 2)::int), '') "
                        f"from privado.personas_a_cargo('{permiso}') x;")

    def puede(n, permiso, objetivo):
        return valor(n, f"select privado.puedo_sobre('{permiso}', '{uid(objetivo)}');") == 't'

    def perfiles(n):
        return sql(f"select coalesce(string_agg(p.nombre || ':' || up.origen, ',' order by p.nombre, up.origen), '') "
                   f"from public.usuario_perfil up join public.perfiles p on p.id = up.perfil_id where up.usuario_id = '{uid(n)}';").stdout.strip()

    def comprobar(condicion, texto):
        if not condicion:
            raise AssertionError(texto)
        print('ok ·', texto)

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
        sql(f"""
        insert into auth.users(id,email) select ('00000000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid, 'prueba' || n || '@example.invalid' from generate_series(1,11) n;
        update public.usuarios set activo=true;
        update public.usuarios set es_admin=true where id = '{uid(10)}';
        update public.usuarios set odoo_employee_id = 100 + right(id::text, 2)::int where id <> '{uid(10)}';
        insert into public.usuario_fichas_extra(usuario_id, empleado_id) values ('{uid(6)}', 206);
        insert into public.centros(nombre, tipo) values ('Centro A', 'centro');
        insert into public.usuario_perfil(usuario_id, perfil_id, centro_id)
          select '{uid(4)}', id, (select id from public.centros where nombre='Centro A') from public.perfiles where nombre='Operario';
        """)

        # --- La foto: solo la guarda el servidor, de una vez, y no se repite si no cambia nada.
        comprobar(falla(1, f"select public.guardar_foto_organigrama('x', $${foto()}$$::jsonb);"), 'nadie con sesión guarda fotos del organigrama')
        comprobar(falla(1, "insert into public.organigrama_fotos(origen, huella, fichas) values ('x','x',0);"), 'ni escribe en sus tablas')
        r = json.loads(sql(f"select public.guardar_foto_organigrama('prueba', $${foto()}$$::jsonb);").stdout)
        comprobar(r['nueva'] and r['fichas'] == len(FICHAS), 'la sincronización guarda la foto')
        r = json.loads(sql(f"select public.guardar_foto_organigrama('prueba', $${foto()}$$::jsonb);").stdout)
        comprobar(not r['nueva'], 'una foto igual a la anterior no se guarda otra vez')
        comprobar(sql("select public.guardar_foto_organigrama('prueba', '[]'::jsonb);", bien=False).returncode != 0, 'una foto vacía no se guarda')

        # --- Apagado: nadie gana ni pierde perfiles.
        comprobar(json.loads(sql("select public.aplicar_perfiles_organigrama();").stdout)['estado'] == 'apagado', 'apagado no aplica nada')
        comprobar(perfiles(4) == 'Operario:manual', 'apagado, el conductor solo tiene lo que se le puso a mano')
        comprobar(falla(4, "select public.aplicar_perfiles_organigrama();"), 'un conductor no puede aplicar perfiles')
        comprobar(falla(4, "select * from public.vista_previa_organigrama();"), 'un conductor no ve la vista previa')
        comprobar(valor(10, "select count(*) from public.vista_previa_organigrama();") == str(len(FICHAS)), 'la administración ve la vista previa')
        comprobar(falla(4, "update public.organigrama_ajustes set aplicar = true;") or
                  sql("select aplicar from public.organigrama_ajustes;").stdout.strip() == 'f', 'un conductor no lo enciende')

        # --- Encendido.
        sql(sesion(10, f"update public.organigrama_ajustes set aplicar = true, autor = '{uid(10)}';"))
        r = json.loads(valor(10, "select public.aplicar_perfiles_organigrama();"))
        comprobar(r['estado'] == 'aplicado' and r['puestos'] > 0, 'la administración aplica los perfiles')
        comprobar(perfiles(4) == 'Chófer:odoo,Operario:manual', 'el puesto da el perfil y lo puesto a mano se respeta')
        comprobar(perfiles(3) == 'Responsable:odoo,Tráfico:odoo', 'quien tiene gente a su cargo es Responsable')
        comprobar(perfiles(7) == 'Tráfico:odoo', 'quien no tiene a nadie no es Responsable')
        comprobar(perfiles(8) == 'Administración:odoo', 'los administrativos tienen Administración')
        comprobar(json.loads(sql("select public.aplicar_perfiles_organigrama();").stdout)['puestos'] == 0, 'aplicar dos veces no repite nada')

        # --- Quién está a cargo de quién (en cascada, por personas y no por fichas).
        comprobar(a_cargo(3) == '4,5', 'el encargado aprueba a sus conductores')
        comprobar(a_cargo(2) == '3,4,5', 'el jefe aprueba en cascada')
        comprobar(a_cargo(1) == '2,3,4,5,6,7,8,9,11', 'la directora llega a la otra empresa a través de la otra ficha de 6')
        comprobar(a_cargo(6) == '7,9', 'el gerente de la empresa 7 aprueba a la gente de su segunda ficha')
        comprobar(not puede(4, 'ausencias.aprobar', 3), 'un conductor no aprueba a su encargado')
        comprobar(not puede(3, 'ausencias.aprobar', 11), 'un encargado no aprueba a otra rama')
        comprobar(not puede(3, 'ausencias.aprobar', 3), 'nadie se aprueba a sí mismo')
        comprobar(a_cargo(9) == '6,7', 'administración de la empresa 7: toda su empresa y nada más')
        comprobar(a_cargo(8) == '1,2,3,4,5,6,7,9,11', 'administración de la empresa paraguas: todo el grupo')
        comprobar(a_cargo(7) == '', 'sin gente a su cargo no aprueba a nadie')
        comprobar(valor(4, "select count(*) from public.quien_me_aprueba('ausencias.aprobar') where centro = 'tu responsable en Odoo';") == '3',
                  'al conductor le aprueban su encargado y los de encima')
        comprobar(valor(4, "select count(*) from public.quien_me_aprueba('ausencias.aprobar') where centro = 'administración de tu empresa';") == '1',
                  'y la administración de su empresa (la paraguas)')
        comprobar(valor(3, "select count(*) from public.mi_gente_odoo() where directo;") == '2', 'Mi equipo: el encargado ve a sus dos directos')
        comprobar(valor(1, "select count(*) from public.mi_gente_odoo();") == '9', 'Mi equipo: la directora ve a todo lo que cuelga de ella')
        comprobar(valor(4, "select count(*) from public.mi_gente_odoo();") == '0', 'Mi equipo: un conductor no ve a nadie')
        comprobar(valor(3, f"select count(*) from public.fichajes where usuario_id = '{uid(11)}';") == '0', 'RLS: fuera de su rama no lee fichajes')

        # --- Una ficha es de una sola persona.
        comprobar(sql(f"insert into public.usuario_fichas_extra(usuario_id, empleado_id) values ('{uid(1)}', 104);", bien=False).returncode != 0,
                  'la ficha principal de otra persona no se puede añadir como segunda ficha')
        comprobar(falla(4, f"insert into public.usuario_fichas_extra(usuario_id, empleado_id, autor) values ('{uid(4)}', 999, '{uid(4)}');"),
                  'nadie sin administración se añade fichas')

        # --- Odoo cambia: la app le sigue sin tocar nada a mano.
        sql(f"select public.guardar_foto_organigrama('prueba', $${foto({105: 'Mecánico'})}$$::jsonb);")
        sql("select public.aplicar_perfiles_organigrama();")
        comprobar(perfiles(5) == 'Operario:odoo', 'cambia el puesto en Odoo: cambia el perfil (pierde Chófer)')
        sql(sesion(10, f"update public.organigrama_ajustes set aplicar = false, autor = '{uid(10)}';"))
        comprobar(json.loads(sql("select public.aplicar_perfiles_organigrama();").stdout)['estado'] == 'apagado' and perfiles(5) == 'Operario:odoo',
                  'apagar deja de aplicar y no quita nada')
        print('Todo correcto.')
    finally:
        sql(f'drop database if exists {db};', base='postgres', bien=False)


if __name__ == '__main__':
    main()
