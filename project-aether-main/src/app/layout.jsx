import "./globals.css";
import { Sora, Inter } from "next/font/google";
import { Providers } from "./providers";
import MobileNav from "../components/MobileNav/MobileNav";

const sora = Sora({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-sora",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata = {
  title: "Project Aether | Air Quality & Comfort Dashboard",
  description:
    "Project Aether - ESP32-based IoT Air Quality & Comfort Monitoring dashboard.",
  icons: { icon: "/favicon.svg" },
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Project Aether",
  },
};

export const viewport = {
  themeColor: "#0a0e1a",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${sora.variable} ${inter.variable}`}>
      <body
        style={{
          fontFamily: "var(--font-inter), ui-sans-serif, system-ui, sans-serif",
        }}
      >
        <Providers>
          {/* AUDIT L3: skip-to-content link for keyboard/screen-reader users. */}
          <a
            href="#main-content"
            className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-sky-400 focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-navy-950"
          >
            Skip to content
          </a>
          {children}
          <MobileNav />
        </Providers>
      </body>
    </html>
  );
}
