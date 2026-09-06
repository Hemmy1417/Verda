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
 * "Explorer" links. Studio Next has no public block explorer: the Studio UI
 * is the only place a transaction or an address can be looked at, and it
 * exposes no per-transaction or per-address route we know of. So both helpers
 * resolve to the Studio itself, and every call site shows the hash or address
 * WHOLE beside the link, with copy, for the reader to look up there. The
 * argument is kept so call sites stay honest about what they are linking,
 * and so a real route can be wired here, in one place, if the Studio grows
 * one.
 */
export function explorerAddress(addr: string): string {
  void addr;
  return GENLAYER_EXPLORER_URL;
}
export function explorerTx(hash: string): string {
  void hash;
  return GENLAYER_EXPLORER_URL;
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
