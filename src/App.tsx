import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from './supabase';

// ===== COMPONENTE INTEGRADO: CentroPedidos =====
const { CentroPedidos, crearPedidoCentral } = (() => {

  type Rol = 'vendedor' | 'bodega' | 'administrador';
  type Linea = { productId: string; sku: string; nombre: string; imagen: string; cantidad: number; precio: number; iva: number };
  type Pedido = { id: string; numero: number; vendedor_id: string; cliente_nombre: string; cliente_documento: string; cliente_correo: string; cliente_telefono: string; ciudad: string; direccion: string; observaciones: string; lineas: Linea[]; estado: string; version: number; updated_at: string; created_at: string; factura_referencia: string | null };
  type Historial = { id: number; created_at: string; accion: string; actor_id: string; antes: unknown; despues: unknown };
  const dinero = (v: number) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v);
  const total = (p: Pedido) => p.lineas.reduce((s, l) => s + l.cantidad * l.precio * (1 + l.iva / 100), 0);
  const boton: React.CSSProperties = { background: '#572080', border: 0, borderRadius: 9, padding: '10px 13px', color: '#fff', cursor: 'pointer' };
  const input: React.CSSProperties = { width: '100%', padding: 10, border: '1px solid #d9cbe4', borderRadius: 9, boxSizing: 'border-box' };
  const panel: React.CSSProperties = { padding: 18, background: '#fff', border: '1px solid #e9dff0', borderRadius: 15, marginBottom: 16 };
  function CentroPedidos({ rol, pedidoInicialId }: { rol: Rol; pedidoInicialId?: string | null }) {
    const [pedidos, setPedidos] = useState<Pedido[]>([]), [borrador, setBorrador] = useState<Pedido | null>(null);
    const [alertas, setAlertas] = useState<{ id: number; pedido_id: string; mensaje: string }[]>([]);
    const [nombresVendedores, setNombresVendedores] = useState<Record<string, string>>({});
    const nombreVendedor = (id: string) => nombresVendedores[id] || 'Sin vendedor identificado';
    const [historial, setHistorial] = useState<Historial[]>([]), [mensaje, setMensaje] = useState(''), [cargando, setCargando] = useState(false), [guardando, setGuardando] = useState(false);
    const cargar = useCallback(async () => {      
setCargando(true); const { data, error } = await supabase.from('jv_pedidos').select('*').order('created_at', { ascending: false }).limit(200); setCargando(false); if (error) { setMensaje('No se pudieron consultar pedidos: ' + error.message); return; } setPedidos((data || []) as Pedido[]); const ids = [...new Set((data || []).map((p: any) => p.vendedor_id).filter(Boolean))];
      if (ids.length) {
        // Función segura: Bodega y Administración reciben solo nombres, sin datos privados.
        const perfiles = await supabase.rpc('jv_nombres_vendedores', { p_ids: ids });
        if (perfiles.error) {
          setNombresVendedores({});
          setMensaje('No fue posible consultar los vendedores: ' + perfiles.error.message + '. Contacta a Administración para revisar el módulo de vendedores.');
        } else {
          setNombresVendedores(Object.fromEntries((perfiles.data || []).map((p: any) => [p.id, String(p.nombre || '').trim() || 'Sin vendedor identificado'])));
        }
      } else { setNombresVendedores({}); } const a = await supabase.from('jv_alertas_pedido').select('id,pedido_id,mensaje').is('resuelta_en', null).limit(500); if (!a.error) setAlertas((a.data || []) as { id: number; pedido_id: string; mensaje: string }[]);    
}, []);
    useEffect(() => { void cargar(); const canal = supabase.channel('jv_pedidos_cambios').on('postgres_changes', { event: '*', schema: 'public', table: 'jv_pedidos' }, () => { void cargar() }).subscribe(); return () => { void supabase.removeChannel(canal) } }, [cargar]);
    const abrir = async (p: Pedido) => { setBorrador(structuredClone(p)); const { data } = await supabase.from('jv_pedidos_historial').select('id,created_at,accion,actor_id,antes,despues').eq('pedido_id', p.id).order('created_at', { ascending: false }).limit(30); setHistorial((data || []) as Historial[]); };
    const pedidoAbiertoAutomaticamente = React.useRef<string | null>(null);
    useEffect(() => {
      if (!pedidoInicialId || pedidoAbiertoAutomaticamente.current === pedidoInicialId) return;
      const encontrado = pedidos.find(p => p.id === pedidoInicialId);
      if (!encontrado) return;
      pedidoAbiertoAutomaticamente.current = pedidoInicialId;
      void abrir(encontrado);
    }, [pedidoInicialId, pedidos]);
    const editar = (cambios: Partial<Pedido>) => setBorrador(v => v ? { ...v, ...cambios } : v);
    const guardar = async (estado?: string) => { if (!borrador || guardando) return; setGuardando(true); setMensaje(''); const { data, error } = await supabase.rpc('jv_actualizar_pedido', { p_id: borrador.id, p_version: borrador.version, p_datos: estado === 'despachado' ? {} : { cliente_nombre: borrador.cliente_nombre, cliente_documento: borrador.cliente_documento, cliente_correo: borrador.cliente_correo, cliente_telefono: borrador.cliente_telefono, ciudad: borrador.ciudad, direccion: borrador.direccion, observaciones: borrador.observaciones, lineas: borrador.lineas }, p_estado: estado || null, p_factura_referencia: null }); setGuardando(false); if (error) { setMensaje('No se guardó: ' + error.message + ' Actualiza para comprobar si otro usuario modificó el pedido.'); return; } setMensaje('Pedido actualizado en Supabase.'); await cargar(); if (data) await abrir(data as Pedido); };
    const resolverAlertas = async () => { if (!borrador) return; const { error } = await supabase.rpc('jv_resolver_alertas', { p_pedido_id: borrador.id }); if (error) { setMensaje(error.message); return; } await cargar(); setMensaje('Alertas revisadas. Verifica físicamente el pedido antes de confirmar.'); };
    const marcarFactura = async () => { if (!borrador) return; const referencia = window.prompt('Referencia de factura YA emitida y validada fuera de JAIVISA (no emite DIAN):'); if (!referencia?.trim()) return; setGuardando(true); const { data, error } = await supabase.rpc('jv_actualizar_pedido', { p_id: borrador.id, p_version: borrador.version, p_datos: {}, p_estado: 'facturado', p_factura_referencia: referencia.trim() }); setGuardando(false); if (error) { setMensaje(error.message); return; } setMensaje('Referencia de factura externa registrada.'); await cargar(); if (data) await abrir(data as Pedido); };
    const imprimir = () => { if (!borrador) return; const w = window.open('', '_blank'); if (!w) { setMensaje('Permite ventanas emergentes para imprimir.'); return; } const safe = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c)); w.document.write(`<!doctype html><html lang="es"><meta charset="utf-8"><title>JAIVISA ${safe(borrador.numero)}</title><style>body{font:14px Arial;margin:30px;color:#321343}h1{color:#572080}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #ddd;padding:10px;text-align:left}img{width:70px;height:70px;object-fit:contain}</style><h1>JAIVISA · Orden de preparación #${safe(borrador.numero)}</h1><p>Vendedor responsable: ${safe(nombreVendedor(borrador.vendedor_id))}</p><p>Cliente: ${safe(borrador.cliente_nombre)} · Documento: ${safe(borrador.cliente_documento)}</p><p>Tel: ${safe(borrador.cliente_telefono)} · ${safe(borrador.ciudad)}, ${safe(borrador.direccion)}</p><p>Observaciones: ${safe(borrador.observaciones)}</p><table><tr><th>Foto</th><th>Producto</th><th>SKU</th><th>Cantidad</th></tr>${borrador.lineas.map(l => `<tr><td>${l.imagen && /^https:\/\//.test(l.imagen) ? `<img src="${safe(l.imagen)}">` : ''}</td><td>${safe(l.nombre)}</td><td>${safe(l.sku)}</td><td>${safe(l.cantidad)}</td></tr>`).join('')}</table><p>Documento interno. NO es factura electrónica.</p><button onclick="window.print()">Imprimir</button>`); w.document.close(); };
    const editable = !!borrador && borrador.estado !== 'facturado' && borrador.estado !== 'despachado' && (rol !== 'vendedor' || borrador.estado !== 'facturado');
    return <section style={{ fontFamily: 'Inter,system-ui,sans-serif', color: '#321343' }}><div style={{ ...panel, display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}><div><h2 style={{ margin: '0 0 5px' }}>📦 Centro de Pedidos JAIVISA</h2><small>Información compartida en JAIVISA · {rol}</small></div><button style={boton} onClick={() => void cargar()} disabled={cargando}>{cargando ? 'Cargando…' : '↻ Actualizar'}</button></div>
      {rol !== 'vendedor' && <div style={{ ...panel, display: 'flex', flexWrap: 'wrap', gap: 18 }}>{[['Pedidos', pedidos.length], ['Por preparar', pedidos.filter(p => p.estado === 'nuevo').length], ['En preparación', pedidos.filter(p => p.estado === 'preparacion').length], ['Alertas pendientes', alertas.length], ['Facturados', pedidos.filter(p => p.estado === 'facturado').length]].map(([k, v]) => <div key={k} style={{ minWidth: 100 }}><strong style={{ fontSize: 24 }}>{v}</strong><div style={{ fontSize: 12 }}>{k}</div></div>)}</div>}
      {mensaje && <p role="status" style={{ ...panel, color: '#6a277f' }}>{mensaje}</p>}
      <div style={{ ...panel, overflowX: 'auto' }}><table style={{ width: '100%', minWidth: 670, borderCollapse: 'collapse', textAlign: 'left' }}><thead><tr>{['N.º', 'Cliente', 'Vendedor', 'Fecha', 'Estado', 'Total', 'Acción'].map(h => <th key={h} style={{ padding: 10, borderBottom: '1px solid #ddd' }}>{h}</th>)}</tr></thead><tbody>{pedidos.map(p => <tr key={p.id}>{[p.numero, p.cliente_nombre, nombreVendedor(p.vendedor_id), new Date(p.created_at).toLocaleString('es-CO'), p.estado, dinero(total(p))].map((x, i) => <td key={i} style={{ padding: 10, borderBottom: '1px solid #eee' }}>{x}</td>)}<td><button style={boton} onClick={() => void abrir(p)}>Abrir</button></td></tr>)}{!pedidos.length && <tr><td colSpan={7} style={{ padding: 20 }}>Todavía no hay pedidos visibles para tu cuenta.</td></tr>}</tbody></table></div>
      {borrador && <div style={panel}><h3>Pedido #{borrador.numero} · {borrador.estado}</h3><p><strong>Vendedor responsable:</strong> {nombreVendedor(borrador.vendedor_id)}</p><p style={{ fontSize: 12, color: '#695775' }}>Creado: {new Date(borrador.created_at).toLocaleString('es-CO')} · Última actualización: {new Date(borrador.updated_at).toLocaleString('es-CO')}</p>{borrador.estado === 'preparacion' && <p style={{ color: '#9a4a00' }}>⚠ Si cambias este pedido, Bodega debe volver a verificar su preparación.</p>}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 10 }}>{([['cliente_nombre', 'Cliente'], ['cliente_documento', 'NIT / documento'], ['cliente_correo', 'Correo de facturación'], ['cliente_telefono', 'Teléfono'], ['ciudad', 'Ciudad'], ['direccion', 'Dirección'], ['observaciones', 'Observaciones']] as const).map(([key, label]) => <label key={key} style={{ fontSize: 13 }}>{label}<input style={input} value={borrador[key] || ''} disabled={!editable} onChange={e => editar({ [key]: e.target.value })} /></label>)}</div>
        {alertas.some(a => a.pedido_id === borrador.id) && <div role="alert" style={{ background: '#fff3dc', padding: 12, borderRadius: 10, marginTop: 12 }}><strong>⚠ Pedido modificado durante preparación</strong><p>Revisa nuevamente cantidades y dirección antes de confirmar.</p>{rol !== 'vendedor' && <button style={boton} onClick={() => void resolverAlertas()}>He revisado los cambios</button>}</div>}
        <h4>Productos y cantidades</h4>{borrador.lineas.map((l, i) => <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'center', borderBottom: '1px solid #eee', padding: '9px 0', flexWrap: 'wrap' }}>{l.imagen && <img src={l.imagen} alt={l.nombre} style={{ width: 65, height: 65, objectFit: 'contain' }} />}<div style={{ flex: 1, minWidth: 140 }}><strong>{l.nombre}</strong><div style={{ fontSize: 12 }}>{l.sku} · {dinero(l.precio)} · IVA {l.iva}%</div></div><label>Cantidad <input type="number" min={1} step={1} style={{ ...input, width: 90 }} disabled={!editable} value={l.cantidad} onChange={e => editar({ lineas: borrador.lineas.map((x, j) => j === i ? { ...x, cantidad: Math.max(1, Math.floor(Number(e.target.value) || 1)) } : x) })} /></label></div>)}<p><strong>Total: {dinero(total(borrador))}</strong></p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{editable && <button style={boton} disabled={guardando} onClick={() => void guardar()}>Guardar cambios</button>}{rol !== 'vendedor' && <>{borrador.estado === 'nuevo' && <button style={boton} onClick={() => { if (window.confirm('¿Iniciar preparación del pedido?')) void guardar('preparacion') }}>Iniciar preparación</button>}{borrador.estado === 'preparacion' && <button style={boton} disabled={alertas.some(a => a.pedido_id === borrador.id)} onClick={() => { if (window.confirm('¿Confirmas que revisaste físicamente el pedido?')) void guardar('verificado') }}>Confirmar verificación</button>}{borrador.estado === 'verificado' && <button style={boton} onClick={() => void marcarFactura()}>Registrar factura externa</button>}{borrador.estado === 'facturado' && <button style={boton} onClick={() => { if (window.confirm('¿Confirmas que el pedido ya fue despachado?')) void guardar('despachado') }}>Marcar despachado</button>}</>}<button style={boton} onClick={imprimir}>Imprimir orden</button><button style={{ ...boton, background: '#776a80' }} onClick={() => { setBorrador(null) }}>Cerrar</button></div>
        <h4>Historial de cambios</h4><p style={{ fontSize: 12, color: '#695775' }}>Los cambios quedan registrados en el historial de JAIVISA. La edición de pedidos facturados queda restringida.</p>{historial.map(h => <p key={h.id} style={{ fontSize: 12, borderBottom: '1px solid #eee', paddingBottom: 7 }}>{new Date(h.created_at).toLocaleString('es-CO')} · {h.accion} · Usuario {h.actor_id.slice(0, 8)}</p>)}{!historial.length && <p>Sin cambios registrados todavía.</p>}
      </div>}</section>;
  }
  async function crearPedidoCentral(payload: { cliente_nombre: string; cliente_telefono: string; cliente_correo?: string; cliente_documento?: string; ciudad: string; direccion: string; observaciones?: string; lineas: Linea[] }) {
    const { data, error } = await supabase.rpc('jv_crear_pedido', { p_datos: payload }); if (error) throw new Error(error.message); return data as Pedido;
  }
  return { CentroPedidos, crearPedidoCentral };
})();

// ===== COMPONENTE INTEGRADO: IsaAsistente =====
const { IsaAsistente } = (() => {
  /** Ayuda contextual local: no envía datos del usuario a servicios externos. */
  function IsaAsistente() {
    const [abierta, setAbierta] = useState(false);
    return <aside className="jaivisa-isa-responsive" style={{ position: 'fixed', right: 18, bottom: 18, zIndex: 1000, fontFamily: 'system-ui,sans-serif' }}>
      <style>{`
 .jaivisa-isa-responsive{max-width:calc(100vw - 24px);pointer-events:none}
 .jaivisa-isa-responsive > button,.jaivisa-isa-responsive > [role=dialog]{pointer-events:auto}
 .jaivisa-isa-responsive > button{display:inline-flex;align-items:center;justify-content:center;gap:8px;max-width:100%;white-space:nowrap}
 .jaivisa-isa-responsive > [role=dialog]{box-sizing:border-box;max-height:min(70dvh,540px);overflow-y:auto;overscroll-behavior:contain}
 @media(max-width:600px){
 .jaivisa-isa-responsive{right:12px!important;bottom:calc(12px + env(safe-area-inset-bottom,0px))!important;z-index:2147483000!important}
 .jaivisa-isa-responsive > button{padding:9px 12px!important;font-size:13px!important;box-shadow:0 4px 18px #32134355!important}
 .jaivisa-isa-responsive > button img{width:29px!important;height:29px!important;margin-right:0!important}
 .jaivisa-isa-responsive > [role=dialog]{width:min(330px,calc(100vw - 24px))!important;max-width:calc(100vw - 24px)!important;max-height:calc(100dvh - 110px)!important;padding:14px!important}
 }
 `}</style>
      {abierta && <div role="dialog" aria-label="Ayuda de Isa" style={{ width: 290, maxWidth: 'calc(100vw - 36px)', padding: 16, background: '#fff', border: '1px solid #e4d2ef', borderRadius: 16, boxShadow: '0 12px 35px #32134333', marginBottom: 8, color: '#321343' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <img src="/isa-original.png" alt="Isa, asistente original de JAIVISA" style={{ width: 88, height: 105, objectFit: 'contain', borderRadius: 12, background: '#faf5fd' }} />
          <div><strong>¡Hola! Soy Isa</strong><p style={{ margin: '4px 0' }}>Tu guía de JAIVISA NEXT.</p></div>
        </div>
        <p style={{ fontSize: 13 }}>Para crear un pedido: abre el catálogo, agrega productos y guarda el pedido. En Bodega podrás revisarlo, imprimirlo y marcar su preparación.</p>
        <p style={{ fontSize: 12 }}>La facturación electrónica debe realizarse en el sistema autorizado. No compartas contraseñas ni datos bancarios conmigo.</p>
        <button onClick={() => setAbierta(false)} style={{ border: 0, borderRadius: 8, padding: 8, background: '#572080', color: 'white' }}>Cerrar</button>
      </div>}
      <button aria-expanded={abierta} onClick={() => setAbierta(x => !x)} style={{ background: '#572080', color: '#fff', border: 0, borderRadius: 28, padding: '13px 17px', fontWeight: 700, boxShadow: '0 6px 22px #32134355', cursor: 'pointer' }}><img src="/isa-original.png" alt="" aria-hidden="true" style={{ width: 30, height: 30, objectFit: 'cover', objectPosition: 'center top', borderRadius: '50%', background: 'white', verticalAlign: 'middle', marginRight: 0 }} />Isa · Ayuda</button>
    </aside>;
  }
  return { IsaAsistente };
})();

// ===== COMPONENTE INTEGRADO: ModulosEmpresa =====
const { ModulosEmpresa } = (() => {

  type Rol = 'administrador' | 'bodega' | 'vendedor';
  type Tipo = 'cotizacion' | 'despacho' | 'pago' | 'novedad' | 'devolucion' | 'proveedor' | 'tarea' | 'precio_cliente';
  type Registro = { id: string; tipo: Tipo; titulo: string; descripcion: string; referencia: string; importe: number; estado: string; created_at: string; created_by: string };
  type Inventario = { sku: string; nombre: string; existencias: number; reservadas: number; minimo: number; updated_at: string };
  const opciones: { tipo: Tipo; titulo: string; ayuda: string }[] = [
    { tipo: 'cotizacion', titulo: 'Cotizaciones', ayuda: 'Registra propuestas comerciales. Convertir a pedido requiere validación y creación del pedido en el Centro de Pedidos.' },
    { tipo: 'despacho', titulo: 'Despachos y guías', ayuda: 'Guarda transportadora, guía, cajas y novedades en la descripción; referencia el número de pedido.' },
    { tipo: 'pago', titulo: 'Cartera y abonos', ayuda: 'Registro administrativo de pagos informados. No concilia bancos ni sustituye contabilidad.' },
    { tipo: 'novedad', titulo: 'Novedades', ayuda: 'Reporta faltantes, diferencias de empaque y observaciones.' },
    { tipo: 'devolucion', titulo: 'Devoluciones', ayuda: 'Control de solicitudes. No genera automáticamente nota crédito ni reintegra inventario.' },
    { tipo: 'proveedor', titulo: 'Proveedores y compras', ayuda: 'Registra seguimiento a proveedores y órdenes de compra.' },
    { tipo: 'tarea', titulo: 'Tareas y avisos', ayuda: 'Seguimiento de pendientes de los equipos e Isa.' },
    { tipo: 'precio_cliente', titulo: 'Precios y acuerdos', ayuda: 'Registra solicitudes de precios especiales; NO cambia automáticamente los precios de pedidos.' }
  ];
  const moneda = (n: number) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n || 0);
  const estilo: React.CSSProperties = { padding: 11, borderRadius: 9, border: '1px solid #dfd0ea', width: '100%', boxSizing: 'border-box' };
  const boton: React.CSSProperties = { padding: '10px 14px', border: 0, borderRadius: 9, background: '#60278a', color: 'white', cursor: 'pointer' };
  function ModulosEmpresa({ rol }: { rol: Rol }) {
    const [tipo, setTipo] = useState<Tipo>('cotizacion');
    const [registros, setRegistros] = useState<Registro[]>([]);
    const [inventario, setInventario] = useState<Inventario[]>([]);
    const [mensaje, setMensaje] = useState('');
    const [cargando, setCargando] = useState(false);
    const [guardando, setGuardando] = useState(false);
    const [titulo, setTitulo] = useState(''), [descripcion, setDescripcion] = useState(''), [referencia, setReferencia] = useState(''), [importe, setImporte] = useState('');
    const [sku, setSku] = useState(''), [nombre, setNombre] = useState(''), [cantidad, setCantidad] = useState(''), [minimo, setMinimo] = useState('5');
    const [buscar, setBuscar] = useState('');
    const cargar = useCallback(async () => {
      setCargando(true);
      const [r, i] = await Promise.all([
        supabase.from('jv_registros_operativos').select('id,tipo,titulo,descripcion,referencia,importe,estado,created_at,created_by').order('created_at', { ascending: false }).limit(500),
        supabase.from('jv_inventario').select('sku,nombre,existencias,reservadas,minimo,updated_at').order('nombre').limit(1000)
      ]);
      setCargando(false);
      if (r.error || i.error) { setMensaje('Este módulo aún no está disponible. Contacta al administrador de JAIVISA. Detalle: ' + (r.error?.message || i.error?.message)); return; }
      setRegistros((r.data || []) as Registro[]); setInventario((i.data || []) as Inventario[]);
    }, []);
    useEffect(() => { void cargar() }, [cargar]);
    const filtrados = useMemo(() => registros.filter(r => r.tipo === tipo && `${r.titulo} ${r.referencia} ${r.descripcion}`.toLocaleLowerCase('es').includes(buscar.toLocaleLowerCase('es'))), [registros, tipo, buscar]);
    const crear = async (e: React.FormEvent) => {
      e.preventDefault(); if (!titulo.trim() || guardando) return;
      setGuardando(true); const { error } = await supabase.from('jv_registros_operativos').insert({ tipo, titulo: titulo.trim(), descripcion: descripcion.trim(), referencia: referencia.trim(), importe: Number(importe) || 0 }); setGuardando(false);
      if (error) { setMensaje('No se guardó: ' + error.message); return; }
      setTitulo(''); setDescripcion(''); setReferencia(''); setImporte(''); setMensaje('Registro guardado correctamente en JAIVISA.'); await cargar();
    };
    const cambiarEstado = async (r: Registro) => {
      const siguiente = r.estado === 'abierto' ? 'cerrado' : 'abierto';
      const { error } = await supabase.from('jv_registros_operativos').update({ estado: siguiente }).eq('id', r.id);
      if (error) { setMensaje(error.message); return; } await cargar();
    };
    const ajustar = async (e: React.FormEvent) => {
      e.preventDefault(); const delta = Number(cantidad);
      if (!sku.trim() || !nombre.trim() || !Number.isSafeInteger(delta) || !Number.isSafeInteger(Number(minimo))) { setMensaje('SKU, nombre y cantidades enteras son obligatorios.'); return; }
      setGuardando(true);
      const { error } = await supabase.rpc('jv_ajustar_inventario', { p_sku: sku.trim(), p_nombre: nombre.trim(), p_delta: delta, p_minimo: Number(minimo), p_motivo: 'Ajuste manual autorizado desde JAIVISA NEXT' });
      setGuardando(false); if (error) { setMensaje('Inventario no actualizado: ' + error.message); return; }
      setSku(''); setNombre(''); setCantidad(''); setMensaje('Movimiento de inventario registrado.'); await cargar();
    };
    const exportar = () => {
      const csv = [['Tipo', 'Título', 'Referencia', 'Importe', 'Estado', 'Fecha', 'Descripción'], ...filtrados.map(r => [r.tipo, r.titulo, r.referencia, String(r.importe), r.estado, r.created_at, r.descripcion])]
        .map(row => row.map(v => '"' + String(v).replace(/"/g, '""') + '"').join(';')).join('\r\n');
      const url = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' })); const a = document.createElement('a'); a.href = url; a.download = 'JAIVISA_' + tipo + '.csv'; a.click(); URL.revokeObjectURL(url);
    };
    const datos = opciones.find(o => o.tipo === tipo)!;
    return <section style={{ color: '#341b43', fontFamily: 'Inter,system-ui,sans-serif' }}>
      <div style={{ background: '#fff', borderRadius: 16, padding: 20, marginBottom: 15, border: '1px solid #e7daef' }}><h2 style={{ marginTop: 0 }}>💜 JAIVISA NEXT · Operaciones empresariales</h2><p style={{ color: '#74617e' }}>Registros centralizados, permisos en JAIVISA e inventario con movimientos auditados. Facturación DIAN, reservas automáticas y conciliación bancaria aún requieren integraciones.</p>
        <button style={boton} onClick={() => void cargar()} disabled={cargando}>{cargando ? 'Consultando…' : 'Actualizar datos'}</button>{mensaje && <p role="status" style={{ padding: 12, background: '#f4e9fa', borderRadius: 8 }}>{mensaje}</p>}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10, marginBottom: 16 }}>{[['Registros visibles', registros.length], ['Pendientes', registros.filter(r => r.estado === 'abierto').length], ['Referencias de inventario', inventario.length], ['Stock bajo', inventario.filter(i => i.existencias - i.reservadas <= i.minimo).length]].map(([k, v]) => <div key={k} style={{ background: '#fff', border: '1px solid #e7daef', padding: 16, borderRadius: 13 }}><strong style={{ fontSize: 24 }}>{v}</strong><div style={{ fontSize: 12 }}>{k}</div></div>)}</div>
      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 14 }}>{opciones.filter(o => rol === 'administrador' || !['precio_cliente', 'pago'].includes(o.tipo)).map(o => <button key={o.tipo} style={{ ...boton, background: tipo === o.tipo ? '#60278a' : '#eee3f5', color: tipo === o.tipo ? 'white' : '#562176' }} onClick={() => setTipo(o.tipo)}>{o.titulo}</button>)}</div>
      <div style={{ background: '#fff', border: '1px solid #e7daef', padding: 18, borderRadius: 14, marginBottom: 15 }}><h3>{datos.titulo}</h3><p style={{ fontSize: 13, color: '#766781' }}>{datos.ayuda}</p>
        <form onSubmit={crear} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 10, marginBottom: 15 }}><label>Título<input style={estilo} required maxLength={150} value={titulo} onChange={e => setTitulo(e.target.value)} /></label><label>Pedido / referencia<input style={estilo} maxLength={100} value={referencia} onChange={e => setReferencia(e.target.value)} /></label><label>Valor COP<input style={estilo} type="number" min="0" step="1" value={importe} onChange={e => setImporte(e.target.value)} /></label><label style={{ gridColumn: '1/-1' }}>Detalle / observaciones<textarea style={{ ...estilo, minHeight: 75 }} maxLength={3000} value={descripcion} onChange={e => setDescripcion(e.target.value)} /></label><button style={boton} disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar registro'}</button></form>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}><input style={{ ...estilo, maxWidth: 340 }} placeholder="Buscar registros" value={buscar} onChange={e => setBuscar(e.target.value)} /><button style={boton} onClick={exportar} type="button">Exportar CSV</button></div>
        {filtrados.map(r => <div key={r.id} style={{ padding: '12px 0', borderBottom: '1px solid #eee' }}><strong>{r.titulo}</strong> · {r.estado} · {moneda(r.importe)}<div style={{ fontSize: 12, color: '#766781' }}>{r.referencia} · {new Date(r.created_at).toLocaleString('es-CO')}</div><p style={{ whiteSpace: 'pre-wrap', fontSize: 13 }}>{r.descripcion}</p><button style={{ ...boton, padding: '6px 10px' }} onClick={() => void cambiarEstado(r)}>{r.estado === 'abierto' ? 'Marcar cerrado' : 'Reabrir'}</button></div>)}{!filtrados.length && <p>No hay registros de este tipo.</p>}</div>
      <div style={{ background: '#fff', border: '1px solid #e7daef', padding: 18, borderRadius: 14 }}><h3>📦 Inventario central · movimientos auditados</h3><p style={{ fontSize: 13, color: '#766781' }}>Los ajustes manuales solo están disponibles para Bodega y Administración. El catálogo original todavía debe migrarse para utilizar estas existencias en pedidos y reservas.</p>
        {rol !== 'vendedor' && <form onSubmit={ajustar} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 9, alignItems: 'end' }}><label>SKU<input required style={estilo} value={sku} onChange={e => setSku(e.target.value)} /></label><label>Nombre<input required style={estilo} value={nombre} onChange={e => setNombre(e.target.value)} /></label><label>Movimiento (+ / −)<input required type="number" step="1" style={estilo} value={cantidad} onChange={e => setCantidad(e.target.value)} /></label><label>Mínimo<input required type="number" min="0" step="1" style={estilo} value={minimo} onChange={e => setMinimo(e.target.value)} /></label><button disabled={guardando} style={boton}>Registrar movimiento</button></form>}
        <div style={{ overflowX: 'auto', marginTop: 12 }}><table style={{ width: '100%', minWidth: 500, textAlign: 'left' }}><thead><tr><th>SKU</th><th>Producto</th><th>Existencias</th><th>Reservadas</th><th>Disponibles</th><th>Mínimo</th></tr></thead><tbody>{inventario.map(i => <tr key={i.sku} style={{ background: i.existencias - i.reservadas <= i.minimo ? '#fff2df' : 'transparent' }}><td>{i.sku}</td><td>{i.nombre}</td><td>{i.existencias}</td><td>{i.reservadas}</td><td>{i.existencias - i.reservadas}</td><td>{i.minimo}</td></tr>)}</tbody></table></div></div>
    </section>;
  }
  return { ModulosEmpresa };
})();

// ===== APLICACION ORIGINAL JAIVISA NEXT =====

type Product = { id: string; sku: string; name: string; price: number; iva: number; stock: number; barcode: string; category?: string; image?: string };
type Worker = { id: string; name: string; document: string; phone: string; email?: string; employeeCode?: string; role: string; enabled: boolean; permissions: string[] };
type Client = { id: string; name: string; document: string; phone: string; country?: string; dialCode?: string; email: string; city: string; address: string; enabled: boolean; access: 'Pendiente de invitación' | 'Activo' | 'Suspendido' };
type Line = { productId: string; qty: number; price: number };
type Order = { id: string; customer: string; phone: string; city: string; address: string; email: string; lines: Line[]; status: string; created: string; pago?: 'pendiente' | 'parcial' | 'pagado'; fechaPago?: string; montoPagado?: number };

// Ubicaciones para formularios. Se conserva el campo ciudad de Supabase.
const DEPARTAMENTOS_CO = ['Amazonas', 'Antioquia', 'Arauca', 'Atlántico', 'Bogotá D.C.', 'Bolívar', 'Boyacá', 'Caldas', 'Caquetá', 'Casanare', 'Cauca', 'Cesar', 'Chocó', 'Córdoba', 'Cundinamarca', 'Guainía', 'Guaviare', 'Huila', 'La Guajira', 'Magdalena', 'Meta', 'Nariño', 'Norte de Santander', 'Putumayo', 'Quindío', 'Risaralda', 'San Andrés y Providencia', 'Santander', 'Sucre', 'Tolima', 'Valle del Cauca', 'Vaupés', 'Vichada'];
const CIUDADES_CO: Record<string, string[]> = {
  'Amazonas': ['Leticia', 'Puerto Nariño'],
  'Antioquia': ['Medellín', 'Abejorral', 'Abriaquí', 'Alejandría', 'Amagá', 'Amalfi', 'Andes', 'Angelópolis', 'Angostura', 'Anorí', 'Anzá', 'Apartadó', 'Arboletes', 'Argelia', 'Armenia', 'Barbosa', 'Bello', 'Belmira', 'Betania', 'Betulia', 'Briceño', 'Buriticá', 'Cáceres', 'Caicedo', 'Caldas', 'Campamento', 'Cañasgordas', 'Caracolí', 'Caramanta', 'Carepa', 'Carolina del Príncipe', 'Caucasia', 'Chigorodó', 'Cisneros', 'Ciudad Bolívar', 'Cocorná', 'Concepción', 'Concordia', 'Copacabana', 'Dabeiba', 'Donmatías', 'Ebéjico', 'El Bagre', 'El Carmen de Viboral', 'El Peñol', 'El Retiro', 'El Santuario', 'Entrerríos', 'Envigado', 'Fredonia', 'Frontino', 'Giraldo', 'Girardota', 'Gómez Plata', 'Granada', 'Guadalupe', 'Guarne', 'Guatapé', 'Heliconia', 'Hispania', 'Itagüí', 'Ituango', 'Jardín', 'Jericó', 'La Ceja', 'La Estrella', 'La Pintada', 'La Unión', 'Liborina', 'Maceo', 'Marinilla', 'Montebello', 'Murindó', 'Mutatá', 'Nariño', 'Nechí', 'Necoclí', 'Olaya', 'Peque', 'Pueblorrico', 'Puerto Berrío', 'Puerto Nare', 'Puerto Triunfo', 'Remedios', 'Rionegro', 'Sabanalarga', 'Sabaneta', 'Salgar', 'San Andrés de Cuerquia', 'San Carlos', 'San Francisco', 'San Jerónimo', 'San José de la Montaña', 'San Juan de Urabá', 'San Luis', 'San Pedro de los Milagros', 'San Pedro de Urabá', 'San Rafael', 'San Roque', 'San Vicente Ferrer', 'Santa Bárbara', 'Santa Fe de Antioquia', 'Santa Rosa de Osos', 'Santo Domingo', 'Segovia', 'Sonsón', 'Sopetrán', 'Támesis', 'Tarazá', 'Tarso', 'Titiribí', 'Toledo', 'Turbo', 'Uramita', 'Urrao', 'Valdivia', 'Valparaíso', 'Vegachí', 'Venecia', 'Vigía del Fuerte', 'Yalí', 'Yarumal', 'Yolombó', 'Yondó', 'Zaragoza'],
  'Arauca': ['Arauca', 'Arauquita', 'Saravena', 'Tame'], 'Atlántico': ['Barranquilla', 'Baranoa', 'Galapa', 'Malambo', 'Puerto Colombia', 'Sabanalarga', 'Soledad'], 'Bogotá D.C.': ['Bogotá D.C.'],
  'Bolívar': ['Cartagena', 'Magangué', 'Mompox', 'Turbaco'], 'Boyacá': ['Tunja', 'Duitama', 'Sogamoso', 'Chiquinquirá', 'Paipa', 'Villa de Leyva'], 'Caldas': ['Manizales', 'Chinchiná', 'La Dorada', 'Riosucio', 'Villamaría'],
  'Caquetá': ['Florencia', 'San Vicente del Caguán'], 'Casanare': ['Yopal', 'Aguazul', 'Villanueva'], 'Cauca': ['Popayán', 'Santander de Quilichao', 'Puerto Tejada'], 'Cesar': ['Valledupar', 'Aguachica', 'Bosconia'],
  'Chocó': ['Quibdó', 'Istmina', 'Nuquí'], 'Córdoba': ['Montería', 'Cereté', 'Lorica', 'Montelíbano', 'Sahagún'], 'Cundinamarca': ['Soacha', 'Chía', 'Zipaquirá', 'Facatativá', 'Fusagasugá', 'Girardot', 'Mosquera', 'Madrid', 'Cajicá', 'Funza', 'La Calera', 'Tocancipá'],
  'Guainía': ['Inírida'], 'Guaviare': ['San José del Guaviare'], 'Huila': ['Neiva', 'Pitalito', 'Garzón', 'La Plata'], 'La Guajira': ['Riohacha', 'Maicao', 'Uribia', 'Fonseca'],
  'Magdalena': ['Santa Marta', 'Ciénaga', 'Fundación', 'Plato'], 'Meta': ['Villavicencio', 'Acacías', 'Granada', 'Puerto López'], 'Nariño': ['Pasto', 'Ipiales', 'Tumaco', 'Túquerres'], 'Norte de Santander': ['Cúcuta', 'Ocaña', 'Pamplona', 'Villa del Rosario', 'Los Patios'],
  'Putumayo': ['Mocoa', 'Puerto Asís', 'Orito'], 'Quindío': ['Armenia', 'Calarcá', 'Montenegro', 'Quimbaya'], 'Risaralda': ['Pereira', 'Dosquebradas', 'Santa Rosa de Cabal', 'La Virginia'],
  'San Andrés y Providencia': ['San Andrés', 'Providencia'], 'Santander': ['Bucaramanga', 'Floridablanca', 'Girón', 'Piedecuesta', 'Barrancabermeja', 'San Gil', 'Socorro'], 'Sucre': ['Sincelejo', 'Corozal', 'Sampués', 'Tolú'],
  'Tolima': ['Ibagué', 'Espinal', 'Melgar', 'Honda', 'Chaparral'], 'Valle del Cauca': ['Cali', 'Palmira', 'Buenaventura', 'Tuluá', 'Buga', 'Jamundí', 'Cartago', 'Yumbo'], 'Vaupés': ['Mitú'], 'Vichada': ['Puerto Carreño']
};
const inferDepartamento = (ciudad: string) => DEPARTAMENTOS_CO.find(d => (CIUDADES_CO[d] || []).some(c => c.toLocaleLowerCase('es') === ciudad.trim().toLocaleLowerCase('es'))) || '';
function SelectorUbicacion({ pais, departamento, ciudad, onDepartamento, onCiudad, estilo }: { pais: string; departamento: string; ciudad: string; onDepartamento: (v: string) => void; onCiudad: (v: string) => void; estilo?: React.CSSProperties }) {
  const colombia = pais === 'Colombia';
  const opciones = colombia && departamento ? (CIUDADES_CO[departamento] || []) : [];
  const otra = !!ciudad && !opciones.some(c => c.toLocaleLowerCase('es') === ciudad.toLocaleLowerCase('es'));
  return <>
    {colombia && <label className="field" style={estilo}>Departamento<select required value={departamento} onChange={e => { onDepartamento(e.target.value); onCiudad(''); }}><option value="">Selecciona un departamento</option>{DEPARTAMENTOS_CO.map(d => <option key={d} value={d}>{d}</option>)}</select></label>}
    <label className="field" style={estilo}>Ciudad / Municipio{colombia ? <><select required value={otra ? '__otra__' : ciudad} disabled={!departamento} onChange={e => onCiudad(e.target.value === '__otra__' ? '__otra__' : e.target.value)}><option value="">Selecciona una ciudad</option>{opciones.map(c => <option key={c} value={c}>{c}</option>)}<option value="__otra__">Otra ciudad / municipio…</option></select>{(otra || ciudad === '__otra__') && <input required placeholder="Escribe el nombre de tu municipio" value={ciudad === '__otra__' ? '' : ciudad} onChange={e => onCiudad(e.target.value)} style={{ marginTop: 8 }} />}</> : <input required value={ciudad} onChange={e => onCiudad(e.target.value)} placeholder="Escribe tu ciudad" />}</label>
  </>;
}

const initialProducts: Product[] = [
  { id: 'p1', sku: 'C2-F', name: 'Soporte TV inclinación 32–65 pulgadas', price: 18800, iva: 0, stock: 0, barcode: 'C2-F', category: 'Tecnología' },
  { id: 'p2', sku: 'KY-03', name: 'Soporte TV 40–80 pulgadas', price: 20000, iva: 0, stock: 0, barcode: 'KY-03', category: 'Tecnología' },
  { id: 'p3', sku: 'B2-14', name: 'Set para hacer pulseras', price: 4800, iva: 0, stock: 0, barcode: 'B2-14', category: 'Juguetes niñas' },
  { id: 'p4', sku: 'RC415', name: 'Tortuga armable 18 × 13 cm', price: 10000, iva: 0, stock: 0, barcode: 'RC415', category: 'Didácticos' },
  { id: 'p5', sku: '0818-7B', name: 'Bicicleta metálica caja x12', price: 18300, iva: 0, stock: 0, barcode: '0818-7B', category: 'Vehículos y animales' },
  { id: 'p6', sku: 'GM253-25', name: 'Extensión 6 FT', price: 4200, iva: 0, stock: 0, barcode: 'GM253-25', category: 'Cacharrería y papelería' },
  { id: 'p7', sku: 'LH-088', name: 'Toalla para lavar brochas', price: 10500, iva: 0, stock: 0, barcode: 'LH-088', category: 'Maquillaje y belleza' },
  { id: 'p8', sku: 'CMS-0056', name: 'Plancha Radiance', price: 160000, iva: 0, stock: 0, barcode: 'CMS-0056', category: 'Profesional de la belleza' },
  { id: 'p9', sku: '12ZR011', name: 'Morral surtido', price: 52500, iva: 0, stock: 0, barcode: '12ZR011', category: 'Bolsos, carteras, medias y gafas' },
  { id: 'p10', sku: '661', name: 'Lanzadora en hidrogel', price: 110300, iva: 0, stock: 0, barcode: '661', category: 'Personajes y bebés' },
];
const categories = [
  { name: 'Tecnología', icon: '🎧', description: 'Soportes, audio y accesorios', shade: '#ece5f9' },
  { name: 'Juegos', icon: '🎲', description: 'Juegos y entretenimiento', shade: '#fae7e9' },
  { name: 'Didácticos', icon: '🧩', description: 'Aprendizaje y creatividad', shade: '#e4f2ed' },
  { name: 'Vehículos y animales', icon: '🚗', description: 'Vehículos, figuras y animales', shade: '#e4edf8' },
  { name: 'Juguetes niñas', icon: '🎀', description: 'Juguetes y accesorios', shade: '#f9e7f2' },
  { name: 'Cacharrería y papelería', icon: '🎁', description: 'Hogar, papelería, fiestas y llaveros', shade: '#f5ebdd' },
  { name: 'Personajes y bebés', icon: '🧸', description: 'Infantil y personajes', shade: '#f2e4f0' },
  { name: 'Maquillaje y belleza', icon: '💄', description: 'Maquillaje y accesorios', shade: '#fce8ef' },
  { name: 'Profesional de la belleza', icon: '✂️', description: 'Equipos y herramientas profesionales', shade: '#f0e9fc' },
  { name: 'Bolsos, carteras, medias y gafas', icon: '👜', description: 'Moda y accesorios', shade: '#e8f2f7' },
];
const permissions = ['Crear pedidos', 'Negociar precios', 'Consultar inventario', 'Subir catálogos', 'Editar productos', 'Modificar precios oficiales', 'Eliminar productos', 'Gestionar bodega', 'Imprimir etiquetas', 'Consultar todos los pedidos'];
const money = (n: number) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n || 0);
const read = <T,>(key: string, fallback: T): T => { try { const value = localStorage.getItem(key); return value ? JSON.parse(value) : fallback; } catch { return fallback; } };
const blankProduct = (): Product => ({ id: '', sku: '', name: '', price: 0, iva: 0, stock: 0, barcode: '', category: 'Tecnología', image: '' });
const blankWorker = (): Worker => ({ id: '', name: '', document: '', phone: '', email: '', employeeCode: '', role: 'Vendedor de ruta', enabled: true, permissions: ['Crear pedidos', 'Negociar precios'] });
const blankClient = (): Client => ({ id: '', name: '', document: '', phone: '', country: 'Colombia', dialCode: '+57', email: '', city: '', address: '', enabled: true, access: 'Pendiente de invitación' });
const blankCustomer = () => ({ customer: '', phone: '', city: '', address: '', email: '' });

// Logo oficial: guardar jaivisa-logo.webp dentro de la carpeta public.
const JAIVISA_LOGO = '/jaivisa-logo.webp';
const menuIcons: Record<string, string> = { "Inicio": "<path d=\"m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z\"/>", "Catálogo": "<rect x=\"3\" y=\"4\" width=\"18\" height=\"16\" rx=\"2\"/><path d=\"M3 10h18M9 10v10\"/>", "Productos": "<path d=\"m12 2 9 5-9 5-9-5 9-5zM3 7v10l9 5 9-5V7M12 12v10\"/>", "Empleados": "<circle cx=\"9\" cy=\"8\" r=\"3\"/><path d=\"M3 20v-2a6 6 0 0 1 12 0v2M17 5a3 3 0 0 1 0 6M19 14a5 5 0 0 1 2 4v2\"/>", "Clientes": "<rect x=\"3\" y=\"4\" width=\"18\" height=\"17\" rx=\"2\"/><path d=\"M7 9h10M7 13h10M7 17h5\"/>", "Accesos": "<circle cx=\"8\" cy=\"15\" r=\"4\"/><path d=\"m11 12 9-9 2 2-3 3 2 2-3 3-2-2-3 3\"/>", "Permisos": "<path d=\"M12 2 4 5v6c0 5 3 8 8 11 5-3 8-6 8-11V5z\"/><path d=\"m9 12 2 2 4-4\"/>", "Carrito": "<circle cx=\"9\" cy=\"20\" r=\"1\"/><circle cx=\"19\" cy=\"20\" r=\"1\"/><path d=\"M2 3h2l3 13h12l3-9H5\"/>", "Pedidos": "<rect x=\"5\" y=\"4\" width=\"14\" height=\"18\" rx=\"2\"/><path d=\"M9 4V2h6v2M9 10h6M9 14h6\"/>", "Bodega": "<path d=\"m3 9 9-6 9 6v12H3zM3 9h18M8 21v-9h8v9\"/>", "Etiquetas": "<path d=\"M3 3h9l9 9-9 9-9-9z\"/><circle cx=\"8\" cy=\"8\" r=\"1\"/>", "Catálogos PDF": "<path d=\"M6 2h9l5 5v15H6zM15 2v5h5M9 13h8M9 17h6\"/>" };
function NavIcon({ name }: { name: string }) {
  return <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" dangerouslySetInnerHTML={{ __html: menuIcons[name] || menuIcons['Inicio'] }} />;
}


type CatalogoPDF = { nombre: string; ruta: string; url: string; tamano: string };
const BUCKET_CATALOGOS = 'jaivisa-catalogos';
async function listarCatalogosJAIVISA(): Promise<CatalogoPDF[]> {
  const { data, error } = await supabase.storage.from(BUCKET_CATALOGOS).list('', { limit: 100, sortBy: { column: 'name', order: 'asc' } });
  if (error) throw new Error(error.message);
  const pdfs = (data || []).filter(f => f.name.toLowerCase().endsWith('.pdf'));
  const items = await Promise.all(pdfs.map(async f => {
    const { data: enlace, error: err } = await supabase.storage.from(BUCKET_CATALOGOS).createSignedUrl(f.name, 3600);
    if (err || !enlace?.signedUrl) return null;
    return { nombre: f.name.replace(/^\d{13}-/, '').replace(/_/g, ' '), ruta: f.name, url: enlace.signedUrl, tamano: ((f.metadata?.size || 0) / 1048576).toFixed(1) + ' MB' };
  }));
  return items.filter((c): c is CatalogoPDF => Boolean(c));
}
function nombreCatalogoLimpio(nombre: string) { return nombre.replace(/\.pdf$/i, '').replace(/(?:[ _-]+pdf)$/i, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim(); }

// Miniaturas reales de la primera página del PDF (PDF.js).
// No guarda ni modifica los archivos de Supabase.
let jaivisaPdfJsCarga: Promise<any> | null = null;
function cargarPdfJsJAIVISA(): Promise<any> {
  if (jaivisaPdfJsCarga) return jaivisaPdfJsCarga;
  jaivisaPdfJsCarga = new Promise((resolve, reject) => {
    const existente = (window as any).pdfjsLib;
    if (existente) { resolve(existente); return; }
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    script.async = true;
    script.onload = () => {
      const pdfjs = (window as any).pdfjsLib;
      if (!pdfjs) { reject(new Error('No se pudo iniciar el lector PDF')); return; }
      pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      resolve(pdfjs);
    };
    script.onerror = () => reject(new Error('No se pudo descargar el lector PDF'));
    document.head.appendChild(script);
  }).catch(err => { jaivisaPdfJsCarga = null; throw err; });
  return jaivisaPdfJsCarga;
}
function MiniaturaCatalogoJAIVISA({ url, nombre }: { url: string; nombre: string }) {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const contenedorRef = React.useRef<HTMLDivElement | null>(null);
  const [estado, setEstado] = useState<'esperando' | 'cargando' | 'lista' | 'error'>('esperando');
  useEffect(() => {
    let cancelado = false;
    let tarea: any = null;
    let documento: any = null;
    let render: any = null;
    const contenedor = contenedorRef.current;
    if (!contenedor) return;
    const mostrar = async () => {
      setEstado('cargando');
      try {
        const pdfjs = await cargarPdfJsJAIVISA();
        if (cancelado) return;
        tarea = pdfjs.getDocument({ url, withCredentials: false });
        documento = await tarea.promise;
        if (cancelado) return;
        const pagina = await documento.getPage(1);
        if (cancelado) return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        const base = pagina.getViewport({ scale: 1 });
        const ancho = Math.min(440, Math.max(200, contenedor.clientWidth * 2));
        const viewport = pagina.getViewport({ scale: ancho / base.width });
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas no disponible');
        render = pagina.render({ canvasContext: ctx, viewport });
        await render.promise;
        if (!cancelado) setEstado('lista');
      } catch (err) {
        if (!cancelado) setEstado('error');
      } finally {
        if (documento) { try { await documento.destroy() } catch { } }
      }
    };
    const observador = new IntersectionObserver(entradas => {
      if (entradas.some(e => e.isIntersecting)) { observador.disconnect(); void mostrar(); }
    }, { rootMargin: '180px' });
    observador.observe(contenedor);
    return () => {
      cancelado = true;
      observador.disconnect();
      if (render) { try { render.cancel() } catch { } }
      if (tarea) { try { tarea.destroy() } catch { } }
    };
  }, [url]);
  return <div ref={contenedorRef} className="jv-catalog-cover jv-catalog-thumb" aria-label={'Portada de ' + nombre}>
    <canvas ref={canvasRef} style={{ display: estado === 'lista' ? 'block' : 'none' }} aria-hidden="true" />
    {estado !== 'lista' && <div className="jv-catalog-thumb-fallback">
      <span aria-hidden="true" style={{ fontSize: 35 }}>▤</span>
      <small>{estado === 'error' ? 'Vista previa no disponible' : estado === 'cargando' ? 'Generando miniatura…' : 'PDF'}</small>
    </div>}
  </div>;
}

function GaleriaCatalogos({ catalogos, eliminar }: { catalogos: CatalogoPDF[]; eliminar?: (ruta: string) => void }) {
  if (!catalogos.length) return <p style={{ padding: '22px 0', color: '#746080' }}>Todavía no hay catálogos publicados.</p>;
  return <div className="jv-catalog-grid">{catalogos.map(c => <article key={c.ruta} className="jv-catalog-card">
    <MiniaturaCatalogoJAIVISA url={c.url} nombre={c.nombre} />
    <div style={{ padding: 16, display: 'grid', gap: 9 }}><strong style={{ overflowWrap: 'anywhere', color: '#38134f' }}>{nombreCatalogoLimpio(c.nombre)}</strong>
      <a href={c.url} target="_blank" rel="noreferrer" className="jv-catalog-open">Abrir catálogo ↗</a>
      {eliminar && <button type="button" className="jv-catalog-delete" onClick={() => eliminar(c.ruta)}>Eliminar catálogo</button>}
    </div></article>)}</div>;
}
function CatalogosVistaPrevia() {
  const [catalogos, setCatalogos] = useState<CatalogoPDF[]>([]);
  const [mensaje, setMensaje] = useState('');
  const [cargando, setCargando] = useState(true);
  const [subiendo, setSubiendo] = useState(false);
  const actualizar = async () => { setCargando(true); try { setCatalogos(await listarCatalogosJAIVISA()); setMensaje(''); } catch (e: any) { setMensaje('No fue posible consultar los catálogos de JAIVISA. Verifica la configuración del módulo: ' + e.message); } finally { setCargando(false) } };
  useEffect(() => { void actualizar() }, []);
  const subir = async (files: FileList | null) => {
    if (!files?.length) return;
    setSubiendo(true); setMensaje('');
    let subidos = 0; let errores: string[] = [];
    for (const f of Array.from(files)) {
      if (!f.name.toLowerCase().endsWith('.pdf') || f.size > 50 * 1048576) { errores.push(f.name + ' (debe ser PDF de máximo 50 MB)'); continue; }
      const nombreSeguro = f.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9._-]/g, '_');
      const ruta = Date.now() + '-' + nombreSeguro;
      const { error } = await supabase.storage.from(BUCKET_CATALOGOS).upload(ruta, f, { contentType: 'application/pdf', upsert: false });
      if (error) errores.push(f.name + ': ' + error.message); else subidos++;
    }
    setSubiendo(false); await actualizar();
    setMensaje((subidos ? subidos + ' catálogo(s) publicado(s). ' : '') + (errores.length ? 'No se pudo subir: ' + errores.join('; ') : ''));
  };
  const eliminar = async (ruta: string) => {
    if (!window.confirm('¿Eliminar este catálogo de JAIVISA?')) return;
    const { error } = await supabase.storage.from(BUCKET_CATALOGOS).remove([ruta]);
    if (error) { setMensaje('No se pudo eliminar: ' + error.message); return; }
    await actualizar(); setMensaje('Catálogo eliminado.');
  };
  return <section className="panel"><h3>📚 Catálogos PDF · publicación para clientes</h3>
    <p className="muted">Sube catálogos PDF. Los clientes autorizados los verán primero al iniciar sesión. La primera página se muestra como portada cuando el navegador permite la vista previa.</p>
    <label className="field" style={{ maxWidth: 500 }}>Subir catálogos PDF (hasta 50 MB por archivo)
      <input type="file" accept=".pdf,application/pdf" multiple disabled={subiendo} onChange={e => { void subir(e.target.files); e.target.value = ''; }} />
    </label>
    {subiendo && <p role="status">Cargando catálogos de JAIVISA…</p>}
    {mensaje && <p className="notice" role="status">{mensaje}</p>}
    {cargando ? <p>Cargando catálogos…</p> : <GaleriaCatalogos catalogos={catalogos} eliminar={eliminar} />}
    <p className="muted" style={{ marginTop: 15 }}>Los catálogos se almacenan de forma segura en JAIVISA. Su publicación requiere que el módulo de documentos esté habilitado. Los enlaces de consulta vencen después de una hora.</p>
  </section>;
}

function PortalAdministrador() {
  type ThemeSettings = { primary: string; accent: string; surface: string; font: string; style: string };
  const defaultTheme: ThemeSettings = { primary: '#4c1d69', accent: '#9d65d1', surface: '#faf8fd', font: 'Inter', style: 'Moderno' };
  const [departamentoCliente, setDepartamentoCliente] = useState('');
  const [themeSettings, setThemeSettings] = useState<ThemeSettings>(() => {
    try { return { ...defaultTheme, ...JSON.parse(localStorage.getItem('jaivisa_theme_v1') || '{}') }; }
    catch { return defaultTheme; }
  });
  const [themeDraft, setThemeDraft] = useState<ThemeSettings>(themeSettings);
  const saveTheme = () => { try { localStorage.setItem('jaivisa_theme_v1', JSON.stringify(themeDraft)); setThemeSettings(themeDraft); alert('Diseño guardado en este navegador.'); } catch { alert('No se pudo guardar el diseño.'); } };
  const resetTheme = () => { setThemeDraft(defaultTheme); setThemeSettings(defaultTheme); try { localStorage.removeItem('jaivisa_theme_v1'); } catch { } };
  const themeFont = (font: string) => ({ Inter: 'Inter, system-ui, sans-serif', Montserrat: 'Montserrat, system-ui, sans-serif', Poppins: 'Poppins, system-ui, sans-serif', Arial: 'Arial, sans-serif' } as Record<string, string>)[font] || 'system-ui, sans-serif';
  const [bannerImage, setBannerImage] = useState<string>(() => { try { return localStorage.getItem('jaivisa_banner_v1') || ''; } catch { return ''; } });
  const [bannerError, setBannerError] = useState('');
  const uploadBanner = (file?: File) => {
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { setBannerError('Selecciona una imagen JPG, PNG o WebP.'); return; }
    if (file.size > 5 * 1024 * 1024) { setBannerError('La imagen debe pesar menos de 5 MB.'); return; }
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      const maxWidth = 1400;
      const scale = Math.min(1, maxWidth / img.width);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale); canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) { setBannerError('No se pudo procesar la imagen.'); URL.revokeObjectURL(objectUrl); return; }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const data = canvas.toDataURL('image/webp', 0.76);
      try { localStorage.setItem('jaivisa_banner_v1', data); setBannerImage(data); setBannerError(''); }
      catch { setBannerError('La imagen es demasiado grande para guardarla en este navegador. Prueba una imagen más pequeña.'); }
      URL.revokeObjectURL(objectUrl);
    };
    img.onerror = () => { setBannerError('No se pudo abrir la imagen.'); URL.revokeObjectURL(objectUrl); };
    img.src = objectUrl;
  };
  const removeBanner = () => { try { localStorage.removeItem('jaivisa_banner_v1'); } catch { } setBannerImage(''); setBannerError(''); };
  const [page, setPage] = useState('Inicio');
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const [products, setProducts] = useState<Product[]>(() => read('jaivisa_portal_products_v2', initialProducts));
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [workersLoading, setWorkersLoading] = useState(false);
  const [workerSaving, setWorkerSaving] = useState(false);
  const [workerNotice, setWorkerNotice] = useState('');
  const [clients, setClients] = useState<Client[]>([]);
  const [clientsLoading, setClientsLoading] = useState(false);
  const [clientSaving, setClientSaving] = useState(false);
  const [client, setClient] = useState<Client>(blankClient);
  const [clientNotice, setClientNotice] = useState('');
  const [orders, setOrders] = useState<Order[]>(() => read('j360_orders', []));
  type DestinatarioWA = { id: number; nombre: string; telefono: string; activo: boolean };
  const [destinatariosWA, setDestinatariosWA] = useState<DestinatarioWA[]>([]);
  const [waCargando, setWaCargando] = useState(false);
  const [waMensaje, setWaMensaje] = useState('');
  const [waNombre, setWaNombre] = useState('');
  const [waTelefono, setWaTelefono] = useState('+57');
  const cargarDestinatariosWA = async () => {
    setWaCargando(true);
    const { data, error } = await supabase.from('jaivisa_whatsapp_destinatarios').select('id,nombre,telefono,activo').order('id');
    setWaCargando(false);
    if (error) { setWaMensaje('No se pudo consultar la configuración. Solicita a Administración que revise la configuración del módulo.'); return; }
    setDestinatariosWA((data || []) as DestinatarioWA[]);
    setWaMensaje('');
  };
  useEffect(() => { void cargarDestinatariosWA(); }, []);
  const guardarDestinatarioWA = async () => {
    const telefono = waTelefono.replace(/[\s()\-]/g, '');
    if (!waNombre.trim() || !/^\+[1-9][0-9]{7,14}$/.test(telefono)) { setWaMensaje('Escribe un nombre y un número internacional válido, por ejemplo +573001234567.'); return; }
    const { error } = await supabase.from('jaivisa_whatsapp_destinatarios').insert({ nombre: waNombre.trim(), telefono, activo: true });
    if (error) { setWaMensaje('No se pudo guardar: ' + error.message); return; }
    setWaNombre(''); setWaTelefono('+57'); await cargarDestinatariosWA();
  };
  const actualizarDestinatarioWA = async (d: DestinatarioWA, cambios: Partial<DestinatarioWA>) => {
    const { error } = await supabase.from('jaivisa_whatsapp_destinatarios').update(cambios).eq('id', d.id);
    if (error) { setWaMensaje('No se pudo actualizar: ' + error.message); return; }
    await cargarDestinatariosWA();
  };
  const eliminarDestinatarioWA = async (d: DestinatarioWA) => {
    if (!window.confirm('¿Eliminar el número de ' + d.nombre + '?')) return;
    const { error } = await supabase.from('jaivisa_whatsapp_destinatarios').delete().eq('id', d.id);
    if (error) { setWaMensaje('No se pudo eliminar: ' + error.message); return; }
    await cargarDestinatariosWA();
  };

  const [product, setProduct] = useState<Product>(blankProduct);
  const [worker, setWorker] = useState<Worker>(blankWorker);
  const [cart, setCart] = useState<Line[]>([]);
  const [selectedQty, setSelectedQty] = useState<Record<string, number>>({});
  const [customer, setCustomer] = useState(blankCustomer);
  const [selectedWorker, setSelectedWorker] = useState('');
  const [selectedOrder, setSelectedOrder] = useState('');
  const [labelCount, setLabelCount] = useState(1);
  const [labelType, setLabelType] = useState('Brother QL-800 · Adhesiva');
  const [sound, setSound] = useState(false);
  useEffect(() => { try { localStorage.setItem('jaivisa_portal_products_v2', JSON.stringify(products)); } catch (e) { console.warn('JAIVISA: almacenamiento local no disponible', e); } }, [products]);
  // Los empleados se consultan en Supabase; no se guardan en localStorage.
  // Los clientes se consultan en Supabase; no se almacenan contraseñas ni directorios en localStorage.
  useEffect(() => { try { localStorage.setItem('j360_orders', JSON.stringify(orders)); } catch (e) { console.warn('JAIVISA: almacenamiento local no disponible', e); } }, [orders]);
  const selected = workers.find(w => w.id === selectedWorker);
  const chosenOrder = orders.find(o => o.id === selectedOrder) || orders[0];
  const subtotal = cart.reduce((s, l) => s + l.qty * l.price, 0);
  const iva = cart.reduce((s, l) => s + l.qty * l.price * ((products.find(p => p.id === l.productId)?.iva || 0) / 100), 0);
  const getProduct = (id: string) => products.find(p => p.id === id);
  const addToCart = (p: Product) => { const qty = Math.max(1, Math.floor(selectedQty[p.id] || 1)); setCart(old => old.some(l => l.productId === p.id) ? old.map(l => l.productId === p.id ? { ...l, qty: l.qty + qty } : l) : [...old, { productId: p.id, qty, price: p.price }]); };
  const setQty = (id: string, qty: number) => setSelectedQty(old => ({ ...old, [id]: Math.max(1, Math.min(99999, Math.floor(Number(qty) || 1))) }));
  const updateLine = (id: string, patch: Partial<Line>) => setCart(old => old.map(l => l.productId === id ? { ...l, ...patch } : l));
  const saveProduct = (e: React.FormEvent) => { e.preventDefault(); if (!product.name.trim() || !product.sku.trim()) return; const p = { ...product, id: product.id || crypto.randomUUID(), price: Math.max(0, Number(product.price)), stock: Math.max(0, Number(product.stock)) }; setProducts(old => product.id ? old.map(x => x.id === product.id ? p : x) : [...old, p]); setProduct(blankProduct()); };
  const cargoSupabase = (cargo: string) => /bodega|despachos/i.test(cargo) ? 'bodega' : 'vendedor';
  const cargarEmpleados = async () => {
    setWorkersLoading(true);
    try {
      const result = await administrarClientes({ accion: 'listar_empleados' });
      const rows: any[] = Array.isArray(result.empleados) ? result.empleados : [];
      setWorkers(rows.map((r): Worker => ({
        id: String(r.id), name: r.nombre || '', document: r.documento || '', phone: r.telefono || '',
        email: r.correo || '', employeeCode: r.codigo || '', role: r.cargo === 'bodega' ? 'Auxiliar de bodega' : 'Vendedor de ruta',
        enabled: r.aprobado === true, permissions: (() => { try { return Array.isArray(r.permisos) ? r.permisos : JSON.parse(r.permisos || '[]') } catch { return [] } })()
      })));
      setWorkerNotice('');
    } catch (e: any) { setWorkerNotice('No se pudieron consultar los empleados: ' + (e?.message || 'Error desconocido')); }
    finally { setWorkersLoading(false) }
  };
  useEffect(() => { if (page === 'Empleados' || page === 'Permisos') void cargarEmpleados() }, [page]);
  const saveWorker = async (e: React.FormEvent) => {
    e.preventDefault(); if (workerSaving) return;
    if (!worker.name.trim() || !worker.email?.trim()) { setWorkerNotice('Nombre y correo laboral son obligatorios.'); return; }
    const payload: Record<string, unknown> = {      
accion: worker.id ? 'actualizar_empleado' : 'crear_empleado',
      nombre: worker.name.trim(), correo: worker.email.trim().toLowerCase(), documento: worker.document.trim(),
      telefono: worker.phone.trim(), cargo: cargoSupabase(worker.role), codigo: worker.employeeCode || '', permisos: JSON.stringify(worker.permissions)    
};
    if (worker.id) payload.id = worker.id;
    else {
      const password = window.prompt('Contraseña inicial del empleado (mínimo 8 caracteres). Comunícala por un canal seguro.');
      if (password === null) return;
      if (password.length < 8) { setWorkerNotice('La contraseña debe tener al menos 8 caracteres.'); return; }
      payload.password = password;
    }
    setWorkerSaving(true); setWorkerNotice('Guardando información en JAIVISA…');
    try { const result = await administrarClientes(payload); setWorker(blankWorker()); await cargarEmpleados(); setWorkerNotice(result.mensaje || 'Empleado guardado.'); }
    catch (e: any) { setWorkerNotice('No se pudo guardar: ' + (e?.message || 'Error desconocido')); }
    finally { setWorkerSaving(false) }
  };
  const cambiarEstadoEmpleado = async (w: Worker) => {
    if (!window.confirm(`¿${w.enabled ? 'Suspender' : 'Activar'} el acceso de ${w.name}?`)) return;
    try { const r = await administrarClientes({ accion: 'cambiar_estado_empleado', id: w.id, aprobado: !w.enabled }); await cargarEmpleados(); setWorkerNotice(r.mensaje || 'Estado actualizado.'); }
    catch (e: any) { setWorkerNotice('No se pudo cambiar el estado: ' + (e?.message || 'Error desconocido')); }
  };
  const cambiarClaveEmpleado = async () => {
    if (!worker.id) { setWorkerNotice('Primero selecciona Editar en un empleado.'); return; }
    const password = window.prompt('Nueva contraseña (mínimo 8 caracteres) para ' + worker.name);
    if (password === null) return;
    if (password.length < 8) { setWorkerNotice('La contraseña debe tener al menos 8 caracteres.'); return; }
    try { const r = await administrarClientes({ accion: 'cambiar_clave_empleado', id: worker.id, password }); setWorkerNotice(r.mensaje || 'Contraseña actualizada.'); }
    catch (e: any) { setWorkerNotice('No se pudo cambiar la contraseña: ' + (e?.message || 'Error desconocido')); }
  };
  const cambiarPermisoEmpleado = async (w: Worker, permiso: string) => {
    const nuevos = w.permissions.includes(permiso) ? w.permissions.filter(p => p !== permiso) : [...w.permissions, permiso];
    try { await administrarClientes({ accion: 'actualizar_empleado', id: w.id, permisos: JSON.stringify(nuevos) }); await cargarEmpleados(); }
    catch (e: any) { setWorkerNotice('No se pudo guardar el permiso: ' + (e?.message || 'Error desconocido')); }
  };
  // Todas las operaciones de clientes pasan por la función protegida de Supabase.
  const administrarClientes = async (payload: Record<string, unknown>) => {
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (sessionError || !token) throw new Error('Tu sesión terminó. Vuelve a iniciar sesión como administrador.');
    const { data, error } = await supabase.functions.invoke('administrar-clientes', {
      body: payload,
      headers: { Authorization: `Bearer ${token}` },
    });
    if (error) {
      let message = error.message || 'No fue posible conectar con los servicios de JAIVISA.';
      const context = (error as any).context;
      if (context && typeof context.json === 'function') {
        try { const details = await context.json(); message = details?.error || message; } catch { /* Respuesta no JSON */ }
      }
      throw new Error(message);
    }
    if (!data?.ok) throw new Error(data?.error || 'La operación no se completó.');
    return data;
  };
  const cargarClientes = async () => {
    setClientsLoading(true);
    try {
      const result = await administrarClientes({ accion: 'listar' });
      const rows: any[] = Array.isArray(result.clientes) ? result.clientes : [];
      setClients(rows.map((r): Client => ({
        id: String(r.id), name: r.nombre || '', document: r.documento || '',
        phone: r.telefono || '', country: 'Colombia', dialCode: '+57',
        email: r.correo || '', city: r.ciudad || '', address: r.direccion || '',
        enabled: r.aprobado === true,
        access: r.aprobado === true ? 'Activo' : 'Suspendido',
      })));
    } catch (e: any) { setClientNotice('No fue posible consultar la información de JAIVISA: ' + (e?.message || 'Error desconocido')); }
    finally { setClientsLoading(false); }
  };
  useEffect(() => { if (page === 'Clientes') void cargarClientes(); }, [page]);
  const saveClient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (clientSaving || !client.name.trim() || !client.email.trim()) return;
    if (!client.city.trim() || client.city === '__otra__') { setClientNotice('Selecciona o escribe una ciudad válida.'); return; }
    const email = client.email.trim().toLowerCase();
    const duplicate = clients.find(c => c.id !== client.id && c.email.trim().toLowerCase() === email);
    if (duplicate) { setClientNotice('Ese correo ya pertenece a otro cliente.'); return; }
    const digits = client.phone.replace(/\D/g, '');
    const dial = (client.dialCode || '+57').replace(/\D/g, '');
    const phone = digits ? '+' + (digits.startsWith(dial) && digits.length > dial.length + 6 ? digits : dial + digits) : '';
    const payload: Record<string, unknown> = {
      accion: client.id ? 'actualizar' : 'crear',
      nombre: client.name.trim(), documento: client.document.trim(),
      telefono: phone, ciudad: client.city.trim(), direccion: client.address.trim(), correo: email,
    };
    if (client.id) payload.id = client.id;
    else {
      const password = window.prompt('Escribe una contraseña inicial de al menos 8 caracteres para este cliente. No se guardará en el navegador. Comunícala al cliente por un canal seguro.');
      if (password === null) return;
      if (password.length < 8) { setClientNotice('La contraseña inicial debe tener al menos 8 caracteres.'); return; }
      payload.password = password;
    }
    setClientSaving(true);
    setClientNotice('Guardando información en JAIVISA…');
    try {
      const result = await administrarClientes(payload);
      setClient(blankClient());
      await cargarClientes();
      setClientNotice(result.mensaje || 'Cliente guardado correctamente en JAIVISA.');
    } catch (e: any) { setClientNotice('No se pudo guardar: ' + (e?.message || 'Error desconocido')); }
    finally { setClientSaving(false); }
  };
  const cambiarEstadoCliente = async (c: Client) => {
    if (!window.confirm(`¿${c.enabled ? 'Desactivar' : 'Activar'} el acceso de ${c.name}?`)) return;
    try { const r = await administrarClientes({ accion: 'cambiar_estado', id: c.id, aprobado: !c.enabled }); await cargarClientes(); setClientNotice(r.mensaje); }
    catch (e: any) { setClientNotice('No se pudo cambiar el estado: ' + (e?.message || 'Error desconocido')); }
  };
  const cambiarClaveCliente = async () => {
    if (!client.id) { setClientNotice('Primero pulsa Editar en el cliente al que deseas cambiar la contraseña.'); return; }
    const password = window.prompt('Nueva contraseña para ' + client.name + ' (mínimo 8 caracteres):');
    if (password === null) return;
    if (password.length < 8) { setClientNotice('La contraseña debe tener al menos 8 caracteres.'); return; }
    try { const r = await administrarClientes({ accion: 'cambiar_clave', id: client.id, password }); setClientNotice(r.mensaje + '. Comunica la nueva clave de forma segura.'); }
    catch (e: any) { setClientNotice('No se pudo cambiar la contraseña: ' + (e?.message || 'Error desconocido')); }
  };
  const editClient = (c: Client) => { setDepartamentoCliente(inferDepartamento(c.city)); setClient({ ...c }); setClientNotice('Estás editando a ' + c.name + '. Modifica los campos y pulsa Guardar cambios.'); document.getElementById('jaivisa-client-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  const saveOrder = async () => {
    if (!customer.customer.trim() || !cart.length) { alert('Indica el cliente y agrega productos.'); return; }
    try {
      const pedido = await crearPedidoCentral({ cliente_nombre: customer.customer, cliente_telefono: customer.phone, cliente_correo: customer.email, ciudad: customer.city, direccion: customer.address, lineas: cart.map(l => { const p = products.find(x => x.id === l.productId); return { productId: l.productId, sku: p?.sku || '', nombre: p?.name || 'Producto', imagen: p?.image || '', cantidad: l.qty, precio: l.price, iva: p?.iva || 0 }; }) });
      setCart([]); setCustomer(blankCustomer()); setPage('Centro de Pedidos'); alert('Pedido #' + pedido.numero + ' guardado correctamente en JAIVISA.');
    } catch (e: any) { alert('No se pudo guardar el pedido: ' + (e?.message || e)); }
  };
  const changeStatus = (id: string, status: string) => setOrders(old => old.map(o => o.id === id ? { ...o, status } : o));
  const totalPedido = (o: Order) => o.lines.reduce((total, l) => total + l.qty * l.price * (1 + (products.find(p => p.id === l.productId)?.iva || 0) / 100), 0);
  const esVentaEfectiva = (o: Order) => o.pago === 'pagado';
  const registrarPago = (o: Order, estadoPago: 'pendiente' | 'parcial' | 'pagado') => {
    if (estadoPago === 'pagado' && !window.confirm('¿Confirmas que JAIVISA recibió el pago TOTAL de este pedido?')) return;
    const monto = estadoPago === 'pagado' ? totalPedido(o) : estadoPago === 'pendiente' ? 0 : Math.min(totalPedido(o), Number(window.prompt('¿Cuánto dinero se ha recibido en total para este pedido?', String(o.montoPagado || 0)) || 0));
    if (!Number.isFinite(monto) || monto < 0) { alert('Valor no válido.'); return; }
    setOrders(old => old.map(x => x.id === o.id ? { ...x, pago: estadoPago, montoPagado: monto, fechaPago: estadoPago === 'pagado' ? new Date().toISOString() : undefined } : x));
  };
  const compartirWhatsApp = (o: Order, d: DestinatarioWA) => {
    const resumen = o.lines.map(l => { const p = products.find(x => x.id === l.productId); return `• ${l.qty} × ${p?.name || l.productId} (${p?.sku || 'Sin referencia'})`; }).join('\n');
    const texto = `JAIVISA · PEDIDO ${o.id}\nCliente: ${o.customer}\nCiudad: ${o.city}\nDirección: ${o.address}\nTeléfono: ${o.phone}\n\nPRODUCTOS\n${resumen}\n\nTotal aproximado: ${money(totalPedido(o))}\nPago: ${o.pago === 'pagado' ? 'Pagado' : o.pago === 'parcial' ? 'Parcial' : 'Pendiente'}\n\nLa orden ilustrada se imprime o guarda como PDF desde JAIVISA y se adjunta manualmente al chat.`;
    window.open(`https://wa.me/${d.telefono.replace(/\D/g, '')}?text=${encodeURIComponent(texto)}`, '_blank', 'noopener,noreferrer');
  };
  const imprimirOrdenIlustrada = (o: Order) => {
    const safe = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c));
    const filas = o.lines.map(l => {
      const p = products.find(x => x.id === l.productId);
      const foto = p?.image && /^(https?:\/\/|data:image\/(png|jpeg|webp);base64,)/i.test(p.image) ? `<img src="${safe(p.image)}" alt="Producto"/>` : '<div class="sinFoto">Sin foto</div>';
      return `<tr><td>${foto}</td><td><strong>${safe(p?.name || 'Producto')}</strong><br/><small>Ref.: ${safe(p?.sku || l.productId)}</small></td><td>${l.qty}</td><td>${safe(money(l.price))}</td></tr>`;
    }).join('');
    const w = window.open('', '_blank');
    if (!w) { alert('Habilita las ventanas emergentes para imprimir el pedido.'); return; }
    w.document.write(`<!doctype html><html lang="es"><head><meta charset="UTF-8"/><title>JAIVISA - Orden ${safe(o.id)}</title><style>body{font:14px Arial,sans-serif;color:#30203c;margin:28px}h1{color:#56217a}header{border-bottom:3px solid #8a4db3;margin-bottom:20px}table{border-collapse:collapse;width:100%;margin-top:20px}td,th{padding:12px;border-bottom:1px solid #e6dcef;text-align:left;vertical-align:middle}th{background:#f3ebfa}img,.sinFoto{width:90px;height:90px;object-fit:contain}.sinFoto{display:grid;place-items:center;background:#eee;color:#777;font-size:11px}small{color:#6e6080}.nota{background:#f5effa;padding:12px;border-radius:8px;margin-top:22px}@media print{button{display:none}}</style></head><body><header><h1>JAIVISA · ORDEN DE PREPARACIÓN</h1><p>Pedido: <b>${safe(o.id)}</b> · Fecha: ${safe(o.created)}</p></header><p><b>Cliente:</b> ${safe(o.customer)}<br/><b>Teléfono:</b> ${safe(o.phone)}<br/><b>Ciudad:</b> ${safe(o.city)}<br/><b>Dirección:</b> ${safe(o.address)}</p><table><thead><tr><th>Imagen</th><th>Producto / Referencia</th><th>Cantidad</th><th>Precio unitario</th></tr></thead><tbody>${filas}</tbody></table><p><b>Total estimado:</b> ${safe(money(totalPedido(o)))}</p><div class="nota">Documento interno para preparación de bodega. NO es factura electrónica ni documento tributario.</div><p><button onclick="window.print()">Imprimir / Guardar como PDF</button></p></body></html>`);
    w.document.close();
  };

  const beep = () => { try { const ctx = new AudioContext();[0, .25].forEach((t, i) => { const oscillator = ctx.createOscillator(); const gain = ctx.createGain(); oscillator.frequency.value = i ? 950 : 720; gain.gain.setValueAtTime(.0001, ctx.currentTime + t); gain.gain.exponentialRampToValueAtTime(.15, ctx.currentTime + t + .02); gain.gain.exponentialRampToValueAtTime(.0001, ctx.currentTime + t + .18); oscillator.connect(gain); gain.connect(ctx.destination); oscillator.start(ctx.currentTime + t); oscillator.stop(ctx.currentTime + t + .2); }); setTimeout(() => ctx.close(), 900); } catch { alert('El navegador no permitió reproducir audio.'); } };
  const printLabel = () => { if (!chosenOrder) return alert('Primero crea un pedido.'); const w = window.open('', '_blank', 'width=650,height=700'); if (!w) return alert('Permite ventanas emergentes para imprimir.'); const safe = (v: string) => v.replace(/[&<>"']/g, x => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[x] || x)); const boxes = Array.from({ length: labelCount }, (_, i) => `<div class="label"><h2>JAIVISA · BODEGA</h2><h3>${safe(chosenOrder.id)}</h3><p><b>CLIENTE:</b> ${safe(chosenOrder.customer)}</p><p><b>TEL:</b> ${safe(chosenOrder.phone)}</p><p><b>CIUDAD:</b> ${safe(chosenOrder.city)}</p><p><b>DIRECCIÓN:</b> ${safe(chosenOrder.address)}</p><p><b>CAJA:</b> ${i + 1} / ${labelCount}</p><div class="code">${safe(chosenOrder.id)}-C${String(i + 1).padStart(2, '0')}</div><small>Código interno de caja · No escaneable todavía</small></div>`).join(''); w.document.write(`<!doctype html><html><head><title>Etiquetas JAIVISA</title><style>body{font:12px Arial;margin:8mm}.label{border:1px dashed #555;padding:8px;margin:0 0 12px;break-inside:avoid;max-width:75mm}h2{color:#542078;margin:0 0 6px}h3{margin:0 0 8px}p{margin:4px 0}.code{font-weight:bold;text-align:center;font-size:17px;letter-spacing:1px;border-top:1px solid;padding:9px 0}small{font-size:9px}@media print{.label{page-break-inside:avoid}}</style></head><body>${boxes}</body></html>`); w.document.close(); w.focus(); setTimeout(() => w.print(), 350); };
  const menu = ['Inicio', 'Catálogo', 'Productos', 'Empleados', 'Clientes', 'Accesos', 'Permisos', 'Carrito', 'Catálogos PDF', 'Personalización', 'WhatsApp y pedidos', 'Centro de Pedidos', 'Operaciones empresariales'];
  return <><style>{`.jv-catalog-thumb{display:flex!important;align-items:center;justify-content:center;position:relative;background:linear-gradient(145deg,#f6f0fa,#e8dcf1);overflow:hidden}
.jv-catalog-thumb canvas{display:block;max-width:100%;max-height:100%;width:auto;height:auto;object-fit:contain;box-shadow:0 3px 14px #32124322}
.jv-catalog-thumb-fallback{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;color:#73458b;text-align:center;padding:8px}
.jv-catalog-thumb-fallback small{font-size:11px}
@media(max-width:720px){.jv-catalog-thumb{height:160px!important;min-height:160px!important}.jv-catalog-thumb::after{content:none!important}.jv-catalog-thumb canvas{max-height:160px}}

    *{box-sizing:border-box}body{margin:0;background:#f7f4fb;color:#281b36;font-family:Inter,system-ui,Arial,sans-serif}button,input,select{font:inherit}button{cursor:pointer}.layout{display:flex;min-height:100vh}.sidebar{width:245px;background:#4e1978;color:white;padding:24px 14px;flex-shrink:0}.logo{font-size:29px;font-weight:900;padding:5px 12px 25px}.logo span{color:#cda3f1}.logo small{display:block;font-size:12px;font-weight:400;color:#ddc5ee}.nav{display:grid;gap:5px}.nav button{display:block;text-align:left;width:100%;background:none;border:0;color:#ebdbf5;border-radius:10px;padding:12px 14px}.nav button.on,.nav button:hover{background:#7836a5;color:white}.sidebottom{font-size:13px;margin:35px 12px;color:#ddc7ee}.main{width:100%;min-width:0;padding:28px;max-width:1400px;margin:0 auto}.top{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:25px}.top h1{margin:3px 0;font-size:29px}.hint{font-size:12px;color:#8d76a0;letter-spacing:1px;font-weight:700}.pill{background:white;border:1px solid #e6d9ee;border-radius:24px;padding:9px 14px;font-size:12px}.hero{background:linear-gradient(115deg,#552085,#8b44b6);border-radius:18px;color:white;padding:30px;display:flex;justify-content:space-between;align-items:center}.hero h2{font-size:28px;margin:0}.hero p{color:#f0dff9}.isa{font-size:66px;text-align:center}.isa small{display:block;font-size:12px}.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin:20px 0}.card,.panel{background:white;border:1px solid #eae1f0;border-radius:15px;padding:22px;margin-bottom:18px}.card b{display:block;font-size:30px;color:#61258b}.card small{color:#7c6a89}.panel h3{margin:0 0 16px}.muted{color:#756981;font-size:13px;line-height:1.6}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;align-items:end}.field{display:grid;gap:6px;font-size:12px;font-weight:700;color:#594666}.field input,.field select,.wideSelect{width:100%;padding:11px;border:1px solid #ded1e9;border-radius:9px;background:white;color:#281b36}.primary{border:0;border-radius:9px;padding:12px 16px;background:#62258f;color:white;font-weight:700}.secondary{border:1px solid #ddcce9;background:#f7f0fb;color:#572084;border-radius:9px;padding:9px 12px}.danger{color:#b52e50!important}.table{overflow:auto}.table table{width:100%;border-collapse:collapse;min-width:650px;text-align:left}.table th,.table td{border-bottom:1px solid #eee7f3;padding:12px 9px;font-size:13px}.table th{color:#7e6d8b;background:#faf8fc}.table input{max-width:115px;padding:7px;border:1px solid #ddd;border-radius:7px}.row{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 0;border-bottom:1px solid #eee7f3}.row small{display:block;color:#897990;margin-top:4px}.actions{display:flex;gap:6px;flex-wrap:wrap}.check{display:flex;justify-content:space-between;align-items:center;padding:12px;border-bottom:1px solid #eee7f3}.check input{width:20px;height:20px;accent-color:#64258e}.catalog{display:grid;grid-template-columns:repeat(auto-fit,minmax(185px,1fr));gap:13px}.item{border:1px solid #eee2f3;border-radius:12px;padding:15px;display:grid;gap:9px}.item .photo{background:#f5eff9;text-align:center;padding:18px;border-radius:10px;font-size:32px}.item small{color:#897a94}.total{display:grid;gap:8px;margin:20px 0 20px auto;max-width:330px}.total div{display:flex;justify-content:space-between}.total .big{font-size:22px;font-weight:800;border-top:1px solid #ddd;padding-top:12px;color:#5a2188}.notice{background:#f6edfc;border-radius:10px;padding:14px;font-size:13px;color:#684581;margin-top:16px}.badge{display:inline-block;background:#f1e7fa;border-radius:30px;padding:5px 10px;font-size:11px;color:#5c2187}.footer{font-size:12px;color:#9a8ba3;text-align:center;margin:28px}.labelPreview{border:1px dashed #b4a6bf;border-radius:10px;padding:20px;background:white;max-width:380px}.labelPreview h3{color:#572085}.labelPreview p{margin:7px 0;font-size:13px}.catalogHeading{display:flex;justify-content:space-between;align-items:center;gap:16px;margin:0 0 18px}.catalogHeading h2{font-size:30px;letter-spacing:-.6px;margin:6px 0}.catalogSearch{width:100%;padding:16px;border-radius:12px;border:1px solid #e5dbea;background:#fbf9fc;font:inherit;margin-bottom:20px}.categoryGrid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px}.categoryCard{border:1px solid #e8e0ed;background:white;border-radius:18px;padding:0;overflow:hidden;text-align:left;box-shadow:0 8px 20px #3c20510a;transition:transform .18s,box-shadow .18s}.categoryCard:hover{transform:translateY(-4px);box-shadow:0 12px 30px #3c205122}.categoryArt{height:155px;display:flex;align-items:center;justify-content:center;position:relative}.categoryArt>span{font-size:67px;filter:drop-shadow(0 8px 10px #42224c22)}.categoryArt small{position:absolute;bottom:12px;left:15px;color:#6c5d75;font-size:9px;font-weight:800;letter-spacing:1.2px}.categoryInfo{display:grid;gap:6px;padding:17px}.categoryInfo strong{font-size:18px;color:#2c1b39}.categoryInfo span{font-size:12px;color:#84778d}.categoryInfo small{font-size:12px;color:#6d278f;font-weight:700;margin-top:8px}.catalogProducts{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:16px}.catalogProduct{border:1px solid #eae1ee;border-radius:14px;overflow:hidden;background:white}.catalogPhoto{height:150px;background:#f6f1f8;display:grid;place-items:center}.catalogPhoto span{font-size:60px}.catalogPhoto img{height:100%;width:100%;object-fit:contain}.catalogDetails{display:grid;gap:8px;padding:16px}.catalogDetails small{font-size:11px;color:#85748e}.catalogDetails strong{min-height:36px}.catalogDetails b{color:#5d2185;font-size:20px}.backCat{display:block;border:0;background:none;color:#64258e;padding:0 0 20px;font-weight:700}.cartDock{position:sticky;bottom:12px;background:#4d1976;color:white;border-radius:15px;padding:14px 20px;display:flex;align-items:center;justify-content:space-between;box-shadow:0 10px 25px #2a104744;gap:12px}.cartDock div{display:grid;gap:4px}.cartDock span{font-size:13px;color:#e9d9f3}.cartDock button{background:white;border:0;color:#522078;padding:12px 17px;border-radius:9px;font-weight:800}@media(max-width:950px){.categoryGrid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:530px){.categoryGrid{grid-template-columns:1fr 1fr;gap:9px}.categoryArt{height:105px}.categoryArt>span{font-size:44px}.categoryInfo{padding:11px}.categoryInfo strong{font-size:14px}.categoryInfo span{font-size:11px}.catalogHeading{align-items:flex-start;flex-direction:column}.catalogHeading h2{font-size:24px}}
@media(max-width:800px){.layout{display:block}.sidebar{width:100%;padding:12px}.logo{padding:5px 10px 12px}.nav{display:flex;overflow:auto}.nav button{width:auto;white-space:nowrap}.sidebottom{display:none}.main{padding:16px}.grid{grid-template-columns:repeat(2,minmax(0,1fr))}.hero{padding:22px}.isa{font-size:40px}}@media(max-width:530px){.grid{grid-template-columns:1fr}.cards{gap:7px}.card{padding:12px}.card b{font-size:22px}.hero h2{font-size:21px}.isa{display:none}.top h1{font-size:24px}.pill{font-size:10px}.row{align-items:flex-start;flex-direction:column}}

    .sidebar{background:linear-gradient(180deg,#35124e 0%,#4e1c70 58%,#321146 100%)!important}
    .logo{font-weight:850!important;letter-spacing:-1px!important}
    .nav button{border-radius:12px!important;transition:background .18s,transform .18s}
    .nav button:hover{background:rgba(255,255,255,.14)!important}
    .nav button.on{background:#7541a1!important}
    .main{background:#faf8fc!important}
    .panel{border:1px solid #e9e0ee!important;border-radius:22px!important;box-shadow:0 8px 30px rgba(52,19,75,.035)!important}
    .top h1{letter-spacing:-1.2px}
    .primary{background:#60218b!important;border-radius:12px!important}
    .secondary{border-radius:12px!important}
    .field input,.field select,.wideSelect{border-radius:12px!important;border:1px solid #e0d4e8!important;background:#fff!important}
    .field input:focus,.field select:focus,.wideSelect:focus{outline:2px solid #b28ad4;outline-offset:1px}
    .sectionEyebrow{font-size:11px;letter-spacing:2px;font-weight:800;color:#956cae;margin-bottom:6px}
    .staffCount{display:inline-block;font-size:13px;font-weight:600;color:#71369a;background:#f1e8f8;padding:6px 12px;border-radius:30px;vertical-align:middle}
    .row:hover{background:#fbf7fd}
    .pill{background:white!important}
    .accessTiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:16px;margin:20px 0}.accessTiles>div{padding:22px;background:#f7f0fb;border:1px solid #e6d9ef;border-radius:18px}.accessDemo{max-width:480px;margin:auto;display:grid;gap:14px}.accessDemo button{padding:14px}

    /* JAIVISA | interfaz ejecutiva v0.5 */
    :root{font-family:Inter,ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#26182e}
    *{box-sizing:border-box}
    body{margin:0;background:#f8f6fa}
    button{cursor:pointer;font:inherit;transition:background .18s,box-shadow .18s,transform .18s}
    button:focus-visible,input:focus-visible,select:focus-visible{outline:3px solid #b78bd6;outline-offset:2px}
    .layout{min-height:100vh}
    .sidebar{background:linear-gradient(175deg,#281038 0%,#44155f 55%,#321147 100%)!important;box-shadow:8px 0 30px #29123b0d}
    .logo{font-size:30px!important;font-weight:850!important;letter-spacing:-1.1px!important;padding-bottom:32px!important}
    .logo small{font-size:12px!important;font-weight:450!important;letter-spacing:.7px!important;opacity:.83}
    .nav{gap:5px!important}
    .nav button{font-size:14px!important;border-radius:12px!important;min-height:45px!important;letter-spacing:.05px!important;opacity:.91}
    .nav button:hover{background:#ffffff16!important;opacity:1}
    .nav button.on{background:#8650a8!important;box-shadow:inset 3px 0 #d9b4ee!important;opacity:1}
    .sidebottom{border-top:1px solid #ffffff22!important;padding-top:20px!important;opacity:.76;font-size:12px!important}
    .main{background:#faf9fc!important;padding-top:36px!important}
    .top{margin-bottom:28px!important}
    .top h1{font-size:31px!important;font-weight:790!important;letter-spacing:-1.3px!important;color:#28172f}
    .hint{color:#8e6c9c!important;letter-spacing:1.9px!important;font-size:10px!important;font-weight:800!important}
    .pill{border:1px solid #e9e0ee!important;border-radius:50px!important;background:white!important;padding:12px 16px!important;box-shadow:0 4px 20px #2b103708}
    .panel{border:1px solid #eae4ee!important;background:#fff!important;border-radius:20px!important;padding:27px!important;box-shadow:0 12px 38px #3a154009!important}
    .panel h3{font-size:21px!important;letter-spacing:-.6px!important;color:#2e1a38}
    .panel p.muted{font-size:13px!important}
    .primary{background:#64238d!important;border-radius:11px!important;min-height:43px!important;box-shadow:0 5px 13px #54207918}
    .primary:hover{background:#501970!important;transform:translateY(-1px)}
    .secondary{border:1px solid #e6d8ef!important;background:#f8f3fb!important;color:#58217c!important;border-radius:11px!important;min-height:39px}
    .secondary:hover{background:#efe3f6!important}
    .field{font-size:12px!important;color:#55415e!important;gap:8px!important}
    .field input,.field select,.wideSelect{border:1px solid #e4d9eb!important;border-radius:11px!important;background:white!important;min-height:44px!important;padding:11px 13px!important;font-size:14px!important}
    .grid{gap:16px!important}
    .sectionEyebrow{letter-spacing:2.3px!important;font-size:10px!important;color:#9664b1!important}
    .row{padding:15px!important;border:1px solid #f0eaf4!important;border-radius:12px!important;margin-top:8px!important}
    .row:hover{background:#fbf7fe!important}
    .row strong{font-size:14px}
    .row small{font-size:12px!important;line-height:1.6!important}
    .staffCount{background:#f1e8f8!important;color:#71369a!important}
    .table th{font-size:11px!important;text-transform:uppercase;letter-spacing:.7px}
    .table td{font-size:13px!important}
    .categoryCard{border-radius:19px!important;box-shadow:0 9px 25px #2c16330a!important}
    .categoryCard:hover{box-shadow:0 17px 36px #2c16331a!important}
    .categoryArt{height:150px!important}
    .categoryArt>span{font-size:57px!important}
    .categoryInfo{padding:19px!important}
    .categoryInfo strong{font-size:16px!important}
    .catalogProduct{border-radius:18px!important;box-shadow:0 7px 24px #2c163309!important}
    .catalogPhoto{height:160px!important}
    .catalogDetails{padding:17px!important}
    .cartDock{border-radius:16px!important;background:#431663!important;box-shadow:0 9px 24px #31104135!important}
    .securityPanel{border:1px solid #e8dbf1;background:linear-gradient(110deg,#fbf8fd,#f7f1fb);border-radius:15px;padding:19px;margin-top:20px}
    .securityTitle{font-weight:800;font-size:15px;color:#3b2050;margin-bottom:7px}
    .securityActions{display:flex;flex-wrap:wrap;gap:9px;margin-top:12px}
    .securityFoot{display:block;color:#846e8e;margin-top:12px}
    .accessTiles>div{background:#faf6fc!important;border-radius:16px!important}
    .footer{opacity:.8}
    @media(max-width:800px){.main{padding-top:20px!important}.sidebar{box-shadow:none}.logo{padding-bottom:12px!important}.nav button{font-size:13px!important}.panel{padding:19px!important}}
    @media(max-width:530px){.top h1{font-size:25px!important}.categoryArt{height:105px!important}.categoryArt>span{font-size:43px!important}.categoryInfo{padding:12px!important}.securityActions button{width:100%}}

    /* JAIVISA NEXUS: dirección de arte futurista, inspirada en interfaces cinematográficas */
    :root{--ink:#170f24;--purple:#742db0;--violet:#a96df4;--line:#e8dff1;--glass:#ffffffee}
    body{background:radial-gradient(circle at 70% 0%,#f3ebff 0%,#faf9fe 38%,#f8f7fb 90%)!important;color:var(--ink)!important}
    .sidebar{width:256px!important;background:linear-gradient(160deg,#120b21 0%,#251037 56%,#39164e 100%)!important;border-right:1px solid #a66fc02e!important;padding:25px 14px!important;position:relative}
    .sidebar:before{content:"";position:absolute;top:0;left:0;right:0;height:3px;background:linear-gradient(90deg,transparent,#ba7aff,#fff,#ba7aff,transparent);opacity:.8}
    .logo{padding:6px 9px 29px!important;text-align:center!important}
    .brandLogo{background:transparent;padding:6px;border:0;border-radius:12px;display:block;width:100%;height:90px;object-fit:contain;filter:drop-shadow(0 8px 12px #0008);border-radius:8px}
    .logo small{font-size:10px!important;letter-spacing:3.1px!important;color:#e8d6f6!important;font-weight:750!important;margin-top:3px}
    .logo small i{font-style:normal;color:#d1a5ff}
    .nav{gap:5px!important}
    .nav button{display:flex!important;align-items:center!important;gap:13px!important;padding:13px 15px!important;font-size:13px!important;font-weight:600!important;letter-spacing:.2px!important;color:#d5c4e6!important;border:1px solid transparent!important;border-radius:11px!important}
    .nav button svg{opacity:.78;flex:none}
    .nav button.on{background:linear-gradient(95deg,#7735b0aa,#a053da4a)!important;color:white!important;border:1px solid #a779cc6b!important;box-shadow:0 6px 18px #0002,inset 3px 0 #d4a4ff!important}
    .nav button.on svg{color:#e4bfff;opacity:1}
    .nav button:hover{border-color:#ffffff24!important;transform:translateX(2px)}
    .sidebottom{margin-top:42px!important;padding:18px 12px!important;color:#cdb5df!important;font-size:10px!important;letter-spacing:1.2px!important;font-weight:750}
    .sidebottom small{display:block;font-size:10px;letter-spacing:.2px;font-weight:400;color:#a995bc;margin-top:9px}
    .pulseDot,.onlineDot{display:inline-block;width:7px;height:7px;border-radius:50%;background:#65e4ba;box-shadow:0 0 9px #65e4ba99;margin-right:8px}
    .onlineDot{margin-left:5px;margin-right:0}
    .main{max-width:1550px!important;padding:34px 38px!important;background:transparent!important}
    .top{padding-bottom:19px!important;border-bottom:1px solid #e8e0ef!important;margin-bottom:26px!important}
    .top h1{font-size:33px!important;font-weight:800!important;letter-spacing:-1.5px!important}
    .hint{font-size:10px!important;letter-spacing:2.2px!important;color:#8d65aa!important}
    .crumbSep{padding:0 9px;color:#c3b0d3}
    .pill{display:flex;align-items:center;gap:9px!important;border:1px solid #e8d9f0!important;background:#fff!important;font-size:12px!important;color:#42245d!important}
    .pill svg{color:#7840a6}
    .hero{min-height:285px!important;border-radius:23px!important;padding:39px 42px!important;position:relative;overflow:hidden;background:radial-gradient(circle at 80% 40%,#7634b6 0%,#34154e 43%,#140d25 95%)!important;border:1px solid #ae76d944!important;box-shadow:0 18px 46px #3b17572a!important}
    .hero:after{content:"";position:absolute;width:420px;height:420px;right:-160px;top:-140px;border:1px solid #d5adff36;border-radius:50%;box-shadow:0 0 0 60px #c68aff08,0 0 0 120px #c68aff07}
    .hero>div:first-child{z-index:1;position:relative}
    .heroTag{font-size:10px;letter-spacing:2.4px;color:#d9b5ff;font-weight:800;margin-bottom:16px}
    .hero h2{font-size:clamp(26px,3vw,43px)!important;line-height:1.12!important;letter-spacing:-1.7px!important;font-weight:850!important}
    .hero h2 em{font-style:normal;background:linear-gradient(90deg,#fff,#cf9fff);background-clip:text;-webkit-background-clip:text;color:transparent}
    .hero p{font-size:14px!important;max-width:460px;color:#d7c7e6!important;margin:17px 0 22px}
    .hero .secondary{background:#f5eafd!important;border-color:#f5eafd!important;font-weight:800!important}
    .heroOrb{position:relative;z-index:1;flex:none;width:195px;height:195px;border-radius:50%;border:1px solid #cba5f855;display:grid;place-items:center;box-shadow:0 0 0 17px #d5a4fa10,0 0 0 36px #d5a4fa0a,inset 0 0 35px #c68cff24;background:radial-gradient(circle,#9a53cf66,#220e3500)}
    .orbCore{font-family:Georgia,serif;font-style:italic;font-weight:bold;font-size:90px;line-height:1;color:white;text-shadow:0 0 30px #f6d9ff}
    .heroOrb span{position:absolute;bottom:24px;font-size:8px;letter-spacing:2px;color:#e2c5ff}
    .card{border:1px solid #e9dff1!important;background:#fff!important;border-radius:16px!important;padding:23px!important;box-shadow:0 7px 22px #2d164108!important}
    .card b{font-size:36px!important;font-weight:800!important;color:#572280!important;letter-spacing:-1.5px}
    .card small{font-size:12px!important}
    .panel{border:1px solid #eae2f0!important;background:#ffffffed!important;box-shadow:0 12px 38px #2e153e0b!important;border-radius:20px!important}
    .categoryGrid{gap:15px!important}
    .categoryCard{border-radius:17px!important;box-shadow:0 8px 22px #2710390b!important;transition:transform .2s,box-shadow .2s!important}
    .categoryCard:hover{transform:translateY(-5px)!important;box-shadow:0 20px 38px #38164b20!important}
    .categoryArt{height:160px!important;background:linear-gradient(130deg,#1c102f,#5d2a83)!important;position:relative;overflow:hidden}
    .categoryArt:after{content:"";width:180px;height:180px;position:absolute;border-radius:50%;border:1px solid #ffffff24;right:-65px;top:-70px;box-shadow:0 0 0 32px #ffffff08,0 0 0 66px #ffffff05}
    .catGlyph{width:72px;height:72px;display:grid;place-items:center;border:1px solid #d6a8ff66;border-radius:20px;background:linear-gradient(145deg,#ae6cf244,#ffffff0b);transform:rotate(-8deg);box-shadow:0 16px 35px #12051d66}
    .catGlyph svg{width:37px;height:37px;color:#fff;transform:rotate(8deg);stroke-width:1.35}
    .categoryArt small{color:#e2c9f5!important;letter-spacing:1.8px!important;font-size:8px!important;z-index:1}
    .categoryInfo{padding:18px!important}
    .categoryInfo strong{font-size:16px!important;font-weight:800!important}
    .categoryInfo small{color:#7230a3!important}
    .catalogPhoto{background:linear-gradient(145deg,#f5effc,#e9dcf7)!important}
    .catalogPhoto span{filter:grayscale(.2)}
    .catalogDetails{padding:18px!important}
    .catalogDetails b{color:#67269b!important}
    .primary{background:linear-gradient(110deg,#672494,#8b3cc3)!important;box-shadow:0 5px 17px #58208025!important}
    .cartDock{background:linear-gradient(110deg,#1e0e30,#502071)!important;border:1px solid #9e64c466!important}
    .securityPanel{background:linear-gradient(120deg,#faf7fd,#f1e9f9)!important}
    @media(max-width:950px){.sidebar{width:215px!important}.main{padding:24px!important}.heroOrb{width:130px;height:130px}.orbCore{font-size:64px}.heroOrb span{font-size:6px}}
    @media(max-width:800px){.sidebar{width:100%!important;padding:10px!important}.logo{padding:4px 10px 10px!important}.brandLogo{height:65px!important;width:210px!important;margin:0 auto}.nav button{flex:none}.main{padding:18px!important}.hero{padding:25px!important}.heroOrb{display:none}.sidebottom{display:none}}
    @media(max-width:530px){.categoryArt{height:115px!important}.catGlyph{width:55px;height:55px}.catGlyph svg{width:28px;height:28px}.hero h2{font-size:28px!important}.top h1{font-size:26px!important}.pill{font-size:10px!important}}

    /* JAIVISA ATELIER — refinamiento visual limpio, sobrio y premium */
    body{background:#f8f7fb!important}
    .sidebar{background:#241032!important;border-right:1px solid #3b2448!important;box-shadow:none!important}
    .sidebar:before{display:none!important}
    .brandLogo{height:95px!important;filter:drop-shadow(0 8px 12px #0005)!important;background:transparent!important;border:0!important;border-radius:0;padding:0;object-fit:contain}
    .logo{padding-bottom:26px!important}
    .logo small{font-size:9px!important;letter-spacing:2.2px!important;margin-top:13px!important;color:#c6b4d4!important}
    .nav{gap:3px!important}
    .nav button{min-height:45px!important;border-radius:10px!important;font-weight:550!important;color:#d1c1dd!important;transition:background .16s,color .16s!important}
    .nav button.on{background:#6e358f!important;border-color:transparent!important;box-shadow:none!important;color:#fff!important}
    .nav button:hover{transform:none!important;background:#ffffff12!important}
    .nav button.on:hover{background:#6e358f!important}
    .nav button svg{width:18px!important;height:18px!important}
    .sidebottom{opacity:.8!important}
    .main{max-width:1500px!important;padding:32px 36px!important}
    .top{padding-bottom:22px!important;margin-bottom:24px!important;border-bottom:1px solid #e9e4ee!important}
    .top h1{font-size:29px!important;letter-spacing:-.9px!important}
    .hint{letter-spacing:1.3px!important;font-size:10px!important;color:#9b83a8!important}
    .pill{box-shadow:none!important;padding:10px 13px!important}
    .hero{min-height:236px!important;background:linear-gradient(115deg,#321746 0%,#4f216b 66%,#663085 100%)!important;border-radius:18px!important;padding:32px 38px!important;box-shadow:none!important;border:0!important}
    .hero:after{display:none!important}
    .heroTag{font-size:10px!important;letter-spacing:1.6px!important;margin-bottom:12px!important;color:#d3b5e7!important}
    .hero h2{font-size:clamp(28px,3vw,38px)!important;letter-spacing:-1.1px!important;line-height:1.17!important}
    .hero h2 em{color:#e4c7f5!important;background:none!important;-webkit-text-fill-color:initial!important}
    .hero p{margin:13px 0 22px!important;font-size:13px!important;color:#e2d6e8!important}
    .hero .secondary{background:#fff!important;color:#4d2268!important;border:0!important;padding:12px 17px!important;box-shadow:none!important}
    .heroOrb{width:130px!important;height:130px!important;border:1px solid #ffffff32!important;box-shadow:none!important;background:#ffffff0d!important}
    .orbCore{font-size:67px!important;text-shadow:none!important}
    .heroOrb span{bottom:16px!important;font-size:8px!important}
    .cards{gap:14px!important;margin:18px 0!important}
    .card{border-radius:15px!important;padding:20px 23px!important;box-shadow:none!important;border:1px solid #e9e2ed!important}
    .card b{font-size:31px!important;color:#5e287e!important}
    .panel{box-shadow:none!important;border:1px solid #eae4ef!important;border-radius:17px!important;padding:24px!important}
    .panel h3{font-size:19px!important;letter-spacing:-.35px!important}
    .row{border-radius:10px!important;box-shadow:none!important}
    .categoryGrid{gap:15px!important}
    .categoryCard{border:1px solid #e9e2ee!important;border-radius:15px!important;box-shadow:none!important;transform:none!important}
    .categoryCard:hover{transform:translateY(-2px)!important;box-shadow:0 8px 18px #2b14310d!important}
    .categoryArt{height:142px!important;background:linear-gradient(130deg,#eae0f2,#f5eff9)!important}
    .categoryArt:after{display:none!important}
    .catGlyph{width:65px!important;height:65px!important;border-radius:17px!important;transform:none!important;box-shadow:none!important;background:#fff!important;border:1px solid #e4d3ee!important}
    .catGlyph svg{width:31px!important;height:31px!important;transform:none!important;color:#713698!important}
    .categoryArt small{color:#836b95!important;letter-spacing:1.2px!important;font-size:8px!important}
    .categoryInfo{padding:17px!important}
    .categoryInfo strong{font-size:15px!important;letter-spacing:-.2px!important}
    .categoryInfo span{font-size:12px!important}
    .catalogProduct{border:1px solid #e9e3ed!important;border-radius:14px!important;box-shadow:none!important}
    .catalogPhoto{background:#f7f4fa!important}
    .catalogDetails{gap:9px!important}
    .catalogDetails strong{font-size:14px!important}
    .primary{background:#682e8b!important;border-radius:10px!important;box-shadow:none!important}
    .primary:hover{background:#552373!important;transform:none!important}
    .secondary{background:#f7f2fa!important;border:1px solid #e7dced!important;border-radius:10px!important}
    .field input,.field select,.wideSelect{border-radius:10px!important;box-shadow:none!important}
    .cartDock{background:#321746!important;border:0!important;box-shadow:0 8px 24px #2b173221!important;border-radius:14px!important}
    .securityPanel{background:#f8f4fa!important;border:1px solid #e8deed!important;border-radius:13px!important}
    .securityTitle{font-size:14px!important}
    @media(max-width:950px){.main{padding:24px!important}.heroOrb{width:100px!important;height:100px!important}.orbCore{font-size:53px!important}}
    @media(max-width:800px){.main{padding:18px!important}.brandLogo{height:58px!important}.hero{padding:25px!important}.heroOrb{display:none!important}}
    @media(max-width:530px){.categoryArt{height:108px!important}.catGlyph{width:51px!important;height:51px!important}.catGlyph svg{width:26px!important;height:26px!important}.cards{gap:8px!important}.card{padding:14px!important}.card b{font-size:26px!important}.hero h2{font-size:27px!important}}

    /* JAIVISA: limpio, futurista y personalizable */
    .hero{display:grid!important;grid-template-columns:minmax(0,1fr) minmax(240px,43%)!important;gap:25px!important;align-items:center!important;min-height:290px!important;padding:30px 32px!important;background:linear-gradient(118deg,#1b0e2d 0%,#351650 57%,#5e2681 100%)!important;box-shadow:0 15px 35px #29103b1a!important;border:1px solid #8654a63d!important;border-radius:22px!important}
    .hero:after{display:none!important}
    .hero>div:first-child{min-width:0}
    .hero h2{font-size:clamp(29px,3vw,42px)!important;text-align:left!important;line-height:1.13!important;color:#fff!important;letter-spacing:-1.3px!important}
    .hero h2 em{color:#e9c8ff!important;background:none!important;-webkit-text-fill-color:#e9c8ff!important}
    .hero p{color:#e2d3ec!important;font-size:13px!important;line-height:1.6!important;max-width:390px}
    .heroTag{text-align:left!important;color:#d7a8ff!important;font-size:10px!important;letter-spacing:2px!important}
    .hero .secondary{background:#fff!important;color:#4c1d70!important;border:0!important;font-weight:800!important;padding:13px 19px!important;border-radius:11px!important}
    .heroVisual{width:100%;height:235px;border-radius:16px;overflow:hidden;background:linear-gradient(145deg,#ffffff19,#b782ef18);border:1px solid #ffffff26;position:relative;display:grid;place-items:center}
    .heroVisual:before{content:'';position:absolute;inset:0;background:linear-gradient(90deg,#2d124a28,transparent 45%);pointer-events:none;z-index:1}
    .heroVisual img{width:100%;height:100%;object-fit:cover;display:block}
    .heroPlaceholder{height:100%;width:100%;display:flex;flex-direction:column;justify-content:center;align-items:center;gap:13px;text-align:center;color:#fff;background:radial-gradient(circle at 60% 30%,#9852d080,transparent 55%),repeating-linear-gradient(145deg,transparent,transparent 23px,#ffffff06 24px)}
    .heroPlaceholder svg{width:44px;height:44px;color:#f0d8ff;stroke-width:1.2}
    .heroPlaceholder span{font-size:17px;font-weight:750;line-height:1.3}
    .heroPlaceholder small{font-size:9px;letter-spacing:2px;color:#d8b9ed}
    .bannerManager{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:16px;padding:19px 22px!important;margin:16px 0 22px!important;background:#fff!important;border:1px solid #e9e1ef!important;border-radius:16px!important;box-shadow:none!important}
    .bannerManagerCopy{flex:1;min-width:220px}
    .bannerEyebrow{font-size:9px;font-weight:850;letter-spacing:1.7px;color:#8b55a9;margin-bottom:5px}
    .bannerManagerCopy strong{font-size:16px;color:#291733}
    .bannerManagerCopy p{margin:5px 0 0;font-size:12px!important}
    .bannerManagerActions{display:flex;gap:9px;align-items:center;flex-wrap:wrap}
    .bannerUpload{display:flex;align-items:center;justify-content:center;gap:9px;background:#5f2587;color:white;border-radius:10px;padding:12px 15px;font-weight:750;font-size:12px;cursor:pointer}
    .bannerUpload:hover{background:#7433a2}
    .bannerUpload svg{width:16px;height:16px}
    .bannerUpload input{display:none}
    .bannerRemove{padding:11px 13px;border-radius:10px;border:1px solid #e6dcec;background:#fff;color:#6d4384;font-size:12px}
    .bannerError{color:#a52b50;font-size:12px;width:100%;margin:0}
    .nav button.on{background:#66308e!important;box-shadow:inset 3px 0 #c18ee8!important;border:1px solid #a274bf4d!important}
    .panel{border-radius:18px!important}
    .card{border-radius:15px!important}
    @media(max-width:950px){.hero{grid-template-columns:minmax(0,1fr) minmax(190px,39%)!important;padding:24px!important}.heroVisual{height:205px}}
    @media(max-width:650px){.hero{grid-template-columns:1fr!important;gap:17px!important}.heroVisual{height:190px!important}.bannerManager{align-items:stretch}.bannerManagerActions{width:100%}.bannerUpload{flex:1}}

    /* Personalización JAIVISA — paleta aplicada sin alterar datos comerciales */
    .layout{font-family:var(--brand-font)!important;background:var(--brand-surface)!important}
    .layout .main{background:var(--brand-surface)!important}
    .layout .sidebar{background:linear-gradient(175deg,#170d22,var(--brand-primary))!important}
    .layout .nav button.on{background:var(--brand-primary)!important;border-color:var(--brand-accent)!important;box-shadow:inset 3px 0 var(--brand-accent)!important}
    .layout .hero{background:linear-gradient(110deg,#1b0d2b,var(--brand-primary))!important}
    .layout .primary{background:var(--brand-primary)!important}
    .layout .card b,.layout .catalogDetails b{color:var(--brand-primary)!important}
    .layout .cartDock{background:linear-gradient(105deg,#1a0c2b,var(--brand-primary))!important}
    .layout .hint,.layout .sectionEyebrow,.layout .bannerEyebrow{color:var(--brand-accent)!important}
    .themeEditor{padding:28px!important}
    .themeGrid{display:grid;grid-template-columns:minmax(240px,.85fr) minmax(300px,1.15fr);gap:26px;margin-top:24px;align-items:start}
    .themeControls{display:grid;gap:16px}
    .themeColor{display:flex;align-items:center;gap:14px;border:1px solid #e7dced;background:#fff;border-radius:13px;padding:10px 14px;font-size:13px;font-weight:650}
    .themeColor span{flex:1}.themeColor input{width:48px;height:39px;padding:3px;border:1px solid #ded2e8;border-radius:8px;background:white;cursor:pointer}
    .themeColor code{font-size:11px;color:#745a84}
    .themeButtons{display:flex;gap:10px;flex-wrap:wrap;margin-top:5px}
    .themePreview{border:1px solid #e7ddec;border-radius:20px;overflow:hidden;min-height:365px;box-shadow:0 16px 35px #2b16350f}
    .themePreviewHeader{padding:24px 26px;color:white;display:flex;justify-content:space-between;align-items:center;gap:12px}
    .themePreviewHeader span{font-weight:850;font-size:22px;letter-spacing:-1px}.themePreviewHeader small{font-size:9px;letter-spacing:2px}
    .themePreviewBody{padding:29px}.themePreviewBody h3{font-family:inherit!important;font-size:26px!important;margin:12px 0!important}
    .themePreviewBody p{font-size:13px;color:#665a6e;margin-bottom:20px}.previewEyebrow{font-size:10px;letter-spacing:2px;font-weight:800}
    .previewCards{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:24px}.previewCards span{border:1px solid #e9e0ef;border-radius:9px;padding:12px 5px;text-align:center;background:#fff;font-size:11px}
    @media(max-width:850px){.themeGrid{grid-template-columns:1fr}.themeEditor{padding:18px!important}}

    /* JAIVISA · Panel ejecutivo (solo Inicio) */
    .fusionAIHome{display:grid;gap:24px;max-width:1480px;margin:auto}
    .fusionAIHero{position:relative;min-height:330px;overflow:hidden;display:grid;grid-template-columns:1.1fr .9fr;background:radial-gradient(circle at 82% 22%,#8c4db5 0%,transparent 33%),linear-gradient(120deg,#210f35 0%,#4e236e 60%,#321445 100%);border:1px solid #ffffff22;border-radius:28px;color:#fff;box-shadow:0 24px 55px #3c175a24}
    .fusionAIHero:before{content:'';position:absolute;inset:0;background-image:linear-gradient(#ffffff09 1px,transparent 1px),linear-gradient(90deg,#ffffff09 1px,transparent 1px);background-size:36px 36px;mask-image:linear-gradient(90deg,transparent 20%,#000);pointer-events:none}
    .fusionAIHeroCopy{position:relative;z-index:1;padding:38px 18px 34px 42px;display:flex;align-items:flex-start;flex-direction:column}
    .fusionAIChip{border:1px solid #ffffff36;background:#ffffff12;border-radius:30px;padding:9px 13px;font-size:10px;font-weight:800;letter-spacing:1.7px;color:#e8d4f9}
    .fusionAIHero h2{font-size:clamp(29px,3vw,45px);letter-spacing:-1.6px;line-height:1.12;margin:20px 0 12px;max-width:540px;color:#fff}
    .fusionAIHero h2 span{display:block;background:linear-gradient(90deg,#fff,#d6a9fa);-webkit-background-clip:text;background-clip:text;color:transparent}
    .fusionAIHero p{font-size:14px;line-height:1.7;color:#e4d5ef;max-width:470px;margin:0 0 24px}
    .fusionAIHeroActions{display:flex;flex-wrap:wrap;gap:10px}.fusionAIAction,.fusionAIActionOutline{padding:12px 17px;border-radius:12px;font-weight:750;font-size:13px}.fusionAIAction{background:#fff;color:#48206b;border:1px solid #fff}.fusionAIAction span{margin-left:12px}.fusionAIActionOutline{background:#ffffff13;color:#fff;border:1px solid #ffffff45}
    .fusionAIHeroNote{margin-top:auto;padding-top:22px;color:#e3c9f5;font-size:11px}.fusionAIDot{display:inline-block;width:7px;height:7px;border-radius:50%;background:#a4eddb;box-shadow:0 0 10px #a4eddb;margin-right:6px}
    .fusionAIHeroVisual{position:relative;min-height:290px;display:grid;place-items:center;overflow:hidden}.fusionAIHeroVisual img{width:100%;height:100%;object-fit:cover;position:absolute;inset:0;mask-image:linear-gradient(90deg,transparent,#000 23%)}
    .fusionAIOrb{width:215px;height:215px;border-radius:50%;border:1px solid #ffffff75;box-shadow:0 0 0 18px #ffffff0b,0 0 0 44px #ffffff09,inset 0 0 55px #f0c5ff39,0 0 90px #c86bff77;display:flex;align-items:center;justify-content:center;flex-direction:column;background:radial-gradient(circle at 40% 35%,#ae6bd0a0,#47226888 65%,#1e0f32);transform:rotate(-8deg)}.fusionAIOrb span{font-size:42px;color:#f4d8ff}.fusionAIOrb strong{font-size:25px;letter-spacing:2px}.fusionAIOrb small{font-size:10px;letter-spacing:5px;color:#ead0f6}
    .fusionAISectionHeading{display:flex;justify-content:space-between;align-items:end;gap:15px}.fusionAIEyebrow{font-size:10px;font-weight:850;letter-spacing:2px;color:#9669b6}.fusionAISectionHeading h3{font-size:26px;margin:6px 0 0;letter-spacing:-1px}.fusionAIStatus{font-size:12px;color:#7c668c;background:white;border:1px solid #ede5f3;padding:10px 13px;border-radius:30px}
    .fusionAIMetrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:15px}.fusionAIMetric{text-align:left;background:linear-gradient(145deg,#fff,#fdfbff);border:1px solid #eae2f0;border-radius:21px;padding:21px;min-height:173px;display:flex;flex-direction:column;box-shadow:0 10px 35px #4c1c6710;transition:transform .2s,box-shadow .2s}.fusionAIMetric:hover{transform:translateY(-4px);box-shadow:0 18px 35px #4c1c6720}.fusionAIMetricTop{display:flex;align-items:center;justify-content:space-between;color:#9678aa;font-size:16px}.fusionAIMetricIcon{background:#f1e8f9;color:#71369a;width:37px;height:37px;border-radius:12px;display:grid;place-items:center;font-size:22px}.fusionAIMetric strong{font-size:35px;color:#30153f;line-height:1.1;margin:15px 0 5px}.fusionAIMetric>span:not(.fusionAIMetricTop){font-weight:750;color:#3f2b4d;font-size:13px}.fusionAIMetric small{color:#95839f;font-size:11px;margin-top:6px}
    .fusionAIBottomGrid{display:grid;grid-template-columns:1.35fr 1fr;gap:17px}.fusionAIWorkspace,.fusionAIAssistant,.fusionAIBannerManager{border:1px solid #eae2f0;border-radius:23px;background:#fff;padding:26px;box-shadow:0 10px 35px #4c1c670d}.fusionAIWorkspace h3,.fusionAIAssistant h3,.fusionAIBannerManager h3{font-size:22px;letter-spacing:-.7px;margin:8px 0}.fusionAIWorkspace p,.fusionAIAssistant p,.fusionAIBannerManager p{font-size:13px;color:#87768e;line-height:1.6}.fusionAIQuickGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:11px;margin-top:22px}.fusionAIQuickGrid button{display:flex;align-items:center;gap:10px;padding:14px;border:1px solid #eae2f0;background:#faf7fd;border-radius:14px;color:#46215d}.fusionAIQuickGrid button strong{font-size:13px;flex:1;text-align:left}.fusionAIQuickIcon{display:grid;place-items:center;width:35px;height:35px;background:#f0e5f8;border-radius:11px}.fusionAIAssistant{background:radial-gradient(circle at 85% 5%,#6b3c91 0%,transparent 50%),linear-gradient(145deg,#241237,#4a1f68);color:#fff;border-color:#ffffff22;display:flex;flex-direction:column}.fusionAIAssistantHeader{display:flex;justify-content:space-between;align-items:center;margin-bottom:20px}.fusionAIAssistantSymbol{display:grid;place-items:center;width:53px;height:53px;border-radius:16px;background:#ffffff17;border:1px solid #ffffff30;font-size:30px;color:#e9c1ff}.fusionAIPreviewBadge{font-size:9px;letter-spacing:1.3px;padding:8px 10px;border:1px solid #ffffff44;border-radius:30px;color:#e6d5f4}.fusionAIAssistant .fusionAIEyebrow{color:#d5b2ef}.fusionAIAssistant h3{font-size:32px;color:#fff}.fusionAIAssistant p{color:#e3d1ed;max-width:400px}.fusionAIAssistantFooter{font-size:11px;color:#d0b5e1;margin-top:auto;padding-top:25px}.fusionAIBannerManager{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:18px}.fusionAIBannerManager h3{font-size:18px}.fusionAIBannerManager p{margin:5px 0}.fusionAIBannerButtons{display:flex;gap:10px;flex-wrap:wrap}
    /* Identidad JAIVISA: logo sin recuadro y luz ambiental discreta */
    .jaivisaHeroBrand{position:relative;width:min(86%,390px);display:grid;place-items:center;isolation:isolate}
    .jaivisaHeroBrand:before{content:'';position:absolute;width:85%;height:70%;border-radius:50%;background:#c69aef;filter:blur(72px);opacity:.22;z-index:-1;pointer-events:none}
    .jaivisaHeroBrand img{position:relative!important;inset:auto!important;display:block;width:100%!important;height:auto!important;object-fit:contain!important;mask-image:none!important;filter:drop-shadow(0 12px 22px rgba(17,5,30,.28))}
    .fusionAIHero{background:radial-gradient(ellipse at 75% 48%,rgba(161,91,205,.24),transparent 43%),linear-gradient(120deg,#210f35 0%,#3e195b 62%,#281039 100%)}
    @media(max-width:1050px){.fusionAIMetrics{grid-template-columns:repeat(2,minmax(0,1fr))}.fusionAIBottomGrid{grid-template-columns:1fr}}
    @media(max-width:650px){.fusionAIHero{grid-template-columns:1fr}.fusionAIHeroCopy{padding:26px}.fusionAIHeroVisual{min-height:160px}.fusionAIOrb{width:115px;height:115px}.fusionAIOrb strong{font-size:15px}.fusionAIOrb span{font-size:24px}.fusionAIMetrics{gap:10px}.fusionAIMetric{padding:15px;min-height:155px}.fusionAIMetric strong{font-size:27px}.fusionAIQuickGrid{grid-template-columns:1fr}.fusionAISectionHeading{align-items:start;flex-direction:column}}

    /* JAIVISA | Panel administrador luminoso. Mantiene datos y navegación reales. */
    .layout{background:radial-gradient(circle at 90% 85%,#dfb2ff 0,transparent 35%),#f9f4ff!important}
    .sidebar{background:radial-gradient(circle at 0% 100%,#8b20d6 0,transparent 32%),linear-gradient(175deg,#270739,#470b65 60%,#280b48)!important;position:relative;overflow:hidden}
    .sidebar:after{content:'';position:absolute;bottom:24px;left:-100px;width:480px;height:160px;border-top:2px solid #cc55ff;border-radius:50%;transform:rotate(-24deg);box-shadow:0 -8px 25px #b82aff,0 -24px 40px #258bff;pointer-events:none;opacity:.7}
    .sidebar .brandLogo{background:transparent!important;box-shadow:none!important;max-width:205px!important;max-height:110px!important;object-fit:contain!important;filter:drop-shadow(0 5px 9px #b829ff66)}
    .sidebar .logo{background:transparent!important;padding-top:20px!important}
    .nav button.on{background:linear-gradient(100deg,#bc1ce4,#7409c8)!important;border:1px solid #df71ff!important;box-shadow:0 0 18px #c331ff7c,inset 0 0 12px #ffffff24!important}
    .main{background:radial-gradient(circle at 100% 5%,#d5a6f160,transparent 40%),linear-gradient(135deg,#fffaff,#f6e9ff)!important;padding:18px 22px 40px!important}
    .jvDashboard{max-width:1600px;margin:0 auto;display:grid;gap:19px;color:#2d1049}
    .jvWelcome{display:flex;align-items:center;gap:17px;padding:16px 20px;border:1px solid #e9d0fa;background:linear-gradient(100deg,#fff,#f3e1ff);border-radius:24px;box-shadow:0 9px 25px #b960db20}
    .jvCrown{font-size:38px;display:grid;place-items:center;width:62px;height:62px;color:white;background:linear-gradient(135deg,#d94cf7,#7b11bc);border-radius:17px;box-shadow:0 5px 15px #b921e55c}
    .jvWelcome h2{font-size:clamp(23px,2.5vw,32px);letter-spacing:-.8px;margin:0 0 3px;color:#270c43}.jvWelcome p{margin:0;color:#664777;font-size:14px}
    .jvAdminTag{margin-left:auto;border-radius:40px;padding:11px 16px;background:#fff;color:#5b1684;font-size:12px;font-weight:800;white-space:nowrap}
    .jvStats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:15px}
    .jvStat{display:flex;gap:15px;align-items:flex-start;text-align:left;padding:20px 17px;min-width:0;min-height:158px;border:1px solid #e5c9fa;background:linear-gradient(140deg,#fff,#fcf5ff);border-radius:23px;box-shadow:0 9px 20px #8f32c92b;color:#2a1046}
    button.jvStat:hover{transform:translateY(-3px);box-shadow:0 13px 25px #9b34d44d}
    .jvStatIcon{flex:none;width:57px;height:57px;display:grid;place-items:center;border-radius:16px;background:linear-gradient(145deg,#f7d9ff,#e5b1ff);color:#8614b8;font-size:28px;box-shadow:0 6px 12px #bb57d72c}
    .jvStat>span:last-child{display:flex;flex-direction:column;min-width:0}.jvStat small{font-size:15px;font-weight:800;color:#2d1247}.jvStat strong{font-size:clamp(27px,3vw,39px);line-height:1.35;letter-spacing:-1px}.jvStat .jvMoney{font-size:clamp(18px,2vw,27px);overflow-wrap:anywhere;margin-top:6px}.jvStat em{font-size:11px;color:#785c88;font-style:normal}
    .jvPanels{display:grid;grid-template-columns:1.08fr 1fr;gap:17px}.jvPanel{min-width:0;background:linear-gradient(135deg,#fff,#fffaff);border:1px solid #e7c9fb;border-radius:25px;box-shadow:0 10px 22px #9a3bca2c;padding:23px;min-height:335px}.jvPanel h3{margin:0;color:#2b1048;font-size:21px}.jvPanel h3 span{color:#8e17c6;margin-right:8px}.jvMuted{font-size:12px;color:#81658c;margin:7px 0 14px}
    .jvPanelTitle{display:flex;justify-content:space-between;gap:10px;align-items:center}.jvPanelTitle button{border:0;background:transparent;color:#9311c9;font-weight:800;font-size:13px;white-space:nowrap}
    .jvChart{height:250px;padding:12px 5px 0}.jvBars{height:100%;display:flex;gap:12px;align-items:end;border-bottom:1px solid #e2c9f2;background:repeating-linear-gradient(to top,transparent 0,transparent 48px,#ead9f450 49px,#ead9f450 50px)}.jvBarCol{flex:1;height:100%;min-width:0;display:flex;align-items:center;justify-content:end;flex-direction:column}.jvBar{width:65%;min-height:5px;border-radius:9px 9px 0 0;background:linear-gradient(0deg,#c671f6,#8812c4);box-shadow:0 0 15px #b329e850}.jvBarCol small{font-size:10px;color:#79568b;margin-top:5px}
    .jvEmptyChart{min-height:240px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;color:#78568e;gap:8px}.jvEmptyChart>span{font-size:48px;color:#a331ce}.jvEmptyChart strong{color:#3a1755}.jvEmptyChart p{font-size:12px;margin:0}.jvEmptyChart button{padding:9px 14px;border:1px solid #d4a2ee;border-radius:10px;color:#7a12ad;background:#f8eafd}
    .jvOrderList{display:grid;gap:10px;margin-top:20px}.jvOrder{display:grid;grid-template-columns:65px minmax(0,1fr) auto auto;align-items:center;gap:9px;background:#f8efff;border-radius:14px;padding:15px 12px;font-size:12px}.jvOrder strong{color:#8b17c2}.jvOrder span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.jvOrder b{white-space:nowrap}.jvOrder em{font-style:normal;color:#6c168b;background:#f0d7fb;padding:6px;border-radius:12px;font-size:10px}.jvEmptyOrders{padding:75px 25px;text-align:center;color:#826491;font-size:14px}
    .jvActions{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:15px}.jvActions button{min-height:124px;border-radius:23px;border:1px solid #e7cafa;background:linear-gradient(145deg,#fff,#f5e6ff);color:#591184;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;font-size:16px;font-weight:850;box-shadow:0 8px 18px #9b3bd027}.jvActions button span{font-size:32px}.jvActions button:hover{transform:translateY(-3px);box-shadow:0 10px 20px #ad3ee34d}.jvActions .jvActionPrimary{background:linear-gradient(135deg,#d93bf0,#7509b6);color:white;border-color:#dc6bff;box-shadow:0 7px 18px #9d16d963}
    .jvFooterTools{display:flex;gap:12px;align-items:center;flex-wrap:wrap;background:#fff;border:1px solid #eddbf6;border-radius:17px;padding:16px 20px}.jvFooterTools>div{flex:1}.jvFooterTools strong{font-size:13px}.jvFooterTools p{margin:3px 0;color:#8a7394;font-size:12px}
    @media(max-width:1100px){.jvStats{grid-template-columns:repeat(2,minmax(0,1fr))}.jvPanels{grid-template-columns:1fr}.jvActions{grid-template-columns:repeat(2,minmax(0,1fr))}}
    @media(max-width:600px){.main{padding:12px!important}.jvStats{gap:9px}.jvStat{padding:13px;gap:9px;min-height:135px}.jvStatIcon{width:40px;height:40px;font-size:20px}.jvStat strong{font-size:26px}.jvStat small{font-size:12px}.jvWelcome{padding:13px}.jvWelcome h2{font-size:20px}.jvCrown{width:43px;height:43px;font-size:27px}.jvAdminTag{display:none}.jvPanel{padding:15px}.jvOrder{grid-template-columns:50px minmax(0,1fr) auto}.jvOrder em{grid-column:2 / -1;justify-self:end}.jvActions button{font-size:13px;min-height:105px}}

    /* Logo JAIVISA: proporción real, sin márgenes transparentes excesivos */
    .sidebar .logo{padding:4px 2px 24px!important;position:relative!important;isolation:isolate}
    .sidebar .logo::before{content:"";position:absolute;z-index:-1;left:5%;right:5%;top:10px;height:115px;background:radial-gradient(ellipse,#a74dfd4d 0%,#9d38ff18 48%,transparent 76%);filter:blur(12px);pointer-events:none}
    .sidebar .brandLogo{display:block!important;width:100%!important;max-width:228px!important;height:126px!important;max-height:none!important;object-fit:contain!important;margin:0 auto!important;padding:0!important;background:transparent!important;border:0!important;filter:drop-shadow(0 3px 1px #10091a) drop-shadow(0 0 9px #d49bffb3)!important}
    @media(max-width:800px){.sidebar .brandLogo{height:92px!important;max-width:210px!important}}

    /* Logo de la barra lateral: proporciones y brillo de la referencia JAIVISA */
    .sidebar .logo{padding:10px 0 28px!important;display:flex!important;flex-direction:column!important;align-items:center!important;position:relative!important;isolation:isolate!important}
    .sidebar .logo::before{content:"";position:absolute;left:5%;right:5%;top:12px;height:126px;background:radial-gradient(ellipse at center,#a633ee3b 0%,#8d20c114 42%,transparent 72%);filter:blur(13px);z-index:-1;pointer-events:none}
    .sidebar .brandLogo{width:100%!important;max-width:246px!important;height:132px!important;max-height:none!important;object-fit:contain!important;object-position:center!important;margin:0 auto!important;padding:0!important;background:none!important;border:0!important;opacity:1!important;filter:brightness(1.28) contrast(1.1) drop-shadow(0 3px 2px #13031a) drop-shadow(0 0 10px #cc6bff99)!important}
    .sidebar .logo small{margin-top:-4px!important;color:#e7c9ff!important;letter-spacing:2.6px!important}
    @media(max-width:800px){.sidebar .brandLogo{height:100px!important;max-width:220px!important}.sidebar .logo{padding-bottom:12px!important}}

    /* JAIVISA: logo blanco y violeta luminoso como la referencia */
    .sidebar .logo{isolation:isolate!important;overflow:visible!important;padding:12px 8px 22px!important}
    .sidebar .logo::before{opacity:.45!important}
    .sidebar .brandLogo{
      width:100%!important;max-width:255px!important;height:145px!important;
      max-height:none!important;object-fit:contain!important;opacity:1!important;
      filter:brightness(1.55) contrast(1.16) saturate(1.35)
        drop-shadow(0 3px 2px #10051d)
        drop-shadow(0 0 8px #d35cffaa)!important;
      mix-blend-mode:normal!important;
      position:relative!important;z-index:2!important;
    }
    @media(max-width:800px){.sidebar .brandLogo{height:100px!important;max-width:220px!important}}

    /* Logo original blanco/violeta sobre fondo transparente, sin filtros de color */
    .sidebar .brandLogo{
      display:block!important;width:100%!important;max-width:260px!important;
      height:145px!important;max-height:none!important;object-fit:contain!important;
      filter:drop-shadow(0 3px 4px rgba(20,0,30,.65)) drop-shadow(0 0 12px rgba(202,74,255,.55))!important;
      opacity:1!important;mix-blend-mode:normal!important;
    }
    .sidebar .logo{background:transparent!important}

.jv-catalog-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:18px;margin-top:18px}
.jv-catalog-card{border:1px solid #e9d9f2;border-radius:18px;overflow:hidden;background:#fff;box-shadow:0 8px 28px #3d155019}
.jv-catalog-cover{height:260px;background:#f4eef9;overflow:hidden;position:relative}
.jv-catalog-cover iframe{border:0;width:100%;height:100%;pointer-events:none;background:#f4eef9}
.jv-catalog-open{display:block;text-align:center;padding:11px 13px;background:linear-gradient(105deg,#a02fe0,#5b198c);color:#fff!important;border-radius:11px;font-weight:700;text-decoration:none}
.jv-catalog-delete{background:#fff;border:1px solid #decce8;border-radius:9px;padding:8px;cursor:pointer;color:#642c80}
.jv-client-shell{background:radial-gradient(ellipse at top left,#f1e4ff,#fbf9ff 50%,#f5f0ff)}
.jv-client-header{background:linear-gradient(105deg,#2a0b42,#562076,#31104e);color:#fff;padding:20px max(22px,5vw);display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;box-shadow:0 5px 25px #4d1b7950}
.jv-client-tab{padding:12px 20px;border-radius:12px;border:1px solid #dfcde9;background:#fff;color:#5d277b;font-weight:750;cursor:pointer}
.jv-client-tab.active{background:linear-gradient(100deg,#a02fe0,#5b198c);color:#fff;border-color:transparent;box-shadow:0 6px 20px #8233b744}
  `}</style><div className="layout" style={{ '--brand-primary': themeSettings.primary, '--brand-accent': themeSettings.accent, '--brand-surface': themeSettings.surface, '--brand-font': themeFont(themeSettings.font) } as React.CSSProperties}><aside className="sidebar"><div className="logo"><img className="brandLogo" src={JAIVISA_LOGO} alt="Jaivisa.com, logo oficial" /><small>PORTAL MAYORISTA <i>◆</i></small></div><nav className="nav">{menu.map(m => <button key={m} className={page === m ? 'on' : ''} onClick={() => setPage(m)}><NavIcon name={m} /> <span>{m}</span></button>)}</nav><div className="sidebottom"><span className="pulseDot" /> SISTEMA JAIVISA <small>Portal interno · Versión de pruebas</small></div></aside><main className="main"><header className="top"><div><div className="hint">CENTRO DE CONTROL <span className="crumbSep">/</span> JAIVISA</div><h1>{page}</h1></div><span className="pill"><NavIcon name="Permisos" /> Administrador <span className="onlineDot" /></span></header>
      {page === 'Inicio' && <div className="jvDashboard">
        <section className="jvWelcome"><span className="jvCrown">♕</span><div><h2>Panel del Administrador</h2><p>Gestión general de JAIVISA · Resumen del portal</p></div><span className="jvAdminTag">● Administrador</span></section>
        <section className="jvStats">
          <button onClick={() => setPage('Pedidos')} className="jvStat"><span className="jvStatIcon">🛒</span><span><small>Pedidos</small><strong>{orders.length}</strong><em>Consultar pedidos</em></span></button>
          <button onClick={() => setPage('Productos')} className="jvStat"><span className="jvStatIcon">▧</span><span><small>Productos</small><strong>{products.length}</strong><em>Inventario registrado</em></span></button>
          <button onClick={() => setPage('Clientes')} className="jvStat"><span className="jvStatIcon">♧</span><span><small>Clientes</small><strong>{clients.length}</strong><em>Clientes registrados</em></span></button>
          <div className="jvStat"><span className="jvStatIcon">▥</span><span><small>Ventas registradas</small><strong className="jvMoney">{money(orders.reduce((total, order) => total + order.lines.reduce((sum, line) => sum + line.qty * line.price, 0), 0))}</strong><em>Total de pedidos en el portal</em></span></div>
        </section>
        <section className="jvPanels">
          <div className="jvPanel"><h3><span>▥</span> Ventas por pedidos recientes</h3><p className="jvMuted">Valores de pedidos registrados · Pesos colombianos</p>
            {orders.length ? <div className="jvChart"><div className="jvBars">{orders.slice(-8).map((o, i) => { const total = o.lines.reduce((sum, l) => sum + l.qty * l.price, 0); const max = Math.max(1, ...orders.slice(-8).map(a => a.lines.reduce((sum, l) => sum + l.qty * l.price, 0))); return <div className="jvBarCol" key={o.id + '-' + i} title={`${o.customer}: ${money(total)}`}><div className="jvBar" style={{ height: `${Math.max(4, total / max * 100)}%` }} /><small>#{o.id.slice(-4)}</small></div> })}</div></div> : <div className="jvEmptyChart"><span>▥</span><strong>Aún no hay ventas registradas</strong><p>La gráfica aparecerá cuando registres pedidos.</p><button onClick={() => setPage('Pedidos')}>Ir a pedidos</button></div>}
          </div>
          <div className="jvPanel"><div className="jvPanelTitle"><h3><span>🛒</span> Pedidos recientes</h3><button onClick={() => setPage('Pedidos')}>Ver todos →</button></div>
            {orders.length ? <div className="jvOrderList">{orders.slice(-4).reverse().map(o => <div className="jvOrder" key={o.id}><strong>#{o.id.slice(-5)}</strong><span title={o.customer}>{o.customer}</span><b>{money(o.lines.reduce((sum, l) => sum + l.qty * l.price, 0))}</b><em>{o.status}</em></div>)}</div> : <div className="jvEmptyOrders">No hay pedidos todavía. Los nuevos pedidos aparecerán aquí automáticamente.</div>}
          </div>
        </section>
        <section className="jvActions">
          <button className="jvActionPrimary" onClick={() => setPage('Productos')}><span>⊞</span>Nuevo producto</button>
          <button onClick={() => setPage('Pedidos')}><span>🛒</span>Crear pedido</button>
          <button onClick={() => setPage('Clientes')}><span>♧</span>Registrar cliente</button>
          <button onClick={() => setPage('Bodega')}><span>▥</span>Ver inventario</button>
        </section>
        <section className="jvFooterTools"><div><strong>Personaliza la portada de JAIVISA</strong><p>Puedes subir una imagen de campaña sin modificar tu información.</p></div><label className="bannerUpload">{bannerImage ? 'Cambiar imagen' : 'Subir imagen'}<input type="file" accept="image/png,image/jpeg,image/webp" onChange={e => { uploadBanner(e.target.files?.[0]); e.target.value = ''; }} /></label>{bannerImage && <button className="bannerRemove" onClick={removeBanner}>Quitar imagen</button>}{bannerError && <p role="alert">{bannerError}</p>}</section>
      </div>}
      {page === 'Personalización' && <section className="panel themeEditor">
        <div className="sectionEyebrow">IDENTIDAD VISUAL · ADMINISTRACIÓN</div>
        <h3>Personaliza JAIVISA</h3>
        <p className="muted">Elige colores, tipografía y estilo visual. Observa la vista previa y guarda los cambios cuando estés conforme.</p>
        <div className="themeGrid">
          <div className="themeControls">
            {([['primary', 'Color principal'], ['accent', 'Color de acento'], ['surface', 'Color de fondo']] as const).map(([key, label]) => <label className="themeColor" key={key}><span>{label}</span><input type="color" value={themeDraft[key]} onChange={e => setThemeDraft({ ...themeDraft, [key]: e.target.value })} /><code>{themeDraft[key].toUpperCase()}</code></label>)}
            <label className="field">Tipografía<select value={themeDraft.font} onChange={e => setThemeDraft({ ...themeDraft, font: e.target.value })}><option>Inter</option><option>Montserrat</option><option>Poppins</option><option>Arial</option></select></label>
            <label className="field">Estilo visual<select value={themeDraft.style} onChange={e => setThemeDraft({ ...themeDraft, style: e.target.value })}><option>Moderno</option><option>Elegante</option><option>Futurista</option></select></label>
            <div className="themeButtons"><button className="primary" type="button" onClick={saveTheme}>Guardar diseño</button><button className="secondary" type="button" onClick={resetTheme}>Restaurar original</button></div>
          </div>
          <div className="themePreview" style={{ background: themeDraft.surface, fontFamily: themeFont(themeDraft.font) }}>
            <div className="themePreviewHeader" style={{ background: themeDraft.primary }}><span>JAIVISA</span><small>PORTAL MAYORISTA</small></div>
            <div className="themePreviewBody"><span className="previewEyebrow" style={{ color: themeDraft.accent }}>VISTA PREVIA · {themeDraft.style.toUpperCase()}</span><h3>Tu negocio, en un solo lugar.</h3><p>Un portal diseñado para vender mejor.</p><button type="button" style={{ background: themeDraft.accent, color: '#fff', border: 0, padding: '11px 16px', borderRadius: 10 }}>Explorar catálogo →</button><div className="previewCards"><span>Catálogos</span><span>Pedidos</span><span>Clientes</span></div></div>
          </div>
        </div>
        <p className="muted">Los cambios se guardan por ahora en este navegador. Para publicarlos para todos los usuarios será necesaria una base de datos y permisos reales.</p>
      </section>}
      {page === 'Catálogo' && <>
        <section className="catalogHeading"><div><span className="hint">PORTAFOLIO MAYORISTA · JAIVISA</span><h2>{category || 'Explora nuestros catálogos'}</h2><p className="muted">{category ? 'Selecciona tus productos y agrégalos al pedido.' : 'Productos organizados por categorías. Precios base sin IVA.'}</p></div><button className="secondary" onClick={() => { setPage('Carrito'); }}>🛒 Ver carrito ({cart.reduce((a, l) => a + l.qty, 0)})</button></section>
        <section className="panel"><input className="catalogSearch" value={search} onChange={e => setSearch(e.target.value)} placeholder="🔎 Buscar por nombre, referencia o código de barras" />
          {category && <button className="backCat" onClick={() => { setCategory(''); setSearch(''); }}>← Todas las categorías</button>}
          {!category && <div className="categoryGrid">{categories.map(c => { const count = products.filter(p => (p.category || 'Tecnología') === c.name).length; return <button className="categoryCard" key={c.name} onClick={() => { setCategory(c.name); setSearch(''); }}><div className="categoryArt" style={{ background: c.shade }}><span className="catGlyph"><NavIcon name={({ 'Tecnología': 'Productos', 'Juegos': 'Pedidos', 'Didácticos': 'Catálogo', 'Vehículos y animales': 'Bodega', 'Juguetes niñas': 'Clientes', 'Cacharrería y papelería': 'Etiquetas', 'Personajes y bebés': 'Productos', 'Maquillaje y belleza': 'Clientes', 'Profesional de la belleza': 'Empleados', 'Bolsos, carteras, medias y gafas': 'Carrito' } as Record<string, string>)[c.name]} /></span><small>COLECCIÓN JAIVISA / 2026</small></div><div className="categoryInfo"><strong>{c.name}</strong><span>{c.description}</span><small>{count} {count === 1 ? 'referencia' : 'referencias'} disponibles　→</small></div></button> })}</div>}
          {(category || search.trim()) && <div className="catalogProducts">{products.filter(p => (!category || (p.category || 'Tecnología') === category) && (!search.trim() || `${p.name} ${p.sku} ${p.barcode}`.toLowerCase().includes(search.toLowerCase()))).map(p => <article className="catalogProduct" key={p.id}><div className="catalogPhoto">{p.image ? <img src={p.image} alt={p.name} /> : <span>{categories.find(c => c.name === (p.category || 'Tecnología'))?.icon || '📦'}</span>}</div><div className="catalogDetails"><small>{p.sku} · {p.category || 'Tecnología'}</small><strong>{p.name}</strong><b>{money(p.price)}</b><small>Precio sin IVA · IVA {p.iva}%</small><div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center', margin: '12px 0 10px', flexWrap: 'wrap' }}><span style={{ fontSize: 13, fontWeight: 700, color: '#604578' }}>Cantidad</span><button type="button" aria-label="Restar una unidad" onClick={() => setQty(p.id, (selectedQty[p.id] || 1) - 1)} style={{ width: 38, height: 38, border: '1px solid #d8c5e9', borderRadius: 10, background: '#f8f3fc', color: '#552078', fontWeight: 800, fontSize: 20 }}>−</button><input aria-label={'Cantidad de ' + p.name} type="number" min="1" step="1" value={selectedQty[p.id] || 1} onChange={e => setQty(p.id, Number(e.target.value))} style={{ width: 76, height: 38, textAlign: 'center', border: '1px solid #d8c5e9', borderRadius: 10, fontWeight: 700 }} /><button type="button" aria-label="Sumar una unidad" onClick={() => setQty(p.id, (selectedQty[p.id] || 1) + 1)} style={{ width: 38, height: 38, border: '1px solid #d8c5e9', borderRadius: 10, background: '#f8f3fc', color: '#552078', fontWeight: 800, fontSize: 20 }}>+</button></div><small style={{ display: 'block', textAlign: 'center', marginBottom: 10 }}>Subtotal: {money(p.price * (selectedQty[p.id] || 1))}</small><button className="primary" onClick={() => addToCart(p)}>+ Agregar {selectedQty[p.id] || 1} al pedido</button></div></article>)}{products.filter(p => (!category || (p.category || 'Tecnología') === category) && (!search.trim() || `${p.name} ${p.sku} ${p.barcode}`.toLowerCase().includes(search.toLowerCase()))).length === 0 && <p className="muted">No hay productos en esta categoría todavía. Puedes agregarlos desde Productos.</p>}</div>}
        </section><div className="cartDock"><div><b>🛒 {cart.reduce((a, l) => a + l.qty, 0)} artículos</b><span>{money(subtotal + iva)}</span></div><button onClick={() => setPage('Carrito')}>Revisar pedido →</button></div>
      </>}
      {page === 'Productos' && <><section className="panel"><h3>{product.id ? 'Editar producto' : 'Crear producto'}</h3><form className="grid" onSubmit={saveProduct}><label className="field">Referencia SKU<input required value={product.sku} onChange={e => setProduct({ ...product, sku: e.target.value })} /></label><label className="field">Nombre<input required value={product.name} onChange={e => setProduct({ ...product, name: e.target.value })} /></label><label className="field">Categoría del catálogo<select value={product.category || 'Tecnología'} onChange={e => setProduct({ ...product, category: e.target.value })}>{categories.map(c => <option key={c.name}>{c.name}</option>)}</select></label><label className="field">URL de imagen (opcional)<input placeholder="https://..." value={product.image || ''} onChange={e => setProduct({ ...product, image: e.target.value })} /></label><label className="field">Código de barras<input value={product.barcode} onChange={e => setProduct({ ...product, barcode: e.target.value })} /></label><label className="field">Precio sin IVA<input type="number" min="0" value={product.price} onChange={e => setProduct({ ...product, price: Number(e.target.value) })} /></label><label className="field">IVA aplicable<select value={product.iva} onChange={e => setProduct({ ...product, iva: Number(e.target.value) })}><option value={0}>0%</option><option value={5}>5%</option><option value={19}>19%</option></select></label><label className="field">Existencias<input type="number" min="0" value={product.stock} onChange={e => setProduct({ ...product, stock: Number(e.target.value) })} /></label><button className="primary">{product.id ? 'Guardar cambios' : 'Agregar producto'}</button><button type="button" className="secondary" onClick={() => setProduct(blankProduct())}>Limpiar</button></form></section><section className="panel"><h3>Productos registrados</h3><div className="table"><table><thead><tr><th>SKU</th><th>Producto</th><th>Categoría</th><th>Precio base</th><th>IVA</th><th>Stock</th><th>Acciones</th></tr></thead><tbody>{products.map(p => <tr key={p.id}><td>{p.sku}</td><td>{p.name}</td><td>{p.category || 'Tecnología'}</td><td>{money(p.price)}</td><td>{p.iva}%</td><td>{p.stock}</td><td><div className="actions"><button className="secondary" onClick={() => setProduct(p)}>Editar</button><button className="secondary danger" onClick={() => { if (confirm('¿Eliminar este producto?')) setProducts(old => old.filter(x => x.id !== p.id)); }}>Eliminar</button></div></td></tr>)}</tbody></table></div></section></>}
      {page === 'Empleados' && <><section className="panel"><div className="sectionEyebrow">GESTIÓN DEL EQUIPO</div><h3>{worker.id ? 'Editar empleado' : 'Crear empleado'}</h3><p className="muted">Las cuentas se registran en el sistema de JAIVISA. Los cargos disponibles son vendedor y bodega; los permisos del módulo de trabajo todavía requieren validación del servidor.</p>{workerNotice && <p className="notice" role="status">{workerNotice}</p>}<form className="grid" onSubmit={saveWorker}><label className="field">Nombre completo<input required value={worker.name} onChange={e => setWorker({ ...worker, name: e.target.value })} /></label><label className="field">Documento<input value={worker.document} onChange={e => setWorker({ ...worker, document: e.target.value })} /></label><label className="field">Teléfono<input value={worker.phone} onChange={e => setWorker({ ...worker, phone: e.target.value })} /></label><label className="field">Correo laboral<input required type="email" value={worker.email || ''} onChange={e => setWorker({ ...worker, email: e.target.value })} /></label><label className="field">Código de empleado<input value={worker.employeeCode || ''} onChange={e => setWorker({ ...worker, employeeCode: e.target.value })} placeholder="Opcional" /></label><label className="field">Cargo<select value={cargoJAIVISA(worker.role)} onChange={e => setWorker({ ...worker, role: e.target.value === 'bodega' ? 'Auxiliar de bodega' : 'Vendedor de ruta' })}><option value="vendedor">Vendedor</option><option value="bodega">Bodega</option></select></label><button className="primary" disabled={workerSaving}>{workerSaving ? 'Guardando…' : worker.id ? 'Guardar cambios' : 'Crear empleado'}</button><button type="button" className="secondary" onClick={() => setWorker(blankWorker())}>Limpiar</button></form><div className="securityPanel"><div className="securityTitle">🔐 Acceso y contraseña del empleado</div><p className="muted">Selecciona Editar en el directorio para cambiar una contraseña. No se almacena en el navegador.</p><button type="button" className="secondary" onClick={() => void cambiarClaveEmpleado()}>🔑 Cambiar contraseña</button></div></section><section className="panel"><h3>Equipo JAIVISA · {workers.length} empleados</h3><button type="button" className="secondary" disabled={workersLoading} onClick={() => void cargarEmpleados()}>{workersLoading ? 'Consultando…' : '🔄 Actualizar información'}</button>{!workersLoading && workers.length === 0 && <p className="muted">Todavía no hay empleados registrados en JAIVISA.</p>}{workers.map(w => <div className="row" key={w.id}><div><strong>{w.name}</strong><small>{w.email} · {w.employeeCode || 'Sin código'} · {w.role} · {w.enabled ? 'Activo' : 'Suspendido'}</small></div><div className="actions"><button className="secondary" onClick={() => setWorker({ ...w })}>Editar</button><button className="secondary" onClick={() => void cambiarEstadoEmpleado(w)}>{w.enabled ? 'Suspender' : 'Activar'}</button></div></div>)}</section></>}
      {page === 'Clientes' && <><section id="jaivisa-client-form" className="panel"><div className="sectionEyebrow">CLIENTES MAYORISTAS</div><h3>{client.id ? 'Editar cliente' : 'Registrar cliente'}</h3><p className="muted">Los clientes se registran en JAIVISA. Al crear uno, se genera su cuenta de acceso con la contraseña inicial que establezcas.</p>{clientNotice && <p role="status" style={{ padding: '12px 16px', background: '#f3e7fb', borderRadius: 12, color: '#53216e' }}>{clientNotice}</p>}<form className="grid" onSubmit={saveClient}><label className="field">Nombre o razón social<input required value={client.name} onChange={e => setClient({ ...client, name: e.target.value })} /></label><label className="field">NIT / Documento<input value={client.document} onChange={e => setClient({ ...client, document: e.target.value })} /></label><label className="field">Correo de acceso<input required type="email" value={client.email} onChange={e => setClient({ ...client, email: e.target.value })} /></label><label className="field">País de la empresa<select value={client.country || 'Colombia'} onChange={e => { const indicativos: Record<string, string> = { 'Colombia': '+57', 'México': '+52', 'Perú': '+51', 'Ecuador': '+593', 'Estados Unidos': '+1', 'Panamá': '+507', 'Venezuela': '+58', 'Chile': '+56', 'Argentina': '+54', 'España': '+34' }; setClient({ ...client, country: e.target.value, dialCode: indicativos[e.target.value] || '+57', city: '' }); setDepartamentoCliente(''); }}>{['Colombia', 'México', 'Perú', 'Ecuador', 'Estados Unidos', 'Panamá', 'Venezuela', 'Chile', 'Argentina', 'España'].map(p => <option key={p} value={p}>{p}</option>)}</select></label><label className="field">Indicativo internacional<input value={client.dialCode || '+57'} onChange={e => setClient({ ...client, dialCode: e.target.value })} placeholder="+57" inputMode="tel" maxLength={6} /></label><label className="field">Teléfono / WhatsApp<input value={client.phone} onChange={e => setClient({ ...client, phone: e.target.value })} /></label><SelectorUbicacion pais={client.country || 'Colombia'} departamento={departamentoCliente} ciudad={client.city} onDepartamento={setDepartamentoCliente} onCiudad={v => setClient(old => ({ ...old, city: v }))} /><label className="field">Dirección<input value={client.address} onChange={e => setClient({ ...client, address: e.target.value })} /></label><button className="primary" disabled={clientSaving}>{clientSaving ? 'Guardando…' : client.id ? 'Guardar cambios' : 'Crear cliente'}</button><button type="button" className="secondary" onClick={() => { setClient(blankClient()); setDepartamentoCliente(''); setClientNotice(''); }}>Limpiar</button></form><div className="securityPanel"><div className="securityTitle">🔐 Acceso y contraseña del cliente</div><p className="muted">Las cuentas y contraseñas se administran de forma segura en JAIVISA. Para cambiar una clave directamente, selecciona primero Editar en el cliente. También puedes enviar un enlace de recuperación por correo.</p><div className="securityActions"><button className="secondary" type="button" onClick={async () => { const email = client.email.trim().toLowerCase(); if (!email) { setClientNotice('Selecciona un cliente con correo electrónico antes de enviar el enlace.'); return; } if (!window.confirm('¿Solicitar un enlace de recuperación para ' + email + '?')) return; try { const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin }); if (error) throw error; setClientNotice('Solicitud enviada. Si existe una cuenta de acceso con ese correo, recibirá un enlace para establecer su contraseña. Revisa también la carpeta de spam.'); } catch (e: any) { setClientNotice('No fue posible solicitar el enlace: ' + (e?.message || 'Error desconocido') + '. Si hay límite de correos, inténtalo más tarde.'); } }}>✉️ Enviar enlace de contraseña</button><button className="secondary" type="button" onClick={() => void cambiarClaveCliente()}>🔑 Cambiar contraseña</button></div><small className="securityFoot">Por seguridad, las contraseñas se envían a la función protegida y no se guardan en el navegador. Evita usar contraseñas compartidas.</small></div></section><section className="panel"><h3>Directorio de clientes · {clients.length}</h3><button className="secondary" type="button" disabled={clientsLoading} onClick={() => void cargarClientes()}>{clientsLoading ? 'Consultando…' : '🔄 Actualizar información'}</button>{clients.length === 0 && <p className="muted">Todavía no hay clientes registrados.</p>}{clients.map(c => <div className="row" key={c.id}><div><strong>{c.name}</strong><small>{c.email} · {c.document || 'Sin documento'} · {c.country || 'Colombia'} · {c.dialCode || '+57'} {c.phone} · {c.access}</small></div><div className="actions"><button className="secondary" onClick={() => editClient(c)}>Editar</button><button className="secondary" onClick={() => void cambiarEstadoCliente(c)}>{c.enabled ? 'Suspender' : 'Reactivar'}</button></div></div>)}</section></>}
      {page === 'Accesos' && <><section className="panel"><div className="sectionEyebrow">SEGURIDAD Y ACCESO</div><h3>Activación de cuentas</h3><p className="muted">Aquí se gestionarán las invitaciones, contraseñas temporales y recuperación de acceso por correo. Esta versión no almacena contraseñas ni simula un inicio de sesión seguro.</p><div className="accessTiles"><div><strong>👥 {workers.length} empleados</strong><p className="muted">Creados por administración</p></div><div><strong>🏬 {clients.length} clientes</strong><p className="muted">Registrados para el portal mayorista</p></div></div><div className="securityPanel"><div className="securityTitle">🛡️ Recuperación del administrador general</div><p className="muted">El administrador podrá recuperar su propia clave con un enlace seguro enviado a su correo registrado. Ningún empleado podrá consultar su contraseña.</p><button className="secondary" type="button" onClick={() => alert('La recuperación del administrador por correo se habilitará con autenticación segura.')}>Recuperar clave de administrador</button></div><div className="notice">🔒 Próxima integración: autenticación segura con invitación por correo, contraseña temporal, cambio obligatorio en el primer ingreso y recuperación mediante enlace de un solo uso. Los permisos se verificarán en el servidor.</div><button className="secondary" onClick={() => setPage('Empleados')}>Gestionar empleados</button> <button className="secondary" onClick={() => setPage('Clientes')}>Gestionar clientes</button></section><section className="panel"><h3>Vista prevista del acceso</h3><div className="accessDemo"><label className="field">Correo electrónico<input type="email" placeholder="usuario@empresa.com" autoComplete="off" /></label><label className="field">Contraseña<input type="password" placeholder="••••••••" autoComplete="off" /></label><button className="primary" type="button" onClick={() => alert('Vista de diseño. El acceso real se habilitará cuando conectemos el servicio de autenticación.')}>Iniciar sesión (demostración)</button><button className="secondary" type="button" onClick={() => alert('El restablecimiento por correo estará disponible al conectar la autenticación.')}>Olvidé mi contraseña</button></div></section></>}
      {page === 'Permisos' && <section className="panel"><h3>Permisos personalizados</h3><p className="muted">El administrador podrá decidir qué puede hacer cada trabajador. Los permisos se registran en JAIVISA, pero el servidor debe validarlos antes de autorizar cada operación.</p><select className="wideSelect" value={selectedWorker} onChange={e => setSelectedWorker(e.target.value)}><option value="">Seleccionar empleado</option>{workers.map(w => <option key={w.id} value={w.id}>{w.name} · {w.role}</option>)}</select>{selected && <div style={{ marginTop: 16 }}>{permissions.map(p => <label className="check" key={p}><span>{p}</span><input type="checkbox" checked={selected.permissions.includes(p)} onChange={() => void cambiarPermisoEmpleado(selected, p)} /></label>)}</div>}</section>}
      {page === 'Centro de Pedidos' && <CentroPedidos rol="administrador" />}
      {page === 'Operaciones empresariales' && <ModulosEmpresa rol="administrador" />}
      {page === 'Carrito' && <><section className="panel"><h3>Datos del cliente</h3><div className="grid">{([['customer', 'Cliente o negocio'], ['phone', 'Teléfono / WhatsApp'], ['email', 'Correo electrónico'], ['city', 'Ciudad'], ['address', 'Dirección']] as const).map(([key, title]) => <label className="field" key={key}>{title}<input value={customer[key]} onChange={e => setCustomer({ ...customer, [key]: e.target.value })} /></label>)}</div></section><section className="panel"><h3>Productos por categoría</h3><p className="muted">Elige una categoría para ver sus productos. Puedes agregar artículos de varios catálogos al mismo pedido.</p><button className="primary" onClick={() => { setCategory(''); setSearch(''); setPage('Catálogo'); }}>🗂️ Explorar catálogos →</button></section><section className="panel"><h3>Carrito de compras</h3>{cart.length === 0 ? <p className="muted">El carrito está vacío.</p> : <><div className="table"><table><thead><tr><th>Producto</th><th>Cantidad</th><th>Precio negociado</th><th>IVA</th><th>Total</th><th></th></tr></thead><tbody>{cart.map(l => { const p = getProduct(l.productId); return <tr key={l.productId}><td>{p?.name || 'Producto retirado'}</td><td><input type="number" min="1" value={l.qty} onChange={e => updateLine(l.productId, { qty: Math.max(1, Number(e.target.value)) })} /></td><td><input type="number" min="0" value={l.price} onChange={e => updateLine(l.productId, { price: Math.max(0, Number(e.target.value)) })} /></td><td>{p?.iva || 0}%</td><td>{money(l.qty * l.price * (1 + (p?.iva || 0) / 100))}</td><td><button className="secondary danger" onClick={() => setCart(old => old.filter(x => x.productId !== l.productId))}>Quitar</button></td></tr>; })}</tbody></table></div><div className="total"><div>Subtotal sin IVA <strong>{money(subtotal)}</strong></div><div>IVA <strong>{money(iva)}</strong></div><div className="big">TOTAL <span>{money(subtotal + iva)}</span></div></div><button className="primary" onClick={saveOrder}>Guardar pedido</button></>}</section></>}
      {page === 'Pedidos' && <><section className="panel"><h3>Estadísticas de cobros · prototipo local</h3><p className="muted">Las cifras siguientes se calculan sobre pedidos guardados en este navegador. No son todavía ventas sincronizadas con JAIVISA.</p><div className="grid"><div className="card"><small>Ventas efectivas (pagadas)</small><b>{money(orders.filter(esVentaEfectiva).reduce((t, o) => t + totalPedido(o), 0))}</b></div><div className="card"><small>Dinero recibido</small><b>{money(orders.reduce((t, o) => t + (o.montoPagado || 0), 0))}</b></div><div className="card"><small>Cartera pendiente</small><b>{money(orders.reduce((t, o) => t + Math.max(0, totalPedido(o) - (o.montoPagado || 0)), 0))}</b></div></div></section><section className="panel"><h3>Historial de pedidos</h3>{orders.length === 0 && <p className="muted">Todavía no hay pedidos.</p>}{orders.map(o => <div className="row" key={o.id}><div><strong>{o.id} · {o.customer}</strong><small>{o.created} · {o.city} · {o.lines.length} referencias · {money(totalPedido(o))}</small><small>Pago: {o.pago === 'pagado' ? 'PAGADO' : o.pago === 'parcial' ? 'PARCIAL' : 'PENDIENTE'}</small></div><div className="actions" style={{ flexWrap: 'wrap' }}><span className="badge">{o.status}</span><select aria-label="Estado de pago" value={o.pago || 'pendiente'} onChange={e => registrarPago(o, e.target.value as 'pendiente' | 'parcial' | 'pagado')}><option value="pendiente">Pago pendiente</option><option value="parcial">Pago parcial</option><option value="pagado">Pagado totalmente</option></select><button className="secondary" onClick={() => imprimirOrdenIlustrada(o)}>🖨️ Pedido con fotos / PDF</button><button className="secondary" onClick={() => { setSelectedOrder(o.id); setPage('Etiquetas'); }}>Etiquetas</button>{destinatariosWA.filter(d => d.activo).map(d => <button key={d.id} className="secondary" onClick={() => compartirWhatsApp(o, d)}>WhatsApp · {d.nombre}</button>)}</div></div>)}</section></>}
      {page === 'Bodega' && <><section className="panel"><h3>🔔 Centro de bodega</h3><p className="muted">Cuando conectemos una base de datos en tiempo real, los pedidos nuevos podrán activar una alerta en los equipos autorizados.</p><button className="primary" onClick={() => { setSound(true); beep(); }}>🔊 Probar alerta sonora</button>{sound && <span className="badge" style={{ marginLeft: 10 }}>Sonido probado</span>}</section><section className="panel"><h3>Pedidos por preparar</h3>{orders.length === 0 && <p className="muted">Crea un pedido desde el carrito para verlo aquí.</p>}{orders.map(o => <div className="row" key={o.id}><div><strong>{o.id} · {o.customer}</strong><small>{o.city} · {o.created}</small></div><div className="actions"><select value={o.status} onChange={e => changeStatus(o.id, e.target.value)}><option>Nuevo</option><option>En preparación</option><option>Empacado</option><option>En ruta</option><option>Entregado</option></select><button className="secondary" onClick={() => { setSelectedOrder(o.id); setPage('Etiquetas'); }}>Imprimir etiqueta</button></div></div>)}</section></>}
      {page === 'Etiquetas' && <section className="panel"><h3>🏷️ Etiquetas internas de despacho</h3><p className="muted">Sin precios. Cada caja recibe un identificador único vinculado al pedido. La impresión de esta versión es básica; el código escaneable y el ajuste exacto a las impresoras se implementarán en la siguiente etapa.</p><div className="grid"><label className="field">Pedido<select value={chosenOrder?.id || ''} onChange={e => setSelectedOrder(e.target.value)}>{orders.length === 0 && <option value="">Sin pedidos</option>}{orders.map(o => <option key={o.id} value={o.id}>{o.id} · {o.customer}</option>)}</select></label><label className="field">Impresora<select value={labelType} onChange={e => setLabelType(e.target.value)}><option>Brother QL-800 · Adhesiva</option><option>Epson TM-T88V · Térmica</option><option>Impresora normal · Hoja</option></select></label><label className="field">Cantidad de cajas / etiquetas<input type="number" min="1" max="100" value={labelCount} onChange={e => setLabelCount(Math.max(1, Math.min(100, Number(e.target.value) || 1)))} /></label></div>{chosenOrder && <div className="labelPreview" style={{ marginTop: 20 }}><h3>JAIVISA · BODEGA</h3><strong>{chosenOrder.id}</strong><p>Cliente: {chosenOrder.customer}</p><p>Teléfono: {chosenOrder.phone}</p><p>Ciudad: {chosenOrder.city}</p><p>Dirección: {chosenOrder.address}</p><p>Caja 1 de {labelCount}</p><hr /><strong>{chosenOrder.id}-C01</strong><p className="muted">Identificador interno · Vista previa</p></div>}<button className="primary" style={{ marginTop: 16 }} onClick={printLabel}>🖨️ Imprimir etiquetas de prueba</button><p className="notice">Antes de imprimir en rollos adhesivos Brother, debemos adaptar el tamaño de página al rollo DK que utilicen. La Epson TM-T88V se usará para comprobantes térmicos.</p></section>}
      {page === 'Catálogos PDF' && <CatalogosVistaPrevia />}
      {page === 'WhatsApp y pedidos' && <><section className="panel"><h3>📲 Destinatarios de pedidos por WhatsApp</h3><p className="muted">Solo administración. Números registrados en JAIVISA y protegidos por políticas RLS. Para compartir un pedido, abre Pedidos y pulsa el botón del destinatario. El PDF ilustrado se adjunta manualmente en WhatsApp.</p>{waMensaje && <p role="alert" className="notice">{waMensaje}</p>}<div className="grid"><label className="field">Nombre del destinatario<input value={waNombre} onChange={e => setWaNombre(e.target.value)} placeholder="Bodega principal" /></label><label className="field">Número internacional<input value={waTelefono} onChange={e => setWaTelefono(e.target.value)} placeholder="+573001234567" /></label></div><div className="actions"><button className="primary" onClick={() => void guardarDestinatarioWA()}>Guardar destinatario</button><button className="secondary" onClick={() => void cargarDestinatariosWA()} disabled={waCargando}>{waCargando ? 'Cargando…' : 'Actualizar lista'}</button></div></section><section className="panel"><h3>Números configurados</h3>{destinatariosWA.length === 0 && <p className="muted">No hay números configurados o no se ha conectado la tabla SQL.</p>}{destinatariosWA.map(d => <div className="row" key={d.id}><div><strong>{d.nombre}</strong><small>{d.telefono} · {d.activo ? 'Activo' : 'Inactivo'}</small></div><div className="actions" style={{ flexWrap: 'wrap' }}><button className="secondary" onClick={() => void actualizarDestinatarioWA(d, { activo: !d.activo })}>{d.activo ? 'Desactivar' : 'Activar'}</button><button className="secondary" onClick={() => { const nombre = window.prompt('Nombre del destinatario', d.nombre); if (nombre !== null && nombre.trim()) void actualizarDestinatarioWA(d, { nombre: nombre.trim() }); }}>Editar nombre</button><button className="secondary" onClick={() => { const telefono = window.prompt('Número internacional (+57...)', d.telefono); if (telefono === null) return; const limpio = telefono.replace(/[\s()\-]/g, ''); if (!/^\+[1-9][0-9]{7,14}$/.test(limpio)) { alert('Número inválido'); return; } void actualizarDestinatarioWA(d, { telefono: limpio }); }}>Editar número</button><button className="secondary danger" onClick={() => void eliminarDestinatarioWA(d)}>Eliminar</button></div></div>)}</section></>}
      <footer className="footer">JAIVISA · Portal Mayorista · Portal de gestión · Documentos de bodega no equivalen a factura electrónica</footer></main></div></>;
}


// Acceso único para administración, equipo y clientes mayoristas.
type PerfilAcceso = { id: string; rol: string; aprobado: boolean; nombre?: string | null; documento?: string | null; telefono?: string | null; ciudad?: string | null; direccion?: string | null; correo?: string | null };
const campo: React.CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '12px 13px', border: '1px solid #d9cce2', borderRadius: 10, fontSize: 15, background: '#fff' };
const boton: React.CSSProperties = { padding: '13px 16px', border: 0, borderRadius: 11, background: '#582075', color: '#fff', fontWeight: 750, cursor: 'pointer' };
const enlace: React.CSSProperties = { background: 'none', border: 0, color: '#652985', fontWeight: 700, cursor: 'pointer', padding: 6 };
const etiqueta: React.CSSProperties = { display: 'grid', gap: 5, color: '#442450', fontWeight: 600, fontSize: 13 };

// Presentación del nombre: conserva el valor original en Supabase.
function nombreClienteElegante(nombre?: string | null): string {
  const valor = (nombre || 'Cliente').trim();
  if (!valor) return 'Cliente';
  return valor.toLocaleLowerCase('es-CO').replace(/(^|[\s'-])([\p{L}])/gu, (_todo, separador, letra) => separador + letra.toLocaleUpperCase('es-CO'));
}
// Iconos SVG exclusivos para la navegación del cliente (sin emojis).
function IconoClienteNext({ tipo }: { tipo: 'catalogos' | 'productos' | 'inicio' | 'cuenta' }) {
  const comun = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true as const };
  if (tipo === 'catalogos') return <svg {...comun}><rect x="3" y="4" width="14" height="16" rx="2" /><path d="M7 8h6M7 12h6M7 16h4M17 7h4v13a2 2 0 0 1-2 2H7" /></svg>;
  if (tipo === 'productos') return <svg {...comun}><path d="m3 7 9-4 9 4-9 4-9-4ZM3 7v10l9 4 9-4V7M12 11v10" /></svg>;
  if (tipo === 'inicio') return <svg {...comun}><path d="m3 11 9-8 9 8v9H3v-9ZM9 20v-6h6v6" /></svg>;
  return <svg {...comun}><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg>;
}
function ClientesMayoristas({ perfil, salir }: { perfil: PerfilAcceso; salir: () => Promise<void> }) {
  const [productos, setProductos] = useState<Product[]>([]);
  const [catalogos, setCatalogos] = useState<CatalogoPDF[]>([]);
  const [error, setError] = useState('');
  const [errorCatalogos, setErrorCatalogos] = useState('');
  const [cargando, setCargando] = useState(true);
  const [seccion, setSeccion] = useState<'inicio' | 'catalogos' | 'productos' | 'cuenta'>('catalogos');
  const [buscarCatalogo, setBuscarCatalogo] = useState('');
  const catalogosVisibles = catalogos.filter(c => c.nombre.toLocaleLowerCase('es').includes(buscarCatalogo.toLocaleLowerCase('es')));
  useEffect(() => {    
let activo = true; (async () => {
      try { const c = await listarCatalogosJAIVISA(); if (activo) setCatalogos(c); } catch (e: any) { if (activo) setErrorCatalogos('No se pudieron cargar los catálogos: ' + e.message); } finally { if (activo) setCargando(false) }
      const { data, error } = await supabase.from('productos').select('*');
      if (!activo) return;
      if (error) { setError('No fue posible cargar los productos.'); return; }
      setProductos((data || []).map((p: any) => ({ id: String(p.id), sku: p.codigo || '', name: p.nombre || '', price: Number(p.precio) || 0, stock: Number(p.stock) || 0, iva: 0, barcode: p.codigo || '', category: p.categoria || 'General', image: p.imagen_url || '' })));
    })(); return () => { activo = false }  
}, []);
  return <><style>{`.jv-catalog-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:18px;margin-top:18px}
.jv-catalog-card{border:1px solid #e9d9f2;border-radius:18px;overflow:hidden;background:#fff;box-shadow:0 8px 28px #3d155019}
.jv-catalog-cover{height:260px;background:#f4eef9;overflow:hidden;position:relative}
.jv-catalog-cover iframe{border:0;width:100%;height:100%;pointer-events:none;background:#f4eef9}
.jv-catalog-open{display:block;text-align:center;padding:11px 13px;background:linear-gradient(105deg,#a02fe0,#5b198c);color:#fff!important;border-radius:11px;font-weight:700;text-decoration:none}
.jv-catalog-delete{background:#fff;border:1px solid #decce8;border-radius:9px;padding:8px;cursor:pointer;color:#642c80}
.jv-client-shell{background:radial-gradient(ellipse at top left,#f1e4ff,#fbf9ff 50%,#f5f0ff)}
.jv-client-header{background:linear-gradient(105deg,#2a0b42,#562076,#31104e);color:#fff;padding:20px max(22px,5vw);display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;box-shadow:0 5px 25px #4d1b7950}
.jv-client-tab{padding:12px 20px;border-radius:12px;border:1px solid #dfcde9;background:#fff;color:#5d277b;font-weight:750;cursor:pointer}
.jv-client-tab.active{background:linear-gradient(100deg,#a02fe0,#5b198c);color:#fff;border-color:transparent;box-shadow:0 6px 20px #8233b744}
.jv-catalog-grid{grid-template-columns:repeat(4,minmax(0,1fr));gap:16px}
.jv-catalog-card{min-width:0;display:flex;flex-direction:column}
.jv-catalog-card>div:last-child{flex:1;grid-template-rows:auto auto 1fr;align-content:start}
.jv-catalog-open{align-self:end;min-height:43px;display:flex;align-items:center;justify-content:center}
.jv-client-shell{overflow-x:hidden}
@media(max-width:1050px){.jv-catalog-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media(max-width:720px){
 .jv-catalog-grid{grid-template-columns:repeat(3,minmax(0,1fr));gap:7px;margin-top:14px}
 .jv-catalog-card{border-radius:15px;box-shadow:0 5px 16px #3d155014}
 .jv-catalog-cover{height:100px;min-height:100px;display:flex;align-items:center;justify-content:center;background:linear-gradient(145deg,#f5eafa,#e9dcf4)}
 .jv-catalog-cover iframe{display:none}
 .jv-catalog-cover::after{content:'📄';font-size:38px;line-height:1;filter:drop-shadow(0 6px 5px #4d227522)}
 .jv-catalog-card>div:last-child{padding:7px!important;gap:5px!important}
 .jv-catalog-card strong{font-size:10px;line-height:1.25;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;min-height:39px}
 .jv-catalog-card small{font-size:9px}
 .jv-catalog-open{font-size:10px;padding:7px 3px;min-height:34px;border-radius:9px}
 .jv-client-header{padding:12px 15px;flex-wrap:nowrap;align-items:center}
 .jv-client-header img{width:125px!important;max-width:125px!important;height:47px!important}
 .jv-client-header>div>div{font-size:9px!important;letter-spacing:.5px!important}
 .jv-client-header>button{font-size:11px!important;padding:10px 11px!important;white-space:nowrap}
 .jv-client-shell main{padding:21px 15px 48px!important}
 .jv-client-shell main>h1{font-size:24px!important;line-height:1.2;margin:0 0 8px!important;overflow-wrap:anywhere}
 .jv-client-shell main>p{font-size:13px;line-height:1.5;margin-bottom:16px!important}
 .jv-client-shell main>nav{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px!important;margin-bottom:21px!important}
 .jv-client-tab{padding:11px 8px;font-size:13px;white-space:nowrap}
 .jv-client-shell main section>h2{font-size:21px;margin:0 0 12px!important}
}
/* Navegación estilo app: solo clientes, solo móvil */
.jv-mobile-bottom{display:none}
.jv-mobile-search{width:100%;border:1px solid #e6d9ee;border-radius:13px;padding:12px 14px;background:#fff;color:#31183f;font:inherit;margin:4px 0 12px}
.jv-mobile-welcome{display:none}
@media(max-width:720px){
 .jv-client-shell main{padding-bottom:calc(105px + env(safe-area-inset-bottom))!important}
 .jv-client-shell main>h1,.jv-client-shell main>p,.jv-client-shell main>nav{display:none!important}
 .jv-mobile-welcome{display:block;background:linear-gradient(115deg,#61248a,#8b4cb4);border-radius:17px;color:#fff;padding:16px;margin-bottom:16px}
 .jv-mobile-welcome strong{font-size:17px;display:block}
 .jv-mobile-welcome small{font-size:12px;opacity:.92}
 .jv-mobile-bottom{position:fixed;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));left:0;right:0;bottom:0;padding:8px 7px calc(9px + env(safe-area-inset-bottom));background:#fff;box-shadow:0 -5px 24px #3b164a20;border-top:1px solid #ece1f1;z-index:50}
 .jv-mobile-bottom button{border:0;background:transparent;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;min-height:49px;color:#82758b;font-size:10px;font-weight:700;border-radius:10px}
 .jv-mobile-bottom button[aria-current=page]{background:#f4ebfa;color:#64238d}
 .jv-mobile-bottom button span{font-size:21px;line-height:1}
 .jv-catalog-cover{height:76px;min-height:76px}
 .jv-catalog-cover::after{font-size:29px}
 .jv-catalog-card strong{font-size:10px;min-height:37px}
 .jv-catalog-open{font-size:10px;min-height:33px}
 .jv-client-shell main section>h2{font-size:19px!important}
}
/* JAIVISA NEXT: catálogo móvil legible y táctil, sin desplazamiento horizontal */
@media screen and (max-width:767px){
 .jv-client-shell .jv-catalog-grid{display:grid!important;grid-template-columns:minmax(0,1fr)!important;gap:14px!important;width:100%!important;max-width:100%!important;align-items:stretch!important}
 .jv-client-shell .jv-catalog-card{width:auto!important;min-width:0!important;max-width:100%!important;overflow:hidden!important}
 .jv-client-shell .jv-catalog-card>div:last-child{min-width:0!important;padding:6px!important}
 .jv-client-shell .jv-catalog-card strong{font-size:14px!important;overflow-wrap:anywhere!important;word-break:normal!important}
 .jv-client-shell .jv-catalog-open{min-width:0!important;width:100%!important;font-size:13px!important;padding:12px 10px!important;min-height:44px!important;white-space:normal!important}
 .jv-client-shell .jv-catalog-cover{height:170px!important;min-height:170px!important}
}
@media(max-width:350px){.jv-catalog-grid{gap:5px}.jv-catalog-cover{height:85px;min-height:85px}.jv-catalog-card>div:last-child{padding:5px!important}.jv-catalog-open{font-size:9px}.jv-client-header>button{padding:9px!important}}

/* JAIVISA NEXT · Tipografía geométrica y navegación accesible del cliente. */
.jv-client-shell{font-family:"Avenir Next","Montserrat","Century Gothic",system-ui,-apple-system,"Segoe UI",sans-serif!important;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
.jv-client-shell .jv-client-greeting{font-family:inherit!important;font-size:clamp(27px,3.2vw,43px)!important;font-weight:800!important;line-height:1.16!important;letter-spacing:-.045em!important;text-wrap:balance;text-align:center;margin:0 0 14px!important;color:#261238}
.jv-client-shell .jv-client-greeting>span:first-child{background:linear-gradient(105deg,#521777,#8d2cbd 75%,#a759d0);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;font-weight:850!important}
.jv-client-shell .jv-greeting-dot{color:#a43bcf}
.jv-client-shell .jv-client-tab{font-family:inherit!important;font-weight:750!important;letter-spacing:-.018em!important;display:inline-flex;align-items:center;justify-content:center;gap:10px;border-radius:15px;padding:12px 20px;min-height:48px;box-shadow:0 6px 20px rgba(51,19,79,.06);transition:transform .18s ease,box-shadow .18s ease}
.jv-client-shell .jv-client-tab svg{width:21px;height:21px;flex:none;stroke-width:1.75;stroke-linecap:round;stroke-linejoin:round}
.jv-client-shell .jv-client-tab.active{background:linear-gradient(115deg,#8424b9,#4d1b73);box-shadow:0 10px 24px rgba(97,29,148,.2)}
@media(hover:hover){.jv-client-shell .jv-client-tab:hover{transform:translateY(-2px)}}
.jv-client-shell :is(button,a,input):focus-visible{outline:3px solid #ad69e2!important;outline-offset:3px}
.jv-client-shell .jv-mobile-bottom button span{display:flex;align-items:center;justify-content:center}
.jv-client-shell .jv-mobile-bottom button svg{width:23px;height:23px}
.jv-client-shell .jv-mobile-search{font-size:16px!important;min-height:48px}
@media(max-width:720px){.jv-client-shell .jv-client-greeting{font-size:clamp(25px,6vw,34px)!important;letter-spacing:-.035em!important}.jv-client-shell .jv-mobile-welcome{background:linear-gradient(120deg,#251139,#7133a0);box-shadow:0 12px 30px #4214652a}.jv-client-shell .jv-mobile-welcome strong{font-size:18px;letter-spacing:-.025em}}
@media(prefers-reduced-motion:reduce){.jv-client-shell .jv-client-tab{transition:none}}
/* JAIVISA NEXT · Tipografía angular: trazos rectos y menos redondeados. */
.jv-client-shell{font-family:Inter,system-ui,"Segoe UI",sans-serif!important;letter-spacing:.005em}
.jv-client-shell .jv-client-greeting{font-family:Inter,system-ui,"Segoe UI",sans-serif!important;font-weight:700!important;letter-spacing:-.025em!important}
.jv-client-shell .jv-client-greeting>span:first-child{font-weight:700!important}
.jv-client-shell :is(h1,h2,h3,h4,strong,.jv-client-tab){font-family:Inter,system-ui,"Segoe UI",sans-serif!important}
.jv-client-shell .jv-client-tab{font-weight:700!important;letter-spacing:.015em!important;border-radius:9px!important}
.jv-client-shell .jv-client-tab svg{stroke-linecap:square;stroke-linejoin:miter}
.jv-client-shell :is(input,select,textarea){border-radius:9px!important}
.jv-client-shell .jv-catalog-card{border-radius:12px!important}
.jv-client-shell .jv-catalog-open{border-radius:8px!important}
`}</style><div className="jv-client-shell" style={{ minHeight: '100vh', fontFamily: 'Inter,system-ui,sans-serif', color: '#31183f' }}>
      <header className="jv-client-header"><div><img src={JAIVISA_LOGO} alt="Jaivisa.com · Logo oficial" style={{ width: 190, maxWidth: "55vw", height: 72, objectFit: "contain", objectPosition: "left center", display: "block" }} /><div style={{ fontSize: 12, opacity: .85, letterSpacing: 1 }}>PORTAL MAYORISTA · CLIENTES</div></div><button style={{ ...boton, background: '#fff', color: '#4c1d69' }} onClick={salir}>Cerrar sesión</button></header>
      <main style={{ maxWidth: 1200, margin: 'auto', padding: '32px 22px 65px' }}>
        <h1 className="jv-client-greeting">Bienvenido, <span>{nombreClienteElegante(perfil.nombre)}</span><span className="jv-greeting-dot">.</span></h1>
        <p style={{ color: '#746080', marginBottom: 20 }}>Descubre primero nuestros catálogos mayoristas y encuentra los productos para tu negocio.</p>
        <nav style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 24 }} aria-label="Secciones del portal">
          <button type="button" className={'jv-client-tab ' + (seccion === 'catalogos' ? 'active' : '')} onClick={() => setSeccion('catalogos')}><IconoClienteNext tipo="catalogos" /> Catálogos</button>
          <button type="button" className={'jv-client-tab ' + (seccion === 'productos' ? 'active' : '')} onClick={() => setSeccion('productos')}><IconoClienteNext tipo="productos" /> Productos</button>
        </nav>
        <div className="jv-mobile-welcome"><strong>¡Hola{perfil.nombre ? ', ' + nombreClienteElegante(perfil.nombre).split(' ')[0] : ''}!</strong><small>Tu portal mayorista, siempre a mano.</small></div>
        {seccion === 'inicio' && <section><h2>¿Qué quieres consultar?</h2><div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 12, marginTop: 16 }}><button className="jv-client-tab" onClick={() => setSeccion('catalogos')} style={{ minHeight: 110 }}><IconoClienteNext tipo="catalogos" /> Ver catálogos</button><button className="jv-client-tab" onClick={() => setSeccion('productos')} style={{ minHeight: 110 }}><IconoClienteNext tipo="productos" /> Ver productos</button></div></section>}
        {seccion === 'catalogos' && <section><h2 style={{ marginBottom: 16 }}>Nuestros catálogos</h2>
          <input className="jv-mobile-search" aria-label="Buscar catálogos" placeholder="Buscar catálogo por nombre..." value={buscarCatalogo} onChange={e => setBuscarCatalogo(e.target.value)} />
          {cargando ? <p>Cargando catálogos…</p> : <>{errorCatalogos && <p role="alert" style={{ color: '#9c2855' }}>{errorCatalogos}</p>}<GaleriaCatalogos catalogos={catalogosVisibles} />{!errorCatalogos && catalogos.length > 0 && catalogosVisibles.length === 0 && <p>No encontramos catálogos con ese nombre.</p>}</>}
        </section>}
        {seccion === 'productos' && <section><h2>Productos disponibles</h2>{error && <p role="alert" style={{ color: '#a3294b' }}>{error}</p>}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,220px),1fr))', gap: 16, marginTop: 25 }}>{productos.map(p => <article key={p.id} style={{ background: '#fff', border: '1px solid #ece4f2', borderRadius: 18, padding: 17 }}>{p.image && <img src={p.image} alt={p.name} style={{ width: '100%', height: 150, objectFit: 'contain' }} />}<div style={{ fontSize: 12, color: '#805b96' }}>{p.category} · {p.sku}</div><h3 style={{ fontSize: 16 }}>{p.name}</h3><strong>{money(p.price)}</strong><p style={{ fontSize: 12, color: '#746080' }}>Existencias: {p.stock}</p></article>)}</div>
          {!error && productos.length === 0 && <p style={{ marginTop: 25 }}>No hay productos disponibles por el momento.</p>}
        </section>}
        {seccion === 'cuenta' && <section style={{ background: '#fff', border: '1px solid #e9d9f2', borderRadius: 18, padding: 20 }}><h2>Mi cuenta</h2><p><strong>Nombre:</strong> {perfil.nombre || 'Cliente JAIVISA'}</p><p style={{ fontSize: 13, color: '#746080' }}>Para modificar tus datos de acceso, comunícate con JAIVISA.</p><button type="button" className="jv-client-tab" onClick={() => void salir()}>Cerrar sesión</button></section>}
      </main><nav className="jv-mobile-bottom" aria-label="Navegación móvil">
        {([['inicio', 'Inicio'], ['catalogos', 'Catálogos'], ['productos', 'Productos'], ['cuenta', 'Mi cuenta']] as const).map(([id, texto]) => <button key={id} type="button" aria-current={seccion === id ? 'page' : undefined} onClick={() => { setSeccion(id); window.scrollTo({ top: 0, behavior: 'smooth' }); }}><span aria-hidden="true"><IconoClienteNext tipo={id} /></span>{texto}</button>)}
      </nav></div></>;
}

export function AprobacionesClientes() {
  const [pendientes, setPendientes] = useState<PerfilAcceso[]>([]);
  const [mensaje, setMensaje] = useState('');
  const [cargando, setCargando] = useState(false);
  const actualizar = async () => { setCargando(true); const { data, error } = await supabase.from('perfiles').select('id,rol,aprobado,nombre,documento,telefono,ciudad,direccion,correo').eq('rol', 'cliente').eq('aprobado', false); setCargando(false); if (error) { setMensaje('No se pudo consultar las solicitudes. Revisa la configuración SQL de JAIVISA.'); return; } setPendientes(data || []); };
  useEffect(() => { void actualizar() }, []);
  const aprobar = async (id: string) => { const { error } = await supabase.from('perfiles').update({ aprobado: true }).eq('id', id).eq('rol', 'cliente'); if (error) { setMensaje('No se pudo aprobar el cliente: ' + error.message); return; } setMensaje('Cliente aprobado.'); void actualizar(); };
  return <section style={{ margin: '16px 0', padding: 18, border: '1px solid #e7d8f0', background: '#fff', borderRadius: 16, fontFamily: 'Inter,system-ui,sans-serif', color: '#3b1a4d' }}><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}><div><strong>Solicitudes de clientes mayoristas</strong><div style={{ fontSize: 13, color: '#806a8d' }}>Aprueba las cuentas registradas desde JAIVISA.</div></div><button style={boton} onClick={() => void actualizar()} disabled={cargando}>{cargando ? 'Consultando…' : 'Actualizar solicitudes'}</button></div>{mensaje && <p role="status">{mensaje}</p>}{pendientes.length === 0 && <p style={{ fontSize: 13, color: '#75667f' }}>No hay solicitudes pendientes.</p>}{pendientes.map(p => <div key={p.id} style={{ borderTop: '1px solid #eee5f3', padding: '14px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}><div><strong>{p.nombre || 'Cliente'}</strong><div style={{ fontSize: 13 }}>{p.correo || 'Sin correo'} · {p.documento || 'Sin documento'} · {p.ciudad || ''}</div></div><button style={boton} onClick={() => void aprobar(p.id)}>Aprobar cliente</button></div>)}</section>;
}

// JAIVISA · Panel vendedor v2. Catálogo real de solo lectura y pedidos en borrador.
// Los borradores NO son ventas registradas: requieren backend y RLS para confirmarse.


const jaivisaNextCSS = `
/* JAIVISA NEXT · interfaz táctil del equipo y biblioteca PDF */
.jv-vendedor,.jv-bodega{overflow-x:clip}
.jv-vendedor .jv-catalog-grid,.jv-bodega .jv-catalog-grid{display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:18px!important;align-items:stretch!important;margin-top:20px!important}
.jv-vendedor .jv-catalog-card,.jv-bodega .jv-catalog-card{display:flex!important;flex-direction:column!important;min-width:0!important;border-radius:20px!important;box-shadow:0 14px 36px #3b15541a!important;overflow:hidden!important}
.jv-vendedor .jv-catalog-cover,.jv-bodega .jv-catalog-cover{height:220px!important;min-height:220px!important;background:linear-gradient(145deg,#f5eefa,#e9ddf3)!important}
.jv-vendedor .jv-catalog-cover iframe,.jv-bodega .jv-catalog-cover iframe{display:block!important;width:100%!important;height:100%!important;border:0!important;pointer-events:none!important}
.jv-vendedor .jv-catalog-cover::after,.jv-bodega .jv-catalog-cover::after{display:none!important}
.jv-vendedor .jv-catalog-card>div:last-child,.jv-bodega .jv-catalog-card>div:last-child{display:flex!important;flex-direction:column!important;align-items:stretch!important;gap:10px!important;padding:17px!important;flex:1!important}
.jv-vendedor .jv-catalog-card strong,.jv-bodega .jv-catalog-card strong{font-size:15px!important;line-height:1.35!important;min-height:40px!important}
.jv-vendedor .jv-catalog-open,.jv-bodega .jv-catalog-open{margin-top:auto!important;min-height:48px!important;text-decoration:none!important;border-radius:12px!important;font-size:14px!important}
.jv-vendedor .jv-mobile-nav{display:none}
.jv-vendedor input,.jv-vendedor textarea,.jv-bodega input{font-size:16px!important;max-width:100%;box-sizing:border-box}
.jv-vendedor .jv-product button{min-height:44px;min-width:44px}
@media(max-width:1000px){.jv-vendedor .jv-catalog-grid,.jv-bodega .jv-catalog-grid{grid-template-columns:repeat(2,minmax(0,1fr))!important}}
@media(max-width:680px){
 .jv-vendedor,.jv-bodega{padding:12px 12px 95px!important}
 .jv-vendedor .jv-catalog-grid,.jv-bodega .jv-catalog-grid{grid-template-columns:minmax(0,1fr)!important;gap:16px!important}
 .jv-vendedor .jv-catalog-cover,.jv-bodega .jv-catalog-cover{height:220px!important;min-height:220px!important}
 .jv-vendedor .jv-mobile-nav{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));position:fixed;bottom:0;left:0;right:0;z-index:100;padding:8px 6px max(9px,env(safe-area-inset-bottom));background:#ffffffed;backdrop-filter:blur(18px);border-top:1px solid #e7d9ef;box-shadow:0 -8px 28px #2f0c3d19;gap:3px}
 .jv-vendedor .jv-mobile-nav button{background:transparent;border:0;border-radius:12px;color:#665474;min-height:53px;display:flex;flex-direction:column;justify-content:center;align-items:center;gap:3px;font-size:10px;font-weight:750;padding:5px 1px}
 .jv-vendedor .jv-mobile-nav button[aria-current=page]{background:#f1e4fa;color:#68268d}
 .jv-vendedor .jv-grid{grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:10px!important}
 .jv-vendedor .jv-card{padding:14px!important;min-height:150px!important}
 .jv-vendedor .jv-card strong{font-size:15px!important}
 .jv-vendedor header,.jv-bodega header{padding:12px!important}
 .jv-vendedor header img,.jv-bodega header img{max-width:80px!important}
 .jv-vendedor .jv-row>button{min-height:44px}
}
@media(max-width:370px){.jv-vendedor .jv-grid{grid-template-columns:minmax(0,1fr)!important}}
@media(prefers-reduced-motion:reduce){.jv-vendedor *,.jv-bodega *{transition:none!important;animation:none!important}}

@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&display=swap');
.jv-vendedor,.jv-bodega{font-family:'DM Sans',Inter,system-ui,sans-serif!important;background:radial-gradient(ellipse at 83% -12%,#d4c0f2 0,transparent 40%),linear-gradient(135deg,#f4f0fa,#faf9fd 54%,#f1edfa)!important;color:#26133d!important;min-height:100vh}
.jv-vendedor>div,.jv-bodega>div{max-width:1260px!important}
.jv-vendedor header,.jv-bodega header{background:linear-gradient(120deg,#170c2b 0%,#341451 57%,#682d9b 100%)!important;border:1px solid #a57ad455!important;border-radius:23px!important;box-shadow:0 18px 50px #37144d30!important;position:relative;overflow:hidden}
.jv-vendedor header:after,.jv-bodega header:after{content:'';position:absolute;right:15%;top:-90px;width:240px;height:240px;border:1px solid #ffffff1e;border-radius:50%;pointer-events:none;box-shadow:0 0 0 55px #ffffff08,0 0 0 110px #ffffff06}
.jv-vendedor h1,.jv-bodega h1{letter-spacing:-1.3px!important;font-weight:800!important}
.jv-vendedor .jv-card,.jv-bodega .jv-next-card{background:linear-gradient(155deg,#fff 15%,#f9f5ff)!important;border:1px solid #e7dcf0!important;border-radius:22px!important;min-height:180px!important;box-shadow:0 12px 30px #3d1c5910!important;position:relative;overflow:hidden;transition:transform .2s,box-shadow .2s,border-color .2s!important}
.jv-vendedor .jv-card:hover,.jv-bodega .jv-next-card:hover{transform:translateY(-5px)!important;border-color:#b690d3!important;box-shadow:0 18px 35px #3d1c5925!important}
.jv-vendedor .jv-card>span:first-child,.jv-bodega .jv-next-card>span:first-child{display:inline-flex!important;align-items:center;justify-content:center;width:53px;height:53px;background:linear-gradient(135deg,#efe2ff,#e4d6f8);border-radius:16px;color:#693097;font-size:0!important;margin-bottom:14px!important}
.jv-vendedor .jv-card strong,.jv-bodega .jv-next-card h3{font-size:17px!important;letter-spacing:-.35px;color:#251337!important}
.jv-vendedor .jv-card>span:last-child{color:#7030a0!important}
.jv-vendedor .jv-grid>div{border-radius:22px!important;border:1px solid #e7dcf0!important;box-shadow:0 10px 30px #3d1c5910!important}
.jv-vendedor .jv-grid>div>div:first-child{color:#7932aa}
.jv-vendedor button,.jv-bodega button{transition:filter .2s,transform .2s}
.jv-vendedor button:hover,.jv-bodega button:hover{filter:brightness(1.06)}
.jv-vendedor button:focus-visible,.jv-bodega button:focus-visible{outline:3px solid #b27bdd;outline-offset:3px}
.jv-vendedor input,.jv-vendedor textarea,.jv-bodega input{font-family:inherit!important}
@media(max-width:650px){.jv-vendedor header,.jv-bodega header{border-radius:17px!important}.jv-vendedor .jv-card,.jv-bodega .jv-next-card{min-height:150px!important}.jv-vendedor h1,.jv-bodega h1{font-size:27px!important}}
`;

const jaivisaNextPremiumCSS = "\n/* JAIVISA NEXT / Visual system 2026 — vendedor mobile-first */\n.jv-vendedor{background:radial-gradient(ellipse 85% 46% at 83% -15%,#d6c0ed 0%,transparent 80%),#f7f4fa!important}\n.jv-vendedor .jv-next-welcome{position:relative;isolation:isolate;display:flex;align-items:center;justify-content:space-between;overflow:hidden;min-height:190px;margin:19px 0 15px;padding:30px clamp(22px,4vw,42px);border-radius:26px;background:linear-gradient(113deg,#1a0e2c 0%,#32134e 54%,#682c99 100%);border:1px solid #ac83d440;box-shadow:0 18px 48px #35134a24;color:#fff}\n.jv-vendedor .jv-next-welcome:before{content:'';position:absolute;inset:0;z-index:-1;background:radial-gradient(circle at 82% 55%,#b777e03a,transparent 38%),linear-gradient(110deg,transparent 70%,#ffffff09 70.2%,transparent 70.5%)}\n.jv-vendedor .jv-next-welcome-copy{position:relative;z-index:2;min-width:0}\n.jv-vendedor .jv-next-eyebrow{display:inline-flex;align-items:center;gap:10px;font-size:11px;letter-spacing:2.2px;font-weight:800;color:#d7b6f5}\n.jv-vendedor .jv-next-eyebrow-divider{opacity:.4}.jv-vendedor .jv-next-pulse{width:8px;height:8px;border-radius:50%;background:#b4f2d1;box-shadow:0 0 0 4px #b4f2d121,0 0 15px #b4f2d17a}\n.jv-vendedor .jv-next-welcome h1{font-size:clamp(28px,4.2vw,52px)!important;line-height:1.08;margin:17px 0 12px;letter-spacing:-2px!important;color:#fff!important}\n.jv-vendedor .jv-next-welcome h1>span:first-child{color:#e2b8ff}.jv-vendedor .jv-next-period{color:#b982ed}\n.jv-vendedor .jv-next-welcome p{color:#d6c7e5;font-size:clamp(13px,1.6vw,16px);margin:0;line-height:1.55}\n.jv-vendedor .jv-next-hero-graphic{width:170px;height:170px;flex:0 0 170px;position:relative;display:grid;place-items:center;margin-right:35px}\n.jv-vendedor .jv-next-ring{position:absolute;border-radius:50%;border:1px solid #e5c3ff55;transform:rotate(-25deg)}.jv-vendedor .jv-next-ring-one{width:145px;height:145px;box-shadow:0 0 45px #ae68e52e}.jv-vendedor .jv-next-ring-two{width:185px;height:100px;border-color:#ffffff45}\n.jv-vendedor .jv-next-hero-core{display:grid;place-items:center;width:91px;height:91px;border-radius:28px;transform:rotate(-12deg);background:linear-gradient(145deg,#a35ae1,#612494);box-shadow:0 20px 60px #1d082b80,inset 0 1px #ffffff66;color:white}\n.jv-vendedor .jv-next-hero-core svg{transform:rotate(12deg)}\n.jv-vendedor .jv-next-status{display:flex;align-items:flex-start;gap:15px;margin-bottom:21px;padding:18px 21px;border-radius:19px;background:linear-gradient(110deg,#211331,#332044 75%,#3b2454);color:#fff;border:1px solid #a37bc944;box-shadow:0 12px 32px #2b14351a}\n.jv-vendedor .jv-next-status-icon{display:grid;place-items:center;flex:0 0 43px;width:43px;height:43px;border-radius:13px;background:#ffffff13;color:#e0b8ff;border:1px solid #ffffff18}\n.jv-vendedor .jv-next-status-copy{flex:1;min-width:0}.jv-vendedor .jv-next-status-heading{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.jv-vendedor .jv-next-status-heading strong{font-size:15px;letter-spacing:-.2px}\n.jv-vendedor .jv-next-status-label{font-size:9px;font-weight:800;letter-spacing:1.2px;color:#e5c9ff;border:1px solid #b08bd05c;border-radius:100px;padding:5px 9px;background:#ffffff0a}\n.jv-vendedor .jv-next-status p{font-size:12px;line-height:1.65;color:#cbbbd9;margin:8px 0 11px}.jv-vendedor .jv-next-status p b{font-weight:700;color:#fff}\n.jv-vendedor .jv-next-status-tags{display:flex;flex-wrap:wrap;gap:8px}.jv-vendedor .jv-next-status-tags>span{display:inline-flex;align-items:center;gap:7px;padding:6px 10px;background:#ffffff0d;border:1px solid #ffffff16;border-radius:100px;color:#e1d0ec;font-size:10px;font-weight:650}\n.jv-vendedor .jv-next-tag-dot{width:6px;height:6px;border-radius:50%;background:#a6e8c4}\n.jv-vendedor .jv-card{border-radius:20px!important}.jv-vendedor .jv-card:active{transform:scale(.985)}\n@media(max-width:760px){.jv-vendedor .jv-next-hero-graphic{margin-right:0;flex-basis:110px;width:110px;height:110px}.jv-vendedor .jv-next-ring-one{width:95px;height:95px}.jv-vendedor .jv-next-ring-two{width:125px;height:70px}.jv-vendedor .jv-next-hero-core{width:65px;height:65px;border-radius:21px}.jv-vendedor .jv-next-welcome{min-height:160px}}\n@media(max-width:520px){.jv-vendedor .jv-next-welcome{padding:23px 19px;min-height:158px;border-radius:21px;margin:14px 0}.jv-vendedor .jv-next-welcome h1{font-size:clamp(27px,7vw,37px)!important;letter-spacing:-1.2px!important;margin:13px 0 9px}.jv-vendedor .jv-next-eyebrow{font-size:9px;letter-spacing:1.3px;gap:7px}.jv-vendedor .jv-next-welcome p{max-width:260px;font-size:12px}.jv-vendedor .jv-next-hero-graphic{position:absolute;right:-34px;top:19px;opacity:.28}.jv-vendedor .jv-next-status{padding:14px;gap:11px;border-radius:17px}.jv-vendedor .jv-next-status-icon{width:35px;height:35px;flex-basis:35px}.jv-vendedor .jv-next-status-heading strong{font-size:13px}.jv-vendedor .jv-next-status-label{font-size:8px}.jv-vendedor .jv-next-status p{font-size:11px}.jv-vendedor .jv-next-status-tags>span{font-size:9px;padding:5px 8px}}\n@media(prefers-reduced-motion:reduce){.jv-vendedor .jv-next-pulse{box-shadow:none}}\n";

function IconoNext({ nombre, tamano = 24 }: { nombre: string; tamano?: number }) {
  const rutas: Record<string, string> = {
    libros: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20 M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z',
    caja: 'm12 2 9 5-9 5-9-5 9-5ZM3 7v10l9 5 9-5V7M12 12v10',
    carrito: 'M3 3h2l2.5 12h12l2-9H6 M10 20h.01 M18 20h.01',
    usuarios: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M22 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75',
    pedidos: 'M8 4h-2a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2 M9 2h6v4H9z M8 12h8 M8 16h6',
    agenda: 'M8 2v4 M16 2v4 M3 10h18 M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z M8 15h3',
    grafico: 'M3 3v18h18 M7 16l4-5 4 3 5-8',
    escudo: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z M9 12l2 2 4-4',
    campana: 'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9 M10 21h4',
    camion: 'M3 5h12v12H3z M15 9h4l3 4v4h-7 M7 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4 M19 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4',
    etiqueta: 'M2 12V4a2 2 0 0 1 2-2h8l10 10-10 10L2 12z M7 7h.01',
    salir: 'M10 17l5-5-5-5 M15 12H3 M12 3h6a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3h-6',
    chispa: 'm12 2 2.3 7.7L22 12l-7.7 2.3L12 22l-2.3-7.7L2 12l7.7-2.3L12 2z'
  };
  return <svg width={tamano} height={tamano} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={rutas[nombre] || rutas.chispa} /></svg>;
}
function PanelVendedor({ perfil, salir }: { perfil: PerfilAcceso; salir: () => Promise<void> }) {
  type Vista = 'inicio' | 'catalogosPDF' | 'catalogo' | 'pedido' | 'clientes' | 'historial' | 'agenda' | 'reportes';
  type ProductoV = { id: string; codigo: string; nombre: string; categoria: string; descripcion: string; imagen: string; precio: number | null; iva: number | null; stock: number | null };
  type Renglon = { producto: ProductoV; cantidad: number };
  const [vista, setVista] = useState<Vista>('inicio');
  const [productos, setProductos] = useState<ProductoV[]>([]);
  const [catalogosPDF, setCatalogosPDF] = useState<CatalogoPDF[]>([]);
  const [cargandoPDF, setCargandoPDF] = useState(false);
  const [errorPDF, setErrorPDF] = useState('');
  const [buscarPDF, setBuscarPDF] = useState('');
  const [referenciaPDF, setReferenciaPDF] = useState('');
  const [cantidadPDF, setCantidadPDF] = useState(1);
  const [catalogoOrigen, setCatalogoOrigen] = useState('');
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState('');
  const [busqueda, setBusqueda] = useState('');
  const [carrito, setCarrito] = useState<Renglon[]>([]);
  const [cliente, setCliente] = useState({ nombre: '', telefono: '', direccion: '', ciudad: '', observaciones: '' });
  const [notificaciones] = useState<string[]>([]);
  const [campana, setCampana] = useState(false);
  const [aviso, setAviso] = useState('');
  const [sonido, setSonido] = useState(false);
  const [enviandoPedido, setEnviandoPedido] = useState(false);
  const enviandoPedidoRef = React.useRef(false);
  const [numeroBorrador, setNumeroBorrador] = useState(() => `BORRADOR-${Date.now().toString(36).toUpperCase()}`);
  const opciones: { id: Vista; titulo: string; descripcion: string; icono: string }[] = [
    { id: 'catalogosPDF', titulo: 'Catálogos PDF', descripcion: 'Consultar los catálogos publicados por JAIVISA', icono: 'libros' },
    { id: 'catalogo', titulo: 'Catálogo', descripcion: 'Productos disponibles en JAIVISA', icono: 'caja' },
    { id: 'pedido', titulo: 'Nuevo pedido', descripcion: 'Preparar y compartir un borrador', icono: 'carrito' },
    { id: 'clientes', titulo: 'Mis clientes', descripcion: 'Cartera comercial asignada', icono: 'usuarios' },
    { id: 'historial', titulo: 'Mis pedidos', descripcion: 'Historial y seguimiento', icono: 'pedidos' },
    { id: 'agenda', titulo: 'Mi agenda', descripcion: 'Visitas y recordatorios', icono: 'agenda' },
    { id: 'reportes', titulo: 'Mis resultados', descripcion: 'Metas, ventas y comisiones', icono: 'grafico' }
  ];
  const cargarProductos = async () => {
    setCargando(true); setError('');
    try {
      const { data, error: fallo } = await supabase.from('productos').select('*').limit(500);
      if (fallo) throw fallo;
      const normalizados: ProductoV[] = (data || []).map((p: any) => ({
        id: String(p.id), codigo: String(p.codigo ?? p.sku ?? ''), nombre: String(p.nombre ?? p.name ?? 'Sin nombre'),
        categoria: String(p.categoria ?? p.category ?? ''), descripcion: String(p.descripcion ?? ''), imagen: String(p.imagen_url ?? ''),
        precio: typeof (p.precio ?? p.price) === 'number' ? Number(p.precio ?? p.price) : null,
        iva: typeof p.iva === 'number' ? Number(p.iva) : null,
        stock: typeof (p.stock ?? p.existencia) === 'number' ? Number(p.stock ?? p.existencia) : null
      }));
      setProductos(normalizados);
    } catch (e: any) { setError('No fue posible consultar productos: ' + (e?.message || 'Verifica los permisos de acceso de tu cuenta.')); }
    finally { setCargando(false); }
  };
  const cargarCatalogosPDF = async () => {
    setCargandoPDF(true); setErrorPDF('');
    try { setCatalogosPDF(await listarCatalogosJAIVISA()); }
    catch (e: any) { setErrorPDF('No se pudieron consultar los catálogos: ' + (e?.message || 'Verifica el acceso a los documentos de JAIVISA.')); }
    finally { setCargandoPDF(false); }
  };
  useEffect(() => { void cargarProductos(); void cargarCatalogosPDF(); }, []);
  const encontrados = productos.filter(p => (p.nombre + ' ' + p.codigo + ' ' + p.categoria).toLocaleLowerCase('es').includes(busqueda.toLocaleLowerCase('es')));
  const agregar = (p: ProductoV) => {
    if (p.precio === null) { setAviso('Este producto no tiene un precio confirmado. No puede agregarse al borrador.'); return; }
    setCarrito(actual => { const existe = actual.find(x => x.producto.id === p.id); return existe ? actual.map(x => x.producto.id === p.id ? { ...x, cantidad: x.cantidad + 1 } : x) : [...actual, { producto: p, cantidad: 1 }]; });
    setAviso('Producto agregado al borrador.');
  };
  // PDF y catálogo interactivo comparten exactamente el mismo carrito del vendedor.
  // La búsqueda usa el catálogo de productos autorizado de Supabase, no interpreta automáticamente el PDF.
  const coincidenciasPDF = referenciaPDF.trim().length < 2 ? [] : productos.filter(p =>
    (p.codigo + ' ' + p.nombre).toLocaleLowerCase('es').includes(referenciaPDF.trim().toLocaleLowerCase('es'))
  ).slice(0, 12);
  const agregarDesdePDF = (p: ProductoV) => {
    if (p.precio === null) { setAviso('No hay precio autorizado para ' + p.nombre + '.'); return; }
    const cantidad = Math.max(1, Math.min(9999, Math.floor(Number(cantidadPDF) || 1)));
    setCarrito(actual => {      
const existe = actual.find(x => x.producto.id === p.id); return existe
        ? actual.map(x => x.producto.id === p.id ? { ...x, cantidad: x.cantidad + cantidad } : x)
        : [...actual, { producto: p, cantidad }];    
});
    setAviso(cantidad + ' unidad(es) de ' + p.nombre + ' agregadas al mismo carrito del catálogo interactivo' + (catalogoOrigen ? ' desde ' + catalogoOrigen : '') + '.');
    setReferenciaPDF(''); setCantidadPDF(1);
  };
  const subtotal = carrito.reduce((a, x) => a + (x.producto.precio || 0) * x.cantidad, 0);
  const formato = (n: number) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n);
  const mensajeWhatsApp = () => [
    'JAIVISA · BORRADOR DE PEDIDO (NO CONFIRMADO)',
    'Referencia: ' + numeroBorrador,
    'Vendedor: ' + (perfil.nombre || 'Vendedor JAIVISA'),
    'Cliente: ' + cliente.nombre.trim(),
    'Teléfono: ' + cliente.telefono.trim(),
    'Ciudad: ' + cliente.ciudad.trim(),
    'Dirección: ' + cliente.direccion.trim(),
    '', ...carrito.map(x => `• ${x.producto.nombre} (${x.producto.codigo || 'S/R'}) × ${x.cantidad} = ${formato((x.producto.precio || 0) * x.cantidad)}`),
    '', 'Subtotal de referencia: ' + formato(subtotal),
    'IVA, descuentos y total definitivo: pendientes de validación.',
    cliente.observaciones.trim() ? 'Observaciones: ' + cliente.observaciones.trim() : '',
    'IMPORTANTE: Este mensaje no confirma una venta, reserva de inventario ni despacho.'
  ].filter(Boolean).join('\n');
  const compartir = () => {
    if (!cliente.nombre.trim() || carrito.length === 0) { setAviso('Escribe el nombre del cliente y agrega al menos un producto.'); return; }
    const url = 'https://wa.me/?text=' + encodeURIComponent(mensajeWhatsApp());
    const ventana = window.open(url, '_blank', 'noopener,noreferrer');
    if (!ventana) setAviso('El navegador bloqueó la ventana. Permite ventanas emergentes para compartir el borrador.');
  };
  const confirmarPedido = async () => {
    if (enviandoPedidoRef.current || !cliente.nombre.trim() || !carrito.length) return;
    enviandoPedidoRef.current = true;
    setEnviandoPedido(true);
    setAviso('');
    try {
      const pedido = await crearPedidoCentral({
        cliente_nombre: cliente.nombre.trim(),
        cliente_telefono: cliente.telefono.trim(),
        ciudad: cliente.ciudad.trim(),
        direccion: cliente.direccion.trim(),
        observaciones: cliente.observaciones.trim(),
        lineas: carrito.map(({ producto, cantidad }) => ({
          productId: producto.id,
          sku: producto.codigo,
          nombre: producto.nombre,
          imagen: producto.imagen,
          cantidad,
          precio: producto.precio ?? 0,
          iva: producto.iva ?? 0,
        })),
      });
      setCarrito([]);
      setCliente({ nombre: '', telefono: '', direccion: '', ciudad: '', observaciones: '' });
      setNumeroBorrador(`BORRADOR-${Date.now().toString(36).toUpperCase()}`);
      setAviso('Pedido #' + pedido.numero + ' guardado y visible para Bodega.');
      setVista('historial');
    } catch (error) {
      setAviso('No se pudo guardar: ' + (error instanceof Error ? error.message : String(error)));
    } finally {
      enviandoPedidoRef.current = false;
      setEnviandoPedido(false);
    }
  };
  const tocarCampana = () => {
    setCampana(v => !v);
    if (!sonido) { setSonido(true); setAviso('Avisos sonoros habilitados para cuando conectemos las notificaciones reales de pedidos.'); }
  };
  const campo: React.CSSProperties = { width: '100%', padding: '12px 13px', border: '1px solid #dfd1e7', borderRadius: 12, font: 'inherit', background: '#fff', color: '#321746' };
  const btn: React.CSSProperties = { border: 0, borderRadius: 12, padding: '12px 17px', background: '#622582', color: '#fff', fontWeight: 750, cursor: 'pointer' };
  const panel: React.CSSProperties = { background: '#fff', border: '1px solid #e9ddef', borderRadius: 18, padding: 'clamp(16px,3vw,25px)', boxShadow: '0 8px 24px #431c5909' };
  const etiqueta = (t: string) => <span style={{ display: 'block', fontSize: 13, fontWeight: 700, marginBottom: 6, color: '#5a3970' }}>{t}</span>;
  return <main className="jv-vendedor jv-unified" style={{ minHeight: '100vh', background: 'linear-gradient(160deg,#f6effb,#fff 55%,#f8f5fb)', fontFamily: 'Inter,system-ui,sans-serif', color: '#341943', padding: 'clamp(12px,3vw,30px)' }}>
    <style>{jaivisaNextCSS}</style><style>{jaivisaNextPremiumCSS}</style><style>{`.jv-vendedor *{box-sizing:border-box}.jv-vendedor button{font:inherit;cursor:pointer}.jv-vendedor button:disabled{opacity:.5;cursor:not-allowed}.jv-vendedor button:focus-visible,.jv-vendedor input:focus-visible{outline:3px solid #bd77ea;outline-offset:2px}.jv-vendedor .jv-card{background:#fff;border:1px solid #e9ddef;border-radius:18px;padding:20px;text-align:left;min-height:145px;box-shadow:0 8px 22px #431c590d;transition:transform .15s}.jv-vendedor .jv-card:hover{transform:translateY(-2px)}.jv-vendedor .jv-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr));gap:14px}.jv-vendedor .jv-row{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}.jv-vendedor .jv-muted{color:#75667f;line-height:1.55}.jv-vendedor .jv-field{display:block;margin-bottom:13px}.jv-vendedor .jv-product{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;border-top:1px solid #f0e8f4;padding:15px 0}@media(max-width:520px){.jv-vendedor .jv-card{padding:16px;min-height:130px}}`}</style>
    <div style={{ maxWidth: 1130, margin: '0 auto' }}>
      <header className="jv-row" style={{ background: 'linear-gradient(110deg,#321047,#632a86)', color: '#fff', borderRadius: 20, padding: '15px 20px', boxShadow: '0 12px 30px #4c1d6930' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}><img src={JAIVISA_LOGO} alt="JAIVISA" style={{ width: 100, height: 62, objectFit: 'contain' }} /><div><strong style={{ fontSize: 12, letterSpacing: 1 }}>JAIVISA · PORTAL MAYORISTA</strong><div style={{ fontSize: 14 }}>Centro comercial del vendedor</div></div></div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}><button aria-label="Abrir notificaciones" title="Notificaciones" onClick={tocarCampana} style={{ ...btn, background: '#fff', color: '#572077' }}><IconoNext nombre="campana" tamano={19} /> {notificaciones.length || ''}</button><button onClick={() => void salir()} style={{ ...btn, background: '#fff', color: '#572077' }}>Salir</button></div>
      </header>
      {campana && <aside style={{ ...panel, marginTop: 12 }}><strong>Centro de notificaciones</strong><p className="jv-muted" style={{ fontSize: 14 }}>Las alertas reales y su sonido se activarán cuando configuremos los pedidos persistentes, las autorizaciones y el servicio de avisos de JAIVISA. Esta pantalla no inventa pedidos.</p>{notificaciones.length === 0 && <p>No hay notificaciones registradas.</p>}<p style={{ fontSize: 12, color: '#786389' }}>El navegador puede requerir una interacción para permitir audio.</p></aside>}
      <section className="jv-next-welcome" aria-label="Bienvenida al espacio comercial">
        <div className="jv-next-welcome-copy"><span className="jv-next-eyebrow"><span className="jv-next-pulse" /> JAIVISA NEXT <span className="jv-next-eyebrow-divider">/</span> SALES WORKSPACE</span>
          <h1>Bienvenido, <span>{perfil.nombre ? perfil.nombre.split(' ')[0].toLocaleUpperCase('es') : 'EQUIPO'}</span><span className="jv-next-period">.</span></h1>
          <p>Tu espacio comercial, conectado a cada oportunidad.</p>
        </div>
        <div className="jv-next-hero-graphic" aria-hidden="true"><div className="jv-next-ring jv-next-ring-one" /><div className="jv-next-ring jv-next-ring-two" /><div className="jv-next-hero-core"><IconoNext nombre="grafico" tamano={33} /></div></div>
      </section>
      <aside className="jv-next-status" aria-label="Estado de la plataforma">
        <div className="jv-next-status-icon"><IconoNext nombre="escudo" tamano={21} /></div>
        <div className="jv-next-status-copy"><div className="jv-next-status-heading"><strong>Entorno de preparación</strong><span className="jv-next-status-label">VISTA DE PRUEBA</span></div><p>Consulta productos y prepara pedidos para compartir por WhatsApp. <b>Los borradores todavía no se registran como ventas.</b></p>
          <div className="jv-next-status-tags"><span><span className="jv-next-tag-dot" /> Catálogo conectado</span><span><IconoNext nombre="carrito" tamano={13} /> Pedidos en borrador</span></div>
        </div>
      </aside>
      {aviso && <div role="status" style={{ background: '#f3e7fb', borderRadius: 12, padding: 13, marginBottom: 14 }}>{aviso} <button onClick={() => setAviso('')} style={{ border: 0, background: 'transparent', color: '#6a2b8b', fontWeight: 800 }}>Cerrar</button></div>}
      {vista === 'inicio' ? <>
        <section className="jv-grid" style={{ marginBottom: 17 }}>{[{ t: 'Productos cargados (máx. 500)', n: String(productos.length), i: 'caja' }, { t: 'Artículos en borrador', n: String(carrito.reduce((s, x) => s + x.cantidad, 0)), i: 'carrito' }, { t: 'Subtotal del borrador', n: formato(subtotal), i: 'grafico' }].map(x => <div key={x.t} style={panel}><div style={{ fontSize: 25 }}><IconoNext nombre={x.i} tamano={25} /></div><strong style={{ display: 'block', fontSize: 22, margin: '8px 0' }}>{x.n}</strong><span className="jv-muted" style={{ fontSize: 13 }}>{x.t}</span></div>)}</section>
        <section className="jv-grid" aria-label="Herramientas del vendedor">{opciones.map(o => <button className="jv-card" key={o.id} onClick={() => setVista(o.id)}><span style={{ fontSize: 30, display: 'block', marginBottom: 10 }}><IconoNext nombre={o.icono} tamano={28} /></span><strong style={{ fontSize: 17, display: 'block' }}>{o.titulo}</strong><span className="jv-muted" style={{ display: 'block', fontSize: 13, marginTop: 5 }}>{o.descripcion}</span><span style={{ display: 'block', color: '#753b93', fontSize: 12, fontWeight: 800, marginTop: 12 }}>Abrir sección →</span></button>)}</section>
      </> : <section style={panel}>
        <div className="jv-row"><button style={btn} onClick={() => { setVista('inicio'); setAviso(''); }}>← Inicio</button><strong style={{ fontSize: 20 }}><IconoNext nombre={opciones.find(o => o.id === vista)?.icono || "chispa"} /> {opciones.find(o => o.id === vista)?.titulo}</strong></div>
        {vista === 'catalogosPDF' && <div style={{ marginTop: 20 }}>
          <p className="jv-muted">Bienvenido a tus catálogos JAIVISA. Selecciona «Abrir catálogo» para consultar cada PDF. Solo Administración puede publicar o eliminar archivos.</p>
          <label className="jv-field">{etiqueta('Buscar catálogo')}<input style={campo} value={buscarPDF} onChange={e => setBuscarPDF(e.target.value)} placeholder="Nombre del catálogo" /></label>
          <button style={{ ...btn, marginBottom: 16 }} onClick={() => void cargarCatalogosPDF()} disabled={cargandoPDF}>{cargandoPDF ? 'Consultando…' : '↻ Actualizar catálogos'}</button>
          {errorPDF && <p role="alert" style={{ color: '#a32645' }}>{errorPDF}</p>}
          {cargandoPDF ? <p className="jv-muted">Cargando catálogos…</p> : !errorPDF && <GaleriaCatalogos catalogos={catalogosPDF.filter(c => c.nombre.toLocaleLowerCase('es').includes(buscarPDF.toLocaleLowerCase('es')))} />}
          {!cargandoPDF && !errorPDF && catalogosPDF.length > 0 && catalogosPDF.every(c => !c.nombre.toLocaleLowerCase('es').includes(buscarPDF.toLocaleLowerCase('es'))) && <p>No se encontraron catálogos con ese nombre.</p>}
          <section aria-label="Vender desde catálogos PDF" style={{ marginTop: 22, padding: 18, border: '1px solid #e5d3ee', borderRadius: 16, background: '#fbf7fe' }}>
            <h3 style={{ marginTop: 0 }}>🛒 Vender desde el PDF</h3>
            <p className="jv-muted">Abre el PDF, identifica la referencia del artículo y búscala aquí. El producto se verifica contra la lista de precios vigente de JAIVISA y se agrega al mismo carrito que el catálogo interactivo.</p>
            <label className="jv-field">{etiqueta('Catálogo que estás consultando (opcional)')}
              <select style={campo} value={catalogoOrigen} onChange={e => setCatalogoOrigen(e.target.value)}>
                <option value="">Seleccionar catálogo</option>
                {catalogosPDF.map(c => <option key={c.ruta} value={c.nombre}>{c.nombre}</option>)}
              </select>
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 110px', gap: 10, marginTop: 12 }}>
              <label className="jv-field">{etiqueta('Referencia o nombre del producto')}
                <input style={campo} value={referenciaPDF} onChange={e => setReferenciaPDF(e.target.value)} placeholder="Ej.: C2-F" autoComplete="off" />
              </label>
              <label className="jv-field">{etiqueta('Cantidad')}
                <input style={campo} type="number" min={1} max={9999} value={cantidadPDF} onChange={e => setCantidadPDF(Math.max(1, Math.min(9999, Number(e.target.value) || 1)))} />
              </label>
            </div>
            {referenciaPDF.trim().length > 0 && referenciaPDF.trim().length < 2 && <p className="jv-muted">Escribe al menos dos caracteres.</p>}
            {referenciaPDF.trim().length >= 2 && coincidenciasPDF.length === 0 && <p role="status">No encontramos esa referencia entre los productos autorizados. Verifica que esté registrada en el catálogo de JAIVISA.</p>}
            {coincidenciasPDF.map(p => <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '12px 0', borderBottom: '1px solid #e9dded' }}>
              <div><strong>{p.nombre}</strong><div className="jv-muted">Ref. {p.codigo || 'Sin código'} · {p.precio === null ? 'Precio pendiente' : formato(p.precio)} {p.stock === null ? '' : ' · Stock informado: ' + p.stock}</div></div>
              <button type="button" style={btn} disabled={p.precio === null} onClick={() => agregarDesdePDF(p)}>+ Agregar al carrito</button>
            </div>)}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginTop: 15 }}>
              <strong>{carrito.reduce((n, x) => n + x.cantidad, 0)} unidades · {formato(subtotal)}</strong>
              <button type="button" style={btn} onClick={() => setVista('pedido')}>Revisar carrito y crear pedido →</button>
            </div>
          </section>
        </div>}
        {(vista === 'catalogo' || vista === 'pedido') && <>
          {vista === 'catalogo' && <div style={{ marginTop: 20 }}><label className="jv-field">{etiqueta('Buscar productos')}<input style={campo} value={busqueda} onChange={e => setBusqueda(e.target.value)} placeholder="Nombre, código o categoría" /></label><button style={{ ...btn, marginBottom: 14 }} onClick={() => void cargarProductos()} disabled={cargando}>{cargando ? 'Consultando…' : '↻ Actualizar catálogo'}</button>{error && <p role="alert" style={{ color: '#a32645' }}>{error}</p>}{!cargando && !error && productos.length === 0 && <p className="jv-muted">No hay productos visibles para tu cuenta. Verifica con Administración el acceso al catálogo.</p>}{encontrados.map(p => <div key={p.id} className="jv-product"><div style={{ flex: '1 1 240px' }}><strong>{p.nombre}</strong><div className="jv-muted" style={{ fontSize: 13 }}>{p.codigo || 'Sin código'} · {p.categoria || 'Sin categoría'}</div><div style={{ fontSize: 14, marginTop: 4 }}>{p.precio === null ? 'Precio no disponible' : formato(p.precio)} · {p.stock === null ? 'Inventario por verificar' : 'Existencias: ' + p.stock}</div></div><button style={btn} disabled={p.precio === null} onClick={() => agregar(p)}>+ Agregar</button></div>)}</div>}
          {vista === 'pedido' && <div style={{ marginTop: 20 }}><p className="jv-muted">Referencia {numeroBorrador}. Guarda el pedido en JAIVISA antes de enviarlo a Bodega.</p><div className="jv-grid"><label className="jv-field">{etiqueta('Nombre del cliente *')}<input style={campo} value={cliente.nombre} onChange={e => setCliente(v => ({ ...v, nombre: e.target.value }))} /></label><label className="jv-field">{etiqueta('WhatsApp del cliente')}<input style={campo} value={cliente.telefono} onChange={e => setCliente(v => ({ ...v, telefono: e.target.value }))} /></label><label className="jv-field">{etiqueta('Ciudad')}<input style={campo} value={cliente.ciudad} onChange={e => setCliente(v => ({ ...v, ciudad: e.target.value }))} /></label><label className="jv-field">{etiqueta('Dirección de entrega')}<input style={campo} value={cliente.direccion} onChange={e => setCliente(v => ({ ...v, direccion: e.target.value }))} /></label></div><label className="jv-field">{etiqueta('Observaciones')}<textarea style={{ ...campo, minHeight: 70 }} value={cliente.observaciones} onChange={e => setCliente(v => ({ ...v, observaciones: e.target.value }))} /></label><div className="jv-row"><h3>Productos del borrador</h3><button style={btn} onClick={() => setVista('catalogo')}>+ Buscar productos</button></div>{carrito.length === 0 ? <p className="jv-muted">Todavía no has agregado productos.</p> : carrito.map(x => <div key={x.producto.id} className="jv-product"><div style={{ flex: '1 1 200px' }}><strong>{x.producto.nombre}</strong><div className="jv-muted">{formato(x.producto.precio || 0)} por unidad</div></div><div style={{ display: 'flex', alignItems: 'center', gap: 9 }}><button style={btn} aria-label="Restar unidad" onClick={() => setCarrito(v => v.map(z => z.producto.id === x.producto.id ? { ...z, cantidad: Math.max(0, z.cantidad - 1) } : z).filter(z => z.cantidad > 0))}>−</button><strong>{x.cantidad}</strong><button style={btn} aria-label="Sumar unidad" onClick={() => agregar(x.producto)}>+</button></div><strong>{formato((x.producto.precio || 0) * x.cantidad)}</strong></div>)}<div style={{ textAlign: 'right', margin: '18px 0' }}><strong style={{ fontSize: 20 }}>Subtotal: {formato(subtotal)}</strong><p className="jv-muted" style={{ fontSize: 12 }}>IVA y total definitivo requieren validación comercial.</p></div><button style={{ ...btn, width: '100%', marginBottom: 10 }} disabled={enviandoPedido || !carrito.length || !cliente.nombre.trim()} onClick={() => void confirmarPedido()}>{enviandoPedido ? 'Enviando pedido…' : '✓ Confirmar y enviar pedido a Bodega'}</button><button style={{ ...btn, background: '#128C51', width: '100%', fontSize: 16 }} onClick={compartir} disabled={!carrito.length || !cliente.nombre.trim()}>🟢 Enviar borrador a WhatsApp</button><p className="jv-muted" style={{ fontSize: 12 }}>WhatsApp abre el mensaje para revisión y envío manual. No genera una venta ni una notificación de bodega.</p></div>}
        </>}
        {vista === 'historial' && <CentroPedidos rol="vendedor" />}
        {['clientes', 'agenda', 'reportes'].includes(vista) && <div style={{ marginTop: 25, padding: 20, borderRadius: 14, background: '#f8f3fb' }}><h3>Conexión segura pendiente</h3><p className="jv-muted">Este módulo estará disponible cuando finalice su configuración en JAIVISA. No mostramos clientes, pedidos ni resultados inventados y no permitimos modificaciones sin verificar los permisos.</p></div>}
      </section>}
      <nav className="jv-mobile-nav" aria-label="Navegación del vendedor">
        {([{ id: 'inicio', titulo: 'Inicio', icono: 'caja' }, { id: 'clientes', titulo: 'Clientes', icono: 'usuarios' }, { id: 'catalogosPDF', titulo: 'Catálogos', icono: 'libros' }, { id: 'catalogo', titulo: 'Productos', icono: 'caja' }, { id: 'pedido', titulo: 'Pedido', icono: 'carrito' }] as const).map(item => <button key={item.id} type="button" aria-current={vista === item.id ? 'page' : undefined} onClick={() => { setVista(item.id); setAviso(''); window.scrollTo({ top: 0, behavior: 'smooth' }); }}><IconoNext nombre={item.icono} tamano={21} /><span>{item.titulo}</span></button>)}
      </nav>
      <footer style={{ textAlign: 'center', padding: 25, fontSize: 12, color: '#887293' }}>JAIVISA · Portal Mayorista · Panel comercial</footer>
    </div>
  </main>;
}


function VistaPreviaFotoJAIVISA({ archivo }: { archivo: File }) {
  const [url, setUrl] = useState('');
  useEffect(() => { const temporal = URL.createObjectURL(archivo); setUrl(temporal); return () => URL.revokeObjectURL(temporal) }, [archivo]);
  return url ? <img src={url} alt="Vista previa de la fotografía seleccionada" style={{ width: 150, height: 150, objectFit: 'contain', borderRadius: 12, background: '#fff', border: '1px solid #e8deef' }} /> : null;
}

// JAIVISA · Centro de trabajo de Bodega.
// Interfaz de preparación: no simula pedidos reales ni permite cambiar estados sin backend.
function PanelBodega({ perfil, salir }: { perfil: PerfilAcceso; salir: () => Promise<void> }) {
  type Seccion = 'inicio' | 'pedidos' | 'inventario' | 'catalogos' | 'despachos' | 'etiquetas' | 'notificaciones';
  const [seccion, setSeccion] = useState<Seccion>('inicio');
  const [pedidoDestinoId, setPedidoDestinoId] = useState<string | null>(null);
  const [productos, setProductos] = useState<{ id: string; nombre: string; codigo: string; stock: number | null; precio: number | null; categoria: string; imagen_url: string; campos: string[] }[]>([]);
  const [productoEditando, setProductoEditando] = useState<(typeof productos)[number] | null>(null);
  const [fotoPendiente, setFotoPendiente] = useState<File | null>(null);
  const [crearNuevo, setCrearNuevo] = useState(false);
  const [columnasProductos, setColumnasProductos] = useState<string[]>([]);
  const [guardandoProducto, setGuardandoProducto] = useState(false);
  const [avisoProducto, setAvisoProducto] = useState('');
  const [catalogos, setCatalogos] = useState<CatalogoPDF[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [sonidoHabilitado, setSonidoHabilitado] = useState(false);
  const [volumenAlerta, setVolumenAlerta] = useState(85);
  const [notificaciones, setNotificaciones] = useState<{ id: string; titulo: string; fecha: string }[]>([]);
  const [busqueda, setBusqueda] = useState('');
  const [mensaje, setMensaje] = useState('');
  const audioRef = React.useRef<AudioContext | null>(null);
  const vozIsaRef = React.useRef<HTMLAudioElement | null>(null);
  const habilitadoRef = React.useRef(false);
  const volumenRef = React.useRef(85);
  const vistosRef = React.useRef<Set<string> | null>(null);
  useEffect(() => { volumenRef.current = volumenAlerta }, [volumenAlerta]);
  const cargar = async () => {
    setCargando(true); setError('');
    const resultado = await supabase.from('productos').select('*').limit(500);
    if (resultado.error) setError('No se pudo consultar inventario: ' + resultado.error.message);
    else {      
setColumnasProductos(resultado.data?.[0] ? Object.keys(resultado.data[0]) : []); setProductos((resultado.data || []).map((p: any) => ({
        id: String(p.id), nombre: String(p.nombre ?? 'Sin nombre'), codigo: String(p.codigo ?? ''),
        stock: typeof (p.stock ?? p.existencia) === 'number' ? Number(p.stock ?? p.existencia) : null,
        precio: typeof p.precio === 'number' ? Number(p.precio) : null,
        categoria: String(p.categoria ?? ''), imagen_url: String(p.imagen_url ?? ''), campos: Object.keys(p)
      })));    
}
    try { setCatalogos(await listarCatalogosJAIVISA()); }
    catch (e: any) { setMensaje('Los PDF no están disponibles: ' + (e?.message || 'Verifica los permisos.')); }
    setCargando(false);
  };
  const guardarProducto = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!productoEditando || guardandoProducto) return;
    if (!productoEditando.nombre.trim()) { setAvisoProducto('Escribe el nombre del producto.'); return; }
    if (productoEditando.precio !== null && (!Number.isFinite(productoEditando.precio) || productoEditando.precio < 0)) { setAvisoProducto('Indica un precio válido.'); return; }
    setGuardandoProducto(true); setAvisoProducto('');
    const bucket = 'jaivisa-productos';
    let rutaNueva: string | null = null;
    let fichaGuardada = false;
    let foto = productoEditando.imagen_url.trim();
    try {
      if (fotoPendiente) {
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(fotoPendiente.type) || fotoPendiente.size > 5 * 1024 * 1024) { throw new Error('La foto debe ser JPG, PNG o WebP de máximo 5 MB.'); }
        const extension = fotoPendiente.type === 'image/png' ? 'png' : fotoPendiente.type === 'image/webp' ? 'webp' : 'jpg';
        rutaNueva = `productos/${crypto.randomUUID()}.${extension}`;
        const subida = await supabase.storage.from(bucket).upload(rutaNueva, fotoPendiente, { contentType: fotoPendiente.type, upsert: false });
        if (subida.error) { rutaNueva = null; throw new Error('No se pudo subir la fotografía: ' + subida.error.message); }
        foto = supabase.storage.from(bucket).getPublicUrl(rutaNueva).data.publicUrl;
      }
      if (foto && !/^https:\/\/[^\s]+$/i.test(foto)) throw new Error('La fotografía debe tener una dirección HTTPS válida.');
      const campos = productoEditando.campos;
      if (foto && !campos.includes('imagen_url')) throw new Error('La tabla productos no tiene la columna imagen_url. Debemos revisarla antes de guardar fotografías.');
      const cambios: Record<string, unknown> = { nombre: productoEditando.nombre.trim() };
      if (campos.includes('codigo')) cambios.codigo = productoEditando.codigo.trim();
      if (campos.includes('precio')) cambios.precio = productoEditando.precio;
      if (campos.includes('categoria')) cambios.categoria = productoEditando.categoria.trim();
      if (campos.includes('imagen_url')) cambios.imagen_url = foto || null;
      const resultado = crearNuevo
        ? await supabase.from('productos').insert(cambios).select('*')
        : await supabase.from('productos').update(cambios).eq('id', productoEditando.id).select('*');
      if (resultado.error) throw new Error('No se pudo guardar el producto: ' + resultado.error.message);
      if (!resultado.data?.length) throw new Error('JAIVISA no pudo confirmar la actualización del producto. Solicita revisar los permisos de acceso.');
      fichaGuardada = true;
      const guardado = resultado.data[0] as Record<string, unknown>;
      if (foto && String(guardado.imagen_url ?? '') !== foto) throw new Error('JAIVISA no pudo confirmar la fotografía del producto.');
      const eraNuevo = crearNuevo;
      setProductoEditando(null); setFotoPendiente(null); setCrearNuevo(false);
      await cargar();
      setAvisoProducto(eraNuevo ? '✓ Producto creado correctamente.' : '✓ Producto actualizado correctamente' + (rutaNueva ? ' con su fotografía.' : '.'));
    } catch (err: any) {
      let mensajeError = err instanceof Error ? err.message : String(err);
      if (rutaNueva && !fichaGuardada) {
        // El archivo recién subido no debe quedar huérfano si falló el guardado de la ficha.
        const limpieza = await supabase.storage.from(bucket).remove([rutaNueva]);
        if (limpieza.error) mensajeError += ' La imagen se subió, pero no se pudo eliminar el archivo sin asociar: ' + limpieza.error.message;
      }
      setAvisoProducto('⚠ ' + mensajeError);
    } finally { setGuardandoProducto(false); }
  };
  useEffect(() => { void cargar() }, []);
  // Audio activado por interacción explícita del operario; el navegador puede bloquearlo hasta entonces.
  const reproducirCampana = async () => {
    try {
      const ctx = audioRef.current;
      if (!ctx || ctx.state === 'closed') throw new Error('Audio inactivo');
      if (ctx.state === 'suspended') await ctx.resume();
      const base = ctx.currentTime + .025;
      const nivel = Math.min(.8, Math.max(.02, volumenRef.current / 100 * .65));
      // Tres golpes de campana con armónicos; se limita la amplitud para evitar distorsión.
      [0, .38, .76].forEach((t) => {
        [740, 1110, 1480].forEach((hz, i) => {
          const osc = ctx.createOscillator(), gain = ctx.createGain();
          osc.type = 'sine'; osc.frequency.value = hz;
          const inicio = base + t;
          gain.gain.setValueAtTime(.0001, inicio);
          gain.gain.exponentialRampToValueAtTime(Math.max(.001, nivel * [.42, .19, .09][i]), inicio + .018);
          gain.gain.exponentialRampToValueAtTime(.0001, inicio + .31);
          osc.connect(gain); gain.connect(ctx.destination);
          osc.start(inicio); osc.stop(inicio + .32);
        });
      });
    } catch { throw new Error('No se pudo reproducir la campana. Revisa el sonido del equipo.'); }
  };
  const reproducirVozIsa = async () => {
    try {
      if (!vozIsaRef.current) vozIsaRef.current = new Audio('/isa-voz-pedido.mp3');
      const voz = vozIsaRef.current;
      voz.pause(); voz.currentTime = 0;
      voz.volume = Math.min(1, Math.max(.1, volumenRef.current / 100));
      await voz.play();
    } catch { throw new Error('No se pudo reproducir la voz de Isa. Verifica public/isa-voz-pedido.mp3 y los permisos de audio del navegador.'); }
  };
  const reproducirAvisoCompleto = async () => {
    await reproducirCampana();
    // La campana dura aprox. 1.1 segundos; la voz comienza después.
    await new Promise<void>(resolver => setTimeout(resolver, 1250));
    if (habilitadoRef.current) await reproducirVozIsa();
  };
  const probarSonido = async () => {
    try {
      if (!audioRef.current || audioRef.current.state === 'closed') audioRef.current = new window.AudioContext();
      await audioRef.current.resume();
      habilitadoRef.current = true;
      setSonidoHabilitado(true);
      setMensaje('');
      await reproducirAvisoCompleto();
      setMensaje('Campana y voz de Isa activadas. Ajusta el volumen del equipo y los parlantes.');
    } catch (error) {
      setMensaje(error instanceof Error ? error.message : 'No se pudo iniciar el audio en este navegador.');
    }
  };
  useEffect(() => {
    let activo = true;
    // Cargar IDs existentes evita que pedidos antiguos suenen como recién llegados.
    void (async () => {
      const { data, error } = await supabase.from('jv_pedidos').select('id').limit(1000);
      if (!activo) return;
      if (error) { setMensaje('No se pudieron consultar las alertas de pedidos: ' + error.message); return; }
      vistosRef.current = new Set((data || []).map((p: any) => String(p.id)));
    })();
    const canal = supabase.channel('jv_bodega_campana_pedidos')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'jv_pedidos' }, (evento: any) => {
        if (!activo || !vistosRef.current) return;
        const id = String(evento.new?.id || '');
        if (!id || vistosRef.current.has(id)) return;
        vistosRef.current.add(id);
        const numero = evento.new?.numero;
        setNotificaciones(prev => [{ id, titulo: 'Nuevo pedido' + (numero ? ' #' + numero : ''), fecha: new Date().toLocaleString('es-CO') }, ...prev].slice(0, 30));
        if (habilitadoRef.current) {
          void reproducirAvisoCompleto().catch((error: Error) => {
            if (activo) setMensaje(error.message);
          });
        }
      }).subscribe();
    return () => { activo = false; habilitadoRef.current = false; void supabase.removeChannel(canal); void audioRef.current?.close(); audioRef.current = null; vozIsaRef.current?.pause(); vozIsaRef.current = null; };
  }, []);
  const cards: { id: Seccion; icono: string; titulo: string; detalle: string }[] = [
    { id: 'pedidos', icono: 'pedidos', titulo: 'Pedidos recibidos', detalle: 'Pendientes de preparación' },
    { id: 'inventario', icono: 'caja', titulo: 'Inventario', detalle: 'Productos y existencias' },
    { id: 'despachos', icono: 'camion', titulo: 'Despachos', detalle: 'Seguimiento de entregas' },
    { id: 'etiquetas', icono: 'etiqueta', titulo: 'Etiquetas', detalle: 'Impresión y empaque' },
    { id: 'catalogos', icono: 'libros', titulo: 'Catálogos PDF', detalle: 'Documentos publicados' },
    { id: 'notificaciones', icono: 'campana', titulo: 'Notificaciones', detalle: 'Avisos de nuevos pedidos' }
  ];
  const boton: React.CSSProperties = { border: 0, borderRadius: 11, padding: '11px 15px', background: '#64258e', color: '#fff', fontWeight: 750, cursor: 'pointer' };
  return <main className="jv-bodega jv-unified jv-future-bodega" style={{ minHeight: '100vh', background: '#faf7fc', padding: '18px clamp(12px,3vw,35px)', fontFamily: 'Inter,system-ui,sans-serif', color: '#351448' }}>
    <style>{jaivisaNextCSS}</style><div style={{ maxWidth: 1160, margin: 'auto' }}>
      <header className="jv-future-header">
        <div className="jv-future-brand"><img src={JAIVISA_LOGO} alt="JAIVISA" /><div><strong>JAIVISA NEXT · BODEGA</strong><small>Centro Operativo del Equipo</small></div></div>
        <div className="jv-future-actions"><button type="button" aria-label={'Abrir notificaciones, ' + notificaciones.length + ' avisos'} onClick={() => setSeccion('notificaciones')}><IconoNext nombre="campana" tamano={21} />{notificaciones.length > 0 && <span className="jv-future-bubble">{notificaciones.length}</span>}</button><button type="button" onClick={() => void salir()}>Salir</button></div>
      </header>
      <section className="jv-future-hero" aria-label="Bienvenida al Centro Operativo de Bodega">
        <img className="jv-future-isa" src="/jaivisa-isa-hero.png" alt="Isa, asistente de JAIVISA" />
        <div className="jv-future-hero-copy">
          <div className="jv-future-eyebrow">JAIVISA NEXT · CENTRO OPERATIVO</div>
          <h1>¡Hola{perfil.nombre ? ', ' + perfil.nombre.split(' ')[0] : ''}! 👋</h1>
          <h2>Bienvenida al Centro Operativo de Bodega</h2>
          <p>Gestiona pedidos, consulta existencias y coordina despachos desde un solo lugar.</p>
          <p className="jv-future-hero-hint">Isa te acompaña durante tu jornada.</p>
        </div>
        <div className="jv-future-warehouse" aria-hidden="true" />
      </section>
      {mensaje && <p role="status" style={{ padding: 12, background: '#f1e7f9', borderRadius: 12 }}>{mensaje}</p>}
      {seccion === 'inicio' ? <>
        <div className="jv-future-stats" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 12, marginBottom: 16 }}>
          {([['caja', String(productos.length), 'Productos cargados (máx. 500)', 'inventario'], ['libros', String(catalogos.length), 'Catálogos PDF', 'catalogos'], ['campana', String(notificaciones.length), 'Avisos recibidos', 'notificaciones']] as const).map(([ico, nombre, detalle, destino]) => <button type="button" className="jv-future-stat" key={detalle} onClick={() => setSeccion(destino)} aria-label={'Abrir ' + detalle} style={{ background: 'white', padding: 20, border: '1px solid #e7dced', borderRadius: 17, textAlign: 'center', cursor: 'pointer', color: '#351448', fontFamily: 'inherit', width: '100%' }}><div style={{ fontSize: 28 }}><IconoNext nombre={ico} tamano={25} /></div><strong style={{ fontSize: 24 }}>{nombre}</strong><p style={{ color: '#766384', fontSize: 13 }}>{detalle}</p><span style={{ fontSize: 12, color: '#64258e', fontWeight: 700 }}>Ver sección →</span></button>)}
        </div>
        <div className="jv-bodega-menu-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 14 }}>{cards.map(c => <button className="jv-next-card jv-bodega-menu-card" key={c.id} onClick={() => setSeccion(c.id)} style={{ textAlign: 'left', background: 'white', border: '1px solid #e8deef', borderRadius: 18, padding: 22, minHeight: 145, cursor: 'pointer' }}><span style={{ fontSize: 30 }}><IconoNext nombre={c.icono} tamano={28} /></span><h3 style={{ margin: '10px 0 6px', color: '#351448' }}>{c.titulo}</h3><div style={{ color: '#756682', fontSize: 13 }}>{c.detalle}</div><strong style={{ color: '#64258e', display: 'block', marginTop: 12 }}>Abrir sección →</strong></button>)}</div>
        <button type="button" className="jv-future-activity" onClick={() => setSeccion('notificaciones')}><span><IconoNext nombre="campana" tamano={25} /> <strong>Actividad reciente</strong><small>Consulta los últimos avisos recibidos por Bodega</small></span><b>Ver avisos →</b></button>
      </> : <section style={{ background: 'white', border: '1px solid #e8deef', borderRadius: 18, padding: 22 }}>
        <button style={boton} onClick={() => setSeccion('inicio')}>← Inicio</button>
        <h2><IconoNext nombre={cards.find(c => c.id === seccion)?.icono || "chispa"} /> {cards.find(c => c.id === seccion)?.titulo}</h2>
        {seccion === 'inventario' && <>
          <input aria-label="Buscar producto" value={busqueda} onChange={e => setBusqueda(e.target.value)} placeholder="Buscar por nombre, referencia o categoría" style={{ width: '100%', padding: 13, border: '1px solid #d8c8e4', borderRadius: 10, marginBottom: 15 }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}><button style={boton} onClick={() => void cargar()} disabled={cargando}>{cargando ? 'Actualizando…' : '↻ Actualizar'}</button><span style={{ fontSize: 13, color: '#766384' }}>{productos.length} producto(s) consultados (máximo 500) en JAIVISA · {productos.reduce((n, p) => n + (p.stock ?? 0), 0)} unidades registradas</span></div>
          <button type="button" style={{ ...boton, marginBottom: 12 }} onClick={() => { setCrearNuevo(true); setFotoPendiente(null); setProductoEditando({ id: '', nombre: '', codigo: '', stock: null, precio: 0, categoria: '', imagen_url: '', campos: columnasProductos.length ? columnasProductos : ['nombre', 'codigo', 'precio', 'categoria', 'imagen_url'] }); setAvisoProducto('') }}>＋ Agregar producto</button>
          {error && <p role="alert">{error}</p>}{avisoProducto && <p role="status" style={{ padding: 12, background: '#f4eafa', borderRadius: 10 }}>{avisoProducto}</p>}
          {productoEditando && <form onSubmit={e => void guardarProducto(e)} style={{ border: '1px solid #d8c8e4', background: '#faf6fd', padding: 16, borderRadius: 14, margin: '15px 0', display: 'grid', gap: 12 }}>
            <h3 style={{ margin: 0 }}>{crearNuevo ? '＋ Crear producto' : '✏️ Editar producto'}</h3>
            <label>Nombre<input required style={{ display: 'block', width: '100%', padding: 10, boxSizing: 'border-box' }} value={productoEditando.nombre} onChange={e => setProductoEditando(p => p ? { ...p, nombre: e.target.value } : p)} /></label>
            {productoEditando.campos.includes('codigo') && <label>Referencia / SKU<input style={{ display: 'block', width: '100%', padding: 10, boxSizing: 'border-box' }} value={productoEditando.codigo} onChange={e => setProductoEditando(p => p ? { ...p, codigo: e.target.value } : p)} /></label>}
            {productoEditando.campos.includes('precio') && <label>Precio base (COP)<input type="number" min="0" step="1" required style={{ display: 'block', width: '100%', padding: 10, boxSizing: 'border-box' }} value={productoEditando.precio ?? ''} onChange={e => setProductoEditando(p => p ? { ...p, precio: e.target.value === '' ? null : Number(e.target.value) } : p)} /></label>}
            {productoEditando.campos.includes('categoria') && <label>Categoría<input style={{ display: 'block', width: '100%', padding: 10, boxSizing: 'border-box' }} value={productoEditando.categoria} onChange={e => setProductoEditando(p => p ? { ...p, categoria: e.target.value } : p)} /></label>}
            {productoEditando.campos.includes('imagen_url') && <label>URL de fotografía<input type="url" style={{ display: 'block', width: '100%', padding: 10, boxSizing: 'border-box' }} value={productoEditando.imagen_url} onChange={e => setProductoEditando(p => p ? { ...p, imagen_url: e.target.value } : p)} /></label>}
            {productoEditando.campos.includes('imagen_url') && <label>Subir fotografía desde tu dispositivo (JPG, PNG o WebP, máximo 5 MB)<input type="file" accept="image/jpeg,image/png,image/webp" style={{ display: 'block', width: '100%', marginTop: 7 }} onChange={e => setFotoPendiente(e.target.files?.[0] || null)} /></label>}
            {fotoPendiente && <p style={{ fontSize: 13, margin: 0 }}>Fotografía seleccionada: {fotoPendiente.name}</p>}{fotoPendiente && <VistaPreviaFotoJAIVISA archivo={fotoPendiente} />}
            {productoEditando.imagen_url && /^https:\/\//i.test(productoEditando.imagen_url) && <img src={productoEditando.imagen_url} alt={'Vista previa de ' + productoEditando.nombre} style={{ width: 130, height: 130, objectFit: 'contain', borderRadius: 12, background: '#fff', border: '1px solid #e8deef' }} />}
            <p style={{ fontSize: 13, color: '#766384', margin: 0 }}>{crearNuevo ? 'Las existencias se gestionan por movimientos auditados.' : 'Existencias actuales: ' + (productoEditando.stock ?? 'No disponibles') + '.'} Los movimientos de inventario requieren registro auditado; no se modifican aquí.</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><button style={boton} disabled={guardandoProducto}>{guardandoProducto ? 'Guardando…' : crearNuevo ? 'Crear producto' : 'Guardar cambios'}</button><button type="button" style={{ ...boton, background: '#82748a' }} onClick={() => { setProductoEditando(null); setFotoPendiente(null); setCrearNuevo(false) }}>Cancelar</button></div>
          </form>}
          {cargando ? <p>Cargando…</p> : <>
            {productos.filter(p => (p.nombre + ' ' + p.codigo + ' ' + p.categoria).toLowerCase().includes(busqueda.trim().toLowerCase())).length === 0 && <p style={{ padding: 16, color: '#766384' }}>No se encontraron productos con esa búsqueda.</p>}
            <style>{`
              .jv-bodega-inventario-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;margin-top:14px}
              .jv-bodega-inventario-card{display:flex;flex-direction:column;justify-content:space-between;min-width:0;padding:14px;border:1px solid #eee5f4;border-radius:14px;background:#fff;gap:12px}
              .jv-bodega-inventario-info{display:flex;align-items:flex-start;gap:12px;min-width:0}
              .jv-bodega-inventario-info>div:last-child{min-width:0;overflow-wrap:anywhere}
              .jv-bodega-inventario-info img,.jv-bodega-inventario-info>div[aria-label]{flex:0 0 78px}
              .jv-bodega-inventario-card>button{align-self:flex-start}
              @media(max-width:600px){
                .jv-bodega-inventario-grid{grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}
                .jv-bodega-inventario-card{padding:7px;gap:7px;border-radius:10px}
                .jv-bodega-inventario-info{flex-direction:column;gap:6px;align-items:stretch}
                .jv-bodega-inventario-info img,.jv-bodega-inventario-info>div[aria-label]{width:100%!important;height:75px!important;flex:none!important}
                .jv-bodega-inventario-info strong{font-size:11px;line-height:1.25;display:block}
                .jv-bodega-inventario-info div div{font-size:10px!important;line-height:1.3;overflow-wrap:anywhere}
                .jv-bodega-inventario-card>button{width:100%;padding:7px 2px!important;font-size:11px!important;min-height:32px}
              }
            `}</style>
            <div className="jv-bodega-inventario-grid">
            {productos.filter(p => (p.nombre + ' ' + p.codigo + ' ' + p.categoria).toLowerCase().includes(busqueda.trim().toLowerCase())).map(p => <div key={p.id} className="jv-bodega-inventario-card">
              <div className="jv-bodega-inventario-info">
                {p.imagen_url ? <img src={p.imagen_url} alt={'Fotografía de ' + p.nombre} loading="lazy" style={{ width: 78, height: 78, objectFit: 'contain', border: '1px solid #e8deef', borderRadius: 12, background: '#fff' }} /> : <div aria-label="Producto sin fotografía" style={{ width: 78, height: 78, display: 'grid', placeItems: 'center', border: '1px dashed #d8c8e4', borderRadius: 12, color: '#766384', fontSize: 12, textAlign: 'center' }}>Sin foto</div>}
                <div><strong>{p.nombre}</strong><div style={{ fontSize: 13, color: '#746080' }}>Ref. {p.codigo || 'Sin referencia'} · {p.categoria || 'Sin categoría'}</div><div style={{ fontSize: 13, color: '#746080' }}>{p.stock === null ? 'Existencias no disponibles' : 'Existencias: ' + p.stock}{p.precio !== null ? ' · ' + money(p.precio) : ''}</div></div>
              </div><button type="button" style={boton} onClick={() => { setCrearNuevo(false); setFotoPendiente(null); setProductoEditando({ ...p }); setAvisoProducto('') }}>✏️ Editar</button>
            </div>)}
            </div>
          </>}
        </>}
        {seccion === 'catalogos' && <><button style={boton} onClick={() => void cargar()}>Actualizar catálogos</button><GaleriaCatalogos catalogos={catalogos} /></>}
        {seccion === 'notificaciones' && <><p>🔔 {notificaciones.length === 0 ? 'No hay notificaciones reales recibidas.' : 'Notificaciones recibidas:'}</p><button style={boton} onClick={() => void probarSonido()}>🔊 Activar y probar campana + voz de Isa</button><label style={{ display: 'block', marginTop: 14 }}>Volumen de la alerta: {volumenAlerta}% <input type="range" min="10" max="100" step="5" value={volumenAlerta} onChange={e => setVolumenAlerta(Number(e.target.value))} style={{ display: 'block', width: 'min(340px,100%)', marginTop: 6 }} /></label><p style={{ color: '#756682', fontSize: 13 }}>Campana y mensaje grabado de Isa para pedidos nuevos mientras la aplicación esté abierta. {sonidoHabilitado ? 'Audio habilitado en esta sesión.' : 'Pulsa para habilitar el audio en este navegador.'}</p>{notificaciones.map(n => <button type="button" key={n.id} onClick={() => { setPedidoDestinoId(n.id); setSeccion('pedidos'); }} style={{ display: 'block', width: '100%', textAlign: 'left', padding: 13, marginTop: 9, background: '#faf6fd', border: '1px solid #e7dced', borderRadius: 10, cursor: 'pointer', color: '#351448' }}><strong>{n.titulo}</strong><span style={{ display: 'block', fontSize: 12, marginTop: 4 }}>{n.fecha}</span><span style={{ display: 'block', color: '#64258e', fontWeight: 700, marginTop: 5 }}>Ver pedido →</span></button>)}</>}
        {seccion === 'pedidos' && <><CentroPedidos rol="bodega" pedidoInicialId={pedidoDestinoId} /><ModulosEmpresa rol="bodega" /></>}
        {['despachos', 'etiquetas'].includes(seccion) && <p style={{ padding: 18, background: '#f8f3fb', borderRadius: 12 }}>Esta función estará disponible cuando finalicemos la activación de los despachos y etiquetas de JAIVISA. Por ahora no se realizan cambios en los pedidos.</p>}
      </section>}
      <footer style={{ textAlign: 'center', padding: 25, fontSize: 12, color: '#8a7894' }}>JAIVISA · Portal Mayorista · Bodega</footer>
    </div>
  </main>;
}


// JAIVISA NEXT · Sistema de diseño compartido para TODOS los roles.
// No modifica permisos, pedidos, precios ni las consultas a Supabase.
const JAIVISA_SHARED_CSS = `
/* Estado operativo compartido: sin advertencias amarillas, legible en móvil */
.jv-warehouse-status{display:flex;align-items:flex-start;gap:14px;margin:16px 0 22px;padding:18px 20px;border:1px solid #8e5dc54f;border-radius:19px;background:radial-gradient(circle at 92% 5%,#7d38a94d,transparent 45%),linear-gradient(112deg,#1a0c2b,#35204f 67%,#482365);color:#f7efff;box-shadow:0 12px 34px #34104924}
.jv-warehouse-status-icon{display:flex;flex:0 0 44px;height:44px;align-items:center;justify-content:center;background:#ffffff18;border:1px solid #ffffff2b;border-radius:13px;color:#e5c4ff}
.jv-warehouse-status-copy{min-width:0;flex:1}
.jv-warehouse-status-eyebrow{color:#d8b9f5;font-size:10px;font-weight:800;letter-spacing:1.6px;margin-bottom:5px}
.jv-warehouse-status-title{display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:17px;font-weight:800;line-height:1.35}
.jv-warehouse-status-badge{font-size:10px;letter-spacing:.8px;color:#f2e5ff;background:#ffffff1a;border:1px solid #ffffff40;padding:5px 9px;border-radius:100px;white-space:nowrap}
.jv-warehouse-status p{margin:7px 0 0;color:#dfd0e9;font-size:13px;line-height:1.6}
@media(max-width:580px){.jv-warehouse-status{padding:14px;gap:10px;margin:12px 0 16px}.jv-warehouse-status-icon{flex-basis:38px;height:38px}.jv-warehouse-status-title{font-size:15px}.jv-warehouse-status p{font-size:12px}}

:root{--jv-ink:#261434;--jv-violet:#6724a0;--jv-border:#e8def0;--jv-surface:#fff;--jv-shadow:0 12px 34px rgba(51,20,80,.09)}
.jv-unified{font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--jv-ink);min-width:0;overflow-x:clip}
.jv-unified *, .jv-unified *::before,.jv-unified *::after{box-sizing:border-box}
.jv-unified button,.jv-unified a,.jv-unified input,.jv-unified select,.jv-unified textarea{font-family:inherit}
.jv-unified button,.jv-unified a{touch-action:manipulation}
.jv-unified button:not(:disabled){cursor:pointer}
.jv-unified :is(button,a,input,select,textarea):focus-visible{outline:3px solid #b46af2!important;outline-offset:3px}
.jv-unified :is(input,select,textarea){max-width:100%;font-size:16px}
.jv-unified :is(.panel,.jv-card,.jv-catalog-card){border-radius:20px;box-shadow:var(--jv-shadow)}
.jv-unified :is(.primary,.secondary,.jv-catalog-open){border-radius:13px;min-height:44px}
.jv-unified .jv-catalog-grid{display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:18px!important;align-items:stretch}
.jv-unified .jv-catalog-card{min-width:0;overflow:hidden}
.jv-unified .jv-catalog-card strong{overflow-wrap:anywhere}
.jv-unified .jv-catalog-open{display:flex;align-items:center;justify-content:center}
.jv-global-header{background:linear-gradient(115deg,#1c0e30 0%,#3c175a 58%,#682c91 100%);color:#fff;padding:13px clamp(14px,3vw,36px);display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;box-shadow:0 10px 34px #210a3a25;position:relative;isolation:isolate}
.jv-global-header::after{content:"";position:absolute;inset:0;background:radial-gradient(circle at 80% 0%,#bd7cff22,transparent 43%);pointer-events:none;z-index:-1}
.jv-global-brand{display:flex;align-items:center;gap:12px;min-width:0}
.jv-global-brand img{width:91px;height:52px;object-fit:contain;flex:none}
.jv-global-brand small{display:block;color:#d6b6ef;font-size:10px;font-weight:800;letter-spacing:1.7px}
.jv-global-brand strong{display:block;color:#fff;font-size:15px;font-weight:750}
.jv-global-meta{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.jv-global-chip{font-size:12px;color:#f3e7ff;background:#ffffff18;border:1px solid #ffffff36;border-radius:100px;padding:9px 13px}
.jv-global-exit{border:1px solid #ffffff48;background:#ffffff1d;color:#fff;border-radius:12px;padding:11px 15px;font-weight:750;min-height:44px}
.jv-unified .jv-global-header + *{min-width:0}
.jv-unified.jv-administracion{background:linear-gradient(150deg,#f7f2fb,#fff 50%,#f4effa)}
.jv-unified.jv-clientes{background:linear-gradient(150deg,#f7f2fb,#fff 50%,#f4effa)}
.jv-unified.jv-bodega .jv-catalog-grid,.jv-unified.jv-vendedor .jv-catalog-grid{grid-template-columns:repeat(3,minmax(0,1fr))!important}
@media(max-width:900px){
 .jv-unified .jv-catalog-grid,.jv-unified.jv-bodega .jv-catalog-grid,.jv-unified.jv-vendedor .jv-catalog-grid{grid-template-columns:repeat(2,minmax(0,1fr))!important}
}
@media(max-width:580px){
 .jv-unified .jv-catalog-grid,.jv-unified.jv-bodega .jv-catalog-grid,.jv-unified.jv-vendedor .jv-catalog-grid{grid-template-columns:minmax(0,1fr)!important}
 .jv-global-header{padding:11px 14px}
 .jv-global-brand img{width:73px;height:45px}
 .jv-global-brand strong{font-size:13px}
 .jv-global-chip{display:none}
 .jv-unified :is(button,.primary,.secondary){min-height:44px}
}

/* Sistema visual de Administración: la misma tipografía y acabados en todos los perfiles. */
:root{--jv-admin-primary:#4c1d69;--jv-admin-accent:#9d65d1;--jv-admin-surface:#faf8fd}
.jv-unified,.jv-unified :is(button,input,select,textarea),.jv-client-shell,.jv-client-shell :is(button,input,select,textarea){font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif!important}
.jv-unified :is(h1,h2,h3,h4,h5,strong),.jv-client-shell :is(h1,h2,h3,h4,h5,strong){font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif!important;letter-spacing:-.025em}
.jv-unified :is(button,.primary,.secondary),.jv-client-shell :is(button,.primary,.secondary){font-weight:700}
.jv-unified :is(input,select,textarea),.jv-client-shell :is(input,select,textarea){border-color:#e2d5ed}
.jv-unified :is(button,a):focus-visible,.jv-client-shell :is(button,a):focus-visible{outline:3px solid #a66fd5;outline-offset:3px}
.jv-unified :is(button,input,select,textarea),.jv-client-shell :is(button,input,select,textarea){touch-action:manipulation}
.jv-unified .jv-catalog-grid,.jv-client-shell .jv-catalog-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px}
@media(max-width:900px){.jv-unified .jv-catalog-grid,.jv-client-shell .jv-catalog-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:580px){.jv-unified .jv-catalog-grid,.jv-client-shell .jv-catalog-grid{grid-template-columns:minmax(0,1fr)}}

/* Misma presentación de miniaturas para Mayorista, Vendedor y Bodega. */
.jv-client-shell .jv-catalog-thumb,.jv-vendedor .jv-catalog-thumb,.jv-bodega .jv-catalog-thumb{height:220px!important;min-height:220px!important;display:flex!important;align-items:center!important;justify-content:center!important;background:linear-gradient(145deg,#f6f0fa,#e8dcf1)!important;overflow:hidden!important}
.jv-client-shell .jv-catalog-thumb::after,.jv-vendedor .jv-catalog-thumb::after,.jv-bodega .jv-catalog-thumb::after{content:none!important;display:none!important}
.jv-client-shell .jv-catalog-thumb canvas,.jv-vendedor .jv-catalog-thumb canvas,.jv-bodega .jv-catalog-thumb canvas{max-height:100%!important;max-width:100%!important;object-fit:contain!important}
.jv-vendedor .jv-catalog-grid,.jv-client-shell .jv-catalog-grid,.jv-bodega .jv-catalog-grid{display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:16px!important}
@media(max-width:900px){.jv-vendedor .jv-catalog-grid,.jv-client-shell .jv-catalog-grid,.jv-bodega .jv-catalog-grid{grid-template-columns:repeat(2,minmax(0,1fr))!important}}
@media(max-width:580px){.jv-vendedor .jv-catalog-grid,.jv-client-shell .jv-catalog-grid,.jv-bodega .jv-catalog-grid{grid-template-columns:minmax(0,1fr)!important}.jv-client-shell .jv-catalog-thumb,.jv-vendedor .jv-catalog-thumb,.jv-bodega .jv-catalog-thumb{height:220px!important;min-height:220px!important}}
/* Tarjetas compactas e idénticas para clientes mayoristas y vendedores. */
.jv-client-shell .jv-catalog-grid,.jv-vendedor .jv-catalog-grid{gap:16px!important;margin-top:16px!important;align-items:stretch!important}
.jv-client-shell .jv-catalog-card,.jv-vendedor .jv-catalog-card{display:flex!important;flex-direction:column!important;background:#fff!important;border:1px solid #efe7f4!important;border-radius:17px!important;box-shadow:0 7px 20px rgba(69,37,91,.08)!important;overflow:hidden!important;min-width:0!important}
.jv-client-shell .jv-catalog-card::before,.jv-vendedor .jv-catalog-card::before{content:"";display:block;height:7px;background:#f0e6f8}
.jv-client-shell .jv-catalog-thumb,.jv-vendedor .jv-catalog-thumb{height:auto!important;min-height:0!important;aspect-ratio:1.85/1!important;background:#fff!important;border-bottom:7px solid #f0e6f8!important;padding:0!important}
.jv-client-shell .jv-catalog-thumb canvas,.jv-vendedor .jv-catalog-thumb canvas{width:100%!important;height:100%!important;max-width:100%!important;max-height:100%!important;object-fit:contain!important;box-shadow:none!important}
.jv-client-shell .jv-catalog-card>div:last-child,.jv-vendedor .jv-catalog-card>div:last-child{padding:13px 12px 16px!important;display:flex!important;flex-direction:column!important;align-items:center!important;justify-content:space-between!important;gap:10px!important;min-height:112px!important;text-align:center!important;flex:1!important}
.jv-client-shell .jv-catalog-card strong,.jv-vendedor .jv-catalog-card strong{color:#361047!important;font-size:14px!important;font-weight:700!important;line-height:1.3!important;text-transform:uppercase!important;letter-spacing:-.02em!important;min-height:36px!important}
.jv-client-shell .jv-catalog-open,.jv-vendedor .jv-catalog-open{background:transparent!important;color:#243fe0!important;box-shadow:none!important;border:0!important;padding:7px 9px!important;min-height:35px!important;font-size:13px!important;font-weight:600!important;text-decoration:none!important;align-self:center!important}
.jv-client-shell .jv-catalog-open:hover,.jv-vendedor .jv-catalog-open:hover{text-decoration:underline!important}
@media(max-width:580px){.jv-client-shell .jv-catalog-grid,.jv-vendedor .jv-catalog-grid{gap:12px!important}.jv-client-shell .jv-catalog-card>div:last-child,.jv-vendedor .jv-catalog-card>div:last-child{padding:12px!important;min-height:100px!important;gap:8px!important}.jv-client-shell .jv-catalog-card strong,.jv-vendedor .jv-catalog-card strong{font-size:13px!important;min-height:0!important}}
/* FINAL: exactamente las mismas medidas en Clientes y Vendedores. */
.jv-client-shell .jv-catalog-grid,.jv-vendedor .jv-catalog-grid{display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr))!important;column-gap:14px!important;row-gap:14px!important;margin-top:14px!important}
.jv-client-shell .jv-catalog-card,.jv-vendedor .jv-catalog-card{height:auto!important;min-height:0!important;align-self:stretch!important}
.jv-client-shell .jv-catalog-thumb,.jv-vendedor .jv-catalog-thumb{width:100%!important;height:auto!important;min-height:0!important;aspect-ratio:1.85 / 1!important;flex:none!important}
.jv-client-shell .jv-catalog-card>div:last-child,.jv-vendedor .jv-catalog-card>div:last-child{height:auto!important;min-height:92px!important;padding:10px 12px 12px!important;gap:7px!important;justify-content:space-between!important}
.jv-client-shell .jv-catalog-card strong,.jv-vendedor .jv-catalog-card strong{min-height:0!important;margin:0!important}
.jv-client-shell .jv-catalog-open,.jv-vendedor .jv-catalog-open{margin:0!important}
@media(max-width:900px){.jv-client-shell .jv-catalog-grid,.jv-vendedor .jv-catalog-grid{grid-template-columns:repeat(2,minmax(0,1fr))!important}}
@media(max-width:580px){.jv-client-shell .jv-catalog-grid,.jv-vendedor .jv-catalog-grid{grid-template-columns:minmax(0,1fr)!important;gap:12px!important}.jv-client-shell .jv-catalog-thumb,.jv-vendedor .jv-catalog-thumb{height:auto!important;min-height:0!important;aspect-ratio:1.85 / 1!important}}
/* JAIVISA: enlaces de catálogos en morado corporativo y hover lila. */
.jv-client-shell .jv-catalog-open,.jv-vendedor .jv-catalog-open{color:#64258c!important;background:transparent!important;border-radius:9px!important;transition:color .2s ease,background-color .2s ease,box-shadow .2s ease,transform .2s ease!important;text-decoration:none!important}
.jv-client-shell .jv-catalog-open:hover,.jv-vendedor .jv-catalog-open:hover{color:#8c43b3!important;background:#f3e8fb!important;box-shadow:0 3px 12px rgba(100,37,140,.12)!important;text-decoration:none!important;transform:translateY(-1px)}
.jv-client-shell .jv-catalog-open:focus-visible,.jv-vendedor .jv-catalog-open:focus-visible{outline:2px solid #8c43b3!important;outline-offset:2px!important;background:#f3e8fb!important}
.jv-client-shell .jv-catalog-open:active,.jv-vendedor .jv-catalog-open:active{color:#4b176c!important;background:#e9d5f5!important;transform:translateY(0)}
@media(prefers-reduced-motion:reduce){.jv-client-shell .jv-catalog-open,.jv-vendedor .jv-catalog-open{transition:none!important;transform:none!important}}
/* Ajuste puntual: Vendedores presenta tres catálogos por fila en pantallas amplias.
   Los documentos adicionales continúan en las siguientes filas, sin ocultarse. */
.jv-vendedor .jv-catalog-grid{grid-template-columns:repeat(3,minmax(0,1fr))!important;grid-auto-flow:row!important;align-items:stretch!important}
@media(min-width:581px) and (max-width:900px){.jv-vendedor .jv-catalog-grid{grid-template-columns:repeat(2,minmax(0,1fr))!important}}
@media(max-width:580px){.jv-vendedor .jv-catalog-grid{grid-template-columns:minmax(0,1fr)!important}}

/* JAIVISA NEXT: menú operativo compacto, solo en Bodega y en celulares. */
@media(max-width:680px){
 .jv-bodega .jv-bodega-menu-grid{display:grid!important;grid-template-columns:repeat(4,minmax(0,1fr))!important;gap:7px!important;align-items:stretch!important}
 .jv-bodega .jv-bodega-menu-card{display:flex!important;flex-direction:column!important;align-items:center!important;justify-content:center!important;text-align:center!important;gap:5px!important;min-height:88px!important;padding:10px 3px!important;border-radius:12px!important;overflow-wrap:anywhere!important;line-height:1.15!important}
 .jv-bodega .jv-bodega-menu-card>span{font-size:19px!important;line-height:1!important}
 .jv-bodega .jv-bodega-menu-card>span svg{width:23px!important;height:23px!important}
 .jv-bodega .jv-bodega-menu-card h3{font-size:10px!important;line-height:1.2!important;margin:2px 0!important;overflow-wrap:anywhere!important}
 .jv-bodega .jv-bodega-menu-card>div,.jv-bodega .jv-bodega-menu-card>strong{display:none!important}
 .jv-bodega .jv-bodega-menu-card:focus-visible{outline:3px solid #8b46b6!important;outline-offset:2px!important}
}
/* Bodega: controles cómodos y sin desbordamientos en pantallas pequeñas. */
.jv-bodega,.jv-bodega *{min-width:0}
.jv-bodega .jv-catalog-card{max-width:100%}
.jv-bodega .jv-catalog-card strong{overflow-wrap:anywhere}
@media(max-width:680px){
 .jv-bodega.jv-unified{padding:12px 12px 35px!important;overflow-x:hidden!important}
 .jv-bodega>div{max-width:100%!important}
 .jv-bodega header{display:flex!important;flex-wrap:wrap!important;gap:12px!important;padding:15px!important}
 .jv-bodega header>div{max-width:100%;flex-wrap:wrap}
 .jv-bodega header img{width:78px!important;height:54px!important;object-fit:contain!important}
 .jv-bodega header button{min-height:44px!important}
 .jv-bodega .jv-warehouse-status{max-width:100%!important;overflow-wrap:anywhere!important}
 .jv-bodega .jv-warehouse-status-copy{min-width:0!important}
 .jv-bodega .jv-catalog-grid{grid-template-columns:minmax(0,1fr)!important;gap:14px!important}
 .jv-bodega .jv-catalog-cover{height:auto!important;min-height:0!important;aspect-ratio:1.65/1!important}
 .jv-bodega .jv-catalog-open{min-height:44px!important;display:flex!important;align-items:center;justify-content:center}
 .jv-bodega input,.jv-bodega button{max-width:100%}
}
@media(prefers-reduced-motion:reduce){.jv-unified *{animation-duration:.01ms!important;transition-duration:.01ms!important}}


/* JAIVISA NEXT | Identidad futurista compartida, sin alterar lógica ni permisos */
.jv-unified{--jv-future-ink:#210d37;--jv-future-purple:#7026a8;--jv-future-glow:#a96cf5;background-image:radial-gradient(ellipse at 90% 4%,rgba(151,72,220,.18),transparent 38%),linear-gradient(145deg,#f8f4fc,#f0e9fa 72%,#faf7ff)!important}
.jv-unified .jv-global-header{background:radial-gradient(circle at 75% -30%,rgba(187,108,255,.48),transparent 48%),linear-gradient(112deg,#190925,#381052 62%,#60218b)!important;border-bottom:1px solid rgba(225,173,255,.4);box-shadow:0 14px 34px rgba(38,11,67,.22)}
.jv-unified .jv-global-brand img{filter:drop-shadow(0 2px 10px rgba(204,140,255,.4))}
.jv-unified .jv-global-exit{transition:background .18s,transform .18s}
.jv-unified .jv-global-exit:hover{background:#ffffff30;transform:translateY(-1px)}
.jv-unified :is(.panel,.jv-card,.jv-catalog-card){border:1px solid rgba(119,62,166,.15);box-shadow:0 12px 28px rgba(59,21,91,.09)}
.jv-unified :is(.panel,.jv-card,.jv-catalog-card):focus-within{border-color:rgba(155,88,218,.45)}
.jv-unified :is(.primary,.secondary,.jv-catalog-open){transition:filter .18s,transform .18s,box-shadow .18s}
.jv-unified :is(.primary,.secondary,.jv-catalog-open):not(:disabled):hover{filter:brightness(1.07);transform:translateY(-1px);box-shadow:0 8px 18px rgba(95,36,149,.16)}
.jv-bodega .jv-warehouse-status{background:radial-gradient(circle at 90% 12%,rgba(161,74,255,.32),transparent 40%),linear-gradient(116deg,#190927,#391153 70%,#672494)!important;border:1px solid rgba(199,136,255,.5)!important;box-shadow:0 14px 35px rgba(60,17,92,.22),inset 0 1px rgba(255,255,255,.13)!important}
.jv-bodega .jv-bodega-menu-card{background:linear-gradient(140deg,#2d1046,#4d1a75)!important;border:1px solid rgba(185,112,255,.55)!important;box-shadow:0 10px 28px rgba(50,13,78,.18)!important;color:#fff!important}
.jv-bodega .jv-bodega-menu-card h3{color:#fff!important}
.jv-bodega .jv-bodega-menu-card>div{color:#e5d3f3!important}
.jv-bodega .jv-bodega-menu-card strong{color:#e9baff!important}
.jv-bodega .jv-bodega-menu-card>span:first-child{color:#eecbff!important;background:linear-gradient(135deg,rgba(168,68,255,.42),rgba(48,154,255,.24))!important;border:1px solid rgba(211,153,255,.4)!important}
.jv-bodega .jv-bodega-menu-card:hover{transform:translateY(-3px)!important;border-color:#d6a7ff!important;box-shadow:0 14px 30px rgba(67,17,103,.29)!important}
.jv-vendedor .jv-card{background:linear-gradient(145deg,#fff,#f4eafa)!important;border:1px solid #dfc9ef!important}
.jv-unified :is(button,a):focus-visible{outline:3px solid #bf80ff!important;outline-offset:3px}
@media(max-width:650px){
 .jv-bodega .jv-bodega-menu-card{padding:9px 5px!important;min-height:94px!important;border-radius:13px!important}
 .jv-bodega .jv-bodega-menu-card h3{font-size:10px!important;overflow-wrap:anywhere!important;line-height:1.2!important}
 .jv-bodega .jv-bodega-menu-card>div,.jv-bodega .jv-bodega-menu-card strong{display:none!important}
 .jv-bodega .jv-bodega-menu-card>span:first-child{width:34px!important;height:34px!important;margin-bottom:6px!important}
 .jv-unified .jv-global-header{padding:10px 12px!important}
}
@media(prefers-reduced-motion:reduce){.jv-unified :is(button,a,.jv-card,.jv-next-card){transition:none!important;transform:none!important}}

/* JAIVISA NEXT · Bodega futurista V2: apariencia visual, sin modificar permisos ni consultas */
.jv-future-bodega{background:radial-gradient(ellipse at 5% 0%,#552090 0%,transparent 48%),linear-gradient(150deg,#160922,#281043 55%,#190a2c)!important;color:#f7eaff!important}
.jv-future-bodega>div{max-width:1400px!important}
.jv-future-header{display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap;padding:13px 22px!important;border:1px solid #b35df255;border-radius:18px 18px 0 0!important;background:linear-gradient(105deg,#1b092c,#371051 70%,#4e1972)!important;color:#fff;box-shadow:0 10px 28px #09021355}
.jv-future-brand{display:flex;align-items:center;gap:20px}.jv-future-brand img{width:160px;height:64px;object-fit:contain;filter:drop-shadow(0 0 9px #a43fff88)}.jv-future-brand strong{display:block;font-size:21px;letter-spacing:.4px}.jv-future-brand small{display:block;font-size:12px;color:#e3c9ff;margin-top:3px}
.jv-future-actions{display:flex;align-items:center;gap:10px}.jv-future-actions button{position:relative;display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:10px 17px;background:#57217a;color:#fff;border:1px solid #bc7ce9;border-radius:12px;font-weight:800;cursor:pointer}.jv-future-actions button:hover{background:#7834a5}.jv-future-bubble{position:absolute;right:-7px;top:-8px;border-radius:100px;background:#ef3f7e;color:#fff;font-size:11px;padding:3px 7px}
.jv-future-hero{position:relative;display:flex;align-items:center;justify-content:center;min-height:270px;overflow:hidden;border:1px solid #9e49d17a;border-top:0;border-radius:0 0 22px 22px;background:radial-gradient(circle at 30% 60%,#7520bb77,transparent 45%),linear-gradient(120deg,#200b39,#40106b 68%,#221039);box-shadow:inset 0 -3px #b340f8,0 16px 30px #0b061a66}
.jv-future-hero:after{content:'';position:absolute;bottom:4px;left:7%;width:85%;height:2px;background:linear-gradient(90deg,transparent,#dc65ff,#4aafff,transparent);box-shadow:0 0 14px #ae43ff}
.jv-future-isa{position:absolute;z-index:1;bottom:0;left:0;width:26%;height:100%;object-fit:cover;object-position:35% center;mask-image:linear-gradient(to right,#000 78%,transparent 100%)}
.jv-future-warehouse{position:absolute;inset:0 0 0 auto;width:31%;background:linear-gradient(90deg,#321050 0%,transparent 42%),url('/jaivisa-bodega-hero.png') center/cover no-repeat;opacity:.85;mask-image:linear-gradient(to right,transparent,#000 32%)}
.jv-future-hero-copy{position:relative;z-index:2;width:62%;padding:26px 22px;text-align:center;text-shadow:0 2px 12px #1a052a}.jv-future-eyebrow{font-size:11px;letter-spacing:2px;color:#e2b8ff;font-weight:900}.jv-future-hero h1{font-size:clamp(24px,3.6vw,44px);margin:9px 0;color:white}.jv-future-hero h2{font-size:clamp(15px,2.1vw,24px);margin:8px 0;color:#fff}.jv-future-hero p{font-size:clamp(12px,1.4vw,16px);line-height:1.55;color:#f1e3ff;margin:10px auto;max-width:560px}.jv-future-hero-hint{font-size:12px!important;color:#d6a9ff!important}
.jv-future-stats{margin-top:18px!important;grid-template-columns:repeat(3,minmax(0,1fr))!important}.jv-future-stat{min-width:0!important;background:linear-gradient(125deg,#512078,#28104e 75%)!important;color:#fff!important;border:1px solid #bd6df4!important;border-radius:19px!important;box-shadow:inset 0 -2px #bc50fa,0 10px 25px #08041577!important;transition:transform .18s,box-shadow .18s}.jv-future-stat strong{color:#fff!important}.jv-future-stat p{color:#e8cafa!important}.jv-future-stat span{color:#d9a6ff!important}.jv-future-stat:hover{transform:translateY(-3px);box-shadow:0 10px 30px #bd4dff66!important}
.jv-future-bodega .jv-bodega-menu-grid{grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:14px!important}.jv-future-bodega .jv-bodega-menu-card{background:linear-gradient(140deg,#4b1774,#2d1054)!important;border-color:#b960f4!important;min-height:128px!important;border-radius:20px!important;box-shadow:inset 0 -2px #963cdb,0 8px 24px #0b041a77!important}.jv-future-bodega .jv-bodega-menu-card h3{font-size:18px!important}.jv-future-bodega .jv-bodega-menu-card>span{color:#f3ccff!important}
.jv-future-activity{width:100%;display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:20px;padding:17px 23px;border:1px solid #ae6cf3;border-radius:18px;background:linear-gradient(110deg,#51227f,#271044);color:#fff;cursor:pointer;text-align:left}.jv-future-activity>span{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.jv-future-activity strong{font-size:18px}.jv-future-activity small{color:#dec6f5}.jv-future-activity b{white-space:nowrap;border:1px solid #bb80ee;border-radius:10px;padding:9px}
.jv-future-bodega>div>section:not(.jv-future-hero){color:#341346}
@media(max-width:680px){.jv-future-header{padding:8px 10px!important;flex-wrap:nowrap!important}.jv-future-brand{gap:7px}.jv-future-brand img{width:70px!important;height:45px!important}.jv-future-brand strong{font-size:12px}.jv-future-brand small{font-size:9px}.jv-future-actions{gap:5px}.jv-future-actions button{padding:7px!important;min-height:39px!important;font-size:11px}.jv-future-hero{min-height:174px}.jv-future-isa{width:29%;object-position:38% center}.jv-future-warehouse{width:24%}.jv-future-hero-copy{width:74%;margin-left:12%;padding:13px 2px}.jv-future-eyebrow{font-size:8px;letter-spacing:.7px}.jv-future-hero h1{font-size:clamp(17px,5vw,23px);margin:4px 0}.jv-future-hero h2{font-size:12px;margin:5px 0}.jv-future-hero p{font-size:10px;line-height:1.35;margin:5px auto}.jv-future-hero-hint{display:none}.jv-future-stats{gap:6px!important}.jv-future-stat{padding:9px 4px!important;border-radius:12px!important}.jv-future-stat strong{font-size:17px!important}.jv-future-stat p{font-size:9px!important;margin:4px 0!important}.jv-future-stat svg{width:20px!important}.jv-future-bodega .jv-bodega-menu-grid{grid-template-columns:repeat(4,minmax(0,1fr))!important;gap:6px!important}.jv-future-bodega .jv-bodega-menu-card{min-height:80px!important;padding:9px 3px!important;border-radius:12px!important}.jv-future-bodega .jv-bodega-menu-card h3{font-size:10px!important}.jv-future-activity{padding:12px;flex-wrap:wrap}.jv-future-activity strong{font-size:14px}.jv-future-activity small{font-size:10px}}
@media(prefers-reduced-motion:reduce){.jv-future-bodega *{transition:none!important}}

`;
function MarcoJAIVISANext({ rol, nombre, salir, children }: { rol: string; nombre?: string; salir?: () => Promise<void>; children: React.ReactNode }) {
  return <div className={'jv-unified jv-' + (rol === 'Administración' ? 'administracion' : 'clientes')}>
    <header className="jv-global-header">
      <div className="jv-global-brand"><img src={JAIVISA_LOGO} alt="JAIVISA" /><div><small>JAIVISA NEXT · PORTAL MAYORISTA</small><strong>{rol}</strong></div></div>
      <div className="jv-global-meta">{nombre && <span className="jv-global-chip">{nombre}</span>}{salir && <button className="jv-global-exit" onClick={() => void salir()}>Cerrar sesión</button>}</div>
    </header>
    {children}
  </div>;
}

function App() {
  const [estado, setEstado] = useState<'cargando' | 'ingreso' | 'administrador' | 'cliente' | 'equipo' | 'pendiente' | 'sin_permiso' | 'cambiar_clave'>('cargando');
  const [vista, setVista] = useState<'ingreso' | 'registro' | 'recuperar'>('ingreso');
  const [perfil, setPerfil] = useState<PerfilAcceso | null>(null);
  const [correo, setCorreo] = useState('');
  const [clave, setClave] = useState('');
  const [nuevaClave, setNuevaClave] = useState('');
  const [mensaje, setMensaje] = useState('');
  const [procesando, setProcesando] = useState(false);
  const [departamentoRegistro, setDepartamentoRegistro] = useState('');
  const [registro, setRegistro] = useState({ nombre: '', documento: '', pais: 'Colombia', indicativo: '+57', telefono: '', ciudad: '', direccion: '', correo: '', clave: '', confirmar: '' });
  useEffect(() => {
    let activo = true;
    const verificar = async () => {
      const { data: { user }, error } = await supabase.auth.getUser();
      if (!activo) return;
      if (error || !user) { setPerfil(null); setEstado('ingreso'); return; }
      const { data, error: errorPerfil } = await supabase.from('perfiles').select('id,rol,aprobado,nombre,documento,telefono,ciudad,direccion,correo').eq('id', user.id).maybeSingle();
      if (!activo) return;
      if (errorPerfil) { setMensaje('No se pudieron verificar tus permisos. Comprueba la configuración SQL.'); setEstado('sin_permiso'); return; }
      if (!data) { setMensaje('Tu cuenta aún no tiene perfil. Contacta a JAIVISA.'); setEstado('sin_permiso'); return; }
      const p = data as PerfilAcceso; setPerfil(p);
      if (!p.aprobado) { setEstado('pendiente'); return; }
      setEstado(p.rol === 'administrador' ? 'administrador' : p.rol === 'cliente' ? 'cliente' : p.rol === 'vendedor' || p.rol === 'bodega' ? 'equipo' : 'sin_permiso');
    };
    void verificar();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((evento) => { if (!activo) return; if (evento === 'PASSWORD_RECOVERY') { setEstado('cambiar_clave'); return; } setTimeout(() => { if (activo) void verificar(); }, 0); });
    return () => { activo = false; subscription.unsubscribe() };
  }, []);
  const salir = async () => { await supabase.auth.signOut(); setEstado('ingreso'); setVista('ingreso'); setMensaje(''); setClave(''); };
  const entrar = async (e: React.FormEvent) => { e.preventDefault(); setProcesando(true); setMensaje(''); const { error } = await supabase.auth.signInWithPassword({ email: correo.trim(), password: clave }); setClave(''); setProcesando(false); if (error) setMensaje('No se pudo iniciar sesión. Comprueba tu correo, contraseña y confirmación de cuenta.'); };
  const registrar = async (e: React.FormEvent) => {    
e.preventDefault(); setMensaje(''); if (!registro.ciudad.trim() || registro.ciudad === '__otra__') { setMensaje('Selecciona o escribe una ciudad válida.'); return; } if (registro.clave.length < 8) { setMensaje('La contraseña debe tener al menos 8 caracteres.'); return; } if (registro.clave !== registro.confirmar) { setMensaje('Las contraseñas no coinciden.'); return; } setProcesando(true);
    const { data, error } = await supabase.auth.signUp({ email: registro.correo.trim().toLowerCase(), password: registro.clave, options: { data: { nombre: registro.nombre.trim(), documento: registro.documento.trim(), telefono: (registro.indicativo + ' ' + registro.telefono.trim()), pais: registro.pais, indicativo: registro.indicativo, departamento: departamentoRegistro, ciudad: registro.ciudad.trim(), direccion: registro.direccion.trim() } } }); setProcesando(false);
    if (error) { setMensaje('No fue posible crear la cuenta: ' + error.message); return; }
    setRegistro({ nombre: '', documento: '', pais: 'Colombia', indicativo: '+57', telefono: '', ciudad: '', direccion: '', correo: '', clave: '', confirmar: '' }); setVista('ingreso'); setMensaje(data.session ? '¡Bienvenido a JAIVISA! Tu cuenta está lista. Estamos abriendo tus catálogos.' : '¡Bienvenido a JAIVISA! Tu cuenta fue creada. Revisa tu correo y confirma tu dirección si recibes un enlace; después podrás iniciar sesión y ver nuestros catálogos.');
    if (data.session) { setEstado('cargando'); }
  };
  const cambiarClave = async (e: React.FormEvent) => { e.preventDefault(); if (nuevaClave.length < 8) { setMensaje('Usa al menos 8 caracteres.'); return; } setProcesando(true); const { error } = await supabase.auth.updateUser({ password: nuevaClave }); setProcesando(false); setNuevaClave(''); if (error) { setMensaje('No se pudo actualizar la contraseña: ' + error.message); return; } setMensaje('Contraseña actualizada.'); await salir(); setMensaje('Contraseña actualizada. Ya puedes iniciar sesión.'); };
  const recuperar = async (e: React.FormEvent) => { e.preventDefault(); setProcesando(true); setMensaje(''); const { error } = await supabase.auth.resetPasswordForEmail(correo.trim(), { redirectTo: window.location.origin }); setProcesando(false); setMensaje(error ? 'No se pudo enviar el enlace. Comprueba la configuración de correo de JAIVISA.' : 'Si el correo está registrado, recibirás instrucciones para recuperar la contraseña.'); };
  if (estado === 'administrador') return <MarcoJAIVISANext rol="Administración" nombre={perfil?.nombre ?? 'Usuario'} salir={salir}><PortalAdministrador /></MarcoJAIVISANext>;
  if (estado === 'cliente' && perfil) return <MarcoJAIVISANext rol="Clientes mayoristas" nombre={perfil.nombre ?? 'Usuario'}><ClientesMayoristas perfil={perfil} salir={salir} /></MarcoJAIVISANext>;
  if (estado === 'equipo' && perfil?.rol === 'vendedor') return <PanelVendedor perfil={perfil} salir={salir} />;
  if (estado === 'equipo' && perfil?.rol === 'bodega') return <PanelBodega perfil={perfil} salir={salir} />;
  return <div className="jaivisa-login-fondo" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'radial-gradient(ellipse at 12% 18%,#52258c 0%,transparent 45%),radial-gradient(ellipse at 92% 85%,#203f99 0%,transparent 40%),linear-gradient(135deg,#1b0d29,#4c1d69)', padding: 24, fontFamily: 'Inter,system-ui,sans-serif', position: 'relative', overflow: 'hidden' }}><style>{`
    .jaivisa-login-fondo::before,.jaivisa-login-fondo::after{content:'';position:absolute;pointer-events:none;width:85vw;height:40vw;max-height:420px;border-radius:50%;border-top:3px solid #cb42ff;border-bottom:2px solid #35adff;transform:rotate(-23deg);filter:drop-shadow(0 0 12px #b83bff);opacity:.75}
    .jaivisa-login-fondo::before{left:-38vw;top:-12vw}
    .jaivisa-login-fondo::after{right:-38vw;bottom:-13vw;transform:rotate(-24deg)}
    .jaivisa-login-tarjeta{position:relative;z-index:1;text-align:center;border:1px solid #dfc7f7;box-shadow:0 24px 75px #12071e66,0 0 15px #d94cff,0 0 65px #b178e899!important;animation:jaivisa-brillo 5s ease-in-out infinite alternate}
    @keyframes jaivisa-brillo{from{box-shadow:0 24px 75px #12071e66,0 0 12px #b73bff,0 0 50px #b178e866}to{box-shadow:0 24px 75px #12071e66,0 0 24px #c33cff,0 0 78px #9131ff88}}
    .jaivisa-login-logo{display:block;width:min(96%,370px);height:160px;object-fit:contain;margin:0 auto 4px;filter:drop-shadow(0 5px 8px #32124922)}
    @media(max-width:520px){.jaivisa-login-tarjeta{padding:24px 18px!important}.jaivisa-login-logo{height:125px}}
    @media(prefers-reduced-motion:reduce){.jaivisa-login-tarjeta{animation:none}}
  `}</style><div className="jaivisa-login-tarjeta" style={{ background: '#fff', borderRadius: 24, padding: '30px 28px', width: '100%', maxWidth: 525, boxSizing: 'border-box' }}>
      <img className="jaivisa-login-logo" src={JAIVISA_LOGO} alt="Logo original de JAIVISA" /><div style={{ fontSize: 12, letterSpacing: 2.5, fontWeight: 800, color: '#8750aa' }}>JAIVISA · PORTAL MAYORISTA</div>
      <h1 style={{ color: '#30123f', fontSize: 29, margin: '13px 0 8px' }}>{estado === 'cargando' ? 'Verificando acceso…' : estado === 'cambiar_clave' ? 'Crea una nueva contraseña' : estado === 'pendiente' ? 'Cuenta en preparación' : estado === 'equipo' ? 'Acceso de empleados' : estado === 'sin_permiso' ? 'Acceso restringido' : vista === 'registro' ? 'Crea tu cuenta mayorista' : vista === 'recuperar' ? 'Recupera tu contraseña' : '¡Te damos la bienvenida a JAIVISA!'}</h1>
      {estado === 'ingreso' && <>
        <p style={{ color: '#75667f', lineHeight: 1.5, marginTop: 5 }}>{vista === 'registro' ? 'Registra los datos de tu negocio para acceder a nuestros catálogos mayoristas.' : vista === 'recuperar' ? 'Te enviaremos instrucciones a tu correo electrónico.' : 'Tu espacio para comprar, vender y gestionar tus pedidos.'}</p>
        {vista === 'ingreso' && <><form onSubmit={entrar} style={{ display: 'grid', gap: 14, marginTop: 20 }}><label style={etiqueta}>Correo electrónico<input style={campo} type="email" required autoComplete="username" value={correo} onChange={e => setCorreo(e.target.value)} /></label><label style={etiqueta}>Contraseña<input style={campo} type="password" required autoComplete="current-password" value={clave} onChange={e => setClave(e.target.value)} /></label><button style={boton} disabled={procesando}>{procesando ? 'Ingresando…' : 'Iniciar sesión'}</button></form><div style={{ textAlign: 'center', marginTop: 12 }}><button style={enlace} onClick={() => { setVista('recuperar'); setMensaje('') }}>¿Olvidaste tu contraseña?</button></div><div style={{ borderTop: '1px solid #eee4f2', marginTop: 13, paddingTop: 17, textAlign: 'center' }}><div style={{ fontSize: 14, color: '#55415f' }}>¿Aún no tienes una cuenta?</div><button style={{ ...boton, marginTop: 12, width: '100%', background: '#fff', color: '#582075', border: '1px solid #9e76b7' }} onClick={() => { setVista('registro'); setMensaje('') }}>Crear cuenta mayorista</button></div></>}
        {vista === 'registro' && <form onSubmit={registrar} style={{ display: 'grid', gap: 11, marginTop: 16 }}><label style={etiqueta}>Nombre completo o razón social<input style={campo} required maxLength={120} value={registro.nombre} onChange={e => setRegistro({ ...registro, nombre: e.target.value })} /></label><label style={etiqueta}>NIT o cédula<input style={campo} required maxLength={30} value={registro.documento} onChange={e => setRegistro({ ...registro, documento: e.target.value })} /></label><label style={etiqueta}>País de la empresa<select style={campo} value={registro.pais} onChange={e => { const opciones: { [key: string]: string } = { 'Colombia': '+57', 'México': '+52', 'Perú': '+51', 'Ecuador': '+593', 'Estados Unidos': '+1', 'Panamá': '+507', 'Venezuela': '+58', 'Chile': '+56', 'Argentina': '+54', 'España': '+34' }; setRegistro({ ...registro, pais: e.target.value, indicativo: opciones[e.target.value] || '+57', ciudad: '' }); setDepartamentoRegistro(''); }}>{['Colombia', 'México', 'Perú', 'Ecuador', 'Estados Unidos', 'Panamá', 'Venezuela', 'Chile', 'Argentina', 'España'].map(p => <option key={p}>{p}</option>)}</select></label><label style={etiqueta}>Indicativo telefónico<input style={campo} value={registro.indicativo} onChange={e => setRegistro({ ...registro, indicativo: e.target.value })} required maxLength={6} /></label><label style={etiqueta}>Teléfono / WhatsApp<input style={campo} required maxLength={35} value={registro.telefono} onChange={e => setRegistro({ ...registro, telefono: e.target.value })} /></label><div style={{ display: "grid", gap: 11 }}><SelectorUbicacion pais={registro.pais} departamento={departamentoRegistro} ciudad={registro.ciudad} onDepartamento={setDepartamentoRegistro} onCiudad={v => setRegistro(old => ({ ...old, ciudad: v }))} estilo={{ ...etiqueta } as React.CSSProperties} /></div><label style={etiqueta}>Dirección comercial<input style={campo} required maxLength={200} value={registro.direccion} onChange={e => setRegistro({ ...registro, direccion: e.target.value })} /></label><label style={etiqueta}>Correo electrónico<input style={campo} type="email" required value={registro.correo} onChange={e => setRegistro({ ...registro, correo: e.target.value })} /></label><label style={etiqueta}>Contraseña (mínimo 8 caracteres)<input style={campo} type="password" required minLength={8} autoComplete="new-password" value={registro.clave} onChange={e => setRegistro({ ...registro, clave: e.target.value })} /></label><label style={etiqueta}>Confirmar contraseña<input style={campo} type="password" required minLength={8} autoComplete="new-password" value={registro.confirmar} onChange={e => setRegistro({ ...registro, confirmar: e.target.value })} /></label><button style={boton} disabled={procesando}>{procesando ? 'Enviando…' : 'Solicitar cuenta mayorista'}</button></form>}
        {vista === 'recuperar' && <form onSubmit={recuperar} style={{ display: 'grid', gap: 14, marginTop: 20 }}><label style={etiqueta}>Correo electrónico<input style={campo} type="email" required value={correo} onChange={e => setCorreo(e.target.value)} /></label><button style={boton} disabled={procesando}>{procesando ? 'Enviando…' : 'Enviar enlace de recuperación'}</button></form>}
        {vista !== 'ingreso' && <button style={{ ...enlace, marginTop: 14 }} onClick={() => { setVista('ingreso'); setMensaje('') }}>← Volver a iniciar sesión</button>}
      </>}
      {estado === 'cambiar_clave' && <form onSubmit={cambiarClave} style={{ display: 'grid', gap: 12 }}><p style={{ color: '#75667f' }}>Escribe tu nueva contraseña para recuperar el acceso.</p><label style={etiqueta}>Nueva contraseña<input style={campo} type="password" required minLength={8} autoComplete="new-password" value={nuevaClave} onChange={e => setNuevaClave(e.target.value)} /></label><button style={boton} disabled={procesando}>Guardar nueva contraseña</button></form>}
      {estado === 'pendiente' && <><p style={{ color: '#75667f', lineHeight: 1.6 }}>Estamos preparando tu acceso. Si acabas de registrarte, espera unos segundos y vuelve a iniciar sesión. Si el problema continúa, contacta a JAIVISA.</p><button style={boton} onClick={salir}>Cerrar sesión</button></>}
      {estado === 'equipo' && <><p style={{ color: '#75667f', lineHeight: 1.6 }}>Tu cuenta de empleado está activa. El módulo específico para tu cargo todavía está en preparación; no se mostrarán herramientas administrativas.</p><button style={boton} onClick={salir}>Cerrar sesión</button></>}
      {estado === 'sin_permiso' && <><p style={{ color: '#75667f', lineHeight: 1.6 }}>No se pudo autorizar esta cuenta. Comunícate con la administración de JAIVISA.</p><button style={boton} onClick={salir}>Salir y usar otra cuenta</button></>}
      {estado === 'cargando' && <p style={{ color: '#75667f' }}>Comprobando tu sesión y permisos…</p>}
      {mensaje && <p role="status" style={{ color: mensaje.includes('No ') || mensaje.includes('contraseña') ? '#a3294b' : '#326044', fontSize: 13, lineHeight: 1.5 }}>{mensaje}</p>}
      <p style={{ fontSize: 12, color: '#95879e', marginTop: 22 }}>Tu información, protegida en JAIVISA.</p>
    </div></div>;
}

// Muestra errores inesperados en lugar de dejar una pantalla blanca.
class JaivisaErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: string | null }
> {
  state = { error: null as string | null };
  static getDerivedStateFromError(error: Error) {
    return { error: error.message || 'Error desconocido' };
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('JAIVISA: error de interfaz', error, info);
  }
  render() {
    if (this.state.error) return (
      <div style={{ minHeight: '100vh', padding: 32, background: '#f5effa', color: '#3e185b', fontFamily: 'Arial,sans-serif' }}>
        <div style={{ maxWidth: 650, margin: '10vh auto', padding: 30, background: '#fff', borderRadius: 20 }}>
          <h1>JAIVISA · No se pudo cargar la interfaz</h1>
          <p>La aplicación encontró un error. No se ha realizado ningún cambio en la información de JAIVISA.</p>
          <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', background: '#f7f1fa', padding: 14, borderRadius: 10 }}>{this.state.error}</pre>
          <button onClick={() => window.location.reload()} style={{ background: '#592478', color: 'white', padding: '12px 20px', border: 0, borderRadius: 10, cursor: 'pointer' }}>Reintentar</button>
        </div>
      </div>
    );
    return this.props.children;
  }
}

const JaivisaApp = App;
export { JaivisaErrorBoundary, JaivisaApp };

/**
 * Cierre por inactividad para todos los portales (clientes, vendedores, bodega y administración).
 * Advertencia a los 59 minutos; cierre de sesión en Supabase a los 60.
 * La protección definitiva de datos depende también de las políticas RLS de Supabase.
 */
function SesionConInactividad({ children }: { children: React.ReactNode }) {
  const LIMITE_MS = 60 * 60_000;
  const AVISO_MS = 59 * 60_000;
  const CLAVE_ACTIVIDAD = 'jaivisa_ultima_actividad_v1';
  const [autenticado, setAutenticado] = useState(false);
  const [advertencia, setAdvertencia] = useState(false);
  const [errorCierre, setErrorCierre] = useState('');
  const ultimaActividad = React.useRef(Date.now());
  const cerrando = React.useRef(false);
  const autenticadoRef = React.useRef(false);
  const ultimaEscritura = React.useRef(0);

  const cerrarSesion = useCallback(async () => {
    if (cerrando.current) return;
    cerrando.current = true;
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      autenticadoRef.current = false;
      setAutenticado(false);
      setAdvertencia(false);
      setErrorCierre('');
      try { localStorage.removeItem(CLAVE_ACTIVIDAD); } catch { /* Almacenamiento no disponible */ }
    } catch {
      setErrorCierre('No se pudo cerrar la sesión. Comprueba la conexión e inténtalo nuevamente.');
      setAdvertencia(true);
    } finally {
      cerrando.current = false;
    }
  }, []);

  useEffect(() => {
    let montado = true;
    const actualizar = (activo: boolean) => {
      if (!montado) return;
      autenticadoRef.current = activo;
      setAutenticado(activo);
      if (activo) {
        let guardada = 0;
        try { guardada = Number(localStorage.getItem(CLAVE_ACTIVIDAD)) || 0; } catch { /* Sin almacenamiento */ }
        ultimaActividad.current = guardada > 0 && guardada <= Date.now() ? guardada : Date.now();
      } else {
        setAdvertencia(false);
        setErrorCierre('');
      }
    };
    void supabase.auth.getSession().then(({ data }) => actualizar(!!data.session));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((evento, sesion) => {
      if (evento === 'SIGNED_IN' || evento === 'SIGNED_OUT') actualizar(!!sesion);
    });
    return () => { montado = false; subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!autenticado) return;
    const comprobar = () => {
      if (!autenticadoRef.current || cerrando.current) return;
      const transcurrido = Date.now() - ultimaActividad.current;
      if (transcurrido >= LIMITE_MS) { void cerrarSesion(); return; }
      setAdvertencia(transcurrido >= AVISO_MS);
    };
    const registrarActividad = () => {
      if (!autenticadoRef.current || cerrando.current) return;
      const ahora = Date.now();
      // Si el equipo despertó tras una suspensión, no renovar una sesión ya vencida.
      if (ahora - ultimaActividad.current >= LIMITE_MS) { void cerrarSesion(); return; }
      ultimaActividad.current = ahora;
      setAdvertencia(false);
      setErrorCierre('');
      if (ahora - ultimaEscritura.current > 5000) {
        ultimaEscritura.current = ahora;
        try { localStorage.setItem(CLAVE_ACTIVIDAD, String(ahora)); } catch { /* Sin almacenamiento */ }
      }
    };
    const sincronizarPestanas = (evento: StorageEvent) => {
      if (evento.key !== CLAVE_ACTIVIDAD) return;
      const tiempo = Number(evento.newValue);
      if (Number.isFinite(tiempo) && tiempo > ultimaActividad.current && tiempo <= Date.now()) {
        ultimaActividad.current = tiempo;
        comprobar();
      }
    };
    const alVolver = () => comprobar();
    const eventos = ['pointerdown', 'keydown', 'touchstart', 'scroll'] as const;
    eventos.forEach(evento => window.addEventListener(evento, registrarActividad, { passive: true }));
    window.addEventListener('storage', sincronizarPestanas);
    window.addEventListener('focus', alVolver);
    document.addEventListener('visibilitychange', alVolver);
    const intervalo = window.setInterval(comprobar, 5000);
    comprobar();
    return () => {
      window.clearInterval(intervalo);
      eventos.forEach(evento => window.removeEventListener(evento, registrarActividad));
      window.removeEventListener('storage', sincronizarPestanas);
      window.removeEventListener('focus', alVolver);
      document.removeEventListener('visibilitychange', alVolver);
    };
  }, [autenticado, cerrarSesion]);

  return <>
    {children}
    {autenticado && (advertencia || errorCierre) && <div role="alertdialog" aria-modal="true" aria-label="Aviso de cierre de sesión" style={{ position: 'fixed', inset: 0, zIndex: 2147483640, background: '#17082199', display: 'grid', placeItems: 'center', padding: 16 }}>
      <div style={{ width: '100%', maxWidth: 420, background: '#fff', color: '#321343', borderRadius: 20, padding: 24, boxSizing: 'border-box', boxShadow: '0 18px 65px #17082177', fontFamily: 'system-ui,sans-serif' }}>
        <h2 style={{ fontSize: 22, marginTop: 0 }}>JAIVISA · Seguridad de sesión</h2>
        <p>{errorCierre || 'Tu sesión se cerrará en aproximadamente un minuto por inactividad. Guarda tus cambios pendientes antes de continuar.'}</p>
        {!errorCierre && <button type="button" onClick={() => {
          const ahora = Date.now();
          ultimaActividad.current = ahora;
          ultimaEscritura.current = ahora;
          try { localStorage.setItem(CLAVE_ACTIVIDAD, String(ahora)); } catch { /* Sin almacenamiento */ }
          setAdvertencia(false);
        }} style={{ border: 0, borderRadius: 10, background: '#572080', color: '#fff', padding: '12px 18px', cursor: 'pointer', fontWeight: 700 }}>Continuar trabajando</button>}
        {errorCierre && <button type="button" onClick={() => void cerrarSesion()} style={{ border: '1px solid #572080', borderRadius: 10, background: '#572080', color: '#fff', padding: '12px 18px', cursor: 'pointer' }}>Reintentar cierre</button>}
      </div>
    </div>}
  </>;
}

export default function AppProtegida() {
  return <JaivisaErrorBoundary>
    <SesionConInactividad>
      <IsaAsistente />
      <style>{JAIVISA_SHARED_CSS}</style>
      <JaivisaApp />
    </SesionConInactividad>
  </JaivisaErrorBoundary>;
}
