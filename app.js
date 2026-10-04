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
