"use client";

import Link from "next/link";
import { useWorkspace } from "../state/workspace-provider";
import { humanize } from "../lib/analytics";
import { Icon } from "./icon";

function Details({ label, values, empty }: { label: string; values: string[]; empty: string }) {
  return <div className="plan-detail"><dt>{label}</dt><dd>{values.length
    ? <div className="tags">{values.map((value, index) => <span key={`${index}-${value}`}>{value}</span>)}</div> : empty}</dd></div>;
}

export function AnalysisPlan() {
  const { plan: response, executionStatus, connection, result } = useWorkspace();
  if (!response) return null;
  const { plan, queryDraft, warnings } = response;
  const real = connection.status === "connected";
  const resultsReady = executionStatus === "succeeded" && !plan.needsClarification && result && (
    result.source === "mock" ? connection.status === "demo"
      : connection.status === "connected" && result.connectionId === connection.connectionId);
  return <div className="analysis-output">
    {plan.needsClarification && <section className="notice notice-warning" role="status"><Icon name="sparkles" /><div>
      <strong>One detail to clarify</strong><p>{plan.clarificationQuestion || "Please add more detail to your question."}</p>
      <p>Update the question above and analyze again. No query has been executed.</p></div></section>}
    <section className="surface plan-panel"><div className="panel-header"><div><div className="section-eyebrow">ANALYSIS PLAN</div><h2>{plan.goal}</h2></div><span className="subtle-badge">{humanize(plan.chartType)} suggested</span></div>
      <dl className="plan-details"><div className="plan-detail"><dt>Metric</dt><dd>{plan.metric}</dd></div>
        <div className="plan-detail"><dt>Time range</dt><dd>{plan.timeRange ?? "No specific time range"}</dd></div>
        <Details label="Dimensions" values={plan.dimensions} empty="No grouping" />
        <Details label="Filters" values={plan.filters} empty="No additional filters" />
      </dl>
    </section>
    <section className="surface query-panel"><div className="panel-header"><div><div className="section-eyebrow">{real ? "POSTGRESQL" : "QUERY PREVIEW"}</div>
      <h2>Query draft</h2><p>{plan.needsClarification ? "Drafting is paused until the question is clarified."
        : real ? executionStatus === "succeeded" ? "This query executed successfully." : "Validation and read-only execution are handled by your API."
        : "Offline demo preview. This illustrative query is not executed against a database."}</p></div><Icon name="database" /></div>
      <pre className="query-code" tabIndex={0} aria-label="Generated query draft"><code>{queryDraft || "No query drafted — clarification required."}</code></pre>
      {/* 📌 REAL DATABASE: success is reported only after execution; draft text is never a result. */}
      {real && executionStatus === "error" && <p className="query-note">This attempt failed. No successful query results are displayed.</p>}
      {/* 📌 MOCK DATA: a named scenario selects synthetic rows; this draft is never executed. */}
      {!real && <p className="query-note">DEMO / SYNTHETIC DATA · The selected starter scenario supplies the matching chart and rows. No OpenAI or PostgreSQL call was made.</p>}
      {warnings.length > 0 && <div className="query-notes"><h3>Analysis notes</h3><ul>{warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></div>}
    </section>
    {resultsReady && <div className="analysis-complete"><div><span className="completion-icon"><Icon name="check" /></span>
      <div><strong>{result.source === "postgres" ? "Your results are ready." : "Your synthetic demo results are ready."}</strong><p>{result.source === "postgres" ? "Explore the returned data in your dashboard." : "Explore this scenario’s matching sample visualization and rows."}</p></div></div>
      <Link className="button button-primary" href="/dashboard">View Dashboard <Icon name="arrow" /></Link></div>}
  </div>;
}
