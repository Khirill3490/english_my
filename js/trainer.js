import { cardKey, deckKey } from './storage.js';

function shuffledCopy(indices) {
  const copy = [...indices];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
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
      practiceMode: 'oral',
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
      // Keep progress when resuming an older written session.
      state.practiceMode = 'oral';
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
    this.state = this.loadState();

    this.els.rangeFromInput.max = this.deck.length;
    this.els.rangeToInput.max = this.deck.length;
    this.els.rangeFromInput.value = this.state.rangeFrom || 1;
    this.els.rangeToInput.value = this.state.allCards ? this.deck.length : Math.min(this.state.rangeTo || 20, this.deck.length);
    this.els.shuffleRangeInput.checked = Boolean(this.state.shuffleRange);
    this.syncAllCardsUI();
    this.saveState();
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

  updateCurrentCardStatus() {
    if (this.current === null || !this.deck[this.current]) return;
    const status = this.progress.cardStatus(this.deck[this.current]);
    this.els.cardStatusBadge.textContent = status.label;
    this.els.cardStatusBadge.className = 'status-badge ' + status.className;
  }

  resetQuestionUI() {
    this.els.complete.classList.add('hidden');
    this.els.oralCheckBtn.classList.remove('hidden');
    this.els.oralAnswerBox.classList.add('hidden');
    this.els.oralDecisionButtons.classList.add('hidden');
    this.els.oralCorrectAnswer.textContent = '';
  }

  pickNext() {
    if (!this.state || !this.deck.length) return;
    if (this.state.queue.length === 0) {
      this.showComplete();
      return;
    }
    this.current = this.state.queue.shift();
    const card = this.deck[this.current];
    this.els.prompt.classList.toggle('situation-prompt', Boolean(card.parts));
    this.els.prompt.textContent = card.parts
      ? card.parts.map((p, i) => `${i + 1}. ${p.ru}${p.context ? ' [' + p.context + ']' : ''}`).join('\n\n')
      : card.ru;
    this.els.lessonSource.textContent = `${card.lessonTitle} · №${card.lessonCardNumber}${card.situationTitle ? " · " + card.situationTitle : ""}`;
    const scopeLabel = this.state.allCards
      ? `все ${this.deck.length}`
      : `${this.state.rangeFrom}–${this.state.rangeTo}`;
    this.els.positionText.textContent = `${scopeLabel} · осталось ${this.state.queue.length + 1}`;
    this.updateCurrentCardStatus();
    this.resetQuestionUI();
    this.updateStats();
  }

  removePendingOccurrences(index) {
    this.state.queue = this.state.queue.filter(i => i !== index);
  }

  scheduleRepeats(index, gaps) {
    this.removePendingOccurrences(index);
    const actualGaps = [];
    let previousPos = -1;
    for (const gap of gaps) {
      const position = Math.min(previousPos + 1 + gap, this.state.queue.length);
      actualGaps.push(position - previousPos - 1);
      this.state.queue.splice(position, 0, index);
      previousPos = position;
    }
    this.state.pendingRepeats[index] = gaps.length;
    delete this.state.mastered[index];
    return actualGaps;
  }

  scheduleReinforcement(index) {
    return this.scheduleRepeats(index, [3, 7, 15]);
  }

  scheduleIntensiveReinforcement(index) {
    return this.scheduleRepeats(index, [2, 4, 8, 15, 25]);
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

  revealOralAnswer() {
    if (this.state?.practiceMode !== 'oral' || this.current === null) return;
    const card = this.deck[this.current];
    this.els.oralCorrectAnswer.textContent = card.parts
      ? card.parts.map((p, i) => `${i + 1}. ${p.answers[0]}`).join('\n\n')
      : card.answers.join('  /  ');
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
    this.els.reportSubtitle.textContent = 'Итоги устной сессии. Считается первая попытка по каждой карточке.';

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
    this.els.oralCheckBtn.classList.add('hidden');
    this.els.oralAnswerBox.classList.add('hidden');
    this.els.oralDecisionButtons.classList.add('hidden');
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
    e.newRoundBtn.addEventListener('click', () => this.startNewSession());
    e.resetBtn.addEventListener('click', () => { if (this.state) this.resetRound(); });
    document.addEventListener('keydown', ev => {
      if (!this.state || this.current === null || ev.repeat) return;
      if (ev.target?.closest('input, textarea, select, button, a, summary, [contenteditable]')) return;
      if (ev.code === 'Space' && !e.oralCheckBtn.classList.contains('hidden')) {
        ev.preventDefault(); this.revealOralAnswer();
      }
    });
  }
}
