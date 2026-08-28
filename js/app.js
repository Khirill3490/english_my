import { ProgressStore } from './storage.js';
import { LessonRepository } from './lessons.js';
import { Trainer } from './trainer.js';

const byId = id => document.getElementById(id);
const els = {
  lessonPicker: byId('lessonPicker'),
  lessonPickerBtn: byId('lessonPickerBtn'),
  lessonPickerValue: byId('lessonPickerValue'),
  lessonPickerMenu: byId('lessonPickerMenu'),
  lessonOptions: byId('lessonOptions'),
  lessonCardCount: byId('lessonCardCount'),
  selectedLessonsCount: byId('selectedLessonsCount'),
  lessonPickerSummary: byId('lessonPickerSummary'),
  selectAllLessonsBtn: byId('selectAllLessonsBtn'),
  clearLessonsBtn: byId('clearLessonsBtn'),
  applyLessonsBtn: byId('applyLessonsBtn'),
  rangeControl: byId('rangeControl'),
  allCardsBtn: byId('allCardsBtn'),
  rangeFromInput: byId('rangeFromInput'),
  rangeToInput: byId('rangeToInput'),
  shuffleRangeInput: byId('shuffleRangeInput'),
  startSessionBtn: byId('startSessionBtn'),
  resetBtn: byId('resetBtn'),
  doneStat: byId('doneStat'),
  leftStat: byId('leftStat'),
  errorsStat: byId('errorsStat'),
  streakStat: byId('streakStat'),
  progressBar: byId('progressBar'),
  trainer: byId('trainer'),
  positionText: byId('positionText'),
  lessonSource: byId('lessonSource'),
  cardStatusBadge: byId('cardStatusBadge'),
  prompt: byId('prompt'),
  writtenModeBtn: byId('writtenModeBtn'),
  oralModeBtn: byId('oralModeBtn'),
  writtenModePanel: byId('writtenModePanel'),
  oralModePanel: byId('oralModePanel'),
  answerInput: byId('answerInput'),
  checkBtn: byId('checkBtn'),
  dontKnowBtn: byId('dontKnowBtn'),
  acceptBtn: byId('acceptBtn'),
  nextBtn: byId('nextBtn'),
  oralCheckBtn: byId('oralCheckBtn'),
  oralAnswerBox: byId('oralAnswerBox'),
  oralCorrectAnswer: byId('oralCorrectAnswer'),
  oralDecisionButtons: byId('oralDecisionButtons'),
  oralDontKnowBtn: byId('oralDontKnowBtn'),
  oralAlmostBtn: byId('oralAlmostBtn'),
  oralKnowBtn: byId('oralKnowBtn'),
  feedback: byId('feedback'),
  fbTitle: byId('fbTitle'),
  yourRow: byId('yourRow'),
  yourAnswer: byId('yourAnswer'),
  correctAnswer: byId('correctAnswer'),
  repeatInfo: byId('repeatInfo'),
  complete: byId('complete'),
  reportSubtitle: byId('reportSubtitle'),
  reportTotal: byId('reportTotal'),
  reportKnown: byId('reportKnown'),
  reportAlmost: byId('reportAlmost'),
  reportUnknown: byId('reportUnknown'),
  reportAccuracy: byId('reportAccuracy'),
  reportAttempts: byId('reportAttempts'),
  lessonReportBox: byId('lessonReportBox'),
  lessonReportRows: byId('lessonReportRows'),
  sessionProblemBox: byId('sessionProblemBox'),
  sessionProblems: byId('sessionProblems'),
  newRoundBtn: byId('newRoundBtn'),
  problems: byId('problems')
};

const SELECTED_KEY = 'english-drill:v11:selected-lessons';
const progress = new ProgressStore();
const lessons = new LessonRepository('./lessons');
const trainer = new Trainer(els, progress);

let selectedIds = [];
let draftIds = new Set();
let applyingLessons = false;

function savedSelection(catalog) {
  try {
    const values = JSON.parse(localStorage.getItem(SELECTED_KEY) || 'null');
    if (Array.isArray(values)) {
      const valid = values.map(String).filter(id => catalog.some(item => String(item.id) === id));
      if (valid.length) return valid;
    }
  } catch {}

  // Миграция со старого одиночного выбора.
  const old = localStorage.getItem('english-drill:selected-lesson');
  if (old && catalog.some(item => String(item.id) === String(old))) return [String(old)];
  return [String(catalog[0].id)];
}

function selectionLabel(ids) {
  const chosen = lessons.orderedSelection(ids);
  if (!chosen.length) return 'Уроки не выбраны';
  if (chosen.length === 1) return chosen[0].title || `Урок ${chosen[0].id}`;
  if (chosen.length <= 4) return 'Уроки ' + chosen.map(x => x.id).join(', ');
  return `Выбрано ${chosen.length} уроков`;
}

function renderLessonOptions() {
  els.lessonOptions.textContent = '';
  for (const lesson of lessons.catalog) {
    const id = String(lesson.id);
    const label = document.createElement('label');
    label.className = 'lesson-option' + (draftIds.has(id) ? ' checked' : '');

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = draftIds.has(id);
    input.value = id;
    input.addEventListener('change', () => {
      if (input.checked) draftIds.add(id); else draftIds.delete(id);
      renderLessonOptions();
      updateDraftSummary();
    });

    const text = document.createElement('span');
    const title = document.createElement('div');
    title.className = 'lesson-option-title';
    title.textContent = lesson.title || `Урок ${lesson.id}`;
    const sub = document.createElement('div');
    sub.className = 'lesson-option-id';
    sub.textContent = `ID: ${lesson.id} · ${lesson.file}`;
    text.append(title, sub);
    label.append(input, text);
    els.lessonOptions.appendChild(label);
  }
}

function updateDraftSummary() {
  els.selectedLessonsCount.textContent = draftIds.size;
  els.lessonPickerSummary.textContent = draftIds.size
    ? `Будет объединено уроков: ${draftIds.size}. Карточки загрузятся после «Применить».`
    : 'Выберите хотя бы один урок.';
  els.applyLessonsBtn.disabled = draftIds.size === 0 || applyingLessons;
}

function openPicker() {
  draftIds = new Set(selectedIds);
  renderLessonOptions();
  updateDraftSummary();
  els.lessonPickerMenu.classList.remove('hidden');
  els.lessonPicker.classList.add('open');
  els.lessonPickerBtn.setAttribute('aria-expanded', 'true');
}

function closePicker() {
  els.lessonPickerMenu.classList.add('hidden');
  els.lessonPicker.classList.remove('open');
  els.lessonPickerBtn.setAttribute('aria-expanded', 'false');
}

async function applySelection(ids, {confirmReset = true} = {}) {
  const normalized = lessons.orderedSelection(ids).map(item => String(item.id));
  if (!normalized.length) return false;

  const changed = normalized.join('|') !== selectedIds.join('|');
  if (changed && confirmReset && trainer.hasActiveSession()) {
    const ok = confirm('Сменить набор уроков? Текущая сессия сменится на сессию выбранной комбинации. Общая история карточек и ошибок сохранится.');
    if (!ok) return false;
  }

  applyingLessons = true;
  els.lessonPicker.classList.add('loading-dim');
  els.lessonPickerValue.textContent = 'Загрузка…';
  els.applyLessonsBtn.disabled = true;

  try {
    const loaded = await lessons.loadMany(normalized, progress);
    selectedIds = loaded.lessons.map(item => String(item.id));
    localStorage.setItem(SELECTED_KEY, JSON.stringify(selectedIds));
    els.lessonPickerValue.textContent = selectionLabel(selectedIds);
    els.lessonCardCount.textContent = loaded.cards.length;
    trainer.setDeck(loaded.cards, loaded.lessons);
    return true;
  } catch (error) {
    alert(`Не удалось загрузить выбранные уроки: ${error.message}`);
    els.lessonPickerValue.textContent = selectedIds.length ? selectionLabel(selectedIds) : 'Ошибка загрузки';
    return false;
  } finally {
    applyingLessons = false;
    els.lessonPicker.classList.remove('loading-dim');
    updateDraftSummary();
  }
}

function disableAppForCatalogError(error) {
  els.lessonPickerValue.textContent = 'Уроки не загружены';
  els.lessonCardCount.textContent = '0';
  els.prompt.textContent = 'Не удалось загрузить уроки из папки lessons.';
  els.positionText.textContent = 'проверь lessons/lessons.json';
  els.startSessionBtn.disabled = true;
  els.allCardsBtn.disabled = true;
  els.rangeFromInput.disabled = true;
  els.rangeToInput.disabled = true;
  els.lessonPickerBtn.disabled = true;
  console.error('Каталог lessons/lessons.json не загружен:', error);
}

els.lessonPickerBtn.addEventListener('click', ev => {
  ev.stopPropagation();
  if (els.lessonPickerMenu.classList.contains('hidden')) openPicker(); else closePicker();
});

els.lessonPickerMenu.addEventListener('click', ev => ev.stopPropagation());
els.selectAllLessonsBtn.addEventListener('click', () => {
  draftIds = new Set(lessons.catalog.map(item => String(item.id)));
  renderLessonOptions(); updateDraftSummary();
});
els.clearLessonsBtn.addEventListener('click', () => {
  draftIds.clear(); renderLessonOptions(); updateDraftSummary();
});
els.applyLessonsBtn.addEventListener('click', async () => {
  const ok = await applySelection([...draftIds]);
  if (ok) closePicker();
});

document.addEventListener('click', () => closePicker());
document.addEventListener('keydown', ev => { if (ev.key === 'Escape') closePicker(); });

async function init() {
  try {
    const catalog = await lessons.loadCatalog();
    selectedIds = savedSelection(catalog);
    draftIds = new Set(selectedIds);
    renderLessonOptions();
    updateDraftSummary();
    const ok = await applySelection(selectedIds, {confirmReset:false});
    if (!ok) throw new Error('Не удалось загрузить выбранные уроки');
  } catch (error) {
    disableAppForCatalogError(error);
  }
}

init();
