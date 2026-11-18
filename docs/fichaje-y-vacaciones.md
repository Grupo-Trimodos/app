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

## App del móvil para operarios y chóferes (18-11-2026)

Quien tiene la pantalla «campo» ve una sola pantalla de inicio y, abajo, una barra fija (`src/app/BarraCampo.tsx`,
pintada desde `Cabecera.tsx`) con «Inicio», «Vacaciones», «Mis fichajes» y «Herramientas»; cada pestaña sale solo con
su permiso (Herramientas, con algún permiso del área «automatizaciones»). La barra también quita `?ok=`/`?error=` de la
dirección para que el mensaje no reaparezca al recargar. Al trabajador **no se le enseña nada de Odoo** (ni estados de
envío ni su ficha); en la pantalla de oficina «Mis fichajes» los sigue mostrando.

La tarjeta de jornada (`RelojJornada`, en el inicio y en «Mis fichajes») usa `vistaDelDia` de `src/lib/jornada.ts`,
solo de presentación: estado con color («Trabajando desde las 7:02», «En pausa desde las 10:30», «Jornada terminada a
las 15:04»), un contador que avanza cada segundo en el móvil a partir de los fichajes y de la hora del servidor, y
«Esta semana: X de 40 h» con una barra (jornada de referencia de 40 h, `JORNADA_SEMANAL_HORAS`). Con la jornada
abierta, el número grande es lo que lleva en ella (aunque empezara ayer) y, si hoy ya terminó otra, «Hoy en total».
Sin jornada abierta, «Hoy has trabajado» suma las jornadas que han terminado hoy: el turno de noche cuenta el día que
acaba. La semana (de lunes a domingo) sigue la regla de imputación por día de entrada.

El botón grande es la acción que toca: «Fichar entrada», «Fichar salida» (pide confirmación) o, en pausa, «Volver al
trabajo»; el secundario es «Hacer una pausa» o «Fichar salida». Se ficha con la acción `ficharAhora`, que devuelve el
resultado a la tarjeta («Entrada fichada a las 7:02», con vibración si el móvil la tiene) y refresca la página; el
botón se desactiva mientras se envía. Sin conexión: «No hay conexión. No se ha fichado. Inténtalo de nuevo.» (no hay
modo sin conexión). Con una jornada pendiente de cierre, encima de la tarjeta: «Ayer no fichaste la salida. Tu
responsable la cerrará con la hora real.» y no hay botones (la base de datos no deja fichar hasta el cierre). Debajo,
solo si las hay, sus solicitudes de vacaciones pendientes y la próxima aprobada. El inicio de campo y «Mis fichajes»
se ven en oscuro si el móvil está en modo oscuro; también «Vacaciones» y «Herramientas»; el resto de la app sigue en claro.

### Vacaciones, Mis fichajes y Herramientas en el móvil

Encargo de Félix (18-11-2026): por ahora operarios y chóferes **no se enlazan con su ficha de Odoo**; todo se guarda en
la app y se enlazará más adelante. En estas pantallas **no se enseña nada de Odoo** (ni estados de envío, ni «origen»,
ni la ficha de empleado), ni palabras como «provisional» o «semana cerrada». La pantalla de oficina sigue mostrando el
estado del envío a Odoo como antes.

- **Vacaciones** (`src/app/ausencias/`). **Todavía no hay saldo de días**: Félix dirá más adelante cuántos tiene cada
  uno. Mientras, arriba se **recopilan las horas trabajadas** de este año, de este mes y de esta semana (frente a las
  40 h), con `horasTrabajadas` de `src/lib/jornada.ts` y las mismas reglas que el resto (cada jornada cuenta el día de
  su entrada, también el turno de noche del 31 de diciembre; las pausas no cuentan; la jornada abierta suma lo que lleva;
  la pendiente de cierre y la que hay que revisar no suman). Debajo: «Tus días de vacaciones aparecerán aquí cuando la
  empresa los configure.» Para pedir días (`PedirDias.tsx`): tipo, primer y último día con el selector de fecha del
  móvil y un comentario; al momento dice «Son 5 días laborables (de lunes a viernes)» y avisa si entra un fin de semana
  (los festivos todavía no se descuentan). Se guarda igual que antes (acción `pedirAusencia`, misma tabla y reglas).
  «Mis solicitudes» son tarjetas con las fechas en claro («Del lunes 14 al viernes 18 de diciembre»), el tipo, los días
  laborables, el estado con color («Pendiente de que la apruebe tu responsable», «Aprobada», «Rechazada: motivo») y a
  quién le llega (`quien_me_aprueba`). En la pantalla de oficina se ve igual, con el estado del envío a Odoo de las aprobadas.
- **Mis fichajes** (`src/app/fichaje/`): la tarjeta de la jornada y, debajo, pestañas «Semana» y «Mes» con anterior y
  siguiente (`?semana=AAAA-MM-DD`, `?mes=AAAA-MM`; nunca hacia el futuro). Cada día: entrada–salida (el turno de noche,
  «22:00 – 6:00 del martes»), pausas, total y, si está en curso, «Trabajando» o «En pausa». Total de la semana frente a
  40 h o total del mes. Lo que anotó el responsable se ve con su motivo («Salida a las 15:00 anotada por tu
  responsable: …»). «Descargar mi registro» abre `/fichaje/registro?mes=…`: el mes con nombre, centro, cada día
  (entrada, salida, pausas y horas), total y las correcciones al pie, para imprimir o «Guardar como PDF» con el cuadro
  de imprimir del navegador (`window.print` y `@media print`, sin librerías). Todo sale de `registroDeJornadas`.
- **Herramientas** (`src/app/automatizaciones/page.tsx`): en el móvil, tarjetas grandes con las automatizaciones que
  permite su perfil. Sin ninguna, la pestaña no sale y la página dice «Todavía no tienes herramientas activadas.».

Pruebas: `tests/web/registro.test.mjs` (horas del año, mes y semana con turno de noche entre meses y entre años, días
laborables de una solicitud, fechas en español y semanas y meses de «Mis fichajes»), dentro de `npm run test:jornada`.

Revisión del 18-11-2026: el registro mensual no ofrece el botón de imprimir si falla la consulta de fichajes; mantiene
el error visible para evitar presentar una lectura fallida como un registro vacío.
