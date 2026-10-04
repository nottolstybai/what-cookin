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
  // Запасная память на случай недоступного хранилища: живёт до перезагрузки.
  const memory = new Map();
  const read = (key) => {
    try {
      return store.getItem(key) ?? memory.get(key) ?? '';
    } catch {
      return memory.get(key) ?? '';
    }
  };
  const write = (key, value) => {
    memory.set(key, value);
    try {
      store.setItem(key, value);
    } catch {
      // хранилище недоступно — значение остаётся только в памяти
    }
  };

  return {
    getApiKey: () => read(API_KEY),
    setApiKey: (value) => write(API_KEY, value),
    getProducts: () => read(PRODUCTS),
    setProducts: (value) => write(PRODUCTS, value),
  };
}
