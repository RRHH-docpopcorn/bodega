// Test de la edición de un conteo guardado (migración 202 de docpop-control)
// sobre las páginas REALES de la app Bodega (Plaza Oeste y Pajaritos),
// ejecutadas en jsdom con el backend Supabase simulado.
//
// Ejecutar:  node --test tests/correccion_conteo.test.mjs
// Requiere jsdom; por defecto se toma del frontend de docpop-control
// (JSDOM_PATH=<ruta a node_modules/jsdom> para usar otro).
//
// El backend real (versión anterior ANULADA + nueva APROBADA, sin pérdida ni
// duplicación, solo el día para la app) se prueba en docpop-control:
// database/migrations/tests/202_correccion_conteo_operativo.test.sql.

import { after, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const aqui = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { JSDOM } = require(process.env.JSDOM_PATH || "C:/Users/sindy/Documents/docpop-pre0/frontend/node_modules/jsdom");

const PAGINAS = [
  { archivo: "bodega-plaza-oeste.html", local: "Plaza Oeste", responsable: "Neyrut Rincón", codigo: "MPO" },
  { archivo: "bodega-pajaritos.html", local: "Pajaritos", responsable: "Aidely Guzmán", codigo: "PAJ" },
];
// "Hoy" con la misma regla que la app y el backend: fecha operacional en Chile.
const HOY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const HISTORICO = "2026-09-28";

// Capturas guardadas del conteo aprobado (insumo, unidad de captura)
const CAPTURAS = [
  { insumo_id: "kk", cantidad: 6 },
  { insumo_id: "azucar-saco", cantidad: 2 },
  { insumo_id: "azucar-manga", cantidad: 1 },
  { insumo_id: "balde", cantidad: 130 },
];

// La página deja timers de sincronización periódica: se cierran todas las ventanas al final.
const ventanas = [];
after(() => ventanas.forEach((w) => w.close()));
const esperar = (ms = 25) => new Promise((r) => setTimeout(r, ms));

/**
 * backend.conteos: conjunto de "UBICACION|fecha" con conteo APROBADO vigente.
 * backend.registrar: respuesta de registrar_conteo_operativo_local.
 * backend.hoy: "hoy" del backend (por defecto, el real de Chile).
 * ahora: instante simulado del reloj del navegador (ISO UTC), opcional.
 */
async function abrir(pagina, backend, ahora = null) {
  const hoyBackend = backend.hoy ?? HOY;
  const html = fs.readFileSync(path.join(aqui, "..", "bodega", pagina.archivo), "utf8");
  const llamadas = [];
  const toasts = [];
  let confirmaciones = 0;
  const conteos = new Set(backend.conteos ?? []);
  const dom = new JSDOM(html, {
    runScripts: "dangerously",
    url: `https://rrhh-docpopcorn.github.io/bodega/bodega/${pagina.archivo}`,
    beforeParse(window) {
      if (ahora) {
        const Real = window.Date;
        const fijo = new Real(ahora).getTime();
        class Simulado extends Real {
          constructor(...args) { if (args.length) super(...args); else super(fijo); }
          static now() { return fijo; }
        }
        window.Date = Simulado;
      }
      window.confirm = () => { confirmaciones++; return true; };
      window.prompt = () => "ingresé mal una cantidad";
      window.alert = () => {};
      window.scrollTo = () => {};
      window.fetch = async (url, opciones = {}) => {
        const rpc = /\/rest\/v1\/rpc\/([a-z_]+)/.exec(String(url))?.[1] ?? null;
        const body = opciones.body ? JSON.parse(opciones.body) : null;
        if (rpc) llamadas.push({ rpc, body });
        const ok = (datos) => ({ ok: true, status: 200, headers: { get: () => "application/json" }, json: async () => datos, text: async () => JSON.stringify(datos) });
        const error = (code, message) => ({ ok: false, status: 400, headers: { get: () => "application/json" }, text: async () => JSON.stringify({ code, message }) });
        if (rpc === "capturas_conteo_operativo_vigente") {
          if (!conteos.has(`${body.p_ubicacion}|${body.p_fecha_operacional}`)) return error("23503", "No hay un conteo guardado.");
          return ok(CAPTURAS.map((c) => ({ conteo_id: "conteo-v1", version: 1, ...c })));
        }
        if (rpc === "registrar_conteo_operativo_local") {
          if (backend.registrar.estado_resultado === "CREADO") conteos.add(`${body.p_ubicacion}|${body.p_fecha_operacional}`);
          return ok([backend.registrar]);
        }
        if (rpc === "corregir_conteo_operativo_local") {
          // mismo contrato que el backend 202
          if (body.p_fecha_operacional !== hoyBackend) return error("42501", "Solo se puede corregir el conteo de hoy");
          const enviados = new Set(body.p_lineas.map((l) => l.insumo_id));
          const faltan = CAPTURAS.filter((c) => !enviados.has(c.insumo_id));
          if (faltan.length) return error("23514", `La corrección debe incluir todos los artículos del conteo guardado. Faltan: ${faltan.map((c) => c.insumo_id).join(", ")}.`);
          return ok([{ conteo_id: "conteo-v2", conteo_corregido_id: "conteo-v1", version: 2, n_lineas: 3 }]);
        }
        return ok([]);
      };
    },
  });
  const w = dom.window;
  ventanas.push(w);
  await esperar(30);
  w.toast = (msg, esError) => toasts.push({ msg, esError: Boolean(esError) });
  w.eval(`DB.insumos = [
    { id: 'kk', local: '${pagina.local}', activo: true, categoria: 'Sabores', nombre: 'Klassic Kettle', unidad: 'Bolsa' },
    { id: 'azucar-saco', local: '${pagina.local}', activo: true, categoria: 'Insumos', nombre: 'Azúcar Saco blanco', unidad: 'Saco' },
    { id: 'azucar-manga', local: '${pagina.local}', activo: true, categoria: 'Insumos', nombre: 'Azúcar', unidad: 'Mangas' },
    { id: 'balde', local: '${pagina.local}', activo: true, categoria: 'Packing', nombre: 'Balde 3L', unidad: 'Unidades' },
  ]; DB.inventario = []; DB.inventario_local = [];`);
  const d = w.document;
  // el trabajador elige fecha y local (eventos reales), luego su nombre
  const elegir = async (prefix, fecha) => {
    if (fecha !== null) {
      const f = d.getElementById(`${prefix}-fecha`);
      f.value = fecha;
      f.dispatchEvent(new w.Event("change"));
    }
    const l = d.getElementById(`${prefix}-local`);
    l.value = pagina.local;
    l.dispatchEvent(new w.Event("change"));
    const resp = d.getElementById(`${prefix}-responsable`);
    if (![...resp.options].some((o) => o.value === pagina.responsable)) {
      const op = d.createElement("option");
      op.value = pagina.responsable;
      op.textContent = pagina.responsable;
      resp.appendChild(op);
    }
    resp.value = pagina.responsable;
    await esperar();
  };
  return { w, d, llamadas, toasts, elegir, confirmaciones: () => confirmaciones };
}

const visible = (el) => Boolean(el) && el.style.display !== "none";
const inputs = (d, prefix) => [...d.querySelectorAll(`#${prefix}-conteo-tbody .conteo-input`)];
const valores = (d, prefix) => Object.fromEntries(inputs(d, prefix).map((i) => [i.dataset.id, i.value]));
const input = (d, prefix, id) => inputs(d, prefix).find((i) => i.dataset.id === id);
const sinIntentos = (llamadas) => llamadas.filter((l) => l.rpc !== "registrar_intento_conteo_operativo");

for (const pagina of PAGINAS) {
  test(`${pagina.codigo} 1) existe conteo del día -> "Editar conteo" visible SIN Generar conteo`, async () => {
    const { d, elegir } = await abrir(pagina, { conteos: [`LOCAL|${HOY}`] });
    await elegir("invl", HOY);
    assert.ok(visible(d.getElementById("invl-estado-conteo")));
    assert.ok(visible(d.getElementById("invl-btn-editar")));
    assert.match(d.getElementById("invl-estado-conteo-texto").textContent, /✓ Conteo guardado — \d{2}-\d{2}-\d{4} \(Local\)/);
    assert.equal(d.getElementById("invl-btn-editar").textContent.trim(), "✏️ Editar conteo");
    assert.equal(visible(d.getElementById("invl-btn-generar")), false);
    assert.equal(visible(d.getElementById("invl-conteo-wrap")), false); // sin haber generado nada
  });

  test(`${pagina.codigo} 2) no existe conteo -> flujo normal "Generar conteo"`, async () => {
    const { d, elegir } = await abrir(pagina, { conteos: [] });
    await elegir("inv", HOY);
    assert.equal(visible(d.getElementById("inv-estado-conteo")), false);
    assert.ok(visible(d.getElementById("inv-btn-generar")));
  });

  test(`${pagina.codigo} 3) Local y Bodega se evalúan independientemente (caso MPO 05-10: solo LOCAL guardado)`, async () => {
    const { d, elegir, llamadas } = await abrir(pagina, { conteos: [`LOCAL|${HOY}`] });
    await elegir("inv", HOY);
    await elegir("invl", HOY);
    assert.equal(visible(d.getElementById("inv-estado-conteo")), false);
    assert.ok(visible(d.getElementById("inv-btn-generar")));
    assert.ok(visible(d.getElementById("invl-btn-editar")));
    assert.equal(visible(d.getElementById("invl-btn-generar")), false);
    const ubic = new Set(llamadas.filter((l) => l.rpc === "capturas_conteo_operativo_vigente").map((l) => `${l.body.p_ubicacion}|${l.body.p_local_codigo}`));
    assert.deepEqual(ubic, new Set([`BODEGA|${pagina.codigo}`, `LOCAL|${pagina.codigo}`]));
  });

  test(`${pagina.codigo} 4) Editar -> precarga -> modificar -> guardar envía el conjunto completo a corregir_conteo_operativo_local`, async () => {
    const { w, d, elegir, llamadas, toasts } = await abrir(pagina, { conteos: [`BODEGA|${HOY}`], registrar: {} });
    await elegir("inv", HOY);
    d.getElementById("inv-btn-editar").click();
    await esperar();
    // precarga EXACTA de lo guardado, con la unidad de captura de cada insumo
    assert.deepEqual(valores(d, "inv"), { kk: "6", "azucar-saco": "2", "azucar-manga": "1", balde: "130" });
    const unidad = (id) => input(d, "inv", id).closest("tr").children[2].textContent;
    assert.deepEqual(["kk", "azucar-saco", "azucar-manga", "balde"].map(unidad), ["Bolsa", "Saco", "Mangas", "Unidades"]);
    assert.ok(d.getElementById("inv-aviso-correccion")?.textContent.includes("versión 1"));
    input(d, "inv", "balde").value = "125";
    await w.guardarConteoMasivo("inv", "inventario");
    const corr = llamadas.filter((l) => l.rpc === "corregir_conteo_operativo_local");
    assert.equal(corr.length, 1);
    assert.equal(llamadas.some((l) => l.rpc === "registrar_conteo_operativo_local"), false);
    assert.deepEqual(Object.fromEntries(corr[0].body.p_lineas.map((l) => [l.insumo_id, l.cantidad])), { kk: 6, "azucar-saco": 2, "azucar-manga": 1, balde: 125 });
    assert.equal(corr[0].body.p_lineas.length, 4);
    assert.equal(corr[0].body.p_ubicacion, "BODEGA");
    assert.equal(corr[0].body.p_local_codigo, pagina.codigo);
    assert.ok(corr[0].body.p_motivo.length > 0);
    assert.ok(toasts.some((t) => t.msg.includes("corregido (versión 2)")));
    assert.equal(w.eval("CORRECCION_CONTEO.inv"), undefined);
    // una corrección incompleta se rechaza y las cantidades quedan en pantalla
    d.getElementById("inv-btn-editar").click();
    await esperar();
    input(d, "inv", "azucar-manga").value = "";
    await w.guardarConteoMasivo("inv", "inventario");
    assert.ok(toasts.some((t) => t.esError && t.msg.includes("Faltan: azucar-manga")));
    assert.equal(input(d, "inv", "balde").value, "130");
  });

  test(`${pagina.codigo} 5) conteo histórico: se informa guardado pero NO se ofrece edición al trabajador`, async () => {
    const { w, d, elegir, llamadas, toasts, confirmaciones } = await abrir(pagina, {
      conteos: [`LOCAL|${HISTORICO}`],
      registrar: { conteo_id: "conteo-v1", estado_resultado: "YA_APROBADO", n_lineas: 3, articulos_omitidos: [] },
    });
    await elegir("invl", HISTORICO);
    assert.ok(visible(d.getElementById("invl-estado-conteo")));
    assert.equal(visible(d.getElementById("invl-btn-editar")), false);
    assert.match(d.getElementById("invl-estado-conteo-nota").textContent, /administrador/);
    assert.equal(visible(d.getElementById("invl-btn-generar")), false);
    // ni por el botón ni al reguardar
    await w.corregirConteoGuardado("invl", "inventario_local");
    w.generarConteoInventario("invl");
    input(d, "invl", "kk").value = "9";
    await w.guardarConteoMasivo("invl", "inventario_local");
    assert.equal(confirmaciones(), 0);
    assert.equal(llamadas.some((l) => l.rpc === "corregir_conteo_operativo_local"), false);
    assert.ok(toasts.some((t) => t.esError && /administrador/.test(t.msg)));
  });

  test(`${pagina.codigo} 6) flujo de conteo NUEVO intacto (Generar -> cantidades -> Guardar -> registrar) y luego ofrece Editar`, async () => {
    const { w, d, elegir, llamadas } = await abrir(pagina, {
      conteos: [],
      registrar: { conteo_id: "nuevo", estado_resultado: "CREADO", n_lineas: 2, articulos_omitidos: [] },
    });
    await elegir("inv", HOY);
    d.getElementById("inv-btn-generar").click();
    assert.deepEqual(Object.values(valores(d, "inv")), ["", "", "", ""]); // nunca precargado
    input(d, "inv", "kk").value = "3";
    input(d, "inv", "balde").value = "10";
    await w.guardarConteoMasivo("inv", "inventario");
    await esperar();
    const rpcs = sinIntentos(llamadas).map((l) => l.rpc).filter((r) => r !== "capturas_conteo_operativo_vigente");
    assert.deepEqual(rpcs, ["registrar_conteo_operativo_local"]);
    const reg = llamadas.find((l) => l.rpc === "registrar_conteo_operativo_local");
    assert.equal(reg.body.p_ubicacion, "BODEGA");
    assert.deepEqual(Object.fromEntries(reg.body.p_lineas.map((l) => [l.insumo_id, l.cantidad])), { kk: 3, balde: 10 });
    // recién guardado -> ahora se ofrece editarlo
    assert.ok(visible(d.getElementById("inv-btn-editar")));
    assert.equal(visible(d.getElementById("inv-btn-generar")), false);
  });

  // ===== Fecha operacional en Chile (America/Santiago), nunca UTC =====
  // Octubre 2026: Chile en horario de verano (UTC-3).
  const NOCHE_0510 = "2026-10-06T02:30:00Z"; // 05-10 23:30 en Chile (ya es 06-10 en UTC)
  const MADRUGADA_0610 = "2026-10-06T03:01:00Z"; // 06-10 00:01 en Chile

  test(`${pagina.codigo} 7) 23:30 Chile: fecha por defecto y "hoy" = 05-10; el conteo del día se puede editar y viaja con 05-10`, async () => {
    const { w, d, elegir, llamadas } = await abrir(pagina, { conteos: ["LOCAL|2026-10-05"], hoy: "2026-10-05" }, NOCHE_0510);
    assert.equal(w.eval("fechaHoyChile()"), "2026-10-05");
    assert.equal(d.getElementById("inv-fecha").value, "2026-10-05"); // antes (UTC): 2026-10-06
    await elegir("invl", "2026-10-05");
    assert.ok(visible(d.getElementById("invl-btn-editar")));
    d.getElementById("invl-btn-editar").click();
    await esperar();
    input(d, "invl", "kk").value = "5";
    await w.guardarConteoMasivo("invl", "inventario_local");
    const corr = llamadas.find((l) => l.rpc === "corregir_conteo_operativo_local");
    assert.equal(corr.body.p_fecha_operacional, "2026-10-05");
    assert.equal(corr.body.p_ubicacion, "LOCAL");
  });

  test(`${pagina.codigo} 8) 00:01 Chile del 06-10: fecha por defecto 06-10; el conteo del 05-10 pasa a histórico (sin Editar) y Bodega 06-10 ofrece Generar`, async () => {
    const { w, d, elegir } = await abrir(pagina, { conteos: ["LOCAL|2026-10-05"], hoy: "2026-10-06" }, MADRUGADA_0610);
    assert.equal(w.eval("fechaHoyChile()"), "2026-10-06");
    assert.equal(d.getElementById("inv-fecha").value, "2026-10-06");
    await elegir("invl", "2026-10-05");
    assert.match(d.getElementById("invl-estado-conteo-texto").textContent, /✓ Conteo guardado — 05-10-2026 \(Local\)/);
    assert.equal(visible(d.getElementById("invl-btn-editar")), false);
    assert.match(d.getElementById("invl-estado-conteo-nota").textContent, /administrador/);
    assert.equal(visible(d.getElementById("invl-btn-generar")), false);
    await elegir("inv", "2026-10-06");
    assert.equal(visible(d.getElementById("inv-estado-conteo")), false);
    assert.ok(visible(d.getElementById("inv-btn-generar")));
  });

  test(`${pagina.codigo} 9) conteo nuevo a las 23:30 Chile con la fecha por defecto se registra con el día de Chile (05-10)`, async () => {
    const { w, d, elegir, llamadas } = await abrir(pagina, {
      conteos: [], hoy: "2026-10-05",
      registrar: { conteo_id: "nuevo", estado_resultado: "CREADO", n_lineas: 1, articulos_omitidos: [] },
    }, NOCHE_0510);
    await elegir("inv", null); // sin tocar la fecha propuesta
    d.getElementById("inv-btn-generar").click();
    input(d, "inv", "balde").value = "7";
    await w.guardarConteoMasivo("inv", "inventario");
    const reg = llamadas.find((l) => l.rpc === "registrar_conteo_operativo_local");
    assert.equal(reg.body.p_fecha_operacional, "2026-10-05");
    const consultas = llamadas.filter((l) => l.rpc === "capturas_conteo_operativo_vigente").map((l) => l.body.p_fecha_operacional);
    assert.ok(consultas.length > 0 && consultas.every((f) => f === "2026-10-05"));
  });
}
