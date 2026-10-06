// Test de la corrección de un conteo guardado (migración 202 de docpop-control)
// sobre las páginas REALES de la app Bodega (Plaza Oeste y Pajaritos),
// ejecutadas en jsdom con el backend Supabase simulado.
//
// Ejecutar:  node --test tests/correccion_conteo.test.mjs
// Requiere jsdom; por defecto se toma del frontend de docpop-control
// (JSDOM_PATH=<ruta a node_modules/jsdom> para usar otro).
//
// El backend real (versión anterior ANULADA + nueva APROBADA, sin pérdida ni
// duplicación) se prueba en docpop-control:
// database/migrations/tests/202_correccion_conteo_operativo.test.sql (CASO 8),
// con el mismo contrato de datos que aquí se verifica del lado de la app.

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
const FECHA = "2026-10-05";

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

async function abrir(pagina, backend) {
  const html = fs.readFileSync(path.join(aqui, "..", "bodega", pagina.archivo), "utf8");
  const llamadas = [];
  const toasts = [];
  const dom = new JSDOM(html, {
    runScripts: "dangerously",
    url: `https://rrhh-docpopcorn.github.io/bodega/${pagina.archivo}`,
    beforeParse(window) {
      window.confirm = () => backend.confirmar ?? true;
      window.prompt = () => backend.motivo ?? "ingresé las cantidades del Local en Bodega";
      window.alert = () => {};
      window.scrollTo = () => {};
      window.fetch = async (url, opciones = {}) => {
        const u = String(url);
        const rpc = /\/rest\/v1\/rpc\/([a-z_]+)/.exec(u)?.[1] ?? null;
        const body = opciones.body ? JSON.parse(opciones.body) : null;
        if (rpc) llamadas.push({ rpc, body });
        const ok = (datos) => ({ ok: true, status: 200, headers: { get: () => "application/json" }, json: async () => datos, text: async () => JSON.stringify(datos) });
        const error = (mensaje) => ({ ok: false, status: 400, headers: { get: () => "application/json" }, text: async () => JSON.stringify({ code: "23514", message: mensaje }) });
        if (rpc === "registrar_conteo_operativo_local") return ok([backend.registrar]);
        if (rpc === "capturas_conteo_operativo_vigente") return ok(CAPTURAS.map((c) => ({ conteo_id: "conteo-v1", version: 1, ...c })));
        if (rpc === "corregir_conteo_operativo_local") {
          // mismo contrato que el backend: debe venir TODO artículo de la versión anterior
          const enviados = new Set(body.p_lineas.map((l) => l.insumo_id));
          const faltan = CAPTURAS.filter((c) => !enviados.has(c.insumo_id));
          if (faltan.length) return error(`La corrección debe incluir todos los artículos del conteo guardado. Faltan: ${faltan.map((c) => c.insumo_id).join(", ")}.`);
          return ok([{ conteo_id: "conteo-v2", conteo_corregido_id: "conteo-v1", version: 2, n_lineas: 3 }]);
        }
        return ok([]);
      };
    },
  });
  const w = dom.window;
  ventanas.push(w);
  await new Promise((r) => setTimeout(r, 30));
  w.toast = (msg, esError) => toasts.push({ msg, esError: Boolean(esError) });
  w.eval(`DB.insumos = [
    { id: 'kk', local: '${pagina.local}', activo: true, categoria: 'Sabores', nombre: 'Klassic Kettle', unidad: 'Bolsa' },
    { id: 'azucar-saco', local: '${pagina.local}', activo: true, categoria: 'Insumos', nombre: 'Azúcar Saco blanco', unidad: 'Saco' },
    { id: 'azucar-manga', local: '${pagina.local}', activo: true, categoria: 'Insumos', nombre: 'Azúcar', unidad: 'Mangas' },
    { id: 'balde', local: '${pagina.local}', activo: true, categoria: 'Packing', nombre: 'Balde 3L', unidad: 'Unidades' },
  ]; DB.inventario = []; DB.inventario_local = [];`);
  const d = w.document;
  for (const prefix of ["inv", "invl"]) {
    d.getElementById(`${prefix}-fecha`).value = FECHA;
    d.getElementById(`${prefix}-local`).value = pagina.local;
    const resp = d.getElementById(`${prefix}-responsable`);
    const op = d.createElement("option");
    op.value = pagina.responsable;
    op.textContent = pagina.responsable;
    resp.appendChild(op);
    resp.value = pagina.responsable;
  }
  return { w, d, llamadas, toasts };
}

const inputs = (d, prefix) => [...d.querySelectorAll(`#${prefix}-conteo-tbody .conteo-input`)];
const valores = (d, prefix) => Object.fromEntries(inputs(d, prefix).map((i) => [i.dataset.id, i.value]));
const input = (d, prefix, id) => inputs(d, prefix).find((i) => i.dataset.id === id);

for (const pagina of PAGINAS) {
  test(`${pagina.codigo}: conteo NUEVO sigue el flujo normal (registrar, sin precarga ni corrección)`, async () => {
    const { w, d, llamadas } = await abrir(pagina, { registrar: { conteo_id: "nuevo", estado_resultado: "CREADO", n_lineas: 2, articulos_omitidos: [] } });
    w.generarConteoInventario("inv");
    assert.deepEqual(Object.values(valores(d, "inv")), ["", "", "", ""]); // nunca precargado
    input(d, "inv", "kk").value = "3";
    input(d, "inv", "balde").value = "10";
    await w.guardarConteoMasivo("inv", "inventario");
    const rpcs = llamadas.map((l) => l.rpc).filter((r) => r !== "registrar_intento_conteo_operativo");
    assert.deepEqual(rpcs, ["registrar_conteo_operativo_local"]);
    assert.equal(llamadas[0].body.p_ubicacion, "BODEGA");
    assert.deepEqual(Object.fromEntries(llamadas[0].body.p_lineas.map((l) => [l.insumo_id, l.cantidad])), { kk: 3, balde: 10 });
  });

  test(`${pagina.codigo}: conteo aprobado -> Corregir -> cantidades precargadas -> modificar -> guardar envía el conjunto completo`, async () => {
    const { w, d, llamadas, toasts } = await abrir(pagina, { registrar: { conteo_id: "conteo-v1", estado_resultado: "YA_APROBADO", n_lineas: 3, articulos_omitidos: [] } });
    w.generarConteoInventario("inv");
    await w.corregirConteoGuardado("inv", "inventario");
    // precarga EXACTA de las capturas guardadas, por insumo (unidad de captura intacta)
    assert.deepEqual(valores(d, "inv"), { kk: "6", "azucar-saco": "2", "azucar-manga": "1", balde: "130" });
    // unidad de captura de cada insumo, la misma del conteo normal
    const unidad = (id) => input(d, "inv", id).closest("tr").children[2].textContent;
    assert.deepEqual(["kk", "azucar-saco", "azucar-manga", "balde"].map(unidad), ["Bolsa", "Saco", "Mangas", "Unidades"]);
    assert.ok(d.getElementById("inv-aviso-correccion")?.textContent.includes("versión 1"));
    // el usuario modifica solo Balde 3L
    input(d, "inv", "balde").value = "125";
    await w.guardarConteoMasivo("inv", "inventario");
    const corr = llamadas.filter((l) => l.rpc === "corregir_conteo_operativo_local");
    assert.equal(corr.length, 1);
    assert.equal(llamadas.some((l) => l.rpc === "registrar_conteo_operativo_local"), false); // no pasa por el guardado normal
    const enviado = Object.fromEntries(corr[0].body.p_lineas.map((l) => [l.insumo_id, l.cantidad]));
    assert.deepEqual(enviado, { kk: 6, "azucar-saco": 2, "azucar-manga": 1, balde: 125 }); // completo, sin duplicados
    assert.equal(corr[0].body.p_lineas.length, 4);
    assert.equal(corr[0].body.p_ubicacion, "BODEGA");
    assert.equal(corr[0].body.p_fecha_operacional, FECHA);
    assert.equal(corr[0].body.p_local_codigo, pagina.codigo);
    assert.ok(corr[0].body.p_motivo.length > 0);
    assert.ok(toasts.some((t) => t.msg.includes("corregido (versión 2)")));
    assert.equal(w.eval("CORRECCION_CONTEO.inv"), undefined); // sale del modo
    // la vista local reemplaza (no suma) las filas de ese día
    assert.equal(w.eval(`DB.inventario.filter(r => r.fecha === '${FECHA}').length`), 4);
  });

  test(`${pagina.codigo}: al guardar de nuevo un conteo ya aprobado se ofrece corregir con precarga (Local)`, async () => {
    const { w, d, llamadas } = await abrir(pagina, { registrar: { conteo_id: "conteo-v1", estado_resultado: "YA_APROBADO", n_lineas: 3, articulos_omitidos: [] } });
    w.generarConteoInventario("invl");
    input(d, "invl", "kk").value = "99";
    await w.guardarConteoMasivo("invl", "inventario_local");
    assert.deepEqual(valores(d, "invl"), { kk: "6", "azucar-saco": "2", "azucar-manga": "1", balde: "130" }); // lo guardado, no lo tecleado
    const cap = llamadas.find((l) => l.rpc === "capturas_conteo_operativo_vigente");
    assert.equal(cap.body.p_ubicacion, "LOCAL");
  });

  test(`${pagina.codigo}: una corrección incompleta se sigue rechazando y las cantidades quedan en pantalla`, async () => {
    const { w, d, toasts } = await abrir(pagina, { registrar: { conteo_id: "conteo-v1", estado_resultado: "YA_APROBADO", n_lineas: 3, articulos_omitidos: [] } });
    w.generarConteoInventario("inv");
    await w.corregirConteoGuardado("inv", "inventario");
    input(d, "inv", "azucar-manga").value = "";
    await w.guardarConteoMasivo("inv", "inventario");
    assert.ok(toasts.some((t) => t.esError && t.msg.includes("Faltan: azucar-manga")));
    assert.equal(input(d, "inv", "balde").value, "130");
    assert.notEqual(w.eval("CORRECCION_CONTEO.inv"), undefined); // sigue en modo corrección para completar
  });

  test(`${pagina.codigo}: generar un conteo nuevo sale del modo corrección (vuelve el flujo normal)`, async () => {
    const { w, d, llamadas } = await abrir(pagina, { registrar: { conteo_id: "x", estado_resultado: "CREADO", n_lineas: 1, articulos_omitidos: [] } });
    w.generarConteoInventario("inv");
    await w.corregirConteoGuardado("inv", "inventario");
    w.generarConteoInventario("inv");
    assert.equal(w.eval("CORRECCION_CONTEO.inv"), undefined);
    assert.equal(d.getElementById("inv-aviso-correccion"), null);
    assert.deepEqual(Object.values(valores(d, "inv")), ["", "", "", ""]);
    input(d, "inv", "kk").value = "1";
    await w.guardarConteoMasivo("inv", "inventario");
    assert.equal(llamadas.some((l) => l.rpc === "corregir_conteo_operativo_local"), false);
    assert.equal(llamadas.some((l) => l.rpc === "registrar_conteo_operativo_local"), true);
  });
}
