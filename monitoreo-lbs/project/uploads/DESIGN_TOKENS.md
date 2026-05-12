# DESIGN TOKENS — Estado actual

Extracto de `app/static/css/main.css` (variables `:root`). Sirve como
referencia para el rediseño.

---

## Colores · Base

| Token | Valor | Notas |
|-------|-------|-------|
| `--bg-base` | `#0e0e10` | fondo de la app, casi negro |
| `--bg-elevated` | `#1a1a1e` | paneles principales |
| `--bg-surface` | `#222226` | inputs, cards anidadas |
| `--bg-dark` | `#0e0e10` | alias de `bg-base` |
| `--bg-panel` | `rgba(22,22,26,0.75)` | glassmorphism |
| `--bg-panel-solid` | `#1a1a1e` | sin transparencia |

## Colores · Texto

| Token | Valor |
|-------|-------|
| `--text-main` | `#f0f0f5` |
| `--text-sec`  | `#c8c8d0` |
| `--text-dim`  | `#8a8a95` |

## Colores · Acento (azul corporativo)

| Token | Valor |
|-------|-------|
| `--accent-primary` | `#0066FF` |
| `--accent-primary-hover` | `#0052CC` |
| `--accent-primary-light` | `#3399FF` |
| `--accent-primary-deep` | `#001A33` |
| `--accent-primary-glow` | `rgba(0,102,255,0.3)` |
| `--accent-glow` | `rgba(0,102,255,0.35)` |
| `--accent-dim` | `#0052CC` |

## Colores · Estado (no negociables)

| Token | Valor | Significado |
|-------|-------|-------------|
| `--status-ok` | `#32d74b` | online / éxito |
| `--status-warn` | `#ff9f0a` | warning |
| `--status-err` | `#ff453a` | error / alarma crítica |

## Colores · Fases eléctricas (no negociables)

| Token | Valor | Fase |
|-------|-------|------|
| `--phase-l1` | `#ff453a` | Línea 1 (rojo) |
| `--phase-l2` | `#ff9f0a` | Línea 2 (naranja) |
| `--phase-l3` | `#0a84ff` | Línea 3 (azul claro) |

> ⚠️ El `--phase-l3` es **azul claro `#0a84ff`** y NO debe confundirse con el
> azul corporativo `#0066FF`.

## Bordes

| Token | Valor |
|-------|-------|
| `--border-color` | `rgba(255,255,255,0.08)` |
| `--border-hover` | `rgba(255,255,255,0.18)` |
| `--border-active` | `rgba(0,102,255,0.4)` |

## Sombras

| Token | Valor | Uso |
|-------|-------|-----|
| `--shadow-sm` | `0 2px 8px rgba(0,0,0,0.3)` | elementos pequeños |
| `--shadow-md` | `0 4px 24px rgba(0,0,0,0.45)` | paneles |
| `--shadow-lg` | `0 12px 48px rgba(0,0,0,0.6)` | modales |
| `--shadow-glow` | `0 0 20px rgba(0,102,255,0.25)` | hover de acentos |

---

## Tipografía

```
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;700&display=swap');
```

| Familia | Pesos | Uso |
|---------|-------|-----|
| **Inter** | 400 / 500 / 600 / 700 / 800 | UI general, títulos, labels |
| **JetBrains Mono** | 400 / 500 / 700 | datos numéricos, IPs, OIDs, logs, telemetría |

> El proyecto también referencia *Rajdhani* en CLAUDE.md pero en la práctica
> usa Inter.

Tamaños típicos detectados en el código:
- `0.65rem` — labels diminutos en botones secundarios
- `0.75rem` — labels de paneles, badges
- `0.875rem` — texto general
- `1rem` — texto principal
- `1.5–2rem` — números de gauges
- `2.5–3rem` — número grande del UPS seleccionado

---

## Layout

| Token | Valor |
|-------|-------|
| `--navbar-height` | `56px` |
| `--sidebar-width` | `200px` |
| `--panel-padding` | `0.75rem` |
| `--gap-sections` | `0.5rem` |
| `--chart-max-height` | `250px` |
| `--gauge-size` | `100px` |

## Animación

| Token | Valor |
|-------|-------|
| `--ease-out-expo` | `cubic-bezier(0.16, 1, 0.3, 1)` |
| `--ease-spring` | `cubic-bezier(0.34, 1.56, 0.64, 1)` |
| `--duration-fast` | `0.15s` |
| `--duration-normal` | `0.3s` |
| `--duration-slow` | `0.5s` |

Keyframes definidos:
- `fadeIn`, `slideUp`, `slideInLeft`, `slideInRight`, `slideOutRight`
- `gradientShift`, `shimmer`
- `glowPulse`, `pulse-blue`, `borderGlow` — efectos de acento azul
- `ripple` — feedback de click
- `tabFadeIn`, `rowSlideIn`, `accentLine`

---

## Recomendaciones para el rediseño

1. **Mantén el contrato de tokens** (mismos nombres) → la app entera leerá el nuevo CSS sin tocar HTML/JS.
2. Si introduces tema claro, prefija (`--light-bg-base`) y resuelve con `data-theme="light"`.
3. Las **fases L1/L2/L3** mapean también a colores de gráficos en `Chart.js` — no inviertas el orden.
4. El "glow azul" es marca; si lo quitas, sustitúyelo por algo igualmente reconocible.
