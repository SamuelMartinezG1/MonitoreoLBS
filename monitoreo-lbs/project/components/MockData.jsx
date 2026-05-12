// MockData.jsx — shared synthetic fleet data for dashboard/inventario/diagnostico

const SITES = [
  {
    id: 'cdmx-vallejo',  name: 'CDMX · Vallejo',  region: 'Centro',  addr: 'Planta industrial Norte',
    ups_total: 5, online: 5, alarms: 0, load_kw: 18.6, cap_kw: 32, runtime: '42m',
    leds: ['ok','ok','ok','ok','ok'],
    status: 'ok',
  },
  {
    id: 'mty-apodaca',   name: 'MTY · Apodaca',   region: 'Noreste', addr: 'Parque industrial Stiva',
    ups_total: 4, online: 3, alarms: 1, load_kw: 14.2, cap_kw: 24, runtime: '38m',
    leds: ['ok','ok','warn','off'],
    status: 'warn',
  },
  {
    id: 'gdl-andares',   name: 'GDL · Andares',   region: 'Occidente', addr: 'Corporativo Andares',
    ups_total: 3, online: 3, alarms: 0, load_kw: 8.8, cap_kw: 18, runtime: '56m',
    leds: ['ok','ok','ok'],
    status: 'ok',
  },
];

const DEVICES = [
  // CDMX-Vallejo
  { id:'u01', site:'cdmx-vallejo', name:'UPS-03-01', ip:'192.168.3.10', model:'EATON 9PX 6kVA',    kva:6,  v_in:122.4, v_out:120.0, load:75, bat:96, temp:34.2, status:'ok',   uptime:'142d 04h' },
  { id:'u02', site:'cdmx-vallejo', name:'UPS-03-02', ip:'192.168.3.11', model:'EATON 9PX 6kVA',    kva:6,  v_in:121.8, v_out:120.1, load:62, bat:98, temp:32.8, status:'ok',   uptime:'142d 04h' },
  { id:'u03', site:'cdmx-vallejo', name:'UPS-03-03', ip:'192.168.3.12', model:'APC SRT 8kVA',      kva:8,  v_in:122.0, v_out:120.0, load:48, bat:99, temp:31.4, status:'ok',   uptime:'89d  12h' },
  { id:'u04', site:'cdmx-vallejo', name:'UPS-03-04', ip:'192.168.3.13', model:'APC SRT 8kVA',      kva:8,  v_in:121.9, v_out:120.0, load:55, bat:97, temp:33.0, status:'ok',   uptime:'89d  12h' },
  { id:'u05', site:'cdmx-vallejo', name:'UPS-03-05', ip:'192.168.3.14', model:'EATON 93PM 20kVA', kva:20, v_in:208.4, v_out:208.0, load:42, bat:100,temp:36.1, status:'ok',   uptime:'318d 02h' },
  // MTY-Apodaca
  { id:'u06', site:'mty-apodaca',  name:'UPS-MTY-01',ip:'10.20.4.10',  model:'EATON 9PX 6kVA',    kva:6,  v_in:121.4, v_out:120.0, load:68, bat:94, temp:35.4, status:'ok',   uptime:'76d  18h' },
  { id:'u07', site:'mty-apodaca',  name:'UPS-MTY-02',ip:'10.20.4.11',  model:'EATON 9PX 6kVA',    kva:6,  v_in:121.6, v_out:120.0, load:71, bat:95, temp:34.8, status:'ok',   uptime:'76d  18h' },
  { id:'u08', site:'mty-apodaca',  name:'UPS-MTY-03',ip:'10.20.4.12',  model:'APC SRT 10kVA',     kva:10, v_in:121.8, v_out:120.1, load:88, bat:42, temp:48.6, status:'warn', uptime:'12d  04h', alarm:'Batería baja · 42%' },
  { id:'u09', site:'mty-apodaca',  name:'UPS-MTY-04',ip:'10.20.4.13',  model:'APC SRT 10kVA',     kva:10, v_in:0,     v_out:0,     load:0,  bat:0,  temp:0,    status:'off',  uptime:'—',         alarm:'Equipo offline · sin SNMP' },
  // GDL-Andares
  { id:'u10', site:'gdl-andares',  name:'UPS-GDL-01',ip:'172.16.8.10', model:'EATON 9PX 3kVA',    kva:3,  v_in:122.2, v_out:120.0, load:38, bat:100,temp:29.4, status:'ok',   uptime:'202d 08h' },
  { id:'u11', site:'gdl-andares',  name:'UPS-GDL-02',ip:'172.16.8.11', model:'EATON 9PX 3kVA',    kva:3,  v_in:122.4, v_out:120.0, load:42, bat:99, temp:30.1, status:'ok',   uptime:'202d 08h' },
  { id:'u12', site:'gdl-andares',  name:'UPS-GDL-03',ip:'172.16.8.12', model:'APC Smart-UPS 5kVA',kva:5,  v_in:121.6, v_out:120.0, load:56, bat:97, temp:31.8, status:'ok',   uptime:'124d 16h' },
];

const ALARMS = [
  { ts:'14:25:18', lvl:'warn', dev:'UPS-MTY-03', site:'mty-apodaca', title:'Batería baja', detail:'Nivel 42% — próxima a umbral crítico' },
  { ts:'14:24:02', lvl:'err',  dev:'UPS-MTY-04', site:'mty-apodaca', title:'Equipo offline', detail:'Sin respuesta SNMP por 8 minutos' },
  { ts:'14:18:46', lvl:'warn', dev:'UPS-MTY-03', site:'mty-apodaca', title:'Temperatura alta', detail:'Módulo de potencia a 48.6°C' },
  { ts:'13:54:11', lvl:'info', dev:'UPS-03-05',  site:'cdmx-vallejo',title:'Self-test programado', detail:'Resultado: OK · 0 fallas' },
  { ts:'13:02:30', lvl:'info', dev:'UPS-GDL-01', site:'gdl-andares', title:'Sesión iniciada', detail:'Usuario admin desde 192.168.10.4' },
  { ts:'11:48:09', lvl:'warn', dev:'UPS-03-01',  site:'cdmx-vallejo',title:'THD entrada alta', detail:'3.1% (umbral 5%) — verificar línea' },
];

window.MOCK = { SITES, DEVICES, ALARMS };
