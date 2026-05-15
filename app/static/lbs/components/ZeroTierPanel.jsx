// ZeroTierPanel.jsx — Panel operativo de ZeroTier dentro del Diagnóstico.
//
// Se monta cuando el usuario elige una herramienta de la categoría ZEROTIER
// en DiagnosticoApp. Mantiene su propio estado (networks, peers, status,
// resultados de scan) y comparte el render del terminal/resultados con el
// resto del diagnóstico vía props.

const { useState: useStateZ, useEffect: useEffectZ, useMemo: useMemoZ } = React;

function ZeroTierPanel({ subtool, vals, setVals, run, lastResp, sitios = [] }) {
  // subtool: 'status' | 'networks' | 'join' | 'peers' | 'scan' | 'find-teltonika' | 'scan-site'
  const [health, setHealth] = useStateZ(null);
  const [auto, setAuto]     = useStateZ(null);

  useEffectZ(() => {
    let alive = true;
    window.LBS_API.ztHealth().then(r => alive && setHealth(r)).catch(() => alive && setHealth({ available: false }));
    return () => { alive = false; };
  }, []);

  // No bloquear el render si ZT no está disponible: mostramos un banner.
  const unavailable = health && health.available === false;

  return (
    <div className="zt-panel">
      {unavailable && (
        <div className="zt-banner">
          <i className="bi bi-exclamation-triangle"></i>
          <div>
            <b>ZeroTier no está disponible</b>
            <div className="dim">
              Verifica que <code>zerotier-one</code> corra en el host y que el authtoken
              esté en <code>/etc/lbs/zerotier-token</code>. Corre&nbsp;
              <code>sudo ./scripts/setup_zerotier.sh</code> en el host.
            </div>
          </div>
        </div>
      )}

      {/* ── Subtool: estado del nodo ── */}
      {subtool === 'status' && lastResp && lastResp.status && (
        <div className="diag-result-block">
          <h4>NODO ZEROTIER LOCAL</h4>
          <div className="diag-kv-grid">
            <div><span>Node ID</span><b className="cyan">{lastResp.status.address}</b></div>
            <div><span>Versión</span><b>{lastResp.status.version}</b></div>
            <div><span>Online</span><b className={lastResp.status.online ? 'ok-text' : 'err-text'}>{lastResp.status.online ? 'SÍ' : 'NO'}</b></div>
            <div><span>Planet ID</span><b className="mono">{lastResp.status.planet_id}</b></div>
            <div><span>TCP fallback</span><b>{lastResp.status.tcp_fallback ? 'sí' : 'no'}</b></div>
            <div><span>World revision</span><b>{lastResp.status.world_revision}</b></div>
          </div>
        </div>
      )}

      {/* ── Subtool: lista de networks ── */}
      {subtool === 'networks' && lastResp && lastResp.networks && (
        <div className="diag-result-block">
          <h4>NETWORKS UNIDAS · {lastResp.networks.length}</h4>
          {lastResp.networks.length === 0 ? (
            <div className="dim">Aún no estás unido a ninguna network. Usa "Unirse a network" abajo.</div>
          ) : (
            <table className="diag-table">
              <thead><tr>
                <th>ID</th><th>Nombre</th><th>Estado</th><th>IPs asignadas</th><th>Rutas</th><th></th>
              </tr></thead>
              <tbody>
                {lastResp.networks.map(n => (
                  <tr key={n.id}>
                    <td className="mono cyan">{n.id}</td>
                    <td>{n.name}</td>
                    <td>
                      <span className={"diag-pill " + (n.status === 'OK' ? 'ok' : 'warn')}>{n.status}</span>
                    </td>
                    <td className="mono">{(n.assigned_addresses || []).join(', ') || '—'}</td>
                    <td className="mono dim" style={{maxWidth:240,wordBreak:'break-all'}}>
                      {(n.routes || []).map(r => r.target).join(', ') || '—'}
                    </td>
                    <td>
                      <button className="btn ghost zt-btn-sm" onClick={async () => {
                        const ok = await window.LBS_CONFIRM({
                          title: 'Salir de network ZeroTier',
                          message: `¿Salir de la network ${n.id}?`,
                          hint: 'Perderás acceso a los hosts en esta red overlay hasta que vuelvas a unirte.',
                          confirmText: 'Salir', danger: true,
                        });
                        if (!ok) return;
                        try {
                          await window.LBS_API.ztLeave(n.id);
                          window.LBS_TOAST && window.LBS_TOAST.success('Has salido de la network');
                          run();
                        } catch (e) {
                          window.LBS_TOAST && window.LBS_TOAST.error(e.message);
                        }
                      }}>
                        <i className="bi bi-box-arrow-left"></i> Salir
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── Subtool: join ── */}
      {subtool === 'join' && lastResp && (
        <div className="diag-result-block">
          <h4>RESULTADO DEL JOIN</h4>
          {lastResp.success ? (
            <>
              <div className="ok-text" style={{marginBottom:10}}>
                <i className="bi bi-check2-circle"></i> Solicitud enviada.
              </div>
              <div className="dim" style={{fontSize:12,lineHeight:1.6}}>
                Si tu nodo no aparece autorizado todavía, abre&nbsp;
                <a href={"https://my.zerotier.com/network/" + (vals.network_id || '')}
                   target="_blank" rel="noopener" style={{color:'var(--accent)'}}>
                  my.zerotier.com/network/{vals.network_id}
                </a> y marca el check de autorización del nodo.
              </div>
            </>
          ) : (
            <div className="err-text">{lastResp.error}</div>
          )}
        </div>
      )}

      {/* ── Subtool: peers ── */}
      {subtool === 'peers' && lastResp && lastResp.peers && (
        <div className="diag-result-block">
          <h4>PEERS · {lastResp.peers.length}</h4>
          <table className="diag-table">
            <thead><tr>
              <th>Address</th><th>Rol</th><th>Versión</th>
              <th>Latencia</th><th>Dirección activa</th>
            </tr></thead>
            <tbody>
              {lastResp.peers.map(p => (
                <tr key={p.address}>
                  <td className="mono cyan">{p.address}</td>
                  <td className="dim">{p.role}</td>
                  <td className="mono">{p.version}</td>
                  <td className="mono">{p.latency != null ? `${p.latency} ms` : '—'}</td>
                  <td className="mono dim" style={{maxWidth:200,wordBreak:'break-all'}}>
                    {p.active_addr || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Subtool: scan network ── */}
      {subtool === 'scan' && lastResp && lastResp.hosts && (
        <div className="diag-result-block">
          <h4>HOSTS EN {(lastResp.subnets || []).join(', ')} · {lastResp.total}</h4>
          <table className="diag-table">
            <thead><tr><th>IP</th><th>Subnet</th><th>SysDescr</th><th>Tipo</th></tr></thead>
            <tbody>
              {lastResp.hosts.map(h => (
                <tr key={h.ip}>
                  <td className="mono cyan">{h.ip}</td>
                  <td className="mono dim">{h.subnet}</td>
                  <td className="mono" style={{maxWidth:380,wordBreak:'break-word'}}>{h.sysdescr || <span className="dim">— sin SNMP —</span>}</td>
                  <td>{h.is_teltonika ? <span className="diag-pill ok">TELTONIKA</span> : (h.sysdescr ? <span className="diag-pill warn">SNMP</span> : <span className="dim">ICMP</span>)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Subtool: detectar Teltonika ── */}
      {subtool === 'find-teltonika' && lastResp && lastResp.teltonikas && (
        <div className="diag-result-block">
          <h4>TELTONIKAS DETECTADOS · {lastResp.count}</h4>
          {lastResp.teltonikas.length === 0 ? (
            <div className="dim">No se encontraron routers Teltonika en la subred {(lastResp.subnets || []).join(', ')}.</div>
          ) : (
            <table className="diag-table">
              <thead><tr><th>IP ZeroTier</th><th>Modelo</th></tr></thead>
              <tbody>
                {lastResp.teltonikas.map(t => (
                  <tr key={t.ip}>
                    <td className="mono cyan">{t.ip}</td>
                    <td className="mono" style={{maxWidth:520,wordBreak:'break-word'}}>{t.sysdescr}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── Subtool: escanear LAN del sitio ── */}
      {subtool === 'scan-site' && lastResp && lastResp.hosts && (
        <div className="diag-result-block">
          <h4>LAN DEL SITIO &laquo;{lastResp.sitio && lastResp.sitio.nombre}&raquo; · {lastResp.subnet}</h4>
          <table className="diag-table">
            <thead><tr><th>IP</th><th>SysDescr</th><th>Registrado</th><th>Acciones</th></tr></thead>
            <tbody>
              {lastResp.hosts.map(h => (
                <tr key={h.ip}>
                  <td className="mono cyan">{h.ip}</td>
                  <td className="mono" style={{maxWidth:380,wordBreak:'break-word'}}>{h.sysdescr || <span className="dim">— sin SNMP —</span>}</td>
                  <td>
                    {h.registered
                      ? <span className="diag-pill ok">{h.device_name}</span>
                      : <span className="diag-pill warn">NUEVO</span>}
                  </td>
                  <td>
                    {!h.registered && (
                      <button className="btn ghost zt-btn-sm" onClick={() => {
                        window.dispatchEvent(new CustomEvent('lbs:import-device', {
                          detail: {
                            ip: h.ip,
                            sitio_id: lastResp.sitio.id,
                            sysdescr: h.sysdescr,
                          },
                        }));
                      }}>
                        <i className="bi bi-plus-circle"></i> Importar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {lastResp.unregistered && lastResp.unregistered.length > 0 && (
            <div className="dim" style={{marginTop:10,fontSize:12}}>
              {lastResp.unregistered.length} dispositivo(s) nuevo(s) pendiente(s) de importar.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

window.ZeroTierPanel = ZeroTierPanel;
