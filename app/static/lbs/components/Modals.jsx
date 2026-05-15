// Modals.jsx — diálogos para CRUD de sitios, dispositivos y cuenta.
// Mantiene el shape `window.MOCK` consistente porque al guardar dispara
// `window.LBS_DATA.refresh()` que repuebla los datos desde Postgres.

const { useState: useStateM, useEffect: useEffectM } = React;

// ──────────────────────────────────────────────────────────────────────
// Marco común
// ──────────────────────────────────────────────────────────────────────
function ModalShell({ title, onClose, children, footer }) {
  useEffectM(() => {
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="lbs-modal-backdrop" onClick={onClose}>
      <div className="lbs-modal" onClick={e => e.stopPropagation()}>
        <div className="lbs-modal-head">
          <h3>{title}</h3>
          <button className="lbs-modal-x" onClick={onClose} aria-label="Cerrar">
            <i className="bi bi-x-lg"></i>
          </button>
        </div>
        <div className="lbs-modal-body">{children}</div>
        {footer && <div className="lbs-modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

function Field({ label, hint, children }) {
  return (
    <label className="lbs-field">
      <span className="lbs-field-label">{label}</span>
      {children}
      {hint && <span className="lbs-field-hint">{hint}</span>}
    </label>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Modal: nuevo dispositivo
// ──────────────────────────────────────────────────────────────────────
function AddDeviceModal({ sitios, onClose, onSaved, prefill }) {
  const [busy, setBusy] = useStateM(false);
  const [err,  setErr]  = useStateM(null);
  const [scan, setScan] = useStateM(null);
  const [scanning, setScanning] = useStateM(false);

  // Inferir ups_type a partir del sysDescr del prefill
  const guessFromDescr = (descr) => {
    const s = String(descr || '').toLowerCase();
    if (s.includes('megatec') || s.includes('voltronic')) return 'megatec_snmp';
    if (s.includes('invt'))    return 'invt_enterprise';
    if (s.includes('ups-mib') || s.includes('rfc 1628')) return 'ups_mib_standard';
    return 'invt_enterprise';
  };

  const [form, setForm] = useStateM({
    nombre:         (prefill && prefill.nombre) || '',
    ip:             (prefill && prefill.ip)     || '',
    protocolo:      'snmp',
    snmp_port:      161,
    snmp_community: 'public',
    snmp_version:   1,
    modbus_port:    502,
    modbus_unit_id: 1,
    ups_type:       prefill && prefill.sysdescr ? guessFromDescr(prefill.sysdescr) : 'invt_enterprise',
    fases:          1,
    sitio_id:       prefill && prefill.sitio_id ? String(prefill.sitio_id) : '',
  });
  const upd = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const autoset = async () => {
    if (!form.ip) { setErr('Captura la IP antes de auto-detectar'); return; }
    setScanning(true); setErr(null);
    try {
      const r = await window.LBS_API.autosetScan(form.ip);
      if (r.status === 'ok' && r.resultado) {
        const x = r.resultado;
        setForm(f => ({
          ...f,
          nombre: f.nombre || x.nombre_sugerido || f.nombre,
          protocolo: x.protocolo || f.protocolo,
          snmp_port: x.snmp_port || f.snmp_port,
          snmp_community: x.community || f.snmp_community,
          snmp_version:   x.snmp_version != null ? x.snmp_version : f.snmp_version,
          ups_type: x.ups_type || f.ups_type,
          fases:    x.fases    || f.fases,
        }));
        setScan(x);
      } else {
        setScan(r.resultado || null);
        setErr(r.mensaje || 'Sin respuesta del dispositivo');
      }
    } catch (e) {
      setErr(e.message);
    } finally {
      setScanning(false);
    }
  };

  const save = async () => {
    setErr(null); setBusy(true);
    try {
      const payload = { ...form };
      if (payload.sitio_id === '' || payload.sitio_id == null) delete payload.sitio_id;
      else payload.sitio_id = Number(payload.sitio_id);
      ['snmp_port','snmp_version','modbus_port','modbus_unit_id','fases'].forEach(k => {
        if (payload[k] != null && payload[k] !== '') payload[k] = Number(payload[k]);
      });
      await window.LBS_API.addDevice(payload);
      onSaved && onSaved();
    } catch (e) {
      setErr((e.data && e.data.error) || e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell
      title="Nuevo dispositivo UPS"
      onClose={onClose}
      footer={
        <>
          {err && <span className="lbs-modal-err"><i className="bi bi-exclamation-triangle"></i> {err}</span>}
          <button className="btn ghost" onClick={onClose} disabled={busy}>Cancelar</button>
          <button className="btn" onClick={save} disabled={busy || !form.ip || !form.nombre}>
            {busy ? 'Guardando…' : 'Crear UPS'}
          </button>
        </>
      }
    >
      <div className="lbs-grid-2">
        <Field label="Nombre" hint="Visible en flota y SCADA">
          <input value={form.nombre} onChange={e => upd('nombre', e.target.value)} placeholder="UPS-NORTE-01" />
        </Field>
        <Field label="Dirección IP" hint="ZeroTier o LAN">
          <div style={{ display: 'flex', gap: 8 }}>
            <input value={form.ip} onChange={e => upd('ip', e.target.value)} placeholder="10.216.124.10" style={{ flex: 1 }} />
            <button className="btn ghost" onClick={autoset} disabled={scanning || !form.ip}>
              {scanning ? '…' : <><i className="bi bi-magic"></i> Auto-detectar</>}
            </button>
          </div>
        </Field>

        <Field label="Protocolo">
          <select value={form.protocolo} onChange={e => upd('protocolo', e.target.value)}>
            <option value="snmp">SNMP</option>
            <option value="modbus">Modbus TCP</option>
          </select>
        </Field>
        <Field label="Sitio">
          <select value={form.sitio_id || ''} onChange={e => upd('sitio_id', e.target.value)}>
            <option value="">— sin asignar —</option>
            {(sitios || []).map(s => <option key={s._raw_id || s.id} value={s._raw_id || s.id}>{s.name || s.nombre}</option>)}
          </select>
        </Field>

        {form.protocolo === 'snmp' && <>
          <Field label="Puerto SNMP"><input type="number" value={form.snmp_port} onChange={e => upd('snmp_port', e.target.value)} /></Field>
          <Field label="Community"><input value={form.snmp_community} onChange={e => upd('snmp_community', e.target.value)} /></Field>
          <Field label="Versión SNMP">
            <select value={form.snmp_version} onChange={e => upd('snmp_version', e.target.value)}>
              <option value={0}>SNMPv1</option>
              <option value={1}>SNMPv2c</option>
            </select>
          </Field>
          <Field label="Tipo UPS">
            <select value={form.ups_type} onChange={e => upd('ups_type', e.target.value)}>
              <option value="invt_enterprise">INVT Enterprise (.56788)</option>
              <option value="invt_minimal">INVT Minimal</option>
              <option value="megatec_snmp">Megatec / Voltronic (.935)</option>
              <option value="ups_mib_standard">UPS-MIB estándar (RFC 1628)</option>
              <option value="hybrid">Híbrido (MIB + INVT)</option>
            </select>
          </Field>
        </>}

        {form.protocolo === 'modbus' && <>
          <Field label="Puerto Modbus"><input type="number" value={form.modbus_port} onChange={e => upd('modbus_port', e.target.value)} /></Field>
          <Field label="Unit ID"><input type="number" value={form.modbus_unit_id} onChange={e => upd('modbus_unit_id', e.target.value)} /></Field>
        </>}

        <Field label="Fases">
          <select value={form.fases} onChange={e => upd('fases', e.target.value)}>
            <option value={1}>Monofásico</option>
            <option value={3}>Trifásico</option>
          </select>
        </Field>
      </div>

      {scan && (
        <div className="lbs-scan-result">
          <h4>Resultado del escaneo</h4>
          <div><b>Ping:</b> {scan.ping ? '✅' : '❌'} · <b>Protocolo:</b> {scan.protocolo} · <b>Modelo:</b> {scan.modelo || '—'}</div>
          {scan.voltaje_actual != null && <div><b>Voltaje actual:</b> {scan.voltaje_actual} V</div>}
          {scan.bateria_actual != null && <div><b>Batería:</b> {scan.bateria_actual} %</div>}
        </div>
      )}
    </ModalShell>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Modal: nuevo sitio
// ──────────────────────────────────────────────────────────────────────
function AddSiteModal({ onClose, onSaved }) {
  const [busy, setBusy] = useStateM(false);
  const [err,  setErr]  = useStateM(null);
  const [form, setForm] = useStateM({
    numero_sitio: '', nombre: '',
    subred_lan: '', router_ip_lan: '', router_ip_zt: '',
    router_node_id: '', router_firmware: '', notas: '',
  });
  const upd = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const save = async () => {
    setErr(null); setBusy(true);
    try {
      const payload = { ...form, numero_sitio: Number(form.numero_sitio) };
      await window.LBS_API.addSitio(payload);
      onSaved && onSaved();
    } catch (e) {
      setErr((e.data && e.data.error) || e.message);
    } finally { setBusy(false); }
  };

  return (
    <ModalShell
      title="Nuevo sitio"
      onClose={onClose}
      footer={
        <>
          {err && <span className="lbs-modal-err"><i className="bi bi-exclamation-triangle"></i> {err}</span>}
          <button className="btn ghost" onClick={onClose} disabled={busy}>Cancelar</button>
          <button className="btn" onClick={save} disabled={busy || !form.nombre || !form.numero_sitio}>
            {busy ? 'Guardando…' : 'Crear sitio'}
          </button>
        </>
      }
    >
      <div className="lbs-grid-2">
        <Field label="# de sitio" hint="entero único"><input type="number" value={form.numero_sitio} onChange={e => upd('numero_sitio', e.target.value)} placeholder="99" /></Field>
        <Field label="Nombre"><input value={form.nombre} onChange={e => upd('nombre', e.target.value)} placeholder="CDMX · Vallejo" /></Field>
        <Field label="Subred LAN"><input value={form.subred_lan} onChange={e => upd('subred_lan', e.target.value)} placeholder="192.168.99.0/24" /></Field>
        <Field label="Router IP LAN"><input value={form.router_ip_lan} onChange={e => upd('router_ip_lan', e.target.value)} placeholder="192.168.99.1" /></Field>
        <Field label="Router IP ZeroTier"><input value={form.router_ip_zt} onChange={e => upd('router_ip_zt', e.target.value)} placeholder="10.216.124.99" /></Field>
        <Field label="Node ID router"><input value={form.router_node_id} onChange={e => upd('router_node_id', e.target.value)} /></Field>
        <Field label="Firmware router"><input value={form.router_firmware} onChange={e => upd('router_firmware', e.target.value)} /></Field>
        <Field label="Notas"><input value={form.notas} onChange={e => upd('notas', e.target.value)} /></Field>
      </div>
    </ModalShell>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Modal: cambiar contraseña
// ──────────────────────────────────────────────────────────────────────
function ChangePasswordModal({ onClose, onSaved }) {
  const [busy, setBusy] = useStateM(false);
  const [err,  setErr]  = useStateM(null);
  const [oldp, setOld]  = useStateM('');
  const [newp, setNew]  = useStateM('');
  const [conf, setConf] = useStateM('');

  const save = async () => {
    if (newp !== conf) { setErr('Las contraseñas nuevas no coinciden'); return; }
    if (newp.length < 8) { setErr('La nueva contraseña debe tener al menos 8 caracteres'); return; }
    setErr(null); setBusy(true);
    try {
      await window.LBS_API.changePassword(oldp, newp);
      onSaved && onSaved();
    } catch (e) {
      setErr((e.data && e.data.error) || e.message);
    } finally { setBusy(false); }
  };

  return (
    <ModalShell
      title="Cambiar contraseña"
      onClose={onClose}
      footer={
        <>
          {err && <span className="lbs-modal-err"><i className="bi bi-exclamation-triangle"></i> {err}</span>}
          <button className="btn ghost" onClick={onClose} disabled={busy}>Cancelar</button>
          <button className="btn" onClick={save} disabled={busy || !oldp || !newp || !conf}>
            {busy ? 'Guardando…' : 'Actualizar'}
          </button>
        </>
      }
    >
      <Field label="Contraseña actual"><input type="password" value={oldp} onChange={e => setOld(e.target.value)} /></Field>
      <Field label="Nueva contraseña" hint="Mínimo 8 caracteres"><input type="password" value={newp} onChange={e => setNew(e.target.value)} /></Field>
      <Field label="Confirmar nueva"><input type="password" value={conf} onChange={e => setConf(e.target.value)} /></Field>
    </ModalShell>
  );
}

window.AddDeviceModal     = AddDeviceModal;
window.AddSiteModal       = AddSiteModal;
window.ChangePasswordModal = ChangePasswordModal;


// ──────────────────────────────────────────────────────────────────────
// LBS_CONFIRM — reemplazo de window.confirm() con UI consistente.
//
// Uso:
//   const ok = await LBS_CONFIRM({
//     title: 'Eliminar UPS',
//     message: '¿Eliminar UPS-NORTE-01 de la flota?',
//     confirmText: 'Eliminar',
//     danger: true,            // botón rojo
//   });
//   if (!ok) return;
// ──────────────────────────────────────────────────────────────────────
(function () {
  'use strict';
  if (window.LBS_CONFIRM) return;

  function ConfirmDialog({ opts, onClose, onResolve }) {
    const ref = useEffectM.current ? null : null; // dummy to keep import
    useEffectM(() => {
      const onKey = (e) => {
        if (e.key === 'Escape') { onResolve(false); onClose(); }
        if (e.key === 'Enter')  { onResolve(true);  onClose(); }
      };
      document.addEventListener('keydown', onKey);
      return () => document.removeEventListener('keydown', onKey);
    }, []);
    return (
      <div className="lbs-modal-backdrop" onClick={() => { onResolve(false); onClose(); }}>
        <div className="lbs-modal lbs-confirm" onClick={e => e.stopPropagation()} style={{ maxWidth: 460 }}>
          <div className="lbs-modal-head">
            <h3>
              <i className={"bi " + (opts.danger ? 'bi-exclamation-triangle-fill' : 'bi-question-circle-fill')}
                 style={{ marginRight: 8, color: opts.danger ? '#ff6c6c' : 'var(--accent)' }}></i>
              {opts.title || 'Confirmar'}
            </h3>
            <button className="lbs-modal-x" onClick={() => { onResolve(false); onClose(); }}>
              <i className="bi bi-x-lg"></i>
            </button>
          </div>
          <div className="lbs-modal-body" style={{ fontSize: 13, lineHeight: 1.55 }}>
            {opts.message}
            {opts.hint && <div className="dim" style={{ marginTop: 10, fontSize: 11.5 }}>{opts.hint}</div>}
          </div>
          <div className="lbs-modal-foot">
            <button className="btn ghost" onClick={() => { onResolve(false); onClose(); }} autoFocus={!opts.danger}>
              {opts.cancelText || 'Cancelar'}
            </button>
            <button
              className={"btn " + (opts.danger ? 'btn-danger' : '')}
              onClick={() => { onResolve(true); onClose(); }}
              autoFocus={!!opts.danger}
            >
              {opts.confirmText || 'Aceptar'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  window.LBS_CONFIRM = function (opts) {
    opts = opts || {};
    return new Promise((resolve) => {
      const root = document.createElement('div');
      document.body.appendChild(root);
      let resolved = false;
      const dispose = () => { try { ReactDOM.createRoot; root.remove(); } catch (_) {} };
      const onResolve = (v) => { if (!resolved) { resolved = true; resolve(v); } };

      // Render con createRoot
      const r = ReactDOM.createRoot(root);
      const close = () => { r.unmount(); dispose(); };
      r.render(<ConfirmDialog opts={opts} onClose={close} onResolve={onResolve} />);
    });
  };
})();
