# La app como espacio de trabajo: organización, procedencia y acceso

Revisión del 16-11-2026. Encargo de Félix: comparar con una app empresarial, leer Odoo real,
relacionar el vocabulario de la app y enfocar cada perfil en su trabajo. Lecturas reales sin escrituras en Odoo.

## Comparación con una app empresarial

Referencia: [principios de SAP Fiori](https://www.sap.com/design-system/fiori-design-web/v1-142/discover/sap-design-system/vision-and-mission/design-principles):
experiencia por rol, sencilla, coherente y adaptable. Se aplica el criterio, no su tamaño ni su catálogo de módulos.

| Criterio | Situación encontrada | Cambio o decisión |
|---|---|---|
| Empezar por las tareas del puesto | Ya hay inicio móvil y oficina; Dirección entra al cuadro de mando | Conservar páginas por función y componer el inicio por permisos, no por nombres de perfil |
| Un mismo significado en todas las pantallas | «Plantilla» contaba cuentas de Supabase; «chófer» podía significar permiso Mi camión o contacto TMS | «Cuentas activas» para la app; «Empleados activos» para Odoo; contactos de transporte separados |
| Información actual con procedencia | Datos de la app, Odoo y ejemplos podían parecer equivalentes | Indicaciones desplegables «Origen: …»; el resumen de negocio no presenta cifras simuladas |
| Organización coherente | Centros manuales, ubicaciones duplicadas y departamentos con ciudades | Vista Organización con recuentos reales y vínculos por ID, propuestas y ambigüedades por separado |
| Acceso mínimo necesario | RLS por centro/departamento existe, pero hay permisos globales y un permiso que se añadía al guardar documentos | Mostrar alcance global al editar perfiles; dejar de conceder documentación automáticamente; permiso adicional para externos |
| No confundir configuración con operación | Cuenta de acceso, empleado, perfil y departamento pueden confundirse | El empleado identifica a la persona; los permisos explícitos determinan lo que puede hacer |

## Lo comprobado en Odoo

Servidor configurado: `https://www.grupotrimodos.com`, Odoo 18, base `prod`.
Empresas configuradas en la app: **1 (STINSA)** y **7 (TRANSARGI)**. No significa todo el grupo.

| Dato | Resultado | Origen de la lectura |
|---|---:|---|
| Empleados activos | 129: 109 en empresa 1 y 20 en empresa 7 | `hr.employee`, `active=true`, `company_id in [1,7]` |
| Sin departamento | 15 | `hr.employee.department_id` |
| Sin ubicación | 78 | `hr.employee.work_location_id` |
| Sin puesto | 123 | `hr.employee.job_id` |
| Sin gerente | 76 | `hr.employee.parent_id` |
| Vehículos activos visibles al usuario técnico | 8.354 | `fleet.vehicle`, `active=true`; incluye catálogo externo |
| Vehículos marcados como propios | 90, propietario empresa 1 | `fleet.vehicle.is_own_vehicle`, `company_owner_id` |
| Empleados cuyo contacto de trabajo está marcado como conductor | 2 | `hr.employee.work_contact_id` → `res.partner.is_driver` |

Estos resultados describen la configuración actual, no validan por sí solos que esté completa.
Los contactos conductores no sirven para contar la plantilla. La marca «propio» y la empresa propietaria
son las que se usan para la vista inicial de flota; no se deduce propiedad por matrícula o nombre.

## Correspondencias concretas de los centros

Los siete nombres proceden del catálogo inicial de la app (`20261103000200_ropa_y_centros.sql`).
La nueva pantalla compara además los centros actuales de Supabase con Odoo en cada consulta.
No se han guardado ni aprobado estas propuestas. Un almacén no pasa a ser centro de montaje por similitud del nombre.

| Nombre de la app | Evidencia en Odoo | Estado |
|---|---|---|
| Montaje Burriana | Departamento **30**, «Almacén Burriana», bajo «Almacén», empresa 1; 4 empleados. Existe además ubicación **27**, «Almacen Burriana», empresa 7 | Propuesta de relación con departamento; la ubicación de otra empresa no confirma el vínculo |
| Montaje Castellón | Departamento **47**, «Almacén Castellón», bajo «Almacén», empresa 1; 5 empleados | Propuesta; no hay ubicación única deducible |
| Montaje Sevilla | Departamento **39**, «Almacén Sevilla», bajo «Almacén», empresa 1; 6 empleados | Propuesta; «Sevilla» como ubicación no distingue oficina de almacén |
| Oficina Grao de Castellón | Ubicaciones **2**, **23**, **26**, empresa 7, con variantes del mismo nombre | Ambiguo; no fusionar ni elegir automáticamente |
| Oficina Castellón de la Plana | Ubicaciones **3**, **13**, **25** de empresa 1 y **28** de empresa 7, con variantes de «Castellón» | Sin coincidencia exacta del nombre completo; necesita confirmación de ubicación y empresa |
| Oficina Burriana | Ubicaciones **30** y **31**, «Burriana», empresa 1 | Ambiguo; el nombre no confirma el uso como oficina |
| Oficina Sevilla | Ubicación **1** de empresa 1 y **10** de empresa 7 | Ambiguo; no elegir solo por ciudad |

Las zonas Alicante, Barcelona, Burriana, Granada, Murcia, Sevilla, Tarragona y Valencia aparecen como hijos
del departamento **27, Conductores**. En TRANSARGI existe **28, CONDUCTOR**, bajo **17, TRANSARGI**.
Esto es evidencia de la organización actual por departamentos; no prueba que `work_location_id` esté completo.
Un departamento «Transporte Nacional» tampoco prueba que todos sus miembros sean conductores: puede incluir tráfico.

## Mapa de datos y procedencias

| Concepto para la persona | Fuente principal / relación | Qué muestra hoy la app y cómo tratarlo |
|---|---|---|
| Empresa | `hr.employee.company_id` → `res.company` | La ficha personal usa Odoo; los permisos no se deducen de la empresa |
| Cuenta de acceso | Supabase `usuarios` y autenticación | Cuenta activa no equivale a empleado activo |
| Empleado | `usuarios.odoo_employee_id` → `hr.employee.id` | Vínculo por ID ya existente; no se crea ni cambia buscando nombres |
| Centro/oficina/zona | `hr.employee.work_location_id` → `hr.work.location` | `centros.odoo_ubicacion_id` confirma el vínculo; nombre parecido solo propone |
| Departamento | `hr.employee.department_id` → `hr.department` | Se conserva el árbol real; no se aplana ni mezcla con ubicaciones |
| Puesto | `hr.employee.job_id` → `hr.job` | Se muestra tal como está; «sin indicar» si falta |
| Tipo de transporte | Candidato a partir del puesto; hoy muchas veces está mezclado en departamentos | No hay correspondencia completa comprobada. No rellenar por suposición |
| Responsable laboral | `hr.employee.parent_id`; el responsable de departamento es un concepto distinto | Ficha personal muestra Gerente. No lo convierte automáticamente en aprobador |
| Aprobador de la app | Perfiles + centro/departamento y `quien_me_aprueba` en Supabase | Mantener reglas efectivas hasta reconciliar con Odoo |
| Perfil / puesto de acceso | `perfiles`, `usuario_perfil`, catálogo `permisos.json` | No es `hr.job`. Solo los permisos seleccionados conceden acceso |
| Chófer de plantilla | Empleado con organización/puesto de conductor comprobado | No contar los miles de contactos conductores como empleados ni un permiso como profesión |
| Contacto conductor de transporte | `res.partner.is_driver` | Catálogo con externos, permiso adicional; no se presenta como plantilla |
| Flota propia | `fleet.vehicle.is_own_vehicle=true`, `company_owner_id` | Vista inicial de transporte, lectura directa |
| Conductor asignado a vehículo | `fleet.vehicle.driver_id` → `res.partner` | Mostrar la asignación que dice Odoo, sin unir personas por nombre |
| Camión confirmado en la jornada | Supabase `asignaciones` + `vehiculos` (flujo anterior) | Aún distinto de la asignación Odoo. Migración funcional pendiente |
| Posición, actividad y consumo | Movildata en directo | Nunca se atribuyen automáticamente a la jornada legal del conductor |
| Fichajes | Registro/cola de la app → `hr.attendance` | Mantener estado individual de envío y distinguir registro app de asistencia Odoo |
| Solicitudes de ausencia | App → `hr.leave` | La lista de solicitudes no es el saldo disponible de Odoo |
| Saldo de vacaciones | Odoo, asignaciones y ausencias | No conectado en estas pantallas; no inventar el saldo a partir de solicitudes locales |
| Carnés, CAP, tacógrafo, ITV y seguros | Odoo, modelo y vínculo documental por confirmar | Se detectó `hr.employee.driving_license`, contratos y servicios de flota, pero no se ha demostrado dónde están todos los documentos. Las pantallas antiguas siguen mostrando la app y lo indican |
| Ropa y EPIs | Supabase, tallas y dotaciones | Propio de la app; cada persona ve lo suyo y el gestor su alcance |
| Incidencias e inspecciones | Supabase | Propio de la app; sesión y permisos |
| Facturación, cobros y pagos | Odoo contabilidad y ventas | Solo `direccion.finanzas`; el resumen no muestra importes simulados |
| Analítica por centro | Vínculo app con analítica de Odoo | Código antiguo de v15 pendiente de adaptación a `analytic_distribution` en v18 |
| DECA | `project.task`, `tms.package`, informe de Odoo | Orden concreta, permisos existentes, escrituras congeladas |
| ARGON | Pedidos y contenedores de Odoo | Su lista de escrituras sigue congelada; fuera de este cambio |

## Qué debe ver cada puesto

Propuesta de configuración de perfiles, sin asignaciones masivas ni cambios a perfiles de producción.
Siempre se implementa por permisos y alcance, nunca por `if perfil.nombre == …`.

| Puesto | Prioridad del inicio | Alcance | Información excluida por defecto |
|---|---|---|---|
| Chófer | Fichar, sus solicitudes, DECA si está autorizado, su vehículo y avisos | Su propia persona y órdenes autorizadas | Listados globales, salarios, finanzas, documentos de otros |
| Operario / montaje | Fichar, solicitudes, su ropa y avisos | Su propia persona | Flota, catálogo de conductores, finanzas, administración |
| Oficina | Su jornada y tareas de su función | Sus centros y funciones expresamente asignadas | No obtiene RR. HH., finanzas ni toda la flota por llamarse Oficina |
| Responsable de centro | Pendientes y equipo a cargo | Centro y, si procede, departamento asignados | Otros centros, finanzas, administración global; no resolver lo propio |
| Tráfico | Flota propia y operaciones autorizadas | El catálogo actual es global: concederlo solo a quien necesite ese alcance | Nóminas, motivos médicos, datos de RR. HH.; externos solo con permiso adicional |
| RR. HH. | Jornada, ausencias y organización según función | Centros asignados o alcance global explícito | No confundir gestionar RR. HH. con ser superadministrador |
| Seguridad | Caducidades e inspecciones autorizadas | Según permisos actuales de seguridad, varios son globales | Finanzas y administración de cuentas |
| Dirección | Indicadores, organización y excepciones | Global, con finanzas como permiso separado | No necesita el trabajo de cabina ni formularios operativos en el inicio |
| Administración técnica | Accesos, vínculos y errores de integración | Global, reservado | No usar la cuenta superadministradora como perfil habitual de cada oficina |

El permiso `admin.usuarios` permite conceder permisos; no debe asignarse para resolver únicamente una tarea de centro.
`flota.ver`, `transporte.ver`, `transporte.externos`, `organizacion.ver` y las consultas de Dirección tienen alcance global.
Si se necesita tráfico por zona, hace falta un vínculo fiable vehículo↔zona y un filtro de servidor; ocultar un botón no basta.

## Implementado en esta revisión

- `/organizacion`: permiso específico `organizacion.ver`, recuentos y estructura de Odoo, coincidencias revisables con centros.
- `/api/odoo/mi-organizacion`: únicamente la ficha vinculada al usuario autenticado. No admite elegir otro empleado.
- «Mi empresa y mi equipo» desplegable en los inicios de campo y oficina; no añade información de otras personas.
- Procedencia desplegable en transporte, organización, jornada, ausencias, equipo, documentación, seguridad e incidencias.
- Transporte abre en flota propia; el catálogo con externos requiere además `transporte.externos`.
- «Cuentas activas» sustituye a «Plantilla activa» en los indicadores de la app.
- El editor de perfiles informa de alcance global y no concede automáticamente el permiso de documentación.

## Validación y límites

- Lectura real de fichas **328 (empresa 1)** y **311 (empresa 7)**: empresa, departamento, ubicación, puesto y gerente comparados campo a campo con una segunda lectura.
- Vehículo propio **8160**: matrícula y marca de propiedad contrastadas con lectura directa.
- Totales y grupos de empleados suman 129; 90 vehículos propios leídos. No se escribió ningún registro de Odoo.
- Pruebas de acceso: sin sesión, sin permiso global, petición de otro empleado, catálogo externo sin permiso adicional,
  datos personales excluidos, empresas filtradas y coincidencias ambiguas.
- No se ha usado un Odoo de pruebas: se aplica la autorización de Félix en esta conversación para lecturas reales.
- No se han modificado perfiles ni vínculos de producción, ni desplegado estos cambios.
- Comparación visual realizada en Odoo → Empleados: **109 STINSA, 20 TRANSARGI**, y bajo Almacén:
  **Burriana 4, Castellón 5, Sevilla 6**, coincidentes con las lecturas de la app.
- Odoo → Flota, filtro «Vehículo propio es establecido/a»: **90** (48 sin estado y 42 registrados), coincide con la consulta nueva.
- La revisión humana del significado de las correspondencias sigue pendiente; las propuestas no se entregan como vínculos confirmados.
- Suite Python: **238 pruebas correctas, 11 omitidas**. Suite web: **23 correctas**. TypeScript y compilación Next correctos.
- Los comprobadores generales existentes no terminan correctamente en Odoo 18: consultan `account.analytic.tag`,
  modelo que ya no existe. El de compatibilidad detecta además que las credenciales API no abren la sesión web del PDF.
  No se alteraron las pruebas ni la lista de escrituras para ocultarlo.

## Presentación de las lecturas

Organización muestra primero empleados, empresas y ubicaciones con personal. La distribución se consulta por
pestañas, con búsqueda por nombre (sin distinguir acentos), orden por número de personas y páginas de diez filas.
Los datos sin completar se presentan aparte; los recuentos pueden solaparse. Cada correspondencia de centro se
abre para ver candidatos y procedencia, manteniendo la diferencia entre vínculo y propuesta.

Transporte muestra matrícula, modelo, empresa y conductor en una tabla que se apila con etiquetas en móvil.
La búsqueda sigue consultando Odoo; la paginación de veinte filas solo organiza los resultados recibidos.
Las cifras son «En esta consulta», no totales de toda la flota. Los contactos externos conservan su permiso adicional.
Los cambios son de presentación: no alteran consultas, escrituras, permisos ni configuración de Odoo.
