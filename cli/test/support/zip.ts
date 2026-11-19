import { crc32, deflateRawSync } from 'node:zlib';

/**
 * A minimal zip writer, so the `.xlsx`, `.docx` and `.pptx` the secret check
 * reads are built in the test from their XML — no binary fixture in the repo,
 * and no string shaped like a credential sitting in one (LAI-1351). An entry
 * given as bytes is written as they are: a zip inside a zip (LAI-1361).
 */
export function zip(files: Readonly<Record<string, string | Uint8Array>>, stored = false): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const raw = typeof content === 'string' ? Buffer.from(content, 'utf8') : Buffer.from(content);
    const data = stored ? raw : deflateRawSync(raw);
    const nameBytes = Buffer.from(name, 'utf8');
    const crc = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(stored ? 0 : 8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    locals.push(local, nameBytes, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(stored ? 0 : 8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);

    offset += local.length + nameBytes.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

/** An `.xlsx` whose first sheet holds `rows`, every cell a shared string. */
export function xlsx(rows: readonly (readonly string[])[]): Buffer {
  const strings: string[] = [];
  const index = (s: string): number => {
    const at = strings.indexOf(s);
    if (at >= 0) return at;
    strings.push(s);
    return strings.length - 1;
  };
  const esc = (s: string): string =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const col = (n: number): string => String.fromCharCode(65 + n);
  const sheetRows = rows
    .map(
      (cells, r) =>
        `<row r="${String(r + 1)}">${cells
          .map((v, c) => `<c r="${col(c)}${String(r + 1)}" t="s"><v>${String(index(v))}</v></c>`)
          .join('')}</row>`,
    )
    .join('');
  return zip({
    '[Content_Types].xml': '<?xml version="1.0"?><Types/>',
    'xl/workbook.xml':
      '<?xml version="1.0"?><workbook><sheets><sheet name="Accounts" sheetId="1"/></sheets></workbook>',
    'xl/sharedStrings.xml': `<?xml version="1.0"?><sst>${strings.map((s) => `<si><t xml:space="preserve">${esc(s)}</t></si>`).join('')}</sst>`,
    'xl/worksheets/sheet1.xml': `<?xml version="1.0"?><worksheet><sheetData>${sheetRows}</sheetData></worksheet>`,
  });
}

/** A `.docx` of paragraphs, and optionally one table after them. */
export function docx(
  paragraphs: readonly string[],
  table: readonly (readonly string[])[] = [],
): Buffer {
  const esc = (s: string): string =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const p = (s: string): string =>
    `<w:p><w:r><w:t xml:space="preserve">${esc(s)}</w:t></w:r></w:p>`;
  const tbl =
    table.length === 0
      ? ''
      : `<w:tbl><w:tblPr/>${table
          .map(
            (row) =>
              `<w:tr>${row.map((cell) => `<w:tc><w:tcPr/>${p(cell)}</w:tc>`).join('')}</w:tr>`,
          )
          .join('')}</w:tbl>`;
  return zip({
    '[Content_Types].xml': '<?xml version="1.0"?><Types/>',
    'word/document.xml': `<?xml version="1.0"?><w:document><w:body>${paragraphs.map(p).join('')}${tbl}</w:body></w:document>`,
  });
}

/**
 * A `.pptx` with one slide per entry of `slides`, each a list of paragraphs,
 * and `extra` parts beside them — `ppt/embeddings/…`, say.
 */
export function pptx(
  slides: readonly (readonly string[])[],
  extra: Readonly<Record<string, string | Uint8Array>> = {},
): Buffer {
  const esc = (s: string): string =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const parts: Record<string, string | Uint8Array> = {
    '[Content_Types].xml': '<?xml version="1.0"?><Types/>',
    'ppt/presentation.xml': '<?xml version="1.0"?><p:presentation/>',
  };
  slides.forEach((paragraphs, i) => {
    parts[`ppt/slides/slide${String(i + 1)}.xml`] =
      `<?xml version="1.0"?><p:sld><p:cSld><p:spTree><p:sp><p:txBody><a:bodyPr/>${paragraphs
        .map((p) => `<a:p><a:r><a:rPr lang="en-GB"/><a:t>${esc(p)}</a:t></a:r></a:p>`)
        .join('')}</p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;
  });
  return zip({ ...parts, ...extra });
}
