// Puzzle logic for Sudoku GT: no DOM code here, so it runs in a worker or a test.
//
// Cells are indexed 0..80, row by row. A candidate set is a 9-bit mask where
// bit k means the digit k + 1 is still possible. Grids hold digits 1..9.

export const LEVELS = ['very easy', 'easy', 'medium', 'hard', 'expert', 'master'];
export const CODE_LENGTH = 18;

// How many sign-forced cells an easy puzzle needs to count as very easy.
const VERY_EASY_MIN_FORCED = 3;

const ALL = 511;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

const POPCOUNT = Array.from({ length: 512 }, (_, mask) => {
  let n = 0;
  for (let m = mask; m; m &= m - 1) n++;
  return n;
});

export const ROWS = Array.from({ length: 9 }, (_, r) =>
  Array.from({ length: 9 }, (_, c) => r * 9 + c));
export const COLUMNS = Array.from({ length: 9 }, (_, c) =>
  Array.from({ length: 9 }, (_, r) => r * 9 + c));
export const BOXES = Array.from({ length: 9 }, (_, b) => {
  const top = Math.floor(b / 3) * 3;
  const left = (b % 3) * 3;
  const cells = [];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) cells.push((top + r) * 9 + left + c);
  }
  return cells;
});
const UNITS = [...ROWS, ...COLUMNS, ...BOXES];

export const PEERS = Array.from({ length: 81 }, (_, i) => {
  const peers = new Set();
  for (const unit of UNITS) {
    if (unit.includes(i)) unit.forEach((j) => peers.add(j));
  }
  peers.delete(i);
  return [...peers];
});

// Every adjacent pair of cells inside a box, in the fixed order used by puzzle
// codes. Each pair is [left, right] or [upper, lower]. This order must never
// change, because published links depend on it.
export const PAIRS = [];
for (let r = 0; r < 9; r++) {
  for (let c = 0; c < 9; c++) {
    const i = r * 9 + c;
    if (c % 3 !== 2) PAIRS.push([i, i + 1]);
    if (r % 3 !== 2) PAIRS.push([i, i + 9]);
  }
}

// signs[k] is 1 when the first cell of PAIRS[k] is greater than the second.
export function signsFromGrid(grid) {
  return PAIRS.map(([a, b]) => (grid[a] > grid[b] ? 1 : 0));
}

export function encodeSigns(signs) {
  let code = '';
  for (let i = 0; i < signs.length; i += 6) {
    let n = 0;
    for (let j = 0; j < 6; j++) n = n * 2 + signs[i + j];
    code += ALPHABET[n];
  }
  return code;
}

export function decodeCode(code) {
  if (typeof code !== 'string' || code.length !== CODE_LENGTH) return null;
  const signs = [];
  for (const ch of code) {
    const n = ALPHABET.indexOf(ch);
    if (n < 0) return null;
    for (let bit = 5; bit >= 0; bit--) signs.push((n >> bit) & 1);
  }
  return signs;
}

// Inequalities as [smaller cell, greater cell].
function toInequalities(signs) {
  return PAIRS.map(([a, b], k) => (signs[k] ? [b, a] : [a, b]));
}

// Applies singles and sign bounds until nothing changes. Returns false on a
// contradiction. Mutates the candidate array.
function propagate(d, inequalities) {
  for (;;) {
    let changed = false;

    for (let i = 0; i < 81; i++) {
      const x = d[i];
      if (x === 0) return false;
      if ((x & (x - 1)) === 0) {
        for (const j of PEERS[i]) {
          if (d[j] & x) {
            d[j] &= ~x;
            if (d[j] === 0) return false;
            changed = true;
          }
        }
      }
    }

    for (const unit of UNITS) {
      for (let m = 1; m < 512; m <<= 1) {
        let count = 0;
        let last = -1;
        for (const i of unit) {
          if (d[i] & m) {
            count++;
            last = i;
          }
        }
        if (count === 0) return false;
        if (count === 1 && d[last] !== m) {
          d[last] = m;
          changed = true;
        }
      }
    }

    for (const [lo, hi] of inequalities) {
      const highest = 1 << (31 - Math.clz32(d[hi]));
      const newLo = d[lo] & (highest - 1);
      if (newLo === 0) return false;
      if (newLo !== d[lo]) {
        d[lo] = newLo;
        changed = true;
      }
      const lowest = newLo & -newLo;
      const newHi = d[hi] & ~((lowest << 1) - 1) & ALL;
      if (newHi === 0) return false;
      if (newHi !== d[hi]) {
        d[hi] = newHi;
        changed = true;
      }
    }

    if (!changed) return true;
  }
}

function fewestCandidates(d) {
  let best = -1;
  let bestCount = 10;
  for (let i = 0; i < 81; i++) {
    const n = POPCOUNT[d[i]];
    if (n > 1 && n < bestCount) {
      bestCount = n;
      best = i;
    }
  }
  return best;
}

function maskToDigit(mask) {
  return 32 - Math.clz32(mask);
}

// Depth-first search that stops once `limit` solutions are found.
function search(d, inequalities, limit, solutions) {
  if (!propagate(d, inequalities)) return;
  const cell = fewestCandidates(d);
  if (cell < 0) {
    solutions.push(d.map(maskToDigit));
    return;
  }
  for (let rest = d[cell]; rest; ) {
    const m = rest & -rest;
    rest ^= m;
    const next = d.slice();
    next[cell] = m;
    search(next, inequalities, limit, solutions);
    if (solutions.length >= limit) return;
  }
}

export function solveSigns(signs, limit = 2) {
  const solutions = [];
  search(new Array(81).fill(ALL), toInequalities(signs), limit, solutions);
  return solutions;
}

export function randomGrid(rng = Math.random) {
  const fill = (d) => {
    if (!propagate(d, [])) return null;
    const cell = fewestCandidates(d);
    if (cell < 0) return d.map(maskToDigit);
    const options = [];
    for (let k = 0; k < 9; k++) if (d[cell] & (1 << k)) options.push(1 << k);
    for (let i = options.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [options[i], options[j]] = [options[j], options[i]];
    }
    for (const m of options) {
      const next = d.slice();
      next[cell] = m;
      const grid = fill(next);
      if (grid) return grid;
    }
    return null;
  };
  return fill(new Array(81).fill(ALL));
}

// Locked candidates: a digit confined to one line within a box, or to one box
// within a line, can be removed from the rest of that line or box.
function applyLockedCandidates(d) {
  let changed = false;
  const eliminate = (from, within, m) => {
    for (const i of from) {
      if (!within.includes(i) && d[i] & m) {
        d[i] &= ~m;
        changed = true;
      }
    }
  };
  for (let m = 1; m < 512; m <<= 1) {
    for (const box of BOXES) {
      const cells = box.filter((i) => d[i] & m);
      if (cells.length < 2) continue;
      const row = Math.floor(cells[0] / 9);
      const col = cells[0] % 9;
      if (cells.every((i) => Math.floor(i / 9) === row)) eliminate(ROWS[row], box, m);
      if (cells.every((i) => i % 9 === col)) eliminate(COLUMNS[col], box, m);
    }
    for (const line of [...ROWS, ...COLUMNS]) {
      const cells = line.filter((i) => d[i] & m);
      if (cells.length < 2) continue;
      const box = BOXES.find((b) => b.includes(cells[0]));
      if (cells.every((i) => box.includes(i))) eliminate(box, line, m);
    }
  }
  return changed;
}

function applyNakedPairs(d) {
  let changed = false;
  for (const unit of UNITS) {
    for (let a = 0; a < 9; a++) {
      const mask = d[unit[a]];
      if (POPCOUNT[mask] !== 2) continue;
      for (let b = a + 1; b < 9; b++) {
        if (d[unit[b]] !== mask) continue;
        for (const i of unit) {
          if (i !== unit[a] && i !== unit[b] && d[i] & mask) {
            d[i] &= ~mask;
            changed = true;
          }
        }
      }
    }
  }
  return changed;
}

// The techniques below expect fully propagated candidates, so each stops at its
// first change: a cell narrowed to one digit makes later checks in the pass unsound.

function applyNakedTriples(d) {
  for (const unit of UNITS) {
    const open = unit.filter((i) => POPCOUNT[d[i]] > 1);
    for (let a = 0; a < open.length; a++) {
      for (let b = a + 1; b < open.length; b++) {
        for (let c = b + 1; c < open.length; c++) {
          const mask = d[open[a]] | d[open[b]] | d[open[c]];
          if (POPCOUNT[mask] !== 3) continue;
          let changed = false;
          for (const i of open) {
            if (i !== open[a] && i !== open[b] && i !== open[c] && d[i] & mask) {
              d[i] &= ~mask;
              changed = true;
            }
          }
          if (changed) return true;
        }
      }
    }
  }
  return false;
}

// Two or three digits confined to the same number of cells clear those cells' other notes.
function applyHiddenSets(d) {
  for (const unit of UNITS) {
    const open = unit.filter((i) => POPCOUNT[d[i]] > 1);
    const digits = [];
    for (let m = 1; m < 512; m <<= 1) if (open.some((i) => d[i] & m)) digits.push(m);

    const confine = (mask, size) => {
      const cells = open.filter((i) => d[i] & mask);
      if (cells.length !== size) return false;
      let changed = false;
      for (const i of cells) {
        if (d[i] & ~mask) {
          d[i] &= mask;
          changed = true;
        }
      }
      return changed;
    };

    for (let a = 0; a < digits.length; a++) {
      for (let b = a + 1; b < digits.length; b++) {
        if (confine(digits[a] | digits[b], 2)) return true;
        for (let c = b + 1; c < digits.length; c++) {
          if (confine(digits[a] | digits[b] | digits[c], 3)) return true;
        }
      }
    }
  }
  return false;
}

function applyXWings(d) {
  const directions = [
    [ROWS, COLUMNS, (i) => i % 9],
    [COLUMNS, ROWS, (i) => Math.floor(i / 9)],
  ];
  for (let m = 1; m < 512; m <<= 1) {
    for (const [lines, crossLines, crossOf] of directions) {
      const spots = lines.map((line) => line.filter((i) => d[i] & m).map(crossOf));
      for (let a = 0; a < 9; a++) {
        if (spots[a].length !== 2) continue;
        for (let b = a + 1; b < 9; b++) {
          if (spots[b].length !== 2 || spots[a][0] !== spots[b][0] || spots[a][1] !== spots[b][1]) continue;
          let changed = false;
          for (const cross of spots[a]) {
            for (const i of crossLines[cross]) {
              if (!lines[a].includes(i) && !lines[b].includes(i) && d[i] & m) {
                d[i] &= ~m;
                changed = true;
              }
            }
          }
          if (changed) return true;
        }
      }
    }
  }
  return false;
}

// Keeps only the notes that appear in some arrangement of a box fitting its signs.
function applyBoxSigns(d, inequalities) {
  for (const box of BOXES) {
    const open = box.filter((i) => POPCOUNT[d[i]] > 1);
    if (open.length === 0) continue;
    const signs = inequalities.filter(([lo, hi]) => box.includes(lo) && box.includes(hi));
    const value = new Array(81).fill(0);
    let used = 0;
    for (const i of box) {
      if (POPCOUNT[d[i]] === 1) {
        value[i] = d[i];
        used |= d[i];
      }
    }

    const possible = new Array(81).fill(0);
    const place = (k, taken) => {
      if (k === open.length) {
        if (signs.every(([lo, hi]) => value[lo] < value[hi])) {
          for (const i of open) possible[i] |= value[i];
        }
        return;
      }
      const i = open[k];
      for (let m = 1; m < 512; m <<= 1) {
        if (d[i] & m && !(taken & m)) {
          value[i] = m;
          place(k + 1, taken | m);
        }
      }
    };
    place(0, used);

    let changed = false;
    for (const i of open) {
      if (possible[i] !== d[i]) {
        d[i] = possible[i];
        changed = true;
      }
    }
    if (changed) return true;
  }
  return false;
}

// Tries every way of placing one digit across the grid and removes the notes no
// placement uses. No technique limited to one digit, such as a Swordfish or an
// X-cycle, can find anything this misses.
function applyDigitPlacements(d) {
  const boxOf = (i) => Math.floor(i / 27) * 3 + Math.floor((i % 9) / 3);
  for (let m = 1; m < 512; m <<= 1) {
    const options = ROWS.map((row) => row.filter((i) => d[i] & m));
    const used = new Array(81).fill(false);
    const path = new Array(9);
    const place = (r, columns, boxes) => {
      if (r === 9) {
        for (const i of path) used[i] = true;
        return;
      }
      for (const i of options[r]) {
        const column = 1 << (i % 9);
        const box = 1 << boxOf(i);
        if (columns & column || boxes & box) continue;
        path[r] = i;
        place(r + 1, columns | column, boxes | box);
      }
    };
    place(0, 0, 0);

    let changed = false;
    for (let i = 0; i < 81; i++) {
      if (d[i] & m && !used[i]) {
        d[i] &= ~m;
        changed = true;
      }
    }
    if (changed) return true;
  }
  return false;
}

// The extra techniques each level adds, easiest first. A puzzle that needs more
// than the last of these is rated master.
const TECHNIQUES = [
  ['medium', [applyLockedCandidates, applyNakedPairs]],
  ['hard', [applyNakedTriples, applyHiddenSets, applyXWings, applyBoxSigns]],
  ['expert', [applyDigitPlacements]],
];

const isSolved = (d) => d.every((x) => (x & (x - 1)) === 0);

// Applies the techniques, always preferring the easiest, until none has an effect.
function narrow(d, inequalities, techniques) {
  while (!isSolved(d) && techniques.some((apply) => apply(d, inequalities))) {
    if (!propagate(d, inequalities)) return false;
  }
  return true;
}

// The candidates left using only the techniques available at a level.
export function candidatesAfter(signs, level) {
  const inequalities = toInequalities(signs);
  const d = new Array(81).fill(ALL);
  propagate(d, inequalities);
  const available = [];
  for (const [name, techniques] of TECHNIQUES) {
    if (level === 'easy') break;
    available.push(...techniques);
    narrow(d, inequalities, available);
    if (name === level) break;
  }
  return d;
}

// Cells whose digit follows from their own box's signs alone: a chain of signs
// relates the cell to all 8 others, so its rank within the box is known.
export function signForcedCells(signs) {
  const greater = Array.from({ length: 81 }, () => []);
  for (const [lo, hi] of toInequalities(signs)) greater[lo].push(hi);

  const forced = [];
  for (const box of BOXES) {
    const above = new Map(box.map((i) => [i, new Set()]));
    const collect = (i, seen) => {
      for (const j of greater[i]) {
        if (!seen.has(j)) {
          seen.add(j);
          collect(j, seen);
        }
      }
    };
    for (const i of box) collect(i, above.get(i));
    for (const i of box) {
      const below = box.filter((j) => above.get(j).has(i)).length;
      if (below + above.get(i).size === 8) forced.push({ cell: i, digit: below + 1 });
    }
  }
  return forced;
}

// Rates a puzzle by the logic needed to finish it without guessing, and for the
// easiest puzzles, by how many obvious places there are to start.
export function ratePuzzle(signs) {
  const inequalities = toInequalities(signs);
  const d = new Array(81).fill(ALL);
  if (!propagate(d, inequalities)) return null;
  if (isSolved(d)) {
    return signForcedCells(signs).length >= VERY_EASY_MIN_FORCED ? 'very easy' : 'easy';
  }
  const available = [];
  for (const [level, techniques] of TECHNIQUES) {
    available.push(...techniques);
    if (!narrow(d, inequalities, available)) return null;
    if (isSolved(d)) return level;
  }
  return 'master';
}

// Returns a puzzle with exactly one solution at the requested level.
export function generatePuzzle(level, rng = Math.random) {
  for (;;) {
    const grid = randomGrid(rng);
    const signs = signsFromGrid(grid);
    if (solveSigns(signs).length !== 1) continue;
    if (ratePuzzle(signs) !== level) continue;
    return { code: encodeSigns(signs), level, signs, solution: grid };
  }
}

// Loads a puzzle from its code, or returns null if the code isn't a valid puzzle.
export function analyseCode(code) {
  const signs = decodeCode(code);
  if (!signs) return null;
  const solutions = solveSigns(signs);
  if (solutions.length !== 1) return null;
  return { code, level: ratePuzzle(signs), signs, solution: solutions[0] };
}
