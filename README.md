# Asistencias en Ruta — TRANSDA

Sistema de reporte y atención de asistencias en ruta (levantes) para la flota de TRANSDA / Gasolineras Don Arturo.

| Archivo | Uso |
|---|---|
| `index.html` | Menú de inicio |
| `pilotos.html` | Piloto reporta la falla (foto, GPS, departamento) — *Fase 2* |
| `mecanicos.html` | Mecánico atiende y cierra — *Fase 3* |
| `taller.html` | Tablero del Jefe de Taller — *Fase 4* |
| `nucleo-prueba.html` | Prueba técnica de conexión, GPS, fotos, PDF y WhatsApp |
| `core.js` | Núcleo compartido (API, cola sin señal, GPS, PDF, compartir) |
| `config.js` | **Única configuración:** URL de Apps Script |
| `apps-script/Code.gs` | Backend que va pegado en la Google Sheet |

**Privacidad:** este repositorio no contiene datos de la empresa. Unidades, pilotos, asistencias y fotos viven en la Google Sheet y en Drive (privados); solo se leen con PIN.

Librería incluida: jsPDF (licencia MIT, `vendor/jspdf-LICENSE.txt`). Límites de departamentos: Natural Earth (dominio público).
