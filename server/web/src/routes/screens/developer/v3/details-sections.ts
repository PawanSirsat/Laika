import type { ConsentRead } from '../CheckpointConsentSwitch.tsx';
import type { ToolCapability } from './tool-catalog.ts';
import type { CheckLine } from './tool-readiness.ts';
import { versionChip, type UpdateKey } from './update-status.ts';

/**
 * Tool details and Device details, folded (LAI-1100, gap #12 of the V3
 * fidelity audit): the top of a panel is its status and **the one next
 * action**; every other section is a one-line summary row that opens. This
 * file is the rules — which action is next, and what each folded row says —
 * so `node --test` reaches all of it; `DetailsFold.tsx` draws the rows.
 *
 * Nothing here reads anything: each answer is worked out from what the panel
 * was already given, so a summary and the section under it cannot disagree.
 */

// ------------------------------------------------------------------ one tool

/** The one next action at the top of a tool's details. */
export type ToolNext =
  /** Its credentials no longer work, and nothing in the panel changes that. */
  | { readonly kind: 'revoked' }
  /** Needs setup: the first check still missing, and *Finish setup* where the wizard can. */
  | { readonly kind: 'finish'; readonly check: CheckLine | undefined }
  /** The board needs its helper updated: the steps are in the Helper section. */
  | { readonly kind: 'update' }
  /** Connected, with a check still missing: what to do about it. */
  | { readonly kind: 'check'; readonly check: CheckLine }
  /** Everything is in, and it reaches no project yet. */
  | { readonly kind: 'project' }
  | { readonly kind: 'none' };

export interface ToolNextInput {
  readonly active: boolean;
  /** `listedStatus(...).key`: the status the panel's title shows. */
  readonly status: string;
  /** Its checks, once its verification is in. */
  readonly lines: readonly CheckLine[] | undefined;
  readonly update: UpdateKey | undefined;
  /** How many projects it reaches. */
  readonly projects: number;
}

/**
 * Which one thing a tool's details lead with, most pressing first: revoked;
 * needs setup; a helper the board refuses (*Update required*); a check still
 * missing; no project yet. A tool with none of these leads with its status
 * alone.
 */
export function toolNext(input: ToolNextInput): ToolNext {
  if (!input.active) return { kind: 'revoked' };
  const missing = input.lines?.find((line) => line.state === 'fail');
  if (input.status === 'needs-setup') return { kind: 'finish', check: missing };
  if (input.update === 'required') return { kind: 'update' };
  if (missing !== undefined) return { kind: 'check', check: missing };
  if (input.projects === 0) return { kind: 'project' };
  return { kind: 'none' };
}

/** The Checks row: *2 of 4 done*, or *All 4 done* — a check the tool cannot have is not counted. */
export function checksSummary(lines: readonly CheckLine[]): string {
  const apply = lines.filter((line) => line.state !== 'unsupported');
  const done = apply.filter((line) => line.state === 'pass').length;
  if (apply.length === 0) return 'None apply';
  return done === apply.length
    ? `All ${String(apply.length)} done`
    : `${String(done)} of ${String(apply.length)} done`;
}

/**
 * The Helper row, in the words of the row's chip: *Update required*, *Update
 * available*, *Version unknown*, *Could not check* — and *Up to date*, as the
 * row it sits under already says *Helper*. A device's row says its worst.
 */
export function helperSummary(key: UpdateKey | undefined): string {
  if (key === 'up-to-date') return 'Up to date';
  return versionChip(key)?.word ?? 'Checking…';
}

/** *Automatic checkpoints · On*: what the board holds, as the switch under it read it. */
export function consentSummary(read: ConsentRead): string {
  switch (read) {
    case 'on':
      return 'On';
    case 'off':
      return 'Off';
    case 'reading':
      return 'Reading…';
    case 'failed':
      return 'Could not be read';
  }
}

/**
 * Whether a tool can save checkpoints automatically at all: its hooks open
 * sessions, which is what automatic checkpoints hang off (`tool-catalog.ts`).
 * Only those tools' details carry the switch; one the catalog does not know
 * carries none.
 */
export function supportsCheckpoints(tool: Pick<ToolCapability, 'sessions'> | undefined): boolean {
  return tool?.sessions === true;
}

// ------------------------------------------------------------------ one device

/** The Tools row of a device: *2 active · 1 revoked*. */
export function deviceToolsSummary(active: number, revoked: number): string {
  const parts = [active === 0 ? 'None active' : `${String(active)} active`];
  if (revoked > 0) parts.push(`${String(revoked)} revoked`);
  return parts.join(' · ');
}

export type DeviceNext = 'add-tool' | 'update' | 'none';

export interface DeviceNextInput {
  readonly live: boolean;
  /**
   * It is imported and unconfirmed, or holds a duplicate pair: those are
   * shown at the top as they are, open, and they are the action.
   */
  readonly attention: boolean;
  /** Active tools on it, duplicates included. */
  readonly tools: number;
  /** A tool can be added here from this page: a paired device, and a reader who may. */
  readonly canAddTool: boolean;
  /** The worst helper status among its tools. */
  readonly worst: UpdateKey | undefined;
}

/**
 * What a device's details lead with when nothing needs the owner's attention:
 * *Add a tool* on a paired device with none, else the steps for a helper the
 * board refuses, else its status alone.
 */
export function deviceNext(input: DeviceNextInput): DeviceNext {
  if (!input.live || input.attention) return 'none';
  if (input.tools === 0) return input.canAddTool ? 'add-tool' : 'none';
  if (input.worst === 'required') return 'update';
  return 'none';
}
