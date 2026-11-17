# Odoo

**Producción: Odoo 18**, `https://stinsa18.tecnativa.net`, base `prod`, desde el 30-10-2026. Antes era Odoo 15, y parte
del código y de los textos se escribió para la 15. Lo que cambia en la 18:
- La analítica va en `analytic_distribution`. Ya no existen `analytic_account_id` ni `analytic_tag_ids` en los apuntes, ni
  las etiquetas analíticas (`account.analytic.tag`). Las cifras por centro y el catálogo analítico de Administración
  están escritos para la 15 y hay que adaptarlos. Están ocultos en el piloto.
- `message_post` necesita `body_is_html=True`; la app ya lo envía en la 18.
- Las claves API son de cada Odoo: una clave del Odoo 15 no entra en el 18. Se crean en *Mi perfil → Seguridad de la
  cuenta → Nueva clave API*.
- `scripts.comprobar_compatibilidad` revisa, solo leyendo, lo que la app usa de Odoo en una versión concreta.

Odoo es la base de datos principal. Qué se puede leer y escribir: `AGENTS.md`, base 4. Todo pasa por `servicios/odoo_client.py` (lista blanca `ALLOWED_CALLS`); ARGON tiene su propia lista congelada.

## Leer y escribir en Odoo

**Leer:** cualquier modelo, solo con los métodos de lectura (`METODOS_LECTURA` en `servicios/odoo_client.py`). Lo leído
solo llega a una pantalla por una ruta concreta de la API con su permiso. No existe ninguna ruta que lea «el modelo que le
pidan», y `tests/test_odoo_escrituras.py` falla si aparece. Nóminas, salarios, contratos y contabilidad solo se enseñan
con el permiso que les corresponda (hoy, la contabilidad resumida con `direccion.finanzas`).

**Escribir:** solo la lista cerrada `ESCRITURAS`. Cada entrada dice qué toca y la única función que la usa:

| Qué | Modelo y método | Lo provoca | Interruptor |
|---|---|---|---|
| Abrir la asistencia de un empleado | `hr.attendance` · `create` | Fichar entrada o volver de la pausa | `RRHH_DRY_RUN` |
| Cerrar su asistencia abierta (solo la hora de salida) | `hr.attendance` · `write` | Fichar pausa o salida | `RRHH_DRY_RUN` |
| Crear la solicitud de una ausencia | `hr.leave` · `create` | Su responsable la aprueba en la app; en Odoo queda por validar | `RRHH_DRY_RUN` |
| Mercancía, bultos, euro palets y peso de un bulto | `tms.package` · `write` (solo esos 4 campos) | El chófer corrige su orden en DECA | `DRY_RUN` |
| Nota en la tarea de la orden | `project.task` · `message_post` | DECA, al guardar | `DRY_RUN` |

ARGON tiene su propia lista, congelada (`docs/argon.md`). Borrar (`unlink`), nunca.

**Cómo se escribe (procedimiento fijo):**
1. **Primero se guarda en Supabase.** El registro (fichaje, ausencia) hace de cola: `odoo_estado` es pendiente, enviado,
   error, sin empleado o simulado. Se guarda también el id de Odoo y el motivo del error. DECA es la excepción: escribe
   al momento en la orden y deja su nota.
2. **Sale por su mapa** de `servicios/sincronizacion.py`, nunca por envíos sueltos. Se intenta al momento y la pasada
   automática diaria (o el botón «Sincronizar ahora») reintenta lo pendiente.
3. **Una sola vez:** lo enviado no se vuelve a enviar (lo impide la base de datos).
4. **Solo se crea o se completa lo propio:** una asistencia o una solicitud nuevas, cerrar la asistencia abierta de esa
   persona y los 4 campos de DECA. Nunca se corrige desde la app lo que alguien ha cambiado en Odoo: si algo está mal,
   se arregla en Odoo y se reintenta.
5. **Con interruptor:** con `RRHH_DRY_RUN=true` (fichajes y ausencias) o `DRY_RUN=true` (DECA) no sale nada; el registro
   queda como «simulado» y no se reenvía al apagarlo. En producción: `RRHH_DRY_RUN=false` (autorizado por Félix el
   5-11-2026) y `DRY_RUN=true`.
6. **A la vista:** cada registro enseña si está en Odoo, y los errores salen en Administración → Sincronización.
7. **Todo cambio se comprueba leyendo de vuelta:** antes de entregar un cambio que afecte a una integración se prueba en
   el Odoo de pruebas y se compara campo a campo lo escrito con lo guardado en la app. Normas completas en `AGENTS.md`,
   «Cambios que afectan a una integración con Odoo».
8. **Escritura nueva:** se propone a Félix con el modelo, los campos, quién la provoca, cuándo, cómo se ve si falla y cómo
   se deshace en Odoo. Solo con su permiso expreso se añade a `ESCRITURAS`, a su mapa y a la prueba.

## Sincronización automática

Nadie tiene que decidir dónde va cada dato: `servicios/sincronizacion.py` tiene un **mapa** por tipo de dato con la aplicación de Odoo que lo guarda y quién manda.

| Dato | Sentido | Aplicación de Odoo |
|---|---|---|
| Fichas de empleado | Odoo → app (enlace automático) | Empleados (`hr`) |
| Fichajes | app → Odoo | Asistencias (`hr_attendance`) |
| Vacaciones y ausencias aprobadas | app → Odoo | Ausencias (`hr_holidays`) |
| Camiones | Odoo → app | Flota (`fleet`) |

> Por las bases de `AGENTS.md`, deben pasar a mandar desde Odoo, sin copias que se editen en la app (pendiente de encargos aparte):
> - **Fichajes y vacaciones:** hoy se guardan en Supabase (`fichajes`, `ausencias`) y Odoo recibe una copia.
> - **Chóferes y flota:** hoy la app copia los camiones de Odoo en `vehiculos` y deja darlos de alta y de baja en Administración → Camiones. Además guarda en `asignaciones` qué camión lleva cada chófer, y en `usuarios` su tarjeta de tacógrafo.
> - **Documentación de chóferes y vehículos:** hoy se apunta en la app (`documentos`: carnés, CAP, tarjeta, reconocimiento, ITV, seguro, tacógrafo), y ya está en Odoo.
>
> Para leerla de Odoo hay que saber en qué modelos y campos está. Eso exige abrir lecturas que hoy no están en la lista de `odoo_client.py` (por ejemplo `fields_get` de empleados y vehículos), un encargo aparte.

- Antes de enviar mira qué aplicaciones están **instaladas** en Odoo; si falta una, ese dato se salta y se explica (nunca se fuerza otro sitio).
- Se envía **al momento** con cada acción (los fichajes, justo después de responder, para que fichar no espere a Odoo); además hay una **pasada automática** diaria (cron de Vercel a las 4:00 UTC, necesita `CRON_SECRET`) y el botón **Sincronizar ahora** en **Administración → Sincronización** (permiso «Ver y lanzar la sincronización»). Para más pasadas al día: un flujo de n8n que llame a `GET /api/odoo/procesar` con `Authorization: Bearer <CRON_SECRET>`.
- El **estado de envío** (enviado, error…) solo lo escribe el servidor con la **clave de servidor** (`SUPABASE_SECRET_KEY`), después de comprobar con el token del usuario que puede ver ese registro. Sin esa variable en Vercel, todo se guarda pero nada llega a Odoo. Cada pasada queda en `odoo_sincronizacion`.
- Con `RRHH_DRY_RUN=true` o con Odoo simulado (`ODOO_MODE=mock`) los registros quedan como **«simulado»** y no se guarda nada leído de Odoo (ni fichas ni camiones de prueba). Si al pasar a real se quiere enviar lo fichado en pruebas, en el editor SQL de Supabase: `update fichajes set odoo_estado = 'pendiente' where odoo_estado = 'simulado' and momento >= '<fecha>';` (desde la app no se puede).
- **Añadir un dato nuevo** (p. ej. documentación de vehículos): una entrada en `MAPAS` y su función en `PASOS`, sus lecturas/escrituras en la lista blanca de `odoo_client.py` y sus tests.

## Lecturas para el cuadro de mando (solo totales)

- **Finanzas de dirección en Odoo** (`servicios/direccion.py`, todo GET, solo lectura y solo totales):
  - `/api/odoo/finanzas` (permiso `direccion.finanzas`): facturación y ventas de los últimos 24 meses con sus comparativas (mes en curso frente al mismo día del mes anterior y del año pasado, año en curso frente al año pasado hasta el mismo día), cobros y pagos pendientes (vencido, lo que vence en 7 y 30 días, antigüedad en 5 tramos y los 8 clientes o proveedores con más pendiente) y pedidos confirmados sin facturar (y los de más de 30 días).
  - `/api/odoo/centros` (`direccion.finanzas`): ingresos, gastos y margen de cada centro activo según sus **cuentas o etiquetas analíticas**. Qué analítica es de cada centro se guarda en Supabase (`centro_analitica`) y se lee con el token de quien mira. Un centro sin analítica sale como «sin configurar».
  - `/api/odoo/analitica` (`admin.usuarios`): catálogo de cuentas y etiquetas analíticas para asignarlas a los centros.
  - `/api/odoo/comercial` (`direccion.ver`) añade las oportunidades ganadas y nuevas del mes anterior hasta el mismo día.
  - Todas aceptan `?empresa=<id>` (uno de `ODOO_COMPANY_IDS`; otro da error 400). Cada parte se calcula por separado: si falla o falta su aplicación, llega vacía con su aviso. Caché de 10 minutos (5 el comercial; 1 si algo falló). «Hoy» es el día de Madrid.
  - **Permisos de lectura** del usuario técnico de Odoo (en las dos empresas): facturas y apuntes (`account.move`, `account.move.line`), pedidos y sus líneas (`sale.order`, `sale.order.line`, de **todos** los comerciales, no «solo sus documentos»), cuentas y etiquetas analíticas (`account.analytic.account`, `account.analytic.tag`) y empresas (`res.company`). `scripts.comprobar_permisos` ya los comprueba. Escrito para Odoo 15: en producción (Odoo 18) ya no hay etiquetas analíticas y la analítica va en `analytic_distribution` (ver arriba).

## Catálogo de chóferes y vehículos (16-11-2026)

Autorizado por Félix ampliar el piloto a chóferes y flota y consultar el modo real.
`/transporte` consulta `/api/flota/catalogo-odoo` al abrir la página, sin guardar copias en Supabase.
Exige sesión real y el permiso global `transporte.ver` (todos los centros de las empresas configuradas),
que se asigna desde Perfiles; no se concede automáticamente a perfiles existentes.

- Vehículos activos: `fleet.vehicle`, matrícula, modelo, empresa y conductor asignado.
- Chóferes activos: `res.partner` con `is_driver=true`, nombre y empresa. No son todos los empleados.
- Solo empresas de `ODOO_COMPANY_IDS` y registros compartidos sin empresa. Estos últimos se indican expresamente.
- Búsqueda por matrícula o nombre, hasta 100 resultados por lista y aviso si hay más.
- La documentación y el reemplazo del flujo antiguo de asignaciones de «Mi camión» siguen pendientes.

Conexión comprobada: la URL de `.env.local`, `https://www.grupotrimodos.com`, responde con Odoo 18.
La dirección anterior `stinsa18.tecnativa.net` devolvió HTTP 503 en esta revisión.
La comprobación fue por API real, sin escrituras; no se comparó con la pantalla de Odoo ni se usó un entorno de pruebas.


La revisión posterior del 16-11-2026 separa el catálogo externo de la **flota propia**: la consulta inicial usa
`is_own_vehicle=true` y `company_owner_id` de las empresas configuradas. El catálogo anterior se conserva tras el permiso
adicional `transporte.externos`; los contactos conductores no representan empleados.

Avisos de asignación (17-11-2026, autorizado por Félix): en la vista «Flota propia», `/transporte` consulta también
`/api/flota/avisos-asignacion` (`transporte.ver`, sesión real; `avisos_asignacion_flota`, solo `search_read`, `read` y
`fields_get`). Camiones sin chófer: `fleet.vehicle` propio activo sin `driver_id` o cuyo `driver_id` es un contacto
archivado (se lee `active` con `read`; sale con la nota «chófer dado de baja»), por `vehicle_type` y los remolques aparte.
Chóferes sin camión: `res.partner` activo con `is_driver` con `parent_id child_of` el contacto de una empresa configurada
(incluye los que cuelgan de un centro: STINSA SEVILLA, BURRIANA, VILA-REAL, SILLA, TARRAGONA; se excluye el contacto de
la propia empresa) o con `employee_ids` en ellas, que no es `driver_id` de ningún vehículo propio activo (los de
subcontratas no cuentan). La empresa de cada chófer se busca subiendo por los `parent_id` (`read`) y, si no cuelga de una
empresa, por la `company_id` de su `hr.employee`. También: conductores con más de un vehículo y cuántos conductores no
tienen ficha de empleado enlazada. Si Odoo falla, solo el bloque de avisos lo dice.

Comprobación del 17-11-2026 (solo lecturas por API contra producción, `www.grupotrimodos.com`, base `prod`; **no hay Odoo
de pruebas**: falta `.env.pruebas`, y por la regla 2 de `AGENTS.md` hay que avisar a Félix antes de desplegar):
- El filtro anterior (`parent_id in`) daba 23 chóferes del grupo y 17 sin camión; dejaba fuera 65 contactos de los
  centros de STINSA (25 SEVILLA, 23 BURRIANA, 8 SILLA, 7 VILA-REAL, 2 TARRAGONA), 4 de ellos con camión propio. Con
  `child_of` salen 88 (89 menos el contacto de TRANSARGI, que tiene `is_driver` y es la propia empresa).
- Resultado actual: 90 camiones propios activos; 10 sin chófer, todos de STINSA (9 cabezas tractoras sin `driver_id` y
  9707HTM, cuyo conductor, el contacto 35657, está archivado y sin nombre); 0 de TRANSARGI. Chóferes sin camión: 78
  (STINSA 68, TRANSARGI 10); 13 conductores con más de un vehículo; los 66 conductores de camiones propios activos no
  tienen ficha de empleado enlazada.
- **Sin comprobar:** no se han comparado estas cifras con la pantalla de Odoo (Flota y Contactos), ni por empresa. Las
  pruebas automáticas (`tests/test_avisos_flota.py`) usan datos simulados y no sustituyen esa comparación.
La organización se lee de `hr.employee`, `hr.department`, `hr.work.location` y `hr.job`, sin copias editables.
Correspondencias y validación: [mapa-organizacion-odoo.md](mapa-organizacion-odoo.md).

## Enlace de cada persona con Odoo por su móvil (17-11-2026)

Autorizado por Félix. Funcionamiento y permisos: [acceso-y-perfiles.md](acceso-y-perfiles.md#enlace-con-odoo-por-el-móvil-17-11-2026).
**No añade ninguna escritura en Odoo** (`ESCRITURAS` no cambia). Lo que cambia es **quién rellena
`usuarios.odoo_employee_id`**, y de ese id salen los envíos de fichajes y ausencias. Por eso entra en las normas de
`AGENTS.md` sobre integraciones con Odoo.

**Qué alcanza:**
- **Lecturas nuevas** (`odoo_client.py`, solo `search_read`, dominios fijos): `empleados_para_vincular` (`hr.employee`
  activos de `ODOO_COMPANY_IDS`: nombre, empresa, departamento, puesto y `work_phone`, `mobile_phone`, `private_phone`)
  y `conductores_para_vincular` (`res.partner` activos con `is_driver` del grupo, mismo criterio que los avisos de
  flota: nombre, contacto padre, empresa, `phone`, `mobile`). Los teléfonos solo se comparan; la ruta nunca los devuelve
  enteros (como mucho las 3 últimas cifras). La ruta `GET /api/odoo/vinculos/pendientes` exige `personas.vincular`.
- **Envíos que dependen del enlace:** los mismos de antes, sin cambiar su código. Fichajes (`hr.attendance`: abrir y
  cerrar asistencias) y ausencias aprobadas (`hr.leave`: crear la solicitud) se envían al `odoo_employee_id` de la
  persona. Confirmar o deshacer un enlace cambia a qué ficha van **los envíos que salgan a partir de ese momento**.
  `odoo_conductor_id` no se usa en ningún envío.
- **Quién lo provoca:** el responsable o la administración al pulsar «Son la misma persona» o «Deshacer» en
  `/equipo/odoo`. Siguen como antes el campo de Administración → Personas y el enlace automático por correo de trabajo o
  código de credencial (`rrhh.empleado`); ahora, si cambian la ficha, el enlace queda sin confirmar y se anota.
- **Registros que ya existen:** en Odoo, ninguno se toca. En la app, a 17-11-2026 ninguna persona tenía
  `odoo_employee_id`.

**Qué pasa con lo fichado antes de enlazar** (`servicios/rrhh.py` y `servicios/sincronizacion.py`, sin cambios):
- Con `RRHH_DRY_RUN=true` (local y por defecto) todo queda «simulado» y no se reenvía nunca, haya enlace o no.
- Con `RRHH_DRY_RUN=false` (producción), si la persona no tiene ficha, cada envío intenta encontrarla sola por su correo
  de trabajo o su código (credencial `barcode`). Si hay exactamente una, la guarda (sin confirmar) y envía. Si no, sus
  fichajes pendientes quedan como **«sin empleado»**, con el motivo. Las ausencias aprobadas, igual.
- «Sin empleado» sigue en la cola: en cuanto la persona tiene ficha, el siguiente envío manda **todos** sus fichajes en
  cola, del más antiguo al más nuevo y sin límite de antigüedad. Ese envío llega con su siguiente fichaje, con
  «Reintentar» o con la pasada diaria (4:00 UTC), que también manda las ausencias aprobadas «sin empleado». Confirmar el
  enlace no lanza ningún envío por sí mismo.
- Cada fichaje antiguo crea o cierra su asistencia con la hora real de entonces, en UTC. Si en Odoo ya hay una entrada
  abierta de esa ficha, o asistencias que se solapan (por ejemplo, fichadas en Odoo por otra vía), Odoo lo rechaza: queda
  en «error» y los siguientes esperan detrás. Se arregla en Odoo y se reintenta. Una ausencia no se duplica si en Odoo
  ya hay una viva de esa ficha con las mismas fechas.
- Lo ya **enviado** a una ficha equivocada (por ejemplo, por un enlace automático erróneo) se queda en esa ficha. Deshacer
  o cambiar el enlace no lo mueve; se corrige a mano en Odoo (`AGENTS.md`, norma 9).
- Tras **deshacer**, la persona se queda sin ficha. El siguiente envío vuelve a buscarla por correo o código; si no la
  encuentra, sus fichajes quedan «sin empleado».

**Comprobación del 17-11-2026** (solo lecturas por API contra producción, Odoo 18, empresas 1 y 7; **no hay Odoo de
pruebas**: falta `.env.pruebas`):
- 129 fichas activas; 97 con algún teléfono (84 `work_phone`, 24 `mobile_phone`, 14 `private_phone`). Solo hay 39
  números distintos: 7 se repiten en varias fichas y cubren 85 de ellas (teléfonos de centro). Simulando que cada ficha
  con teléfono es una persona que da ese número, solo 29 reciben una propuesta segura de su propia ficha; el resto sale
  como «está en varias fichas: compruébalo». **La mayoría de enlaces se decidirán por nombre y empresa, no por el
  móvil**, hasta que Odoo tenga el móvil de cada persona.
- 88 contactos conductores del grupo; 22 con teléfono; 8 de esos números están en alguna ficha de empleado (4 en una
  sola).
- **Sin comprobar:** no hay Odoo de pruebas. Por eso, ni enlazar una persona real y leer de vuelta un fichaje suyo en
  Odoo (`AGENTS.md`, normas 2, 3 y 7), ni comparar estas cifras con la pantalla de Odoo. Antes de que los responsables
  empiecen a confirmar enlaces en producción hay que avisar a Félix. Lo prudente: confirmar primero una sola persona,
  dejar que fiche una vez, leer la asistencia en Odoo y comparar empleado, empresa y hora (UTC y Madrid) antes de seguir.
