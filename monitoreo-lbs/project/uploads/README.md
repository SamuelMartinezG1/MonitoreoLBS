# Design Brief — LBS Servicio · Sistema Web de Monitoreo UPS

> Carpeta lista para enviar a **Claude (Design)** y pedirle un rediseño
> completo de la interfaz. Toda la información que necesita está aquí.

---

## Cómo usar este paquete

1. **Comprime esta carpeta** (`design-brief/`) y súbela al chat con Claude.
2. Pídele exactamente lo que quieres. Ejemplo de prompt:

   > Adjunto el design brief de mi sistema SCADA web para monitoreo de UPS.
   > Quiero que **rediseñes completamente** el panel principal `monitoreo.html`
   > manteniendo todas las funciones (lista en `BRIEF.md` §4) y respetando
   > los pares de colores no negociables (§5.2). Entrega: HTML + CSS + JS,
   > responsive, dark-first, con identidad industrial moderna.

3. Si quieres que **además** rediseñe inventario, diagnóstico y dashboard,
   indícalo: hay un capítulo dedicado a cada uno en `BRIEF.md` §7.

---

## Contenido de este paquete

```
design-brief/
├── README.md               ← este archivo
├── BRIEF.md                ← documento principal: contexto, objetivos, secciones
├── DESIGN_TOKENS.md        ← colores, tipografía, espaciado, sombras (estado actual)
├── INVENTARIO_PANTALLAS.md ← lista de páginas con su propósito y elementos
├── COMPONENTES.md          ← catálogo de componentes UI reutilizables
└── codigo-actual/
    ├── templates/          ← HTML actuales (Jinja2 + Bootstrap 5.3)
    │   ├── base.html
    │   ├── monitoreo.html       ★ pantalla principal a rediseñar
    │   ├── dashboard.html
    │   ├── inventario.html
    │   ├── diagnostico.html
    │   └── login.html
    └── static/
        ├── main.css         ← ~3000 líneas, sistema de diseño actual
        ├── main.js          ← interceptor CSRF, toasts, reloj
        ├── animations.js    ← micro-interacciones
        └── power-flow.js    ← diagrama animado de flujo eléctrico
```

---

## Resumen ejecutivo (1 minuto)

- **Producto:** plataforma web para que ingenieros monitoreen UPS remotos
  vía SNMP/Modbus, con dashboard en tiempo real estilo SCADA industrial.
- **Estética actual:** oscuro (`#0e0e10`), glassmorphism, fuentes Inter +
  JetBrains Mono, acento azul `#0066FF`.
- **Stack frontend:** Bootstrap 5.3, Chart.js, Socket.IO, Bootstrap Icons.
- **Pantalla más importante:** `monitoreo.html` (~3000 líneas HTML) — vive
  ahí el ingeniero durante toda su jornada.
- **Lo que NO se debe perder:**
  - Densidad informativa (decenas de KPIs simultáneos).
  - Distinción de fases L1 = rojo, L2 = naranja, L3 = azul claro.
  - Sensación industrial / instrumentación.
  - Toasts en lugar de alerts.
  - Funcionamiento en navegador a 1080p y en tablet horizontal.

Lee `BRIEF.md` para el detalle completo.
