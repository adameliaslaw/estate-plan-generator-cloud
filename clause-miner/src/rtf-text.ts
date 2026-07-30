/**
 * §8 fallback ladder — minimal RTF plaintext extraction, dependency-free.
 * Used only when LibreOffice fails on an RTF file; the output is tagged
 * structureConfidence 'none' (frequency counts via exact-hash only, never
 * cluster seeds — §8), so this deliberately extracts TEXT, not structure.
 *
 * Handles: group nesting, destination skipping ({\fonttbl…} etc. and \*
 * ignorable destinations), \par/\line/\tab, \'hh hex escapes, \uN unicode
 * with \ucN fallback-skip counts, and escaped braces/backslashes.
 *
 * Pure module.
 */

const SKIP_DESTINATIONS = new Set([
  'fonttbl',
  'colortbl',
  'stylesheet',
  'info',
  'pict',
  'object',
  'header',
  'footer',
  'headerl',
  'headerr',
  'headerf',
  'footerl',
  'footerr',
  'footerf',
  'ftnsep',
  'ftnsepc',
  'xe',
  'tc',
  'field',
  'fldinst',
  'datafield',
  'themedata',
  'colorschememapping',
  'latentstyles',
  'generator',
]);

interface GroupState {
  skip: boolean;
  /** \ucN — number of fallback chars to skip after \uN. */
  uc: number;
}

export function rtfToText(rtf: string): string {
  let out = '';
  const stack: GroupState[] = [];
  let state: GroupState = { skip: false, uc: 1 };
  let i = 0;
  let pendingUnicodeSkip = 0;

  const emit = (s: string): void => {
    if (!state.skip) out += s;
  };

  while (i < rtf.length) {
    const ch = rtf[i];
    if (ch === '{') {
      stack.push(state);
      state = { ...state };
      i++;
      continue;
    }
    if (ch === '}') {
      state = stack.pop() ?? { skip: false, uc: 1 };
      i++;
      continue;
    }
    if (ch === '\\') {
      const next = rtf[i + 1];
      if (next === '\\' || next === '{' || next === '}') {
        emit(next);
        i += 2;
        continue;
      }
      if (next === '~') {
        emit(' ');
        i += 2;
        continue;
      }
      if (next === '*') {
        // Ignorable destination: skip the rest of this group.
        state.skip = true;
        i += 2;
        continue;
      }
      if (next === "'") {
        const hex = rtf.slice(i + 2, i + 4);
        if (pendingUnicodeSkip > 0) {
          pendingUnicodeSkip--;
        } else if (/^[0-9a-fA-F]{2}$/.test(hex)) {
          emit(String.fromCharCode(parseInt(hex, 16)));
        }
        i += 4;
        continue;
      }
      // Control word: letters, optional signed integer parameter, optional space.
      const m = /^\\([a-zA-Z]+)(-?\d+)?[ ]?/.exec(rtf.slice(i));
      if (m !== null) {
        const word = m[1];
        const param = m[2] !== undefined ? parseInt(m[2], 10) : undefined;
        if (SKIP_DESTINATIONS.has(word)) {
          state.skip = true;
        } else if (word === 'par' || word === 'line' || word === 'sect' || word === 'page') {
          emit('\n');
        } else if (word === 'tab' || word === 'cell') {
          emit('\t');
        } else if (word === 'row') {
          emit('\n');
        } else if (word === 'uc') {
          state.uc = param ?? 1;
        } else if (word === 'u' && param !== undefined) {
          const code = param < 0 ? param + 65536 : param;
          emit(String.fromCharCode(code));
          pendingUnicodeSkip = state.uc;
        } else if (word === 'emdash') {
          emit('—');
        } else if (word === 'endash') {
          emit('–');
        } else if (word === 'lquote' || word === 'rquote') {
          emit("'");
        } else if (word === 'ldblquote' || word === 'rdblquote') {
          emit('"');
        }
        // All other control words: formatting — ignored.
        i += m[0].length;
        continue;
      }
      // Lone backslash before something unexpected — skip it.
      i++;
      continue;
    }
    if (ch === '\r' || ch === '\n') {
      i++; // literal newlines in RTF source are not text
      continue;
    }
    if (pendingUnicodeSkip > 0) {
      pendingUnicodeSkip--;
      i++;
      continue;
    }
    emit(ch);
    i++;
  }

  return out.replace(/\n{3,}/g, '\n\n').trim();
}
