// Recepciones con productos de varias facturas (migración 216 de docpop-control):
// la lista de "Recepciones recientes" agrupa los productos por factura y muestra
// "2 facturas asociadas"; las recepciones de una sola factura se ven igual que antes.
// Páginas REALES (Plaza Oeste y Pajaritos) en jsdom con el backend simulado.
//
// Ejecutar:  node --test tests/recepciones_facturas.test.mjs
// Requiere jsdom (JSDOM_PATH para otra ruta) y git (compara con la versión anterior publicada).
//
// El backend real (alcance = listar_recepciones_bodega, permisos de la llave pública)
// se prueba en docpop-control: scripts/ensayo_216_facturas_recepciones_bodega.py.

import { after, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const aqui = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { JSDOM } = require(process.env.JSDOM_PATH || "C:/Users/sindy/Documents/docpop-pre0/frontend/node_modules/jsdom");
const VERSION_ANTERIOR = process.env.BODEGA_VERSION_ANTERIOR || "556ffb1";

const PAGINAS = [
  { archivo: "bodega-plaza-oeste.html", local: "Plaza Oeste" },
  { archivo: "bodega-pajaritos.html", local: "Pajaritos" },
];
const ACEITE = "f6d5d72d-60eb-434d-b8c7-a27346bb30e2";
const MANTEQUILLA = "2a344390-e3f4-453b-accd-75ac9d1e3a52";
const MAIZ = "79812f08-a5a4-4dc5-ac5d-9605615d9727";

// Recepción física única de Watt's (01-10, Victoria Carrera), registrada con folio 5868083.
const WATTS = {
  documento_identidad_key: "RECEPCION|e|watts|33|5868083|mpo", proveedor_id: "watts", proveedor_nombre: "WATT'S S.A.",
  tipo_documento: "33", folio: "5868083", fecha: "2026-10-01", estado_documental: "VINCULADO", eventos_fisicos: 1, productos_total: 2,
  responsable_ingreso_nombre: "Victoria Carrera",
  eventos: [{ movimiento_id: "mov-watts", es_complemento: false, fecha_efectiva: "2026-10-01T20:32:06Z", responsable_informado: "Victoria Carrera",
    lineas: [
      { articulo_maestro_id: ACEITE, articulo_nombre: "Aceite Chef Maíz", cantidad_original: 40, unidad_codigo: "BIDON" },
      { articulo_maestro_id: MANTEQUILLA, articulo_nombre: "Mantequilla Calo", cantidad_original: 40, unidad_codigo: "PAN" },
    ] }],
};
// Recepción normal con complemento (una factura).
const NORMAL = {
  documento_identidad_key: "RECEPCION|e|southern|33|11332|mpo", proveedor_id: "southern", proveedor_nombre: "SOUTHERN",
  tipo_documento: "33", folio: "11332", fecha: "2026-10-13", estado_documental: "ESPERANDO_RCV", eventos_fisicos: 2, productos_total: 1,
  responsable_ingreso_nombre: "Javiera Espinoza",
  eventos: [
    { movimiento_id: "mov-n1", es_complemento: false, fecha_efectiva: "2026-10-13T16:24:51Z", responsable_informado: "Javiera Espinoza",
      lineas: [{ articulo_maestro_id: MAIZ, articulo_nombre: "Maíz Butterfly", cantidad_original: 30, unidad_codigo: "SACO" }] },
    { movimiento_id: "mov-n2", es_complemento: true, fecha_efectiva: "2026-10-13T18:00:00Z", responsable_informado: "Neyrut Rincón",
      lineas: [{ articulo_maestro_id: MAIZ, articulo_nombre: "Maíz Butterfly", cantidad_original: 2, unidad_codigo: "SACO" }] },
  ],
};
const fila = (key, mov, art, folio, reasignada = false) =>
  ({ documento_identidad_key: key, movimiento_id: mov, articulo_maestro_id: art, folio, tipo_documento: "33", factura_reasignada: reasignada });
const FACTURAS = [
  fila(WATTS.documento_identidad_key, "mov-watts", ACEITE, "5868082", true),
  fila(WATTS.documento_identidad_key, "mov-watts", MANTEQUILLA, "5868083"),
  fila(NORMAL.documento_identidad_key, "mov-n1", MAIZ, "11332"),
  fila(NORMAL.documento_identidad_key, "mov-n2", MAIZ, "11332"),
];

const ventanas = [];
after(() => ventanas.forEach((w) => w.close()));
const esperar = (ms = 25) => new Promise((r) => setTimeout(r, ms));
const anterior = (archivo) => execFileSync("git", ["show", `${VERSION_ANTERIOR}:bodega/${archivo}`], { cwd: path.join(aqui, ".."), encoding: "utf8", maxBuffer: 64 << 20 });

/** backend.recepciones: filas de listar_recepciones_bodega; backend.facturas: filas de facturas_recepciones_bodega o "ERROR". */
async function abrir(pagina, backend, html = null) {
  html = html ?? fs.readFileSync(path.join(aqui, "..", "bodega", pagina.archivo), "utf8");
  const llamadas = [];
  const dom = new JSDOM(html, {
    runScripts: "dangerously",
    url: `https://rrhh-docpopcorn.github.io/bodega/bodega/${pagina.archivo}`,
    beforeParse(window) {
      window.confirm = () => true;
      window.alert = () => {};
      window.scrollTo = () => {};
      window.HTMLElement.prototype.scrollIntoView = () => {};
      window.fetch = async (url, opciones = {}) => {
        const rpc = /\/rest\/v1\/rpc\/([a-z_]+)/.exec(String(url))?.[1] ?? null;
        const body = opciones.body ? JSON.parse(opciones.body) : null;
        if (rpc) llamadas.push({ rpc, body });
        const ok = (datos) => ({ ok: true, status: 200, headers: { get: () => "application/json" }, json: async () => datos, text: async () => JSON.stringify(datos) });
        const error = (code, message) => ({ ok: false, status: 404, headers: { get: () => "application/json" }, text: async () => JSON.stringify({ code, message }) });
        if (rpc === "listar_recepciones_bodega") return ok(backend.recepciones);
        if (rpc === "facturas_recepciones_bodega") {
          return backend.facturas === "ERROR" ? error("PGRST202", "Could not find the function") : ok(backend.facturas);
        }
        return ok([]);
      };
    },
  });
  const w = dom.window;
  ventanas.push(w);
  await esperar(30);
  w.toast = () => {};
  await w.cargarRecepcionesRecientes(pagina.local);
  const d = w.document;
  const items = () => [...d.querySelectorAll("#recepciones-recientes-lista .recepcion-reciente-item")];
  return { w, d, llamadas, items };
}

const texto = (el) => el.textContent.replace(/\s+/g, " ").trim();

for (const pagina of PAGINAS) {
  test(`${pagina.archivo}: Watt's muestra 2 facturas asociadas y agrupa cada producto con su factura (una sola recepción)`, async () => {
    const { items, llamadas } = await abrir(pagina, { recepciones: [WATTS], facturas: FACTURAS.slice(0, 2) });
    assert.equal(items().length, 1); // la recepción física sigue siendo una
    const it = items()[0];
    assert.equal(texto(it.querySelector("strong")), "Facturas 5868082 y 5868083 · WATT'S S.A.");
    assert.equal(texto(it.querySelector(".facturas-asociadas")), "2 facturas asociadas");
    const eventos = it.querySelectorAll(".recepcion-evento");
    assert.equal(eventos.length, 1);
    assert.match(texto(eventos[0]), /RECEPCIÓN ORIGINAL Responsable: Victoria Carrera/);
    assert.deepEqual([...eventos[0].querySelectorAll("li")].map(texto),
      ["Factura 5868082", "Aceite Chef Maíz · 40 BIDON", "Factura 5868083", "Mantequilla Calo · 40 PAN"]);
    assert.match(texto(it), /Ingresada por: Victoria Carrera/);
    // misma consulta que la lista (mismo local y misma ventana)
    const l = llamadas.find((x) => x.rpc === "listar_recepciones_bodega").body;
    const f = llamadas.find((x) => x.rpc === "facturas_recepciones_bodega").body;
    assert.deepEqual(f, l);
  });

  test(`${pagina.archivo}: una recepción de una sola factura se ve EXACTAMENTE igual que en la versión anterior`, async () => {
    const nueva = await abrir(pagina, { recepciones: [NORMAL], facturas: FACTURAS });
    const vieja = await abrir(pagina, { recepciones: [NORMAL], facturas: [] }, anterior(pagina.archivo));
    assert.equal(nueva.items()[0].outerHTML, vieja.items()[0].outerHTML);
    assert.equal(nueva.items()[0].querySelector(".facturas-asociadas"), null);
  });

  test(`${pagina.archivo}: lista mixta (Watt's + normal): solo Watt's cambia; la normal idéntica a la versión anterior`, async () => {
    const nueva = await abrir(pagina, { recepciones: [WATTS, NORMAL], facturas: FACTURAS });
    const vieja = await abrir(pagina, { recepciones: [WATTS, NORMAL], facturas: [] }, anterior(pagina.archivo));
    assert.notEqual(nueva.items()[0].outerHTML, vieja.items()[0].outerHTML);
    assert.equal(nueva.items()[1].outerHTML, vieja.items()[1].outerHTML);
  });

  test(`${pagina.archivo}: sin la función nueva (o con error) se muestra todo como siempre`, async () => {
    const nueva = await abrir(pagina, { recepciones: [WATTS, NORMAL], facturas: "ERROR" });
    const vieja = await abrir(pagina, { recepciones: [WATTS, NORMAL], facturas: [] }, anterior(pagina.archivo));
    assert.equal(nueva.d.getElementById("recepciones-recientes-lista").innerHTML, vieja.d.getElementById("recepciones-recientes-lista").innerHTML);
    assert.equal(texto(nueva.items()[0].querySelector("strong")), "Factura 5868083 · WATT'S S.A.");
  });

  test(`${pagina.archivo}: si a algún producto le falta la factura, esa recepción se muestra como siempre`, async () => {
    const nueva = await abrir(pagina, { recepciones: [WATTS], facturas: [FACTURAS[0]] });
    const vieja = await abrir(pagina, { recepciones: [WATTS], facturas: [] }, anterior(pagina.archivo));
    assert.equal(nueva.items()[0].outerHTML, vieja.items()[0].outerHTML);
  });

  test(`${pagina.archivo}: corregir Watt's identifica la factura de cada producto sin cambiar la recepción ni su identificador`, async () => {
    const { w, d } = await abrir(pagina, { recepciones: [WATTS, NORMAL], facturas: FACTURAS });
    w.prepararCorregirRecepcion(0);
    const c = w.eval("correccionActual");
    assert.equal(c.documentoIdentidadKey, WATTS.documento_identidad_key); // identificador interno intacto
    assert.equal(d.getElementById("corr-folio").value, "5868083"); // folio físico de la recepción, sin cambios
    const filas = [...d.querySelectorAll("#corr-lineas-lista > div")].map(texto);
    assert.match(filas[0], /^Aceite Chef Maíz\s*Factura 5868082/);
    assert.match(filas[1], /^Mantequilla Calo\s*Factura 5868083/);
    // la corrección de cantidades sigue igual (mismo stock/delta); solo se identifica la factura
    w.corrActualizarCantidad(0, "39");
    d.getElementById("corr-motivo").value = "CANTIDAD_INCORRECTA";
    w.corrPrevisualizar();
    assert.match(texto(d.getElementById("corr-preview-cuerpo")), /✎ Aceite Chef Maíz \(factura 5868082\): 40 BIDON → 39 BIDON \(stock -1 BIDON\)/);
    assert.match(w.corrGenerarResumenTexto(), /- Aceite Chef Maíz \(factura 5868082\): 40 → 39 BIDON/);
    assert.match(w.corrGenerarResumenTexto(), /^Corrección de factura 5868083 · WATT'S S\.A\./);
  });

  test(`${pagina.archivo}: corregir una recepción de una sola factura no agrega etiquetas de factura`, async () => {
    const { w, d } = await abrir(pagina, { recepciones: [WATTS, NORMAL], facturas: FACTURAS });
    w.prepararCorregirRecepcion(1);
    assert.equal([...d.querySelectorAll("#corr-lineas-lista > div")].map(texto).some((t) => /Factura/.test(t)), false);
    assert.equal(w.eval("correccionActual.lineas[0].factura"), undefined);
    assert.equal(w.eval("correccionActual.lineas[0].cantidadOriginal"), 32); // neteo de siempre (original + complemento)
  });

  test(`${pagina.archivo}: "Agregar producto faltante" sigue usando la factura física de la recepción`, async () => {
    const { w, d } = await abrir(pagina, { recepciones: [WATTS], facturas: FACTURAS.slice(0, 2) });
    await w.prepararCompletarRecepcion(0);
    assert.equal(d.getElementById("rec-folio").value, "5868083");
  });
}
