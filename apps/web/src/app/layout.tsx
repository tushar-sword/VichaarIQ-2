import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "VichaarIQ — Ask your data",
  description: "Turn business questions into analysis plans and query drafts."
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
