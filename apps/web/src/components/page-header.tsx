import { WorkspaceStatus } from "./workspace-status";

export function PageHeader({ title, description, children }: {
  title: string; description: string; children?: React.ReactNode;
}) {
  return <header className="page-header"><div><div className="page-eyebrow">YOUR ANALYTICS WORKSPACE</div>
    <h1>{title}</h1><p>{description}</p></div><div className="header-actions"><WorkspaceStatus />{children}</div></header>;
}
