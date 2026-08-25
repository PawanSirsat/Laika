/**
 * Read the field names off a TypeScript interface, textually (LAI-213).
 *
 * **No parser dependency.** Both sides of the comparison are plain
 * `readonly name: type;` declarations written by hand, and the repo already
 * reads source this way — `structure.test.ts` walks directories,
 * `use-events.test.ts` reads `ACTIVITY_TYPES` out of the server's enum file.
 * A TypeScript parser would be a dependency added for one guard, and CLAUDE.md
 * asks for a task that names the package before that happens.
 *
 * Approximate by design, and the approximations are the ones that do not bite
 * here: it does not evaluate generics, mapped types or conditional types. Every
 * view type in this codebase is a flat list of named fields, and a test that
 * silently stopped matching would be caught by `fieldsOf` returning nothing —
 * which the callers assert against.
 */

/** One interface's own fields, before `extends` is resolved. */
interface Parsed {
  readonly fields: readonly string[];
  readonly extendsFrom: readonly string[];
}

function parseOne(source: string, name: string): Parsed | undefined {
  // The body, from the opening brace to a closing brace in column zero. View
  // types are top-level declarations, so the outdented `}` is theirs.
  const declaration = new RegExp(`(?:export )?interface ${name}\\b([^{]*)\\{(.*?)\\n\\}`, 's');
  const match = declaration.exec(source);
  if (match === null) return undefined;

  const heritage = match[1] ?? '';
  const body = (match[2] ?? '')
    // Comments routinely contain colons and would otherwise read as fields.
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*/g, '');

  const fields = [
    ...new Set(
      [...body.matchAll(/^\s*(?:readonly\s+)?([A-Za-z_][A-Za-z0-9_]*)\??\s*:/gm)].map((m) => m[1]!),
    ),
  ];

  const extendsFrom = heritage.includes('extends')
    ? [...heritage.matchAll(/([A-Za-z_][A-Za-z0-9_]*)/g)]
        .map((m) => m[1]!)
        .filter((word) => word !== 'extends')
    : [];

  return { fields, extendsFrom };
}

/**
 * Every field an interface exposes, **including inherited ones**.
 *
 * Resolving `extends` is not a nicety. `ProjectSummary extends ProjectView` on
 * the server, and the client's `Project` is flat — comparing against
 * `ProjectSummary`'s own body alone reports five inherited fields as missing
 * and the guard cries wolf on its first run.
 *
 * Returns `undefined` when the interface is not found, so a caller can tell
 * "no fields" from "wrong name" — a renamed type must fail loudly rather than
 * comparing an empty set and passing.
 */
export function fieldsOf(source: string, name: string): readonly string[] | undefined {
  const seen = new Set<string>();
  const fields = new Set<string>();

  const walk = (interfaceName: string): boolean => {
    if (seen.has(interfaceName)) return true;
    seen.add(interfaceName);

    const parsed = parseOne(source, interfaceName);
    if (parsed === undefined) return false;

    for (const field of parsed.fields) fields.add(field);
    // A parent in another file is not followed; the pair list says so where it
    // matters, and every view type here extends within its own module.
    for (const parent of parsed.extendsFrom) walk(parent);
    return true;
  };

  return walk(name) ? [...fields].sort() : undefined;
}
