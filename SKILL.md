# TecnoGamer — Kit de Desarrollo Completo

Scripts:
  gen:database   → Genera la base de datos SQLite con schema + seed
  start          → Inicia servidor + frontend en watch mode
  preview        → Abre el preview en el navegador

Estructura de archivos:
├── scripts/
│   ├── gen-database.js   # Schema + seed de produtos
│   ├── start.js          # Servidor + frontend en modo dev
│   └── preview.js        # Abre el navegador con el preview
├── data/
│   └── tecnogamer.db     # Base de datos (generada automáticamente)
├── index.html            # Frontend SPA autocontenido
├── css/
│   └── style.css         # Estilos completos
├── js/
│   └── app.js            # Lógica frontend SPA
└── logo-tecnogamer.svg   # Logo SVG
