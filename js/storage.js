export function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

export function cardKey(card) {
  return hashString(card.ru + '||' + card.answers.join('||'));
}

export function deckKey(cards) {
  return hashString(cards.map(c => c.ru + '\t' + c.answers.join('||')).join('\n'));
}

const PROGRESS_KEY = 'english-drill:v11:progress';

function mergeStat(target = {}, source = {}) {
  return {
    correct: Math.max(target.correct || 0, source.correct || 0),
    almost: Math.max(target.almost || 0, source.almost || 0),
    unknown: Math.max(target.unknown || 0, source.unknown || 0),
    consecutiveCorrect: Math.max(target.consecutiveCorrect || 0, source.consecutiveCorrect || 0),
    consecutiveWrong: Math.max(target.consecutiveWrong || 0, source.consecutiveWrong || 0),
    lastResult: source.lastResult || target.lastResult || ''
  };
}

export class ProgressStore {
  constructor() {
    this.data = this.load();
  }

  blank() {
    return {
      version: 11,
      cardStats: {},
      attempts: {},
      errors: {},
      accepted: {},
      bestStreak: 0,
      migratedLegacyKeys: {}
    };
  }

  load() {
    try {
      const parsed = JSON.parse(localStorage.getItem(PROGRESS_KEY) || 'null');
      if (!parsed || typeof parsed !== 'object') return this.blank();
      return {
        ...this.blank(),
        ...parsed,
        cardStats: parsed.cardStats || {},
        attempts: parsed.attempts || {},
        errors: parsed.errors || {},
        accepted: parsed.accepted || {},
        migratedLegacyKeys: parsed.migratedLegacyKeys || {}
      };
    } catch {
      return this.blank();
    }
  }

  save() {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(this.data));
  }

  migrateLegacyDeck(cards) {
    if (!cards.length) return false;
    const legacyKey = 'english-drill:' + deckKey(cards);
    if (this.data.migratedLegacyKeys[legacyKey]) return false;

    let legacy;
    try {
      legacy = JSON.parse(localStorage.getItem(legacyKey) || 'null');
    } catch {
      legacy = null;
    }

    if (legacy && typeof legacy === 'object') {
      for (const [key, stat] of Object.entries(legacy.cardStats || {})) {
        this.data.cardStats[key] = mergeStat(this.data.cardStats[key], stat);
      }
      for (const [key, count] of Object.entries(legacy.attempts || {})) {
        this.data.attempts[key] = Math.max(this.data.attempts[key] || 0, Number(count) || 0);
      }
      for (const [key, count] of Object.entries(legacy.errors || {})) {
        this.data.errors[key] = Math.max(this.data.errors[key] || 0, Number(count) || 0);
      }
      for (const [key, values] of Object.entries(legacy.accepted || {})) {
        const current = this.data.accepted[key] || [];
        const merged = [...current];
        for (const value of Array.isArray(values) ? values : []) {
          if (!merged.some(x => x.trim().toLowerCase() === String(value).trim().toLowerCase())) merged.push(value);
        }
        this.data.accepted[key] = merged;
      }
    }

    this.data.migratedLegacyKeys[legacyKey] = true;
    this.save();
    return Boolean(legacy);
  }

  acceptedAnswers(card) {
    return this.data.accepted[cardKey(card)] || [];
  }

  addAcceptedAnswer(card, value, normalizer = s => String(s).trim().toLowerCase()) {
    const key = cardKey(card);
    this.data.accepted[key] ||= [];
    if (!this.data.accepted[key].some(x => normalizer(x) === normalizer(value))) {
      this.data.accepted[key].push(value);
      this.save();
    }
  }

  ensureCardStats(card) {
    const key = cardKey(card);
    if (!this.data.cardStats[key]) {
      this.data.cardStats[key] = {
        correct: 0,
        almost: 0,
        unknown: 0,
        consecutiveCorrect: 0,
        consecutiveWrong: 0,
        lastResult: ''
      };
    }
    return this.data.cardStats[key];
  }

  recordOutcome(card, result) {
    const stats = this.ensureCardStats(card);
    if (result === 'known') {
      stats.correct += 1;
      stats.consecutiveCorrect += 1;
      stats.consecutiveWrong = 0;
    } else if (result === 'unknown') {
      stats.unknown += 1;
      stats.consecutiveWrong += 1;
      stats.consecutiveCorrect = 0;
    } else {
      stats.almost += 1;
      stats.consecutiveWrong += 1;
      stats.consecutiveCorrect = 0;
    }
    stats.lastResult = result;
  }

  markAttempt(card, error) {
    const key = cardKey(card);
    this.data.attempts[key] = (this.data.attempts[key] || 0) + 1;
    if (error) this.data.errors[key] = (this.data.errors[key] || 0) + 1;
  }

  setBestStreak(value) {
    this.data.bestStreak = Math.max(this.data.bestStreak || 0, value || 0);
  }

  totalErrors() {
    return Object.values(this.data.errors).reduce((sum, value) => sum + (Number(value) || 0), 0);
  }

  cardStatus(card) {
    const key = cardKey(card);
    const rich = this.data.cardStats[key] || {};
    const attempts = Math.max(
      this.data.attempts[key] || 0,
      (rich.correct || 0) + (rich.almost || 0) + (rich.unknown || 0)
    );
    const errors = Math.max(
      this.data.errors[key] || 0,
      (rich.almost || 0) + (rich.unknown || 0)
    );
    const unknown = rich.unknown || 0;
    const consecutiveCorrect = rich.consecutiveCorrect || 0;
    const consecutiveWrong = rich.consecutiveWrong || 0;

    if (attempts === 0) return { id:'new', label:'⚪ Новая', className:'status-new' };

    const errorRate = errors / Math.max(attempts, 1);
    if (unknown >= 1 || consecutiveWrong >= 2 || errors >= 3 || (attempts >= 3 && errorRate >= 0.5)) {
      return { id:'weak', label:'🔴 Слабая', className:'status-weak' };
    }
    if (attempts >= 4 && consecutiveCorrect >= 3 && errorRate <= 0.20) {
      return { id:'strong', label:'🟢 Хорошо знаю', className:'status-strong' };
    }
    return { id:'learning', label:'🟡 Изучается', className:'status-learning' };
  }

  topErrors(limit = 5) {
    return Object.entries(this.data.errors)
      .map(([key, count]) => [key, Number(count) || 0])
      .sort((a,b) => b[1] - a[1])
      .slice(0, limit);
  }
}
