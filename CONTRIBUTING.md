# Contribuir al proyecto

Antes de modificar una función, lee [AGENTS.md](AGENTS.md), la fuente de reglas del proyecto,
y su documentación en [docs/](docs/README.md). La instalación local está en el [README](README.md).

## Preparar un cambio

1. Trabaja en una rama con un nombre descriptivo y acota el cambio a un problema concreto.
2. Durante el piloto, prioriza correcciones, limpieza y pulido dentro del alcance autorizado.
3. Mantén los textos visibles en español y comprueba la experiencia en móvil.
4. Actualiza la documentación si cambia el funcionamiento o la configuración.

Conserva las funciones ocultas por permisos. Las migraciones aplicadas no se editan ni se eliminan:
los cambios de base de datos se añaden en migraciones nuevas, con RLS y sus políticas.
No incluyas credenciales, archivos de entorno privados ni datos personales reales en código, capturas o pruebas.

## Validar

Con el entorno de Python activado, desde la raíz:

```bash
python -m pytest -q
npm run test:jornada
npm run typecheck
npm run build
```

Si cambias `public/deca/`, incrementa la versión de `CACHE` en `public/deca/sw.js` y ejecuta
`python -X utf8 -m scripts.prueba_navegador`. Consulta los requisitos en [el README](README.md).

Si el cambio afecta a una integración con Odoo, sigue el procedimiento completo de
[AGENTS.md](AGENTS.md): alcance previo, entorno de pruebas, lectura de vuelta e informe de resultados.
Si no hay entorno de pruebas disponible, detén ese cambio e informa a Félix.

## Presentar y publicar

En la pull request, explica el problema, el resultado del cambio y las comprobaciones realizadas.
Indica expresamente las limitaciones y cualquier prueba pendiente; añade capturas sin datos personales
cuando ayuden a revisar una modificación visual.

**Pregunta a Félix antes de hacer `git push`**: el push a `main` despliega en Vercel.
Los cambios de integración con Odoo necesitan además autorización expresa para pasar a producción.
