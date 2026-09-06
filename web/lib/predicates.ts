"use client";

/**
 * One predicate per write: "has the chain caught up with what was asked?"
 *
 * They live here, beside the reads they poll, because a predicate written
 * inline at a call site once polled for a field the contract deliberately
 * withholds until finality — and a write that had succeeded was reported as
 * unconfirmed. Each one forces a fresh read (`force = true`): confirming
 * against the cache would confirm nothing.
 */
import { sameAddress } from "./chain";
import { getAgreement, getAgreements, getClaimable } from "./read";
import type { Status } from "./types";

/** draft_agreement landed: the count grew past what it was. */
export function agreementCountAbove(before: number) {
  return async () => (await getAgreements(0, 1, true)).total > before;
}

export function agreementStatusIs(id: string, ...statuses: Status[]) {
  return async () => {
    const ag = await getAgreement(id, true);
    return !!ag && statuses.includes(ag.status);
  };
}

/** submit_evidence landed: the record advanced past the version we saw. */
export function evidenceVersionAbove(id: string, before: number) {
  return async () => {
    const ag = await getAgreement(id, true);
    return !!ag && ag.evidence_version > before;
  };
}

/** adjudicate landed: this version is pending, or was already promoted by a
 *  faster stranger, or the agreement left FUNDED through someone else's
 *  identical call. Any of these means the state we asked for is live. */
export function adjudicationRecorded(id: string, version: number) {
  return async () => {
    const ag = await getAgreement(id, true);
    return !!ag && (
      ag.status !== "FUNDED" || ag.judged_version >= version || ag.pending_version >= version
    );
  };
}

/** promote landed: nothing is pending finality any more — FINAL, or back to
 *  FUNDED on an INCONCLUSIVE hold. */
export function promoted(id: string) {
  return async () => {
    const ag = await getAgreement(id, true);
    return !!ag && ag.status !== "PENDING_FINALITY";
  };
}

/** challenge landed: the agreement reports an open challenge. */
export function challengeOpen(id: string) {
  return async () => {
    const ag = await getAgreement(id, true);
    return !!ag && ag.challenge_open;
  };
}

/** re_adjudicate / lapse_challenge landed: the challenge is no longer open. */
export function challengeClosed(id: string) {
  return async () => {
    const ag = await getAgreement(id, true);
    return !!ag && !ag.challenge_open;
  };
}

export function settled(id: string) {
  return agreementStatusIs(id, "SETTLED");
}

export function reclaimed(id: string) {
  return agreementStatusIs(id, "RECLAIMED");
}

export function cancelled(id: string) {
  return agreementStatusIs(id, "CANCELLED");
}

/** claim landed: the ledger for this wallet reads zero again. */
export function claimDrained(addr: string) {
  return async () => (await getClaimable(addr, true)) === "0";
}

// ── ownership, for gating UI — never for writes; the contract checks itself ──

export function isOperator(addr: string | null | undefined, operator: string): boolean {
  return sameAddress(addr, operator);
}

export function isFunder(addr: string | null | undefined, funder: string): boolean {
  return sameAddress(addr, funder);
}

export function isParty(addr: string | null | undefined, operator: string, funder: string): boolean {
  return sameAddress(addr, operator) || sameAddress(addr, funder);
}
