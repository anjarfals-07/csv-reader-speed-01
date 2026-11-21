// solve.js — fast drop-in replacement for csv-reader 1.0.0.
// Written fresh from the competition RULES.txt specification.
// Semantics: a U+FEFF at the very start is dropped; a record ends at LF or
// CRLF; a line left with no characters is no record; outside quotes a CR not
// followed by LF is dropped (stray_cr); a field opening with a quote runs to
// the next quote that is not doubled, "" inside it is one quote and each
// CRLF or lone CR inside it is read as LF; what follows its closing quote,
// up to the next comma or line break, is appended as it stands (quote_junk,
// when the field ends); a quote that never closes is a literal character
// and the text after it is read again as unquoted (unterminated_quote); a
// quote inside an unquoted field is literal; fields stay strings, never
// trimmed; columns is the first record when header is true, else null; rows
// hold the records after it (every record when header is false), each padded
// with "" (short_row, with fields: its field count) or cut (long_row, with
// extra: the cut fields) to the first record's width; each error is
// {code, line, row} in the order met, a record's short_row or long_row when
// it ends, line the 1-based line its record starts on, row its record's
// index in rows, null for the header.

export function run(input) {
  let text = input.text;
  const header = input.header === true;
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const n = text.length;
  const errors = [];
  const records = [];
  let line = 1;
  let i = 0;
  let width = -1;

  const rowOf = (r) => (header ? (r === 0 ? null : r - 1) : r);

  // Parse one unquoted field starting at `start`, with `prefix` already in
  // the value (used for the unterminated-quote re-read, where the opening
  // quote is literal). Returns [value, nextPos, endedRecord, newLine].
  // endedRecord is true when the field ended at a line break (record over).
  const parseUnquoted = (start, prefix, curLn, recLine, myRow) => {
    let cPos = text.indexOf(',', start);
    let nlPos = text.indexOf('\n', start);
    let end;
    let isComma;
    if (cPos === -1 && nlPos === -1) { end = n; isComma = false; }
    else if (cPos === -1) { end = nlPos; isComma = false; }
    else if (nlPos === -1) { end = cPos; isComma = true; }
    else if (cPos < nlPos) { end = cPos; isComma = true; }
    else { end = nlPos; isComma = false; }
    const crPos = text.indexOf('\r', start);
    if (crPos !== -1 && crPos < end) {
      if (crPos + 1 === end && end < n && text.charCodeAt(end) === 10) {
        // CRLF: the field ends before the CR and the record ends.
        return [prefix + text.slice(start, crPos), end + 1, true, curLn + 1];
      }
      // Stray CR(s): scan this field, dropping each CR and reporting it.
      const parts = [prefix];
      let seg = start;
      let p = start;
      let ln = curLn;
      let fieldEnd = 'eof';
      let nextJ = n;
      while (p < n) {
        const c = text.charCodeAt(p);
        if (c === 44) { fieldEnd = 'comma'; nextJ = p + 1; break; }
        if (c === 10) { fieldEnd = 'break'; nextJ = p + 1; ln++; break; }
        if (c === 13) {
          if (p + 1 < n && text.charCodeAt(p + 1) === 10) {
            fieldEnd = 'break'; nextJ = p + 2; ln++; break;
          }
          parts.push(text.slice(seg, p));
          errors.push({ code: 'stray_cr', line: recLine, row: myRow });
          p++;
          seg = p;
          continue;
        }
        p++;
      }
      parts.push(text.slice(seg, p));
      const value = parts.join('');
      if (fieldEnd === 'comma') return [value, nextJ, false, ln];
      if (fieldEnd === 'break') return [value, nextJ, true, ln];
      return [value, n, false, ln];
    }
    const value = prefix + text.slice(start, end);
    if (isComma) return [value, end + 1, false, curLn];
    if (end < n) return [value, end + 1, true, curLn + 1];
    return [value, n, false, curLn];
  };

  while (i < n) {
    const ch0 = text.charCodeAt(i);
    if (ch0 === 10) { line++; i++; continue; } // empty line (LF)
    if (ch0 === 13) {
      if (i + 1 < n && text.charCodeAt(i + 1) === 10) { line++; i += 2; continue; } // empty line (CRLF)
      // Lone CR at record start: dropped + stray_cr, charged to the record
      // that is about to start.
      errors.push({ code: 'stray_cr', line, row: rowOf(records.length) });
      i++;
      continue;
    }

    // ---- record fast path: one physical line, no quotes, no stray CR ----
    const nl = text.indexOf('\n', i);
    const isLast = nl === -1;
    const lineEnd = isLast ? n : nl;
    // A trailing CR at EOF (no line break after it) is a stray CR, not a CRLF.
    const lastIsCR = isLast && n > i && text.charCodeAt(n - 1) === 13;
    let contentEnd = lineEnd;
    if (contentEnd > i && text.charCodeAt(contentEnd - 1) === 13) contentEnd--;
    const recText = text.slice(i, contentEnd);
    if (!lastIsCR && recText.indexOf('"') === -1 && recText.indexOf('\r') === -1) {
      const fields = recText.split(',');
      if (width === -1) {
        width = fields.length;
      } else if (fields.length < width) {
        errors.push({ code: 'short_row', line, row: rowOf(records.length), fields: fields.length });
      } else if (fields.length > width) {
        errors.push({ code: 'long_row', line, row: rowOf(records.length), extra: fields.slice(width) });
      }
      records.push(fields);
      if (isLast) { i = n; break; }
      i = nl + 1;
      line++;
      continue;
    }

    // ---- slow path: this record needs field-by-field parsing ----
    const recLine = line;
    const myRow = rowOf(records.length);
    const fields = [];
    let j = i;
    let ln = line;
    let ended = false;
    while (true) {
      if (j < n && text.charCodeAt(j) === 34) {
        // Quoted field: find the closing quote ("" is one escaped quote).
        let close = -1;
        let k = j + 1;
        while (k < n) {
          const q = text.indexOf('"', k);
          if (q === -1) break;
          if (q + 1 < n && text.charCodeAt(q + 1) === 34) { k = q + 2; continue; }
          close = q;
          break;
        }
        if (close === -1) {
          // Unterminated: the quote is literal, re-read the rest unquoted.
          const res = parseUnquoted(j + 1, '"', ln, recLine, myRow);
          fields.push(res[0]);
          errors.push({ code: 'unterminated_quote', line: recLine, row: myRow });
          j = res[1];
          ln = res[3];
          ended = res[2];
          if (ended || j >= n) break;
          continue;
        }
        // Closed quoted field: normalise its content.
        const raw = text.slice(j + 1, close);
        let val;
        if (raw.indexOf('"') === -1 && raw.indexOf('\n') === -1 && raw.indexOf('\r') === -1) {
          val = raw;
        } else if (raw.indexOf('\n') === -1 && raw.indexOf('\r') === -1) {
          val = raw.replaceAll('""', '"');
        } else {
          // Line breaks inside: one scan, normalising CRLF / lone CR to LF
          // and "" to one quote, counting the lines the field spans.
          const parts = [];
          let p = 0;
          const m = raw.length;
          let seg = 0;
          let newLn = ln;
          while (p < m) {
            const c = raw.charCodeAt(p);
            if (c === 34) {
              parts.push(raw.slice(seg, p), '"');
              p += 2;
              seg = p;
            } else if (c === 13) {
              parts.push(raw.slice(seg, p), '\n');
              p += (p + 1 < m && raw.charCodeAt(p + 1) === 10) ? 2 : 1;
              seg = p;
              newLn++;
            } else if (c === 10) {
              parts.push(raw.slice(seg, p), '\n');
              p += 1;
              seg = p;
              newLn++;
            } else {
              p++;
            }
          }
          parts.push(raw.slice(seg, m));
          val = parts.join('');
          ln = newLn;
        }
        // Junk after the closing quote, up to the next comma or line break.
        const cPos = text.indexOf(',', close + 1);
        const nlPos = text.indexOf('\n', close + 1);
        let junkEnd;
        let junkComma;
        if (cPos === -1 && nlPos === -1) { junkEnd = n; junkComma = false; }
        else if (cPos === -1) { junkEnd = nlPos; junkComma = false; }
        else if (nlPos === -1) { junkEnd = cPos; junkComma = true; }
        else if (cPos < nlPos) { junkEnd = cPos; junkComma = true; }
        else { junkEnd = nlPos; junkComma = false; }
        let junkContentEnd = junkEnd;
        if (!junkComma && junkEnd < n && junkEnd > close + 1 &&
            text.charCodeAt(junkEnd) === 10 && text.charCodeAt(junkEnd - 1) === 13) {
          junkContentEnd = junkEnd - 1; // CRLF: the CR is the line break, not junk
        }
        const junk = text.slice(close + 1, junkContentEnd);
        if (junk.length > 0) {
          errors.push({ code: 'quote_junk', line: recLine, row: myRow });
        }
        fields.push(val + junk);
        if (junkComma) {
          j = junkEnd + 1;
          continue;
        }
        if (junkEnd < n) {
          j = junkEnd + 1;
          ln++;
          ended = true;
        } else {
          j = n;
          ended = false;
        }
        break;
      }
      // Unquoted field (a quote inside it is literal).
      const res = parseUnquoted(j, '', ln, recLine, myRow);
      fields.push(res[0]);
      j = res[1];
      ln = res[3];
      ended = res[2];
      if (ended || j >= n) break;
    }
    if (width === -1) {
      width = fields.length;
    } else if (fields.length < width) {
      errors.push({ code: 'short_row', line: recLine, row: rowOf(records.length), fields: fields.length });
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recLine, row: rowOf(records.length), extra: fields.slice(width) });
    }
    records.push(fields);
    line = ln;
    i = j;
    if (!ended) break;
  }

  if (records.length === 0) {
    return { columns: header ? [] : null, rows: [], errors };
  }
  const w = records[0].length;
  const columns = header ? records[0].slice() : null;
  const rows = [];
  for (let r = 0; r < records.length; r++) {
    if (header && r === 0) continue;
    const f = records[r];
    if (f.length < w) {
      const row = f.slice();
      while (row.length < w) row.push('');
      rows.push(row);
    } else if (f.length > w) {
      rows.push(f.slice(0, w));
    } else {
      rows.push(f.slice());
    }
  }
  return { columns, rows, errors };
}
