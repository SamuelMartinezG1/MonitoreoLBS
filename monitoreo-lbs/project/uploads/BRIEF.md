# BRIEF DE DISEÑO — LBS Servicio (Monitoreo UPS)

**Cliente:** Lemonroy Business Solutions
**Producto:** sistema web SCADA para monitoreo industrial de UPS
**Estado:** funcional en producción · pide rediseño visual completo
**Fecha del brief:** 2026-05-08

---

## 1. Contexto del negocio

LBS opera UPS (sistemas de alimentación ininterrumpida) en sitios remotos
de clientes. Cada sitio tiene un router industrial RUT956 con red ZeroTier
que permite alcanzar los UPS por SNMP v1/v2c y Modbus TCP. Los ingenieros
necesitan ver el estado de cada UPS **en tiempo real**, recibir alarmas
automáticas, generar reportes, registrar grabaciones puntuales y ejecutar
diagnósticos de red.

La app actual cumple las funciones, pero la UI está saturada visualmente,
el lenguaje gráfico es inconsistente entre páginas y la experiencia
responsive es regular. El objetivo es **rediseñarla completamente** sin
perder ninguna función.

---

## 2. Audiencia / personas

| Persona | Tarea principal | Contexto de uso |
|---------|----------------|-----------------|
| **Ingeniero de campo** (uso 80% del tiempo) | Monitorear UPS, atender alarmas, abrir grabaciones | Laptop 1080p, oficina, jornada completa |
| **Técnico instalador** | Registrar UPS nuevos, hacer diagnósticos de red, escanear OID | Tablet horizontal en sitio + laptop |
| **Supervisor** | Revisar reportes, dashboard general, vales | Laptop, sesiones cortas |
| **Administrador** | Gestión de cuentas, permisos, sitios | Desktop |

---

## 3. Objetivos del rediseño

1. **Modernizar** la estética sin abandonar el lenguaje SCADA / industrial.
2. **Reducir la fatiga visual** en jornadas largas (8 h frente al panel).
3. **Mejorar la jerarquía**: lo crítico debe saltar a la vista, lo secundario debe acompañar.
4. **Sistematizar componentes** (cards, gauges, charts, badges, toasts) — hoy son ad-hoc.
5. **Responsive real**: el plan está pensado en desktop, en tablet se rompe.
6. **Accesibilidad mínima**: contraste AA, focus visibles, aria-labels en gauges.
7. **Identidad consistente** en las 18 páginas existentes.

---

## 4. Pantalla estrella — `monitoreo.html`

Es donde el ingeniero pasa el día. Reemplazarla bien resuelve el 80 % del producto.

### 4.1 Layout actual (mental model)

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Top navbar  (logo · reloj UTC · usuario · sección actual)               │
├────────────┬─────────────────────────────────────────────────────────────┤
│            │  ┌──── Header del dispositivo seleccionado ─────────────┐  │
│            │  │  UPS-03-01    [ONLINE ●]   IP 192.168.3.10   [⋯]    │  │
│            │  └──────────────────────────────────────────────────────┘  │
│  Sidebar   │                                                             │
│  scada     │  ┌──── Diagrama de flujo UPS (animado SVG) ────────────┐   │
│            │  │   Red ──▶ Rectificador ──▶ Inversor ──▶ Carga       │   │
│  Lista de  │  │              ▲ Batería                              │   │
│  UPS       │  └─────────────────────────────────────────────────────┘   │
│  agrupados │                                                             │
│  por sitio │  ┌── LOG en vivo de eventos / alarmas ──────────────────┐  │
│            │  └──────────────────────────────────────────────────────┘  │
│  Botones   │                                                             │
│  +UPS y    │  ┌── VALORES EN TIEMPO REAL ─┬── GAUGES (4 circulares) ┐  │
│  diagn.    │  │  V_in · Bat · Carga · Temp│  V_in · Bat · Carga · T│  │
│            │  │  V_out · Hz · I · Modo    │                         │  │
│            │  │  (fila trifásica si aplica)│                         │  │
│            │  └────────────────────────────┴─────────────────────────┘  │
│            │                                                             │
│            │  ┌── ANÁLISIS DE CARGA ──┐  ┌── AMBIENTE Y ALARMAS ───┐    │
│            │  │  donut, factor pot., │  │  temperatura, humedad,  │    │
│            │  │  potencia activa, etc│  │  alarmas activas        │    │
│            │  └─────────────────────┘  └──────────────────────────┘    │
│            │                                                             │
│            │  ┌── TELEMETRÍA OSCILOSCOPIO (charts en vivo, 5 paneles)─┐│
│            │  │  V entrada · V salida · FFT · Temp · Bat & Carga      ││
│            │  └───────────────────────────────────────────────────────┘│
│            │                                                             │
│            │  ┌── CALIDAD DE ENERGÍA (1H · 6H · 24H · 7D · 30D) ──────┐│
│            │  │  KPIs (THD, FP, eventos) + 2 charts + tabla resumen   ││
│            │  └───────────────────────────────────────────────────────┘│
│            │                                                             │
│            │  Toolbox flotante (REC · historial REC · pantalla completa)│
└────────────┴─────────────────────────────────────────────────────────────┘
```

### 4.2 Funciones que NO pueden desaparecer

| Bloque | Acción / información |
|--------|----------------------|
| Sidebar | Lista de UPS agrupada por sitio, badge de estado (verde/rojo/ámbar), filtro rápido. |
| Header device | Nombre, IP, badge ONLINE/OFFLINE, abrir interfaz web del UPS, abrir modal de diagnóstico, abrir modal de registro. |
| Diagrama de flujo | SVG animado mostrando dirección y magnitud del flujo eléctrico (red, rectificador, inversor, batería, carga). |
| Status log | Tail en vivo de eventos del dispositivo, con botón limpiar. |
| Valores tiempo real | Cards numéricas: V entrada (L1/L2/L3), V salida, frecuencia, corriente, % carga, % batería, voltaje batería, temperatura, modo (Línea / Batería / Bypass). |
| Gauges circulares | 4 gauges (V entrada, batería, carga, temperatura) con color que cambia según rango. |
| Análisis de carga | Donut, factor de potencia, potencia activa/aparente, tiempo restante batería estimado. |
| Ambiente y alarmas | Temperatura ambiente, humedad si hay sensor Modbus, lista de alarmas activas. |
| Telemetría osciloscopio | 5 charts en vivo: V entrada por fase, V salida por fase, dominio de frecuencia (FFT), temperatura, batería + carga. |
| Calidad de energía | Selector de rango (1H/6H/24H/7D/30D), 4 KPIs, 2 charts de tendencia, tabla resumen, exportar CSV. |
| Toolbox | Botón REC (graba telemetría), historial REC, pantalla completa, captura. |
| Modales | Registrar nuevo UPS (autodetección + manual), diagnóstico (ping/SNMP walk/Modbus probe), historial de grabaciones. |

### 4.3 Estados visuales obligatorios

- **ONLINE** — pulse verde en badge, valores actualizándose cada 2 s.
- **OFFLINE** — silueta grisada del dispositivo, watermark "SIN SEÑAL", último timestamp.
- **ALARMA crítica** — borde rojo en panel, toast persistente, ícono parpadeante.
- **ALARMA warning** — borde naranja, toast con auto-dismiss.
- **GRABANDO** — punto rojo pulsante en toolbox + en sidebar.

---

## 5. Sistema de diseño actual (referencia)

> Consulta `DESIGN_TOKENS.md` para el detalle completo. Aquí lo esencial.

### 5.1 Color base

| Token | Hex | Uso |
|-------|-----|-----|
| `--bg-base` | `#0e0e10` | fondo de la app |
| `--bg-elevated` | `#1a1a1e` | paneles |
| `--bg-surface` | `#222226` | inputs, cards interiores |
| `--text-main` | `#f0f0f5` | texto principal |
| `--text-sec` | `#c8c8d0` | texto secundario |
| `--text-dim` | `#8a8a95` | labels |
| `--border-color` | `rgba(255,255,255,0.08)` | bordes |

### 5.2 Color semántico — **NO TOCAR**

| Color | Hex | Uso obligatorio |
|-------|-----|-----------------|
| Azul corporativo | `#0066FF` | acento de marca, botones primarios |
| Verde | `#32d74b` | OK / ONLINE / éxito |
| Naranja | `#ff9f0a` | warning / fase L2 |
| Rojo | `#ff453a` | error / alarma / fase L1 / botón eliminar / botón REC |
| Azul claro | `#0a84ff` | fase L3 (NO confundir con el azul corporativo) |

> Si rediseñas, puedes cambiar todo lo demás, pero la **convención por fases**
> y el rojo como crítico son sagrados — los ingenieros la tienen memorizada.

### 5.3 Tipografía

- **Inter** 400/500/600/700/800 — UI general.
- **JetBrains Mono** 400/500/700 — datos numéricos, IPs, OIDs, logs.
- Tamaños SCADA densos: titulares 0.75–1 rem, datos 1.5–2 rem.

### 5.4 Espaciado / layout

- Navbar 56 px, sidebar 200 px, gaps 0.5 rem.
- Optimizado a 1920×1080. La intención es **densidad alta** (no whitespace estilo SaaS).

---

## 6. Lo que sí puede cambiar (libre creativamente)

- Forma de los paneles (glass actual → ¿material? ¿solid? ¿neumórfico?).
- Forma de los gauges (hoy circulares; podrían ser arcos, barras radiales, segmented).
- Animaciones del diagrama de flujo (hoy líneas con puntos animados).
- Layout en breakpoints < 1280 px (hoy se rompe).
- Iconografía (hoy Bootstrap Icons; libre cambiar).
- Familia tipográfica (mientras siga existiendo una para datos numéricos).
- Modales (hoy Bootstrap; podrían ser drawers o popovers laterales).
- Sidebar (hoy fijo; podría ser collapsible / tabs verticales).

---

## 7. Otras pantallas a rediseñar (en orden de prioridad)

| # | Página | Función | Notas para rediseño |
|---|--------|---------|---------------------|
| 1 | `dashboard.html` | KPIs globales, mapa de sitios, contadores de UPS por estado | Hoy es muy plano; necesita storytelling |
| 2 | `inventario.html` | Topología de sitios, routers, perfiles OID por UPS | Actualmente tiene un "banco de pruebas OID" que es un tab gigantesco — separar |
| 3 | `diagnostico.html` | Ping, SNMP walk, Modbus probe, escaneo de subred | Buena oportunidad para una "consola" estilo terminal moderna |
| 4 | `login.html` | Auth | Quitar el aire amateur — debe sentirse pro |
| 5 | `vales.html` / `vales_historial.html` | Vales de herramienta (firmas, fotos) | Móvil-first |
| 6 | `gestion.html` / `gestionar_cuentas.html` | Admin | Tablas pulidas, permisos visualmente claros |
| 7 | `guia_rapida.html` | Cheatsheet operativa | Hoy es un md crudo en HTML — merece tratamiento de doc |

`base.html` define la navbar y los toasts globales — rediseñarla cambia todas las páginas.

---

## 8. Restricciones técnicas

- Stack obligatorio: HTML + CSS + Vanilla JS. Bootstrap **opcional** (si lo quitas, asegúrate de respetar la grid responsive).
- Compatible con **Chart.js** (los gráficos en vivo ya están conectados a Socket.IO).
- Sin frameworks pesados (no React/Vue) — la app es Flask + Jinja2.
- Mantén la convención `var(--token)` para que el rediseño herede tema oscuro/claro a futuro.
- Cache busting: cada CSS/JS lleva `?v=N` en `base.html`.

---

## 9. Entregables esperados

1. **`monitoreo.html` rediseñado** (HTML + bloques `<style>` o CSS aparte).
2. **`design-tokens.css`** con todas las variables nuevas comentadas.
3. **`componentes.html`** mostrando los building blocks (cards, gauges, charts, toasts, badges, modal, tabs).
4. **Nota de cambios** explicando qué desapareció, qué se fusionó, qué es nuevo.
5. (Opcional) Mockups en SVG / canvas mostrando el antes/después.

---

## 10. Anti-patrones a evitar

- ❌ Dashboards estilo "consumer SaaS" con mucho aire blanco.
- ❌ Tarjetas con esquinas muy redondeadas (>16 px) — rompe la sensación industrial.
- ❌ Gradientes pastel.
- ❌ Iconos cute / friendly.
- ❌ Animaciones lentas (>400 ms) — ingeniero quiere respuesta inmediata.
- ❌ Modales bloqueantes para acciones frecuentes.
- ❌ Sustituir gauges numéricos por solo "ok/no ok" — el ingeniero LEE el número.

---

## 11. Inspiración de referencia

- Cockpits de aviación (información densa, jerarquía clara).
- DAWs profesionales (FL Studio, Ableton — paneles especializados).
- Bloomberg Terminal (densidad sin caos).
- Grafana en modo oscuro (charts limpios, KPIs grandes).
- HMIs industriales modernos de Schneider Electric / Siemens.

**Anti-inspiración:** Notion, Linear, cualquier landing page de SaaS B2B
con ilustraciones tipo Memphis. Esto es una sala de control, no una app de productividad.
