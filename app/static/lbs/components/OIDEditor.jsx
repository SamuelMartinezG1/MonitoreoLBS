// OIDEditor.jsx — Modal "Banco SNMP" para editar el perfil OID de un UPS.
//
// Flujo:
//   1. Selecciona un device (o lo recibe por prop).
//   2. Ejecuta SNMP walk a una rama OID.
//   3. Resultados del walk son agregables a la tabla de mapeo.
//   4. Cada fila de mapeo tiene: variable_name (select de standards o custom),
//      oid, factor, unit, description.
//   5. Botón "Probar" prueba un mapeo individual (snmp-get + factor).
//   6. Guardar persiste el perfil (sobreescribe).

const { useState: useStateO, useEffect: useEffectO, useMemo: useMemoO } = React;

const STANDARD_VARS = [
  'voltaje_in_l1', 'voltaje_in_l2', 'voltaje_in_l3',
  'voltaje_out_l1', 'voltaje_out_l2', 'voltaje_out_l3',
  'frecuencia_in', 'frecuencia_out',
  'corriente_out_l1', 'corriente_out_l2', 'corriente_out_l3',
  'carga_pct', 'bateria_pct', 'voltaje_bateria', 'temperatura',
];

const POPULAR_OIDS = [
  { label: 'UPS-MIB (RFC 1628)',     value: '1.3.6.1.2.1.33' },
  { label: 'Megatec / Voltronic',    value: '1.3.6.1.4.1.935.1.1.1' },
  { label: 'INVT Enterprise',        value: '1.3.6.1.4.1.56788' },
  { label: 'MIB-II (system)',        value: '1.3.6.1.2.1.1' },
];

function OIDEditor({ device, onClose, onSaved }) {
  const [busy,  setBusy]  = useStateO(false);
  const [err,   setErr]   = useStateO(null);

  // Walk
  const [walkRoot, setWalkRoot] = useStateO('1.3.6.1.2.1.33');
  const [walkBusy, setWalkBusy] = useStateO(false);
  const [walkRes,  setWalkRes]  = useStateO([]);

  // Mappings (perfil)
  const [mappings, setMappings] = useStateO([]);

  // Cargar perfil existente
  useEffectO(() => {
    let alive = true;
    window.LBS_API.getOidProfile(device.id).then(r => {
      if (!alive) return;
      const ms = (r && r.mappings) || [];
      setMappings(ms.map(m => ({
        variable_name: m.variable_name || '',
        oid:           m.oid           || '',
        factor:        m.factor != null ? m.factor : 1.0,
        unit:          m.unit          || '',
        description:   m.description   || '',
      })));
    }).catch(() => {});
    return () => { alive = false; };
  }, [device.id]);

  const runWalk = async () => {
    setWalkBusy(true); setErr(null);
    try {
      const r = await window.LBS_API.snmpWalk({
        ip: device.ip,
        oid: walkRoot,
        community: device.snmp_community || 'public',
        version: device.snmp_version != null ? device.snmp_version : 1,
      });
      if (r.success) setWalkRes(r.results || []);
      else { setErr(r.error || 'sin respuesta'); setWalkRes([]); }
    } catch (e) {
      setErr(e.message);
    } finally { setWalkBusy(false); }
  };

  const addMappingFromWalk = (oid, suggestedName) => {
    setMappings(prev => [
      ...prev,
      { variable_name: suggestedName || '', oid, factor: 1.0, unit: '', description: '' },
    ]);
  };

  const addEmpty = () => setMappings(prev => [...prev, {
    variable_name: '', oid: '', factor: 1.0, unit: '', description: '',
  }]);

  const updateMapping = (i, field, value) => {
    setMappings(prev => prev.map((m, idx) => idx === i ? { ...m, [field]: value } : m));
  };

  const removeMapping = (i) => setMappings(prev => prev.filter((_, idx) => idx !== i));

  const testMapping = async (i) => {
    const m = mappings[i];
    if (!m.oid) {
      window.LBS_TOAST && window.LBS_TOAST.warn('OID vacío');
      return;
    }
    try {
      const r = await window.LBS_API.snmpOidTest({
        ip: device.ip,
        oid: m.oid,
        community: device.snmp_community || 'public',
        version: device.snmp_version != null ? device.snmp_version : 1,
        factor: Number(m.factor) || 1.0,
      });
      if (r.success) {
        window.LBS_TOAST && window.LBS_TOAST.success(
          `${m.variable_name || m.oid}: ${r.converted_value} ${m.unit || ''} (raw ${r.raw_value})`
        );
      } else {
        window.LBS_TOAST && window.LBS_TOAST.error('Test falló: ' + (r.error || 'sin respuesta'));
      }
    } catch (e) {
      window.LBS_TOAST && window.LBS_TOAST.error(e.message);
    }
  };

  const save = async () => {
    setBusy(true); setErr(null);
    try {
      // Filtrar entradas sin variable_name o sin oid
      const valid = mappings.filter(m => m.variable_name && m.oid);
      await window.LBS_API.saveOidProfile({
        device_id: device.id,
        mappings:  valid.map(m => ({
          variable_name: m.variable_name,
          oid: m.oid,
          factor: Number(m.factor) || 1.0,
          unit: m.unit || '',
          description: m.description || '',
          data_type: 'Integer',
        })),
      });
      window.LBS_TOAST && window.LBS_TOAST.success('Perfil OID guardado · ' + valid.length + ' mapeos');
      onSaved && onSaved();
    } catch (e) {
      setErr((e.data && e.data.error) || e.message);
    } finally { setBusy(false); }
  };

  return (
    <div className="lbs-modal-backdrop" onClick={onClose}>
      <div className="lbs-modal lbs-modal-wide" onClick={e => e.stopPropagation()}>
        <div className="lbs-modal-head">
          <h3>Banco SNMP · {device.name || device.nombre} <small style={{color:'var(--text-dim)',fontSize:11,marginLeft:8}}>{device.ip}</small></h3>
          <button className="lbs-modal-x" onClick={onClose}><i className="bi bi-x-lg"></i></button>
        </div>

        <div className="lbs-modal-body">

          {/* SNMP Walk */}
          <div className="oid-section">
            <h4>1) SNMP Walk del dispositivo</h4>
            <div className="oid-walk-bar">
              <select value={walkRoot} onChange={e => setWalkRoot(e.target.value)}>
                {POPULAR_OIDS.map(o => <option key={o.value} value={o.value}>{o.label} ({o.value})</option>)}
              </select>
              <input value={walkRoot} onChange={e => setWalkRoot(e.target.value)} placeholder="1.3.6.1.2.1.33" />
              <button className="btn" onClick={runWalk} disabled={walkBusy}>
                {walkBusy ? 'Walking…' : <><i className="bi bi-list-ul"></i> Walk</>}
              </button>
            </div>
            {walkRes.length > 0 && (
              <div className="oid-walk-results">
                <div className="dim" style={{marginBottom:6,fontSize:11}}>{walkRes.length} OIDs encontrados · Click "+" para mapear</div>
                <table className="diag-table">
                  <thead><tr><th style={{width:'50%'}}>OID</th><th>Valor</th><th style={{width:60}}></th></tr></thead>
                  <tbody>
                    {walkRes.slice(0, 30).map((r, i) => (
                      <tr key={i}>
                        <td className="mono cyan">{r.oid}</td>
                        <td className="mono">{r.value}</td>
                        <td>
                          <button className="btn ghost zt-btn-sm" onClick={() => addMappingFromWalk(r.oid, '')} title="Agregar al perfil">
                            <i className="bi bi-plus-lg"></i>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Mappings table */}
          <div className="oid-section">
            <h4>2) Perfil OID actual ({mappings.length} mapeos)</h4>
            <table className="oid-table">
              <thead>
                <tr>
                  <th style={{width:160}}>Variable</th>
                  <th>OID</th>
                  <th style={{width:80}}>Factor</th>
                  <th style={{width:80}}>Unidad</th>
                  <th style={{width:120}}></th>
                </tr>
              </thead>
              <tbody>
                {mappings.length === 0 && (
                  <tr><td colSpan="5" style={{padding:24,textAlign:'center',color:'var(--text-dim)'}}>
                    Sin mapeos. Usa SNMP walk arriba o "Agregar fila" abajo.
                  </td></tr>
                )}
                {mappings.map((m, i) => (
                  <tr key={i}>
                    <td>
                      <select value={m.variable_name} onChange={e => updateMapping(i, 'variable_name', e.target.value)}>
                        <option value="">— elegir —</option>
                        {STANDARD_VARS.map(v => <option key={v} value={v}>{v}</option>)}
                        {m.variable_name && !STANDARD_VARS.includes(m.variable_name) && (
                          <option value={m.variable_name}>{m.variable_name}</option>
                        )}
                      </select>
                    </td>
                    <td>
                      <input className="mono" value={m.oid} onChange={e => updateMapping(i, 'oid', e.target.value)} placeholder="1.3.6.1..." />
                    </td>
                    <td>
                      <input type="number" step="0.001" value={m.factor} onChange={e => updateMapping(i, 'factor', e.target.value)} />
                    </td>
                    <td>
                      <input value={m.unit} onChange={e => updateMapping(i, 'unit', e.target.value)} placeholder="V / A / %" />
                    </td>
                    <td>
                      <button className="btn ghost zt-btn-sm" onClick={() => testMapping(i)} title="Probar"><i className="bi bi-bullseye"></i></button>
                      <button className="btn ghost zt-btn-sm" onClick={() => removeMapping(i)} title="Eliminar"><i className="bi bi-trash"></i></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button className="btn ghost" onClick={addEmpty} style={{marginTop:10}}>
              <i className="bi bi-plus-lg"></i> Agregar fila
            </button>
          </div>
        </div>

        <div className="lbs-modal-foot">
          {err && <span className="lbs-modal-err"><i className="bi bi-exclamation-triangle"></i> {err}</span>}
          <button className="btn ghost" onClick={onClose} disabled={busy}>Cancelar</button>
          <button className="btn" onClick={save} disabled={busy || mappings.filter(m => m.variable_name && m.oid).length === 0}>
            {busy ? 'Guardando…' : 'Guardar perfil'}
          </button>
        </div>
      </div>
    </div>
  );
}

window.OIDEditor = OIDEditor;
