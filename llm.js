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
const TIMEOUT_MS = 45000;

const MESSAGES = {
  key: 'Ключ не подошёл. Проверь его в настройках.',
  limit: 'Лимит бесплатных запросов исчерпан. Попробуй позже.',
  unavailable: 'Gemini сейчас недоступен. Попробуй позже.',
  network: 'Не достучался до Gemini. Проверь интернет; возможно, нужен VPN.',
  format: 'Не понял ответ модели. Нажми ещё раз.',
  region: 'Gemini недоступен из твоего региона. Включи VPN и попробуй ещё раз.',
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

async function errorStatus(response) {
  try {
    return (await response.json()).error.status;
  } catch {
    return undefined;
  }
}

async function kindForResponse(response) {
  const { status } = response;
  // Региональная блокировка приходит тем же 400, что и неверный ключ.
  if (status === 400 && (await errorStatus(response)) === 'FAILED_PRECONDITION') return 'region';
  if (status === 400 || status === 401 || status === 403) return 'key';
  if (status === 429) return 'limit';
  return 'unavailable';
}

async function generate(model, { apiKey, prompt, fetchFn }) {
  try {
    return await fetchFn(endpoint(model), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      signal: AbortSignal.timeout(TIMEOUT_MS),
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
  // Основная модель перегружена (503), снята с поддержки (404) или выбрала
  // свою квоту (429) — у запасной квота отдельная.
  if ([503, 404, 429].includes(response.status)) {
    response = await generate(FALLBACK_MODEL, request);
  }
  if (!response.ok) throw new LlmError(await kindForResponse(response));

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
