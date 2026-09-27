import type { Metadata } from "next";
import { IBM_Plex_Mono, Plus_Jakarta_Sans } from "next/font/google";
import { Toaster } from "sonner";
import { Sidebar } from "@/components/sidebar";
import { Topbar } from "@/components/topbar";
import { SystemStatusProvider } from "@/components/system-status-provider";
import { PanelAtmosphere } from "@/components/panel-atmosphere";
import { PanelFrame } from "@/components/panel-frame";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-jakarta",
});

const ibmMono = IBM_Plex_Mono({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500"],
  variable: "--font-ibm-plex-mono",
});

export const metadata: Metadata = {
  title: "ByHickimse Sinema Stüdyosu",
  description: "ByHickimse Sinema Stüdyosu — görsel anlatı ve sinema film üretimi",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr" className={`${jakarta.variable} ${ibmMono.variable}`}>
      <body className="min-h-screen font-sans antialiased">
        <a
          href="#content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-[10px] focus:bg-surface focus:px-4 focus:py-2 focus:text-[13px] focus:font-semibold focus:text-primary focus:elevated"
        >
          Icerige gec
        </a>
        <PanelAtmosphere />
        <SystemStatusProvider>
          <div className="relative z-10 flex min-h-screen">
            <Sidebar />
            <div className="flex-1 min-w-0 flex flex-col">
              <Topbar />
              <main id="content" className="flex-1 min-w-0 px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
                <PanelFrame>{children}</PanelFrame>
              </main>
            </div>
          </div>
        </SystemStatusProvider>
        <Toaster
          theme="light"
          position="bottom-right"
          toastOptions={{
            style: {
              background: "var(--color-surface)",
              border: "1px solid var(--color-border)",
              color: "var(--color-foreground)",
              boxShadow: "0 20px 44px -18px rgba(15, 40, 90, 0.35)",
              borderRadius: "14px",
              fontFamily: "var(--font-sans)",
            },
          }}
        />
      </body>
    </html>
  );
}
