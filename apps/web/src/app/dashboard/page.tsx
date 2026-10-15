"use client";

import Link from "next/link";
import { useWorkspace } from "../../state/workspace-provider";
import { metricCards, summaryCards } from "../../lib/analytics";
import { PageHeader } from "../../components/page-header";
import { ErrorNotice, ResultState } from "../../components/feedback";
import { MetricGrid } from "../../components/analytics/metric-grid";
import { AnalyticsView } from "../../components/analytics/analytics-view";
import { Icon } from "../../components/icon";

export default function Dashboard() {
  const { result, plan } = useWorkspace();
  const metrics = result ? metricCards(result) : [];
  const sample = result?.source === "mock";
  return <>
    <PageHeader title="Dashboard" description="A clear view of your data. Room for your next insight.">
      <Link className="button button-primary" href="/ask"><Icon name="sparkles" />Ask VichaarIQ</Link>
    </PageHeader>
    <ErrorNotice />
    {result ? <>
      {sample ? <div className="notice notice-demo"><Icon name="layers" /><div><strong>DEMO / SYNTHETIC DATA</strong>
        <p>All metrics, charts, and rows below use synthetic 2025 e-commerce data. <Link href="/data-sources">Connect PostgreSQL</Link> for real analysis.</p></div></div>
        : <div className="analysis-context"><span className="section-eyebrow">YOUR QUESTION</span><p>{result.question}</p><Link href="/ask">View analysis <Icon name="arrow" /></Link></div>}
      <div className="section-heading"><h2>{metrics.length ? sample ? "Sample key metrics" : "Returned metrics" : "Result summary"}</h2>
        <span>{sample ? "Synthetic sample period · 2025" : "From the executed query"}</span></div>
      {/* 📌 MOCK DATA / 📌 REAL DATABASE: the metric helper keeps these boundaries explicit. */}
      <MetricGrid cards={metrics.length ? metrics : summaryCards(result)} summary={!metrics.length} />
      {result.data.truncated && <div className="notice notice-warning" role="status"><Icon name="warning" /><div><strong>This result is limited.</strong>
        <p>The API returned {result.data.rowCount} rows. The chart and table show this subset; row summaries are not full-dataset totals.</p></div></div>}
      <AnalyticsView key={sample ? result.scenarioId || result.question || "demo" : result.sql} result={result} question={result.question || ""} metrics={metrics} />
      {sample && plan && <p className="dashboard-note">This scenario’s demo plan is available in <Link href="/ask">Ask VichaarIQ</Link>. Its matching synthetic rows were selected offline; the draft was not executed.</p>}
    </> : <ResultState />}
  </>;
}
