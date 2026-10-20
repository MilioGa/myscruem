# MySCruEm · Sprint 1

Aplicación con Node.js, Express y SQLite. Requiere Node.js 24 o superior.

## Ejecutar

```sh
npm install
npm start
```

Abre http://localhost:3000. La base de datos se crea automáticamente en `data/myscruem.sqlite` y se conserva al reiniciar.

## Alcance

| Historia | Funcionalidad |
| --- | --- |
| PB-01 | Registro de empresa y administrador; aislamiento de datos por empresa |
| PB-02 | Inicio y cierre de sesión; caducidad tras 30 minutos sin solicitudes autenticadas |
| PB-03 | Crear, editar y desactivar usuarios; activación mediante invitación de un solo uso |
| PB-04 | Administrador, Product Owner, Scrum Master y Developer; un Product Owner por proyecto |
| PB-05 | Crear, consultar, editar y archivar proyectos |

El administrador gestiona usuarios y reasigna el Product Owner. El Product Owner crea proyectos y modifica únicamente los que tiene asignados. Los usuarios activos de la empresa pueden consultar sus proyectos. Antes de desactivar o cambiar el rol de un Product Owner con proyectos activos, hay que reasignarlos o archivarlos.

No se incluyen backlog, tareas, sprints, tablero, equipos, reportes ni métricas, porque pertenecen a semanas posteriores. El diseño adapta la pantalla de acceso y la navegación lateral del wireframe a las funciones del sprint 1.
