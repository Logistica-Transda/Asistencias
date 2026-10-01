# Asistencias en Ruta — TRANSDA

Sistema de reporte y atención de asistencias en ruta (levantes) para la flota de TRANSDA / Gasolineras Don Arturo.

| Archivo | Uso |
|---|---|
| `index.html` | Menú de inicio |
| `pilotos.html` | Piloto reporta la falla (foto, GPS, departamento) |
| `mecanicos.html` | Mecánico atiende y cierra |
| `taller.html` + `taller.js` | Tablero del Jefe de Taller |
| `nucleo-prueba.html` | Prueba técnica de conexión, GPS, fotos, PDF y WhatsApp |
| `core.js` | Núcleo compartido (API, cola sin señal, GPS, PDF, compartir) |
| `config.js` | **Única configuración:** URL de Apps Script |

**Seguridad (v1.4):** ingreso con PIN de 8 dígitos por rol, bloqueo de 15 minutos tras 10 intentos fallidos, sesiones de 30 días (el PIN no se guarda en el celular). El backend no está en este repositorio.

**Privacidad:** este repositorio no contiene datos de la empresa. Unidades, pilotos, asistencias y fotos viven en la Google Sheet y en Drive (privados); solo se leen con PIN.

Librería incluida: jsPDF (licencia MIT, `vendor/jspdf-LICENSE.txt`). Límites de departamentos: Natural Earth (dominio público).
