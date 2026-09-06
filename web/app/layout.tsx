import type { Metadata } from "next";
import { DM_Mono, Hanken_Grotesk, Playfair_Display } from "next/font/google";
import "./globals.css";
import { WalletProvider } from "../lib/wallet";
import { Shell } from "./components/Shell";

const display = Playfair_Display({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["400", "500"],
});
const sans = Hanken_Grotesk({
  subsets: ["latin"],
  variable: "--font-sans",
  weight: ["400", "500"],
});
const mono = DM_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  weight: ["400"],
});

export const metadata: Metadata = {
  title: "Verda",
  description: "Fund outcomes. Verify impact. Pay for what actually happened.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Font variables ride the <html> element: CSS custom properties resolve
  // var() where they are DECLARED, so tokens defined on :root cannot see
  // variables that only exist further down the tree.
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} ${mono.variable}`}>
      <body>
        <WalletProvider>
          <Shell>{children}</Shell>
        </WalletProvider>
      </body>
    </html>
  );
}
