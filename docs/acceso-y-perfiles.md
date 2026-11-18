# Acceso, perfiles y pantallas

## Cómo funciona el acceso

1. **Microsoft** (oficina), **Google** (chóferes y operarios, cuando se active) o **código + PIN** → sesión de Supabase en cookies.
2. `src/proxy.ts` renueva la sesión en cada página y manda al login a quien no la tenga.
3. **Perfiles configurables.** Un *perfil* es un puesto (Chófer, Operario de almacén, Jefe de tráfico, RR. HH.…) con una lista de **permisos**. El administrador crea y edita perfiles desde **Administración → Perfiles** marcando casillas, y asigna a cada persona uno o varios perfiles **por centro** (`perfiles`, `usuario_perfil`). Lo que ve y puede hacer una persona es la suma de sus perfiles.
   - Los permisos sobre otras personas (ver equipo, aprobar ausencias, corregir fichajes) valen en los centros donde tiene ese perfil, o en **todos** si el perfil lo marca.
   - `usuarios.es_admin` = **superadministrador**: todo, en todos los centros. Solo otro superadministrador (o el editor SQL de Supabase) puede nombrarlo o cambiar su ficha.
   - El permiso «Gestionar usuarios, perfiles y centros» puede darse cualquier otro permiso: solo para administración.
4. **Catálogo único de permisos:** `src/lib/permisos.json` (áreas y permisos). De ahí salen el menú y las herramientas del inicio y las casillas del editor de perfiles. Los mismos identificadores los exigen la base de datos (`privado.tengo_permiso`, `privado.puedo_sobre`) y la API Python (`requiere_permiso`).
5. **RLS**: aunque alguien manipule la web, la base de datos solo deja hacer lo que permiten sus perfiles.
6. **DECA**: sus pantallas piden el token a `/api/sesion/token` y lo mandan a la API Python (`Authorization: Bearer`). La API lo valida con Supabase y exige usuario **activo** con el permiso **`deca.usar`**. El **nombre del conductor queda en la nota** de la tarea de Odoo.

## Grupos de trabajo (estructura preparada, sin sincronizar todavía)

Migración `20261116000000_grupos_de_trabajo.sql`. Cada ficha responde a cuatro preguntas y Odoo manda en las cuatro; la
app no las cambia en Odoo. La sincronización desde Odoo está por hacer: hoy las tablas existen y se rellenan a mano.

| Pregunta | En Odoo | En la app |
|---|---|---|
| ¿Dónde? | Ubicación de trabajo | `centros`, con `tipo`: **centro** (oficina y almacén) o **zona** (chóferes, que no tienen centro) |
| ¿En qué área? | Departamento | `departamentos` (un solo nivel) y `usuarios.departamento_id` |
| ¿Qué hace? (chóferes) | Puesto de trabajo | `tipos_transporte` y `usuarios.tipo_transporte_id` |
| ¿Quién es su responsable? | Gerente / responsable del departamento | `centros.responsable_id`, `departamentos.responsable_id` |

- **Pertenencia:** sigue en `usuario_perfil` (una persona puede estar en varios centros o zonas). `origen` dice si la
  fila la puso la sincronización (`odoo`) o la administración (`manual`, para excepciones y equipos temporales).
- **Quién ve a quién:** como antes, quien tiene un perfil con el permiso en un centro o zona lo ejerce sobre las personas
  de ese centro o zona. Si la fila lleva `departamento_id`, solo sobre las de ese departamento dentro del centro. Un
  límite por persona, perfil y centro: quien lleve dos departamentos del mismo centro lleva el centro entero.
- **El responsable** de `centros` y `departamentos` es informativo (quién es). Lo que le deja ver y aprobar es su perfil
  Responsable en ese centro; la sincronización se lo pondrá a quien diga Odoo.
- **Rendimiento:** la lectura de `fichajes` y `ausencias` usa `privado.personas_a_cargo(permiso)`, que calcula la lista
  de personas una vez por consulta. `privado.puedo_sobre` sigue igual para el resto.
- **No confundir** con `zonas` y `chofer_zona` (chóferes por cliente o ruta), ocultas en el piloto.
- **Pruebas:** `scripts.prueba_grupos_db` (PostgreSQL local en Docker).

## Equipos (17-11-2026)

`/equipos` (migración `20261117100000_equipos.sql`, tablas `equipos_trabajo` y `equipos_trabajo_miembros`; el nombre
`equipos` ya era de las carretillas de Seguridad). No confundir con «Mi equipo» (`/equipo`), que son las personas a tu
cargo por centro.

- **Qué son:** grupos de trabajo que crea un responsable con personas activas de **cualquier** centro, zona u oficina
  («aunque se trabaje en la misma zona no se trabaja en lo mismo»). No dependen de centros, zonas ni departamentos.
- **No dan permisos:** estar en un equipo, o haberlo creado, no deja aprobar ausencias, corregir fichajes ni ver la
  jornada de nadie. Eso sigue saliendo del perfil y del centro (`privado.puedo_sobre`, sin cambios).
- **Quién los crea:** quien tiene `equipos.crear` (perfiles Responsable y Administrador). Quien crea un equipo entra en
  él y lo gestiona: cambiar nombre, añadir y quitar personas, archivar y recuperar. Si pierde `equipos.crear`, lo sigue
  viendo pero ya no lo gestiona. La administración (superadministrador o perfil con `admin.usuarios`) ve y gestiona
  todos.
- **Quién los ve:** sus miembros (`equipos.ver`, de puesto: Chófer, Operario y Oficina; los de campo lo tienen en su
  inicio como «Mis equipos»), su creador y la administración. Un equipo archivado solo lo ven su creador y la
  administración. Nunca se borran: se archivan.
- **Datos de los compañeros:** solo el nombre, con `public.miembros_equipo(equipo)`. Para añadir a alguien,
  `public.buscar_personas_equipo(texto)` (exige `equipos.crear`, 2 letras como mínimo, 20 resultados, sin tildes): solo
  id y nombre de personas activas.
- **Rendimiento:** las políticas usan `privado.mis_equipos()` y `privado.equipos_que_gestiono()`, calculadas una vez por
  consulta. Un futuro chat colgará sus mensajes del id del equipo y usará la misma `privado.mis_equipos()`.
- **Pruebas:** `scripts.prueba_equipos_db` (PostgreSQL local en Docker).

## Enlace con Odoo por el móvil (17-11-2026)

Autorizado por Félix: «los chóferes se enlazan con empleados de Odoo a través del número de teléfono, y luego el
encargado confirma que el perfil de la app y el de Odoo son la misma persona». Decisiones del 18-11-2026: el móvil solo
se pide a quien entra con código y PIN; a quien entra con Microsoft o Google se le propone la ficha por su correo; solo se
comparan teléfonos de empresa. Migración `20261117110000_vinculo_odoo_telefono.sql`. Qué alcanza en los envíos a Odoo:
[odoo.md](odoo.md#enlace-de-cada-persona-con-odoo-por-su-móvil-17-11-2026).

- **No hay autorregistro:** las cuentas las sigue creando administración (código + PIN o Microsoft/Google).
- **Cómo sabe la app cómo entra cada uno:** por su cuenta de Supabase Auth, no por su perfil. Quien entra con código y
  PIN tiene el correo interno `codigo@pin.grupotrimodos.com` (`src/lib/pin.ts`, `src/app/admin/acciones.ts`); quien
  entra con Microsoft o Google, su correo real. Lo calcula `privado.entra_con_pin(persona)`, que lee `auth.users`.
- **El móvil, solo a quien entra con código y PIN** (operarios y chóferes) y tiene en sus perfiles `fichaje.fichar` o
  `chofer.usar`. Si aún no lo ha dado, le sale arriba del inicio «Escribe tu número de móvil» con un botón grande
  (`src/app/PedirTelefono.tsx`, que pregunta a `public.mi_telefono()`). En «Mi perfil» lo ve y lo corrige mientras su
  responsable no lo haya confirmado. No bloquea fichar. Quien entra con Microsoft o Google no lo da (la base de datos
  lo rechaza): su ficha se busca por su correo.
- **Dónde se guarda el móvil:** en `public.telefonos_personas`, aparte de `usuarios` (las políticas de `usuarios`
  enseñan la fila entera a Seguridad, a quien gestiona la ropa…). Lo ven solo la persona y quien puede enlazarla
  (`privado.puedo_vincular`, que incluye a la administración). Solo se escribe con `public.guardar_mi_telefono(texto)`,
  que lo normaliza (solo cifras con el prefijo del país: `34612345678`).
- **Dos ids de Odoo por persona:** `usuarios.odoo_employee_id` (ficha de empleado, `hr.employee`: de ella salen los
  envíos de fichajes y ausencias) y `usuarios.odoo_conductor_id` (contacto conductor, `res.partner` con `is_driver`: el
  que llevan las órdenes de transporte; en Odoo no está unido a la ficha de empleado; hoy la app no envía nada con él).
- **Quién confirma:** quien tiene `personas.vincular` («Confirmar qué ficha de Odoo corresponde a cada persona de sus
  centros», área «Mi equipo»; la migración se lo da a Responsable y Administrador) sobre las personas de sus centros
  (`privado.puedo_sobre`), o la administración (`admin.usuarios` o superadministrador). Nadie confirma su propio enlace,
  salvo un superadministrador. A un superadministrador solo lo enlaza otro superadministrador (y solo otro ve su móvil).
  Pantalla: **Mi equipo → Enlazar con Odoo** (`/equipo/odoo`).
- **Qué se propone** (`GET /api/odoo/vinculos/pendientes`, `servicios/organizacion.py`): fichas de empleado activas de
  las empresas configuradas y contactos conductores del grupo. A quien entra con PIN, las que tienen su móvil (últimas 9
  cifras) en un teléfono de empresa (`mobile_phone` o `work_phone` de la ficha; `phone` o `mobile` del contacto; nunca
  `private_phone`). A quien entra con Microsoft o Google, las que tienen su correo (`work_email` o el campo de
  `ODOO_CAMPO_CORREO`, como `buscar_empleado`; `email` del contacto conductor). Si no coincide ninguna, fichas con un
  nombre parecido, marcadas «Por nombre, compruébalo». Una ficha solo sale **marcada sola** («Coincide su móvil» /
  «Coincide su correo») si es la única con ese dato, está libre, el nombre se parece, no es la que se quitó al deshacer
  y (por móvil) nadie más ha dado ese móvil en la app. Si no, sale con su aviso: «El nombre no coincide», «Este móvil lo
  han dado varias personas de la app», «está en varias fichas de Odoo»… De Odoo nunca sale un teléfono ni un correo
  entero: como mucho las 3 últimas cifras del teléfono. Quién sale lo decide Supabase con la sesión de quien mira
  (`public.personas_para_vincular()`).
- **Confirmar y deshacer, solo desde el servidor:** la pantalla llama a `POST /api/odoo/vinculos/confirmar` y
  `POST /api/odoo/vinculos/deshacer` (`personas.vincular`). La ruta vuelve a pedir las propuestas con la sesión de quien
  confirma y a Odoo, solo acepta una ficha propuesta y libre para una persona que ve, y entonces llama a
  `public.confirmar_vinculo_odoo(autor, persona, empleado, conductor)` o `public.deshacer_vinculo_odoo(autor, persona)`
  con la **clave de servidor**. Esas dos funciones no se pueden ejecutar con la sesión del navegador (solo
  `service_role`): así nadie se salta la comprobación contra Odoo llamando a la base de datos con su sesión. Dentro, se
  vuelven a comprobar los permisos **de `autor`** (no los de la clave de servidor) con la misma regla
  (`privado.puede_vincular(autor, persona)`, que pone a `autor` como usuario de la consulta solo durante la
  comprobación). Es el mismo uso de la clave de servidor que anotar envíos a Odoo (`servicios/supa.py`): decide a qué
  ficha van los envíos.
- **Reglas al confirmar o deshacer:** una ficha de empleado o un contacto conductor no se enlaza con dos personas. Para
  cambiar un enlace confirmado hay que deshacerlo antes. Con el enlace confirmado, la persona ya no cambia su móvil.
  **Con la jornada abierta y su entrada ya en Odoo** (su último fichaje es una entrada o reanudación «enviada») no se
  cambia de ficha ni se deshace: su salida iría a otra ficha y la de Odoo quedaría abierta. Se hace cuando fiche la salida.
- **Deshacer descarta la ficha:** queda en `usuarios.vinculo_rechazado`. El enlace automático por correo o código
  (`servicios/rrhh.py`) no se la vuelve a poner (la base de datos también lo impide): sus fichajes quedan «sin empleado»
  con el motivo hasta que su responsable confirme una ficha. Si administración pone a mano esa ficha, deja de estar
  descartada.
- **Historial:** `vinculos_odoo_historial`, solo crece. Quién confirmó o deshizo qué y cuándo, con el móvil y los ids
  anteriores y nuevos. Lo ven la administración y quien actuó.
- **Otras vías siguen abiertas:** el campo «id de empleado» de Administración → Personas y el enlace automático por
  correo o código (`servicios/rrhh.py`). Si cambian la ficha de alguien, el enlace deja de contar como confirmado y queda
  en el historial («cambio en administración» o «cambio del servidor»). Un cambio del móvil por fuera de la función (editor
  SQL) con el enlace confirmado queda como «cambio de teléfono». Nadie con sesión puede marcar un enlace como confirmado
  ni tocar el contacto conductor o la ficha descartada sin pasar por las funciones.
- **Las políticas de cambio de `usuarios` no cambian.**
- **En el piloto** el perfil Chófer no tiene `chofer.usar`, así que la pantalla no sabe quién es chófer: propone
  contacto conductor a cualquiera cuyo móvil, correo o nombre coincida con uno, con la opción «Ninguno».
- **Sin la migración** (como está hoy producción) no se pide el móvil y «Enlazar con Odoo» dice que falta aplicarla; el
  resto de la app sigue igual.
- **Pruebas:** `scripts.prueba_vinculo_db` (PostgreSQL local en Docker; `--como-produccion` salta las migraciones que
  aún no están en producción) y `tests/test_vinculos_odoo.py`.

## Perfiles y pantallas

- **Cuatro perfiles básicos, que no se borran ni cambian de nombre** (`perfiles.base`, lo impide la base de datos): **Administrador**, **Oficina**, **Chófer** y **Operario**. Cada persona tiene **un puesto en su centro**. Encima se le suman **complementos**: **Responsable**, que aprueba lo de su centro, y **Seguridad**, que vale en todos los centros. Los permisos de cada perfil se siguen editando con casillas.
- **Cada perfil tiene su pantalla** (`perfiles.pantalla`). Si alguien tiene varias, manda la de más alcance. El superadministrador sin perfiles entra en Dirección.
  - **Dirección** (`direccion`): el inicio es el cuadro de mando. No hay fichaje ni flota.
  - **Oficina** (`oficina`): espacio de gestión con menú lateral: su jornada, la flota, DECA y lo que tenga que resolver.
  - **Campo** (`campo`, chóferes y operarios): **una sola pantalla en el móvil, sin menú** (`src/app/InicioCampo.tsx`). Arriba, fichar con un botón grande y su camión. Debajo, sus avisos y su ropa de temporada. Al final, solo los accesos que da su perfil. En las demás pantallas, un botón «Inicio» para volver.
- **Menú** (`src/lib/usuario.ts`, `enMenu`): en `permisos.json` los permisos del trabajo propio llevan `"de_puesto": true` (fichar, su camión, la flota, DECA, ausencias, documentación, incidencias, pedir ropa). Esos solo ponen su área en el menú si vienen de los perfiles de la persona. Los de gestión salen siempre, también al superadministrador. Así Dirección no ve fichaje ni flota, aunque pueda abrirlos.
- **Permisos en el piloto de fichaje y vacaciones** (migración `20261105000400_perfiles_piloto.sql`; lo demás está oculto, no borrado):
  - **Administrador:** cuadro de mando (`direccion.ver`, sin finanzas), Mi equipo (ver, aprobar vacaciones, corregir fichajes) y administración (personas y sincronización con Odoo).
  - **Oficina:** fichar, pedir vacaciones y DECA.
  - **Chófer:** fichar, pedir vacaciones y DECA.
  - **Operario:** fichar y pedir vacaciones.
  - **Responsable** (complemento): ver a su equipo, aprobar vacaciones y corregir fichajes de su centro.
  - **Seguridad** (complemento): sin permisos durante el piloto.
  - El superadministrador sigue teniéndolo todo.
  - Guardar un perfil ya no concede `documentos.propios` por tener documentos exigidos: el permiso se selecciona expresamente.
  - El cuadro de mando cuenta como chóferes a quien tiene «Mi camión» (`chofer.usar`), así que durante el piloto esa cifra sale a 0.
- **Administración a escala** (`/admin`), con pestañas:
  - **Personas:** búsqueda, filtros por centro, perfil y estado y páginas de 50. Quien entra por primera vez con Google o Microsoft aparece en «Por configurar» y se activa **en bloque**: se marcan, se elige puesto y centro, y listo. «Cambiar puesto» sustituye el puesto y conserva los complementos.
  - **Perfiles**, **Centros** (con su analítica de Odoo) y **Camiones**.
  - Cada acción vuelve a la misma pestaña con sus filtros.
- **Ropa por temporada** (gestión en **Seguridad → Ropa y EPIs**, `/seguridad?ver=ropa`; la de cada persona en «Mi ropa», `/ropa`; partes en `src/app/ropa/secciones.tsx`; tablas `ropa_kits`, `tallas_ropa`, `ropa_dotaciones`):
  - **Temporadas y dotación:** el verano va del 1 de abril al 30 de septiembre y el invierno del 1 de octubre al 31 de marzo. Cada puesto tiene la composición de **una muda** por temporada y cuántas mudas tocan (2). La dotación de cada persona se prepara sola (`public.preparar_dotaciones()`), así que nadie la tiene que pedir. Las dotaciones aún sin entregar siguen a quién le toca ahora: si alguien se da de baja o cambia a un puesto sin ropa, la suya desaparece de la lista.
  - **Tallas:** cada uno apunta cuatro tallas: parte de arriba, pantalón, calzado y guantes. Puede hacerlo también su responsable.
  - **Entrega y confirmación:** el responsable ve **qué preparar**, con unidades por prenda y talla para el pedido al proveedor, y marca cada dotación como entregada. La persona confirma que la ha recibido. Nadie se entrega lo suyo.
  - **Cambios:** las solicitudes sueltas quedan para roturas, tallas o pérdidas.
  - **Permisos:** `ropa.pedir`, `ropa.gestionar` y `ropa.configurar` (para la composición).
- **Chóferes por cliente o ruta** (`/equipo/zonas`; tablas `zonas` y `chofer_zona`; permiso `zonas.gestionar`): cada chófer de sus centros tiene una zona, que es un cliente o una ruta. Se asignan todos de una vez. El cuadro de mando separa a los chóferes por zona: cuántos hay, cuántos han fichado y trabajan, cuántos tienen camión y su documentación.
- **Analítica de cada centro** (Administración → Centros; tabla `centro_analitica`): qué cuentas o etiquetas analíticas de Odoo son de cada centro. Con ellas el cuadro de mando separa ingresos, gastos y margen por centro. Una cuenta o etiqueta solo puede ser de un centro.


## Organización y procedencia (16-11-2026)

`/organizacion` muestra la estructura actual de Odoo y propone relaciones revisables con los centros de la app.
Requiere `organizacion.ver` (global, sin fichas personales). No cambia los centros, asignaciones ni permisos.
El inicio de campo y oficina muestra «Mi empresa y mi equipo» con la ficha del propio empleado vinculado.
La ruta personal exige sesión y obtiene el id de Odoo desde la fila del usuario autenticado; no acepta elegir otra persona.
El catálogo de transporte muestra primero flota propia; los contactos y vehículos externos necesitan `transporte.externos`
además de `transporte.ver`. No se asignan automáticamente estos permisos a ningún perfil.
Mapa de conceptos, pruebas y límites: [mapa-organizacion-odoo.md](mapa-organizacion-odoo.md).
