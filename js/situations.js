// Situation answers keep sentence alternatives independent: no Cartesian product.
export function normalizeSituationAnswer(value) {
  return String(value).toLowerCase().replace(/[’‘`]/g, "'")
    .replace(/\b(i)'m\b/g, 'i am')
    .replace(/\b(you|we|they)'re\b/g, '$1 are')
    .replace(/\b(i|you|we|they)'ve\b/g, '$1 have')
    .replace(/\b(i|you|he|she|it|we|they)'ll\b/g, '$1 will')
    .replace(/\bcan't\b/g, 'cannot').replace(/\bcan not\b/g, 'cannot')
    .replace(/\bwon't\b/g, 'will not')
    .replace(/\bshan't\b/g, 'shall not')
    .replace(/\b(don|doesn|didn|isn|aren|wasn|weren|haven|hasn|hadn|shouldn|wouldn|couldn|mustn|needn)'t\b/g,
      (_, stem) => stem.slice(0, -1) + ' not')
    .replace(/[.,!?;:"()[\]{}]/g, '').replace(/\s+/g, ' ').trim();
}

export function splitSituationAnswer(value) {
  const text = String(value).trim();
  if (!text) return [];
  // One sentence per line is unambiguous, including answers with abbreviations.
  if (/\n/.test(text)) return text.split(/\n+/).map(s => s.trim()).filter(Boolean);
  const protectedText = text
    .replace(/\b(?:a\.m\.|p\.m\.|Mr\.|Mrs\.|Ms\.|Dr\.)/gi, s => s.replaceAll('.', '∯'))
    .replace(/(\d)\.(?=\d)/g, '$1∯');
  return protectedText.split(/(?<=[.!?])\s+(?=[A-Za-z"'“])/)
    .map(s => s.replaceAll('∯', '.').trim()).filter(Boolean);
}

export function checkSituationAnswer(value, parts) {
  const lines = splitSituationAnswer(value);
  const results = parts.map((part, index) => ({
    input: lines[index] || '',
    correct: part.answers.some(a => normalizeSituationAnswer(a) === normalizeSituationAnswer(lines[index] || '')),
    answers: part.answers
  }));
  return {
    results, extra: lines.slice(parts.length),
    correct: lines.length === parts.length && results.every(r => r.correct)
  };
}

export function parseSituations(text, lesson) {
  const data = JSON.parse(text);
  if (data.version !== 1 || !Array.isArray(data.situations)) throw new Error('Некорректный файл ситуаций');
  return data.situations.map((s, index) => {
    if (!s.id || !s.title || !Array.isArray(s.parts) || s.parts.length < 2 || s.parts.length > 4 ||
        s.parts.some(p => !p.ru || !Array.isArray(p.answers) || !p.answers.length ||
          p.answers.some(a => typeof a !== 'string' || !a.trim()))) throw new Error('Некорректная ситуация №' + (index + 1));
    return {
      ru: s.parts.map(p => p.ru).join(' '),
      answers: [s.parts.map(p => p.answers[0]).join('\n')],
      parts: s.parts, situationId: s.id, situationTitle: s.title,
      lessonId: String(lesson.id), lessonTitle: lesson.title, lessonCardNumber: index + 1
    };
  });
}
