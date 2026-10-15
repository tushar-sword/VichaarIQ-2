"use client";

import { useState } from "react";
import Link from "next/link";
import type { DatabaseKind } from "@vichaar/shared";
import { useWorkspace } from "../../state/workspace-provider";
import { PageHeader } from "../../components/page-header";
import { ErrorNotice } from "../../components/feedback";
import { Icon } from "../../components/icon";

export default function DataSources() {
  const { connection, schemaContext, setSchemaContext, databaseKind, setDatabaseKind,
    connectDatabase, disconnectDatabase, connectionMessage } = useWorkspace();
  // 📌 REAL DATABASE: credentials live only in this form, never browser storage or AI input.
  const [connectionString, setConnectionString] = useState("");
  const connected = connection.status === "connected";
  const pending = connection.status === "connecting" || connection.status === "disconnecting";
  return <>
    <PageHeader title="Data Sources" description="Connect your data. Give every question the right context." />
    <ErrorNotice />
    <div className="sources-grid">
      <section className="surface source-panel"><div className="source-heading"><span className="source-symbol"><Icon name="database" /></span><span className="subtle-badge">EXECUTION AVAILABLE</span></div>
        <h2>PostgreSQL</h2><p className="source-description">Connect a database to discover its schema and run validated, read-only analytics.</p>
        {connected ? <div className="connected-details"><div className="notice notice-connected"><Icon name="check" /><div><strong>PostgreSQL connected</strong><p>Your connection details are hidden. Analytics use this database.</p></div></div>
          <Link className="button button-primary" href="/ask">Ask your data <Icon name="arrow" /></Link>
          <button type="button" className="button button-secondary" onClick={() => { setConnectionString(""); void disconnectDatabase(); }}>Disconnect and return to demo</button></div>
          : <form className="connection-form" onSubmit={async (event) => {
            event.preventDefault();
            const value = connectionString;
            setConnectionString("");
            await connectDatabase(value);
          }}>
            <label htmlFor="connection-string">PostgreSQL connection string</label>
            <input id="connection-string" type="password" value={connectionString} onChange={(event) => setConnectionString(event.target.value)}
              autoComplete="off" spellCheck={false} placeholder="postgresql://user:password@host:5432/database" disabled={pending} aria-describedby="connection-help" />
            <p id="connection-help" className="field-help">Use a dedicated read-only database account. Credentials go only to your API and are never saved in browser storage.</p>
            <button className="button button-primary" type="submit" disabled={pending || !connectionString.trim()}>{pending && <span className="spinner" aria-hidden="true" />}
              {connection.status === "connecting" ? "Connecting…" : connection.status === "disconnecting" ? "Disconnecting…" : "Connect PostgreSQL"}{!pending && <Icon name="arrow" />}</button>
          </form>}
        {connectionMessage && <p className="source-message" role="status">{connectionMessage}</p>}
      </section>
      <section className="surface source-panel demo-source"><div className="source-heading"><span className="source-symbol neutral"><Icon name="layers" /></span><span className="sample-tag">DEMO MODE</span></div>
        <h2>A workspace to explore</h2><p className="source-description">Explore four ready-to-run e-commerce scenarios using clearly labelled synthetic 2025 data. No OpenAI connection is required.</p>
        {/* 📌 MOCK DATA: disconnected starter questions select named synthetic scenarios. */}
        <div className="source-facts"><div><span>Dashboard preview</span><strong>DEMO / SYNTHETIC DATA</strong></div><div><span>Query execution</span><strong>Disabled in demo mode</strong></div></div>
        <label htmlFor="planning-kind">Database type for planning</label>
        <select id="planning-kind" value={databaseKind} disabled={connected || pending} onChange={(event) => setDatabaseKind(event.target.value as DatabaseKind)}>
          <option value="postgres">PostgreSQL</option><option value="mysql">MySQL · planning only</option><option value="sqlite">SQLite · planning only</option><option value="mongodb">MongoDB · planning only</option>
        </select>
        <p className="field-help">PostgreSQL is the only database that currently supports execution. Other database options are planning-only. Offline demo questions use fixed PostgreSQL examples.</p>
        <Link className="button button-secondary" href="/dashboard">{connected ? "View dashboard" : "Explore sample dashboard"}<Icon name="arrow" /></Link>
      </section>
    </div>
    <section className="surface schema-panel"><div className="panel-header"><div><div className="section-eyebrow">SCHEMA CONTEXT</div><h2>{connected ? "Your database schema" : "Example e-commerce schema"}</h2>
      <p>{connected ? "Discovered from PostgreSQL. The API refreshes this authoritative schema before each analysis." : "The offline starter scenarios use a fixed e-commerce schema. Connect PostgreSQL to discover and analyze real tables."}</p></div><Icon name="table" /></div>
      <div className="schema-editor"><label htmlFor="schema">Tables / collections and fields</label>
        <textarea id="schema" className="schema-input" rows={7} value={schemaContext} maxLength={12000} disabled={pending} readOnly={connected}
          onChange={(event) => setSchemaContext(event.target.value)} aria-describedby="schema-help" />
        <div className="schema-footnote"><p id="schema-help">Share schema names and types here. Keep credentials in the connection form.</p><span>{schemaContext.length.toLocaleString()} / 12,000</span></div></div>
    </section>
  </>;
}
