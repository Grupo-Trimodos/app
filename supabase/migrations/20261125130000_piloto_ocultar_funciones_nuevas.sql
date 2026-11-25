-- Piloto de fichaje y vacaciones (AGENTS.md, base 6). Decisión de Félix del 25-11-2026: al aplicar en producción las
-- migraciones del 16 y 17-11 (grupos de trabajo, ediciones de empleados, equipos, enlace por móvil, viajes y
-- calendario) junto con los perfiles por organigrama, lo nuevo queda OCULTO quitando sus permisos de los perfiles.
-- El código y las tablas se quedan; se vuelve a dar desde Administración → Perfiles cuando se decida.
--
-- Se quitan: Equipos (equipos.ver, equipos.crear), Calendario (calendario.usar, calendario.publicar) y Mis viajes
-- (viajes.usar, viajes.seguimiento). Se mantiene «personas.vincular» (Mi equipo → Enlazar con Odoo): enlazar a cada
-- persona con su ficha de Odoo es lo que permite que el organigrama le dé su perfil y su alcance.
update public.perfiles p
   set permisos = array(select x from unnest(p.permisos) as x
                        where x <> all ('{equipos.ver,equipos.crear,calendario.usar,calendario.publicar,viajes.usar,viajes.seguimiento}'::text[])
                        order by x)
 where p.permisos && '{equipos.ver,equipos.crear,calendario.usar,calendario.publicar,viajes.usar,viajes.seguimiento}'::text[];
