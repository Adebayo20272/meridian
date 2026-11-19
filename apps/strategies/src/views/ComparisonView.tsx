import { useMemo, useState } from "react";
import { buildComparison } from "../lib/comparison";
import type { ComparisonRow } from "../lib/comparison";
import type { RunRecord } from "../lib/run-history";

interface ComparisonViewProps {
  /** Every completed run in the local run history. */
  readonly runs: readonly RunRecord[];
  /** Switches the app to the history view from the empty state. */
  readonly onNavigateToHistory?: () => void;
}

export function ComparisonView({
  runs,
  onNavigateToHistory,
}: ComparisonViewProps) {
  const [selectedIds, setSelectedIds] = useState<readonly string[]>(() =>
    runs.slice(0, 2).map((run) => run.id)
  );

  const selectedRuns = useMemo(
    () => runs.filter((run) => selectedIds.includes(run.id)),
    [runs, selectedIds]
  );
  const model = useMemo(() => buildComparison(selectedRuns), [selectedRuns]);

  const toggleRun = (id: string) => {
    setSelectedIds((current) =>
      current.includes(id)
        ? current.filter((runId) => runId !== id)
        : [...current, id]
    );
  };

  return (
    <div className="view" data-testid="view-comparison">
      <div className="view__header">
        <h2 className="view__title">Comparison</h2>
        <p className="view__description">
          Compare completed simulation runs across strategies and market
          regimes. Percentage metrics are normalized per run, so different
          starting capital does not flatter a result.
        </p>
      </div>

      {runs.length > 0 && (
        <fieldset className="comparison-selector">
          <legend className="comparison-selector__legend">
            Runs from history ({selectedIds.length} selected)
          </legend>
          <ul className="comparison-selector__list">
            {runs.map((run) => {
              const checked = selectedIds.includes(run.id);
              return (
                <li key={run.id}>
                  <label
                    className={`comparison-selector__option ${
                      checked ? "comparison-selector__option--checked" : ""
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleRun(run.id)}
                      data-testid={`compare-run-${run.id}`}
                    />
                    <span className="comparison-selector__run">
                      <span className="comparison-selector__strategy">
                        {run.scenario.strategy.id}
                      </span>
                      <span className="comparison-selector__meta">
                        {run.scenario.window.start.slice(0, 10)} to{" "}
                        {run.scenario.window.end.slice(0, 10)} · final{" "}
                        {run.result.finalValue.toString()}
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </fieldset>
      )}

      {model.hasEnoughRuns ? (
        <ComparisonTable model={model} />
      ) : (
        <div className="empty-state" data-testid="empty-comparison">
          <div className="empty-state__icon" aria-hidden="true">
            <svg
              width="36"
              height="36"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z"
              />
            </svg>
          </div>
          <h3 className="empty-state__title">
            {runs.length === 0
              ? "No completed runs to compare"
              : "Select at least two runs"}
          </h3>
          <p className="empty-state__body">
            {runs.length === 0
              ? "Completed simulation runs are saved in run history. Once two runs exist, they can be compared here."
              : "A comparison needs two or more completed runs. Select another run, or review what is saved in run history."}
          </p>
          <a
            className="empty-state__link"
            href="#history"
            onClick={(event) => {
              if (onNavigateToHistory !== undefined) {
                event.preventDefault();
                onNavigateToHistory();
              }
            }}
            data-testid="comparison-history-link"
          >
            Go to run history
          </a>
        </div>
      )}
    </div>
  );
}

function ComparisonTable({
  model,
}: {
  readonly model: ReturnType<typeof buildComparison>;
}) {
  return (
    <div className="comparison-table-wrap">
      <table className="comparison-table" data-testid="comparison-table">
        <caption className="comparison-table__caption">
          Completed runs compared by strategy, regime, and normalized
          performance. Best and worst values in each metric column are marked.
        </caption>
        <thead>
          <tr>
            <th scope="col">Strategy</th>
            <th scope="col">Regime</th>
            <th scope="col">Window</th>
            {model.columns.map((column) => (
              <th scope="col" key={column.key}>
                <span className="comparison-table__metric">{column.label}</span>
                <span className="comparison-table__direction">
                  {column.better}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        {model.groups.map((group) => (
          <tbody key={group.regime ?? "undeclared"}>
            <tr className="comparison-table__group">
              <th
                scope="colgroup"
                colSpan={3 + model.columns.length}
                data-testid={`comparison-group-${group.regime ?? "undeclared"}`}
              >
                {group.label}
              </th>
            </tr>
            {group.rows.map((row) => (
              <ComparisonTableRow
                key={row.runId}
                row={row}
                columns={model.columns}
              />
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}

function ComparisonTableRow({
  row,
  columns,
}: {
  readonly row: ComparisonRow;
  readonly columns: ReturnType<typeof buildComparison>["columns"];
}) {
  return (
    <tr data-testid={`comparison-row-${row.runId}`}>
      <th scope="row" className="comparison-table__strategy">
        {row.strategyId}
      </th>
      <td>
        {row.regime === null ? (
          <span className="comparison-table__undeclared">Not declared</span>
        ) : (
          row.regime
        )}
      </td>
      <td className="comparison-table__window">
        {row.window.start.slice(0, 10)} to {row.window.end.slice(0, 10)}
      </td>
      {columns.map((column) => {
        const cell = row.cells[column.key];
        return (
          <td
            key={column.key}
            className={`comparison-table__value ${
              cell.mark === null ? "" : `comparison-table__value--${cell.mark}`
            }`}
            data-mark={cell.mark ?? "none"}
          >
            {cell.formatted}
            {cell.mark !== null && (
              <span className="comparison-table__mark">
                <span aria-hidden="true">
                  {cell.mark === "best" ? "▲" : "▼"}
                </span>
                <span className="comparison-table__mark-text">
                  {cell.mark === "best" ? "Best" : "Worst"}
                </span>
              </span>
            )}
          </td>
        );
      })}
    </tr>
  );
}
