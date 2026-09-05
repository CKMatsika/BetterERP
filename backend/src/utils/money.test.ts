import { describe, expect, it } from "vitest";
import { add, d, div, money, mul, sum } from "./money";

describe("money arithmetic", () => {
  it("keeps decimal addition exact", () => {
    expect(add("0.10", "0.20").toFixed(2)).toBe("0.30");
  });

  it("multiplies and divides using Decimal values", () => {
    expect(mul("12.50", 4).toFixed(2)).toBe("50.00");
    expect(div("1.00", 3).toDecimalPlaces(4).toFixed(4)).toBe("0.3333");
  });

  it("rounds display money without changing source arithmetic", () => {
    expect(money("10.126").toFixed(2)).toBe("10.13");
    expect(d("10.126").toFixed(3)).toBe("10.126");
  });

  it("sums mixed numeric inputs", () => {
    expect(sum(["1.10", 2, d("0.90")]).toFixed(2)).toBe("4.00");
  });
});
