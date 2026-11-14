import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Gafood — Quy trình",
  description: "Demo Next.js và NestJS chạy mọi deployment BPMN trên Operaton.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
