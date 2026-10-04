# what-to-cook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Статическая веб-страница: пользователь вводит продукты, которые есть дома, и получает три блюда с коротким рецептом от Gemini.

**Architecture:** Один `index.html` и четыре ES-модуля без сборщика. `prompt.js` собирает промпт, `llm.js` ходит в Gemini из браузера и разбирает структурированный JSON, `storage.js` хранит ключ и продукты в `localStorage`, `app.js` связывает их с DOM. Сервера нет.

**Tech Stack:** HTML, CSS, JavaScript (нативные ES-модули), Gemini REST API (`generateContent`), `node --test` (Node 25), GitHub Pages.

**Spec:** `docs/superpowers/specs/2026-10-04-what-to-cook-design.md`

## Global Constraints

- Бесплатно: и LLM, и хостинг.
- Без сервера: запрос к LLM идёт из браузера.
- Без сборщика и без npm-зависимостей. `package.json` содержит только `"type": "module"` и скрипт тестов — раздел `dependencies` не появляется.
- Интерфейс и ответы модели — на русском.
- API-ключ хранится только в `localStorage`, в репозиторий и в код не попадает.
- Текст от модели вставляется в DOM только через `textContent`, никогда через `innerHTML`.
- Тексты сообщений об ошибках — дословно из таблицы «Ошибки» спеки.
- Коммиты: короткое сообщение, без строк `Co-Authored-By` и «Generated with».

## Review Focus

1. Gemini вернул ответ без `candidates` (сработал safety-фильтр) — страница показывает «Не понял ответ модели. Нажми ещё раз.», а не падает. Тест — Task 2.
2. HTTP-статус вне таблицы спеки (например, 404 после переименования модели) — человеческое сообщение «Gemini сейчас недоступен. Попробуй позже.», а не необработанное исключение. Тест — Task 2.
3. `localStorage` недоступен или бросает исключение (приватный режим) — страница работает, просто ничего не запоминает. Тест — Task 3.
4. Модель нарушила схему: больше трёх блюд, `minutes` строкой, в `steps` не строки — показываем максимум три карточки, время скрыто, мусорные шаги отброшены. Тест — Task 2.
5. Продукты введены в несколько строк, с кавычками — текст попадает в промпт без искажений, запрос остаётся валидным JSON. Тесты — Task 1 и Task 2.

## File Structure

```
what-to-cook/
  package.json          "type": "module", скрипт test
  index.html            разметка
  style.css             оформление
  prompt.js             buildPrompt
  llm.js                MODEL, LlmError, parseDishes, toUserError, suggestDishes
  storage.js            createStorage
  app.js                DOM: события, состояние, рендер
  test/prompt.test.js
  test/llm.test.js
  test/storage.test.js
```

---

### Task 1: prompt.js — сборка промпта

**Files:**
- Create: `package.json`
- Create: `prompt.js`
- Test: `test/prompt.test.js`

**Interfaces:**
- Consumes: ничего.
- Produces: `buildPrompt({ products: string, meal: 'lunch' | 'dinner', exclude?: string[] }): string`.

- [ ] **Step 1: Создать package.json**

```json
{
  "name": "what-to-cook",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test"
  }
}
```

- [ ] **Step 2: Написать падающий тест**

`test/prompt.test.js`:

```js
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
```

- [ ] **Step 3: Запустить тест, убедиться что падает**

Run: `node --test test/prompt.test.js`
Expected: FAIL — `Cannot find module` для `../prompt.js`.

- [ ] **Step 4: Написать реализацию**

`prompt.js`:

```js
const MEALS = { lunch: 'обед', dinner: 'ужин' };

export function buildPrompt({ products, meal, exclude = [] }) {
  const mealName = MEALS[meal] ?? MEALS.dinner;
  const lines = [
    `Ты помощник по домашней кухне. Предложи ровно три блюда на ${mealName}.`,
    'Продукты, которые есть дома:',
    products.trim(),
    'Правила:',
    '- строй блюда в первую очередь на этих продуктах;',
    '- соль, перец, растительное масло и воду считай имеющимися и в списки не включай;',
    '- недостающих продуктов должно быть как можно меньше;',
    `- блюдо должно подходить именно на ${mealName};`,
    '- шагов приготовления от 4 до 6, каждый — одно короткое предложение;',
    '- отвечай на русском.',
  ];
  if (exclude.length > 0) {
    lines.push(`Не предлагай эти блюда, они уже были: ${exclude.join(', ')}.`);
  }
  return lines.join('\n');
}
```

- [ ] **Step 5: Запустить тест, убедиться что проходит**

Run: `node --test test/prompt.test.js`
Expected: PASS, 8 тестов.

- [ ] **Step 6: Commit**

```bash
git add package.json prompt.js test/prompt.test.js
git commit -m "Add prompt builder"
```

---

### Task 2: llm.js — запрос в Gemini, разбор ответа, ошибки

**Files:**
- Create: `llm.js`
- Test: `test/llm.test.js`

**Interfaces:**
- Consumes: ничего.
- Produces:
  - `MODEL: string` — основная модель (`gemini-flash-latest`).
  - `FALLBACK_MODEL: string` — запасная (`gemini-flash-lite-latest`); один повтор на ней при HTTP 503 или 404 от основной.
  - `class LlmError extends Error` с полем `kind: 'key' | 'limit' | 'unavailable' | 'network' | 'format'`.
  - `parseDishes(text: string): Dish[]` — бросает `LlmError('format')`.
  - `toUserError(err: unknown): { message: string, openSettings: boolean }`.
  - `suggestDishes({ apiKey: string, prompt: string, fetchFn?: typeof fetch }): Promise<Dish[]>` — бросает `LlmError`.
  - `Dish = { name: string, minutes: number | null, uses: string[], missing: string[], steps: string[] }`.

- [ ] **Step 1: Написать падающие тесты**

`test/llm.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MODEL, FALLBACK_MODEL, LlmError, parseDishes, toUserError, suggestDishes } from '../llm.js';

const dish = {
  name: 'Плов',
  minutes: 40,
  uses: ['рис', 'курица'],
  missing: ['морковь'],
  steps: ['Обжарь курицу.', 'Добавь рис.'],
};

const okResponse = (text) => ({
  ok: true,
  status: 200,
  json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }),
});

test('parseDishes: валидный ответ', () => {
  const dishes = parseDishes(JSON.stringify([dish]));

  assert.deepEqual(dishes, [dish]);
});

test('parseDishes: пустой массив — ошибка формы', () => {
  assert.throws(() => parseDishes('[]'), { kind: 'format' });
});

test('parseDishes: не JSON — ошибка формы', () => {
  assert.throws(() => parseDishes('вот три блюда'), { kind: 'format' });
});

test('parseDishes: не массив — ошибка формы', () => {
  assert.throws(() => parseDishes(JSON.stringify(dish)), { kind: 'format' });
});

test('parseDishes: элемент без name — ошибка формы', () => {
  const { name, ...noName } = dish;

  assert.throws(() => parseDishes(JSON.stringify([noName])), { kind: 'format' });
});

test('parseDishes: элемент без steps — ошибка формы', () => {
  const { steps, ...noSteps } = dish;

  assert.throws(() => parseDishes(JSON.stringify([noSteps])), { kind: 'format' });
});

test('parseDishes: без uses и missing — пустые списки', () => {
  const { uses, missing, ...bare } = dish;

  const dishes = parseDishes(JSON.stringify([bare]));

  assert.deepEqual(dishes[0].uses, []);
  assert.deepEqual(dishes[0].missing, []);
});

test('parseDishes: minutes не числом — null', () => {
  const dishes = parseDishes(JSON.stringify([{ ...dish, minutes: '40 минут' }]));

  assert.equal(dishes[0].minutes, null);
});

test('parseDishes: не-строки в steps отбрасываются', () => {
  const dishes = parseDishes(JSON.stringify([{ ...dish, steps: ['Свари рис.', 5, null, ''] }]));

  assert.deepEqual(dishes[0].steps, ['Свари рис.']);
});

test('parseDishes: steps из одного мусора — ошибка формы', () => {
  assert.throws(() => parseDishes(JSON.stringify([{ ...dish, steps: [5, null] }])), { kind: 'format' });
});

test('parseDishes: больше трёх блюд обрезается до трёх', () => {
  const dishes = parseDishes(JSON.stringify([dish, dish, dish, dish, dish]));

  assert.equal(dishes.length, 3);
});

test('toUserError: тексты и флаг настроек', () => {
  assert.deepEqual(toUserError(new LlmError('key')), {
    message: 'Ключ не подошёл. Проверь его в настройках.',
    openSettings: true,
  });
  assert.deepEqual(toUserError(new LlmError('limit')), {
    message: 'Лимит запросов исчерпан. Попробуй через минуту.',
    openSettings: false,
  });
  assert.deepEqual(toUserError(new LlmError('unavailable')), {
    message: 'Gemini сейчас недоступен. Попробуй позже.',
    openSettings: false,
  });
  assert.deepEqual(toUserError(new LlmError('network')), {
    message: 'Не достучался до Gemini. Проверь интернет; возможно, нужен VPN.',
    openSettings: false,
  });
  assert.deepEqual(toUserError(new LlmError('format')), {
    message: 'Не понял ответ модели. Нажми ещё раз.',
    openSettings: false,
  });
});

test('toUserError: посторонняя ошибка — общее сообщение', () => {
  assert.deepEqual(toUserError(new TypeError('boom')), {
    message: 'Что-то пошло не так. Нажми ещё раз.',
    openSettings: false,
  });
});

test('suggestDishes: отправляет ключ и промпт, возвращает блюда', async () => {
  const calls = [];
  const fetchFn = async (url, options) => {
    calls.push({ url, options });
    return okResponse(JSON.stringify([dish]));
  };

  const dishes = await suggestDishes({ apiKey: 'k-123', prompt: 'сыр "Российский"\nрис', fetchFn });

  assert.deepEqual(dishes, [dish]);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].url.includes(`/models/${MODEL}:generateContent`));
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers['x-goog-api-key'], 'k-123');
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.contents[0].parts[0].text, 'сыр "Российский"\nрис');
  assert.equal(body.generationConfig.responseMimeType, 'application/json');
});

test('suggestDishes: ключ не попадает в URL', async () => {
  let seenUrl = '';
  const fetchFn = async (url) => {
    seenUrl = url;
    return okResponse(JSON.stringify([dish]));
  };

  await suggestDishes({ apiKey: 'k-123', prompt: 'p', fetchFn });

  assert.ok(!seenUrl.includes('k-123'));
});

for (const [status, kind] of [
  [400, 'key'],
  [401, 'key'],
  [403, 'key'],
  [429, 'limit'],
  [500, 'unavailable'],
  [503, 'unavailable'],
  [404, 'unavailable'],
]) {
  test(`suggestDishes: HTTP ${status} → ${kind}`, async () => {
    const fetchFn = async () => ({ ok: false, status, json: async () => ({}) });

    await assert.rejects(suggestDishes({ apiKey: 'k', prompt: 'p', fetchFn }), { kind });
  });
}

for (const status of [503, 404]) {
  test(`suggestDishes: HTTP ${status} на основной модели → повтор на запасной`, async () => {
    const urls = [];
    const fetchFn = async (url) => {
      urls.push(url);
      if (urls.length === 1) return { ok: false, status, json: async () => ({}) };
      return okResponse(JSON.stringify([dish]));
    };

    const dishes = await suggestDishes({ apiKey: 'k', prompt: 'p', fetchFn });

    assert.deepEqual(dishes, [dish]);
    assert.equal(urls.length, 2);
    assert.ok(urls[0].includes(`/models/${MODEL}:generateContent`));
    assert.ok(urls[1].includes(`/models/${FALLBACK_MODEL}:generateContent`));
  });
}

test('suggestDishes: 503 на обеих моделях → unavailable, ровно два запроса', async () => {
  let calls = 0;
  const fetchFn = async () => {
    calls += 1;
    return { ok: false, status: 503, json: async () => ({}) };
  };

  await assert.rejects(suggestDishes({ apiKey: 'k', prompt: 'p', fetchFn }), { kind: 'unavailable' });
  assert.equal(calls, 2);
});

test('suggestDishes: 429 не повторяется на запасной модели', async () => {
  let calls = 0;
  const fetchFn = async () => {
    calls += 1;
    return { ok: false, status: 429, json: async () => ({}) };
  };

  await assert.rejects(suggestDishes({ apiKey: 'k', prompt: 'p', fetchFn }), { kind: 'limit' });
  assert.equal(calls, 1);
});

test('suggestDishes: fetch бросил исключение → network', async () => {
  const fetchFn = async () => {
    throw new TypeError('Failed to fetch');
  };

  await assert.rejects(suggestDishes({ apiKey: 'k', prompt: 'p', fetchFn }), { kind: 'network' });
});

test('suggestDishes: ответ без candidates → format', async () => {
  const fetchFn = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ promptFeedback: { blockReason: 'SAFETY' } }),
  });

  await assert.rejects(suggestDishes({ apiKey: 'k', prompt: 'p', fetchFn }), { kind: 'format' });
});

test('suggestDishes: тело ответа не JSON → format', async () => {
  const fetchFn = async () => ({
    ok: true,
    status: 200,
    json: async () => {
      throw new SyntaxError('Unexpected token');
    },
  });

  await assert.rejects(suggestDishes({ apiKey: 'k', prompt: 'p', fetchFn }), { kind: 'format' });
});
```

- [ ] **Step 2: Запустить тесты, убедиться что падают**

Run: `node --test test/llm.test.js`
Expected: FAIL — `Cannot find module` для `../llm.js`.

- [ ] **Step 3: Написать реализацию**

`llm.js`:

```js
// Алиасы: Google сам переключает их на актуальные версии.
export const MODEL = 'gemini-flash-latest';
export const FALLBACK_MODEL = 'gemini-flash-lite-latest';

const endpoint = (model) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

const STRING_LIST = { type: 'ARRAY', items: { type: 'STRING' } };

const RESPONSE_SCHEMA = {
  type: 'ARRAY',
  minItems: 3,
  maxItems: 3,
  items: {
    type: 'OBJECT',
    properties: {
      name: { type: 'STRING' },
      minutes: { type: 'INTEGER' },
      uses: STRING_LIST,
      missing: STRING_LIST,
      steps: STRING_LIST,
    },
    required: ['name', 'minutes', 'uses', 'missing', 'steps'],
  },
};

const MAX_DISHES = 3;

const MESSAGES = {
  key: 'Ключ не подошёл. Проверь его в настройках.',
  limit: 'Лимит запросов исчерпан. Попробуй через минуту.',
  unavailable: 'Gemini сейчас недоступен. Попробуй позже.',
  network: 'Не достучался до Gemini. Проверь интернет; возможно, нужен VPN.',
  format: 'Не понял ответ модели. Нажми ещё раз.',
};

export class LlmError extends Error {
  constructor(kind) {
    super(kind);
    this.kind = kind;
  }
}

function strings(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => typeof item === 'string' && item.trim() !== '');
}

export function parseDishes(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new LlmError('format');
  }
  if (!Array.isArray(raw) || raw.length === 0) throw new LlmError('format');

  return raw.slice(0, MAX_DISHES).map((item) => {
    const name = typeof item?.name === 'string' ? item.name.trim() : '';
    const steps = strings(item?.steps);
    if (name === '' || steps.length === 0) throw new LlmError('format');
    return {
      name,
      minutes: typeof item.minutes === 'number' ? item.minutes : null,
      uses: strings(item.uses),
      missing: strings(item.missing),
      steps,
    };
  });
}

export function toUserError(err) {
  if (err instanceof LlmError) {
    return { message: MESSAGES[err.kind], openSettings: err.kind === 'key' };
  }
  return { message: 'Что-то пошло не так. Нажми ещё раз.', openSettings: false };
}

function kindForStatus(status) {
  if (status === 400 || status === 401 || status === 403) return 'key';
  if (status === 429) return 'limit';
  return 'unavailable';
}

async function generate(model, { apiKey, prompt, fetchFn }) {
  try {
    return await fetchFn(endpoint(model), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA,
        },
      }),
    });
  } catch {
    throw new LlmError('network');
  }
}

export async function suggestDishes({ apiKey, prompt, fetchFn = globalThis.fetch }) {
  const request = { apiKey, prompt, fetchFn };
  let response = await generate(MODEL, request);
  // Основная модель перегружена (503) или снята с поддержки (404).
  if (response.status === 503 || response.status === 404) {
    response = await generate(FALLBACK_MODEL, request);
  }
  if (!response.ok) throw new LlmError(kindForStatus(response.status));

  let text;
  try {
    const body = await response.json();
    text = body.candidates[0].content.parts[0].text;
  } catch {
    throw new LlmError('format');
  }
  if (typeof text !== 'string') throw new LlmError('format');
  return parseDishes(text);
}
```

- [ ] **Step 4: Запустить тесты, убедиться что проходят**

Run: `node --test test/llm.test.js`
Expected: PASS, 29 тестов.

- [ ] **Step 5: Commit**

```bash
git add llm.js test/llm.test.js
git commit -m "Add Gemini client"
```

---

### Task 3: storage.js — ключ и продукты в localStorage

**Files:**
- Create: `storage.js`
- Test: `test/storage.test.js`

**Interfaces:**
- Consumes: ничего.
- Produces: `createStorage(store?: Storage)` → `{ getApiKey(): string, setApiKey(value: string): void, getProducts(): string, setProducts(value: string): void }`. Геттеры возвращают `''`, если значения нет или хранилище недоступно. Сеттеры не бросают исключений.

- [ ] **Step 1: Написать падающие тесты**

`test/storage.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStorage } from '../storage.js';

function fakeStore() {
  const data = new Map();
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
  };
}

const brokenStore = {
  getItem() {
    throw new Error('SecurityError');
  },
  setItem() {
    throw new Error('QuotaExceededError');
  },
};

test('пустое хранилище отдаёт пустые строки', () => {
  const storage = createStorage(fakeStore());

  assert.equal(storage.getApiKey(), '');
  assert.equal(storage.getProducts(), '');
});

test('ключ и продукты сохраняются и читаются независимо', () => {
  const storage = createStorage(fakeStore());

  storage.setApiKey('k-123');
  storage.setProducts('курица, рис');

  assert.equal(storage.getApiKey(), 'k-123');
  assert.equal(storage.getProducts(), 'курица, рис');
});

test('значения переживают пересоздание обёртки', () => {
  const store = fakeStore();
  createStorage(store).setProducts('яйца');

  assert.equal(createStorage(store).getProducts(), 'яйца');
});

test('сломанное хранилище не бросает исключений', () => {
  const storage = createStorage(brokenStore);

  storage.setApiKey('k');
  storage.setProducts('p');

  assert.equal(storage.getApiKey(), '');
  assert.equal(storage.getProducts(), '');
});

test('отсутствующее хранилище не бросает исключений', () => {
  const storage = createStorage(undefined);

  storage.setApiKey('k');

  assert.equal(storage.getApiKey(), '');
});
```

- [ ] **Step 2: Запустить тесты, убедиться что падают**

Run: `node --test test/storage.test.js`
Expected: FAIL — `Cannot find module` для `../storage.js`.

- [ ] **Step 3: Написать реализацию**

`storage.js`:

```js
const API_KEY = 'what-to-cook.apiKey';
const PRODUCTS = 'what-to-cook.products';

function defaultStore() {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export function createStorage(store = defaultStore()) {
  const read = (key) => {
    try {
      return store.getItem(key) ?? '';
    } catch {
      return '';
    }
  };
  const write = (key, value) => {
    try {
      store.setItem(key, value);
    } catch {
      // хранилище недоступно — работаем без запоминания
    }
  };

  return {
    getApiKey: () => read(API_KEY),
    setApiKey: (value) => write(API_KEY, value),
    getProducts: () => read(PRODUCTS),
    setProducts: (value) => write(PRODUCTS, value),
  };
}
```

Примечание к тесту «отсутствующее хранилище»: `createStorage(undefined)` включает значение по умолчанию. В Node 25 `globalThis.localStorage` без флага `--localstorage-file` — объект без методов `getItem`/`setItem` (проверено на v25.9.0), вызов бросает `TypeError`, который гасится `try/catch`.

- [ ] **Step 4: Запустить тесты, убедиться что проходят**

Run: `node --test test/storage.test.js`
Expected: PASS, 5 тестов. Предупреждение Node про `localStorage` в stderr допустимо.

- [ ] **Step 5: Commit**

```bash
git add storage.js test/storage.test.js
git commit -m "Add storage wrapper"
```

---

### Task 4: страница — index.html, style.css, app.js

**Files:**
- Create: `index.html`
- Create: `style.css`
- Create: `app.js`

**Interfaces:**
- Consumes:
  - `buildPrompt({ products, meal, exclude })` из `./prompt.js`
  - `suggestDishes({ apiKey, prompt })`, `toUserError(err)` из `./llm.js`
  - `createStorage()` из `./storage.js`
- Produces: ничего для других задач.

Автотестов у этой задачи нет: `app.js` — тонкая склейка с DOM, проверяется вручную по чек-листу в Step 5.

- [ ] **Step 1: Создать index.html**

```html
<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Что приготовить?</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <header>
    <h1>Что приготовить?</h1>
    <button id="settings-open" type="button" class="icon" aria-label="Настройки">⚙</button>
  </header>

  <main>
    <label for="products">Что есть дома</label>
    <textarea id="products" rows="5" placeholder="курица, рис, полбанки сметаны, лук…"></textarea>
    <p id="products-hint" class="hint" hidden>Напиши, что есть дома</p>

    <fieldset class="meal">
      <legend>Приём пищи</legend>
      <label><input type="radio" name="meal" value="lunch"> обед</label>
      <label><input type="radio" name="meal" value="dinner" checked> ужин</label>
    </fieldset>

    <button id="suggest" type="button" class="primary">Что приготовить?</button>

    <p id="status" class="status" role="status" hidden></p>
    <section id="dishes" aria-live="polite"></section>
    <button id="more" type="button" hidden>Ещё варианты</button>
  </main>

  <dialog id="settings">
    <form id="settings-form" method="dialog">
      <h2>Настройки</h2>
      <label for="api-key">API-ключ Gemini</label>
      <input id="api-key" type="password" autocomplete="off" spellcheck="false">
      <p class="hint-link">
        <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">Получить ключ в Google AI Studio</a>
      </p>
      <button type="submit" class="primary">Сохранить</button>
    </form>
  </dialog>

  <script type="module" src="app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Создать style.css**

```css
:root {
  --bg: #faf8f5;
  --surface: #ffffff;
  --text: #1f1d1a;
  --muted: #6b665e;
  --border: #e2ddd5;
  --accent: #c2410c;
  --accent-text: #ffffff;
  --danger: #b91c1c;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #171513;
    --surface: #221f1c;
    --text: #f1ede7;
    --muted: #a39d93;
    --border: #38332d;
    --accent: #ea580c;
    --accent-text: #ffffff;
    --danger: #f87171;
  }
}

* {
  box-sizing: border-box;
}

[hidden] {
  display: none !important;
}

body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
}

header,
main {
  max-width: 560px;
  margin: 0 auto;
  padding: 0 16px;
}

header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 16px;
}

h1 {
  margin: 0;
  font-size: 1.5rem;
}

main {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-top: 16px;
  padding-bottom: 32px;
}

label,
legend {
  font-weight: 600;
}

textarea,
input[type="password"] {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface);
  color: var(--text);
  font: inherit;
}

textarea {
  resize: vertical;
}

.hint {
  margin: 0;
  color: var(--danger);
  font-size: 0.9rem;
}

.meal {
  display: flex;
  gap: 16px;
  margin: 0;
  padding: 0;
  border: 0;
}

.meal legend {
  padding: 0;
  margin-bottom: 4px;
}

.meal label {
  font-weight: 400;
}

button {
  min-height: 44px;
  padding: 10px 16px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface);
  color: var(--text);
  font: inherit;
  cursor: pointer;
}

button:disabled {
  opacity: 0.6;
  cursor: progress;
}

button.primary {
  border-color: var(--accent);
  background: var(--accent);
  color: var(--accent-text);
  font-weight: 600;
}

button.icon {
  min-width: 44px;
  padding: 0;
  font-size: 1.25rem;
}

.status {
  margin: 0;
  color: var(--muted);
}

#dishes {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.dish {
  padding: 14px 16px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface);
}

.dish h2 {
  margin: 0 0 4px;
  font-size: 1.15rem;
}

.dish p {
  margin: 4px 0;
}

.dish .meta {
  color: var(--muted);
  font-size: 0.9rem;
}

.dish ol {
  margin: 8px 0 0;
  padding-left: 20px;
}

dialog {
  width: min(92vw, 420px);
  padding: 20px;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--surface);
  color: var(--text);
}

dialog::backdrop {
  background: rgb(0 0 0 / 50%);
}

dialog form {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

dialog h2 {
  margin: 0;
  font-size: 1.2rem;
}

.hint-link {
  margin: 0;
  font-size: 0.9rem;
}

a {
  color: var(--accent);
}
```

- [ ] **Step 3: Создать app.js**

```js
import { buildPrompt } from './prompt.js';
import { suggestDishes, toUserError } from './llm.js';
import { createStorage } from './storage.js';

const storage = createStorage();

const productsEl = document.getElementById('products');
const hintEl = document.getElementById('products-hint');
const suggestEl = document.getElementById('suggest');
const moreEl = document.getElementById('more');
const statusEl = document.getElementById('status');
const dishesEl = document.getElementById('dishes');
const settingsEl = document.getElementById('settings');
const settingsFormEl = document.getElementById('settings-form');
const apiKeyEl = document.getElementById('api-key');

// Названия уже показанных блюд для текущей пары «продукты + приём пищи».
let exclude = [];
let lastSignature = null;

function selectedMeal() {
  return document.querySelector('input[name="meal"]:checked').value;
}

function openSettings() {
  apiKeyEl.value = storage.getApiKey();
  if (!settingsEl.open) settingsEl.showModal();
}

function showStatus(text) {
  statusEl.textContent = text;
  statusEl.hidden = false;
}

function setBusy(busy) {
  suggestEl.disabled = busy;
  moreEl.disabled = busy;
}

function element(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

function renderDish(dish) {
  const card = element('article', 'dish');
  card.append(element('h2', '', dish.name));
  if (dish.minutes !== null) {
    card.append(element('p', 'meta', `${dish.minutes} мин`));
  }
  if (dish.uses.length > 0) {
    card.append(element('p', '', `Из твоего: ${dish.uses.join(', ')}`));
  }
  if (dish.missing.length > 0) {
    card.append(element('p', '', `Не хватает: ${dish.missing.join(', ')}`));
  }
  const steps = element('ol');
  for (const step of dish.steps) {
    steps.append(element('li', '', step));
  }
  card.append(steps);
  return card;
}

async function run(more) {
  const products = productsEl.value.trim();
  if (products === '') {
    hintEl.hidden = false;
    return;
  }
  hintEl.hidden = true;

  const apiKey = storage.getApiKey();
  if (apiKey === '') {
    openSettings();
    return;
  }

  storage.setProducts(products);

  const meal = selectedMeal();
  const signature = `${meal}\n${products}`;
  if (!more || signature !== lastSignature) exclude = [];
  lastSignature = signature;

  setBusy(true);
  showStatus('Думаю…');
  try {
    const dishes = await suggestDishes({
      apiKey,
      prompt: buildPrompt({ products, meal, exclude }),
    });
    exclude = exclude.concat(dishes.map((dish) => dish.name));
    statusEl.hidden = true;
    dishesEl.replaceChildren(...dishes.map(renderDish));
  } catch (err) {
    const { message, openSettings: needsKey } = toUserError(err);
    dishesEl.replaceChildren();
    showStatus(message);
    if (needsKey) openSettings();
  } finally {
    moreEl.hidden = exclude.length === 0;
    setBusy(false);
  }
}

suggestEl.addEventListener('click', () => run(false));
moreEl.addEventListener('click', () => run(true));
productsEl.addEventListener('input', () => {
  hintEl.hidden = true;
});
document.getElementById('settings-open').addEventListener('click', openSettings);
settingsFormEl.addEventListener('submit', () => {
  storage.setApiKey(apiKeyEl.value.trim());
});

productsEl.value = storage.getProducts();
if (storage.getApiKey() === '') openSettings();
```

- [ ] **Step 4: Прогнать все автотесты**

Run: `node --test`
Expected: PASS, 42 теста (8 + 29 + 5). Проверяет, что добавление страницы ничего не сломало в модулях.

- [ ] **Step 5: Ручная проверка в браузере**

ES-модули не грузятся по `file://`, нужен локальный сервер:

Run: `python3 -m http.server 8000` (из корня репозитория), открыть `http://localhost:8000`.

Нужен настоящий ключ Gemini: https://aistudio.google.com/apikey.

Чек-лист (каждый пункт — отдельная проверка):

1. Первый запуск без ключа: диалог настроек открывается сам, в нём ссылка на AI Studio.
2. Ввести ключ → «Сохранить» → диалог закрылся. Перезагрузить страницу — диалог сам не открывается.
3. Пустое поле + «Что приготовить?» → подсказка «Напиши, что есть дома», в Network запросов нет. Начать печатать — подсказка пропала.
4. Ввести `курица, рис, лук` → «Что приготовить?» → кнопка заблокирована, «Думаю…», затем три карточки: название, минуты, «Из твоего», шаги. Появилась «Ещё варианты».
5. «Ещё варианты» → три новых блюда, названия не повторяют предыдущие.
6. Переключить на «обед» → «Ещё варианты» → блюда подходят для обеда; в Network в теле запроса нет строки «Не предлагай» (исключения сброшены).
7. Перезагрузить страницу → поле продуктов заполнено прежним текстом.
8. Шестерёнка → ввести заведомо неверный ключ `abc` → сохранить → запрос → «Ключ не подошёл. Проверь его в настройках.» и открывается диалог. Вернуть верный ключ.
9. DevTools → Network → Offline → запрос → «Не достучался до Gemini. Проверь интернет; возможно, нужен VPN.» Кнопка снова активна.
10. Сузить окно до 360px (или режим телефона в DevTools) — ничего не вылезает за край, кнопки нажимаются пальцем.
11. Если на шаге 4 пришло «Gemini сейчас недоступен» при рабочем интернете — проверить, что алиасы `MODEL` и `FALLBACK_MODEL` из `llm.js` ещё существуют:
    `curl -s -H "x-goog-api-key: $KEY" https://generativelanguage.googleapis.com/v1beta/models | grep '"name"'`
    и заменить константы на актуальные бесплатные Flash-модели из списка; прогнать `node --test`.

- [ ] **Step 6: Commit**

```bash
git add index.html style.css app.js
git commit -m "Add page"
```

---

### Task 5: публикация на GitHub Pages

**Требует явного согласия пользователя перед выполнением**: создаётся публичный репозиторий, код становится доступен всем. GitHub Pages на бесплатном тарифе работает только с публичными репозиториями. API-ключа в коде нет — он живёт в `localStorage` браузера.

`gh` на машине не установлен, поэтому репозиторий создаётся руками.

**Files:** нет изменений в коде.

**Interfaces:**
- Consumes: готовая страница из Task 4.
- Produces: публичный URL `https://<login>.github.io/what-to-cook/`.

- [ ] **Step 1: Пользователь создаёт репозиторий**

На https://github.com/new: имя `what-to-cook`, Public, без README/.gitignore/лицензии.

- [ ] **Step 2: Убедиться, что в репозитории нет ключа**

Run: `git grep -nE 'AIza[0-9A-Za-z_-]{20,}' $(git rev-list --all) -- . ; echo "exit=$?"`
Expected: совпадений нет, `exit=1`.

- [ ] **Step 3: Запушить**

```bash
git branch -M main
git remote add origin git@github.com:<login>/what-to-cook.git
git push -u origin main
```

`<login>` — логин пользователя на GitHub, спросить у него.

- [ ] **Step 4: Включить Pages**

В репозитории: Settings → Pages → Source: «Deploy from a branch» → Branch: `main`, папка `/ (root)` → Save.

- [ ] **Step 5: Проверить с телефона**

Через 1–2 минуты открыть `https://<login>.github.io/what-to-cook/` на телефоне. Ввести ключ (на телефоне `localStorage` свой — ключ вводится заново), запросить блюда, убедиться что пришли три карточки.
