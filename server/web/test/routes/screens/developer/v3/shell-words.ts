/**
 * What a pasted command asks of the shell, for the tests that check every
 * command the developer guidance prints (LAI-1084, LAI-1093).
 *
 * `unquotedHazards` walks one line the way zsh and bash read it and returns
 * every character either would act on rather than pass through: a redirect
 * (`<placeholder>` is one), a pipe or list operator, a glob (zsh refuses an
 * unmatched one: `no matches found`), a comment (an interactive zsh does not
 * treat `#` as one unless `interactivecomments` is set), history expansion,
 * a backslash, a word starting with `=` (zsh expands it), or a quote left
 * open.
 *
 * Inside single quotes nothing is special. Inside double quotes `$`, a
 * backtick, `!` and `\` still are, so the one substitution the guidance
 * means to make — `"$(command -v laika)"`, the path of this terminal's
 * `laika` — is the only one allowed, by name.
 *
 * One operator is allowed, and only as a word of its own: `&&`, *stop at the
 * first step that fails*, which the install lists use so a refused clone does
 * not go on to link whatever is in the folder. A line may end with it — both
 * shells then read the next line as the rest of the list. A lone `&`, or `&&`
 * run into a word, is still reported.
 */

/** Acted on outside quotes. `~` is left out: at a word's start it is the home folder, as meant. */
const UNQUOTED = new Set([...'<>|;&`*?[]{}()#!$\\^']);

/** Acted on inside double quotes. */
const IN_DOUBLE = new Set([...'$`!\\']);

/** The one substitution the guidance makes. */
const ALLOWED_SUBSTITUTION = '$(command -v laika)';

export function unquotedHazards(line: string): readonly string[] {
  const found: string[] = [];
  let quote: "'" | '"' | undefined;
  let wordStart = true;
  for (let i = 0; i < line.length; i += 1) {
    const c = line.charAt(i);
    if (quote === "'") {
      if (c === "'") quote = undefined;
      continue;
    }
    if (quote === '"') {
      if (c === '"') {
        quote = undefined;
      } else if (line.startsWith(ALLOWED_SUBSTITUTION, i)) {
        i += ALLOWED_SUBSTITUTION.length - 1;
      } else if (IN_DOUBLE.has(c)) {
        found.push(c);
      }
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      wordStart = false;
      continue;
    }
    if (c === ' ' || c === '\t') {
      wordStart = true;
      continue;
    }
    if (
      c === '&' &&
      wordStart &&
      line.charAt(i + 1) === '&' &&
      /^( |$)/.test(line.slice(i + 2, i + 3))
    ) {
      i += 1;
      continue;
    }
    if (UNQUOTED.has(c) || (wordStart && c === '=')) found.push(c);
    wordStart = false;
  }
  if (quote !== undefined) found.push(`unclosed ${quote}`);
  return found;
}

/** Every line of every command given, with what it asks of the shell; empty when none asks anything. */
export function hazardsIn(commands: readonly string[]): readonly string[] {
  return commands
    .flatMap((command) => command.split('\n'))
    .map((line) => ({ line, hazards: unquotedHazards(line) }))
    .filter(({ hazards }) => hazards.length > 0)
    .map(({ line, hazards }) => `${line} → ${hazards.join(' ')}`);
}

/**
 * The defect LAI-1093 removed: telling someone to `pull` a checkout at
 * `~/laika` — which may not be there, or may be detached — with no way to
 * find the real one and no fresh install beside it. `undefined` when the
 * text is fine.
 */
export function barePull(text: string): string | undefined {
  const pull = /(?:git -C )?~\/laika pull\b[^\n]*/.exec(text);
  if (pull === null) return undefined;
  const finds = text.includes('ls -l "$(command -v laika)"');
  const installs = /git clone \S+ ~\/laika/.test(text);
  return finds && installs ? undefined : pull[0];
}
