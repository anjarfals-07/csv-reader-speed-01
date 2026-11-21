// Fast CSV reader: byte-identical answers to csv-reader 1.0.0, at a fraction of its CPU.
// Semantics (the broken-row policy): BOM dropped; record ends at LF/CRLF; an empty line is no
// record; a CR outside quotes not followed by LF is dropped (stray_cr); a field opening with a
// quote runs to the next non-doubled quote, "" inside is one quote, CRLF/lone CR inside is LF;
// text after the closing quote up to the next comma or line break is appended (quote_junk when
// the field ends); a quote that never closes is literal and the rest is re-read unquoted
// (unterminated_quote); a quote inside an unquoted field is literal; fields stay strings.
// columns is the first record when header, else null; rows are padded (short_row) or cut
// (long_row) to the first record's width. Errors are {code, line, row} in the order met, line
// the 1-based line the record starts on, row its index in rows (null for the header).
//
// Speed: two tiers. Most records are clean (no quote, no CR), so a whole record is taken in one
// slice + split. Anything else goes through a per-field scanner that jumps with indexOf instead
// of stepping character by character. No dependencies, no state kept between calls.

const COMMA = 0;
const LINE = 1;
const END = 2;

export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  let line = 1;
  // The record being read: the line it starts on, its index in rows (null: the header).
  let recordLine = 1;
  let recordRow = null;

  function err(code) {
    errors.push({ code, line: recordLine, row: recordRow });
  }

  // Reads an unquoted field from pos, starting from `value`. Jumps to the next comma, LF or
  // CR with indexOf; a stray CR is dropped (stray_cr) and the scan resumes after it.
  // Returns {value, ended, added} where added counts the characters kept in this call.
  function readUnquoted(value) {
    let added = 0;
    while (pos < n) {
      const iComma = text.indexOf(',', pos);
      const iLF = text.indexOf('\n', pos);
      const iCR = text.indexOf('\r', pos);
      let idx = -1;
      let kind = -1;
      if (iComma !== -1 && (idx === -1 || iComma < idx)) { idx = iComma; kind = 0; }
      if (iLF !== -1 && (idx === -1 || iLF < idx)) { idx = iLF; kind = 1; }
      if (iCR !== -1 && (idx === -1 || iCR < idx)) { idx = iCR; kind = 2; }
      if (idx === -1) {
        // No delimiter left: the rest of the text is the field.
        if (pos < n) { value += text.slice(pos); added += n - pos; pos = n; }
        return { value, ended: END, added };
      }
      if (kind === 0) {
        if (idx > pos) { value += text.slice(pos, idx); added += idx - pos; }
        pos = idx + 1;
        return { value, ended: COMMA, added };
      }
      if (kind === 1) {
        if (idx > pos) { value += text.slice(pos, idx); added += idx - pos; }
        pos = idx + 1;
        line += 1;
        return { value, ended: LINE, added };
      }
      // kind === 2: a CR. CRLF ends the record; a lone CR is dropped (stray_cr).
      if (idx + 1 < n && text.charCodeAt(idx + 1) === 10) {
        if (idx > pos) { value += text.slice(pos, idx); added += idx - pos; }
        pos = idx + 2;
        line += 1;
        return { value, ended: LINE, added };
      }
      err('stray_cr');
      if (idx > pos) { value += text.slice(pos, idx); added += idx - pos; }
      pos = idx + 1;
    }
    return { value, ended: END, added };
  }

  // Reads a quoted field whose opening quote is at pos.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    pos += 1;
    let close = -1;
    // Find the closing quote: a quote doubled ("") is an escaped quote, not a close.
    let from = pos;
    while (true) {
      const q = text.indexOf('"', from);
      if (q === -1) break;
      if (q + 1 < n && text.charCodeAt(q + 1) === 34) { from = q + 2; continue; }
      close = q;
      break;
    }
    if (close === -1) {
      // Never closes: the quote is literal, the rest is re-read as unquoted.
      pos = open + 1;
      line = openLine;
      err('unterminated_quote');
      return readUnquoted('"');
    }
    // Raw content between the quotes. CRLF and lone CR inside are each one LF; "" is one quote.
    const raw = text.slice(pos, close);
    let value = raw;
    if (raw.indexOf('\r') !== -1) value = value.replace(/\r\n?/g, '\n');
    if (value.indexOf('""') !== -1) value = value.replace(/""/g, '"');
    // Every LF, CRLF and lone CR inside counts one line.
    if (raw.indexOf('\n') !== -1 || raw.indexOf('\r') !== -1) {
      const breaks = raw.match(/\r\n|[\r\n]/g);
      line += breaks.length;
    }
    pos = close + 1;
    if (pos >= n) return { value, ended: END };
    const c = text.charCodeAt(pos);
    if (c === 44) { pos += 1; return { value, ended: COMMA }; }
    if (c === 10) { pos += 1; line += 1; return { value, ended: LINE }; }
    if (c === 13 && pos + 1 < n && text.charCodeAt(pos + 1) === 10) {
      pos += 2;
      line += 1;
      return { value, ended: LINE };
    }
    // Text after the closing quote is appended as it stands (quote_junk if any was kept).
    const junk = readUnquoted(value);
    if (junk.added > 0) err('quote_junk');
    return junk;
  }

  while (true) {
    // Skip lines with no characters (LF or CRLF).
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) { pos += 1; line += 1; }
      else if (c === 13 && pos + 1 < n && text.charCodeAt(pos + 1) === 10) { pos += 2; line += 1; }
      else break;
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;

    // Fast path: a whole clean record (no quote, no CR) up to the next LF.
    const iLF = text.indexOf('\n', pos);
    const segEnd = iLF === -1 ? n : iLF;
    const iQuote = text.indexOf('"', pos);
    const iCR = text.indexOf('\r', pos);
    if ((iQuote === -1 || iQuote >= segEnd) && (iCR === -1 || iCR >= segEnd)) {
      // The record is one clean line. (An empty line was already skipped above.)
      const fields = text.slice(pos, segEnd).split(',');
      if (iLF === -1) { pos = n; } else { pos = iLF + 1; line += 1; }
      if (width < 0) width = fields.length;
      if (header && columns === null) { columns = fields; continue; }
      if (fields.length < width) {
        errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
        while (fields.length < width) fields.push('');
      } else if (fields.length > width) {
        errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
      }
      rows.push(fields);
      continue;
    }

    // Careful path: fields one by one.
    const fields = [];
    let ended;
    let quoted = false;
    do {
      quoted = text.charCodeAt(pos) === 34;
      const f = quoted ? readQuoted() : readUnquoted('');
      fields.push(f.value);
      ended = f.ended;
    } while (ended === COMMA);

    // A line that held only stray CRs is left with no characters: no record (errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) { columns = fields; continue; }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }

  return { columns: header ? (columns ?? []) : null, rows, errors };
}
