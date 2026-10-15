import { formatValue, humanize } from "../../lib/analytics";
import type { VisualizationResult } from "../../lib/visualization";

export function DataTable({ data, sample }: { data: VisualizationResult; sample: boolean }) {
  return <div className="table-scroll" role="region" aria-label={sample ? "Sample sales data table" : "Executed query results table"} tabIndex={0}>
    <table className="data-table"><caption className="sr-only">{sample ? "Sample sales data — not queried from your database" : "Rows returned by the executed query"}</caption>
      <thead><tr>{data.columns.map((column) => <th scope="col" key={column}>{humanize(column)}</th>)}</tr></thead>
      <tbody>{data.rows.map((row, index) => <tr key={index}>{data.columns.map((column) =>
        <td key={column} title={formatValue(row[column])}>{formatValue(row[column])}</td>)}</tr>)}</tbody>
    </table>
  </div>;
}
