// ==========================================
// SERVICE WORKER
// Загружает график из Google Sheets, считает статус дежурства,
// кеширует CSV и отвечает content-скрипту и popup'у.
// ==========================================
importScripts('lib/duty.js');

const CACHE_TTL_MS = 10 * 60 * 1000;
const DISCOVERY_TTL_MS = 6 * 60 * 60 * 1000;
const REFRESH_ALARM = 'duty:refresh';
const REFRESH_PERIOD_MIN = 1;
const SETTINGS_KEY = 'dutySettings';
const SHEETS_KEY = 'dutySheets';
const DISCOVERY_KEY = 'dutyDiscovery';
const SHOWN_KEY = 'dutyOverlayShownOn';
const ALERT_SHOWN_KEY = 'dutyOverlayAlertShownOn';
const SOURCE_KEY = 'dutySource';
const LIVE_STATUS_KEY = 'dutyLiveStatus';

let claimQueue = Promise.resolve();

const Duty = globalThis.Duty;

// ==========================================
// НАСТРОЙКИ
// ==========================================

function normalizeSettings(raw) {
  const value = raw || {};
  return {
    fullName: String(value.fullName || '').replace(/\s+/g, ' ').trim(),
    group: String(value.group || '').replace(/\s+/g, ' ').trim(),
  };
}

// ==========================================
// ОДИН ПОКАЗ ПЛАШКИ В ДЕНЬ
// ==========================================

function todayKey() {
  const d = new Date();
  return (
    d.getFullYear() +
    '-' +
    String(d.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(d.getDate()).padStart(2, '0')
  );
}

/**
 * Выдаёт право развернуть карточку один раз в календарный день.
 * key — отдельная отметка для дежурства и для предупреждений.
 * Очередь защищает от одновременных запросов из нескольких вкладок.
 */
function claimDailyShow(key = SHOWN_KEY) {
  const run = async () => {
    const today = todayKey();
    const stored = await chrome.storage.local.get(key);

    if (stored[key] === today) return { show: false, day: today };

    await chrome.storage.local.set({ [key]: today });
    return { show: true, day: today };
  };

  const result = claimQueue.then(run, run);
  claimQueue = result.then(
    () => {},
    () => {}
  );
  return result;
}

// ==========================================
// ИСТОЧНИК ГРАФИКА
// ==========================================

function normalizeSource(raw) {
  if (!raw) return null;

  const value = typeof raw === 'string' ? raw : raw.url;
  const parsed = Duty.parseSheetUrl(value);
  if (parsed) return parsed;

  if (raw && typeof raw === 'object' && raw.docId) {
    const docId = String(raw.docId).trim();
    const gid = String(raw.gid == null ? '' : raw.gid).trim();

    if (/^[A-Za-z0-9_-]+$/.test(docId) && (!gid || /^\d+$/.test(gid))) {
      return { docId, gid, url: Duty.buildSheetUrl(docId, gid) };
    }
  }

  return null;
}

async function readSource() {
  try {
    const data = await chrome.storage.sync.get(SOURCE_KEY);
    if (data[SOURCE_KEY]) {
      const parsed = normalizeSource(data[SOURCE_KEY]);
      if (parsed) return parsed;
    }
  } catch {
    /* sync может быть недоступен */
  }

  try {
    const data = await chrome.storage.local.get(SOURCE_KEY);
    return normalizeSource(data[SOURCE_KEY]);
  } catch {
    return null;
  }
}

async function readSettings() {
  try {
    const data = await chrome.storage.sync.get(SETTINGS_KEY);
    return normalizeSettings(data[SETTINGS_KEY]);
  } catch {
    const data = await chrome.storage.local.get(SETTINGS_KEY);
    return normalizeSettings(data[SETTINGS_KEY]);
  }
}

// ==========================================
// ЗАГРУЗКА ТАБЛИЦЫ
// ==========================================

function accessError(message) {
  const err = new Error(message || 'ACCESS_REQUIRED');
  err.code = 'access';
  return err;
}

function isLoginResponse(response, text) {
  const url = String((response && response.url) || '');
  if (/^https:\/\/accounts\.google\.com\//i.test(url) || /\/ServiceLogin\b/i.test(url)) return true;

  const type =
    response && response.headers && typeof response.headers.get === 'function'
      ? String(response.headers.get('content-type') || '')
      : '';

  // Google может отдать страницу входа с кодом 200. CSV-экспорт
  // при этом имеет тип text/csv, поэтому HTML здесь — точно не график.
  if (/text\/html/i.test(type)) return true;
  return /^\s*<!doctype\s+html|<html[\s>]/i.test(String(text || '').slice(0, 200));
}

async function downloadCsv(source, gid) {
  const base = 'https://docs.google.com/spreadsheets/d/' + source.docId;
  const sheet = gid ? '&gid=' + encodeURIComponent(gid) : '';
  const urls = [base + '/export?format=csv' + sheet, base + '/gviz/tq?tqx=out:csv' + sheet];
  const errors = [];
  let lastError = null;

  for (const url of urls) {
    try {
      // host_permissions включает accounts.google.com: если таблица закрыта,
      // Google уводит на страницу входа. Без этого разрешения такой редирект
      // даёт CORS-ошибку в журнале расширения.
      const response = await fetch(url, { cache: 'no-store', credentials: 'omit', redirect: 'follow' });
      const text = await response.text();

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          throw accessError('HTTP ' + response.status);
        }
        throw new Error('HTTP ' + response.status);
      }

      if (isLoginResponse(response, text)) {
        throw accessError('ACCESS_LOGIN');
      }

      if (!text.trim()) throw new Error('Пустой ответ');

      return { text, url, gid };
    } catch (err) {
      // Это не проблема второго способа загрузки: доступа нет ко всей таблице.
      if (err && err.code === 'access') throw err;
      if (/HTTP 40[13]/.test(String(err && err.message))) {
        throw accessError(String(err.message));
      }

      errors.push(err);
      lastError = err;
    }
  }

  throw lastError || new Error('Не удалось загрузить таблицу');
}

async function readSheetCache() {
  const data = await chrome.storage.local.get(SHEETS_KEY);
  return data[SHEETS_KEY] && typeof data[SHEETS_KEY] === 'object' ? data[SHEETS_KEY] : {};
}

async function writeSheetCache(gid, entry) {
  const cache = await readSheetCache();
  cache[gid] = entry;

  // храним только несколько последних листов
  const keep = Object.keys(cache)
    .sort((a, b) => (cache[b].ts || 0) - (cache[a].ts || 0))
    .slice(0, 6);
  const next = {};
  for (const key of keep) next[key] = cache[key];

  await chrome.storage.local.set({ [SHEETS_KEY]: next });
}

async function removeSheetCache(gid) {
  const cache = await readSheetCache();
  if (!(gid in cache)) return;

  delete cache[gid];
  await chrome.storage.local.set({ [SHEETS_KEY]: cache });
}

async function loadSheet(source, gid, { force = false } = {}) {
  const cache = await readSheetCache();
  const cached = cache[gid];
  const sameDoc = Boolean(cached && cached.docId === source.docId);

  if (!force && sameDoc && Date.now() - cached.ts < CACHE_TTL_MS) return cached;

  // Кеш нужен только для повторных запросов в пределах TTL.
  // Если свежие данные получить не удалось, не подменяем их старым
  // результатом: пользователь должен увидеть актуальную ошибку.
  try {
    const data = await downloadCsv(source, gid);
    const entry = { ...data, docId: source.docId, ts: Date.now() };
    await writeSheetCache(gid, entry);
    return entry;
  } catch (err) {
    // Не оставляем старый лист «жить» в кеше после неудачной проверки.
    await removeSheetCache(gid).catch(() => {});
    throw err;
  }
}

/** Другие листы той же таблицы (на случай, если неделя в другом месяце). */
async function discoverGids(source, { force = false } = {}) {
  const cached = (await chrome.storage.local.get(DISCOVERY_KEY))[DISCOVERY_KEY];
  const sameDoc = Boolean(cached && cached.docId === source.docId);

  if (!force && sameDoc && Date.now() - cached.ts < DISCOVERY_TTL_MS) return cached.gids;

  const base = 'https://docs.google.com/spreadsheets/d/' + source.docId;

  try {
    const response = await fetch(base + '/htmlview', { cache: 'no-store', credentials: 'omit' });
    const html = await response.text();

    if (!response.ok) throw new Error('HTTP ' + response.status);
    if (isLoginResponse(response, html)) throw accessError('ACCESS_LOGIN');

    const found = Array.from(html.matchAll(/gid:\s*"(\d+)"/g)).map((m) => m[1]);
    const gids = Array.from(new Set([...(source.gid ? [source.gid] : []), ...found]));
    await chrome.storage.local.set({ [DISCOVERY_KEY]: { docId: source.docId, gids, ts: Date.now() } });
    return gids;
  } catch (err) {
    // Если список вкладок не обновился, пробуем сохранённый
    if (sameDoc && Array.isArray(cached.gids)) return cached.gids;
    throw err;
  }
}

// ==========================================
// СТАТУС
// ==========================================

function classifyError(err) {
  const message = String((err && err.message) || err || '');

  if ((err && err.code === 'access') || /ACCESS_LOGIN|HTTP 40[13]/.test(message)) {
    return {
      kind: 'access',
      message: 'Нет доступа к таблице. Откройте доступ «всем, у кого есть ссылка» или проверьте ссылку.',
    };
  }

  if (/HTTP 404/.test(message)) {
    return {
      kind: 'not-found',
      message: 'Таблица не найдена: возможно, файл удалили или перенесли.',
    };
  }

  if (/HTTP 400/.test(message)) {
    return {
      kind: 'bad-request',
      message: 'Google не отдал таблицу (HTTP 400). Возможно, файл удалили или ссылка устарела.',
    };
  }

  if (/Failed to fetch|NetworkError|network/i.test(message)) {
    return {
      kind: 'network',
      message: 'Нет связи с Google Sheets. Проверьте интернет.',
    };
  }

  if (/Пустой ответ|пуст(ая|ой|о)|empty/i.test(message)) {
    return {
      kind: 'empty',
      message: 'В таблице нет данных: все ячейки пустые.',
    };
  }

  return { kind: 'unknown', message: message || 'Не удалось загрузить график' };
}

function buildStatus(analysis, sheet, source) {
  return {
    ok: true,
    status: !analysis.configured
      ? 'unconfigured'
      : !analysis.week
        ? 'no-week'
        : analysis.reason === 'unfilled'
          ? 'unfilled'
          : analysis.onDuty
            ? 'on'
            : 'off',
    configured: analysis.configured,
    settings: analysis.settings,
    week: analysis.week,
    weeks: analysis.weeks,
    groups: analysis.groups,
    onDuty: analysis.onDuty,
    todayDuty: analysis.todayDuty,
    matches: analysis.matches,
    groupEntry: analysis.groupEntry,
    emptyGroups: analysis.emptyGroups || [],
    reason: analysis.reason,
    sheetUrl: source.url,
    updatedAt: sheet.ts || Date.now(),
    error: null,
  };
}

/**
 * Публикуем свежий статус в storage.local. Content-скрипты слушают это
 * изменение и обновляют плашку без перезагрузки страницы.
 */
async function publishStatus(status) {
  try {
    await chrome.storage.local.set({
      [LIVE_STATUS_KEY]: { ...status, revision: Date.now() },
    });
  } catch {
    /* storage может быть временно недоступен */
  }
}

async function getStatus({ force = false } = {}) {
  const [settings, source] = await Promise.all([readSettings(), readSource()]);

  // Ссылку на график пользователь указывает сам при первом запуске.
  // Встроенного адреса нет: без ссылки просто просим её добавить.
  if (!source) {
    const configured = Boolean(settings.fullName && settings.group);
    const status = {
      ok: true,
      status: configured ? 'no-source' : 'unconfigured',
      configured,
      settings,
      week: null,
      weeks: [],
      groups: [],
      onDuty: false,
      todayDuty: false,
      matches: [],
      groupEntry: null,
      emptyGroups: [],
      reason: configured ? 'no-source' : 'unconfigured',
      sheetUrl: '',
      updatedAt: 0,
      error: null,
    };

    await publishStatus(status);
    await updateBadge(status);
    return status;
  }

  const now = new Date();

  let sheet = null;
  let analysis = null;
  let lastError = null;

  try {
    sheet = await loadSheet(source, source.gid, { force });
    analysis = Duty.analyze(sheet.text, settings, now);
  } catch (err) {
    lastError = err;
  }

  // Если основной лист загрузился, но в нём нет текущей недели — ищем
  // её по другим вкладкам. При ошибке доступа вкладки не перебираем:
  // это только повторяло бы тот же отказ и засоряло журнал расширения.
  if (analysis && !analysis.week) {
    let gids = [];
    try {
      gids = await discoverGids(source, { force: force || !analysis });
    } catch {
      gids = [];
    }

    for (const gid of gids) {
      if (gid === source.gid) continue;

      try {
        const other = await loadSheet(source, gid);
        const otherAnalysis = Duty.analyze(other.text, settings, now);

        if (!analysis) {
          sheet = other;
          analysis = otherAnalysis;
        }

        if (otherAnalysis.week) {
          sheet = other;
          analysis = otherAnalysis;
          break;
        }
      } catch {
        /* лист недоступен — пропускаем */
      }
    }
  }

  if (!analysis) {
    const failure = classifyError(lastError);
    const failed = {
      ok: false,
      status: 'error',
      error: failure.message,
      errorKind: failure.kind,
      configured: Boolean(settings.fullName),
      settings,
      week: null,
      groups: [],
      matches: [],
      sheetUrl: source.url,
      updatedAt: 0,
    };

    await publishStatus(failed);
    await updateBadge(failed);
    return failed;
  }

  // Пустая таблица — это не «нет текущей недели» и не повод показывать
  // прошлый результат. Статус должен явно говорить, что данных нет.
  if (!analysis.hasContent) {
    const failure = lastError
      ? classifyError(lastError)
      : { kind: 'empty', message: 'В таблице нет данных: все ячейки пустые.' };
    const failed = {
      ok: false,
      status: 'error',
      error: failure.message,
      errorKind: failure.kind,
      configured: Boolean(settings.fullName),
      settings,
      week: null,
      groups: [],
      matches: [],
      sheetUrl: source.url,
      updatedAt: 0,
    };

    await publishStatus(failed);
    await updateBadge(failed);
    return failed;
  }

  const status = buildStatus(analysis, sheet, source);
  await publishStatus(status);
  await updateBadge(status);
  return status;
}

// ==========================================
// ИКОНКА НА ПАНЕЛИ
// ==========================================

async function updateBadge(status) {
  try {
    if (status && status.configured === false) {
      await chrome.action.setBadgeText({ text: '' });
      await chrome.action.setTitle({ title: 'Дежурства — заполните ФИО и группу' });
      return;
    }

    if (status && status.status === 'no-source') {
      await chrome.action.setBadgeText({ text: '' });
      await chrome.action.setTitle({ title: 'Дежурства — укажите ссылку на график' });
      return;
    }

    if (status && status.status === 'error') {
      await chrome.action.setBadgeBackgroundColor({ color: '#D92D20' });
      await chrome.action.setBadgeText({ text: '?' });
      const prefix = status.errorKind === 'empty' ? 'В графике дежурств нет данных' : 'График дежурств недоступен';
      await chrome.action.setTitle({
        title: prefix + ': ' + (status.error || 'не удалось загрузить таблицу'),
      });
      return;
    }

    if (status && status.status === 'unfilled') {
      await chrome.action.setBadgeBackgroundColor({ color: '#D92D20' });
      await chrome.action.setBadgeText({ text: '?' });
      const week = status.week ? ' · ' + status.week.label : '';
      await chrome.action.setTitle({
        title: 'В расписании не заполнен дежурный' + week,
      });
      return;
    }

    if (status && status.status === 'no-week') {
      await chrome.action.setBadgeBackgroundColor({ color: '#B54708' });
      await chrome.action.setBadgeText({ text: '?' });
      await chrome.action.setTitle({ title: 'В графике дежурств нет текущей недели' });
      return;
    }

    if (status && status.ok && status.status === 'on') {
      await chrome.action.setBadgeBackgroundColor({ color: '#E8590C' });
      await chrome.action.setBadgeText({ text: '!' });
      const week = status.week ? ' · ' + status.week.label : '';
      await chrome.action.setTitle({ title: 'Вы дежурный на этой неделе' + week });
      return;
    }

    await chrome.action.setBadgeText({ text: '' });
    if (status && status.ok && status.status === 'off') {
      const week = status.week ? ' · ' + status.week.label : '';
      await chrome.action.setTitle({ title: 'Вы не дежурный на этой неделе' + week });
    } else {
      await chrome.action.setTitle({ title: 'Дежурства — нажмите, чтобы настроить' });
    }
  } catch {
    /* иконка могла быть недоступна */
  }
}

// ==========================================
// СОБЫТИЯ
// ==========================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== 'object') return false;

  if (message.type === 'duty:getStatus') {
    getStatus({ force: Boolean(message.force) })
      .then(sendResponse)
      .catch(async (err) => {
        const failure = classifyError(err);
        const failed = {
          ok: false,
          status: 'error',
          error: failure.message,
          errorKind: failure.kind,
          settings: {},
          matches: [],
          groups: [],
          sheetUrl: '',
        };
        await publishStatus(failed);
        sendResponse(failed);
      });
    return true;
  }

  if (message.type === 'duty:claimDaily') {
    claimDailyShow(SHOWN_KEY)
      .then(sendResponse)
      .catch(() => sendResponse({ show: false }));
    return true;
  }

  if (message.type === 'duty:claimAlert') {
    claimDailyShow(ALERT_SHOWN_KEY)
      .then(sendResponse)
      .catch(() => sendResponse({ show: false }));
    return true;
  }

  if (message.type === 'duty:openSettings') {
    openSettings().then(sendResponse);
    return true;
  }

  return false;
});async function openSettings() {
  try {
    if (chrome.action && typeof chrome.action.openPopup === 'function') {
      await chrome.action.openPopup();
      return { ok: true, via: 'popup' };
    }
  } catch {
    /* нужен жест пользователя — откроем вкладку */
  }

  try {
    await chrome.tabs.create({ url: chrome.runtime.getURL('popup.html') });
    return { ok: true, via: 'tab' };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

async function refreshBadge() {
  try {
    // Иконка не должна показывать устаревший статус после очистки графика.
    await getStatus({ force: true });
  } catch {
    /* тихо: иконка обновится при следующем запросе */
  }
}

async function ensureRefreshAlarm() {
  try {
    const alarm = await chrome.alarms.get(REFRESH_ALARM);
    if (!alarm || alarm.periodInMinutes !== REFRESH_PERIOD_MIN) {
      chrome.alarms.create(REFRESH_ALARM, { periodInMinutes: REFRESH_PERIOD_MIN });
    }
  } catch {
    chrome.alarms.create(REFRESH_ALARM, { periodInMinutes: REFRESH_PERIOD_MIN });
  }
}

ensureRefreshAlarm();

chrome.runtime.onInstalled.addListener((details) => {
  chrome.alarms.create(REFRESH_ALARM, { periodInMinutes: REFRESH_PERIOD_MIN });

  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('popup.html') });
  } else {
    refreshBadge();
  }
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(REFRESH_ALARM, { periodInMinutes: REFRESH_PERIOD_MIN });
  refreshBadge();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === REFRESH_ALARM) refreshBadge();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (changes[SETTINGS_KEY] || changes[SOURCE_KEY]) refreshBadge();
});
