import { deckKey } from './storage.js';

export function parseDeck(text, lesson) {
  const cards = [];
  let number = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    let parts = raw.split('\t');
    if (parts.length < 2) parts = raw.split(';');
    if (parts.length < 2) continue;

    const ru = parts[0].trim();
    const answerText = parts.slice(1).join('\t').trim();
    const answers = answerText.split('||').map(x => x.trim()).filter(Boolean);
    if (!ru || !answers.length) continue;

    number += 1;
    cards.push({
      ru,
      answers,
      lessonId: String(lesson.id),
      lessonTitle: lesson.title || `Урок ${lesson.id}`,
      lessonCardNumber: number
    });
  }
  return cards;
}

export class LessonRepository {
  constructor(basePath = './lessons') {
    this.basePath = basePath.replace(/\/$/, '');
    this.catalog = [];
  }

  async loadCatalog() {
    const response = await fetch(`${this.basePath}/lessons.json`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const raw = await response.json();
    this.catalog = Array.isArray(raw)
      ? raw.filter(item => item && item.id !== undefined && item.id !== null && item.file)
      : [];

    if (!this.catalog.length) throw new Error('В lessons/lessons.json нет уроков');
    return this.catalog;
  }

  byId(id) {
    return this.catalog.find(item => String(item.id) === String(id));
  }

  orderedSelection(ids) {
    const wanted = new Set(ids.map(String));
    return this.catalog.filter(item => wanted.has(String(item.id)));
  }

  async loadOne(lesson, progressStore) {
    const fileName = String(lesson.file || '').trim();
    if (!fileName) throw new Error(`У урока ${lesson.id} не указан файл`);

    const response = await fetch(`${this.basePath}/${encodeURIComponent(fileName)}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`${lesson.title || lesson.id}: HTTP ${response.status}`);

    const text = await response.text();
    const cards = parseDeck(text, lesson);
    if (!cards.length) throw new Error(`${lesson.title || lesson.id}: в файле нет карточек`);

    // Переносим историю старой одностраничной версии, если она есть в этом браузере.
    progressStore?.migrateLegacyDeck(cards);
    return cards;
  }

  async loadMany(ids, progressStore) {
    const lessons = this.orderedSelection(ids);
    if (!lessons.length) throw new Error('Не выбран ни один урок');

    const decks = await Promise.all(lessons.map(lesson => this.loadOne(lesson, progressStore)));
    const cards = decks.flat();
    return {
      lessons,
      cards,
      signature: deckKey(cards)
    };
  }
}
