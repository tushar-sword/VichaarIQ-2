"use client";

import Link from "next/link";
import { useWorkspace } from "../../state/workspace-provider";
import { DEMO_SCENARIOS } from "../../lib/demo-data";
import { PageHeader } from "../../components/page-header";
import { ErrorNotice } from "../../components/feedback";
import { AnalysisPlan } from "../../components/analysis-plan";
import { Icon } from "../../components/icon";

export default function Ask() {
  const { question, setQuestion, schemaContext, connection, databaseKind, generate, executionStatus, plan, result } = useWorkspace();
  const busy = executionStatus === "planning" || executionStatus === "executing";
  const sourceBusy = connection.status === "connecting" || connection.status === "disconnecting";
  const real = connection.status === "connected";
  // 📌 MOCK DATA / 📌 REAL DATABASE: navigation reflects a completed result from the current source.
  const resultsReady = executionStatus === "succeeded" && !plan?.plan.needsClarification && result && (
    result.source === "mock" ? connection.status === "demo"
      : connection.status === "connected" && result.connectionId === connection.connectionId);
  return <>
    <PageHeader title="Ask VichaarIQ" description="Start with a question. Find the story in your data." />
    <div className="ask-workspace">
      <ErrorNotice />
      {resultsReady && <div className="analysis-complete" role="status"><div><span className="completion-icon"><Icon name="check" /></span>
        <div><strong>{result.source === "mock" ? "Your synthetic demo results are ready." : "Your database results are ready."}</strong>
          <p>{result.source === "mock" ? result.title || "Explore the selected 2025 sample analysis." : "Explore the rows returned by your successful query."}</p></div></div>
        <Link className="button button-primary" href="/dashboard">View Dashboard <Icon name="arrow" /></Link></div>}
      <section className="surface question-panel"><div className="question-heading"><span className="question-symbol"><Icon name="sparkles" /></span>
        <div><h2>What would you like to understand?</h2><p>Describe a metric, a comparison, or a trend in plain English.</p></div></div>
        <form onSubmit={(event) => { event.preventDefault(); void generate(); }}>
          <label className="sr-only" htmlFor="question">Your analytics question</label>
          <textarea id="question" className="question-input" value={question} onChange={(event) => setQuestion(event.target.value)}
            rows={4} maxLength={2000} placeholder="For example, how has revenue changed over the last six months?" disabled={sourceBusy} />
          <div className="question-toolbar"><Link className="question-source" href="/data-sources"><Icon name="database" />
            {real ? "PostgreSQL · connected" : `${databaseKind === "postgres" ? "PostgreSQL" : databaseKind === "mongodb" ? "MongoDB" : databaseKind === "mysql" ? "MySQL" : "SQLite"} · DEMO / SYNTHETIC DATA`}</Link>
            <button className="button button-primary" type="submit" disabled={busy || sourceBusy || question.trim().length < 3 || schemaContext.trim().length < 3}>
              {busy && <span className="spinner" aria-hidden="true" />}{busy ? executionStatus === "executing" ? "Running query…" : "Planning analysis…" : "Analyze question"}{!busy && <Icon name="arrow" />}
            </button></div>
        </form>
        <p className="question-caption">{real ? "Your query is validated and executed read-only against PostgreSQL."
          : "DEMO / SYNTHETIC DATA · The four starter questions work offline without PostgreSQL or OpenAI. Other questions require a real database and AI analysis."}</p>
      </section>
      {/* 📌 MOCK DATA: only these explicit scenarios are supported without AI or a database. */}
      <section className="example-section" aria-label="Example questions"><div className="section-heading"><h2>A few places to start</h2><span>{real ? "Questions for the 2025 e-commerce fixture" : "Four ready-to-run synthetic 2025 demos"}</span></div>
        <div className="example-grid">{DEMO_SCENARIOS.map((scenario) => <button className="example-card" type="button" key={scenario.id} data-demo-scenario={scenario.id}
          disabled={sourceBusy || busy} onClick={() => setQuestion(scenario.question)}><span className="example-kicker">{scenario.kicker}</span>
          <span>{scenario.question}</span><Icon name="arrow" /></button>)}</div>
      </section>
      {busy && <div className="analysis-progress" role="status" aria-live="polite"><span className="spinner" aria-hidden="true" />
        {executionStatus === "executing" ? "Plan complete. Validating and executing your query…" : "Building an analysis plan from your question and schema…"}</div>}
      <AnalysisPlan />
      {!plan && !busy && <div className="ask-footer"><Icon name="layers" /><p>{real ? "Every insight starts with your schema. " : "Select a starter question and choose Analyze question. "}<Link href="/data-sources">Review your data source</Link> for live analysis.</p></div>}
    </div>
  </>;
}
