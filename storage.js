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
