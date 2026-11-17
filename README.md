# MySCruEm · Sprint 1

Aplicación con Node.js, Express y SQLite. Requiere Node.js 24 o superior.

## Ejecutar

```sh
npm install
npm start
```

Abre http://localhost:3000. La base de datos se crea automáticamente en `data/myscruem.sqlite` y se conserva al reiniciar.

## Alcance de la versión 1.0

| Sprint | Funcionalidad |
| --- | --- |
| 1 | Registro de empresa, sesiones, usuarios, roles, invitaciones y proyectos |
| 2 | Product Backlog, historias de usuario, estimación, sprints y Sprint Backlog |
| 3 | Tareas, tablero Kanban y gráfico Burndown |
| 4 | Equipos, épicas, filtros del tablero, impedimentos y material de capacitación en Scrum |
| 5 | Definition of Done, notificaciones, velocidad del equipo, comentarios y adjuntos, actas de eventos |

Documentación: `docs/manual-usuario.md` (manual por rol), `docs/demo-final.md` (guion de demostración), `docs/seguridad.md` (revisión de seguridad) y `docs/version-1.0.md` (notas de la versión).

Para cargar datos de ejemplo: `npm run demo` (empresa `empresa-demo`, contraseña `Demostracion2026`).
