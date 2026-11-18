# Identidad visual de Grupo Trimodos

Referencia revisada el 18-11-2026: [web corporativa](https://www.grupotrimodos.com/).
Su tema `theme_trimodos` declara **Mulish** para los títulos. La app incorpora esa misma familia,
con pesos variables, servida localmente para no depender de Google Fonts ni de la conexión en cabina.
Archivo obtenido de la distribución abierta [Google Fonts](https://github.com/google/fonts/tree/main/ofl/mulish),
con licencia SIL Open Font License incluida en `public/deca/fonts/Mulish-OFL.txt`.

Los logos originales ya estaban en `public/deca/img/`: Trimodos, Stinsa y Transargi. Se conservan sus colores,
proporciones y texto; no se redibujan ni se tiñen. El logo de Trimodos identifica la cabecera y el registro imprimible.
Las firmas Stinsa y Transargi aparecen en el acceso y en el pie del menú: no indican la empresa de la persona conectada.

## Criterio de diseño

- Amarillo del logotipo (`#fcda00`) para acciones y selección; negro carbón, blanco y fondos neutros para la estructura.
- Mulish para la interfaz; Atkinson en contadores y datos de DECA, donde distinguir números es prioritario.
- Verde Stinsa y naranja Transargi permanecen ligados a sus marcas. Verde/rojo de estados conservan su significado.
- Logo completo sobre blanco, foco visible de teclado, botones grandes y contraste negro sobre amarillo.
- Cabina conserva su modo de noche; el registro para imprimir conserva fondo blanco.

## Archivos compartidos

`public/deca/marca.css` contiene la fuente y las variables de marca. Se importa en el layout de Next y se enlaza
en DECA. `public/deca/cabecera.css` sigue siendo la única hoja de la navegación común. El marcado equivalente vive en
`src/app/Cabecera.tsx` y `public/deca/cabecera.js`. `MarcasGrupo.tsx` reúne las firmas de las empresas en Next.

DECA guarda también la fuente y la hoja de marca en su caché `deca-v21`, para mantener la identidad sin cobertura.
No cambian las consultas, los permisos ni los envíos a Odoo.

## Validación local (18-11-2026)

- TypeScript y compilación de Next correctos; 75 pruebas web y 390 Python superadas, 11 omitidas.
- Acceso real renderizado a 1440, 390 y 320 px; logos cargados, Mulish disponible y sin desbordamiento horizontal.
- Cabecera, navegación y contador renderizados con datos ficticios en escritorio y móvil; modo de noche revisado.
- Prueba completa de DECA con API simulada correcta, incluido QR, edición, PDF y apertura sin conexión.
  Hubo reintentos por arranque/conexión de la cabecera del servidor local; la ejecución final, con registros del
  servidor activados y las mismas comprobaciones, terminó sin fallos.

No se ha publicado en Vercel ni se han consultado o modificado datos de personas para estas comprobaciones visuales.
