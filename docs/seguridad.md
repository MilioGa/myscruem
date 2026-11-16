# Revisión de seguridad · Sprint 5

Revisión de las funciones agregadas en el sprint 5. Las comprobaciones automáticas están en `test/security.test.js`.

| Punto revisado | Resultado |
| --- | --- |
| CSRF en comentarios, Definition of Done y actas | Las peticiones sin el token `X-CSRF-Token` correcto se rechazan con 403. |
| Aislamiento entre empresas | Un usuario de otra empresa recibe 404 en comentarios, adjuntos, DoD, velocidad y actas. |
| Tipos de archivo | Solo se aceptan PDF, imágenes, texto, CSV y documentos de Office; `.exe` y `.html` se rechazan. |
| Nombres de archivo | Se reemplazan caracteres no permitidos y se rechazan rutas como `../../nota.txt`. |
| Descarga de adjuntos | Se envían como `attachment`, con `nosniff` y sin caché, por lo que el navegador no los ejecuta. |
| Contenido de comentarios | Se guarda como texto y la interfaz lo escapa al mostrarlo. |
| Permisos | Solo el autor elimina sus comentarios y adjuntos; solo el PO edita la DoD y solo el SM registra actas. |
| Tamaño de peticiones | 20 KB para JSON normal y 8 MB solo para la ruta de adjuntos (archivos de hasta 5 MB). |
| Notificaciones | Los identificadores se validan como números enteros antes de consultarlos. |

Sin hallazgos pendientes al cierre de la revisión.
