"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CONTRACT_ADDRESS,
  CONTRACT_CONFIGURED,
  GENLAYER_EXPLORER_URL,
} from "../../lib/config";
import { Addr } from "./bits";
import { Logo } from "./Logo";
import { NetworkPill } from "./NetworkPill";
import { WalletButton } from "./WalletButton";

const DOCS = "https://github.com/Hemmy1417/Verda/blob/main/docs";

/**
 * Explorer links into the Studio Next block explorer, which serves per-address
 * and per-transaction routes. Every call site still shows the hash or address
 * WHOLE beside the link, with copy, so the record is legible without it.
 */
export function explorerAddress(addr: string): string {
  return `${GENLAYER_EXPLORER_URL}/address/${addr}`;
}
export function explorerTx(hash: string): string {
  return `${GENLAYER_EXPLORER_URL}/tx/${hash}`;
}

const NAV: Array<{ href: string; label: string }> = [
  { href: "/projects", label: "Projects" },
  { href: "/create", label: "Draft" },
  { href: "/rules", label: "Rules" },
];

/** The persistent navbar: the mark and wordmark, three sentence-case links,
 *  the network state pill and the wallet control. The footer keeps the
 *  contract address whole with copy, the Studio link and the docs. */
export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  return (
    <>
      <header className="masthead">
        <div className="masthead-inner">
          <Link href="/" className="brand" aria-label="Verda home">
            <Logo size={32} />
            <span className="brand-name">Verda</span>
          </Link>
          <nav className="nav-links" aria-label="Primary">
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className={path.startsWith(n.href) ? "nav-link on" : "nav-link"}
                aria-current={path.startsWith(n.href) ? "page" : undefined}
              >
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="nav-tools">
            <NetworkPill />
            <WalletButton />
          </div>
        </div>
      </header>
      {children}
      <footer className="colophon">
        <div className="colophon-inner">
          <span>
            Verda, outcome-based environmental funding adjudicated on GenLayer Studio Next.
          </span>
          <span className="colophon-links">
            {/* The whole address is in the DOM with copy; CSS truncates the
                display. It is not a link: the Studio has no address page. */}
            {CONTRACT_CONFIGURED ? (
              <>
                contract <Addr value={CONTRACT_ADDRESS} label="Copy contract address" />
              </>
            ) : (
              "no contract configured"
            )}
            {" · "}
            <a href={explorerAddress(CONTRACT_ADDRESS)} target="_blank" rel="noreferrer">
              Studio Next
            </a>
            {" · "}
            <a href={`${DOCS}/ARCHITECTURE.md`} target="_blank" rel="noreferrer">
              Docs
            </a>
          </span>
        </div>
      </footer>
    </>
  );
}
