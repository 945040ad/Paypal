import { describe, expect, it } from "vitest";
import { centsToDecimal, decimalToCents } from "./money";

describe("centsToDecimal", () => {
  it.each([
    [3500, "35.00"],
    [5, "0.05"],
    [0, "0.00"],
    [123456, "1234.56"],
  ])("turns %i cents into %s", (cents, text) => {
    expect(centsToDecimal(cents)).toBe(text);
  });

  it.each([10.5, -1, Number.NaN])("refuses %s", (bad) => {
    expect(() => centsToDecimal(bad)).toThrow();
  });
});

describe("decimalToCents", () => {
  it.each([
    ["35.00", 3500],
    ["0.05", 5],
    ["10", 1000],
    ["10.5", 1050],
    ["1234.56", 123456],
  ])("turns %s into %i cents", (text, cents) => {
    expect(decimalToCents(text)).toBe(cents);
  });

  it("does not lose a cent to floating point", () => {
    expect(decimalToCents("19.99")).toBe(1999);
    expect(decimalToCents("0.29")).toBe(29);
  });

  it.each(["abc", "1.234", "-5.00", ""])("refuses %j", (bad) => {
    expect(() => decimalToCents(bad)).toThrow();
  });
});
