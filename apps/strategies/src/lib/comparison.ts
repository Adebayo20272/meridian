import {
  Decimal,
  annualizeSharpe,
  durationToMilliseconds,
} from "@meridian/strategies";
import type { RunRecord } from "./run-history";

/**
 * Presentation model for comparing completed runs across strategies and
 * market regimes (#1255).
 *
 * The model is pure: it takes run records and returns everything the table
 * renders. Percentage metrics are normalized against each run's own starting
 * capital, so a run with more capital is not automatically "winning", and
 * absolute money values stay in display units.
 */

export type MetricDirection = "higher" | "lower" | "neutral";
export type MetricUnit = "currency" | "percent" | "ratio" | "count";
export type CellMark = "best" | "worst" | null;

export type ComparisonMetricKey =
  | "startingCapital"
  | "finalValue"
  | "pnl"
  | "returnPct"
  | "maxDrawdownPct"
  | "annualizedSharpe"
  | "valueAtRiskPct"
  | "fees"
  | "rebalanceCount";

export interface ComparisonColumn {
  readonly key: ComparisonMetricKey;
  readonly label: string;
  readonly unit: MetricUnit;
  /** Which end of the column counts as the better result. */
  readonly direction: MetricDirection;
  /** Human-readable statement of `direction`, shown in the table header. */
  readonly better: string;
}

export interface ComparisonCell {
  /** Null when the run's record cannot supply the metric. */
  readonly value: Decimal | null;
  readonly formatted: string;
  readonly mark: CellMark;
}

export interface ComparisonWindow {
  readonly start: string;
  readonly end: string;
}

export interface ComparisonRow {
  readonly runId: string;
  readonly strategyId: string;
  /** Declared `market.regime` only; null when the scenario does not declare one. */
  readonly regime: string | null;
  readonly label: string;
  readonly window: ComparisonWindow;
  readonly values: Readonly<Record<ComparisonMetricKey, Decimal | null>>;
  readonly cells: Readonly<Record<ComparisonMetricKey, ComparisonCell>>;
}

export interface ComparisonGroup {
  /** Null is the group of runs whose scenario declares no regime. */
  readonly regime: string | null;
  readonly label: string;
  readonly rows: readonly ComparisonRow[];
}

export interface ComparisonModel {
  readonly rows: readonly ComparisonRow[];
  readonly groups: readonly ComparisonGroup[];
  readonly columns: readonly ComparisonColumn[];
  readonly hasEnoughRuns: boolean;
  readonly runCount: number;
}

const HUNDRED = Decimal.fromBigInt(100n, 0);
const DAYS_PER_YEAR = 365;

/**
 * Column order matches the acceptance table: strategy, regime, window, then
 * capital and the normalized/absolute performance and risk metrics.
 */
export const COMPARISON_COLUMNS: readonly ComparisonColumn[] = [
  {
    key: "startingCapital",
    label: "Starting capital",
    unit: "currency",
    direction: "neutral",
    better: "No better direction: capital is the normalization base",
  },
  {
    key: "finalValue",
    label: "Final value",
    unit: "currency",
    direction: "higher",
    better: "Higher is better",
  },
  {
    key: "pnl",
    label: "PnL",
    unit: "currency",
    direction: "higher",
    better: "Higher is better",
  },
  {
    key: "returnPct",
    label: "Return",
    unit: "percent",
    direction: "higher",
    better: "Higher is better",
  },
  {
    key: "maxDrawdownPct",
    label: "Max drawdown",
    unit: "percent",
    direction: "lower",
    better: "Lower is better",
  },
  {
    key: "annualizedSharpe",
    label: "Sharpe (annualized)",
    unit: "ratio",
    direction: "higher",
    better: "Higher is better",
  },
  {
    key: "valueAtRiskPct",
    label: "Value at risk",
    unit: "percent",
    direction: "lower",
    better: "Lower loss is better",
  },
  {
    key: "fees",
    label: "Fees",
    unit: "currency",
    direction: "lower",
    better: "Lower is better",
  },
  {
    key: "rebalanceCount",
    label: "Rebalances",
    unit: "count",
    direction: "lower",
    better: "Lower is better",
  },
];

const METRIC_KEYS = COMPARISON_COLUMNS.map((column) => column.key);

/**
 * Builds the comparison model from completed runs.
 *
 * Fewer than two runs cannot be compared, so the model reports
 * `hasEnoughRuns: false` and carries no rows. The view renders its empty state
 * instead of a table with nothing to compare.
 */
export function buildComparison(runs: readonly RunRecord[]): ComparisonModel {
  if (runs.length < 2) {
    return {
      rows: [],
      groups: [],
      columns: COMPARISON_COLUMNS,
      hasEnoughRuns: false,
      runCount: runs.length,
    };
  }

  const rows = runs.map((run) => buildRow(run));
  markBestAndWorst(rows);

  return {
    rows,
    groups: groupRows(rows),
    columns: COMPARISON_COLUMNS,
    hasEnoughRuns: true,
    runCount: rows.length,
  };
}

/**
 * Reads the regime the scenario declares in `strategy.params["market.regime"]`.
 * Other params are strategy knobs, not market metadata, so they are not
 * consulted, and no regime is inferred from the strategy id or window.
 */
export function declaredRegime(run: RunRecord): string | null {
  const regime = run.scenario.strategy.params["market.regime"];
  if (typeof regime !== "string") return null;
  const trimmed = regime.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Cells are marked after every row exists, so they are built mutable. */
interface MutableComparisonRow extends Omit<ComparisonRow, "cells"> {
  readonly cells: Record<ComparisonMetricKey, ComparisonCell>;
}

function buildRow(run: RunRecord): MutableComparisonRow {
  const startingCapital = decimalFromString(run.scenario.startingCapital);
  const finalValue = decimalFromString(run.result.finalValue.toString());
  const pnl = finalValue.sub(startingCapital);
  const returnPct = startingCapital.isPositive()
    ? pnl.div(startingCapital).mul(HUNDRED)
    : null;
  const maxDrawdownPct = run.riskMetrics.maxDrawdown.abs().mul(HUNDRED);
  const annualizedSharpe = annualizedRiskAdjustedReturn(run);
  const valueAtRiskPct =
    run.riskMetrics.valueAtRisk === null
      ? null
      : run.riskMetrics.valueAtRisk.abs().mul(HUNDRED);
  const fees = decimalFromString(run.result.totalFees.toString());
  const rebalanceCount = countRebalances(run);

  const values: Record<ComparisonMetricKey, Decimal | null> = {
    startingCapital,
    finalValue,
    pnl,
    returnPct,
    maxDrawdownPct,
    annualizedSharpe,
    valueAtRiskPct,
    fees,
    rebalanceCount,
  };

  const regime = declaredRegime(run);
  const cells = {} as Record<ComparisonMetricKey, ComparisonCell>;
  for (const column of COMPARISON_COLUMNS) {
    cells[column.key] = {
      value: values[column.key],
      formatted: formatMetric(values[column.key], column.unit),
      mark: null,
    };
  }

  return {
    runId: run.id,
    strategyId: run.scenario.strategy.id,
    regime,
    label: regime ?? run.scenario.strategy.id,
    window: {
      start: run.scenario.window.start,
      end: run.scenario.window.end,
    },
    values,
    cells,
  };
}

function annualizedRiskAdjustedReturn(run: RunRecord): Decimal | null {
  const perPeriod = run.riskMetrics.sharpeRatio;
  if (perPeriod === null) return null;
  const periods = periodsPerYear(run.scenario.window.step);
  if (periods === null) return null;
  return annualizeSharpe(perPeriod, periods);
}

function periodsPerYear(step: string): number | null {
  let milliseconds: number;
  try {
    milliseconds = durationToMilliseconds(step);
  } catch {
    return null;
  }
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return null;
  return (DAYS_PER_YEAR * 24 * 60 * 60 * 1000) / milliseconds;
}

/**
 * Records do not preserve the engine's event counts, so a rebalance is counted
 * as a tick whose recorded position set differs from the previous tick. Equal
 * position sets are left alone, which keeps a no-op tick from inflating the
 * count.
 */
function countRebalances(run: RunRecord): Decimal {
  const snapshots = run.result.snapshots;
  let count = 0;
  let previous =
    snapshots[0] === undefined ? null : positionSignature(snapshots[0]);
  for (let index = 1; index < snapshots.length; index += 1) {
    const snapshot = snapshots[index];
    if (snapshot === undefined) continue;
    const signature = positionSignature(snapshot);
    if (signature !== previous) count += 1;
    previous = signature;
  }
  return Decimal.fromBigInt(BigInt(count), 0);
}

function positionSignature(snapshot: {
  readonly positions: readonly {
    readonly asset: string;
    readonly memberId?: string;
    readonly size: { toString(): string };
    readonly basis: { toString(): string };
  }[];
}): string {
  return snapshot.positions
    .map(
      (position) =>
        `${position.asset}:${position.memberId ?? ""}:${position.size.toString()}:${position.basis.toString()}`
    )
    .sort()
    .join("|");
}

function groupRows(rows: readonly ComparisonRow[]): ComparisonGroup[] {
  const groups = new Map<string | null, ComparisonRow[]>();
  for (const row of rows) {
    const existing = groups.get(row.regime);
    if (existing === undefined) {
      groups.set(row.regime, [row]);
    } else {
      existing.push(row);
    }
  }

  return [...groups.entries()]
    .sort(([left], [right]) => {
      // Declared regimes are listed first, in first-seen order; undeclared
      // runs stay last rather than being assigned a made-up regime.
      if (left === null) return right === null ? 0 : 1;
      if (right === null) return -1;
      return 0;
    })
    .map(([regime, groupRowsForRegime]) => ({
      regime,
      label: regime === null ? "No declared regime" : titleCase(regime),
      rows: groupRowsForRegime,
    }));
}

function markBestAndWorst(rows: MutableComparisonRow[]): void {
  for (const column of COMPARISON_COLUMNS) {
    if (column.direction === "neutral") continue;

    const values = rows
      .map((row) => row.values[column.key])
      .filter((value): value is Decimal => value !== null);
    if (values.length < 2) continue;

    let best = values[0];
    let worst = values[0];
    if (best === undefined || worst === undefined) continue;
    for (const value of values) {
      if (column.direction === "higher") {
        if (value.gt(best)) best = value;
        if (value.lt(worst)) worst = value;
      } else {
        if (value.lt(best)) best = value;
        if (value.gt(worst)) worst = value;
      }
    }
    if (best.eq(worst)) continue;

    for (const row of rows) {
      const value = row.values[column.key];
      if (value === null) continue;
      const current = row.cells[column.key];
      if (value.eq(best)) {
        row.cells[column.key] = { ...current, mark: "best" };
      } else if (value.eq(worst)) {
        row.cells[column.key] = { ...current, mark: "worst" };
      }
    }
  }
}

function decimalFromString(value: string): Decimal {
  return Decimal.fromString(value, 18);
}

function formatMetric(value: Decimal | null, unit: MetricUnit): string {
  if (value === null) return "—";
  switch (unit) {
    case "currency":
      return value.toString();
    case "percent":
      return `${value.toFixed(2)}%`;
    case "ratio":
      return value.toFixed(2);
    case "count":
      return value.toString();
  }
}

function titleCase(value: string): string {
  return value
    .split(/[\s_-]+/)
    .map((part) =>
      part.length === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)
    )
    .join(" ");
}

/** Metric keys in column order, for callers that iterate the model. */
export const COMPARISON_METRIC_KEYS: readonly ComparisonMetricKey[] =
  METRIC_KEYS;
