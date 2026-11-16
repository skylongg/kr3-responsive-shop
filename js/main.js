/*
 * «Стенограф» — интерактивность сайта.
 * Каждая страница вызывает только свои модули: модуль сам проверяет,
 * есть ли на странице нужная разметка.
 */

/* ---------- Утилиты ---------- */

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatNumber(value, digits = 0) {
  return value.toLocaleString('ru-RU', { maximumFractionDigits: digits });
}

function formatPrice(value) {
  return `${formatNumber(Math.round(value))} ₽`;
}

function formatRate(value) {
  return `${formatNumber(value, 1)} ₽/мин`;
}

/* plural(5, ['отзыв', 'отзыва', 'отзывов']) → 'отзывов' */
function plural(n, forms) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
}

/* Срок после предлога «до»: «до 12 часов», «до 21 часа», «до 3 дней». */
function formatDeadline(hours) {
  if (hours < 48) {
    return `до ${hours} ${hours % 10 === 1 && hours % 100 !== 11 ? 'часа' : 'часов'}`;
  }
  const days = Math.ceil(hours / 24);
  return `до ${days} ${days % 10 === 1 && days % 100 !== 11 ? 'дня' : 'дней'}`;
}

function formatDateTime(date) {
  return date.toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
}

function formatDate(iso) {
  return new Date(`${iso}T12:00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}

function formatFileSize(bytes) {
  if (bytes >= 1024 ** 3) return `${formatNumber(bytes / 1024 ** 3, 1)} ГБ`;
  if (bytes >= 1024 ** 2) return `${formatNumber(bytes / 1024 ** 2, 1)} МБ`;
  return `${formatNumber(Math.max(1, bytes / 1024))} КБ`;
}

/* Поиск без учёта регистра и разницы «е/ё». */
function normalize(text) {
  return text.toLowerCase().replace(/ё/g, 'е').trim();
}

const findService = (id) => SERVICES.find((service) => service.id === id);
const findTariff = (id) => TARIFFS.find((tariff) => tariff.id === id) || TARIFFS[1];
const findUrgency = (id) => URGENCY.find((urgency) => urgency.id === id) || URGENCY[0];

function getParams() {
  return new URLSearchParams(window.location.search);
}

const storage = {
  read(key, fallback) {
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (error) {
      return fallback;
    }
  },
  write(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      /* Приватный режим или запрет хранилища — просто не сохраняем. */
    }
  }
};

/* ---------- Расчёт стоимости ---------- */

function calcOrder({ serviceId, minutes, tariffId, urgencyId, promoPercent = 0 }) {
  const service = findService(serviceId) || SERVICES[0];
  const tariff = findTariff(tariffId);
  const urgency = findUrgency(urgencyId);
  const safeMinutes = Math.max(0, Math.floor(Number(minutes) || 0));

  const rate = service.price * tariff.priceFactor * urgency.priceFactor;
  const subtotal = rate * safeMinutes;
  const discountRule = PRICING.discounts.find((rule) => safeMinutes >= rule.minutes);
  /* Скидка за объём + скидка по промокоду */
  const discountPercent = (discountRule ? discountRule.percent : 0) + promoPercent;
  const discount = Math.round((subtotal * discountPercent) / 100);
  const afterDiscount = Math.round(subtotal - discount);
  const total = safeMinutes > 0 ? Math.max(PRICING.minOrder, afterDiscount) : 0;
  const hours = Math.max(PRICING.minHours, Math.ceil(service.hours * tariff.timeFactor * urgency.timeFactor));

  return {
    service,
    tariff,
    urgency,
    minutes: safeMinutes,
    rate,
    subtotal,
    discountPercent,
    discount,
    total,
    minApplied: safeMinutes > 0 && afterDiscount < PRICING.minOrder,
    hours,
    readyAt: new Date(Date.now() + hours * 60 * 60 * 1000)
  };
}

/* ---------- Общие куски разметки ---------- */

function ratingHtml(rating, extra = '') {
  const label = `Оценка ${formatNumber(rating, 1)} из 5`;
  return `<span class="rating" role="img" aria-label="${label}${extra ? `, ${extra}` : ''}">` +
    `<span class="rating__stars" style="--rating: ${rating}" aria-hidden="true">★★★★★</span>` +
    `<span class="rating__value" aria-hidden="true">${formatNumber(rating, 1)}</span>` +
    `${extra ? `<span class="rating__count" aria-hidden="true">${extra}</span>` : ''}` +
    '</span>';
}

/* compareIds — список выбранных для сравнения (только в каталоге) */
function serviceCardHtml(service, compareIds) {
  const tags = service.media.map((media) => `<li class="tag">${MEDIA_LABELS[media]}</li>`).join('');
  let badge = '';
  if (service.popularity >= 900) badge = '<span class="service-card__badge">Хит</span>';
  else if (service.hours <= 12) badge = '<span class="service-card__badge service-card__badge--fast">Быстро</span>';
  const reviews = `${service.reviews} ${plural(service.reviews, ['отзыв', 'отзыва', 'отзывов'])}`;

  return `
    <article class="service-card">
      ${badge}
      <img class="service-card__icon" src="images/services/${service.icon}.svg" alt="" width="48" height="48">
      <h3 class="service-card__title">
        <a class="service-card__link" href="product.html?id=${service.id}">${escapeHtml(service.title)}</a>
      </h3>
      <p class="service-card__text">${escapeHtml(service.short)}</p>
      <ul class="service-card__tags" aria-label="Тип записи">${tags}</ul>
      <dl class="service-card__meta">
        <div class="service-card__meta-item"><dt>Цена</dt><dd>${formatRate(service.price)}</dd></div>
        <div class="service-card__meta-item"><dt>Срок</dt><dd>${formatDeadline(service.hours)}</dd></div>
      </dl>
      ${Array.isArray(compareIds) ? `
      <label class="service-card__compare">
        <input type="checkbox" value="${service.id}" data-compare${compareIds.includes(service.id) ? ' checked' : ''}>
        Сравнить
      </label>` : ''}
      <div class="service-card__footer">
        ${ratingHtml(service.rating, reviews)}
        <a class="button button--primary button--small service-card__order" href="order.html?service=${service.id}">
          Заказать<span class="visually-hidden">: ${escapeHtml(service.title)}</span>
        </a>
      </div>
    </article>`;
}

function speakerIndex(map, name) {
  if (!map.has(name)) map.set(name, map.size % 4);
  return map.get(name);
}

function transcriptHtml(lines) {
  const speakers = new Map();
  const items = lines.map(([time, speaker, text]) => `
      <li class="transcript__item">
        <span class="transcript__head">
          <time class="transcript__time">${time}</time>
          <span class="transcript__speaker transcript__speaker--${speakerIndex(speakers, speaker)}">${escapeHtml(speaker)}</span>
        </span>
        <p class="transcript__text">${escapeHtml(text)}</p>
      </li>`).join('');
  return `<ol class="transcript">${items}</ol>`;
}

function protocolHtml(protocol) {
  const decisions = protocol.decisions.map((item) => `<li>${escapeHtml(item)}</li>`).join('');
  const tasks = protocol.tasks.map(([task, owner, due]) => `
      <tr>
        <td data-label="Поручение">${escapeHtml(task)}</td>
        <td data-label="Ответственный">${escapeHtml(owner)}</td>
        <td data-label="Срок">${escapeHtml(due)}</td>
      </tr>`).join('');
  return `
    <div class="protocol">
      <h3 class="protocol__title">Решения</h3>
      <ol class="protocol__list">${decisions}</ol>
      <div class="table-wrap">
        <table class="table table--stack">
          <caption>Поручения по итогам совещания</caption>
          <thead><tr><th scope="col">Поручение</th><th scope="col">Ответственный</th><th scope="col">Срок</th></tr></thead>
          <tbody>${tasks}</tbody>
        </table>
      </div>
    </div>`;
}

function exampleHtml(service) {
  if (service.protocol) return protocolHtml(service.protocol);
  if (service.srt) return `<pre class="srt"><code>${escapeHtml(service.srt)}</code></pre>`;
  return transcriptHtml(service.example);
}

function fillServiceSelect(select, selectedId) {
  if (!select) return;
  const options = SERVICES.map((service) =>
    `<option value="${service.id}">${escapeHtml(service.title)} — ${formatRate(service.price)}</option>`
  ).join('');
  select.insertAdjacentHTML('beforeend', options);
  if (selectedId && findService(selectedId)) select.value = selectedId;
}

function setChecked(form, name, value) {
  const input = form && value ? form.querySelector(`input[name="${name}"][value="${CSS.escape(value)}"]`) : null;
  if (input) input.checked = true;
}

/* ---------- Валидация форм ---------- */

function errorMessage(field) {
  const isText = !['checkbox', 'radio', 'file', 'select-one'].includes(field.type);
  if (field.required && isText && field.value.trim() === '') {
    return field.dataset.required || 'Заполните это поле';
  }
  const v = field.validity;
  if (v.valid) return '';
  if (v.customError) return field.validationMessage;
  if (v.valueMissing) {
    if (field.dataset.required) return field.dataset.required;
    if (field.type === 'checkbox') return 'Отметьте этот пункт';
    if (field.type === 'radio') return 'Выберите один из вариантов';
    if (field.tagName === 'SELECT') return 'Выберите вариант из списка';
    return 'Заполните это поле';
  }
  if (v.typeMismatch && field.type === 'email') return 'Введите e-mail в формате name@example.com';
  if (v.typeMismatch && field.type === 'url') return 'Введите ссылку целиком, начиная с https://';
  if (v.tooShort) return `Слишком коротко: нужно не меньше ${field.minLength} символов, сейчас ${field.value.trim().length}`;
  if (v.badInput || v.stepMismatch) return 'Введите целое число';
  if (v.rangeUnderflow || v.rangeOverflow) return `Введите число от ${field.min} до ${field.max}`;
  if (v.patternMismatch) return field.dataset.pattern || 'Проверьте формат';
  return 'Проверьте значение';
}

function showError(form, field, message) {
  const key = field.type === 'radio' ? field.name : field.id;
  const group = field.type === 'radio' ? $$(`input[name="${field.name}"]`, form) : [field];
  group.forEach((element) => {
    if (message) element.setAttribute('aria-invalid', 'true');
    else element.removeAttribute('aria-invalid');
  });
  const error = document.getElementById(`${key}-error`);
  if (error) error.textContent = message;
}

function validateField(form, field) {
  const message = errorMessage(field);
  showError(form, field, message);
  return !message;
}

function validateForm(form) {
  let firstInvalid = null;
  const seenRadio = new Set();
  Array.from(form.elements).forEach((field) => {
    if (!field.willValidate || !field.name) return;
    if (field.type === 'radio') {
      if (seenRadio.has(field.name)) return;
      seenRadio.add(field.name);
    }
    if (!validateField(form, field) && !firstInvalid) firstInvalid = field;
  });
  if (firstInvalid) firstInvalid.focus();
  return !firstInvalid;
}

/* Ошибка показывается, когда пользователь ушёл с поля, и убирается сразу после исправления. */
function enableLiveValidation(form) {
  form.addEventListener('focusout', (event) => {
    const field = event.target;
    if (field.willValidate && field.name && field.type !== 'radio' && field.value !== '') {
      validateField(form, field);
    }
  });
  const recheck = (event) => {
    const field = event.target;
    if (field.willValidate && field.getAttribute('aria-invalid') === 'true') validateField(form, field);
  };
  form.addEventListener('input', recheck);
  form.addEventListener('change', recheck);
}

function resetErrors(form) {
  $$('[aria-invalid]', form).forEach((field) => field.removeAttribute('aria-invalid'));
  $$('.field__error', form).forEach((error) => { error.textContent = ''; });
}

/* ---------- Шапка: мобильное меню ---------- */

function initNavigation() {
  const header = $('.site-header');
  const toggle = $('.site-header__toggle');
  const menu = $('#site-menu');
  if (!header || !toggle || !menu) return;

  const setOpen = (open) => {
    header.classList.toggle('site-header--open', open);
    toggle.setAttribute('aria-expanded', String(open));
    $('.site-header__toggle-label', toggle).textContent = open ? 'Закрыть меню' : 'Открыть меню';
  };

  toggle.addEventListener('click', () => setOpen(toggle.getAttribute('aria-expanded') !== 'true'));

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') {
      setOpen(false);
      toggle.focus();
    }
  });

  window.matchMedia('(min-width: 1024px)').addEventListener('change', (event) => {
    if (event.matches) setOpen(false);
  });
}

function initBackToTop() {
  const button = $('.back-to-top');
  if (!button) return;
  const update = () => button.classList.toggle('back-to-top--visible', window.scrollY > 600);
  window.addEventListener('scroll', update, { passive: true });
  update();
}

function initYear() {
  $$('[data-year]').forEach((element) => { element.textContent = new Date().getFullYear(); });
}

/* ---------- Главная: популярные услуги ---------- */

function initPopular() {
  const list = $('#popular-services');
  if (!list) return;
  const top = [...SERVICES].sort((a, b) => b.popularity - a.popularity).slice(0, 3);
  list.innerHTML = top.map(serviceCardHtml).join('');
}

/* ---------- Каталог: поиск, фильтры, сортировка ---------- */

function initCatalog() {
  const form = $('#catalog-filters');
  const list = $('#catalog-list');
  if (!form || !list) return;

  const count = $('#catalog-count');
  const empty = $('#catalog-empty');
  const search = $('#catalog-search');
  const sort = $('#catalog-sort');
  const price = $('#filter-price');
  const priceOutput = $('#filter-price-value');
  const toggle = $('.filters__toggle');

  const maxPrice = Math.max(...SERVICES.map((service) => service.price));
  const minPrice = Math.min(...SERVICES.map((service) => service.price));
  price.min = String(minPrice);
  price.max = String(maxPrice);
  price.value = String(maxPrice);

  const params = getParams();
  if (params.get('q')) search.value = params.get('q');
  if (params.get('media')) setChecked(form, 'media', params.get('media'));

  /* Сравнение: можно выбрать до 3 услуг */
  const compareIds = [];
  const compareBar = $('#compare-bar');
  const compareDialog = $('#compare-dialog');

  const updateCompare = () => {
    compareBar.hidden = compareIds.length === 0;
    $('#compare-count').textContent = `Выбрано для сравнения: ${compareIds.length} из 3`;
    $('#compare-open').disabled = compareIds.length < 2;
    $$('[data-compare]', list).forEach((box) => {
      box.disabled = !box.checked && compareIds.length >= 3;
    });
  };

  list.addEventListener('change', (event) => {
    const box = event.target;
    if (!box.matches('[data-compare]')) return;
    if (box.checked) compareIds.push(box.value);
    else compareIds.splice(compareIds.indexOf(box.value), 1);
    updateCompare();
  });

  $('#compare-clear').addEventListener('click', () => {
    compareIds.length = 0;
    $$('[data-compare]', list).forEach((box) => { box.checked = false; });
    updateCompare();
  });

  $('#compare-open').addEventListener('click', () => {
    const items = compareIds.map(findService);
    const row = (title, cell) => `<tr><th scope="row">${title}</th>${items.map((item) => `<td>${cell(item)}</td>`).join('')}</tr>`;
    $('#compare-table').innerHTML = `
      <table class="table">
        <caption class="visually-hidden">Сравнение услуг</caption>
        <thead><tr><th scope="col">Услуга</th>${items.map((item) => `<th scope="col">${escapeHtml(item.title)}</th>`).join('')}</tr></thead>
        <tbody>
          ${row('Цена', (item) => formatRate(item.price))}
          ${row('Срок', (item) => formatDeadline(item.hours))}
          ${row('Рейтинг', (item) => `${formatNumber(item.rating, 1)} из 5`)}
          ${row('Отзывы', (item) => item.reviews)}
          ${row('Тип записи', (item) => item.media.map((media) => MEDIA_LABELS[media]).join(', '))}
          ${row('', (item) => `<a class="button button--primary button--small" href="order.html?service=${item.id}">Заказать</a>`)}
        </tbody>
      </table>`;
    compareDialog.showModal();
  });

  $$('[data-dialog-close]', compareDialog).forEach((button) => {
    button.addEventListener('click', () => compareDialog.close());
  });
  compareDialog.addEventListener('click', (event) => {
    if (event.target === compareDialog) compareDialog.close();
  });

  const render = () => {
    const query = normalize(search.value);
    const media = $$('input[name="media"]:checked', form).map((input) => input.value);
    const deadline = $('input[name="deadline"]:checked', form).value;
    const limit = Number(price.value);

    priceOutput.textContent = `до ${formatRate(limit)}`;

    const result = SERVICES.filter((service) => {
      const matchesQuery = !query || normalize(`${service.title} ${service.short}`).includes(query);
      const matchesMedia = media.length === 0 || media.some((type) => service.media.includes(type));
      const matchesDeadline = deadline === 'any' || service.hours <= Number(deadline);
      return matchesQuery && matchesMedia && matchesDeadline && service.price <= limit;
    });

    const sorters = {
      popular: (a, b) => b.popularity - a.popularity,
      'price-asc': (a, b) => a.price - b.price,
      'price-desc': (a, b) => b.price - a.price,
      rating: (a, b) => b.rating - a.rating || b.reviews - a.reviews
    };
    result.sort(sorters[sort.value] || sorters.popular);

    list.innerHTML = result.map((service) => serviceCardHtml(service, compareIds)).join('');
    updateCompare();
    empty.hidden = result.length > 0;
    count.textContent = result.length
      ? `Найдено ${result.length} ${plural(result.length, ['услуга', 'услуги', 'услуг'])}`
      : 'Ничего не найдено';
  };

  form.addEventListener('input', render);
  form.addEventListener('change', render);
  form.addEventListener('submit', (event) => event.preventDefault());
  search.addEventListener('input', render);
  sort.addEventListener('change', render);

  const reset = () => {
    form.reset();
    search.value = '';
    price.value = String(maxPrice);
    render();
    search.focus();
  };
  $$('[data-catalog-reset]').forEach((button) => button.addEventListener('click', reset));

  if (toggle) {
    toggle.addEventListener('click', () => {
      const open = toggle.getAttribute('aria-expanded') !== 'true';
      toggle.setAttribute('aria-expanded', String(open));
      form.closest('.filters').classList.toggle('filters--open', open);
    });
  }

  render();
}

/* ---------- Страница услуги ---------- */

function initServicePage() {
  const page = $('#service-page');
  if (!page) return;

  const id = getParams().get('id') || 'meetings';
  const service = findService(id);
  if (!service) {
    document.title = 'Услуга не найдена — Стенограф';
    $('#service-crumb').textContent = 'Услуга не найдена';
    $('#service-title').textContent = 'Услуга не найдена';
    $('#service-description').textContent = 'Возможно, ссылка устарела. Все услуги собраны в каталоге.';
    $$('[data-service-only]', page).forEach((element) => { element.hidden = true; });
    $('#service-not-found').hidden = false;
    return;
  }

  document.title = `${service.title} — Стенограф`;
  $('#service-crumb').textContent = service.title;
  $('#service-title').textContent = service.title;
  $('#service-icon').src = `images/services/${service.icon}.svg`;
  $('#service-rating').innerHTML = ratingHtml(
    service.rating,
    `${service.reviews} ${plural(service.reviews, ['отзыв', 'отзыва', 'отзывов'])}`
  );
  $('#service-tags').innerHTML = service.media.map((media) => `<li class="tag">${MEDIA_LABELS[media]}</li>`).join('');
  $('#service-description').textContent = service.description;
  $('#service-price').textContent = formatRate(service.price);
  $('#service-deadline').textContent = formatDeadline(service.hours);
  $('#service-formats').textContent = service.media.includes('video') && service.media.includes('audio')
    ? 'Аудио и видео: MP3, WAV, M4A, OGG, MP4, MOV, MKV и др.'
    : service.media.includes('video')
      ? 'Видео: MP4, MOV, MKV, AVI, WEBM и др.'
      : 'Аудио: MP3, WAV, M4A, OGG, FLAC и др.';
  $('#service-includes').innerHTML = service.includes.map((item) => `<li>${escapeHtml(item)}</li>`).join('');
  $('#service-order').href = `order.html?service=${service.id}`;
  $('#service-calc').href = `tariffs.html?service=${service.id}#calculator`;

  $('#service-tariffs').innerHTML = TARIFFS.map((tariff) => {
    const price = calcOrder({ serviceId: service.id, minutes: 60, tariffId: tariff.id, urgencyId: 'normal' });
    return `
      <tr>
        <th scope="row" data-label="Тариф">${tariff.title}</th>
        <td data-label="Цена за минуту">${formatRate(price.rate)}</td>
        <td data-label="Срок">${formatDeadline(price.hours)}</td>
        <td data-label="Час записи">${formatPrice(price.total)}</td>
      </tr>`;
  }).join('');

  $('#service-example').innerHTML = exampleHtml(service);

  const related = SERVICES
    .filter((item) => item.id !== service.id && item.media.some((media) => service.media.includes(media)))
    .sort((a, b) => b.popularity - a.popularity)
    .slice(0, 3);
  $('#related-services').innerHTML = related.map(serviceCardHtml).join('');
}

/* ---------- Калькулятор стоимости ---------- */

function initCalculator() {
  const form = $('#calc-form');
  if (!form) return;

  const service = $('#calc-service');
  const minutes = $('#calc-minutes');
  const params = getParams();

  fillServiceSelect(service, params.get('service') || 'meetings');
  if (params.get('minutes')) minutes.value = params.get('minutes');

  const render = () => {
    const valid = minutes.checkValidity();
    const result = calcOrder({
      serviceId: service.value,
      minutes: valid ? minutes.value : 0,
      tariffId: $('input[name="tariff"]:checked', form).value,
      urgencyId: $('input[name="urgency"]:checked', form).value
    });

    $('#calc-total').textContent = valid ? formatPrice(result.total) : '—';
    $('#calc-rate').textContent = `${formatRate(result.rate)} × ${formatNumber(result.minutes)} мин`;
    $('#calc-discount').textContent = result.discountPercent
      ? `−${result.discountPercent}% (−${formatPrice(result.discount)})`
      : 'нет — от 300 минут';
    $('#calc-deadline').textContent = formatDeadline(result.hours);
    $('#calc-ready').textContent = formatDateTime(result.readyAt);
    $('#calc-min-note').hidden = !result.minApplied;

    const order = $('#calc-order');
    order.href = `order.html?service=${result.service.id}&tariff=${result.tariff.id}&urgency=${result.urgency.id}&minutes=${result.minutes || ''}`;
    order.setAttribute('aria-disabled', String(!valid));
  };

  $$('[data-minutes]', form).forEach((button) => {
    button.addEventListener('click', () => {
      minutes.value = button.dataset.minutes;
      validateField(form, minutes);
      render();
    });
  });

  $('#calc-order').addEventListener('click', (event) => {
    if (!minutes.checkValidity()) {
      event.preventDefault();
      validateField(form, minutes);
      minutes.focus();
    }
  });

  form.addEventListener('input', render);
  form.addEventListener('change', render);
  form.addEventListener('submit', (event) => event.preventDefault());
  enableLiveValidation(form);
  render();
}

/* ---------- Оформление заказа ---------- */

function initOrderForm() {
  const form = $('#order-form');
  if (!form) return;

  const params = getParams();
  const service = $('#order-service');
  const minutes = $('#order-minutes');
  const fileInput = $('#order-file');
  const linkInput = $('#order-link');
  const dropzone = $('.dropzone');
  const fileInfo = $('#order-file-info');
  const durationHint = $('#order-minutes-hint');
  const defaultHint = durationHint.textContent;

  fillServiceSelect(service, params.get('service'));
  setChecked(form, 'tariff', params.get('tariff'));
  setChecked(form, 'urgency', params.get('urgency'));
  if (params.get('minutes')) minutes.value = params.get('minutes');

  /* Промокод */
  const promoInput = $('#order-promo');
  const promoStatus = $('#order-promo-status');
  let promoPercent = 0;

  const applyPromo = () => {
    const code = promoInput.value.trim().toUpperCase();
    promoPercent = PROMO_CODES[code] || 0;
    if (!code) promoStatus.textContent = '';
    else if (promoPercent) promoStatus.textContent = `Промокод применён: скидка ${promoPercent}%`;
    else promoStatus.textContent = 'Такого промокода нет';
    promoStatus.classList.toggle('promo__status--error', Boolean(code) && !promoPercent);
    renderSummary();
  };

  $('#order-promo-apply').addEventListener('click', applyPromo);
  /* Enter в поле промокода применяет его, а не отправляет форму */
  promoInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      applyPromo();
    }
  });

  /* Сводка заказа справа от формы */
  const renderSummary = () => {
    const hasService = Boolean(findService(service.value));
    const valid = hasService && minutes.value !== '' && minutes.checkValidity();
    const result = calcOrder({
      serviceId: service.value,
      minutes: valid ? minutes.value : 0,
      tariffId: $('input[name="tariff"]:checked', form).value,
      urgencyId: $('input[name="urgency"]:checked', form).value,
      promoPercent
    });
    $('#summary-promo').textContent = promoPercent ? `−${promoPercent}%` : 'нет';
    $('#summary-service').textContent = hasService ? result.service.title : 'не выбрана';
    $('#summary-tariff').textContent = `${result.tariff.title}, ${result.urgency.title.toLowerCase()} срочность`;
    $('#summary-minutes').textContent = valid ? `${formatNumber(result.minutes)} мин` : 'не указана';
    $('#summary-rate').textContent = hasService ? formatRate(result.rate) : '—';
    $('#summary-discount').textContent = result.discountPercent ? `−${result.discountPercent}%` : 'нет';
    $('#summary-deadline').textContent = hasService ? formatDeadline(result.hours) : '—';
    $('#summary-total').textContent = valid ? formatPrice(result.total) : '—';
  };

  /* Файл: проверка формата и размера, длительность из метаданных */
  const checkSource = () => {
    const file = fileInput.files[0];
    let message = '';
    if (!file && linkInput.value.trim() === '') {
      message = 'Прикрепите файл или укажите ссылку на него';
    } else if (file) {
      const extension = file.name.split('.').pop().toLowerCase();
      if (!FILE_RULES.extensions.includes(extension)) {
        message = `Формат .${extension} не поддерживается. Нужен аудио- или видеофайл: MP3, WAV, M4A, MP4, MOV и др.`;
      } else if (file.size > FILE_RULES.maxBytes) {
        message = `Файл весит ${formatFileSize(file.size)}, а принимаем до 2 ГБ. Пришлите ссылку на облако.`;
      }
    }
    fileInput.setCustomValidity(message);
    return message;
  };

  const detectDuration = (file) => {
    const media = document.createElement(file.type.startsWith('video') ? 'video' : 'audio');
    const url = URL.createObjectURL(file);
    const done = () => URL.revokeObjectURL(url);
    media.preload = 'metadata';
    media.addEventListener('loadedmetadata', () => {
      done();
      if (!Number.isFinite(media.duration) || media.duration <= 0) return;
      const total = Math.round(media.duration);
      minutes.value = String(Math.max(1, Math.ceil(total / 60)));
      durationHint.textContent =
        `Определено по файлу: ${Math.floor(total / 60)} мин ${total % 60} с. Округляем до целой минуты вверх.`;
      validateField(form, minutes);
      renderSummary();
    });
    media.addEventListener('error', () => {
      done();
      durationHint.textContent = 'Не получилось определить длительность по файлу — укажите её вручную.';
    });
    media.src = url;
  };

  const showFile = () => {
    const file = fileInput.files[0];
    dropzone.classList.toggle('dropzone--filled', Boolean(file));
    durationHint.textContent = defaultHint;
    if (!file) {
      fileInfo.hidden = true;
      return;
    }
    fileInfo.hidden = false;
    $('#order-file-name').textContent = file.name;
    $('#order-file-size').textContent = formatFileSize(file.size);
    if (!checkSource()) detectDuration(file);
  };

  fileInput.addEventListener('change', () => {
    showFile();
    validateField(form, fileInput);
  });

  linkInput.addEventListener('input', () => {
    checkSource();
    if (fileInput.getAttribute('aria-invalid') === 'true') validateField(form, fileInput);
  });

  $('#order-file-clear').addEventListener('click', () => {
    fileInput.value = '';
    showFile();
    checkSource();
    fileInput.focus();
  });

  ['dragenter', 'dragover'].forEach((type) => {
    dropzone.addEventListener(type, (event) => {
      event.preventDefault();
      dropzone.classList.add('dropzone--active');
    });
  });
  ['dragleave', 'drop'].forEach((type) => {
    dropzone.addEventListener(type, () => dropzone.classList.remove('dropzone--active'));
  });
  dropzone.addEventListener('drop', (event) => {
    event.preventDefault();
    if (event.dataTransfer.files.length) {
      fileInput.files = event.dataTransfer.files;
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });

  /* Отправка: проверка и окно подтверждения */
  const dialog = $('#order-dialog');

  form.addEventListener('input', renderSummary);
  form.addEventListener('change', renderSummary);
  enableLiveValidation(form);

  /* «Очистить форму»: значения сбрасывает браузер, остальное — после него */
  form.addEventListener('reset', () => {
    window.setTimeout(() => {
      fileInput.setCustomValidity('');
      resetErrors(form);
      $('#order-form-status').textContent = '';
      promoPercent = 0;
      promoStatus.textContent = '';
      showFile();
      renderSummary();
    });
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    checkSource();
    if (!validateForm(form)) {
      $('#order-form-status').textContent = 'Форма заполнена не полностью — проверьте отмеченные поля.';
      return;
    }
    $('#order-form-status').textContent = '';

    const result = calcOrder({
      serviceId: service.value,
      minutes: minutes.value,
      tariffId: $('input[name="tariff"]:checked', form).value,
      urgencyId: $('input[name="urgency"]:checked', form).value,
      promoPercent
    });
    const number = `СТ-${String(Date.now()).slice(-6)}`;

    /* Сохраняем заказ, чтобы потом проверить его статус */
    const orders = storage.read(ORDERS_KEY, []);
    orders.push({
      number,
      service: result.service.title,
      total: result.total,
      createdAt: new Date().toISOString(),
      readyAt: result.readyAt.toISOString()
    });
    storage.write(ORDERS_KEY, orders);
    $('#dialog-number').textContent = number;
    $('#dialog-name').textContent = $('#order-name').value.trim();
    $('#dialog-email').textContent = $('#order-email').value.trim();
    $('#dialog-service').textContent = result.service.title;
    $('#dialog-total').textContent = formatPrice(result.total);
    $('#dialog-ready').textContent = formatDateTime(result.readyAt);

    form.reset();
    fileInput.setCustomValidity('');
    resetErrors(form);
    showFile();
    renderSummary();

    if (typeof dialog.showModal === 'function') {
      dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  });

  $$('[data-dialog-close]', dialog).forEach((button) => {
    button.addEventListener('click', () => dialog.close());
  });
  /* Клик по затемнению вокруг окна тоже закрывает его */
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener('close', () => $('#order-name').focus());

  renderSummary();
}

/* ---------- Статус заказа ---------- */

const ORDERS_KEY = 'stenograf:orders';

function initOrderStatus() {
  const form = $('#status-form');
  if (!form) return;
  const input = $('#status-number');
  const result = $('#status-result');

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    /* Сравниваем только цифры: «СТ-123456», «ст 123456» и «123456» — один заказ */
    const digits = input.value.replace(/\D/g, '');
    const orders = [DEMO_ORDER, ...storage.read(ORDERS_KEY, [])];
    const order = orders.find((item) => digits && item.number.replace(/\D/g, '') === digits);

    if (!order) {
      result.innerHTML = '<p class="status__error">Заказ с таким номером не найден. Проверьте номер из письма.</p>';
      return;
    }

    const created = new Date(order.createdAt);
    const ready = new Date(order.readyAt);
    const progress = (Date.now() - created) / (ready - created);
    const current = ORDER_STAGES.findIndex((stage) => progress < stage.until);
    const finished = current === ORDER_STAGES.length - 1;

    const steps = ORDER_STAGES.map((stage, index) => {
      let modifier = '';
      if (index < current || finished) modifier = ' status__step--done';
      else if (index === current) modifier = ' status__step--current';
      return `<li class="status__step${modifier}"${index === current ? ' aria-current="step"' : ''}>${stage.title}</li>`;
    }).join('');

    result.innerHTML = `
      <h3 class="status__title">Заказ ${escapeHtml(order.number)}</h3>
      <p class="muted">${escapeHtml(order.service)}, ${formatPrice(order.total)}</p>
      <ol class="status__steps">${steps}</ol>
      <p>Срок готовности: <strong>${formatDateTime(ready)}</strong></p>`;
  });
}

/* ---------- Тёмная тема ---------- */

const THEME_KEY = 'stenograf-theme';

function initTheme() {
  const header = $('.site-header__inner');
  if (!header) return;
  const root = document.documentElement;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'theme-toggle';
  button.innerHTML = `
    <svg class="theme-toggle__moon" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/></svg>
    <svg class="theme-toggle__sun" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>
    <span class="visually-hidden">Тёмная тема</span>`;

  const update = () => button.setAttribute('aria-pressed', String(root.dataset.theme === 'dark'));

  const switchTheme = () => {
    root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
    try {
      localStorage.setItem(THEME_KEY, root.dataset.theme);
    } catch (error) {
      /* Хранилище недоступно — тема просто не запомнится */
    }
    update();
  };

  button.addEventListener('click', () => {
    /* Плавный «наплыв» старой темы в новую, если браузер это умеет */
    if (document.startViewTransition) document.startViewTransition(switchTheme);
    else switchTheme();
  });

  header.insertBefore(button, $('.site-header__toggle', header));
  update();
}

/* ---------- Чат с поддержкой ---------- */

function initChat() {
  const chat = document.createElement('div');
  chat.className = 'chat';
  chat.innerHTML = `
    <section class="chat__panel" id="chat-panel" aria-label="Чат с поддержкой" hidden>
      <div class="chat__head">
        <div>
          <p class="chat__title">Поддержка «Стенографа»</p>
          <p class="chat__subtitle">Обычно отвечаем за пару минут</p>
        </div>
        <button class="chat__close" type="button" aria-label="Закрыть чат">×</button>
      </div>
      <div class="chat__messages" role="log" aria-live="polite"></div>
      <div class="chat__quick">
        <button class="chat__chip" type="button">Сколько стоит?</button>
        <button class="chat__chip" type="button">Какие сроки?</button>
        <button class="chat__chip" type="button">Какие форматы?</button>
      </div>
      <form class="chat__form">
        <input class="chat__input" type="text" name="message" maxlength="300" autocomplete="off"
               placeholder="Напишите вопрос" aria-label="Ваш вопрос">
        <button class="chat__send" type="submit" aria-label="Отправить">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
        </button>
      </form>
    </section>
    <button class="chat__toggle" type="button" aria-expanded="false" aria-controls="chat-panel">
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z"/></svg>
      <span class="visually-hidden">Чат с поддержкой</span>
    </button>`;
  document.body.appendChild(chat);

  const panel = $('.chat__panel', chat);
  const toggle = $('.chat__toggle', chat);
  const messages = $('.chat__messages', chat);
  const form = $('.chat__form', chat);
  const input = $('.chat__input', chat);

  const addMessage = (text, from) => {
    const message = document.createElement('p');
    message.className = `chat__message chat__message--${from}`;
    message.textContent = text;
    messages.appendChild(message);
    messages.scrollTop = messages.scrollHeight;
  };

  /* Бот ищет в вопросе ключевые слова и отвечает готовым текстом */
  const answer = (question) => {
    const text = normalize(question);
    const found = CHAT_ANSWERS.find((item) => item.words.some((word) => text.includes(normalize(word))));
    if (found) return found.text;
    return 'Спасибо за вопрос! Оператор подключится в течение 5 минут. Можно также позвонить: +7 (495) 123-45-67.';
  };

  const ask = (question) => {
    addMessage(question, 'user');
    window.setTimeout(() => addMessage(answer(question), 'bot'), 600);
  };

  const setOpen = (open) => {
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    if (open && !messages.children.length) {
      addMessage('Здравствуйте! Я помогу с ценами, сроками и форматами файлов. Что вас интересует?', 'bot');
    }
    if (open) input.focus();
  };

  toggle.addEventListener('click', () => setOpen(panel.hidden));
  $('.chat__close', chat).addEventListener('click', () => {
    setOpen(false);
    toggle.focus();
  });
  chat.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !panel.hidden) {
      setOpen(false);
      toggle.focus();
    }
  });

  $$('.chat__chip', chat).forEach((chip) => {
    chip.addEventListener('click', () => ask(chip.textContent));
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const question = input.value.trim();
    if (!question) return;
    input.value = '';
    ask(question);
  });
}

/* ---------- Форма обратной связи ---------- */

function initFeedbackForm() {
  const form = $('#feedback-form');
  if (!form) return;
  const success = $('#feedback-success');

  enableLiveValidation(form);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!validateForm(form)) return;
    const name = $('#feedback-name').value.trim();
    const email = $('#feedback-email').value.trim();
    success.textContent = `Спасибо, ${name}! Сообщение отправлено — ответим на ${email} в течение рабочего дня.`;
    success.hidden = false;
    form.reset();
    resetErrors(form);
  });
}

/* ---------- Отзывы и оценки ---------- */

const REVIEWS_KEY = 'stenograf:reviews';
const REVIEWS_VISIBLE = 4;

function initReviews() {
  const list = $('#reviews-list');
  if (!list) return;

  const form = $('#review-form');
  const more = $('#reviews-more');
  const status = $('#review-status');
  let expanded = false;

  fillServiceSelect($('#review-service'));

  const allReviews = () => [...storage.read(REVIEWS_KEY, []), ...REVIEWS]
    .filter((review) => review && Number(review.rating) >= 1 && Number(review.rating) <= 5)
    .map((review) => ({ ...review, rating: Number(review.rating) }));

  const reviewHtml = (review) => {
    const service = findService(review.service);
    return `
      <li class="reviews__item">
        <article class="review-card">
          <header class="review-card__header">
            <h3 class="review-card__name">${escapeHtml(review.name)}</h3>
            <p class="review-card__role">${escapeHtml(review.role)}</p>
            ${ratingHtml(review.rating)}
          </header>
          <p class="review-card__text">${escapeHtml(review.text)}</p>
          <footer class="review-card__footer">
            ${service ? `<a href="product.html?id=${service.id}">${escapeHtml(service.title)}</a>` : ''}
            <time datetime="${escapeHtml(review.date)}">${escapeHtml(formatDate(review.date))}</time>
          </footer>
        </article>
      </li>`;
  };

  const render = () => {
    const reviews = allReviews();
    const shown = expanded ? reviews : reviews.slice(0, REVIEWS_VISIBLE);
    list.innerHTML = shown.map(reviewHtml).join('');

    const total = reviews.length;
    const average = reviews.reduce((sum, review) => sum + review.rating, 0) / total;
    $('#reviews-average').textContent = formatNumber(average, 1);
    $('#reviews-average-stars').innerHTML = ratingHtml(Math.round(average * 10) / 10);
    $('#reviews-total').textContent = `${total} ${plural(total, ['отзыв', 'отзыва', 'отзывов'])}`;

    $('#reviews-bars').innerHTML = [5, 4, 3, 2, 1].map((stars) => {
      const amount = reviews.filter((review) => review.rating === stars).length;
      const percent = Math.round((amount / total) * 100);
      return `
        <li class="rating-bars__item">
          <span class="rating-bars__label">${stars} ★<span class="visually-hidden"> — ${amount} ${plural(amount, ['отзыв', 'отзыва', 'отзывов'])}</span></span>
          <span class="rating-bars__track" aria-hidden="true"><span class="rating-bars__fill" style="width: ${percent}%"></span></span>
          <span class="rating-bars__count" aria-hidden="true">${amount}</span>
        </li>`;
    }).join('');

    more.hidden = total <= REVIEWS_VISIBLE;
    more.textContent = expanded ? 'Свернуть отзывы' : `Показать все отзывы (${total})`;
    more.setAttribute('aria-expanded', String(expanded));
  };

  more.addEventListener('click', () => {
    expanded = !expanded;
    render();
  });

  enableLiveValidation(form);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    status.textContent = '';
    if (!validateForm(form)) return;

    const review = {
      name: $('#review-name').value.trim(),
      role: 'клиент сервиса',
      service: $('#review-service').value,
      rating: Number($('input[name="rating"]:checked', form).value),
      date: new Date().toISOString().slice(0, 10),
      text: $('#review-text').value.trim()
    };
    storage.write(REVIEWS_KEY, [review, ...storage.read(REVIEWS_KEY, [])]);
    form.reset();
    resetErrors(form);
    render();
    status.textContent = 'Спасибо! Ваш отзыв опубликован первым в списке.';
  });

  render();
}

/* ---------- Примеры работ ---------- */

function initExamples() {
  const container = $('#examples');
  if (!container) return;

  const buttons = $$('[data-filter]');
  const items = $$('[data-category]', container);
  const status = $('#examples-status');

  buttons.forEach((button) => {
    button.addEventListener('click', () => {
      const filter = button.dataset.filter;
      buttons.forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
      let visible = 0;
      items.forEach((item) => {
        const show = filter === 'all' || item.dataset.category === filter;
        item.hidden = !show;
        if (show) visible += 1;
      });
      status.textContent = `Показано ${visible} ${plural(visible, ['пример', 'примера', 'примеров'])}`;
    });
  });

  const timecodes = $('#toggle-timecodes');
  timecodes.addEventListener('change', () => {
    container.classList.toggle('examples--no-time', !timecodes.checked);
  });
}

/* ---------- Запуск ---------- */

document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initNavigation();
  initBackToTop();
  initChat();
  initYear();
  initPopular();
  initCatalog();
  initServicePage();
  initCalculator();
  initOrderForm();
  initOrderStatus();
  initFeedbackForm();
  initReviews();
  initExamples();
});
