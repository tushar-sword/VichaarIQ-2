import type { Metadata } from "next";
import "./globals.css";
import { WorkspaceProvider } from "../state/workspace-provider";
import { AppShell } from "../components/app-shell";
export const metadata: Metadata = {
  title: "VichaarIQ — Ask your data",
  description: "A thoughtful workspace for asking questions, exploring data, and making better decisions."
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><WorkspaceProvider><AppShell>{children}</AppShell></WorkspaceProvider></body></html>;
}
