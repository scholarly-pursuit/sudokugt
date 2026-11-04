// Rendering and input handling for the home and puzzle views.

import { BOXES, CODE_LENGTH, PAIRS, PEERS, decodeCode } from './engine.js';
import { Game, createStore } from './game.js';

const $ = (id) => document.getElementById(id);
const store = createStore();

// Every puzzle link uses this exact form: browsers only mark a link as visited
// when the whole URL matches.
const puzzleHref = (code) => `./?p=${code}`;

function formatTime(ms) {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

const capitalise = (text) => text.charAt(0).toUpperCase() + text.slice(1);

function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function describeSolved({ at, ms, mistakes, hints }) {
  const date = new Date(at).toLocaleDateString(undefined, {
    day: 'numeric', month: 'short', year: 'numeric',
  });
  return `${date} in ${formatTime(ms)}, with ${plural(mistakes, 'mistake')} and ${plural(hints, 'hint')}`;
}

function startWorker() {
  return new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
}

/* Home view */

function puzzleLink(code) {
  const link = document.createElement('a');
  link.className = 'puzzle-link';
  link.href = puzzleHref(code);
  link.textContent = code;
  return link;
}

function renderRecent() {
  const puzzles = store.recent();
  $('recent-empty').hidden = puzzles.length > 0;
  $('recent').replaceChildren(...puzzles.map(({ code, level, solved }) => {
    const item = document.createElement('li');
    item.append(puzzleLink(code));
    if (solved) {
      const tick = document.createElement('span');
      tick.className = 'tick';
      tick.textContent = '✓';
      tick.title = `Solved ${describeSolved(solved)}`;
      tick.setAttribute('aria-label', 'Solved');
      item.append(tick);
    }
    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = capitalise(level ?? '');
    item.append(meta);
    return item;
  }));
}

function openHome() {
  $('home').hidden = false;
  renderRecent();

  let worker = null;
  $('generate').addEventListener('click', () => {
    const level = document.querySelector('input[name="level"]:checked').value;
    const button = $('generate');
    button.disabled = true;
    $('generate-status').textContent = 'Generating a puzzle…';
    $('generated').hidden = true;

    worker = startWorker();
    worker.onmessage = ({ data: puzzle }) => {
      worker.terminate();
      button.disabled = false;
      $('generate-status').textContent = '';
      store.remember(puzzle.code, puzzle.level);
      $('generated-link').replaceChildren(puzzleLink(puzzle.code));
      $('generated').hidden = false;
      renderRecent();
    };
    worker.onerror = () => {
      button.disabled = false;
      $('generate-status').textContent = 'Something went wrong generating a puzzle. Please try again.';
    };
    worker.postMessage({ type: 'generate', level });
  });
}

/* Puzzle view */

const LOAD_TIMEOUT_MS = 20000;
const SAVE_EVERY_MS = 10000;
const CHEVRON = '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M3 1.500 7.500 5 3 8.500"/></svg>';

function showInvalid() {
  $('puzzle-status').textContent = '';
  $('puzzle-error').hidden = false;
}

function openPuzzle(code) {
  $('puzzle').hidden = false;
  if (!decodeCode(code) || code.length !== CODE_LENGTH) {
    showInvalid();
    return;
  }
  // Invalid codes usually fail fast, but one could take a long search, so the
  // load is abandoned after a while rather than leaving the page waiting.
  const worker = startWorker();
  const timeout = setTimeout(() => {
    worker.terminate();
    showInvalid();
  }, LOAD_TIMEOUT_MS);
  worker.onmessage = ({ data: puzzle }) => {
    clearTimeout(timeout);
    worker.terminate();
    if (puzzle) startGame(puzzle);
    else showInvalid();
  };
  worker.onerror = () => {
    clearTimeout(timeout);
    showInvalid();
  };
  worker.postMessage({ type: 'analyse', code });
}

function buildBoard(signs) {
  const cells = new Array(81);
  const noteEls = new Array(81);
  const slots = new Array(81);
  const directions = Array.from({ length: 81 }, () => []);

  const boxes = document.createElement('div');
  boxes.className = 'boxes';
  for (const box of BOXES) {
    const boxEl = document.createElement('div');
    boxEl.className = 'box';
    for (const i of box) {
      const slot = document.createElement('div');
      slot.className = 'slot';
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'cell';
      cell.dataset.cell = i;
      cell.tabIndex = -1;

      const value = document.createElement('span');
      value.className = 'value';
      const notes = document.createElement('span');
      notes.className = 'notes';
      noteEls[i] = [];
      for (let d = 1; d <= 9; d++) {
        const note = document.createElement('span');
        notes.append(note);
        noteEls[i].push(note);
      }
      cell.append(value, notes);
      slot.append(cell);
      boxEl.append(slot);
      cells[i] = cell;
      slots[i] = slot;
    }
    boxes.append(boxEl);
  }

  // The chevron's tip points at the smaller cell.
  const signEls = PAIRS.map(([a, b], k) => {
    const across = b === a + 1;
    const aIsGreater = signs[k] === 1;
    const sign = document.createElement('span');
    sign.className = `sign ${across ? 'across' : 'down'}`;
    sign.innerHTML = CHEVRON;
    const rotation = across ? (aIsGreater ? 0 : 180) : (aIsGreater ? 90 : 270);
    sign.firstChild.style.transform = `rotate(${rotation}deg)`;
    slots[a].append(sign);

    const [first, second] = aIsGreater ? ['greater', 'less'] : ['less', 'greater'];
    directions[a].push(`${first} than the cell ${across ? 'to the right' : 'below'}`);
    directions[b].push(`${second} than the cell ${across ? 'to the left' : 'above'}`);
    return sign;
  });

  $('board').replaceChildren(boxes);
  return { cells, noteEls, signEls, directions };
}

function startGame(puzzle) {
  const { code } = puzzle;
  const saved = store.loadProgress(code);
  const game = new Game(puzzle, saved?.values?.length === 81 ? saved : null);
  store.remember(code, puzzle.level);

  const { cells, noteEls, signEls, directions } = buildBoard(puzzle.signs);

  let selected = -1;
  let pencil = false;
  let paused = false;
  let lastTick = performance.now();

  const digitButtons = [];
  for (let d = 1; d <= 9; d++) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'digit';
    button.dataset.digit = d;
    button.append(String(d));
    button.append(document.createElement('small'));
    digitButtons.push(button);
  }
  $('pad').replaceChildren(...digitButtons);
  $('level').textContent = puzzle.level;

  function describeCell(i) {
    const r = Math.floor(i / 9) + 1;
    const c = (i % 9) + 1;
    let content = 'empty';
    if (game.values[i]) {
      content = `${game.values[i]}${game.isWrong(i) ? ', wrong' : ''}`;
    } else if (game.notes[i]) {
      const notes = [];
      for (let d = 1; d <= 9; d++) if (game.notes[i] & (1 << (d - 1))) notes.push(d);
      content = `notes ${notes.join(' ')}`;
    }
    return `Row ${r}, column ${c}, ${content}. ${capitalise(directions[i].join(', '))}.`;
  }

  function render() {
    const selectedDigit = selected >= 0 ? game.values[selected] : 0;
    const peers = selected >= 0 ? PEERS[selected] : [];

    for (let i = 0; i < 81; i++) {
      const value = game.values[i];
      const cell = cells[i];
      cell.classList.toggle('selected', i === selected);
      cell.classList.toggle('peer', peers.includes(i));
      cell.classList.toggle('same', selectedDigit !== 0 && value === selectedDigit && i !== selected);
      cell.classList.toggle('wrong', game.isWrong(i));
      cell.firstChild.textContent = paused || !value ? '' : value;
      cell.tabIndex = i === (selected >= 0 ? selected : 0) ? 0 : -1;
      cell.setAttribute('aria-label', paused ? 'Paused' : describeCell(i));

      noteEls[i].forEach((note, k) => {
        const digit = k + 1;
        const show = !paused && !value && game.notes[i] & (1 << k);
        note.textContent = show ? digit : '';
        note.classList.toggle('match', Boolean(show) && digit === selectedDigit);
      });
    }

    signEls.forEach((sign, k) => {
      sign.classList.toggle('active', PAIRS[k].includes(selected));
    });

    const finished = game.complete;
    digitButtons.forEach((button, k) => {
      const left = game.remaining(k + 1);
      button.disabled = left === 0 || paused || finished;
      button.querySelector('small').textContent = left;
      button.setAttribute('aria-label', `${k + 1}, ${left} left`);
    });

    $('mistakes').textContent = game.mistakes;
    $('hints').textContent = game.hints;
    $('time').textContent = formatTime(game.elapsedMs);
    $('pencil').setAttribute('aria-pressed', pencil);
    $('pencil-state').textContent = pencil ? 'on' : 'off';
    $('pad').classList.toggle('pencil-on', pencil);
    for (const id of ['undo', 'erase', 'pencil', 'hint', 'pause']) {
      $(id).disabled = finished || (paused && id !== 'pause');
    }
    $('paused').hidden = !paused;

    const record = store.record(code);
    $('solved-banner').hidden = !record?.solved;
    if (record?.solved) {
      $('solved-banner').textContent = `✓ You solved this puzzle on ${describeSolved(record.solved)}.`;
    }
  }

  const save = () => store.saveProgress(code, game.toJSON());

  function afterMove() {
    save();
    if (game.complete) finish();
    render();
  }

  function finish() {
    const solved = {
      at: Date.now(),
      ms: game.elapsedMs,
      mistakes: game.mistakes,
      hints: game.hints,
    };
    $('win-summary').textContent =
      `Finished in ${formatTime(solved.ms)}, with ${plural(solved.mistakes, 'mistake')} and ${plural(solved.hints, 'hint')}.`;
    store.markSolved(code, solved);
    $('win').showModal();
  }

  const playable = () => !paused && !game.complete;

  function enterDigit(digit) {
    if (!playable() || selected < 0 || game.remaining(digit) === 0) return;
    const changed = pencil ? game.toggleNote(selected, digit) : game.place(selected, digit);
    if (changed) afterMove();
  }

  function eraseSelected() {
    if (playable() && selected >= 0 && game.erase(selected)) afterMove();
  }

  function undo() {
    if (!playable()) return;
    const cell = game.undo();
    if (cell !== null) {
      selected = cell;
      afterMove();
    }
  }

  function togglePencil() {
    if (!playable()) return;
    pencil = !pencil;
    render();
  }

  function select(i) {
    if (paused) return;
    selected = i;
    cells[i].focus({ preventScroll: true });
    render();
  }

  function moveSelection(key) {
    const r = selected < 0 ? 0 : Math.floor(selected / 9);
    const c = selected < 0 ? 0 : selected % 9;
    if (selected < 0) return select(0);
    if (key === 'ArrowUp') select(((r + 8) % 9) * 9 + c);
    if (key === 'ArrowDown') select(((r + 1) % 9) * 9 + c);
    if (key === 'ArrowLeft') select(r * 9 + (c + 8) % 9);
    if (key === 'ArrowRight') select(r * 9 + (c + 1) % 9);
  }

  function setPaused(value) {
    paused = value;
    $('pause').setAttribute('aria-pressed', paused);
    $('pause').textContent = paused ? 'Resume' : 'Pause';
    lastTick = performance.now();
    render();
  }

  // The clock runs only while the puzzle is being played on screen.
  setInterval(() => {
    const now = performance.now();
    if (!paused && !document.hidden && !game.complete) {
      game.elapsedMs += now - lastTick;
      $('time').textContent = formatTime(game.elapsedMs);
    }
    lastTick = now;
  }, 1000);
  setInterval(() => {
    if (!paused && !document.hidden && !game.complete) save();
  }, SAVE_EVERY_MS);
  window.addEventListener('pagehide', save);
  document.addEventListener('visibilitychange', () => {
    lastTick = performance.now();
    if (document.hidden) save();
  });

  $('board').addEventListener('click', (event) => {
    const cell = event.target.closest('.cell');
    if (cell) select(Number(cell.dataset.cell));
  });
  $('pad').addEventListener('click', (event) => {
    const button = event.target.closest('.digit');
    if (button) enterDigit(Number(button.dataset.digit));
  });
  $('undo').addEventListener('click', undo);
  $('erase').addEventListener('click', eraseSelected);
  $('pencil').addEventListener('click', togglePencil);
  $('hint').addEventListener('click', () => {
    if (playable() && selected >= 0 && game.hint(selected)) afterMove();
  });
  $('pause').addEventListener('click', () => setPaused(!paused));
  $('resume').addEventListener('click', () => setPaused(false));

  $('copy').addEventListener('click', async () => {
    const button = $('copy');
    const original = button.textContent;
    try {
      await navigator.clipboard.writeText(location.href);
      button.textContent = 'Copied';
    } catch {
      button.textContent = 'Copy failed';
    }
    setTimeout(() => { button.textContent = original; }, 1500);
  });

  // A solved puzzle restarts at once. Otherwise the first click asks for confirmation.
  let restartArmed = null;
  $('restart').addEventListener('click', () => {
    const button = $('restart');
    if (!game.complete && restartArmed === null) {
      button.textContent = 'Really restart?';
      restartArmed = setTimeout(() => {
        button.textContent = 'Restart';
        restartArmed = null;
      }, 3000);
      return;
    }
    clearTimeout(restartArmed);
    restartArmed = null;
    button.textContent = 'Restart';
    game.reset();
    selected = -1;
    lastTick = performance.now();
    if (paused) setPaused(false);
    save();
    render();
  });

  document.addEventListener('keydown', (event) => {
    if ($('win').open) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      undo();
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (/^[1-9]$/.test(event.key)) {
      enterDigit(Number(event.key));
    } else if (event.key.startsWith('Arrow')) {
      event.preventDefault();
      moveSelection(event.key);
    } else if (event.key === 'Backspace' || event.key === 'Delete') {
      event.preventDefault();
      eraseSelected();
    } else if (event.key.toLowerCase() === 'n') {
      togglePencil();
    }
  });

  $('puzzle-status').textContent = '';
  $('stage').hidden = false;
  render();
}

const params = new URLSearchParams(location.search);
if (params.has('p')) openPuzzle(params.get('p'));
else openHome();
