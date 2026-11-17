# Fichaje y vacaciones (piloto)

Cómo funcionan el fichaje, el cálculo de jornadas y las vacaciones del piloto.

- **Supabase guarda la jornada** y Odoo recibe una copia, excepción aprobada por Félix para poder fichar aunque Odoo no responda. Los fichajes no se borran ni se editan: si alguien se equivoca, su responsable añade una **corrección** con su motivo (queda quién y cuándo). Uno mismo solo puede fichar «ahora» (la base de datos rechaza horas pasadas o futuras).
- **Envío a Odoo:** tras cada fichaje (y cada corrección) la web llama a la API Python **después de responder** (`enviarFichajesDespues` de `src/lib/python.ts`), así quien ficha no espera a Odoo: justo después el fichaje se ve «pendiente» y al volver a cargar, «En Odoo». La API manda lo pendiente a `hr.attendance` (entrada/vuelta de pausa abren; pausa/salida cierran). Cada fichaje muestra si está en Odoo, pendiente o con error, y hay botón de reintentar. **`RRHH_DRY_RUN`** (por defecto `true`, independiente del `DRY_RUN` de DECA) marca «modo prueba» y no escribe nada en Odoo. Un registro ya enviado no se puede volver a enviar (lo impide la base de datos).
- Si Odoo rechaza un fichaje (p. ej. una entrada de otro día sin cerrar), queda en error y los siguientes de esa persona esperan hasta arreglarlo en Odoo y reintentar; las correcciones con hora pasada que Odoo rechace se arreglan a mano allí y no frenan al resto.
- **Ficha de empleado automática:** para llegar a Odoo hace falta el id de empleado. Se busca solo: por **correo de trabajo** (quien entra con Microsoft) o por el **código** en el campo «Credencial» (`barcode`) de la ficha (quien entra con código + PIN). Si hay varias o ninguna, la pantalla de Sincronización lo dice y se pone a mano en Administración.
- **Ausencias:** hoy se piden y se aprueban en la app; al aprobarlas se crea la solicitud en `hr.leave`. El tipo de Odoo se elige **solo por su nombre** (vacaciones, enfermedad/médico, asuntos propios, no retribuido…). Para forzarlo: `ODOO_TIPOS_AUSENCIA` (JSON, p. ej. `{"vacaciones": 1}`). En Odoo queda para validar según su flujo. Así hay dos aprobaciones y dos estados, y el saldo de Odoo no se ve: duplicidad pendiente de un encargo aparte.
- **Inicio** (`src/app/page.tsx`): «Mi jornada» con el botón de fichar (el mismo que «Fichaje»: guarda en Supabase y envía a Odoo justo después), horas de hoy y de la semana y si el último fichaje está en Odoo. Debajo, **indicadores según los permisos**, nunca según el perfil: mi camión (`chofer.usar`), flota en movimiento y que requiere atención (`flota.ver`, se carga aparte para no frenar la página), trabajando ahora (`equipo.ver`), ausencias por aprobar (`ausencias.aprobar`), usuarios sin activar (`admin.usuarios`), envíos a Odoo con error (`admin.sincronizacion`) y mis solicitudes y próxima ausencia (`ausencias.pedir`).
- **Mi equipo:** con los permisos «Ver a las personas de sus centros», «Aprobar ausencias» y «Corregir fichajes» (perfil «Responsable» de serie). Nadie aprueba ni corrige lo suyo.

## Cálculo de jornadas y salidas olvidadas

Las cinco vistas (Inicio, InicioCampo, Fichaje, Mi camión y Mi equipo) usan `calcularJornada` de `src/lib/jornada.ts`.
Se ordenan los fichajes por instante e id, se reconstruye cada jornada desde su entrada hasta su salida y se descuentan
las pausas. Toda la jornada se imputa a la fecha de entrada en Madrid, incluso al cruzar medianoche o el lunes. Las
utilidades de conversión de Madrid se mantienen: la duración es tiempo real transcurrido (22–06 son 7 horas en el
cambio de marzo y 9 en el de octubre).

A las **16 horas transcurridas desde la entrada, incluidas las pausas**, una jornada sin salida queda **pendiente de
cierre**. Su contador provisional se congela en lo trabajado hasta ese límite, descontando pausas; no se crea una salida
ni se suman esas horas a los totales cerrados. Una salida real registrada por el responsable recalcula las horas completas,
aunque sean más de 16. Las jornadas con fichajes incoherentes se señalan para revisión y se excluyen de los totales cerrados.

El trabajador ve el aviso y no puede seguir fichando hasta que su responsable cierre la jornada. El control se hace en las
acciones de Fichaje y Mi camión y también en PostgreSQL, sin olvidar entradas antiguas. El responsable ve el contador en
Inicio y en sus tareas pendientes; en **Mi equipo → Jornadas pendientes de cierre** puede revisar los fichajes de todos los
centros donde tenga `fichaje.corregir` y anotar fecha y hora reales de salida y motivo. No puede cerrar sus propios fichajes.
El cierre añade un fichaje `salida`, de origen `correccion`, con `creado_por`, `creado` y `nota`: no modifica ni borra los anteriores.

La lectura `fichajes_para_jornada` devuelve secuencias completas desde el último cierre anterior al período solicitado y
respeta RLS. La web pagina esta lectura; no corta una jornada a medianoche ni descarta entradas abiertas de días anteriores.
`cerrar_jornada` comprueba permiso, fecha, motivo y que la jornada siga abierta bajo el mismo bloqueo por persona que el
fichaje normal. Dos cierres simultáneos solo pueden añadir una salida. La corrección utiliza el envío a Odoo existente;
no se amplían sus escrituras ni se cambia su modo de ejecución.

**Despliegue:** requiere la nueva migración `20261110000000_jornadas_pendientes.sql` antes de publicar esta versión de la
web. No se modifican políticas RLS ni se crean tablas. Validar primero fuera de producción. Si la migración no está
instalada o falla la lectura, se muestra el error y las acciones no permiten fichar a ciegas.

**Pruebas:** `npm run test:jornada` (Node 22.6 o posterior), suite Python y compilación de la web. La comprobación real de
la migración y las operaciones simultáneas se ejecuta con `scripts.prueba_jornadas_db`, descrito en `docs/scripts.md`.

## Reloj y acciones en móvil (17-11-2026)

InicioCampo y Fichaje comparten `RelojJornada`. Se recalcula cada 15 segundos desde el instante del servidor, con
`calcularJornada`; respeta pausas y el bloqueo a las 16 horas. Al volver a una pestaña se refrescan los datos.
El servidor sigue validando cada acción: el reloj no escribe fichajes ni decide la hora que se guarda.

`presentarJornada` distingue el turno nocturno terminado hoy («Última jornada») sin cambiar su imputación al día de
entrada. «Esta semana» incluye la jornada abierta solo si pertenece a esa semana, no está pendiente de cierre y no
tiene incidencias; lo indica debajo del total. Los totales cerrados utilizados por las otras pantallas no cambian.

«Terminar jornada» aparece primero y requiere confirmación. El botón de envío se desactiva mientras se guarda.
«Mi empresa y mi equipo» queda debajo del bloque de fichaje para que su carga no desplace los botones. Los estados y
los errores del envío a Odoo siguen visibles. Este cambio no modifica acciones de servidor, migraciones ni integración.
