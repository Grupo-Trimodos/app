# Continuidad de la revisión del 17-11-2026

Referencias: los cuatro JSON y PROMPT-CONTINUAR.md de `../revisiones-2026-11-17/`.
Se distinguen hallazgos, propuestas y cambios aplicados. El encargo de continuar permite avanzar en los arreglos
locales del piloto; no convierte las propuestas de chat, tacógrafo o migraciones en cambios publicados.

## Estado contrastado

- Punto de partida local: `efdd294`, árbol limpio.
- `.env.pruebas` existe, pero las cuatro variables de conexión a Odoo están vacías.
- La integración actual de Movildata no acredita actividades por persona para reconstruir la jornada.
- No hay conector Supabase disponible en esta sesión para comprobar las migraciones de producción. La aplicación de
  `jornadas_pendientes` y el rechazo de `grupos_de_trabajo` constan en el traspaso; no se han verificado de nuevo.
- No se han cambiado variables, migraciones, permisos ni envíos a Odoo. No se ha publicado nada.

## Continuación implementada: reloj y acciones del piloto

- Reloj compartido entre InicioCampo y Fichaje, actualizado cada 15 segundos, con pausas y congelación a las 16 horas.
- Presentación del turno nocturno terminado hoy sin alterar el día contable de entrada.
- Total semanal visible con jornada abierta válida incluida y explicación del alcance.
- Salida como acción principal, confirmación explícita, botón desactivado durante el envío.
- Ficha de organización debajo del fichaje para evitar desplazamientos del botón durante la carga.
- Estado y errores de envío siguen visibles.

Validación: 28 pruebas web (cinco nuevas de presentación), 238 Python correctas y 11 omitidas; TypeScript correcto.
No se ha registrado un fichaje real para probar la interfaz ni se han comprobado interacciones en navegador.

## Pendientes conservados

- Completar el resto del pulido de campo: avisos de una sola vez, cabecera y tira semanal; después oficina y Dirección.
- Confirmar con Félix el fichaje tras el arreglo de producción registrado por Claude.
- Contrastar las migraciones remotas antes de cualquier publicación; no aplicar la migración rechazada por inferencia.
- Mantener pendiente el encargo anterior de nombres al pulsar en Organización y filtros de Transporte.
  Félix autorizó lecturas reales; esto no autoriza nuevos envíos ni sustitución del registro por tacógrafo.
- Resolver por separado equipos libres, chat, histórico y tacógrafo. Las revisiones contienen alternativas y
  afirmaciones técnicas/legales que hay que volver a contrastar cuando se ejecute cada parte.
