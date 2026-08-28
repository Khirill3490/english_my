import { cardKey, deckKey } from './storage.js';

function expandContractions(s) {
  return s
    .replace(/\b(i)'m\b/g, 'i am')
    .replace(/\b(you|we|they)'re\b/g, '$1 are')
    .replace(/\b(he|she|it)'s been\b/g, '$1 has been')
    .replace(/\b(he|she|it)'s\b/g, '$1 is')
    .replace(/\b(i|you|we|they)'ve\b/g, '$1 have')
    .replace(/\b(he|she|it)'ll\b/g, '$1 will')
    .replace(/\b(i|you|we|they)'ll\b/g, '$1 will')
    .replace(/\bcan't\b/g, 'cannot')
    .replace(/\bwon't\b/g, 'will not')
    .replace(/\bdon't\b/g, 'do not')
    .replace(/\bdoesn't\b/g, 'does not')
    .replace(/\bdidn't\b/g, 'did not')
    .replace(/\bisn't\b/g, 'is not')
    .replace(/\baren't\b/g, 'are not')
    .replace(/\bwasn't\b/g, 'was not')
    .replace(/\bweren't\b/g, 'were not')
    .replace(/\bhaven't\b/g, 'have not')
    .replace(/\bhasn't\b/g, 'has not')
    .replace(/\bhadn't\b/g, 'had not')
    .replace(/\bshouldn't\b/g, 'should not')
    .replace(/\bwouldn't\b/g, 'would not')
    .replace(/\bcouldn't\b/g, 'could not')
    .replace(/\bmustn't\b/g, 'must not')
    .replace(/\bneedn't\b/g, 'need not');
}

function normalize(s) {
  return expandContractions(
    String(s).toLowerCase().replace(/[’‘`]/g, "'").replace(/[“”]/g, '"').trim()
  ).replace(/[.,!?;:"()[\]{}]/g, '').replace(/\s+/g, ' ').trim();
}

function shuffledCopy(indices) {
  const copy = [...indices];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function tokeniseForDiff(value) {
  return String(value).match(/[A-Za-z0-9]+(?:['’][A-Za-z0-9]+)*|[^\s]/g) || [];
}

function diffTokenKey(token) {
  return token.toLowerCase().replace(/[’]/g, "'");
}

function computeTokenDiff(userText, expectedText) {
  const a = tokeniseForDiff(userText);
  const b = tokeniseForDiff(expectedText);
  const m = a.length;
  const n = b.length;
  const dp = Array.from({length:m + 1}, () => Array(n + 1).fill(0));

  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = diffTokenKey(a[i]) === diffTokenKey(b[j])
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const userParts = [];
  const expectedParts = [];
  let i = 0;
  let j = 0;
  while (i < m || j < n) {
    if (i < m && j < n && diffTokenKey(a[i]) === diffTokenKey(b[j])) {
      userParts.push({text:a[i], kind:'same'});
      expectedParts.push({text:b[j], kind:'same'});
      i++; j++;
    } else if (i < m && (j >= n || dp[i + 1][j] >= dp[i][j + 1])) {
      userParts.push({text:a[i], kind:'bad'});
      i++;
    } else if (j < n) {
      expectedParts.push({text:b[j], kind:'good'});
      j++;
    }
  }
  return { userParts, expectedParts };
}

function appendDiffParts(el, parts) {
  el.textContent = '';
  parts.forEach((part, idx) => {
    if (idx > 0) el.appendChild(document.createTextNode(' '));
    if (part.kind === 'same') {
      el.appendChild(document.createTextNode(part.text));
    } else {
      const span = document.createElement('span');
      span.className = part.kind === 'bad' ? 'diff-bad' : 'diff-good';
      span.textContent = part.text;
      el.appendChild(span);
    }
  });
}

function tokenDistance(a, b) {
  const aa = tokeniseForDiff(a).map(diffTokenKey);
  const bb = tokeniseForDiff(b).map(diffTokenKey);
  const dp = Array.from({length:aa.length + 1}, (_, i) =>
    Array.from({length:bb.length + 1}, (_, j) => i === 0 ? j : (j === 0 ? i : 0))
  );
  for (let i = 1; i <= aa.length; i++) {
    for (let j = 1; j <= bb.length; j++) {
      const cost = aa[i - 1] === bb[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[aa.length][bb.length];
}

export class Trainer {
  constructor(els, progressStore) {
    this.els = els;
    this.progress = progressStore;
    this.deck = [];
    this.lessons = [];
    this.signature = '';
    this.state = null;
    this.current = null;
    this.awaitingNext = false;
    this.lastWasWrong = false;
    this.bindEvents();
  }

  sessionStorageKey() {
    return `english-drill:v11:session:${this.signature}`;
  }

  makeSessionIndices(from, to, shuffle = false) {
    const indices = [];
    for (let n = from; n <= to; n++) indices.push(n - 1);
    return shuffle ? shuffledCopy(indices) : indices;
  }

  blankState() {
    const rangeFrom = 1;
    const rangeTo = Math.min(20, this.deck.length);
    const sessionIndices = this.makeSessionIndices(rangeFrom, rangeTo, false);
    return {
      queue: [...sessionIndices],
      sessionIndices,
      rangeFrom,
      rangeTo,
      shuffleRange: false,
      allCards: false,
      practiceMode: 'written',
      sessionFirstResult: {},
      sessionErrorsByIndex: {},
      sessionAttemptCount: 0,
      mastered: {},
      pendingRepeats: {},
      streak: 0,
      round: 1
    };
  }

  loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(this.sessionStorageKey()) || 'null');
      const state = saved && typeof saved === 'object' ? {...this.blankState(), ...saved} : this.blankState();
      state.queue = Array.isArray(state.queue) ? state.queue.filter(i => Number.isInteger(i) && i >= 0 && i < this.deck.length) : [];
      state.sessionIndices = Array.isArray(state.sessionIndices)
        ? state.sessionIndices.filter(i => Number.isInteger(i) && i >= 0 && i < this.deck.length)
        : [];
      if (!state.sessionIndices.length) {
        state.sessionIndices = this.makeSessionIndices(1, Math.min(20, this.deck.length), false);
        state.queue = [...state.sessionIndices];
      }
      state.rangeFrom = this.clampCardNumber(state.rangeFrom, 1);
      state.rangeTo = this.clampCardNumber(state.rangeTo, Math.min(20, this.deck.length));
      if (state.rangeFrom > state.rangeTo) [state.rangeFrom, state.rangeTo] = [state.rangeTo, state.rangeFrom];
      state.shuffleRange = Boolean(state.shuffleRange);
      state.allCards = Boolean(state.allCards);
      state.practiceMode = state.practiceMode === 'oral' ? 'oral' : 'written';
      state.sessionFirstResult ||= {};
      state.sessionErrorsByIndex ||= {};
      state.sessionAttemptCount ||= 0;
      state.mastered ||= {};
      state.pendingRepeats ||= {};
      state.streak ||= 0;
      state.round ||= 1;
      if (state.allCards) {
        state.rangeFrom = 1;
        state.rangeTo = this.deck.length;
      }
      return state;
    } catch {
      return this.blankState();
    }
  }

  saveState() {
    if (!this.state || !this.signature) return;
    localStorage.setItem(this.sessionStorageKey(), JSON.stringify(this.state));
    this.progress.save();
  }

  setDeck(cards, lessons = []) {
    this.deck = cards;
    this.lessons = lessons;
    this.signature = deckKey(cards);
    this.current = null;
    this.awaitingNext = false;
    this.state = this.loadState();

    this.els.rangeFromInput.max = this.deck.length;
    this.els.rangeToInput.max = this.deck.length;
    this.els.rangeFromInput.value = this.state.rangeFrom || 1;
    this.els.rangeToInput.value = this.state.allCards ? this.deck.length : Math.min(this.state.rangeTo || 20, this.deck.length);
    this.els.shuffleRangeInput.checked = Boolean(this.state.shuffleRange);
    this.syncAllCardsUI();
    this.applyPracticeMode(this.state.practiceMode, false);
    this.pickNext();
  }

  hasActiveSession() {
    return Boolean(this.state && ((this.state.sessionAttemptCount || 0) > 0 || Object.keys(this.state.mastered || {}).length));
  }

  clampCardNumber(value, fallback) {
    const n = Math.floor(Number(value) || fallback);
    return Math.max(1, Math.min(n, Math.max(1, this.deck.length)));
  }

  syncAllCardsUI() {
    const full = Boolean(this.state?.allCards);
    this.els.allCardsBtn.classList.toggle('active-toggle', full);
    this.els.allCardsBtn.setAttribute('aria-pressed', full ? 'true' : 'false');
    this.els.rangeControl.classList.toggle('full-mode', full);
    this.els.rangeFromInput.disabled = full;
    this.els.rangeToInput.disabled = full;
    if (full && this.deck.length) {
      this.els.rangeFromInput.value = 1;
      this.els.rangeToInput.value = this.deck.length;
    }
  }

  setAllCardsMode(enabled, persist = true) {
    if (!this.state) return;
    this.state.allCards = Boolean(enabled);
    if (this.state.allCards) {
      this.state.rangeFrom = 1;
      this.state.rangeTo = this.deck.length;
    }
    this.syncAllCardsUI();
    if (persist) this.saveState();
  }

  normalizeRangeInputs() {
    if (this.state?.allCards) {
      const fullRange = { from: 1, to: Math.max(1, this.deck.length) };
      this.els.rangeFromInput.value = fullRange.from;
      this.els.rangeToInput.value = fullRange.to;
      return fullRange;
    }
    let from = this.clampCardNumber(this.els.rangeFromInput.value, 1);
    let to = this.clampCardNumber(this.els.rangeToInput.value, Math.min(20, this.deck.length));
    if (from > to) [from, to] = [to, from];
    this.els.rangeFromInput.value = from;
    this.els.rangeToInput.value = to;
    return { from, to };
  }

  validAnswers(card) {
    return [...card.answers, ...this.progress.acceptedAnswers(card)];
  }

  isCorrect(user, card) {
    const u = normalize(user);
    return this.validAnswers(card).some(a => normalize(a) === u);
  }

  updateCurrentCardStatus() {
    if (this.current === null || !this.deck[this.current]) return;
    const status = this.progress.cardStatus(this.deck[this.current]);
    this.els.cardStatusBadge.textContent = status.label;
    this.els.cardStatusBadge.className = 'status-badge ' + status.className;
  }

  closestReference(userText, card) {
    let best = card.answers[0] || '';
    let bestDistance = Infinity;
    card.answers.forEach(answer => {
      const d = tokenDistance(userText, answer);
      if (d < bestDistance) { bestDistance = d; best = answer; }
    });
    return best;
  }

  applyPracticeMode(mode, persist = true) {
    const normalized = mode === 'oral' ? 'oral' : 'written';
    if (this.state) this.state.practiceMode = normalized;
    const oral = normalized === 'oral';
    this.els.writtenModeBtn.classList.toggle('active', !oral);
    this.els.oralModeBtn.classList.toggle('active', oral);
    this.els.writtenModePanel.classList.toggle('hidden', oral);
    this.els.oralModePanel.classList.toggle('hidden', !oral);
    if (persist && this.state) this.saveState();
    if (this.current !== null) this.resetQuestionUIForMode();
  }

  resetQuestionUIForMode() {
    const oral = this.state?.practiceMode === 'oral';
    this.els.feedback.className = 'feedback';
    this.els.complete.classList.add('hidden');
    if (oral) {
      this.els.oralCheckBtn.classList.remove('hidden');
      this.els.oralAnswerBox.classList.add('hidden');
      this.els.oralDecisionButtons.classList.add('hidden');
      this.els.oralCorrectAnswer.textContent = '';
    } else {
      this.els.answerInput.value = '';
      this.els.answerInput.disabled = false;
      this.els.answerInput.classList.remove('hidden');
      this.els.checkBtn.classList.remove('hidden');
      this.els.dontKnowBtn.classList.remove('hidden');
      this.els.acceptBtn.classList.add('hidden');
      this.els.nextBtn.classList.add('hidden');
      setTimeout(() => this.els.answerInput.focus(), 0);
    }
  }

  pickNext() {
    if (!this.state || !this.deck.length) return;
    if (this.state.queue.length === 0) {
      this.showComplete();
      return;
    }
    this.current = this.state.queue.shift();
    this.awaitingNext = false;
    this.lastWasWrong = false;
    const card = this.deck[this.current];
    this.els.prompt.textContent = card.ru;
    this.els.lessonSource.textContent = `${card.lessonTitle} · №${card.lessonCardNumber}`;
    const scopeLabel = this.state.allCards
      ? `все ${this.deck.length}`
      : `${this.state.rangeFrom}–${this.state.rangeTo}`;
    this.els.positionText.textContent = `${scopeLabel} · осталось ${this.state.queue.length + 1}`;
    this.updateCurrentCardStatus();
    this.resetQuestionUIForMode();
    this.updateStats();
  }

  removePendingOccurrences(index) {
    this.state.queue = this.state.queue.filter(i => i !== index);
  }

  randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  scheduleReinforcement(index) {
    this.removePendingOccurrences(index);
    const firstGap = Math.min(this.randomInt(5, 10), this.state.queue.length);
    const firstPos = Math.min(firstGap, this.state.queue.length);
    this.state.queue.splice(firstPos, 0, index);
    const secondGap = this.randomInt(10, 15);
    const secondPos = Math.min(firstPos + 1 + secondGap, this.state.queue.length);
    this.state.queue.splice(secondPos, 0, index);
    this.state.pendingRepeats[index] = 2;
    delete this.state.mastered[index];
    return { first: firstPos + 1, secondAfterFirst: Math.max(1, secondPos - firstPos) };
  }

  scheduleIntensiveReinforcement(index) {
    this.removePendingOccurrences(index);
    const firstGap = Math.min(this.randomInt(3, 5), this.state.queue.length);
    const firstPos = Math.min(firstGap, this.state.queue.length);
    this.state.queue.splice(firstPos, 0, index);
    const secondGap = this.randomInt(5, 8);
    const secondPos = Math.min(firstPos + 1 + secondGap, this.state.queue.length);
    this.state.queue.splice(secondPos, 0, index);
    const thirdGap = this.randomInt(10, 15);
    const thirdPos = Math.min(secondPos + 1 + thirdGap, this.state.queue.length);
    this.state.queue.splice(thirdPos, 0, index);
    this.state.pendingRepeats[index] = 3;
    delete this.state.mastered[index];
    return { first:firstPos + 1, secondAfterFirst:Math.max(1, secondPos-firstPos), thirdAfterSecond:Math.max(1, thirdPos-secondPos) };
  }

  recordOutcome(result) {
    if (this.current === null) return;
    this.progress.recordOutcome(this.deck[this.current], result);
    if (this.state.sessionFirstResult[this.current] === undefined) this.state.sessionFirstResult[this.current] = result;
    if (result !== 'known') this.state.sessionErrorsByIndex[this.current] = (this.state.sessionErrorsByIndex[this.current] || 0) + 1;
    this.state.sessionAttemptCount += 1;
  }

  markAttempt(error) {
    if (this.current === null) return;
    this.progress.markAttempt(this.deck[this.current], error);
    if (error) {
      this.state.streak = 0;
    } else {
      this.state.streak += 1;
      this.progress.setBestStreak(this.state.streak);
    }
  }

  submitAnswer() {
    if (this.awaitingNext) { this.nextCard(); return; }
    const userText = this.els.answerInput.value.trim();
    if (!userText || this.current === null) return;
    const pendingBefore = this.state.pendingRepeats[this.current] || 0;

    if (this.isCorrect(userText, this.deck[this.current])) {
      this.markAttempt(false);
      this.recordOutcome('known');
      if (pendingBefore > 0) {
        this.state.pendingRepeats[this.current] = pendingBefore - 1;
        if (this.state.pendingRepeats[this.current] <= 0) {
          delete this.state.pendingRepeats[this.current];
          this.state.mastered[this.current] = true;
          this.showFeedback('ok', '✓ Закреплено', userText, 'Все контрольные повторы пройдены правильно.');
        } else {
          delete this.state.mastered[this.current];
          this.showFeedback('ok', '✓ Правильно', userText, 'Хорошо. Позже будет ещё один контрольный повтор.');
        }
      } else {
        this.state.mastered[this.current] = true;
        this.showFeedback('ok', '✓ Правильно', userText, 'Карточка выполнена в этой сессии.');
      }
      this.awaitingNext = true;
      this.lastWasWrong = false;
      this.els.acceptBtn.classList.add('hidden');
    } else {
      this.markAttempt(true);
      this.recordOutcome('almost');
      const timing = this.scheduleReinforcement(this.current);
      this.showFeedback('bad', '✕ Пока не совпало', userText,
        `Первый повтор примерно через ${timing.first} заданий, второй — ещё через ${timing.secondAfterFirst} после него.`);
      this.awaitingNext = true;
      this.lastWasWrong = true;
      this.els.acceptBtn.classList.remove('hidden');
    }
    this.finishAttemptUI();
    this.saveState();
    this.updateStats();
  }

  dontKnow() {
    if (this.awaitingNext || this.current === null) return;
    this.markAttempt(true);
    this.recordOutcome('unknown');
    const timing = this.scheduleReinforcement(this.current);
    this.showFeedback('warn', 'Показываю ответ', '',
      `Первый повтор примерно через ${timing.first} заданий, второй — ещё через ${timing.secondAfterFirst} после него.`);
    this.awaitingNext = true;
    this.lastWasWrong = true;
    this.els.acceptBtn.classList.add('hidden');
    this.finishAttemptUI();
    this.saveState();
    this.updateStats();
  }

  revealOralAnswer() {
    if (this.state?.practiceMode !== 'oral' || this.current === null) return;
    this.els.oralCorrectAnswer.textContent = this.deck[this.current].answers.join('  /  ');
    this.els.oralAnswerBox.classList.remove('hidden');
    this.els.oralDecisionButtons.classList.remove('hidden');
    this.els.oralCheckBtn.classList.add('hidden');
  }

  markOralKnown() {
    if (this.state?.practiceMode !== 'oral' || this.current === null) return;
    const pendingBefore = this.state.pendingRepeats[this.current] || 0;
    this.markAttempt(false);
    this.recordOutcome('known');
    if (pendingBefore > 0) {
      this.state.pendingRepeats[this.current] = pendingBefore - 1;
      if (this.state.pendingRepeats[this.current] <= 0) {
        delete this.state.pendingRepeats[this.current];
        this.state.mastered[this.current] = true;
      } else delete this.state.mastered[this.current];
    } else this.state.mastered[this.current] = true;
    this.saveState(); this.updateStats(); this.pickNext();
  }

  markOralAlmost() {
    if (this.state?.practiceMode !== 'oral' || this.current === null) return;
    this.markAttempt(true); this.recordOutcome('almost'); this.scheduleReinforcement(this.current);
    this.saveState(); this.updateStats(); this.pickNext();
  }

  markOralDontKnow() {
    if (this.state?.practiceMode !== 'oral' || this.current === null) return;
    this.markAttempt(true); this.recordOutcome('unknown'); this.scheduleIntensiveReinforcement(this.current);
    this.saveState(); this.updateStats(); this.pickNext();
  }

  finishAttemptUI() {
    this.els.answerInput.disabled = true;
    this.els.checkBtn.classList.add('hidden');
    this.els.dontKnowBtn.classList.add('hidden');
    this.els.nextBtn.classList.remove('hidden');
  }

  showFeedback(kind, title, user, info) {
    const card = this.deck[this.current];
    this.els.feedback.className = 'feedback ' + kind;
    this.els.fbTitle.textContent = title;
    this.els.repeatInfo.textContent = info;
    if (user) {
      this.els.yourRow.classList.remove('hidden');
      if (kind === 'bad') {
        const reference = this.closestReference(user, card);
        const diff = computeTokenDiff(user, reference);
        appendDiffParts(this.els.yourAnswer, diff.userParts);
        appendDiffParts(this.els.correctAnswer, diff.expectedParts);
      } else {
        this.els.yourAnswer.textContent = user;
        this.els.correctAnswer.textContent = card.answers.join('  /  ');
      }
    } else {
      this.els.yourRow.classList.add('hidden');
      this.els.correctAnswer.textContent = card.answers.join('  /  ');
    }
  }

  acceptCurrentAnswer() {
    const val = this.els.answerInput.value.trim();
    if (!val || this.current === null) return;
    this.progress.addAcceptedAnswer(this.deck[this.current], val, normalize);
    this.removePendingOccurrences(this.current);
    delete this.state.pendingRepeats[this.current];
    this.state.mastered[this.current] = true;
    this.lastWasWrong = false;
    this.els.feedback.className = 'feedback ok';
    this.els.fbTitle.textContent = '✓ Засчитано как допустимый вариант';
    this.els.repeatInfo.textContent = 'Этот вариант сохранён для этой карточки и будет приниматься во всех уроках и комбинациях.';
    this.els.acceptBtn.classList.add('hidden');
    this.saveState(); this.updateStats();
  }

  nextCard() {
    if (!this.awaitingNext) return;
    this.pickNext();
  }

  renderSessionReport() {
    const total = (this.state.sessionIndices || []).length;
    const values = Object.values(this.state.sessionFirstResult || {});
    const known = values.filter(v => v === 'known').length;
    const almost = values.filter(v => v === 'almost').length;
    const unknown = values.filter(v => v === 'unknown').length;
    const accuracy = total ? Math.round((known / total) * 100) : 0;

    this.els.reportTotal.textContent = total;
    this.els.reportKnown.textContent = known;
    this.els.reportAlmost.textContent = almost;
    this.els.reportUnknown.textContent = unknown;
    this.els.reportAccuracy.textContent = accuracy + '%';
    this.els.reportAttempts.textContent = this.state.sessionAttemptCount || 0;
    const modeName = this.state.practiceMode === 'oral' ? 'устной' : 'письменной';
    this.els.reportSubtitle.textContent = `Итоги ${modeName} сессии. Считается первая попытка по каждой карточке.`;

    const ranked = Object.entries(this.state.sessionErrorsByIndex || {})
      .map(([index, count]) => [Number(index), Number(count)])
      .filter(([index]) => this.deck[index])
      .sort((a,b) => b[1] - a[1])
      .slice(0,5);
    this.els.sessionProblems.textContent = '';
    if (!ranked.length) {
      this.els.sessionProblemBox.classList.add('hidden');
    } else {
      this.els.sessionProblemBox.classList.remove('hidden');
      ranked.forEach(([index, count]) => {
        const card = this.deck[index];
        const row = document.createElement('div'); row.className = 'report-problem';
        const left = document.createElement('span');
        left.textContent = `${card.lessonTitle} · №${card.lessonCardNumber} · ${card.ru}`;
        const right = document.createElement('strong'); right.textContent = count + '×';
        row.append(left, right); this.els.sessionProblems.appendChild(row);
      });
    }

    this.renderLessonBreakdown();
  }

  renderLessonBreakdown() {
    const groups = new Map();
    for (const index of this.state.sessionIndices || []) {
      const card = this.deck[index];
      if (!card) continue;
      const id = String(card.lessonId);
      if (!groups.has(id)) groups.set(id, { title:card.lessonTitle, total:0, known:0, almost:0, unknown:0 });
      const g = groups.get(id);
      g.total += 1;
      const result = this.state.sessionFirstResult[index];
      if (result === 'known') g.known += 1;
      else if (result === 'almost') g.almost += 1;
      else if (result === 'unknown') g.unknown += 1;
    }

    this.els.lessonReportRows.textContent = '';
    if (groups.size <= 1) {
      this.els.lessonReportBox.classList.add('hidden');
      return;
    }
    this.els.lessonReportBox.classList.remove('hidden');
    for (const g of groups.values()) {
      const row = document.createElement('div'); row.className = 'lesson-report-row';
      const name = document.createElement('span'); name.className = 'lesson-name'; name.textContent = g.title;
      const accuracy = g.total ? Math.round(g.known / g.total * 100) : 0;
      const total = document.createElement('span'); total.className = 'metric hide-mobile'; total.innerHTML = `<strong>${g.total}</strong> карт.`;
      const known = document.createElement('span'); known.className = 'metric'; known.innerHTML = `<strong>${accuracy}%</strong>`;
      const problems = document.createElement('span'); problems.className = 'metric'; problems.innerHTML = `<strong>${g.almost + g.unknown}</strong> пробл.`;
      const unknown = document.createElement('span'); unknown.className = 'metric hide-mobile'; unknown.innerHTML = `<strong>${g.unknown}</strong> не знал`;
      row.append(name, total, known, problems, unknown);
      this.els.lessonReportRows.appendChild(row);
    }
  }

  showComplete() {
    this.current = null;
    this.els.prompt.textContent = 'Все карточки выполнены.';
    this.els.lessonSource.textContent = '';
    this.els.answerInput.classList.add('hidden');
    this.els.checkBtn.classList.add('hidden');
    this.els.dontKnowBtn.classList.add('hidden');
    this.els.acceptBtn.classList.add('hidden');
    this.els.nextBtn.classList.add('hidden');
    this.els.oralCheckBtn.classList.add('hidden');
    this.els.oralAnswerBox.classList.add('hidden');
    this.els.oralDecisionButtons.classList.add('hidden');
    this.els.feedback.className = 'feedback';
    this.els.complete.classList.remove('hidden');
    this.els.positionText.textContent = `сессия ${this.state.round} завершена`;
    this.renderSessionReport();
    this.updateStats();
    this.saveState();
  }

  startNewSession() {
    const range = this.state.allCards ? { from:1, to:this.deck.length } : this.normalizeRangeInputs();
    const shuffle = this.els.shuffleRangeInput.checked;
    let indices = this.makeSessionIndices(range.from, range.to, false);
    if (shuffle) indices = shuffledCopy(indices);

    this.state.rangeFrom = range.from;
    this.state.rangeTo = range.to;
    this.state.shuffleRange = shuffle;
    this.state.sessionIndices = indices;
    this.state.queue = [...indices];
    this.state.mastered = {};
    this.state.pendingRepeats = {};
    this.state.sessionFirstResult = {};
    this.state.sessionErrorsByIndex = {};
    this.state.sessionAttemptCount = 0;
    this.state.streak = 0;
    this.state.round += 1;
    this.saveState(); this.pickNext();
  }

  resetRound() {
    if (!confirm('Перезапустить текущую сессию? Будут использованы те же карточки и тот же порядок. История ошибок сохранится.')) return;
    this.state.queue = [...this.state.sessionIndices];
    this.state.mastered = {};
    this.state.pendingRepeats = {};
    this.state.sessionFirstResult = {};
    this.state.sessionErrorsByIndex = {};
    this.state.sessionAttemptCount = 0;
    this.state.streak = 0;
    this.saveState(); this.pickNext();
  }

  updateStats() {
    if (!this.state) return;
    const activeSet = new Set(this.state.sessionIndices || []);
    if (this.current !== null) this.updateCurrentCardStatus();
    const done = Object.keys(this.state.mastered).filter(k => this.state.mastered[k] && activeSet.has(Number(k))).length;
    const sessionTotal = activeSet.size;
    const leftUnique = Math.max(sessionTotal - done, 0);
    this.els.doneStat.textContent = done;
    this.els.leftStat.textContent = leftUnique;
    this.els.errorsStat.textContent = this.progress.totalErrors();
    this.els.streakStat.textContent = this.state.streak;
    this.els.progressBar.style.width = (sessionTotal ? (done / sessionTotal * 100) : 0) + '%';

    const byKey = new Map(this.deck.map(card => [cardKey(card), card]));
    const ranked = this.progress.topErrors(20).filter(([key]) => byKey.has(key)).slice(0,5);
    this.els.problems.innerHTML = '';
    if (!ranked.length) {
      this.els.problems.innerHTML = '<div class="mini">Ошибок пока нет. Так держать.</div>';
    } else {
      for (const [key, count] of ranked) {
        const card = byKey.get(key);
        const row = document.createElement('div'); row.className = 'problem';
        const left = document.createElement('span'); left.textContent = card.ru;
        const right = document.createElement('strong'); right.textContent = count + '×';
        row.append(left, right); this.els.problems.appendChild(row);
      }
    }
  }

  previewScopeText() {
    const range = this.state.allCards ? { from:1, to:this.deck.length } : this.normalizeRangeInputs();
    const count = range.to - range.from + 1;
    const orderText = this.els.shuffleRangeInput.checked ? 'перемешанно' : 'по порядку';
    return this.state.allCards
      ? `все карточки (${count}, ${orderText})`
      : `${range.from}–${range.to} (${count} карточек, ${orderText})`;
  }

  bindEvents() {
    const e = this.els;
    e.writtenModeBtn.addEventListener('click', () => this.applyPracticeMode('written'));
    e.oralModeBtn.addEventListener('click', () => this.applyPracticeMode('oral'));
    e.oralCheckBtn.addEventListener('click', () => this.revealOralAnswer());
    e.oralDontKnowBtn.addEventListener('click', () => this.markOralDontKnow());
    e.oralAlmostBtn.addEventListener('click', () => this.markOralAlmost());
    e.oralKnowBtn.addEventListener('click', () => this.markOralKnown());
    e.startSessionBtn.addEventListener('click', () => {
      if (!this.state || !this.deck.length) return;
      const scopeText = this.previewScopeText();
      if (this.hasActiveSession() && !confirm(`Начать сессию: ${scopeText}? Текущий прогресс сессии будет сброшен, история карточек сохранится.`)) return;
      this.startNewSession();
    });
    e.rangeFromInput.addEventListener('change', () => {
      if (!this.state) return;
      if (this.state.allCards) this.setAllCardsMode(false, false);
      const r = this.normalizeRangeInputs(); this.state.rangeFrom = r.from; this.state.rangeTo = r.to; this.saveState();
    });
    e.rangeToInput.addEventListener('change', () => {
      if (!this.state) return;
      if (this.state.allCards) this.setAllCardsMode(false, false);
      const r = this.normalizeRangeInputs(); this.state.rangeFrom = r.from; this.state.rangeTo = r.to; this.saveState();
    });
    e.shuffleRangeInput.addEventListener('change', () => { if (this.state) { this.state.shuffleRange = e.shuffleRangeInput.checked; this.saveState(); } });
    e.allCardsBtn.addEventListener('click', () => { if (this.state) this.setAllCardsMode(!this.state.allCards); });
    e.checkBtn.addEventListener('click', () => this.submitAnswer());
    e.dontKnowBtn.addEventListener('click', () => this.dontKnow());
    e.nextBtn.addEventListener('click', () => this.nextCard());
    e.acceptBtn.addEventListener('click', () => this.acceptCurrentAnswer());
    e.newRoundBtn.addEventListener('click', () => this.startNewSession());
    e.resetBtn.addEventListener('click', () => { if (this.state) this.resetRound(); });
    e.answerInput.addEventListener('keydown', ev => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        if (this.awaitingNext) this.nextCard(); else this.submitAnswer();
      }
    });
    document.addEventListener('keydown', ev => {
      if (!this.state || this.state.practiceMode !== 'oral') return;
      if (ev.code === 'Space' && !e.oralCheckBtn.classList.contains('hidden')) {
        ev.preventDefault(); this.revealOralAnswer();
      }
    });
  }
}
