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
import { WalletButton } from "./WalletButton";

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

/** The header is the mark, the wordmark, one text link and the wallet. No
 *  menu bar: the record is reached from the projects table, not a nav. */
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
          <nav aria-label="Primary">
            <Link
              href="/projects"
              className={path.startsWith("/projects") ? "ghost on" : "ghost"}
            >
              Projects
            </Link>
            <WalletButton />
          </nav>
        </div>
      </header>
      {children}
      <footer className="colophon">
        <div className="colophon-inner">
          <span>
            Verda — outcome-based environmental funding, adjudicated on GenLayer
            Studio Next
          </span>
          <span>
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
            {/* The rules live in the colophon, not the header: the header
                keeps its one link, and a reader who wants the mechanism
                finds it where a colophon puts such things. */}
            <Link href="/rules" className="ghost">
              Rules
            </Link>
          </span>
        </div>
      </footer>
    </>
  );
}
