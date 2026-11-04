// Game state and rules for one puzzle, plus the saved records. No DOM code here.

import { PAIRS, PEERS } from './engine.js';

const digitBit = (digit) => 1 << (digit - 1);

export class Game {
  constructor({ code, level, signs, solution }, saved = null) {
    this.code = code;
    this.level = level;
    this.solution = solution;

    // links[i] lists [neighbour, neighbourIsGreater] for each sign touching cell i.
    this.links = Array.from({ length: 81 }, () => []);
    PAIRS.forEach(([a, b], k) => {
      const aIsGreater = signs[k] === 1;
      this.links[a].push([b, !aIsGreater]);
      this.links[b].push([a, aIsGreater]);
    });

    this.reset();
    if (saved) Object.assign(this, saved);
  }

  reset() {
    this.values = new Array(81).fill(0);
    this.notes = new Array(81).fill(0); // 9-bit mask per cell
    this.mistakes = 0;
    this.hints = 0;
    this.elapsedMs = 0;
    this.history = [];
  }

  toJSON() {
    const { values, notes, mistakes, hints, elapsedMs, history } = this;
    return { values, notes, mistakes, hints, elapsedMs, history };
  }

  isCorrect(i) {
    return this.values[i] === this.solution[i];
  }

  isWrong(i) {
    return this.values[i] !== 0 && !this.isCorrect(i);
  }

  get complete() {
    return this.values.every((_, i) => this.isCorrect(i));
  }

  // How many of this digit are still to be correctly placed.
  remaining(digit) {
    let placed = 0;
    for (let i = 0; i < 81; i++) {
      if (this.values[i] === digit && this.isCorrect(i)) placed++;
    }
    return 9 - placed;
  }

  // Records each cell's prior state once, so that undo can restore it.
  beginMove() {
    const move = [];
    const touched = new Set();
    return {
      touch: (i) => {
        if (!touched.has(i)) {
          touched.add(i);
          move.push([i, this.values[i], this.notes[i]]);
        }
      },
      commit: () => this.history.push(move),
    };
  }

  place(i, digit) {
    if (this.isCorrect(i) || this.values[i] === digit) return false;
    const correct = digit === this.solution[i];
    const move = this.beginMove();
    move.touch(i);
    this.values[i] = digit;
    if (correct) {
      this.notes[i] = 0;
      this.removeNotesAfterPlacing(i, digit, move);
    } else {
      // A wrong number leaves all notes alone, including this cell's own: it
      // must not delete a true candidate, and erasing it brings the notes back.
      this.mistakes++;
    }
    move.commit();
    return true;
  }

  removeNotesAfterPlacing(i, digit, move) {
    const remove = (j, mask) => {
      if (this.notes[j] & mask) {
        move.touch(j);
        this.notes[j] &= ~mask;
      }
    };
    const bit = digitBit(digit);
    for (const j of PEERS[i]) remove(j, bit);
    const below = bit - 1;
    const above = 511 & ~(bit | below);
    for (const [j, neighbourIsGreater] of this.links[i]) {
      remove(j, neighbourIsGreater ? below | bit : above | bit);
    }
  }

  toggleNote(i, digit) {
    if (this.values[i] !== 0) return false;
    const move = this.beginMove();
    move.touch(i);
    this.notes[i] ^= digitBit(digit);
    move.commit();
    return true;
  }

  // Clears a wrong number, or an empty cell's notes. Correct numbers stay.
  erase(i) {
    if (this.isCorrect(i)) return false;
    if (this.values[i] === 0 && this.notes[i] === 0) return false;
    const move = this.beginMove();
    move.touch(i);
    if (this.values[i] !== 0) this.values[i] = 0;
    else this.notes[i] = 0;
    move.commit();
    return true;
  }

  hint(i) {
    if (this.isCorrect(i)) return false;
    this.place(i, this.solution[i]);
    this.hints++;
    return true;
  }

  // Mistake and hint counts deliberately stay as they are.
  undo() {
    const move = this.history.pop();
    if (!move) return null;
    for (const [i, value, notes] of move) {
      this.values[i] = value;
      this.notes[i] = notes;
    }
    return move[0][0];
  }
}

const PROGRESS_PREFIX = 'sudokugt.progress.';
const RECORDS_KEY = 'sudokugt.records';

function browserStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

// Saved per browser. Every access tolerates storage being unavailable, in which
// case the game still works but nothing is remembered.
export function createStore(storage = browserStorage()) {
  const read = (key) => {
    try {
      return JSON.parse(storage.getItem(key));
    } catch {
      return null;
    }
  };
  const write = (key, value) => {
    try {
      storage.setItem(key, JSON.stringify(value));
    } catch {
      // Nothing more to do: progress just won't persist.
    }
  };
  const records = () => read(RECORDS_KEY) ?? {};

  return {
    loadProgress: (code) => read(PROGRESS_PREFIX + code),
    saveProgress: (code, progress) => write(PROGRESS_PREFIX + code, progress),

    record: (code) => records()[code] ?? null,

    // Adds the puzzle to the list, or moves it to the top if already listed.
    remember(code, level) {
      const all = records();
      all[code] = { ...all[code], level, touchedAt: Date.now() };
      write(RECORDS_KEY, all);
    },

    // Keeps the first solve, so replaying can't overwrite when it was first solved.
    markSolved(code, solved) {
      const all = records();
      if (all[code]?.solved) return;
      all[code] = { ...all[code], solved };
      write(RECORDS_KEY, all);
    },

    recent(limit = 30) {
      return Object.entries(records())
        .map(([code, record]) => ({ code, ...record }))
        .sort((a, b) => (b.touchedAt ?? 0) - (a.touchedAt ?? 0))
        .slice(0, limit);
    },
  };
}
