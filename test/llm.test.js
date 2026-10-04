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
