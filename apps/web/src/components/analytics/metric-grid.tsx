import type { MetricCard } from "../../lib/analytics";
import { formatValue } from "../../lib/analytics";
import { Icon } from "../icon";

export function MetricGrid({ cards, summary = false }: { cards: MetricCard[]; summary?: boolean }) {
  return <div className="metric-grid" aria-label={summary ? "Result summary" : "Key metrics"}>
    {cards.map((card, index) => <article className="surface metric-card" key={card.label}>
      <div className="metric-top"><span>{card.label}</span><Icon name={summary ? "table" : index === 1 ? "layers" : "metric"} /></div>
      <strong className="metric-value">{formatValue(card.value)}</strong>
      <div className="metric-detail">{card.sample && <span className="sample-tag">Sample</span>}<span>{card.detail}</span></div>
    </article>)}
  </div>;
}
