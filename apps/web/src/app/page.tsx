"use client";
import { useState } from "react";
type Result = {
  plan: { goal:string; metric:string; dimensions:string[]; filters:string[]; timeRange:string|null; chartType:string; needsClarification:boolean; clarificationQuestion:string|null };
  queryDraft:string; warnings:string[];
};
const examples = ["Show monthly revenue by region for the last 6 months", "Which 10 products have the highest number of orders?", "Compare cancelled and completed orders this quarter"];
export default function Home() {
  const [question,setQuestion] = useState(examples[0]);
  const [databaseKind,setDatabaseKind] = useState("postgres");
  const [schemaContext,setSchemaContext] = useState("orders(id, customer_id, region, product_id, total_amount, status, created_at)\\nproducts(id, name, category)");
  const [result,setResult] = useState<Result|null>(null);
  const [error,setError] = useState("");
  const [loading,setLoading] = useState(false);
  async function generate() {
    setLoading(true); setError(""); setResult(null);
    try {
      const response = await fetch("http://127.0.0.1:4000/api/analytics/plan", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body:JSON.stringify({question,databaseKind,schemaContext})
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Request failed");
      setResult(body as Result);
    } catch(e) { setError(e instanceof Error ? e.message : "Could not reach API"); }
    finally { setLoading(false); }
  }
  return <main className="shell">
    <header className="topbar"><a className="brand" href="#"><span className="brand-mark">V</span>VichaarIQ</a><span className="status"><i/> Agent workspace</span></header>
    <section className="hero"><p className="eyebrow">BUSINESS INTELLIGENCE, IN PLAIN ENGLISH</p><h1>Your data has answers.</h1><p>Ask a question. VichaarIQ turns it into an analysis plan and a query draft you can review.</p></section>
    <section className="workspace">
      <div className="panel">
        <div className="heading"><span className="step">01</span><h2>Ask a question</h2></div>
        <label htmlFor="question">What would you like to understand?</label>
        <textarea id="question" rows={3} value={question} onChange={e=>setQuestion(e.target.value)} />
        <p className="mini-label">TRY AN EXAMPLE</p><div className="examples">{examples.map(x=><button key={x} onClick={()=>setQuestion(x)}>{x}<span>↗</span></button>)}</div>
        <div className="divider"/>
        <div className="heading"><span className="step">02</span><h2>Data source context</h2><small>Schema only</small></div>
        <label htmlFor="db">Database type</label>
        <select id="db" value={databaseKind} onChange={e=>setDatabaseKind(e.target.value)}><option value="postgres">PostgreSQL</option><option value="mysql">MySQL</option><option value="sqlite">SQLite</option><option value="mongodb">MongoDB</option></select>
        <label htmlFor="schema">Tables / collections and fields</label><textarea id="schema" className="schema" rows={4} value={schemaContext} onChange={e=>setSchemaContext(e.target.value)}/>
        <button className="primary" disabled={loading||!question.trim()||!schemaContext.trim()} onClick={generate}>{loading?"Thinking through your question…":"Generate analysis plan →"}</button>
        <p className="note">✦ Schema text is sent to your configured API model. No customer database is queried.</p>
      </div>
      <div className="panel results">
        <div className="heading"><span className="step">03</span><h2>Analysis preview</h2><small className="badge">PREVIEW</small></div>
        {!result&&!error&&<div className="empty"><div className="art"><span/><span/><span/><b>✳</b></div><h3>Clarity starts with a question.</h3><p>Your analysis plan and query draft will appear here. You can review them before query execution is added.</p><small>⌘ Plan · Query draft · Explanation</small></div>}
        {error&&<div className="error"><b>Couldn’t generate a plan</b><p>{error}</p><small>Check the API and OPENAI_API_KEY in the root .env.</small></div>}
        {result&&<div className="output">
          {result.plan.needsClarification&&<div className="callout"><b>One detail to clarify</b><p>{result.plan.clarificationQuestion}</p></div>}
          <section><small>ANALYSIS GOAL</small><h3>{result.plan.goal}</h3></section>
          <div className="metrics"><div><small>METRIC</small><p>{result.plan.metric}</p></div><div><small>SUGGESTED CHART</small><p><em>{result.plan.chartType}</em></p></div></div>
          <section><small>BREAKDOWN</small><div className="tags">{result.plan.dimensions.map(x=><span key={x}>{x}</span>)}</div></section>
          <section><small>FILTERS</small><div className="tags">{result.plan.filters.map(x=><span key={x}>{x}</span>)}</div>{result.plan.timeRange&&<p className="time">Time range · {result.plan.timeRange}</p>}</section>
          <section><small>QUERY DRAFT · NOT EXECUTED</small><pre>{result.queryDraft}</pre></section>
          <section><small>SAFETY NOTE</small><p className="time">{result.warnings.join(" ")}</p></section>
        </div>}
      </div>
    </section>
    <footer><span>VichaarIQ</span><span>Built for thoughtful decisions.</span><span>Phase 2 · Agent prototype</span></footer>
  </main>;
}
