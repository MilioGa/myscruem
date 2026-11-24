# MySCruEm · Sprint 6

Aplicación web para equipos Scrum, hecha con Node.js, Express y SQLite. Se usa en computadora y requiere Node.js 24 o superior.

## Ejecutar

```sh
npm install
npm start
```

Abre http://localhost:3000. La base de datos se crea automáticamente en `data/myscruem.sqlite` y se conserva al reiniciar. Si la base viene de un sprint anterior, se actualiza sola al iniciar.

## Pruebas

```sh
npm test
```

En PowerShell, si aparece el error de ejecución de scripts, usa `npm.cmd` en lugar de `npm`.

## Alcance por sprint

| Sprint | Funcionalidad |
| --- | --- |
| 1 | Registro de empresa, sesiones, usuarios, roles, invitaciones y proyectos |
| 2 | Product Backlog, historias de usuario, estimación, sprints y Sprint Backlog |
| 3 | Tareas, tablero Kanban y gráfico Burndown |
| 4 | Equipos, épicas, filtros del tablero, impedimentos y material de capacitación en Scrum |
| 5 | Definition of Done, notificaciones, velocidad del equipo, comentarios y adjuntos, actas de eventos |
| 6 | Paneles y permisos por rol, Planning Poker, criterios de aceptación con casilla, DoD por historia y sprint, capacidad y horas reales, Burndown por horas y general, tutorial con avance y recorrido por rol |

## Documentación

Manual por rol en `docs/manual-usuario.md`.

## Datos de ejemplo

En una base nueva, ejecuta `npm run demo`.

- **Empresa:** `empresa-demo`
- **Contraseña:** `Demostracion2026`
- **Usuarios:** admin@demo.test, po@demo.test, sm@demo.test, dev@demo.test y dev2@demo.test
