import { NoteBlock } from './NoteBlock.tsx';

/**
 * **Outputs from agents** (D-162, LAI-1352): what an agent shows a person,
 * where it appears, and what it never sends — with the owner's parent and
 * child rule beside it (2026-11-19). The same two rules as the repo block's
 * rules 7 and 8 (`connect-copy.ts`), said for the person reading this page
 * rather than for the agent. On Project setup, Tools and Activity: wherever
 * the page sets an agent up to work.
 */
export function OutputsNote() {
  return (
    <NoteBlock title="Outputs from agents" note="outputs">
      <p>
        When you need to see the result — a UI change, a generated file — an agent attaches
        captioned screenshots or files with <code>laika attach</code>, and they open from a folded{' '}
        <em>Outputs</em> line under the task’s Proof. Never a secret: it attaches a masked copy. And
        never anything taken automatically; local activity stays counts only.
      </p>
      <p>
        A feature with several parts gets one parent task, with each part a child task. The main
        outputs go on the parent, a child’s own outputs on the child.
      </p>
    </NoteBlock>
  );
}
