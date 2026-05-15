// ZTWizard.jsx — Wizard guiado para bootstrap de un sitio nuevo vía ZeroTier.
//
// Pasos:
//   1. Verificar disponibilidad del daemon ZeroTier
//   2. Pedir network_id + datos del sitio (numero_sitio, nombre, subred_lan, ...)
//   3. Llamar /api/zerotier/bootstrap-site (que hace join + create-site +
//      detect-teltonika + scan-lan)
//   4. Mostrar Teltonikas + UPS candidatos; permitir importar a la flota

const { useState: useStateW, useEffect: useEffectW } = React;

function ZTWizard({ onClose, onFinished }) {
  const [step,   setStep]   = useStateW(1);
  const [health, setHealth] = useStateW(null);
  const [busy,   setBusy]   = useStateW(false);
  const [err,    setErr]    = useStateW(null);
  const [result, setResult] = useStateW(null);
  const [importing, setImporting] = useStateW({}); // ip → loading

  const [form, setForm] = useStateW({
    network_id:   '',
    numero_sitio: '',
    nombre:       '',
    subred_lan:   '',
    router_ip_lan:'',
    router_ip_zt: '',
    notas:        '',
    community:    'public',
  });
  const upd = (k, v) => setForm(f => ({ ...f, [k]: v }));

  // Paso 1: chequear daemon
  useEffectW(() => {
    if (step !== 1) return;
    let alive = true;
    setBusy(true);
    window.LBS_API.ztHealth().then(r => {
      if (!alive) return;
      setHealth(r);
      setBusy(false);
      // auto-avanza si OK
      if (r && r.available) setStep(2);
    }).catch(e => {
      if (!alive) return;
      setHealth({ available: false });
      setBusy(false);
    });
    return () => { alive = false; };
  }, [step]);

  const goNext = () => setStep(s => s + 1);
  const goBack = () => setStep(s => Math.max(1, s - 1));

  const runBootstrap = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await window.LBS_API.ztBootstrap(form);
      setResult(r);
      setStep(4);
    } catch (e) {
      setErr((e.data && e.data.error) || e.message);
    } finally { setBusy(false); }
  };

  const importDevice = async (host) => {
    setImporting(prev => ({ ...prev, [host.ip]: true }));
    try {
      const guessType = (s) => {
        const x = String(s || '').toLowerCase();
        if (x.includes('megatec') || x.includes('voltronic')) return 'megatec_snmp';
        if (x.includes('invt'))    return 'invt_enterprise';
        if (x.includes('rfc 1628')) return 'ups_mib_standard';
        return 'invt_enterprise';
      };
      await window.LBS_API.addDevice({
        nombre: `UPS-${result.sitio.numero_sitio}-${host.ip.split('.').pop()}`,
        ip: host.ip,
        protocolo: 'snmp',
        snmp_port: 161,
        snmp_community: form.community,
        snmp_version: 1,
        ups_type: guessType(host.sysdescr),
        fases: 1,
        sitio_id: result.sitio.id,
      });
      window.LBS_TOAST && window.LBS_TOAST.success(`${host.ip} importado a la flota`);
      // remover de la lista localmente
      setResult(prev => ({
        ...prev,
        candidates: prev.candidates.filter(c => c.ip !== host.ip),
        hosts:      prev.hosts.map(h => h.ip === host.ip ? { ...h, registered: true } : h),
      }));
    } catch (e) {
      window.LBS_TOAST && window.LBS_TOAST.error(`${host.ip}: ${e.message}`);
    } finally {
      setImporting(prev => ({ ...prev, [host.ip]: false }));
    }
  };

  const close = () => {
    if (window.LBS_DATA && window.LBS_DATA.refresh) window.LBS_DATA.refresh();
    onFinished && onFinished();
    onClose();
  };

  return (
    <div className="lbs-modal-backdrop" onClick={onClose}>
      <div className="lbs-modal lbs-modal-wide" onClick={e => e.stopPropagation()}>
        <div className="lbs-modal-head">
          <h3><i className="bi bi-magic"></i> Bootstrap de sitio nuevo · paso {step}/4</h3>
          <button className="lbs-modal-x" onClick={onClose}><i className="bi bi-x-lg"></i></button>
        </div>

        {/* Stepper */}
        <div className="zt-stepper">
          <div className={"zt-step " + (step >= 1 ? 'done' : '')}>1 · Daemon</div>
          <div className={"zt-step " + (step >= 2 ? 'done' : '')}>2 · Datos</div>
          <div className={"zt-step " + (step >= 3 ? 'done' : '')}>3 · Bootstrap</div>
          <div className={"zt-step " + (step >= 4 ? 'done' : '')}>4 · Importar UPS</div>
        </div>

        <div className="lbs-modal-body">

          {/* Paso 1 */}
          {step === 1 && (
            <div>
              <h4>Verificando demonio ZeroTier…</h4>
              {busy && <div className="dim">Conectando a la API local…</div>}
              {!busy && health && health.available && (
                <div className="zt-banner" style={{borderColor:'rgba(78,224,138,0.4)',background:'rgba(78,224,138,0.08)'}}>
                  <i className="bi bi-check-circle-fill" style={{color:'#4ee08a'}}></i>
                  <div><b>Demonio disponible</b><div className="dim">Listo para continuar.</div></div>
                </div>
              )}
              {!busy && health && !health.available && (
                <div className="zt-banner">
                  <i className="bi bi-exclamation-triangle"></i>
                  <div>
                    <b>ZeroTier no está disponible</b>
                    <div className="dim">
                      Verifica que <code>zerotier-one</code> corra en el host y que el authtoken esté en
                      <code>/etc/lbs/zerotier-token</code>. Corre&nbsp;
                      <code>sudo ./scripts/setup_zerotier.sh</code> en el host.
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Paso 2 — datos */}
          {step === 2 && (
            <div>
              <h4>Datos del sitio + ZeroTier</h4>
              <div className="dim" style={{marginBottom:10}}>
                Vamos a unirnos a la network, registrar el sitio en la BD y escanear su LAN.
              </div>
              <div className="lbs-grid-2">
                <label className="lbs-field">
                  <span className="lbs-field-label">Network ID ZeroTier (16 hex)</span>
                  <input className="mono" value={form.network_id} onChange={e => upd('network_id', e.target.value)} placeholder="8056c2e21c000001" />
                </label>
                <label className="lbs-field">
                  <span className="lbs-field-label">SNMP community</span>
                  <input value={form.community} onChange={e => upd('community', e.target.value)} placeholder="public" />
                </label>
                <label className="lbs-field">
                  <span className="lbs-field-label"># de sitio</span>
                  <input type="number" value={form.numero_sitio} onChange={e => upd('numero_sitio', e.target.value)} placeholder="99" />
                </label>
                <label className="lbs-field">
                  <span className="lbs-field-label">Nombre del sitio</span>
                  <input value={form.nombre} onChange={e => upd('nombre', e.target.value)} placeholder="CDMX · Vallejo" />
                </label>
                <label className="lbs-field">
                  <span className="lbs-field-label">Subred LAN (CIDR /24)</span>
                  <input className="mono" value={form.subred_lan} onChange={e => upd('subred_lan', e.target.value)} placeholder="192.168.99.0/24" />
                </label>
                <label className="lbs-field">
                  <span className="lbs-field-label">Router LAN (opcional)</span>
                  <input className="mono" value={form.router_ip_lan} onChange={e => upd('router_ip_lan', e.target.value)} placeholder="192.168.99.1" />
                </label>
                <label className="lbs-field">
                  <span className="lbs-field-label">Router ZT (opcional)</span>
                  <input className="mono" value={form.router_ip_zt} onChange={e => upd('router_ip_zt', e.target.value)} placeholder="10.216.124.99" />
                </label>
                <label className="lbs-field">
                  <span className="lbs-field-label">Notas (opcional)</span>
                  <input value={form.notas} onChange={e => upd('notas', e.target.value)} placeholder="oficina cliente XYZ" />
                </label>
              </div>
            </div>
          )}

          {/* Paso 3 — ejecutar */}
          {step === 3 && (
            <div>
              <h4>Listo para ejecutar</h4>
              <div className="dim" style={{marginBottom:12}}>El portal va a:</div>
              <ol style={{marginLeft:18,lineHeight:1.8,fontSize:13}}>
                <li>Unir el host a la network <b className="mono">{form.network_id || '???'}</b></li>
                <li>Crear el sitio "<b>{form.nombre}</b>" (#{form.numero_sitio}) con subred <b className="mono">{form.subred_lan}</b></li>
                <li>Detectar routers Teltonika en la red ZT</li>
                <li>Escanear la LAN <b className="mono">{form.subred_lan}</b> en busca de UPS</li>
              </ol>
              {err && <div className="zt-banner" style={{marginTop:14}}>
                <i className="bi bi-x-circle"></i>
                <div><b>Error</b><div className="dim">{err}</div></div>
              </div>}
              <div className="dim" style={{marginTop:14,fontSize:11}}>
                <i className="bi bi-info-circle"></i>&nbsp;
                Después del join, recuerda autorizar este nodo en
                <a href="https://my.zerotier.com" target="_blank" rel="noopener" style={{color:'var(--accent)',marginLeft:4}}>my.zerotier.com</a>.
              </div>
            </div>
          )}

          {/* Paso 4 — resultado + import */}
          {step === 4 && result && (
            <div>
              <h4>Resultado del bootstrap</h4>
              <div className="zt-steps">
                {(result.steps || []).map((s, i) => (
                  <div key={i} className={"zt-step-row " + (s.ok ? 'ok' : 'err')}>
                    <i className={"bi " + (s.ok ? 'bi-check-circle-fill' : 'bi-x-circle-fill')}></i>
                    <b>{s.step}</b>
                    <span className="dim">{s.msg}</span>
                  </div>
                ))}
              </div>

              {result.teltonikas && result.teltonikas.length > 0 && (
                <div style={{marginTop:14}}>
                  <h5 style={{fontSize:11,letterSpacing:'0.16em',color:'var(--accent)',marginBottom:6,textTransform:'uppercase'}}>
                    Teltonika(s) detectado(s) · {result.teltonikas.length}
                  </h5>
                  <table className="diag-table">
                    <tbody>
                      {result.teltonikas.map(t => (
                        <tr key={t.ip}>
                          <td className="mono cyan">{t.ip}</td>
                          <td className="mono" style={{maxWidth:480,wordBreak:'break-word'}}>{t.sysdescr}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {result.candidates && result.candidates.length > 0 ? (
                <div style={{marginTop:14}}>
                  <h5 style={{fontSize:11,letterSpacing:'0.16em',color:'var(--accent)',marginBottom:6,textTransform:'uppercase'}}>
                    UPS candidatos para importar · {result.candidates.length}
                  </h5>
                  <table className="diag-table">
                    <thead><tr><th>IP</th><th>SysDescr</th><th style={{width:130}}></th></tr></thead>
                    <tbody>
                      {result.candidates.map(h => (
                        <tr key={h.ip}>
                          <td className="mono cyan">{h.ip}</td>
                          <td className="mono" style={{maxWidth:380,wordBreak:'break-word'}}>{h.sysdescr || <span className="dim">— sin SNMP —</span>}</td>
                          <td>
                            <button className="btn ghost zt-btn-sm" onClick={() => importDevice(h)} disabled={importing[h.ip]}>
                              {importing[h.ip]
                                ? <><i className="bi bi-arrow-repeat spin"></i> Importando…</>
                                : <><i className="bi bi-plus-circle"></i> Importar</>}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="dim" style={{marginTop:14,fontSize:12}}>
                  Sin candidatos nuevos para importar (ya están todos registrados o no hubo respuesta).
                </div>
              )}
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="lbs-modal-foot">
          {err && step !== 3 && <span className="lbs-modal-err"><i className="bi bi-exclamation-triangle"></i> {err}</span>}
          {step > 1 && step < 4 && <button className="btn ghost" onClick={goBack} disabled={busy}>Atrás</button>}
          {step === 1 && health && !health.available && (
            <button className="btn ghost" onClick={onClose}>Cerrar</button>
          )}
          {step === 2 && (
            <button className="btn" onClick={goNext}
              disabled={!form.network_id || !form.numero_sitio || !form.nombre || !form.subred_lan}>
              Siguiente <i className="bi bi-arrow-right"></i>
            </button>
          )}
          {step === 3 && (
            <button className="btn" onClick={runBootstrap} disabled={busy}>
              {busy ? <><i className="bi bi-arrow-repeat spin"></i> Ejecutando…</> : <><i className="bi bi-rocket"></i> Ejecutar bootstrap</>}
            </button>
          )}
          {step === 4 && <button className="btn" onClick={close}>Finalizar</button>}
        </div>
      </div>
    </div>
  );
}

window.ZTWizard = ZTWizard;
