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
const dishDialogEl = document.getElementById('dish-dialog');
const dishTitleEl = document.getElementById('dish-title');
const dishTimeEl = document.getElementById('dish-time');
const dishUsesBlockEl = document.getElementById('dish-uses-block');
const dishUsesEl = document.getElementById('dish-uses');
const dishMissingBlockEl = document.getElementById('dish-missing-block');
const dishMissingEl = document.getElementById('dish-missing');
const dishStepsEl = document.getElementById('dish-steps');

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

function showStatus(text, kind) {
  statusEl.textContent = text;
  statusEl.className = `status ${kind}`;
  statusEl.hidden = false;
  statusEl.scrollIntoView({ block: 'nearest' });
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

function fillList(listEl, items) {
  listEl.replaceChildren(...items.map((item) => element('li', '', item)));
}

function openDish(dish) {
  dishTitleEl.textContent = dish.name;
  dishTimeEl.textContent = dish.minutes === null ? '' : `⏱ ${dish.minutes} мин`;
  dishTimeEl.hidden = dish.minutes === null;
  fillList(dishUsesEl, dish.uses);
  dishUsesBlockEl.hidden = dish.uses.length === 0;
  fillList(dishMissingEl, dish.missing);
  dishMissingBlockEl.hidden = dish.missing.length === 0;
  fillList(dishStepsEl, dish.steps);
  dishDialogEl.showModal();
  dishDialogEl.scrollTop = 0;
}

// Карточка — только главное; всё остальное в попапе по нажатию.
function renderDish(dish) {
  const card = element('button', 'dish');
  card.type = 'button';
  card.append(element('span', 'dish-name', dish.name));
  card.append(element('span', 'dish-arrow', '›'));

  const meta = element('span', 'dish-meta');
  if (dish.minutes !== null) {
    meta.append(element('span', '', `⏱ ${dish.minutes} мин`));
  }
  meta.append(
    dish.missing.length === 0
      ? element('span', 'badge badge-ok', 'всё есть дома')
      : element('span', 'badge badge-missing', `докупить: ${dish.missing.length}`),
  );
  card.append(meta);

  card.addEventListener('click', () => openDish(dish));
  return card;
}

async function run() {
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
  // Новые продукты или приём пищи — прежние карточки уже не к месту.
  if (signature !== lastSignature) {
    exclude = [];
    dishesEl.replaceChildren();
    moreEl.hidden = true;
  }
  lastSignature = signature;

  setBusy(true);
  showStatus('Думаю…', 'loading');
  try {
    const dishes = await suggestDishes({
      apiKey,
      prompt: buildPrompt({ products, meal, exclude }),
    });
    exclude = exclude.concat(dishes.map((dish) => dish.name));
    statusEl.hidden = true;
    const cards = dishes.map(renderDish);
    dishesEl.append(...cards);
    cards[0].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  } catch (err) {
    const { message, openSettings: needsKey } = toUserError(err);
    showStatus(message, 'error');
    if (needsKey) openSettings();
  } finally {
    moreEl.hidden = exclude.length === 0;
    setBusy(false);
  }
}

suggestEl.addEventListener('click', run);
moreEl.addEventListener('click', run);
productsEl.addEventListener('input', () => {
  hintEl.hidden = true;
});
document.getElementById('settings-open').addEventListener('click', openSettings);
settingsFormEl.addEventListener('submit', () => {
  storage.setApiKey(apiKeyEl.value.trim());
});
document.getElementById('dish-close').addEventListener('click', () => dishDialogEl.close());
// Нажатие мимо содержимого попапа (по затемнению) закрывает его.
dishDialogEl.addEventListener('click', (event) => {
  const box = dishDialogEl.getBoundingClientRect();
  const inside =
    event.clientX >= box.left &&
    event.clientX <= box.right &&
    event.clientY >= box.top &&
    event.clientY <= box.bottom;
  if (!inside) dishDialogEl.close();
});

productsEl.value = storage.getProducts();
if (storage.getApiKey() === '') openSettings();
