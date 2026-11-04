import { analyseCode, generatePuzzle } from './engine.js';

self.onmessage = ({ data }) => {
  const puzzle = data.type === 'generate'
    ? generatePuzzle(data.level)
    : analyseCode(data.code);
  self.postMessage(puzzle);
};
