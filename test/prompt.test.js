import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPrompt } from '../prompt.js';

test('в промпт попадают продукты и приём пищи', () => {
  const prompt = buildPrompt({ products: 'курица, рис', meal: 'lunch' });

  assert.match(prompt, /курица, рис/);
  assert.match(prompt, /обед/);
  assert.doesNotMatch(prompt, /ужин/);
});

test('ужин подставляется для meal=dinner', () => {
  const prompt = buildPrompt({ products: 'яйца', meal: 'dinner' });

  assert.match(prompt, /ужин/);
  assert.doesNotMatch(prompt, /обед/);
});

test('неизвестный приём пищи считается ужином', () => {
  const prompt = buildPrompt({ products: 'яйца', meal: 'brunch' });

  assert.match(prompt, /ужин/);
});

test('без исключений блок исключений не добавляется', () => {
  const prompt = buildPrompt({ products: 'яйца', meal: 'dinner' });

  assert.doesNotMatch(prompt, /Не предлагай/);
});

test('пустой список исключений блок не добавляет', () => {
  const prompt = buildPrompt({ products: 'яйца', meal: 'dinner', exclude: [] });

  assert.doesNotMatch(prompt, /Не предлагай/);
});

test('исключения перечисляются в промпте', () => {
  const prompt = buildPrompt({
    products: 'яйца',
    meal: 'dinner',
    exclude: ['Омлет', 'Шакшука'],
  });

  assert.match(prompt, /Не предлагай эти блюда, они уже были: Омлет, Шакшука\./);
});

test('многострочные продукты с кавычками попадают в промпт как есть', () => {
  const products = 'сыр "Российский"\nполбанки сметаны\nвчерашний рис';

  const prompt = buildPrompt({ products, meal: 'dinner' });

  assert.ok(prompt.includes(products));
});

test('пробелы по краям продуктов обрезаются', () => {
  const prompt = buildPrompt({ products: '  яйца \n', meal: 'dinner' });

  assert.ok(prompt.includes('\nяйца\n'));
});
