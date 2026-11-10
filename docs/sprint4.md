# Sprint 4: seguimiento, organización y capacitación

## Navegación

La barra lateral incluye, además de Proyectos y Usuarios y roles, accesos directos al Product Backlog, Sprints, Tablero Kanban, Métricas e Impedimentos del proyecto actual, y a la sección Capacitación. El proyecto actual se elige en el selector de la barra lateral y también cambia al abrir cualquier acción desde la tarjeta de un proyecto.

## Equipos (PB-19)

En Usuarios y roles, el administrador crea equipos con nombre, integrantes y proyecto. Cada proyecto tiene como máximo un equipo; si lo tiene, solo los Developers activos de ese equipo pueden ser responsables de tareas en su tablero.

## Épicas y detalle de historias (PB-18)

El Product Owner crea épicas desde el Product Backlog, asigna cada historia a una épica y puede agrupar la vista por épica con sus puntos. Cualquier integrante puede abrir Ver tareas y avance en una historia para consultar sus tareas, su sprint y el porcentaje terminado.

## Filtros del tablero (PB-15)

Las tareas tienen un tipo (Desarrollo, Pruebas, Diseño o Documentación) y una etiqueta opcional. El tablero se filtra por miembro, etiqueta y tipo; los filtros se combinan y se quitan con Limpiar filtros. La API también acepta `?assignee=`, `?label=` y `?type=`.

## Impedimentos (PB-17)

Un Developer registra un impedimento en una tarjeta con su descripción; la tarjeta se resalta en rojo. La lista de impedimentos muestra los abiertos y cerrados del proyecto, y solo el Scrum Master los cierra indicando la solución. Los impedimentos no cambian la columna de la tarea ni el Burndown.

## Capacitación en Scrum (PB-25)

La sección Capacitación, disponible para todos los roles, contiene:

- Guía en cuatro módulos: qué es Scrum, roles, eventos y artefactos, y herramientas de MySCruEm (`training/guia.json`).
- Tres infografías: ciclo del sprint, tablero Kanban y gráfico Burndown (`public/capacitacion/`).
- Glosario de 30 términos con búsqueda sin distinguir acentos (`training/glosario.json`).

El contenido se edita en esos archivos sin cambiar el código.
