// Puzzle logic for Sudoku GT: no DOM code here, so it runs in a worker or a test.
//
// Cells are indexed 0..80, row by row. A candidate set is a 9-bit mask where
// bit k means the digit k + 1 is still possible. Grids hold digits 1..9.

export const LEVELS = ['easy', 'medium', 'hard'];
export const CODE_LENGTH = 18;

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

const isSolved = (d) => d.every((x) => (x & (x - 1)) === 0);

// Rates a puzzle by the logic needed to finish it without guessing.
export function ratePuzzle(signs) {
  const inequalities = toInequalities(signs);
  const d = new Array(81).fill(ALL);
  if (!propagate(d, inequalities)) return null;
  if (isSolved(d)) return 'easy';
  while (applyLockedCandidates(d) || applyNakedPairs(d)) {
    if (!propagate(d, inequalities)) return null;
    if (isSolved(d)) return 'medium';
  }
  return 'hard';
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
