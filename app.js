const SIZE = 7;
const TYPES = [
  { name: "에어리즘 경품", image: "./assets/prize-airism.png?v=1" },
  { name: "아이패드 경품", image: "./assets/prize-ipad-transparent.png?v=1" },
  { name: "골드바 경품", image: "./assets/prize-gold.png?v=1" },
  { name: "다이슨 경품", image: "./assets/prize-dyson.png?v=1" },
  { name: "Air 로고", image: "./assets/air-logo.png?v=6" },
];
const ROUND_SECONDS = 60;

const boardEl = document.querySelector("#board");
const scoreEl = document.querySelector("#score");
const timerBarEl = document.querySelector("#timerBar");
const comboTextEl = document.querySelector("#comboText");
const bestScoreEl = document.querySelector("#bestScore");
const overlayEl = document.querySelector("#overlay");
const finalScoreEl = document.querySelector("#finalScore");
const overlayTitleEl = document.querySelector("#overlayTitle");
const restartIconButton = document.querySelector("#restartIconButton");
const shareButton = document.querySelector("#shareButton");
const playAgainButton = document.querySelector("#playAgainButton");

let board = [];
let selected = null;
let score = 0;
let bestScore = Number(localStorage.getItem("animal-pop-best") || 0);
let timeLeft = ROUND_SECONDS;
let timerId = null;
let busy = false;
let paused = false;
let pointerStart = null;

bestScoreEl.textContent = `BEST ${bestScore.toLocaleString("ko-KR")}`;

function randomKind() {
  return Math.floor(Math.random() * TYPES.length);
}

function cellId(row, col) {
  return `${row}-${col}`;
}

function makeBoard() {
  const next = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));

  for (let row = 0; row < SIZE; row += 1) {
    for (let col = 0; col < SIZE; col += 1) {
      let kind = randomKind();
      while (
        (col >= 2 && next[row][col - 1] === kind && next[row][col - 2] === kind) ||
        (row >= 2 && next[row - 1][col] === kind && next[row - 2][col] === kind)
      ) {
        kind = randomKind();
      }
      next[row][col] = kind;
    }
  }

  board = next;
  ensureMoveAvailable();
}

function ensureMoveAvailable() {
  if (findPossibleMove()) return;
  makeBoard();
}

function render(popSet = new Set(), popLevel = 3) {
  boardEl.innerHTML = "";

  board.forEach((rowItems, row) => {
    rowItems.forEach((kind, col) => {
      const tile = document.createElement("button");
      tile.className = "tile";
      tile.type = "button";
      tile.dataset.row = row;
      tile.dataset.col = col;
      tile.dataset.kind = kind;
      tile.setAttribute("role", "gridcell");
      tile.setAttribute("aria-label", `${TYPES[kind].name} 타일 ${row + 1}행 ${col + 1}열`);
      tile.innerHTML = `<span><img src="${TYPES[kind].image}" alt="" /></span>`;

      if (selected && selected.row === row && selected.col === col) {
        tile.classList.add("selected");
      }
      if (popSet.has(cellId(row, col))) {
        tile.classList.add("pop");
        tile.dataset.match = popLevel >= 5 ? "five" : popLevel === 4 ? "four" : "three";
      }

      tile.addEventListener("pointerdown", (event) => startPointer(event, row, col));
      boardEl.appendChild(tile);
    });
  });
}

function startPointer(event, row, col) {
  if (busy || paused || timeLeft <= 0) return;
  pointerStart = {
    row,
    col,
    x: event.clientX,
    y: event.clientY,
  };
  event.currentTarget.setPointerCapture?.(event.pointerId);
}

function finishPointer(event) {
  if (!pointerStart || busy || paused || timeLeft <= 0) {
    pointerStart = null;
    return;
  }

  const start = pointerStart;
  pointerStart = null;
  const deltaX = event.clientX - start.x;
  const deltaY = event.clientY - start.y;
  const distance = Math.hypot(deltaX, deltaY);

  if (distance < 18) {
    selectTile(start.row, start.col);
    return;
  }

  const target = { row: start.row, col: start.col };
  if (Math.abs(deltaX) > Math.abs(deltaY)) {
    target.col += deltaX > 0 ? 1 : -1;
  } else {
    target.row += deltaY > 0 ? 1 : -1;
  }

  if (isInside(target)) {
    selected = null;
    trySwap(start, target);
  }
}

function selectTile(row, col) {
  if (busy || paused || timeLeft <= 0) return;

  if (!selected) {
    selected = { row, col };
    render();
    return;
  }

  if (selected.row === row && selected.col === col) {
    selected = null;
    render();
    return;
  }

  if (isAdjacent(selected, { row, col })) {
    const first = selected;
    selected = null;
    trySwap(first, { row, col });
    return;
  }

  selected = { row, col };
  render();
}

function isAdjacent(a, b) {
  return Math.abs(a.row - b.row) + Math.abs(a.col - b.col) === 1;
}

function isInside(cell) {
  return cell.row >= 0 && cell.row < SIZE && cell.col >= 0 && cell.col < SIZE;
}

async function trySwap(a, b) {
  busy = true;
  await animateSwap(a, b);
  swap(a, b);

  const groups = findMatchGroups();
  const matches = groupsToSet(groups);
  if (matches.size === 0) {
    await animateSwap(b, a, true);
    swap(a, b);
    comboTextEl.textContent = "";
    render();
    await wait(130);
    busy = false;
    return;
  }

  render();
  await resolveMatches(groups);
  busy = false;
}

async function resolveMatches(initialGroups) {
  let groups = initialGroups;
  let chain = 1;

  while (groups.length > 0) {
    const matches = groupsToSet(groups);
    const biggest = Math.max(...groups.map((group) => group.length));
    comboTextEl.textContent = matchMessage(biggest, chain);
    addScore(groups, chain);
    render(matches, biggest);
    await wait(280);
    removeMatches(matches);
    dropTiles();
    fillBoard();
    render();
    await wait(190);
    groups = findMatchGroups();
    chain += 1;
  }

  ensureMoveAvailable();
  render();
}

function swap(a, b) {
  const temp = board[a.row][a.col];
  board[a.row][a.col] = board[b.row][b.col];
  board[b.row][b.col] = temp;
}

function findMatchGroups(targetBoard = board) {
  const groups = [];

  for (let row = 0; row < SIZE; row += 1) {
    let runStart = 0;
    for (let col = 1; col <= SIZE; col += 1) {
      const same = col < SIZE && targetBoard[row][col] === targetBoard[row][runStart];
      if (!same) {
        if (col - runStart >= 3) {
          const group = [];
          for (let matchCol = runStart; matchCol < col; matchCol += 1) {
            group.push({ row, col: matchCol });
          }
          groups.push(group);
        }
        runStart = col;
      }
    }
  }

  for (let col = 0; col < SIZE; col += 1) {
    let runStart = 0;
    for (let row = 1; row <= SIZE; row += 1) {
      const same = row < SIZE && targetBoard[row][col] === targetBoard[runStart][col];
      if (!same) {
        if (row - runStart >= 3) {
          const group = [];
          for (let matchRow = runStart; matchRow < row; matchRow += 1) {
            group.push({ row: matchRow, col });
          }
          groups.push(group);
        }
        runStart = row;
      }
    }
  }

  return groups;
}

function findMatches(targetBoard = board) {
  return groupsToSet(findMatchGroups(targetBoard));
}

function groupsToSet(groups) {
  const matches = new Set();
  groups.forEach((group) => {
    group.forEach((cell) => matches.add(cellId(cell.row, cell.col)));
  });
  return matches;
}

function removeMatches(matches) {
  matches.forEach((id) => {
    const [row, col] = id.split("-").map(Number);
    board[row][col] = null;
  });
}

function dropTiles() {
  for (let col = 0; col < SIZE; col += 1) {
    const stack = [];
    for (let row = SIZE - 1; row >= 0; row -= 1) {
      if (board[row][col] !== null) stack.push(board[row][col]);
    }

    for (let row = SIZE - 1; row >= 0; row -= 1) {
      board[row][col] = stack[SIZE - 1 - row] ?? null;
    }
  }
}

function fillBoard() {
  for (let row = 0; row < SIZE; row += 1) {
    for (let col = 0; col < SIZE; col += 1) {
      if (board[row][col] === null) board[row][col] = randomKind();
    }
  }
}

function findPossibleMove() {
  for (let row = 0; row < SIZE; row += 1) {
    for (let col = 0; col < SIZE; col += 1) {
      const from = { row, col };
      const neighbors = [
        { row: row + 1, col },
        { row, col: col + 1 },
      ];

      for (const to of neighbors) {
        if (to.row >= SIZE || to.col >= SIZE) continue;
        const clone = board.map((line) => [...line]);
        const temp = clone[from.row][from.col];
        clone[from.row][from.col] = clone[to.row][to.col];
        clone[to.row][to.col] = temp;
        if (findMatchGroups(clone).length > 0) return [from, to];
      }
    }
  }
  return null;
}

function addScore(groups, chain) {
  const gained = groups.reduce((total, group) => {
    const length = group.length;
    const base = length >= 5 ? 1200 : length === 4 ? 650 : 300;
    return total + base + Math.max(0, length - 3) * 180;
  }, 0) * chain;

  score += gained;
  scoreEl.textContent = score.toLocaleString("ko-KR");
  showScorePop(gained);
}

function matchMessage(biggest, chain) {
  if (biggest >= 5) return chain > 1 ? `${chain} COMBO · 5 POP!` : "5 POP!";
  if (biggest === 4) return chain > 1 ? `${chain} COMBO · 4 POP!` : "4 POP!";
  return chain > 1 ? `${chain} COMBO!` : "3 POP!";
}

function animateSwap(a, b, reverse = false) {
  const first = getTile(a);
  const second = getTile(b);
  if (!first || !second) return wait(120);

  const cellSize = first.getBoundingClientRect().width + 2;
  const dx = (b.col - a.col) * cellSize;
  const dy = (b.row - a.row) * cellSize;
  first.style.transform = `translate(${dx}px, ${dy}px) scale(${reverse ? 0.98 : 1.04})`;
  second.style.transform = `translate(${-dx}px, ${-dy}px) scale(${reverse ? 0.98 : 1.04})`;
  first.classList.add("moving");
  second.classList.add("moving");
  return wait(150);
}

function getTile(cell) {
  return boardEl.querySelector(`[data-row="${cell.row}"][data-col="${cell.col}"]`);
}

function showScorePop(points) {
  const pop = document.createElement("div");
  pop.className = "score-pop";
  pop.textContent = `+${points.toLocaleString("ko-KR")}`;
  boardEl.appendChild(pop);
  setTimeout(() => pop.remove(), 700);
}

function startTimer() {
  clearInterval(timerId);
  timerId = setInterval(() => {
    if (paused) return;
    timeLeft -= 0.1;
    timerBarEl.style.width = `${Math.max(0, (timeLeft / ROUND_SECONDS) * 100)}%`;
    if (timeLeft <= 0) endGame();
  }, 100);
}

function endGame() {
  clearInterval(timerId);
  busy = true;
  if (score > bestScore) {
    bestScore = score;
    localStorage.setItem("animal-pop-best", String(bestScore));
    bestScoreEl.textContent = `BEST ${bestScore.toLocaleString("ko-KR")}`;
    overlayTitleEl.textContent = "New Best!";
  } else {
    overlayTitleEl.textContent = "Time Up";
  }
  finalScoreEl.textContent = score.toLocaleString("ko-KR");
  overlayEl.classList.remove("hidden");
}

function restart() {
  clearInterval(timerId);
  score = 0;
  timeLeft = ROUND_SECONDS;
  selected = null;
  busy = false;
  paused = false;
  scoreEl.textContent = "0";
  timerBarEl.style.width = "100%";
  comboTextEl.textContent = "";
  overlayEl.classList.add("hidden");
  makeBoard();
  render();
  startTimer();
}

async function shareGame() {
  const shareData = {
    title: "Air 경품팡",
    text: "Air와 함께하는 경품팡에 참여해보세요.",
    url: window.location.href,
  };

  if (navigator.share) {
    await navigator.share(shareData);
    return;
  }

  await navigator.clipboard?.writeText(window.location.href);
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

restartIconButton.addEventListener("click", restart);
shareButton.addEventListener("click", () => {
  shareGame().catch(() => {});
});
playAgainButton.addEventListener("click", restart);
window.addEventListener("pointerup", finishPointer);
window.addEventListener("pointercancel", () => {
  pointerStart = null;
});

restart();
