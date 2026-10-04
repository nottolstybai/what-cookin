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

test('сломанное хранилище: пустые строки до записи', () => {
  const storage = createStorage(brokenStore);

  assert.equal(storage.getApiKey(), '');
  assert.equal(storage.getProducts(), '');
});

test('сломанное хранилище: значения живут в памяти до перезагрузки', () => {
  const storage = createStorage(brokenStore);

  storage.setApiKey('k');
  storage.setProducts('p');

  assert.equal(storage.getApiKey(), 'k');
  assert.equal(storage.getProducts(), 'p');
});

test('отсутствующее хранилище: значения живут в памяти', () => {
  const storage = createStorage(undefined);

  storage.setApiKey('k');

  assert.equal(storage.getApiKey(), 'k');
});
