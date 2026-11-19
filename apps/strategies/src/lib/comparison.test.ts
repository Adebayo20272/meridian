import { describe, expect, it } from "vitest";
import {
  Decimal,
  FixedPointDecimal,
  type BacktestSnapshot,
  type Scenario,
} from "@meridian/strategies";
import { buildComparison } from "./comparison";
import type { RunRecord } from "./run-history";

interface RunOptions {
  readonly id: string;
  readonly capital?: string;
  readonly finalValue: string;
  readonly strategyId?: string;
  readonly regime?: string | null;
  readonly step?: string;
  readonly maxDrawdown?: string;
  readonly sharpeRatio?: string | null;
  readonly valueAtRisk?: string | null;
  readonly fees?: string;
  readonly rebalances?: number;
}

function scenario(options: RunOptions): Scenario {
  const params: Record<string, string> = {};
  if (options.regime !== null && options.regime !== undefined) {
    params["market.regime"] = options.regime;
  }
  return {
    schemaVersion: 1,
    window: {
      start: "2025-01-01T00:00:00Z",
      end: "2025-02-01T00:00:00Z",
      step: options.step ?? "PT1H",
    },
    assets: ["USDC"],
    source: { price: "horizon", rate: "blend" },
    startingCapital: options.capital ?? "10000",
    strategy: {
      id: options.strategyId ?? "delta-neutral",
      version: "1",
      params,
    },
    seed: `seed-${options.id}`,
  };
}

function snapshots(options: RunOptions): BacktestSnapshot[] {
  const count = (options.rebalances ?? 0) + 1;
  const result: BacktestSnapshot[] = [];
  for (let index = 0; index < count; index += 1) {
    result.push({
      index,
      timestamp: Date.UTC(2025, 0, 1) + index * 3_600_000,
      cash: FixedPointDecimal.fromString(options.capital ?? "10000"),
      positions:
        index === 0
          ? []
          : [
              {
                asset: "USDC",
                size: FixedPointDecimal.fromString(`${index}.5`),
                basis: FixedPointDecimal.fromString(`${index}.25`),
              },
            ],
      value: FixedPointDecimal.fromString(options.finalValue),
    });
  }
  return result;
}

function run(options: RunOptions): RunRecord {
  const initialCash = FixedPointDecimal.fromString(options.capital ?? "10000");
  return {
    version: 1,
    id: options.id,
    createdAt: Date.UTC(2025, 1, 1),
    scenario: scenario(options),
    result: {
      strategyName: options.strategyId ?? "delta-neutral",
      initialCash,
      snapshots: snapshots(options),
      finalValue: FixedPointDecimal.fromString(options.finalValue),
      strategyEquity: FixedPointDecimal.fromString(options.finalValue),
      totalInterest: FixedPointDecimal.fromString("0"),
      totalFunding: FixedPointDecimal.fromString("0"),
      totalFees: FixedPointDecimal.fromString(options.fees ?? "0"),
    },
    riskMetrics: {
      maxDrawdown: Decimal.fromString(options.maxDrawdown ?? "0", 18),
      sharpeRatio:
        options.sharpeRatio === null || options.sharpeRatio === undefined
          ? null
          : Decimal.fromString(options.sharpeRatio, 18),
      valueAtRisk:
        options.valueAtRisk === null || options.valueAtRisk === undefined
          ? null
          : Decimal.fromString(options.valueAtRisk, 18),
    },
  };
}

function rowFor(model: ReturnType<typeof buildComparison>, runId: string) {
  const row = model.rows.find((candidate) => candidate.runId === runId);
  if (row === undefined) throw new Error(`missing row for ${runId}`);
  return row;
}

describe("buildComparison", () => {
  it("normalizes return and PnL against each run's own starting capital", () => {
    const model = buildComparison([
      run({ id: "small", capital: "100", finalValue: "120" }),
      run({ id: "large", capital: "1000", finalValue: "1100" }),
    ]);

    const small = rowFor(model, "small");
    const large = rowFor(model, "large");

    expect(small.values.returnPct?.toFixed(4)).toBe("20.0000");
    expect(large.values.returnPct?.toFixed(4)).toBe("10.0000");
    expect(small.values.pnl?.toFixed(2)).toBe("20.00");
    expect(large.values.pnl?.toFixed(2)).toBe("100.00");
    expect(small.cells.returnPct.formatted).toBe("20.00%");
  });

  it("does not let a larger capital base win on return alone", () => {
    const model = buildComparison([
      run({ id: "large", capital: "10000", finalValue: "10100" }),
      run({ id: "small", capital: "100", finalValue: "120" }),
    ]);

    const large = rowFor(model, "large");
    const small = rowFor(model, "small");

    expect(large.cells.finalValue.mark).toBe("best");
    expect(small.cells.returnPct.mark).toBe("best");
    expect(large.cells.returnPct.mark).toBe("worst");
  });

  it("marks the best and worst value in each directed numeric column", () => {
    const model = buildComparison([
      run({
        id: "steady",
        finalValue: "11000",
        maxDrawdown: "0.04",
        sharpeRatio: "0.2",
        valueAtRisk: "0.01",
        fees: "5",
        rebalances: 1,
      }),
      run({
        id: "reckless",
        finalValue: "11500",
        maxDrawdown: "0.3",
        sharpeRatio: "0.05",
        valueAtRisk: "0.08",
        fees: "20",
        rebalances: 4,
      }),
    ]);

    const steady = rowFor(model, "steady");
    const reckless = rowFor(model, "reckless");

    expect(steady.cells.finalValue.mark).toBe("worst");
    expect(reckless.cells.finalValue.mark).toBe("best");
    expect(steady.cells.maxDrawdownPct.mark).toBe("best");
    expect(reckless.cells.maxDrawdownPct.mark).toBe("worst");
    expect(steady.cells.annualizedSharpe.mark).toBe("best");
    expect(steady.cells.valueAtRiskPct.mark).toBe("best");
    expect(steady.cells.fees.mark).toBe("best");
    expect(steady.cells.rebalanceCount.mark).toBe("best");
    expect(reckless.cells.rebalanceCount.mark).toBe("worst");

    // Capital is the normalization base, not a performance result.
    expect(steady.cells.startingCapital.mark).toBeNull();
  });

  it("states a direction for every metric column", () => {
    const model = buildComparison([
      run({ id: "a", finalValue: "11000" }),
      run({ id: "b", finalValue: "9000" }),
    ]);

    const directions = Object.fromEntries(
      model.columns.map((column) => [column.key, column.direction])
    );
    expect(directions).toMatchObject({
      finalValue: "higher",
      pnl: "higher",
      returnPct: "higher",
      maxDrawdownPct: "lower",
      annualizedSharpe: "higher",
      valueAtRiskPct: "lower",
      fees: "lower",
      rebalanceCount: "lower",
      startingCapital: "neutral",
    });
  });

  it("groups rows by the regime the scenario declares", () => {
    const model = buildComparison([
      run({ id: "trend-a", finalValue: "11000", regime: "trending" }),
      run({ id: "range-a", finalValue: "10500", regime: "ranging" }),
      run({ id: "trend-b", finalValue: "10800", regime: "trending" }),
      run({ id: "plain", finalValue: "10000" }),
    ]);

    expect(model.groups.map((group) => group.regime)).toEqual([
      "trending",
      "ranging",
      null,
    ]);
    expect(model.groups[0]?.rows.map((row) => row.runId)).toEqual([
      "trend-a",
      "trend-b",
    ]);
    expect(model.groups[0]?.label).toBe("Trending");
    expect(model.groups[2]?.label).toBe("No declared regime");
    expect(rowFor(model, "plain").regime).toBeNull();
  });

  it("does not infer a regime from the strategy id or window", () => {
    const model = buildComparison([
      run({
        id: "looks-trending",
        strategyId: "trending-momentum",
        finalValue: "11000",
      }),
      run({ id: "other", finalValue: "9000" }),
    ]);

    expect(rowFor(model, "looks-trending").regime).toBeNull();
    expect(model.groups.map((group) => group.regime)).toEqual([null]);
  });

  it("returns an empty model when fewer than two runs are selected", () => {
    const none = buildComparison([]);
    expect(none.hasEnoughRuns).toBe(false);
    expect(none.rows).toEqual([]);
    expect(none.runCount).toBe(0);

    const one = buildComparison([run({ id: "only", finalValue: "11000" })]);
    expect(one.hasEnoughRuns).toBe(false);
    expect(one.rows).toEqual([]);
    expect(one.runCount).toBe(1);
  });

  it("annualizes Sharpe from the scenario's step and keeps losses positive", () => {
    const model = buildComparison([
      run({
        id: "daily",
        finalValue: "11000",
        step: "P1D",
        sharpeRatio: "0.1",
        valueAtRisk: "-0.02",
        maxDrawdown: "-0.05",
      }),
      run({ id: "other", finalValue: "10000" }),
    ]);

    const daily = rowFor(model, "daily");
    // 0.1 * sqrt(365) = 1.9105…
    expect(daily.cells.annualizedSharpe.formatted).toBe("1.91");
    expect(daily.cells.valueAtRiskPct.formatted).toBe("2.00%");
    expect(daily.cells.maxDrawdownPct.formatted).toBe("5.00%");
  });

  it("counts position changes as rebalances", () => {
    const model = buildComparison([
      run({ id: "churn", finalValue: "11000", rebalances: 3 }),
      run({ id: "quiet", finalValue: "10500", rebalances: 0 }),
    ]);

    expect(rowFor(model, "churn").cells.rebalanceCount.formatted).toBe("3");
    expect(rowFor(model, "quiet").cells.rebalanceCount.formatted).toBe("0");
  });
});
