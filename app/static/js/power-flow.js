/**
 * PowerFlowDiagram v2 — Professional SCADA UPS Power Flow
 * LBS Servicio App — Online Double-Conversion UPS
 *
 * Flow: AC INPUT → RECTIFIER → DC BUS → INVERTER → OUTPUT → LOAD
 *                                 |                        ↑
 *                              BATTERY                  BYPASS
 *
 * Supports single-phase and three-phase (L1/L2/L3) display.
 */
class PowerFlowDiagram {

    constructor(containerId) {
        this.container = document.getElementById(containerId);
        if (!this.container) { console.error('PowerFlowDiagram: #' + containerId + ' not found'); return; }

        this.NS = 'http://www.w3.org/2000/svg';
        this.state = 'offline';
        this.phases = 1;
        this.values = {
            voltaje_in: '--', voltaje_in_l2: '--', voltaje_in_l3: '--',
            voltaje_out: '--', voltaje_out_l2: '--', voltaje_out_l3: '--',
            corriente_out_l1: '--', corriente_out_l2: '--', corriente_out_l3: '--',
            bateria_pct: '--', carga_pct: '--',
            frecuencia: '--', frecuencia_out: '--',
            temperatura: '--', voltaje_bateria: '--', autonomia: '--'
        };

        this._animFrameId = null;
        this._particles = [];
        this._nodeEls = {};
        this._connEls = {};
        this._valEls = {};

        this._buildSVG();
        this._startParticleLoop();
    }

    /* ================================================================ */
    /*  LAYOUT                                                          */
    /* ================================================================ */

    get _layout() {
        const mainY = 155;
        const nodeH = 80;
        const nodeW = 126;
        const startX = 28;
        const gap = 16;
        const dcbusW = 136;

        return {
            mainY, nodeH, nodeW, startX, gap,
            nodes: {
                mains:     { x: startX,                                          y: mainY - nodeH / 2, w: nodeW,  h: nodeH, label: 'RED AC',        icon: 'mains' },
                rectifier: { x: startX + nodeW + gap,                            y: mainY - nodeH / 2, w: nodeW,  h: nodeH, label: 'RECTIFICADOR',  icon: 'rectifier' },
                dcbus:     { x: startX + (nodeW + gap) * 2,                      y: mainY - 14,        w: dcbusW, h: 28,    label: 'DC BUS',        icon: 'dcbus' },
                inverter:  { x: startX + (nodeW + gap) * 2 + dcbusW + gap,       y: mainY - nodeH / 2, w: nodeW,  h: nodeH, label: 'INVERSOR',      icon: 'inverter' },
                output:    { x: startX + (nodeW + gap) * 2 + dcbusW + gap + nodeW + gap, y: mainY - nodeH / 2, w: nodeW, h: nodeH, label: 'SALIDA AC', icon: 'output' },
                load:      { x: startX + (nodeW + gap) * 2 + dcbusW + gap + (nodeW + gap) * 2, y: mainY - nodeH / 2, w: nodeW, h: nodeH, label: 'CARGA', icon: 'load' },
                battery:   { x: startX + (nodeW + gap) * 2 + 20,                y: mainY + 80,        w: 150,    h: 100,   label: 'BATERIAS',      icon: 'battery' },
                bypass:    { x: startX + (nodeW + gap) * 2 + dcbusW + gap + 13,  y: mainY + 90,        w: 100,    h: 50,    label: 'BYPASS',        icon: 'bypass' }
            }
        };
    }

    /* ================================================================ */
    /*  SVG CONSTRUCTION                                                */
    /* ================================================================ */

    _buildSVG() {
        const NS = this.NS;
        const svg = document.createElementNS(NS, 'svg');
        svg.setAttribute('viewBox', '0 0 980 480');
        svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
        svg.style.width = '100%';
        svg.style.height = 'auto';
        svg.style.display = 'block';
        this.svg = svg;

        svg.appendChild(this._createDefs());
        svg.appendChild(this._createStyles());
        svg.appendChild(this._createBackground());

        this._statusBadge = this._createStatusBadge();
        svg.appendChild(this._statusBadge.group);

        this._connGroup = this._g('pf-connections'); svg.appendChild(this._connGroup);
        this._buildConnections();

        this._particleGroup = this._g('pf-particles'); svg.appendChild(this._particleGroup);

        this._nodeGroup = this._g('pf-nodes'); svg.appendChild(this._nodeGroup);
        this._buildNodes();

        this._valGroup = this._g('pf-values'); svg.appendChild(this._valGroup);
        this._buildValueTexts();

        // Three-phase data panel
        this._phaseGroup = this._g('pf-phase-panel'); svg.appendChild(this._phaseGroup);
        this._buildPhasePanel();

        this.container.appendChild(svg);
        this.setState(this.state);
    }

    _g(cls) { const g = document.createElementNS(this.NS, 'g'); g.setAttribute('class', cls); return g; }

    /* ================================================================ */
    /*  DEFS & STYLES                                                   */
    /* ================================================================ */

    _createDefs() {
        const NS = this.NS;
        const defs = document.createElementNS(NS, 'defs');

        // Glow filters
        const glows = { green: '#32d74b', orange: '#ff9f0a', yellow: '#FECA57', red: '#ff453a', blue: '#0066FF', cyan: '#00d4ff' };
        Object.entries(glows).forEach(([name, color]) => {
            const f = document.createElementNS(NS, 'filter');
            f.setAttribute('id', 'glow-' + name); f.setAttribute('x', '-50%'); f.setAttribute('y', '-50%');
            f.setAttribute('width', '200%'); f.setAttribute('height', '200%');

            const flood = document.createElementNS(NS, 'feFlood');
            flood.setAttribute('flood-color', color); flood.setAttribute('flood-opacity', '0.5'); flood.setAttribute('result', 'flood');
            const comp = document.createElementNS(NS, 'feComposite');
            comp.setAttribute('in', 'flood'); comp.setAttribute('in2', 'SourceGraphic'); comp.setAttribute('operator', 'in'); comp.setAttribute('result', 'mask');
            const blur = document.createElementNS(NS, 'feGaussianBlur');
            blur.setAttribute('in', 'mask'); blur.setAttribute('stdDeviation', '5'); blur.setAttribute('result', 'blur');
            const merge = document.createElementNS(NS, 'feMerge');
            const m1 = document.createElementNS(NS, 'feMergeNode'); m1.setAttribute('in', 'blur');
            const m2 = document.createElementNS(NS, 'feMergeNode'); m2.setAttribute('in', 'SourceGraphic');
            merge.appendChild(m1); merge.appendChild(m2);
            f.appendChild(flood); f.appendChild(comp); f.appendChild(blur); f.appendChild(merge);
            defs.appendChild(f);
        });

        // Dot grid pattern
        const pat = document.createElementNS(NS, 'pattern');
        pat.setAttribute('id', 'grid-dots'); pat.setAttribute('width', '24'); pat.setAttribute('height', '24');
        pat.setAttribute('patternUnits', 'userSpaceOnUse');
        const d = document.createElementNS(NS, 'circle');
        d.setAttribute('cx', '12'); d.setAttribute('cy', '12'); d.setAttribute('r', '0.6');
        d.setAttribute('fill', 'rgba(255,255,255,0.025)');
        pat.appendChild(d); defs.appendChild(pat);

        // DC bus gradient
        const lg = document.createElementNS(NS, 'linearGradient');
        lg.setAttribute('id', 'dcbus-grad'); lg.setAttribute('x1', '0'); lg.setAttribute('y1', '0');
        lg.setAttribute('x2', '0'); lg.setAttribute('y2', '1');
        const s1 = document.createElementNS(NS, 'stop'); s1.setAttribute('offset', '0%'); s1.setAttribute('stop-color', '#2a2a3a');
        const s2 = document.createElementNS(NS, 'stop'); s2.setAttribute('offset', '100%'); s2.setAttribute('stop-color', '#1a1a28');
        lg.appendChild(s1); lg.appendChild(s2); defs.appendChild(lg);

        // Node background gradient
        const ng = document.createElementNS(NS, 'linearGradient');
        ng.setAttribute('id', 'node-bg'); ng.setAttribute('x1', '0'); ng.setAttribute('y1', '0');
        ng.setAttribute('x2', '0'); ng.setAttribute('y2', '1');
        const ns1 = document.createElementNS(NS, 'stop'); ns1.setAttribute('offset', '0%'); ns1.setAttribute('stop-color', '#161620');
        const ns2 = document.createElementNS(NS, 'stop'); ns2.setAttribute('offset', '100%'); ns2.setAttribute('stop-color', '#0e0e16');
        ng.appendChild(ns1); ng.appendChild(ns2); defs.appendChild(ng);

        return defs;
    }

    _createStyles() {
        const s = document.createElementNS(this.NS, 'style');
        s.textContent = `
            @keyframes pf-pulse-red { 0%,100%{stroke:#ff453a;stroke-opacity:1} 50%{stroke:#ff453a;stroke-opacity:0.2} }
            @keyframes pf-pulse-orange { 0%,100%{stroke:#ff9f0a;stroke-opacity:1} 50%{stroke:#ff9f0a;stroke-opacity:0.35} }
            @keyframes pf-blink { 0%,100%{opacity:1} 50%{opacity:0.3} }
            .pf-node-box { fill:url(#node-bg); stroke:#1e1e2e; stroke-width:1.5; rx:8; transition:stroke .5s,filter .5s; }
            .pf-node-box.active-green  { stroke:#32d74b; filter:url(#glow-green); }
            .pf-node-box.active-orange { stroke:#ff9f0a; filter:url(#glow-orange); }
            .pf-node-box.active-yellow { stroke:#FECA57; filter:url(#glow-yellow); }
            .pf-node-box.active-blue   { stroke:#0066FF; filter:url(#glow-blue); }
            .pf-node-box.dimmed { stroke:#1a1a28; fill:#0c0c12; opacity:0.4; }
            .pf-node-box.pulse-red { animation:pf-pulse-red 1.5s ease-in-out infinite; }
            .pf-node-box.pulse-orange { animation:pf-pulse-orange 1.2s ease-in-out infinite; }
            .pf-node-label { fill:#6a6a78; font:600 8.5px/1 'Rajdhani','JetBrains Mono',monospace; text-anchor:middle; dominant-baseline:central; text-transform:uppercase; letter-spacing:1.2px; pointer-events:none; }
            .pf-node-icon { fill:#555; transition:fill .5s; }
            .pf-node-icon.active { fill:#bbb; }
            .pf-status-dot { transition:fill .5s; }
            .pf-val { fill:#e8e8f0; font:600 11px/1 'JetBrains Mono',monospace; text-anchor:middle; dominant-baseline:central; pointer-events:none; }
            .pf-val-sm { fill:#7a7a88; font:500 9px/1 'JetBrains Mono',monospace; text-anchor:middle; dominant-baseline:central; pointer-events:none; }
            .pf-val-lg { fill:#f0f0f5; font:700 20px/1 'JetBrains Mono',monospace; text-anchor:middle; dominant-baseline:central; pointer-events:none; }
            .pf-conn-line { fill:none; stroke:#222; stroke-width:3; stroke-linecap:round; stroke-linejoin:round; transition:stroke .5s; }
            .pf-conn-bypass { fill:none; stroke:#222; stroke-width:2; stroke-dasharray:8 5; stroke-linecap:round; transition:stroke .5s; }
            .pf-badge-bg { rx:14; transition:fill .5s,stroke .5s; }
            .pf-badge-text { fill:#fff; font:700 11px/1 'Rajdhani','JetBrains Mono',monospace; text-anchor:middle; dominant-baseline:central; letter-spacing:2px; pointer-events:none; }
            .pf-phase-label { fill:#555; font:600 8px/1 'Rajdhani',sans-serif; text-anchor:start; dominant-baseline:central; text-transform:uppercase; letter-spacing:1px; }
            .pf-phase-val { font:600 10px/1 'JetBrains Mono',monospace; dominant-baseline:central; pointer-events:none; }
            .pf-phase-header { fill:#6a6a78; font:700 9px/1 'Rajdhani',sans-serif; text-anchor:start; dominant-baseline:central; text-transform:uppercase; letter-spacing:1.5px; }
            .pf-temp-icon { fill:#555; font-size:11px; }
        `;
        return s;
    }

    _createBackground() {
        const r = document.createElementNS(this.NS, 'rect');
        r.setAttribute('width', '980'); r.setAttribute('height', '480');
        r.setAttribute('fill', 'url(#grid-dots)');
        return r;
    }

    /* ================================================================ */
    /*  STATUS BADGE                                                    */
    /* ================================================================ */

    _createStatusBadge() {
        const NS = this.NS;
        const g = document.createElementNS(NS, 'g');

        const bg = document.createElementNS(NS, 'rect');
        bg.setAttribute('x', '390'); bg.setAttribute('y', '10');
        bg.setAttribute('width', '200'); bg.setAttribute('height', '30');
        bg.setAttribute('class', 'pf-badge-bg'); bg.setAttribute('fill', '#1a1a24');
        bg.setAttribute('stroke', '#333'); bg.setAttribute('stroke-width', '1');
        g.appendChild(bg);

        const txt = document.createElementNS(NS, 'text');
        txt.setAttribute('x', '490'); txt.setAttribute('y', '26');
        txt.setAttribute('class', 'pf-badge-text');
        txt.textContent = 'FUERA DE LINEA';
        g.appendChild(txt);

        return { group: g, bg, text: txt };
    }

    /* ================================================================ */
    /*  CONNECTIONS                                                     */
    /* ================================================================ */

    _buildConnections() {
        const n = this._layout.nodes;
        const rOf = (nd) => ({ x: nd.x + nd.w, y: nd.y + nd.h / 2 });
        const lOf = (nd) => ({ x: nd.x, y: nd.y + nd.h / 2 });

        this._connDefs = {
            'mains-rect':   { d: `M${rOf(n.mains).x},${rOf(n.mains).y} L${lOf(n.rectifier).x},${lOf(n.rectifier).y}`, group: 'main', cls: 'pf-conn-line' },
            'rect-dcbus':   { d: `M${rOf(n.rectifier).x},${rOf(n.rectifier).y} L${n.dcbus.x},${n.dcbus.y + n.dcbus.h / 2}`, group: 'main', cls: 'pf-conn-line' },
            'dcbus-inv':    { d: `M${n.dcbus.x + n.dcbus.w},${n.dcbus.y + n.dcbus.h / 2} L${lOf(n.inverter).x},${lOf(n.inverter).y}`, group: 'main', cls: 'pf-conn-line' },
            'inv-output':   { d: `M${rOf(n.inverter).x},${rOf(n.inverter).y} L${lOf(n.output).x},${lOf(n.output).y}`, group: 'main', cls: 'pf-conn-line' },
            'output-load':  { d: `M${rOf(n.output).x},${rOf(n.output).y} L${lOf(n.load).x},${lOf(n.load).y}`, group: 'main', cls: 'pf-conn-line' },
            'dcbus-bat':    { d: `M${n.dcbus.x + n.dcbus.w / 2},${n.dcbus.y + n.dcbus.h} L${n.battery.x + n.battery.w / 2},${n.battery.y}`, group: 'battery', cls: 'pf-conn-line' },
            'bypass-path':  {
                d: (() => {
                    const byX = n.bypass.x + n.bypass.w / 2;
                    const byY = n.bypass.y + n.bypass.h / 2;
                    const sX = n.mains.x + n.mains.w / 2;
                    const sY = n.mains.y + n.mains.h;
                    const eX = n.output.x + n.output.w / 2;
                    const eY = n.output.y + n.output.h;
                    return `M${sX},${sY} L${sX},${byY} L${n.bypass.x},${byY} M${n.bypass.x + n.bypass.w},${byY} L${eX},${byY} L${eX},${eY}`;
                })(),
                group: 'bypass', cls: 'pf-conn-bypass'
            }
        };

        Object.entries(this._connDefs).forEach(([id, def]) => {
            const p = document.createElementNS(this.NS, 'path');
            p.setAttribute('d', def.d); p.setAttribute('class', def.cls); p.setAttribute('id', 'conn-' + id);
            this._connGroup.appendChild(p);
            this._connEls[id] = p;
        });
    }

    /* ================================================================ */
    /*  NODES                                                           */
    /* ================================================================ */

    _buildNodes() {
        const L = this._layout;
        Object.entries(L.nodes).forEach(([key, n]) => {
            if (key === 'dcbus') this._buildDCBusNode(n);
            else if (key === 'battery') this._buildBatteryNode(n);
            else if (key === 'load') this._buildLoadNode(n);
            else this._buildStandardNode(key, n);
        });
    }

    _buildStandardNode(key, n) {
        const NS = this.NS;
        const g = document.createElementNS(NS, 'g');
        const cx = n.x + n.w / 2;

        const rect = this._rect(n.x, n.y, n.w, n.h, 'pf-node-box');
        g.appendChild(rect);

        // Icon
        const iconG = document.createElementNS(NS, 'g');
        iconG.setAttribute('class', 'pf-node-icon');
        this._drawIcon(iconG, key, cx, n.y + 26);
        g.appendChild(iconG);

        // Label
        g.appendChild(this._text(cx, n.y + 54, n.label, 'pf-node-label'));

        // Status dot
        const dot = document.createElementNS(NS, 'circle');
        dot.setAttribute('cx', cx); dot.setAttribute('cy', n.y + 68);
        dot.setAttribute('r', '3.5'); dot.setAttribute('class', 'pf-status-dot'); dot.setAttribute('fill', '#333');
        g.appendChild(dot);

        this._nodeGroup.appendChild(g);
        this._nodeEls[key] = { g, rect, dot, iconG };
    }

    _buildDCBusNode(n) {
        const NS = this.NS;
        const g = document.createElementNS(NS, 'g');

        const bar = this._rect(n.x, n.y, n.w, n.h, 'pf-node-box');
        bar.setAttribute('fill', 'url(#dcbus-grad)'); bar.setAttribute('rx', '5');
        g.appendChild(bar);

        // Copper bus lines
        for (let i = 0; i < 3; i++) {
            const line = document.createElementNS(NS, 'line');
            line.setAttribute('x1', n.x + 10); line.setAttribute('y1', n.y + 6 + i * 8);
            line.setAttribute('x2', n.x + n.w - 10); line.setAttribute('y2', n.y + 6 + i * 8);
            line.setAttribute('stroke', '#2d2d40'); line.setAttribute('stroke-width', '2');
            line.setAttribute('stroke-linecap', 'round');
            g.appendChild(line);
        }

        g.appendChild(this._text(n.x + n.w / 2, n.y - 10, 'DC BUS', 'pf-node-label'));

        this._nodeGroup.appendChild(g);
        this._nodeEls['dcbus'] = { g, rect: bar, dot: null, iconG: null };
    }

    _buildBatteryNode(n) {
        const NS = this.NS;
        const g = document.createElementNS(NS, 'g');
        const cx = n.x + n.w / 2;

        const rect = this._rect(n.x, n.y, n.w, n.h, 'pf-node-box');
        g.appendChild(rect);

        // Battery icon — realistic cell bank
        const iconG = document.createElementNS(NS, 'g');
        iconG.setAttribute('class', 'pf-node-icon');
        const iy = n.y + 16;
        // 3 cells side by side
        for (let i = -1; i <= 1; i++) {
            const bx = cx + i * 16 - 7;
            const bp = document.createElementNS(NS, 'rect');
            bp.setAttribute('x', bx); bp.setAttribute('y', iy - 8);
            bp.setAttribute('width', '14'); bp.setAttribute('height', '16');
            bp.setAttribute('rx', '2'); bp.setAttribute('fill', 'none');
            bp.setAttribute('stroke', 'currentColor'); bp.setAttribute('stroke-width', '1.2');
            iconG.appendChild(bp);
            // Terminal nub
            const nub = document.createElementNS(NS, 'rect');
            nub.setAttribute('x', bx + 4); nub.setAttribute('y', iy - 11);
            nub.setAttribute('width', '6'); nub.setAttribute('height', '3');
            nub.setAttribute('rx', '1'); nub.setAttribute('fill', 'currentColor');
            iconG.appendChild(nub);
        }
        // + and - symbols
        const plus = this._text(cx - 22, iy, '+', 'pf-node-icon');
        plus.setAttribute('font-size', '10px'); plus.setAttribute('fill', 'currentColor'); plus.setAttribute('text-anchor', 'middle');
        iconG.appendChild(plus);
        const minus = this._text(cx + 22, iy, '−', 'pf-node-icon');
        minus.setAttribute('font-size', '10px'); minus.setAttribute('fill', 'currentColor'); minus.setAttribute('text-anchor', 'middle');
        iconG.appendChild(minus);
        g.appendChild(iconG);

        // Large battery percentage
        const pctText = document.createElementNS(NS, 'text');
        pctText.setAttribute('x', cx); pctText.setAttribute('y', n.y + 48);
        pctText.setAttribute('class', 'pf-val-lg');
        pctText.textContent = '--%';
        g.appendChild(pctText);

        // Progress bar
        const barX = n.x + 18;
        const barW = n.w - 36;
        const barBg = this._rect(barX, n.y + 62, barW, 8, '');
        barBg.setAttribute('rx', '4'); barBg.setAttribute('fill', '#1a1a28');
        barBg.setAttribute('stroke', '#2a2a3a'); barBg.setAttribute('stroke-width', '0.5');
        g.appendChild(barBg);

        const barFill = this._rect(barX, n.y + 62, 0, 8, '');
        barFill.setAttribute('rx', '4'); barFill.setAttribute('fill', '#32d74b');
        g.appendChild(barFill);

        // Label
        g.appendChild(this._text(cx, n.y + 86, 'BATERIAS', 'pf-node-label'));

        this._nodeGroup.appendChild(g);
        this._nodeEls['battery'] = { g, rect, dot: null, iconG, pctText, barFill, barBg, barW };
    }

    _buildLoadNode(n) {
        const NS = this.NS;
        const g = document.createElementNS(NS, 'g');
        const cx = n.x + n.w / 2;
        const cy = n.y + 26;

        const rect = this._rect(n.x, n.y, n.w, n.h, 'pf-node-box');
        g.appendChild(rect);

        // Load gauge arc
        const arcBg = document.createElementNS(NS, 'path');
        arcBg.setAttribute('d', this._arc(cx, cy, 16, -140, 140));
        arcBg.setAttribute('fill', 'none'); arcBg.setAttribute('stroke', '#1a1a28');
        arcBg.setAttribute('stroke-width', '4'); arcBg.setAttribute('stroke-linecap', 'round');
        g.appendChild(arcBg);

        const arcFill = document.createElementNS(NS, 'path');
        arcFill.setAttribute('d', this._arc(cx, cy, 16, -140, -140));
        arcFill.setAttribute('fill', 'none'); arcFill.setAttribute('stroke', '#0066FF');
        arcFill.setAttribute('stroke-width', '4'); arcFill.setAttribute('stroke-linecap', 'round');
        g.appendChild(arcFill);

        // Load pct
        const pctText = this._text(cx, cy + 5, '--%', 'pf-val');
        pctText.setAttribute('font-size', '10px');
        g.appendChild(pctText);

        g.appendChild(this._text(cx, n.y + 56, 'CARGA', 'pf-node-label'));

        const dot = document.createElementNS(NS, 'circle');
        dot.setAttribute('cx', cx); dot.setAttribute('cy', n.y + 68);
        dot.setAttribute('r', '3.5'); dot.setAttribute('class', 'pf-status-dot'); dot.setAttribute('fill', '#333');
        g.appendChild(dot);

        this._nodeGroup.appendChild(g);
        this._nodeEls['load'] = { g, rect, dot, iconG: null, pctText, arcFill, arcBg };
    }

    /* ================================================================ */
    /*  NODE ICONS — Professional SVG                                   */
    /* ================================================================ */

    _drawIcon(g, key, cx, cy) {
        const NS = this.NS;
        const icons = {
            mains: () => {
                // High-voltage tower / power grid
                const p = document.createElementNS(NS, 'g');
                // Tower body
                const tower = document.createElementNS(NS, 'path');
                tower.setAttribute('d', `M${cx},${cy - 14} L${cx - 5},${cy - 4} L${cx - 3},${cy - 4} L${cx - 7},${cy + 10} L${cx - 3},${cy + 10} L${cx},${cy + 2} L${cx + 3},${cy + 10} L${cx + 7},${cy + 10} L${cx + 3},${cy - 4} L${cx + 5},${cy - 4} Z`);
                tower.setAttribute('fill', 'none'); tower.setAttribute('stroke', 'currentColor'); tower.setAttribute('stroke-width', '1.2');
                p.appendChild(tower);
                // Cross arms
                const arm = document.createElementNS(NS, 'line');
                arm.setAttribute('x1', cx - 10); arm.setAttribute('y1', cy - 7);
                arm.setAttribute('x2', cx + 10); arm.setAttribute('y2', cy - 7);
                arm.setAttribute('stroke', 'currentColor'); arm.setAttribute('stroke-width', '1.2');
                p.appendChild(arm);
                // Wires hanging
                for (let i = -1; i <= 1; i++) {
                    const w = document.createElementNS(NS, 'line');
                    w.setAttribute('x1', cx + i * 8); w.setAttribute('y1', cy - 7);
                    w.setAttribute('x2', cx + i * 8); w.setAttribute('y2', cy - 3);
                    w.setAttribute('stroke', 'currentColor'); w.setAttribute('stroke-width', '0.8');
                    p.appendChild(w);
                }
                g.appendChild(p);
            },
            rectifier: () => {
                // Diode bridge rectifier symbol
                const sz = 9;
                // AC side wave
                const wave = document.createElementNS(NS, 'path');
                wave.setAttribute('d', `M${cx - 16},${cy} Q${cx - 12},${cy - 6} ${cx - 8},${cy} Q${cx - 4},${cy + 6} ${cx},${cy}`);
                wave.setAttribute('fill', 'none'); wave.setAttribute('stroke', 'currentColor'); wave.setAttribute('stroke-width', '1.3');
                g.appendChild(wave);
                // Arrow
                const arr = document.createElementNS(NS, 'path');
                arr.setAttribute('d', `M${cx + 1},${cy - 3} L${cx + 5},${cy} L${cx + 1},${cy + 3}`);
                arr.setAttribute('fill', 'none'); arr.setAttribute('stroke', 'currentColor'); arr.setAttribute('stroke-width', '1.2');
                g.appendChild(arr);
                // DC side (= sign with bars)
                for (let i = -1; i <= 1; i += 2) {
                    const bar = document.createElementNS(NS, 'line');
                    bar.setAttribute('x1', cx + 8); bar.setAttribute('y1', cy + i * 3);
                    bar.setAttribute('x2', cx + 16); bar.setAttribute('y2', cy + i * 3);
                    bar.setAttribute('stroke', 'currentColor'); bar.setAttribute('stroke-width', '1.5');
                    bar.setAttribute('stroke-linecap', 'round');
                    g.appendChild(bar);
                }
            },
            inverter: () => {
                // DC to AC — equals sign → sine wave
                for (let i = -1; i <= 1; i += 2) {
                    const bar = document.createElementNS(NS, 'line');
                    bar.setAttribute('x1', cx - 16); bar.setAttribute('y1', cy + i * 3);
                    bar.setAttribute('x2', cx - 8); bar.setAttribute('y2', cy + i * 3);
                    bar.setAttribute('stroke', 'currentColor'); bar.setAttribute('stroke-width', '1.5');
                    bar.setAttribute('stroke-linecap', 'round');
                    g.appendChild(bar);
                }
                const arr = document.createElementNS(NS, 'path');
                arr.setAttribute('d', `M${cx - 5},${cy - 3} L${cx - 1},${cy} L${cx - 5},${cy + 3}`);
                arr.setAttribute('fill', 'none'); arr.setAttribute('stroke', 'currentColor'); arr.setAttribute('stroke-width', '1.2');
                g.appendChild(arr);
                const wave = document.createElementNS(NS, 'path');
                wave.setAttribute('d', `M${cx},${cy} Q${cx + 4},${cy - 6} ${cx + 8},${cy} Q${cx + 12},${cy + 6} ${cx + 16},${cy}`);
                wave.setAttribute('fill', 'none'); wave.setAttribute('stroke', 'currentColor'); wave.setAttribute('stroke-width', '1.3');
                g.appendChild(wave);
            },
            output: () => {
                // Clean sine wave output symbol
                const wave = document.createElementNS(NS, 'path');
                wave.setAttribute('d', `M${cx - 14},${cy} Q${cx - 7},${cy - 10} ${cx},${cy} Q${cx + 7},${cy + 10} ${cx + 14},${cy}`);
                wave.setAttribute('fill', 'none'); wave.setAttribute('stroke', 'currentColor'); wave.setAttribute('stroke-width', '1.5');
                g.appendChild(wave);
                // Circle around it
                const circ = document.createElementNS(NS, 'circle');
                circ.setAttribute('cx', cx); circ.setAttribute('cy', cy); circ.setAttribute('r', '16');
                circ.setAttribute('fill', 'none'); circ.setAttribute('stroke', 'currentColor'); circ.setAttribute('stroke-width', '0.8');
                g.appendChild(circ);
            },
            bypass: () => {
                // Bypass arrow (curved)
                const p = document.createElementNS(NS, 'path');
                p.setAttribute('d', `M${cx - 10},${cy} C${cx - 4},${cy - 8} ${cx + 4},${cy - 8} ${cx + 10},${cy}`);
                p.setAttribute('fill', 'none'); p.setAttribute('stroke', 'currentColor'); p.setAttribute('stroke-width', '1.5');
                g.appendChild(p);
                const arr = document.createElementNS(NS, 'path');
                arr.setAttribute('d', `M${cx + 6},${cy - 4} L${cx + 10},${cy} L${cx + 6},${cy + 4}`);
                arr.setAttribute('fill', 'none'); arr.setAttribute('stroke', 'currentColor'); arr.setAttribute('stroke-width', '1.5');
                g.appendChild(arr);
            }
        };
        if (icons[key]) icons[key]();
    }

    /* ================================================================ */
    /*  VALUE TEXTS                                                     */
    /* ================================================================ */

    _buildValueTexts() {
        const n = this._layout.nodes;

        const mk = (id, x, y, cls) => {
            const t = this._text(x, y, '', cls || 'pf-val');
            this._valGroup.appendChild(t);
            this._valEls[id] = t;
        };

        // Input voltage & frequency
        const mConnMid = (n.mains.x + n.mains.w + n.rectifier.x) / 2;
        mk('v_in', mConnMid, n.mains.y - 12);
        mk('freq', mConnMid, n.mains.y + n.mains.h + 18, 'pf-val-sm');

        // Output voltage
        const oConnMid = (n.inverter.x + n.inverter.w + n.output.x) / 2;
        mk('v_out', oConnMid, n.output.y - 12);

        // Battery voltage & autonomy
        const batCx = n.battery.x + n.battery.w / 2;
        mk('bat_v', batCx - 30, n.battery.y + n.battery.h + 18, 'pf-val-sm');
        mk('autonomy', batCx + 34, n.battery.y + n.battery.h + 18, 'pf-val-sm');

        // Temperature (bottom right)
        mk('temp', 930, 465, 'pf-val-sm');
    }

    /* ================================================================ */
    /*  THREE-PHASE DATA PANEL                                          */
    /* ================================================================ */

    _buildPhasePanel() {
        const NS = this.NS;
        const px = 28;
        const py = 310;
        const g = this._phaseGroup;

        // Panel background
        const bg = this._rect(px, py, 920, 155, '');
        bg.setAttribute('fill', '#0c0c14'); bg.setAttribute('rx', '8');
        bg.setAttribute('stroke', '#1e1e2e'); bg.setAttribute('stroke-width', '1');
        g.appendChild(bg);
        this._phasePanelBg = bg;

        // Header
        const header = this._text(px + 16, py + 18, 'DATOS POR FASE', 'pf-phase-header');
        header.setAttribute('fill', '#6a6a78');
        g.appendChild(header);

        // Phase indicator dots + labels in header
        const phaseColors = { L1: '#ff453a', L2: '#ff9f0a', L3: '#0a84ff' };
        let hx = px + 140;
        Object.entries(phaseColors).forEach(([phase, color]) => {
            const dot = document.createElementNS(NS, 'circle');
            dot.setAttribute('cx', hx); dot.setAttribute('cy', py + 18);
            dot.setAttribute('r', '4'); dot.setAttribute('fill', color);
            g.appendChild(dot);
            const lbl = this._text(hx + 10, py + 18, phase, 'pf-phase-label');
            lbl.setAttribute('fill', color);
            g.appendChild(lbl);
            hx += 45;
        });

        // Data columns
        const cols = [
            { label: 'VOLTAJE ENTRADA', keys: ['vin_l1', 'vin_l2', 'vin_l3'], unit: 'V', x: px + 16 },
            { label: 'VOLTAJE SALIDA',  keys: ['vout_l1', 'vout_l2', 'vout_l3'], unit: 'V', x: px + 240 },
            { label: 'CORRIENTE SALIDA', keys: ['iout_l1', 'iout_l2', 'iout_l3'], unit: 'A', x: px + 464 },
            { label: 'FRECUENCIA',      keys: ['freq_in', 'freq_out'], unit: 'Hz', x: px + 688, isFreq: true },
        ];

        const rowY = py + 42;

        cols.forEach(col => {
            // Column label
            g.appendChild(this._text(col.x, rowY, col.label, 'pf-phase-header'));

            // Separator line
            const sep = document.createElementNS(NS, 'line');
            sep.setAttribute('x1', col.x); sep.setAttribute('y1', rowY + 8);
            sep.setAttribute('x2', col.x + 190); sep.setAttribute('y2', rowY + 8);
            sep.setAttribute('stroke', '#1e1e2e'); sep.setAttribute('stroke-width', '1');
            g.appendChild(sep);

            if (col.isFreq) {
                // Frequency: just IN and OUT
                const labels = ['ENTRADA', 'SALIDA'];
                col.keys.forEach((key, i) => {
                    const y = rowY + 28 + i * 30;
                    const lbl = this._text(col.x, y, labels[i], 'pf-phase-label');
                    lbl.setAttribute('fill', '#555');
                    g.appendChild(lbl);

                    const val = this._text(col.x + 120, y, '--', 'pf-phase-val');
                    val.setAttribute('fill', '#e0e0e8'); val.setAttribute('text-anchor', 'end');
                    g.appendChild(val);
                    this._valEls['phase_' + key] = val;

                    const uTxt = this._text(col.x + 128, y, col.unit, 'pf-phase-label');
                    uTxt.setAttribute('fill', '#444');
                    g.appendChild(uTxt);
                });
            } else {
                // L1/L2/L3 rows
                const colors = ['#ff453a', '#ff9f0a', '#0a84ff'];
                const phaseLabels = ['L1', 'L2', 'L3'];
                col.keys.forEach((key, i) => {
                    const y = rowY + 28 + i * 30;

                    // Phase color dot
                    const dot = document.createElementNS(NS, 'circle');
                    dot.setAttribute('cx', col.x + 4); dot.setAttribute('cy', y);
                    dot.setAttribute('r', '3'); dot.setAttribute('fill', colors[i]);
                    g.appendChild(dot);

                    // Phase label
                    const lbl = this._text(col.x + 14, y, phaseLabels[i], 'pf-phase-label');
                    lbl.setAttribute('fill', colors[i]);
                    g.appendChild(lbl);

                    // Value
                    const val = this._text(col.x + 120, y, '--', 'pf-phase-val');
                    val.setAttribute('fill', '#e0e0e8'); val.setAttribute('text-anchor', 'end');
                    g.appendChild(val);
                    this._valEls['phase_' + key] = val;

                    // Unit
                    const uTxt = this._text(col.x + 128, y, col.unit, 'pf-phase-label');
                    uTxt.setAttribute('fill', '#444');
                    g.appendChild(uTxt);
                });
            }
        });

        // Additional info column: Bateria + Carga + Temp
        const infoX = px + 688;
        const infoY = rowY + 88;
        const sep2 = document.createElementNS(NS, 'line');
        sep2.setAttribute('x1', infoX); sep2.setAttribute('y1', infoY - 8);
        sep2.setAttribute('x2', infoX + 190); sep2.setAttribute('y2', infoY - 8);
        sep2.setAttribute('stroke', '#1e1e2e'); sep2.setAttribute('stroke-width', '1');
        g.appendChild(sep2);

        const infoItems = [
            { label: 'BAT', key: 'phase_bat_v', unit: 'V' },
            { label: 'TEMP', key: 'phase_temp', unit: '\u00B0C' },
        ];
        infoItems.forEach((item, i) => {
            const x = infoX + i * 100;
            const lbl = this._text(x, infoY + 8, item.label, 'pf-phase-label');
            lbl.setAttribute('fill', '#555');
            g.appendChild(lbl);

            const val = this._text(x + 55, infoY + 8, '--', 'pf-phase-val');
            val.setAttribute('fill', '#e0e0e8'); val.setAttribute('text-anchor', 'end');
            g.appendChild(val);
            this._valEls[item.key] = val;

            const u = this._text(x + 63, infoY + 8, item.unit, 'pf-phase-label');
            u.setAttribute('fill', '#444');
            g.appendChild(u);
        });
    }

    /* ================================================================ */
    /*  PARTICLE SYSTEM                                                 */
    /* ================================================================ */

    _startParticleLoop() {
        let last = 0;
        const loop = (ts) => {
            if (!this.svg) return;
            const dt = last ? (ts - last) / 1000 : 0.016;
            last = ts;
            this._updateParticles(dt);
            this._animFrameId = requestAnimationFrame(loop);
        };
        this._animFrameId = requestAnimationFrame(loop);
    }

    _updateParticles(dt) {
        for (let i = this._particles.length - 1; i >= 0; i--) {
            const p = this._particles[i];
            p.progress += dt * p.speed;
            if (p.progress >= 1 || p.progress <= 0) {
                if (p.el && p.el.parentNode) p.el.parentNode.removeChild(p.el);
                this._particles.splice(i, 1);
                continue;
            }
            try {
                const pt = p.pathEl.getPointAtLength(p.progress * p.totalLength);
                p.el.setAttribute('cx', pt.x); p.el.setAttribute('cy', pt.y);
                const fade = p.progress < 0.1 ? p.progress / 0.1 : p.progress > 0.9 ? (1 - p.progress) / 0.1 : 1;
                p.el.setAttribute('opacity', fade * 0.85);
            } catch (e) {
                if (p.el && p.el.parentNode) p.el.parentNode.removeChild(p.el);
                this._particles.splice(i, 1);
            }
        }

        if (this._activeFlows) {
            this._activeFlows.forEach(f => {
                f._timer = (f._timer || 0) + dt;
                if (f._timer >= f.interval) { f._timer = 0; this._spawnParticle(f); }
            });
        }
    }

    _spawnParticle(flow) {
        const pathEl = this._connEls[flow.connId];
        if (!pathEl) return;

        const c = document.createElementNS(this.NS, 'circle');
        c.setAttribute('r', flow.size || 3); c.setAttribute('fill', flow.color); c.setAttribute('opacity', '0');
        this._particleGroup.appendChild(c);

        let totalLength;
        try { totalLength = pathEl.getTotalLength(); } catch (e) { return; }

        this._particles.push({
            el: c, pathEl, totalLength,
            progress: flow.reverse ? 1 : 0,
            speed: flow.reverse ? -flow.speed : flow.speed,
            color: flow.color
        });
    }

    _clearParticles() {
        this._particles.forEach(p => { if (p.el && p.el.parentNode) p.el.parentNode.removeChild(p.el); });
        this._particles = [];
        this._activeFlows = null;
    }

    /* ================================================================ */
    /*  PUBLIC API                                                      */
    /* ================================================================ */

    updateValues(data) {
        if (!data || !this.svg) return;
        const prev = this.values;
        this.values = { ...prev, ...data };
        const v = this.values;

        const set = (id, val) => { if (this._valEls[id]) this._valEls[id].textContent = val; };

        // Main diagram values
        set('v_in', this._fmt(v.voltaje_in, 'V'));
        set('freq', this._fmt(v.frecuencia, 'Hz'));
        set('v_out', this._fmt(v.voltaje_out, 'V'));
        set('bat_v', this._fmt(v.voltaje_bateria, 'V'));
        set('autonomy', this._fmtTime(v.autonomia));
        set('temp', v.temperatura != null && v.temperatura !== '--' ? this._fmt(v.temperatura, 'C') : '');

        // Phase panel values
        set('phase_vin_l1', this._fmtNum(v.voltaje_in));
        set('phase_vin_l2', this._fmtNum(v.voltaje_in_l2));
        set('phase_vin_l3', this._fmtNum(v.voltaje_in_l3));
        set('phase_vout_l1', this._fmtNum(v.voltaje_out));
        set('phase_vout_l2', this._fmtNum(v.voltaje_out_l2));
        set('phase_vout_l3', this._fmtNum(v.voltaje_out_l3));
        set('phase_iout_l1', this._fmtNum(v.corriente_out_l1));
        set('phase_iout_l2', this._fmtNum(v.corriente_out_l2));
        set('phase_iout_l3', this._fmtNum(v.corriente_out_l3));
        set('phase_freq_in', this._fmtNum(v.frecuencia));
        set('phase_freq_out', this._fmtNum(v.frecuencia_out));
        set('phase_bat_v', this._fmtNum(v.voltaje_bateria));
        set('phase_temp', this._fmtNum(v.temperatura));

        // Battery visual
        const batEl = this._nodeEls.battery;
        if (batEl) {
            const pct = parseFloat(v.bateria_pct);
            if (!isNaN(pct)) {
                batEl.pctText.textContent = Math.round(pct) + '%';
                let color = '#32d74b';
                if (pct <= 20) color = '#ff453a';
                else if (pct <= 50) color = '#ff9f0a';
                batEl.pctText.setAttribute('fill', color);
                batEl.barFill.setAttribute('fill', color);
                batEl.barFill.setAttribute('width', Math.max(0, Math.min(batEl.barW, batEl.barW * pct / 100)));
            } else {
                batEl.pctText.textContent = '--%';
                batEl.pctText.setAttribute('fill', '#f0f0f5');
                batEl.barFill.setAttribute('width', '0');
            }
        }

        // Load gauge
        const loadEl = this._nodeEls.load;
        if (loadEl) {
            const pct = parseFloat(v.carga_pct);
            if (!isNaN(pct)) {
                loadEl.pctText.textContent = Math.round(pct) + '%';
                const n = this._layout.nodes.load;
                const cx = n.x + n.w / 2;
                const cy = n.y + 26;
                const endAngle = -140 + (280 * Math.min(pct, 100) / 100);
                loadEl.arcFill.setAttribute('d', this._arc(cx, cy, 16, -140, endAngle));
                let color = '#0066FF';
                if (pct > 90) color = '#ff453a';
                else if (pct > 70) color = '#ff9f0a';
                loadEl.arcFill.setAttribute('stroke', color);
            } else {
                loadEl.pctText.textContent = '--%';
            }
        }
    }

    setPhases(phases) {
        this.phases = phases || 1;
        // Could hide/show L2/L3 rows in phase panel based on this
    }

    setState(state) {
        if (!this.svg) return;
        this.state = state;
        this._clearParticles();
        this._resetVisuals();

        switch (state) {
            case 'online': this._applyOnlineState(); break;
            case 'battery': this._applyBatteryState(); break;
            case 'bypass': this._applyBypassState(); break;
            default: this._applyOfflineState(); break;
        }
    }

    destroy() {
        if (this._animFrameId) { cancelAnimationFrame(this._animFrameId); this._animFrameId = null; }
        this._clearParticles();
        if (this.svg && this.svg.parentNode) this.svg.parentNode.removeChild(this.svg);
        this.svg = null;
    }

    /* ================================================================ */
    /*  STATE VISUALS                                                   */
    /* ================================================================ */

    _resetVisuals() {
        Object.values(this._nodeEls).forEach(({ rect }) => { if (rect) rect.className.baseVal = 'pf-node-box'; });
        Object.values(this._connEls).forEach(p => { p.style.stroke = ''; });
        Object.values(this._nodeEls).forEach(({ iconG }) => { if (iconG) iconG.classList.remove('active'); });
        Object.values(this._nodeEls).forEach(({ dot }) => { if (dot) dot.setAttribute('fill', '#333'); });
        if (this._phasePanelBg) this._phasePanelBg.setAttribute('stroke', '#1e1e2e');
    }

    _applyOnlineState() {
        const blue = '#0066FF';
        const green = '#32d74b';

        this._statusBadge.bg.setAttribute('fill', '#0a2a0a'); this._statusBadge.bg.setAttribute('stroke', green);
        this._statusBadge.text.textContent = 'EN LINEA'; this._statusBadge.text.setAttribute('fill', green);

        ['mains-rect', 'rect-dcbus', 'dcbus-inv', 'inv-output', 'output-load'].forEach(id => {
            if (this._connEls[id]) this._connEls[id].style.stroke = blue;
        });
        if (this._connEls['dcbus-bat']) this._connEls['dcbus-bat'].style.stroke = '#32d74b44';

        ['mains', 'rectifier', 'dcbus', 'inverter', 'output', 'load'].forEach(k => {
            const el = this._nodeEls[k];
            if (el && el.rect) el.rect.className.baseVal = 'pf-node-box active-green';
            if (el && el.dot) el.dot.setAttribute('fill', green);
            if (el && el.iconG) el.iconG.classList.add('active');
        });
        if (this._nodeEls.battery) {
            this._nodeEls.battery.rect.className.baseVal = 'pf-node-box active-green';
            if (this._nodeEls.battery.iconG) this._nodeEls.battery.iconG.classList.add('active');
        }
        if (this._phasePanelBg) this._phasePanelBg.setAttribute('stroke', '#1a3a1a');

        this._activeFlows = [
            { connId: 'mains-rect', color: blue, speed: 0.75, interval: 0.2, size: 3 },
            { connId: 'rect-dcbus', color: blue, speed: 0.85, interval: 0.25, size: 3 },
            { connId: 'dcbus-inv', color: blue, speed: 0.85, interval: 0.25, size: 3 },
            { connId: 'inv-output', color: blue, speed: 0.75, interval: 0.2, size: 3 },
            { connId: 'output-load', color: blue, speed: 0.75, interval: 0.2, size: 3 },
            { connId: 'dcbus-bat', color: green, speed: 0.3, interval: 0.7, size: 2 }
        ];
    }

    _applyBatteryState() {
        const orange = '#ff9f0a';

        this._statusBadge.bg.setAttribute('fill', '#2a1a00'); this._statusBadge.bg.setAttribute('stroke', orange);
        this._statusBadge.text.textContent = 'EN BATERIA'; this._statusBadge.text.setAttribute('fill', orange);

        this._nodeEls.mains.rect.className.baseVal = 'pf-node-box pulse-red';
        if (this._nodeEls.mains.dot) this._nodeEls.mains.dot.setAttribute('fill', '#ff453a');

        ['dcbus-inv', 'inv-output', 'output-load'].forEach(id => { if (this._connEls[id]) this._connEls[id].style.stroke = orange; });
        if (this._connEls['dcbus-bat']) this._connEls['dcbus-bat'].style.stroke = orange;

        this._nodeEls.battery.rect.className.baseVal = 'pf-node-box active-orange';
        if (this._nodeEls.battery.iconG) this._nodeEls.battery.iconG.classList.add('active');

        ['dcbus', 'inverter', 'output', 'load'].forEach(k => {
            const el = this._nodeEls[k];
            if (el && el.rect) el.rect.className.baseVal = 'pf-node-box active-orange';
            if (el && el.dot) el.dot.setAttribute('fill', orange);
            if (el && el.iconG) el.iconG.classList.add('active');
        });
        this._nodeEls.rectifier.rect.className.baseVal = 'pf-node-box dimmed';
        if (this._phasePanelBg) this._phasePanelBg.setAttribute('stroke', '#2a1a00');

        this._activeFlows = [
            { connId: 'dcbus-bat', color: orange, speed: 0.5, interval: 0.3, size: 3, reverse: true },
            { connId: 'dcbus-inv', color: orange, speed: 0.75, interval: 0.2, size: 3 },
            { connId: 'inv-output', color: orange, speed: 0.75, interval: 0.2, size: 3 },
            { connId: 'output-load', color: orange, speed: 0.75, interval: 0.2, size: 3 }
        ];
    }

    _applyBypassState() {
        const yellow = '#FECA57';

        this._statusBadge.bg.setAttribute('fill', '#2a2800'); this._statusBadge.bg.setAttribute('stroke', yellow);
        this._statusBadge.text.textContent = 'BYPASS'; this._statusBadge.text.setAttribute('fill', yellow);

        if (this._connEls['bypass-path']) this._connEls['bypass-path'].style.stroke = yellow;
        if (this._connEls['output-load']) this._connEls['output-load'].style.stroke = yellow;

        ['mains', 'output', 'load'].forEach(k => {
            const el = this._nodeEls[k];
            if (el && el.rect) el.rect.className.baseVal = 'pf-node-box active-yellow';
            if (el && el.dot) el.dot.setAttribute('fill', yellow);
            if (el && el.iconG) el.iconG.classList.add('active');
        });
        this._nodeEls.bypass.rect.className.baseVal = 'pf-node-box active-yellow';

        ['rectifier', 'dcbus', 'inverter'].forEach(k => {
            const el = this._nodeEls[k];
            if (el && el.rect) el.rect.className.baseVal = 'pf-node-box dimmed';
        });
        this._nodeEls.battery.rect.className.baseVal = 'pf-node-box dimmed';

        this._activeFlows = [
            { connId: 'bypass-path', color: yellow, speed: 0.4, interval: 0.25, size: 3 },
            { connId: 'output-load', color: yellow, speed: 0.8, interval: 0.25, size: 3 }
        ];
    }

    _applyOfflineState() {
        const red = '#ff453a';

        // Status badge
        this._statusBadge.bg.setAttribute('fill', '#331111');
        this._statusBadge.bg.setAttribute('stroke', red);
        this._statusBadge.bg.setAttribute('stroke-width', '1');
        this._statusBadge.text.textContent = 'FUERA DE LINEA';
        this._statusBadge.text.setAttribute('fill', red);

        // Mains pulsing red
        this._nodeEls.mains.rect.className.baseVal = 'pf-node-box pulse-red';
        if (this._nodeEls.mains.dot) this._nodeEls.mains.dot.setAttribute('fill', red);

        // All connections gray
        Object.values(this._connEls).forEach(p => {
            p.style.stroke = '#1a1a28';
        });

        // No particles
        this._activeFlows = null;
    }

    /* ================================================================== */
    /*  HELPERS                                                            */
    /* ================================================================== */

    _fmt(val, unit) {
        if (val === null || val === undefined || val === '--') return '--';
        const num = parseFloat(val);
        if (isNaN(num)) return '--';
        if (unit === '%') return `${Math.round(num)}%`;
        if (unit === 'C') return `${num.toFixed(1)}\u00B0C`;
        if (unit === 'Hz') return `${num.toFixed(1)} Hz`;
        return `${num.toFixed(1)} ${unit}`;
    }

    _fmtTime(minutes) {
        if (minutes === null || minutes === undefined || minutes === '--') return '';
        const m = parseFloat(minutes);
        if (isNaN(m)) return '';
        if (m >= 60) {
            const h = Math.floor(m / 60);
            const r = Math.round(m % 60);
            return `~${h}h ${r}m`;
        }
        return `~${Math.round(m)} min`;
    }

    /**
     * Describe an SVG arc path
     */
    _describeArc(cx, cy, r, startAngle, endAngle) {
        const rad = (a) => a * Math.PI / 180;
        const sx = cx + r * Math.cos(rad(startAngle));
        const sy = cy + r * Math.sin(rad(startAngle));
        const ex = cx + r * Math.cos(rad(endAngle));
        const ey = cy + r * Math.sin(rad(endAngle));
        const diff = endAngle - startAngle;
        const largeArc = Math.abs(diff) > 180 ? 1 : 0;
        const sweep = diff > 0 ? 1 : 0;
        return `M${sx},${sy} A${r},${r} 0 ${largeArc} ${sweep} ${ex},${ey}`;
    }
}