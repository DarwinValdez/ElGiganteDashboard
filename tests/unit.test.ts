import assert from "node:assert/strict";
import { test } from "node:test";

import { expectedLineTotal, invoiceTotals, lineMismatch } from "../src/lib/invoice-math.ts";
import { normalizeText, parsePackageCount, parseSize, proposeConversion } from "../src/lib/units.ts";

const units = [
  { code: "unidad", name: "Unidad", kind: "count", base_factor: 1, is_package: false, active: true },
  { code: "botella", name: "Botella", kind: "count", base_factor: 1, is_package: false, active: true },
  { code: "caja", name: "Caja", kind: "count", base_factor: null, is_package: true, active: true },
  { code: "saco", name: "Saco", kind: "count", base_factor: null, is_package: true, active: true },
  { code: "lb", name: "Libra", kind: "weight", base_factor: 0.45359237, is_package: false, active: true },
  { code: "kg", name: "Kilogramo", kind: "weight", base_factor: 1, is_package: false, active: true },
] as const;

test("normaliza texto sin acentos ni signos", () => {
  assert.equal(normalizeText("Habichuelas  Rojas, 15 OZ!"), "habichuelas rojas 15 oz");
  assert.equal(normalizeText("Aceite—Vegetal Ñ"), "aceite vegetal n");
});

test("interpreta presentaciones de empaque", () => {
  assert.equal(parsePackageCount("Aceite vegetal 12/1"), 12);
  assert.equal(parsePackageCount("Habichuelas 24/15 oz"), 24);
  assert.equal(parsePackageCount("Agua 24x500ml"), 24);
  assert.equal(parsePackageCount("CJ 6 galones"), 6);
  assert.equal(parsePackageCount("Arroz 20 lb"), null);
});

test("detecta tamaños", () => {
  assert.deepEqual(parseSize("RICE LONG GRAIN 20LB"), { value: 20, unit: "lb" });
  assert.deepEqual(parseSize("Habichuelas 24/15 oz"), { value: 15, unit: "oz" });
  assert.deepEqual(parseSize("Aceite 1 L"), { value: 1, unit: "l" });
});

test("propone conversiones sin mezclar tipos de unidad", () => {
  const aceite = { purchase_unit: "caja", inventory_unit: "botella", units_per_package: 12 };
  assert.equal(proposeConversion("caja", aceite, units as never).factor, 12); // caja de 12 → 12 botellas
  assert.equal(proposeConversion("botella", aceite, units as never).factor, 1);
  const arroz = { purchase_unit: "saco", inventory_unit: "lb", units_per_package: 20 };
  const kg = proposeConversion("kg", arroz, units as never);
  assert.ok(Math.abs(kg.factor - 2.204623) < 1e-5, "1 kg = 2.2046 lb");
  assert.equal(kg.certain, true);
  const unknown = proposeConversion("unidad", arroz, units as never);
  assert.equal(unknown.certain, false, "unidad vs libra requiere verificación");
});

test("costo normalizado del ejemplo: caja de 12 a $24 → $2 por botella", () => {
  const factor = proposeConversion("caja", { purchase_unit: "caja", inventory_unit: "botella", units_per_package: 12 }, units as never).factor;
  assert.equal(24 / factor, 2);
});

test("valida importes de línea y totales de factura", () => {
  assert.equal(expectedLineTotal({ quantity: "10", unit_price: "18", discount: "0" }), 180);
  assert.equal(lineMismatch({ quantity: 5, unit_price: 24, discount: 0, line_total: 120 }), false);
  assert.equal(lineMismatch({ quantity: 5, unit_price: 24, discount: 0, line_total: 125 }), true);

  const lines = [{ line_total: 180 }, { line_total: 120 }, { line_total: 120 }];
  const ok = invoiceTotals({ subtotal: 420, discount_total: 0, tax_total: 0, freight_total: 0, other_charges: 0, total: 420 }, lines, 0.05);
  assert.equal(ok.linesSum, 420);
  assert.equal(ok.ok, true);

  const bad = invoiceTotals({ subtotal: 420, discount_total: 0, tax_total: 0, freight_total: 0, other_charges: 0, total: 430 }, lines, 0.05);
  assert.equal(bad.ok, false);
  assert.equal(bad.totalDiff, 10);

  const withCharges = invoiceTotals({ subtotal: "", discount_total: "5", tax_total: "21", freight_total: "10", other_charges: "", total: "446" }, lines, 0.05);
  assert.equal(withCharges.computed, 446);
  assert.equal(withCharges.ok, true);

  const missingTotal = invoiceTotals({ discount_total: 0, tax_total: 0, freight_total: 0, other_charges: 0, total: "" }, lines, 0.05);
  assert.equal(missingTotal.ok, false, "sin total impreso no se da por válido");
});
