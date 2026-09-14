export function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

// Keep existing lesson 5 progress when accepting additional equivalent translations.
const CARD_KEY_ALIASES = {
  "29036182": "f4c69e54",
  "8ca0b2f4": "6e26def5",
  "481596ec": "5b790643",
  "b32f67b7": "76a09ec4",
  "27bc052": "bdfde932",
  "dc2932e5": "4e4ce024",
  "55e363a4": "7ac16e8a",
  "581ae468": "b7cc096d",
  "a5d1f3": "9ab9a97a",
  "b8bfbdf9": "6ebaf0a4",
  "900b119c": "b19e942",
  "17b1b915": "2156f957",
  "fcfa19cf": "17ca5bb5",
  "94f66820": "571af810",
  "ea428a56": "fac15900",
  "31ba60bb": "7ae2df8b",
  "6345ca35": "31d728aa",
  "998adeed": "b3d14723",
  "836b6fa8": "7b268cca",
  "735d27be": "ef9dd8f4",
  "5dbdd6e8": "c9f688a7",
  "6ffb6bdf": "6867113b",
  "7ab35962": "fae396f5",
  "aade3fae": "5e43ffea",
  "de5e3be3": "88a5418a",
  "93f43fb9": "3ca74cb7",
  "ab3e65e3": "28c87ef0",
  "dc422b06": "33e35f27",
  "add1a401": "317e289a",
  "1038378a": "12b4947f",
  "1cb721ec": "7f3f211d",
  "cdf196be": "1e78c7b2",
  "7974b808": "ee0fa0c3",
  "a6986cdc": "8654f099",
  "a77da88b": "afd641b1",
  "3cbdadf2": "d916fe74",
  "93c02bfd": "16c0f7eb",
  "4b8a3bad": "9ea9f3c6",
  "3c4a2d5d": "ad2b7ace",
  "4d28b2e0": "b5bba38b",
  "db99b8c0": "8c47d5b1",
  "144a7086": "fe10d34d",
  "784259cf": "95696b1d"
};

export function cardKey(card) {
  const key = hashString(card.ru + '||' + card.answers.join('||'));
  return CARD_KEY_ALIASES[key] || key;
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
