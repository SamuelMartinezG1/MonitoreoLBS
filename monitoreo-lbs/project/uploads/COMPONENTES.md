# Catálogo de componentes UI

Componentes reutilizables que el rediseño debe entregar como sistema.

---

## 1. `eng-panel` — Panel oscuro con header

**Anatomía:**
```
┌─────────────────────────────────────┐
│ [icon] TÍTULO MAYUS  [acción opc.] │  ← header (border-bottom sutil)
├─────────────────────────────────────┤
│                                     │
│  contenido                          │
│                                     │
└─────────────────────────────────────┘
```

- Background: `--bg-panel` (glass actual).
- Border: 1 px `--border-color`.
- Radius: 8 px.
- Header con título en mayúsculas, ícono Bootstrap, peso 600.
- Padding interno 0.75 rem.

**Variantes:** `eng-panel-sm`, `eng-panel-lg`, con/sin header, con borde acento (alarma).

---

## 2. `valor-card` — KPI numérico

**Anatomía:**
```
┌────────────┐
│ V_ENTRADA  │  ← label · text-dim · 0.65rem · uppercase · letter-spacing 1px
│            │
│   122.4    │  ← número · JetBrains Mono · 1.75rem · text-main
│  V (60Hz)  │  ← unidad · 0.75rem · text-sec
│            │
│ ━━━━━━━━━ │  ← (opcional) sparkline mini
└────────────┘
```

- Cuando el valor sale de rango, el borde superior cambia a `--status-warn` o `--status-err`.
- Hover: leve elevación (translateY -2px).
- Click opcional: abre detalle en drawer lateral.

---

## 3. `gauge` circular

**Anatomía:**
- SVG 100×100 px.
- Arco de fondo: `--bg-surface`.
- Arco activo: gradiente acento.
- Centro: valor (1.5 rem) + unidad (0.7 rem) + label (0.65 rem).
- Color del arco según rango: ok → `--status-ok`, warn → `--status-warn`, err → `--status-err`.

Se usan 4 en `monitoreo.html`: V_in, batería, carga, temperatura.

---

## 4. `status-pill` — Badge con dot pulsante

```
●  ONLINE     ●  OFFLINE    ●  ALARMA
```

- Dot 8 px circular con `box-shadow` glow del color.
- Texto en JetBrains Mono 0.7 rem.
- Animación `pulse-blue` o equivalente cuando está activo.

---

## 5. Charts (Chart.js)

Configuración estándar:
- Background del `<canvas>`: transparente.
- Grid: `rgba(255,255,255,0.05)`.
- Ejes: `--text-dim`.
- Líneas de fase: `--phase-l1`, `l2`, `l3`.
- Tensión: 0.3 (suave).
- Sin punto en cada muestra (solo línea) excepto en el último.
- Tooltip con fondo `--bg-elevated` y borde acento.

Tipos usados: line en vivo, line histórica, donut (carga), bar (calidad de energía).

---

## 6. Toast (notificación)

- Aparece arriba a la derecha (top-right).
- Anchura 320–400 px.
- Background `--bg-elevated`, borde izquierdo de 4 px del color del tipo.
- Tipos: `success` (verde), `error` (rojo), `warning` (naranja), `info` (azul corporativo).
- Auto-dismiss 4 s, excepto los `error` que son persistentes.
- Stack vertical con animación `slideInRight` / `slideOutRight`.

API:
```js
showToast('Mensaje', 'success'); // success | error | warning | info
```

---

## 7. Modal

- Centrado, scrollable.
- Header con título en font-mono, color `--accent-primary`, border-bottom.
- Body p-4.
- Footer con acción primaria a la derecha + cancelar a la izquierda.
- Background del panel `#1c1c1e`, glow azul tenue alrededor.

---

## 8. Botón

| Variante | Background | Border | Texto | Uso |
|----------|------------|--------|-------|-----|
| `primary` | `--accent-primary` | none | white | acción principal |
| `outline-primary` | transparent | 1 px `--accent-primary` | `--accent-primary` | acción secundaria |
| `outline-secondary` | transparent | 1 px `--border-color` | `--text-sec` | acción terciaria |
| `outline-danger` | transparent | 1 px `--status-err` | `--status-err` | eliminar / detener |
| `outline-warning` | transparent | 1 px `--status-warn` | `--status-warn` | diagnóstico |

Tamaños: `btn-sm` (0.65–0.75 rem), default (0.875 rem). Todos en JetBrains Mono.

---

## 9. Sidebar SCADA

- Width 200 px (collapsable a 56 px solo iconos).
- Header con título "DISPOSITIVOS" + 2 botones (registrar UPS, abrir diagnóstico).
- Lista agrupada por sitio (collapsable).
- Cada item: nombre del UPS + status-pill + IP en mono pequeñita.
- Item activo: borde izquierdo de 3 px `--accent-primary` + leve glow.

---

## 10. Toolbox flotante

- Columna fija a la derecha o flotante en el contenido.
- Botones cuadrados 40×40 px con icono.
- Tooltip al hacer hover.
- Botón REC con dot rojo pulsante cuando está grabando.

---

## Tabla compacta resumen

| Componente | Aparece en |
|-----------|------------|
| eng-panel | TODAS las páginas |
| valor-card | monitoreo, dashboard |
| gauge | monitoreo |
| status-pill | monitoreo, dashboard, inventario |
| chart | monitoreo, dashboard |
| toast | global (base.html) |
| modal | monitoreo, inventario, diagnóstico, gestión |
| botón | TODAS |
| sidebar SCADA | monitoreo (variantes en inventario, diagnóstico) |
| toolbox flotante | monitoreo |

Si el rediseño los entrega como un sistema coherente y documentado, el resto
de páginas se puede actualizar incrementalmente.
