import fs from 'node:fs';
import assert from 'node:assert/strict';
import {parseSituations,checkSituationAnswer,splitSituationAnswer} from './js/situations.js';
import {parseDeck,LessonRepository} from './js/lessons.js';
const source=parseDeck(fs.readFileSync('lessons/1-10.txt','utf8'),{id:'1-10'});
const data=fs.readFileSync('lessons/1-10-situations.json','utf8');
const cards=parseSituations(data,{id:'1-10-situations',title:'Situations'});
assert.equal(cards.length,335);
const parts=cards.flatMap(c=>c.parts);
assert.equal(parts.length,1004);
assert.equal(new Set(parts.map(p=>p.sourceCard)).size,1004);
for(const [i,p] of parts.entries()) { assert.equal(p.sourceCard,i+1); assert.equal(p.ru,source[i].ru); }
for(const card of cards){
 assert(card.parts.length>=2 && card.parts.length<=3);
 assert(checkSituationAnswer(card.parts.map(p=>p.answers[0]).join('\n'),card.parts).correct);
 // All stored alternatives must work independently, without enumerating combinations.
 for(let i=0;i<card.parts.length;i++)for(const a of card.parts[i].answers){
  const input=card.parts.map((p,j)=>i===j?a:p.answers[0]).join('\n');
  assert(checkSituationAnswer(input,card.parts).correct,card.situationId+' '+input);
 }
 const bad=card.parts.map(p=>p.answers[0]);bad[1]='Incorrect sentence';
 const result=checkSituationAnswer(bad.join('\n'),card.parts);
 assert(!result.correct);assert(result.results[0].correct);assert(!result.results[1].correct);
 assert(!checkSituationAnswer(card.answers[0]+'\nExtra sentence.',card.parts).correct);
 assert(!checkSituationAnswer(card.parts[0].answers[0],card.parts).correct);
}
assert.deepEqual(splitSituationAnswer('We met at 7 p.m. I was tired.'),['We met at 7 p.m. I was tired.']); // use a newline for ambiguous abbreviations
assert.equal(splitSituationAnswer('I was tired. Were you there? I slept.').length,3);
const p=parts.find(p=>p.sourceCard===903);
assert(checkSituationAnswer("He has lost all his money so he can't buy this thing.",[p]).correct);
assert(!checkSituationAnswer("He is lost all his money so he can't buy this thing.",[p]).correct);
globalThis.fetch=async url=>({ok:true,text:async()=>fs.readFileSync(String(url),'utf8'),json:async()=>JSON.parse(fs.readFileSync(String(url),'utf8'))});
const repo=new LessonRepository('lessons');await repo.loadCatalog();
assert.equal((await repo.loadMany(['1-10-situations'])).cards.length,335);
assert.equal((await repo.loadMany(['1-10','1-10-situations'])).cards.length,1339);
console.log('PASS: 1004/1004 exact source prompts; 335 blocks; all alternatives; partial, missing and extra answers; contractions; mixed lessons');
