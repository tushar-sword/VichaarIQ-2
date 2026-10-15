"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useWorkspace } from "../state/workspace-provider";
import { Icon } from "./icon";

const navigation = [
  { href: "/dashboard", label: "Dashboard", icon: "dashboard" },
  { href: "/ask", label: "Ask VichaarIQ", icon: "sparkles" },
  { href: "/data-sources", label: "Data Sources", icon: "database" },
] as const;

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { connection } = useWorkspace();
  const connected = connection.status === "connected";
  const pending = connection.status === "connecting" || connection.status === "disconnecting";
  return <div className="app-shell">
    <a className="skip-link" href="#main-content">Skip to content</a>
    <aside className="sidebar">
      <Link href="/dashboard" className="brand" aria-label="VichaarIQ dashboard">
        <span className="brand-mark">V<span /></span><span>Vichaar<span className="brand-iq">IQ</span></span>
      </Link>
      <div className="workspace-name"><span className="workspace-avatar">W</span><div>Analytics workspace<small>Your data, in perspective</small></div></div>
      <nav className="primary-nav" aria-label="Main navigation">
        <p className="nav-label">WORKSPACE</p>
        {navigation.map((item) => <Link key={item.href} href={item.href}
          className={`nav-item ${pathname === item.href ? "active" : ""}`}
          aria-current={pathname === item.href ? "page" : undefined}>
          <Icon name={item.icon} /><span>{item.label}</span>
        </Link>)}
      </nav>
      <div className="sidebar-bottom">
        <Link href="/data-sources" className="source-status"><span className={`status-dot ${connected ? "is-connected" : ""}`} />
          <div>{pending ? "Updating connection…" : connected ? "PostgreSQL connected" : "Demo workspace"}<small>{connected ? "Read-only analytics" : "Sample sales data"}</small></div>
        </Link>
        <p className="sidebar-footer">A little clarity goes a long way.</p>
      </div>
    </aside>
    <div className="main-area">
      <div className="workspace-topbar"><span>VichaarIQ <span className="breadcrumb-divider">/</span> Workspace</span><span className="topbar-caption">Business intelligence, thoughtfully.</span></div>
      <main id="main-content" className="page-content" tabIndex={-1}>{children}</main>
      <footer className="app-footer"><span>VichaarIQ</span><span>Built for thoughtful decisions.</span></footer>
    </div>
  </div>;
}
