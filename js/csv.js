/**
 * Dependency-free RFC 4180 CSV parsing with delimiter sniffing.
 *
 * Affiliate exports vary: some come back comma-delimited, some semicolon-delimited
 * (locale-dependent), so we detect rather than assume.
 */

const CANDIDATE_DELIMITERS = [',', ';', '\t', '|'];

/** Strip a UTF-8 BOM, which both observed exports carry. */
function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Count delimiter occurrences outside quoted regions in the first line.
 * Quote-awareness matters: product names contain commas.
 */
export function sniffDelimiter(text) {
  let inQuotes = false;
  const counts = Object.fromEntries(CANDIDATE_DELIMITERS.map((d) => [d, 0]));

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') i++;
      else inQuotes = !inQuotes;
    } else if (!inQuotes && (ch === '\n' || ch === '\r')) {
      break;
    } else if (!inQuotes && ch in counts) {
      counts[ch]++;
    }
  }

  let best = ',';
  for (const d of CANDIDATE_DELIMITERS) {
    if (counts[d] > counts[best]) best = d;
  }
  return counts[best] > 0 ? best : ',';
}

/**
 * Parse delimited text into rows of string cells.
 * Handles quoted fields, escaped quotes, embedded newlines, and CRLF.
 */
export function parseDelimited(rawText, delimiter) {
  const text = stripBom(rawText);
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let fieldWasQuoted = false;

  const endField = () => {
    row.push(fieldWasQuoted ? field : field.trim());
    field = '';
    fieldWasQuoted = false;
  };
  const endRow = () => {
    endField();
    // Drop rows that are entirely empty (trailing newline artifacts).
    if (row.some((cell) => cell !== '')) rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      fieldWasQuoted = true;
    } else if (ch === delimiter) {
      endField();
    } else if (ch === '\r') {
      if (text[i + 1] === '\n') i++;
      endRow();
    } else if (ch === '\n') {
      endRow();
    } else {
      field += ch;
    }
  }

  if (field !== '' || row.length > 0) endRow();
  return rows;
}

/**
 * Parse a CSV file into { headers, rows, delimiter }.
 * `rows` are arrays of cells aligned to `headers`; short rows are padded.
 */
export function parseCsv(rawText) {
  const text = stripBom(rawText);
  if (!text.trim()) {
    throw new Error('That file is empty.');
  }

  const delimiter = sniffDelimiter(text);
  const table = parseDelimited(text, delimiter);

  if (table.length === 0) {
    throw new Error('No readable rows were found in that file.');
  }

  const headers = table[0].map((h) => h.trim());
  const rows = table.slice(1).map((cells) => {
    const padded = cells.slice(0, headers.length);
    while (padded.length < headers.length) padded.push('');
    return padded;
  });

  return { headers, rows, delimiter };
}
