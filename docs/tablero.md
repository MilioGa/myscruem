# Tablero Kanban y gráfico Burndown

## Ciclo del sprint

Desde Proyectos, la opción Sprints muestra los sprints del proyecto. El Scrum Master inicia un sprint en planificación con Iniciar sprint. Para iniciarlo, el sprint debe tener al menos una historia seleccionada y el proyecto no puede tener otro sprint activo.

Al iniciar el sprint se guardan los puntos comprometidos y se habilita el tablero. Con Cerrar sprint se muestra un resumen con los puntos comprometidos y completados. Al confirmar, las historias no terminadas regresan al Product Backlog con su estimación.

## Tablero Kanban

La opción Tablero de cada proyecto muestra el sprint activo en cuatro columnas: Por hacer, En curso, En revisión y Terminado. Cada tarjeta indica el título de la tarea, la historia a la que pertenece y su responsable.

El Developer crea tareas con Nueva tarea. El título, la historia del sprint y el responsable son obligatorios; la tarea se agrega en Por hacer. Las tarjetas se mueven arrastrándolas a otra columna y el cambio se guarda de inmediato. Si la operación falla, la tarjeta vuelve a su columna anterior.

El tablero consulta cambios cada pocos segundos, por lo que los demás integrantes ven los movimientos sin recargar la página. Una historia se considera terminada cuando todas sus tareas están en Terminado.

## Gráfico Burndown

La opción Métricas, disponible en la lista de sprints y en el tablero, muestra los puntos comprometidos, completados y restantes. La línea ideal desciende de los puntos comprometidos a cero en la fecha de fin. La línea de puntos restantes registra un valor por día y baja cuando una historia pasa a Terminado. La gráfica se actualiza sola mientras el sprint está activo.

## Permisos

| Rol | Acciones |
| --- | --- |
| Scrum Master | Iniciar y cerrar sprints; consultar tablero y métricas |
| Developer | Crear tareas, asignarlas y mover tarjetas; consultar métricas |
| Product Owner y Administrador | Consultar tablero y métricas |

Los usuarios de otra empresa no pueden consultar ni modificar el tablero ni las métricas.

## Datos de demostración

`npm run demo` crea la empresa `empresa-demo` con usuarios, historias, un sprint activo y tareas en distintas columnas. La contraseña de los usuarios de demostración es `Demostracion2026`, salvo que se defina `DEMO_PASSWORD`.
