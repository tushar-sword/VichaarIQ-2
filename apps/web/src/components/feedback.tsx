"use client";

import Link from "next/link";
import { useWorkspace } from "../state/workspace-provider";
import { Icon } from "./icon";

export function ErrorNotice() {
  const { error } = useWorkspace();
  if (!error) return null;
  return <div className="notice notice-error" role="alert"><Icon name="warning" /><div><strong>Something needs attention</strong><p>{error}</p></div></div>;
}

export function ResultState() {
  const { connection, executionStatus } = useWorkspace();
  const loading = connection.status === "connecting" || ["planning", "executing"].includes(executionStatus);
  const title = connection.status === "connecting" ? "Connecting to your database"
    : executionStatus === "planning" ? "Making a plan for your question"
    : executionStatus === "executing" ? "Running your read-only query"
    : executionStatus === "clarification-required" ? "One detail before we continue"
    : executionStatus === "error" ? "This analysis couldn’t be completed"
    : connection.status === "connected" ? "Connected — run an analysis" : "Your next insight starts with a question";
  const description = loading ? "Your results will appear here when the analysis completes."
    : executionStatus === "clarification-required" ? "Answer the clarification in Ask VichaarIQ, then analyze again. No query has been executed."
    : executionStatus === "error" ? "Previous results have been cleared. Review your question or data source and try again."
    : "Ask VichaarIQ what you’d like to understand. Your chart and table will be built from the returned results.";
  return <section className="surface result-state" aria-live="polite" aria-busy={loading}>
    <div className={`empty-symbol ${loading ? "is-loading" : ""}`}><Icon name={executionStatus === "error" ? "warning" : "chart"} /></div>
    <h2>{title}</h2><p>{description}</p>
    {!loading && <Link className="button button-primary" href="/ask">Ask VichaarIQ <Icon name="arrow" /></Link>}
  </section>;
}
