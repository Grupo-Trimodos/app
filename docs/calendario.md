# Calendario

Pantalla `/calendario` (área `calendario` de `src/lib/permisos.json`). Autorizada por Félix el 17-11-2026 como excepción a
la fase piloto. **Nada de esto va a Odoo.**

## Qué ve cada uno

En el ordenador, el mes en cuadrícula y debajo el detalle de cada día; en el móvil, solo la agenda por días (los días con
algo y hoy). «Anterior», «Hoy» y «Siguiente» cambian de mes. Todas las horas son de Madrid (`ZONA` de
`src/lib/jornada.ts`).

Cada día junta:

- **Mis notas**: lo que la persona apunta. Solo las ve ella (ni su responsable ni la administración). Se cambian y se borran.
- **Fechas señaladas**: comidas, webinars, formaciones… con lugar y enlace opcionales. Dicen para quién son y quién las publicó.
- **Vacaciones y ausencias aprobadas** de la persona (se leen de `ausencias`, no se copian).
- **Outlook**: solo para quien entra con Microsoft y con el calendario de Outlook activado (ver abajo).

Chóferes y operarios (pantalla del móvil) tienen «Mi calendario» en sus accesos y, en el inicio, la línea «Próximo en tu
calendario» (`src/app/calendario/Proximo.tsx`).

## Permisos

| Permiso | Para qué | Perfiles (migración) |
|---|---|---|
| `calendario.usar` (de puesto) | Apuntar sus notas y ver las fechas señaladas que le tocan | Chófer, Operario, Oficina, Responsable, Administrador |
| `calendario.publicar` | Publicar fechas señaladas | Responsable, Administrador |

Fechas señaladas (`supabase/migrations/20261117130000_calendario.sql`, RLS):

- **Para todos**: las ve cualquier persona activa. **Para un centro**: quien tiene algún perfil en ese centro. **Para un
  equipo**: sus miembros (`privado.mis_equipos()`; si el equipo se archiva, dejan de verla). Siempre su autor y la
  administración (`admin.usuarios`).
- Publicar exige `calendario.publicar` y, para un centro, tenerlo en ese centro (en todos si el perfil vale en todos los
  centros o es de administración); para un equipo, gestionarlo (`privado.equipos_que_gestiono()`).
- Cambian o archivan su autor (mientras conserve el permiso y el alcance) o la administración. **No se borran**: se
  archivan y se pueden recuperar. Archivadas, solo las ven su autor y la administración.
- Los conjuntos se calculan una vez por consulta (`privado.fechas_que_veo()`, `privado.centros_donde_publico()`…). La
  web lee con `public.fechas_senaladas_entre(desde, hasta, archivadas)`, que añade el nombre del autor, del centro y del
  equipo sin abrir las fichas de nadie.
- El enlace solo admite `http://` o `https://` (lo comprueban la web y la base de datos).

Si la migración no está aplicada, la página dice «El calendario todavía no está preparado» y el inicio no enseña nada.

## Outlook (envío nuevo a Microsoft, no a Odoo)

Reutiliza `src/lib/outlook.ts`: el mismo token cifrado (`microsoft_tokens`), el mismo permiso `Calendars.ReadWrite` y el
mismo interruptor. Sin `OUTLOOK_CALENDARIO=true` (y las variables de `docs/configuracion-inicial.md`) o sin token de esa
persona, **la pantalla no muestra nada de Outlook** y todo lo demás funciona igual. Quien entra con código y PIN nunca
tiene Outlook.

Con Outlook conectado:

- Se leen sus citas del mes (`citasEntre`, hasta 300) y se mezclan marcadas «Outlook». Lo que ya es una nota o una fecha
  señalada copiada (o la ausencia que la app apuntó al aprobarse) no se repite.
- Al apuntar una nota, «Añadir también a mi Outlook» crea el evento (`crearEventoOutlook`) y guarda su id en
  `calendario_notas.outlook_evento_id`. Al cambiar la nota se cambia el evento; al borrarla se ofrece borrarlo también.
- Las fechas señaladas tienen «Añadir a mi Outlook».
- Es una **escritura en el calendario de Outlook de la propia persona**, con su permiso de Microsoft y solo cuando ella
  pulsa. Cada evento lleva un `transactionId` (`trimodos-nota-<id>` o `trimodos-fecha-<id>`) para que un reintento no lo
  duplique. No toca Odoo ni `ESCRITURAS`.

## Pruebas

- `scripts/prueba_calendario_db.py` (Docker, normal y `--como-produccion`): notas ajenas, quién publica, quién ve cada
  alcance, archivar, enlaces y sin sesión.
- `tests/web/calendario.test.mjs`: mes, agenda, zona horaria, medianoche y días completos, y Outlook con Microsoft Graph
  simulado (leer, crear, cambiar, borrar y apagado).

## Revisión de continuidad (18-11-2026)

- Los formularios desactivan su botón durante el envío y muestran «Guardando…».
- Una hora inexistente al adelantar el reloj de Madrid se rechaza con un mensaje, en vez de guardar una hora distinta.
  Se comprueba también la hora final y los eventos que pasan a la madrugada siguiente. Las horas válidas antes y después
  del salto conservan su hora local. En la hora repetida de octubre se conserva la elección existente del conversor.
- Si falla la lectura de ausencias, el calendario avisa de que no está completo. También avisa si alcanza el límite de
  500 notas, en lugar de dar a entender que las ha mostrado todas.
- Pulsar un día vacío del mes permite apuntar una nota cuando se tiene permiso, sin saltar a un detalle inexistente.
- Si el evento se creó en Outlook pero no se pudo guardar su vínculo en la nota, se explica el resultado parcial y
  que los cambios posteriores deberán revisarse también en Outlook; no se comunica una sincronización correcta.

Comprobaciones locales: 75 pruebas web, 390 Python (11 omitidas), TypeScript y compilación; pruebas de calendario en
PostgreSQL local con todas las migraciones y con `--como-produccion`. Microsoft Graph se simula en las pruebas: no se
han creado ni borrado citas reales. No se ha aplicado ninguna migración ni desplegado estos cambios en producción.
