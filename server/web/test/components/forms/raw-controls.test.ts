/**
 * Files moved onto Button / IconButton / the fields stay moved (LAI-1204).
 *
 * **Narrow on purpose.** It does not count the whole app — a global ratchet
 * would turn red on every parallel branch that adds a button — only the files
 * LAI-1204 migrated. In each of them a raw `<button>` is allowed only when it
 * is one of the things `Button` is not:
 *
 * - a composite widget's own part, which says so with a `role` (`menuitem`,
 *   `radio`, `option`, `tab`, `switch`): the WAI-ARIA patterns those follow
 *   are not a push button's, and dressing them as one would be wrong;
 * - or one of the counted exceptions below, each with the reason it is not a
 *   `Button` yet. The count is **exact**, not a ceiling: migrating one more
 *   turns this red until the number comes down, so the list cannot go stale.
 *
 * In the files whose forms moved too (`fields`), a raw `<textarea>` or a
 * hand-styled text `<input>` is refused outright: `TextInput` and `Textarea`
 * are the way in.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import { code } from '../../helpers/code.ts';

const SRC = fileURLToPath(new URL('../../../src/', import.meta.url));

/** The roles whose buttons are a widget's parts, not push buttons. */
const WIDGET_ROLES = new Set(['menuitem', 'radio', 'option', 'tab', 'switch', 'combobox']);

interface Migrated {
  /** Raw buttons with no widget role that are allowed, exactly. */
  readonly exceptions: number;
  readonly why: string;
  /**
   * Whether this file's text fields were migrated too. Only then is a raw
   * `<textarea>` or hand-styled text `<input>` refused: the dialogs were moved
   * for their footers, and a typed-confirmation box or a people-search
   * combobox is not a form field `TextInput` describes.
   */
  readonly fields?: true;
}

const MIGRATED: Readonly<Record<string, Migrated>> = {
  'components/sidebar/SidebarFooter.tsx': {
    exceptions: 1,
    why: 'the user-menu trigger: an avatar, a name and a role in one control, the menu-button pattern',
  },
  'components/OffboardingDialog.tsx': { exceptions: 0, why: '' },
  'components/ConfirmDialog.tsx': { exceptions: 0, why: '' },
  'components/agent/HandoffDialog.tsx': { exceptions: 0, why: '' },
  'components/agent/HandoffOfferDialog.tsx': { exceptions: 0, why: '' },
  'components/create-task/CreateTaskDialog.tsx': { exceptions: 0, why: '' },
  'components/time-report/TimeReport.tsx': {
    exceptions: 14,
    why:
      'only the toolbar moved (the stepper and Export CSV). The rest are pills, chips, ' +
      'sort headers, row toggles and "more" links — their own shapes, for a Chip and a ' +
      'table-header primitive that do not exist yet',
  },
  'routes/screens/space-settings/GeneralTab.tsx': { exceptions: 0, why: '', fields: true },
  'routes/screens/space-settings/AccessTab.tsx': { exceptions: 0, why: '', fields: true },
  'routes/screens/space-settings/DangerTab.tsx': { exceptions: 0, why: '', fields: true },
  'routes/screens/space-settings/MembersTab.tsx': {
    exceptions: 5,
    why:
      'the undo toast’s two buttons (replaced by the shared Toast in PR #288), the ' +
      'removable person chip, a search result row, and the inline "copy members" link',
  },
};

/** Each `<tag …>` opening tag, read brace- and quote-aware so `() => x` inside an attribute does not end it. */
function openingTags(src: string, tag: string): string[] {
  const out: string[] = [];
  const start = new RegExp(`<${tag}\\b`, 'g');
  let m: RegExpExecArray | null;
  while ((m = start.exec(src)) !== null) {
    let depth = 0;
    let quote: string | undefined;
    let i = m.index + m[0].length;
    for (; i < src.length; i++) {
      const c = src[i];
      if (quote !== undefined) {
        if (c === quote) quote = undefined;
        continue;
      }
      if (depth > 0 && (c === "'" || c === '"' || c === '`')) quote = c;
      else if (depth === 0 && c === '"') quote = c;
      else if (c === '{') depth += 1;
      else if (c === '}') depth -= 1;
      else if (c === '>' && depth === 0) break;
    }
    out.push(src.slice(m.index, i + 1));
  }
  return out;
}

const roleOf = (tag: string): string | undefined => /\brole="([a-z]+)"/.exec(tag)?.[1];

void describe('the opening-tag reader', () => {
  void test('does not stop at an arrow inside an attribute', () => {
    const [tag] = openingTags(
      '<button type="button" onClick={() => go(">")} className="x">Hi</button>',
      'button',
    );
    assert.equal(tag, '<button type="button" onClick={() => go(">")} className="x">');
  });

  void test('finds every tag, and reads a role', () => {
    const tags = openingTags('<button role="menuitem">a</button><button>b</button>', 'button');
    assert.equal(tags.length, 2);
    assert.equal(roleOf(tags[0] ?? ''), 'menuitem');
    assert.equal(roleOf(tags[1] ?? ''), undefined);
  });
});

void describe('migrated files stay on the primitives (LAI-1204)', () => {
  for (const [file, rule] of Object.entries(MIGRATED)) {
    void test(file, () => {
      const src = code(readFileSync(`${SRC}${file}`, 'utf8'));
      const plain = openingTags(src, 'button').filter((t) => !WIDGET_ROLES.has(roleOf(t) ?? ''));
      assert.equal(
        plain.length,
        rule.exceptions,
        plain.length > rule.exceptions
          ? `a hand-rolled <button> is back in ${file} — use Button or IconButton:\n${plain.join('\n')}`
          : `${file} has fewer raw buttons than its exception count — lower it to ${String(plain.length)}`,
      );
      if (rule.exceptions > 0) assert.ok(rule.why.length > 20, `${file}: say why`);

      if (rule.fields !== true) return;
      for (const t of openingTags(src, 'textarea')) {
        assert.fail(`a raw <textarea> in ${file} — use Textarea: ${t}`);
      }
      for (const t of openingTags(src, 'input')) {
        const type = /\btype="([a-z]+)"/.exec(t)?.[1] ?? 'text';
        if (['text', 'email', 'url', 'search'].includes(type) && /className=/.test(t)) {
          assert.fail(`a hand-styled text <input> in ${file} — use TextInput: ${t}`);
        }
      }
    });
  }

  void test('the primitives are the ones the files reach for', () => {
    // A migrated file that imports neither is not migrated; it is empty of buttons.
    for (const file of Object.keys(MIGRATED)) {
      const src = readFileSync(`${SRC}${file}`, 'utf8');
      assert.match(
        src,
        /from '(?:\.\.?\/)+(?:components\/)?forms\/(?:Button|IconButton|TextInput|Textarea)\.tsx'|from '\.\/(?:Button|IconButton)\.tsx'|from '\.\.\/icon\/Icon\.tsx'/,
        `${file} imports no primitive`,
      );
    }
  });
});
