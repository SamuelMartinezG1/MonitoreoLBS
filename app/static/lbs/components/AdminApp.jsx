// AdminApp.jsx — Pantalla de administración: gestión de usuarios + permisos.

const { useState: useStateA, useEffect: useEffectA, useMemo: useMemoA } = React;

function AdminApp() {
  const [t, setTweak] = useTweaks(window.TWEAK_DEFAULTS);
  const accent = t.accent || '#00b4ff';
  useEffectA(() => {
    document.documentElement.style.setProperty('--accent', accent);
    document.documentElement.style.setProperty('--accent-glow', accent + '55');
  }, [accent]);

  const [users,    setUsers]    = useStateA([]);
  const [sections, setSections] = useStateA([]);
  const [roles,    setRoles]    = useStateA(['admin', 'user']);
  const [loading,  setLoading]  = useStateA(true);
  const [editing,  setEditing]  = useStateA(null); // user para editar
  const [showNew,  setShowNew]  = useStateA(false);
  const [filter,   setFilter]   = useStateA('');

  const refresh = async () => {
    setLoading(true);
    try {
      const r = await window.LBS_API.usersList();
      setUsers(r.users || []);
      if (!sections.length) {
        const s = await window.LBS_API.usersSections();
        setSections(s.sections || []);
        setRoles(s.roles || ['admin', 'user']);
      }
    } catch (e) {
      window.LBS_TOAST && window.LBS_TOAST.error('Error cargando usuarios: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffectA(() => { refresh(); /* eslint-disable-next-line */ }, []);

  const filtered = useMemoA(() => {
    if (!filter) return users;
    const q = filter.toLowerCase();
    return users.filter(u => u.username.toLowerCase().includes(q) || u.role.toLowerCase().includes(q));
  }, [filter, users]);

  const deleteUser = async (u) => {
    const ok = await window.LBS_CONFIRM({
      title: 'Eliminar usuario',
      message: `¿Eliminar al usuario "${u.username}"?`,
      hint: 'Sus permisos también se borrarán (CASCADE). El usuario perderá acceso inmediatamente.',
      confirmText: 'Eliminar', danger: true,
    });
    if (!ok) return;
    try {
      await window.LBS_API.usersDelete(u.id);
      window.LBS_TOAST && window.LBS_TOAST.success(`Usuario ${u.username} eliminado`);
      refresh();
    } catch (e) {
      window.LBS_TOAST && window.LBS_TOAST.error('Error: ' + e.message);
    }
  };

  return (
    <div className="app-grid">
      <Header page="admin" crumbs={[{label: 'Administración'},{label: 'Usuarios', bold: true}]} deviceName="" />
      <Sidebar activeId="" onSelect={() => { window.location.href = (window.LBS_URLS && window.LBS_URLS.monitoreo) || 'monitoreo.html'; }} />

      <main className="app-main">
        <div className="page-grid">
          <section className="fleet-hero" style={{ gridTemplateColumns: '1.6fr repeat(3, 1fr)' }}>
            <div className="fh-title">
              <h1>Administración · Usuarios</h1>
              <div className="sub">{users.length} cuentas registradas · Solo administradores</div>
            </div>
            <div className="fh-stat">
              <label>Total</label>
              <div className="v">{users.length}</div>
            </div>
            <div className="fh-stat ok">
              <label>Admins</label>
              <div className="v">{users.filter(u => u.role === 'admin').length}</div>
            </div>
            <div className="fh-stat">
              <label>Secciones</label>
              <div className="v">{sections.length}</div>
            </div>
          </section>

          <div className="inv-toolbar">
            <div className="search-input">
              <i className="bi bi-search"></i>
              <input
                placeholder="Buscar por usuario o rol..."
                value={filter}
                onChange={e => setFilter(e.target.value)}
              />
            </div>
            <button className="btn" onClick={() => setShowNew(true)}>
              <i className="bi bi-person-plus ico"></i> NUEVO USUARIO
            </button>
          </div>

          <div className="inv-table-wrap">
            <table className="inv-table">
              <thead>
                <tr>
                  <th style={{ width: 50 }}>ID</th>
                  <th><i className="bi bi-person"></i> Usuario</th>
                  <th><i className="bi bi-shield"></i> Rol</th>
                  <th><i className="bi bi-key"></i> Permisos</th>
                  <th><i className="bi bi-calendar"></i> Creado</th>
                  <th style={{ width: 130 }}></th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr><td colSpan="6" style={{padding:40,textAlign:'center',color:'var(--text-dim)'}}>Cargando…</td></tr>
                )}
                {!loading && filtered.map(u => (
                  <tr key={u.id}>
                    <td className="mono dim">{u.id}</td>
                    <td><b>{u.username}</b></td>
                    <td>
                      <span className={"diag-pill " + (u.role === 'admin' ? 'ok' : 'warn')}>
                        {u.role}
                      </span>
                    </td>
                    <td>
                      <div className="admin-perm-list">
                        {(u.permisos || []).filter(p => p.permitido).map(p => (
                          <span key={p.seccion} className="admin-perm-badge">{p.seccion}</span>
                        ))}
                      </div>
                    </td>
                    <td className="mono dim">{u.created_at ? u.created_at.slice(0, 10) : '—'}</td>
                    <td>
                      <div className="actions">
                        <button onClick={() => setEditing(u)} title="Editar"><i className="bi bi-pencil"></i></button>
                        <button onClick={() => deleteUser(u)} title="Eliminar"><i className="bi bi-trash"></i></button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!loading && filtered.length === 0 && (
                  <tr><td colSpan="6" style={{padding:40,textAlign:'center',color:'var(--text-dim)'}}>
                    Sin resultados.
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>

      <TweaksPanel title="Tweaks">
        <TweakSection label="Tema">
          <TweakColor label="Acento" value={t.accent} onChange={v => setTweak('accent', v)}
            options={['#00b4ff', '#22e1ff', '#ff3df0', '#25f4a7', '#ffb000']} />
        </TweakSection>
      </TweaksPanel>

      {showNew && (
        <UserModal
          mode="create"
          sections={sections} roles={roles}
          onClose={() => setShowNew(false)}
          onSaved={() => { setShowNew(false); refresh(); }}
        />
      )}
      {editing && (
        <UserModal
          mode="edit"
          user={editing}
          sections={sections} roles={roles}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); refresh(); }}
        />
      )}
    </div>
  );
}


function UserModal({ mode, user, sections, roles, onClose, onSaved }) {
  const isEdit = mode === 'edit';
  const [tab, setTab] = useStateA(isEdit ? 'edit' : 'create');
  const [busy, setBusy] = useStateA(false);
  const [err,  setErr]  = useStateA(null);

  // Datos comunes
  const [username, setUsername] = useStateA(user ? user.username : '');
  const [password, setPassword] = useStateA('');
  const [role,     setRole]     = useStateA(user ? user.role : 'user');

  // Permisos: array de secciones activas
  const initialPerms = user
    ? (user.permisos || []).filter(p => p.permitido).map(p => p.seccion)
    : sections.filter(s => s !== 'scada');
  const [perms, setPerms] = useStateA(initialPerms);

  const togglePerm = (s) => setPerms(prev => prev.includes(s)
    ? prev.filter(x => x !== s)
    : [...prev, s]);

  const save = async () => {
    setErr(null); setBusy(true);
    try {
      if (isEdit && tab === 'edit') {
        await window.LBS_API.usersUpdate(user.id, { role, permisos: perms });
        window.LBS_TOAST && window.LBS_TOAST.success('Usuario actualizado');
        onSaved();
      } else if (isEdit && tab === 'password') {
        if (password.length < 8) { setErr('Mínimo 8 caracteres'); setBusy(false); return; }
        await window.LBS_API.usersSetPassword(user.id, password);
        window.LBS_TOAST && window.LBS_TOAST.success('Contraseña restablecida');
        onSaved();
      } else {
        // crear
        if (!username) { setErr('Username requerido'); setBusy(false); return; }
        if (password.length < 8) { setErr('Contraseña mínimo 8 caracteres'); setBusy(false); return; }
        await window.LBS_API.usersCreate({ username, password, role, permisos: perms });
        window.LBS_TOAST && window.LBS_TOAST.success('Usuario creado');
        onSaved();
      }
    } catch (e) {
      setErr((e.data && e.data.error) || e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="lbs-modal-backdrop" onClick={onClose}>
      <div className="lbs-modal" onClick={e => e.stopPropagation()} style={{ width: 560 }}>
        <div className="lbs-modal-head">
          <h3>{isEdit ? `Editar usuario · ${user.username}` : 'Nuevo usuario'}</h3>
          <button className="lbs-modal-x" onClick={onClose}><i className="bi bi-x-lg"></i></button>
        </div>

        {isEdit && (
          <div className="admin-tabs">
            <button className={"admin-tab " + (tab==='edit'?'active':'')} onClick={() => setTab('edit')}>Datos</button>
            <button className={"admin-tab " + (tab==='password'?'active':'')} onClick={() => setTab('password')}>Restablecer contraseña</button>
          </div>
        )}

        <div className="lbs-modal-body">
          {(tab === 'edit' || !isEdit) && (
            <>
              {!isEdit && (
                <div className="lbs-grid-2">
                  <label className="lbs-field">
                    <span className="lbs-field-label">Username</span>
                    <input value={username} onChange={e => setUsername(e.target.value)} placeholder="jdoe" />
                  </label>
                  <label className="lbs-field">
                    <span className="lbs-field-label">Contraseña</span>
                    <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="mínimo 8 caracteres" />
                  </label>
                </div>
              )}
              <label className="lbs-field" style={{marginTop: isEdit ? 0 : 12}}>
                <span className="lbs-field-label">Rol</span>
                <select value={role} onChange={e => setRole(e.target.value)}>
                  {roles.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </label>
              <div style={{marginTop: 16}}>
                <span className="lbs-field-label">Permisos por sección</span>
                <div className="admin-perm-grid">
                  {sections.map(s => (
                    <label key={s} className={"admin-perm-toggle " + (perms.includes(s) ? 'active' : '')}>
                      <input type="checkbox" checked={perms.includes(s)} onChange={() => togglePerm(s)} />
                      <span>{s}</span>
                    </label>
                  ))}
                </div>
              </div>
            </>
          )}
          {tab === 'password' && (
            <label className="lbs-field">
              <span className="lbs-field-label">Nueva contraseña</span>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="mínimo 8 caracteres" />
              <span className="lbs-field-hint">El usuario podrá iniciar sesión con esta contraseña inmediatamente.</span>
            </label>
          )}
        </div>

        <div className="lbs-modal-foot">
          {err && <span className="lbs-modal-err"><i className="bi bi-exclamation-triangle"></i> {err}</span>}
          <button className="btn ghost" onClick={onClose} disabled={busy}>Cancelar</button>
          <button className="btn" onClick={save} disabled={busy}>
            {busy ? 'Guardando…' : isEdit ? (tab === 'password' ? 'Restablecer' : 'Guardar') : 'Crear'}
          </button>
        </div>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<AdminApp />);
