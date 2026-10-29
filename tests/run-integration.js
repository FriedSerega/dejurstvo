(async () => {
  'use strict';

  const demo = window.__demo;
  const results = [];

  async function test(name, fn) {
    try {
      const detail = await fn();
      results.push({ name, ok: true, detail: detail || '' });
    } catch (err) {
      results.push({ name, ok: false, detail: err && err.message ? err.message : String(err) });
    }
  }

  function assert(cond, message) {
    if (!cond) throw new Error(message || 'Условие не выполнено');
  }

  function eq(actual, expected, message) {
    if (actual !== expected) {
      throw new Error((message ? message + ': ' : '') + 'получено ' + JSON.stringify(actual) + ', ожидалось ' + JSON.stringify(expected));
    }
  }

  const getStatus = (force) => chrome.runtime.sendMessage({ type: 'duty:getStatus', force: Boolean(force) });
  const setSettings = (fullName, group) => chrome.storage.sync.set({ dutySettings: { fullName, group } });
  const setLocal = (values) => chrome.storage.local.set(values);

  async function resetCaches() {
    await setLocal({ dutySheets: {}, dutyDiscovery: undefined });
  }

  await test('Статус: дежурный на текущей неделе', async () => {
    await setSettings('Полунин Иван', 'Оператор связи');
    const status = await getStatus(true);

    eq(status.ok, true);
    eq(status.status, 'on');
    eq(status.week.label, '26.10–01.11');
    eq(status.todayDuty, true);
    eq(status.matches[0].group, 'Оператор связи');
    eq(demo.badge.text, '!');
    return 'бейдж: ' + demo.badge.title;
  });

  await test('Статус публикуется для обновления плашек без F5', async () => {
    const status = await getStatus(true);
    const live = (await chrome.storage.local.get('dutyLiveStatus')).dutyLiveStatus;

    assert(live && typeof live === 'object', 'статус не опубликован');
    eq(live.status, status.status);
    eq(live.sheetUrl, status.sheetUrl);
    assert(Number(live.revision) > 0, 'нет ревизии статуса');
  });

  await test('Кеш: повторный запрос не скачивает CSV', async () => {
    const before = demo.fetchCount;
    const status = await getStatus(false);
    eq(status.status, 'on');
    eq(demo.fetchCount, before, 'был лишний запрос к сети');
    return 'запросов к сети: 0';
  });

  await test('Кеш: force перезагружает таблицу', async () => {
    const before = demo.fetchCount;
    await getStatus(true);
    assert(demo.fetchCount > before, 'CSV не перезапрошен');
    return 'запросов: ' + (demo.fetchCount - before);
  });

  await test('Источник: новая ссылка применяется и кеш не путается', async () => {
    await resetCaches();

    const docId = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789';
    const url = 'https://docs.google.com/spreadsheets/d/' + docId + '/edit?gid=777#gid=777';

    await chrome.storage.sync.set({ dutySource: { url } });
    const status = await getStatus(true);

    eq(status.ok, true);
    eq(status.status, 'on');
    eq(status.sheetUrl, url);
    assert(
      demo.fetchUrls.some((item) => item.includes(docId) && item.includes('gid=777')),
      'новая таблица не запрашивалась'
    );

    // Удалили ссылку — расширение не должно подставлять чужую таблицу.
    await chrome.storage.sync.remove('dutySource');
    await resetCaches();

    const beforeFetch = demo.fetchCount;
    const noSource = await getStatus(true);
    eq(noSource.status, 'no-source');
    eq(noSource.sheetUrl, '');
    eq(noSource.ok, true);
    eq(demo.fetchCount, beforeFetch, 'без ссылки не должно быть сетевых запросов');
    assert(demo.badge.title.includes('ссылку'), demo.badge.title);

    // Возвращаем тестовую ссылку для следующих проверок.
    await chrome.storage.sync.set({ dutySource: { url: demo.sourceUrl } });
    await resetCaches();

    const back = await getStatus(true);
    eq(back.sheetUrl, demo.sourceUrl);
    eq(back.status, 'on');

    return 'новая таблица: ' + docId.slice(0, 8) + '…';
  });

  await test('Сеть недоступна: старый кеш не подменяет свежие данные', async () => {
    demo.mode = 'fail';
    const status = await getStatus(true);
    demo.mode = 'normal';

    eq(status.ok, false);
    eq(status.status, 'error');
    eq(status.errorKind, 'network');
    eq(status.stale, undefined);
    eq(demo.badge.text, '?');
    assert(demo.badge.title.includes('недоступен'), demo.badge.title);
  });

  await test('Сеть недоступна без кеша: понятная ошибка', async () => {
    await resetCaches();
    demo.mode = 'fail';
    const status = await getStatus(true);
    demo.mode = 'normal';

    eq(status.ok, false);
    eq(status.status, 'error');
    eq(status.errorKind, 'network');
    assert(status.error.includes('Нет связи'), 'текст ошибки: ' + status.error);
    eq(demo.badge.text, '?');
    assert(demo.badge.title.includes('недоступен'), demo.badge.title);
    return status.error;
  });

  await test('Таблица удалена: понятная ошибка без ссылки на lib/duty.js', async () => {
    await resetCaches();
    demo.mode = '404';
    const status = await getStatus(true);
    demo.mode = 'normal';

    eq(status.ok, false);
    eq(status.status, 'error');
    eq(status.errorKind, 'not-found');
    assert(status.error.includes('перенесли'), 'текст ошибки: ' + status.error);
    assert(!status.error.includes('lib/duty.js'), 'устаревшая подсказка: ' + status.error);
    return status.error;
  });

  await test('Нет доступа: просим открыть доступ, а не менять ссылку', async () => {
    await resetCaches();
    demo.mode = '403';
    const status = await getStatus(true);
    demo.mode = 'normal';

    eq(status.ok, false);
    eq(status.errorKind, 'access');
    assert(status.error.includes('доступ'), 'текст ошибки: ' + status.error);
    eq(demo.badge.text, '?');
    return status.error;
  });

  await test('Закрытая таблица: страница входа распознаётся без лишних запросов', async () => {
    await resetCaches();
    demo.mode = 'login';
    const before = demo.fetchUrls.length;
    const status = await getStatus(true);
    demo.mode = 'normal';
    const urls = demo.fetchUrls.slice(before);

    eq(status.ok, false);
    eq(status.errorKind, 'access');
    assert(status.error.includes('доступ'), 'текст ошибки: ' + status.error);
    eq(
      urls.filter((url) => url.includes('export?format=csv') || url.includes('gviz/tq')).length,
      1,
      'должен быть только один запрос CSV'
    );
    assert(!urls.some((url) => url.includes('/htmlview')), 'не нужно перебирать вкладки при отказе в доступе');
    return status.error;
  });

  await test('Пустая таблица: явная ошибка вместо прошлого результата', async () => {
    await resetCaches();
    await setSettings('Полунин Иван', 'Оператор связи');

    demo.mode = 'empty';
    const status = await getStatus(true);
    const again = await getStatus(false);
    demo.mode = 'normal';

    eq(status.ok, false);
    eq(status.status, 'error');
    eq(status.errorKind, 'empty');
    eq(status.week, null);
    eq(status.matches.length, 0);
    eq(status.stale, undefined);
    assert(status.error.includes('нет данных'), 'текст ошибки: ' + status.error);
    eq(demo.badge.text, '?');
    assert(demo.badge.title.includes('нет данных'), demo.badge.title);

    // Пустой результат не должен «откатываться» к прошлому успешному кешу.
    eq(again.errorKind, 'empty');
    eq(again.week, null);
  });

  await test('Не настроено: статус unconfigured и список групп', async () => {
    await setSettings('', '');
    const status = await getStatus(true);

    eq(status.status, 'unconfigured');
    assert(status.groups.length > 100, 'групп: ' + status.groups.length);
    assert(status.groups.includes('Оператор связи'), 'нет «Оператор связи»');
    return 'групп: ' + status.groups.length;
  });

  await test('Группа не указана: настройка неполная', async () => {
    await setSettings('Полунин Иван', '');
    const status = await getStatus(true);

    eq(status.status, 'unconfigured');
    eq(status.configured, false);
    eq(status.matches.length, 0);
    eq(demo.badge.text, '');
    assert(demo.badge.title.includes('заполните'), demo.badge.title);
    return 'настройка неполная';
  });

  await test('Неверная группа: человек найден в другой строке', async () => {
    await setSettings('Полунин Иван', 'УЦ');
    const status = await getStatus(true);

    eq(status.status, 'on');
    eq(status.matches[0].kind, 'other');
    return 'найден в: ' + status.matches[0].group;
  });

  await test('Другая вкладка таблицы: неделя найдена автоматически', async () => {
    await resetCaches();
    await setSettings('Полунин Иван', 'Оператор связи');

    demo.mode = 'other-tab';
    const status = await getStatus(true);
    demo.mode = 'normal';

    eq(status.status, 'on');
    eq(status.week.label, '26.10–01.11');

    const sheets = (await chrome.storage.local.get('dutySheets')).dutySheets;
    assert(sheets['60629275'], 'лист 60629275 не закеширован');
    assert(sheets['60629275'].text.length > 1000, 'пустой текст листа');
    return 'использован лист 60629275';
  });

  await test('Бейдж: не дежурный — без восклицательного знака', async () => {
    await setSettings('Столяров Дмитрий', 'Оператор связи');
    const status = await getStatus(false);

    eq(status.status, 'off');
    eq(demo.badge.text, '');
    assert(demo.badge.title.includes('не дежурный'), demo.badge.title);
    return demo.badge.title;
  });

  await test('Нет текущей недели: предупреждение, а не «не дежурный»', async () => {
    await setSettings('Полунин Иван', 'Оператор связи');
    await setLocal({ dutyDiscovery: undefined });

    demo.mode = 'no-week';
    const status = await getStatus(true);
    demo.mode = 'normal';

    eq(status.status, 'no-week');
    eq(status.ok, true);
    eq(status.onDuty, false);
    eq(demo.badge.text, '?');
    assert(demo.badge.title.includes('нет текущей недели'), demo.badge.title);
    return status.weeks.join(', ');
  });

  await test('Пустая ячейка: неделя есть, дежурный не указан', async () => {
    await setSettings('Иванов Иван', 'Платформа');
    const status = await getStatus(true);

    eq(status.status, 'unfilled');
    eq(status.ok, true);
    eq(status.onDuty, false);
    eq(status.reason, 'unfilled');
    eq(status.emptyGroups[0].group, 'Платформа');
    eq(demo.badge.text, '?');
    eq(demo.badge.color, '#D92D20');
    assert(demo.badge.title.includes('не заполнен'), demo.badge.title);

    await setSettings('Полунин Иван', 'Оператор связи');
    return demo.badge.title;
  });

  const claim = () => chrome.runtime.sendMessage({ type: 'duty:claimDaily' });
  const claimAlert = () => chrome.runtime.sendMessage({ type: 'duty:claimAlert' });

  function dayKey(offset) {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return (
      d.getFullYear() +
      '-' +
      String(d.getMonth() + 1).padStart(2, '0') +
      '-' +
      String(d.getDate()).padStart(2, '0')
    );
  }

  await test('Плашка: один показ в календарный день', async () => {
    await setLocal({ dutyOverlayShownOn: '' });

    const first = await claim();
    const second = await claim();

    eq(first.show, true);
    eq(second.show, false);
    eq((await chrome.storage.local.get('dutyOverlayShownOn')).dutyOverlayShownOn, dayKey(0));
  });

  await test('Плашка: на следующий день показывается снова', async () => {
    await setLocal({ dutyOverlayShownOn: dayKey(-1) });
    const result = await claim();

    eq(result.show, true);
    eq((await chrome.storage.local.get('dutyOverlayShownOn')).dutyOverlayShownOn, dayKey(0));
  });

  await test('Плашка: одновременные вкладки получают только один показ', async () => {
    await setLocal({ dutyOverlayShownOn: '' });

    const replies = await Promise.all([claim(), claim(), claim(), claim(), claim()]);
    const granted = replies.filter((r) => r && r.show).length;

    eq(granted, 1, 'право на показ получили ' + granted + ' вкладок');
  });

  await test('Предупреждение: отдельный дневной показ', async () => {
    await setLocal({ dutyOverlayShownOn: dayKey(0), dutyOverlayAlertShownOn: '' });

    eq((await claim()).show, false, 'карточка дежурства уже была');
    eq((await claimAlert()).show, true, 'предупреждение ещё не показывали');
  });

  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;

  const summary = document.getElementById('summary');
  summary.className = 'summary ' + (failed ? 'bad' : 'ok');
  summary.textContent = (failed ? 'ЕСТЬ ОШИБКИ: ' : 'ВСЕ ТЕСТЫ ПРОЙДЕНЫ: ') + passed + ' / ' + results.length;

  const list = document.getElementById('list');
  for (const item of results) {
    const li = document.createElement('li');
    li.className = item.ok ? 'pass' : 'fail';
    li.textContent = (item.ok ? '✓ ' : '✗ ') + item.name;

    if (item.detail) {
      const span = document.createElement('div');
      span.className = 'detail';
      span.textContent = item.detail;
      li.appendChild(span);
    }

    list.appendChild(li);
  }

  window.__INTEGRATION_RESULTS__ = { total: results.length, passed, failed, results };
  document.title = failed ? 'FAIL ' + passed + '/' + results.length : 'PASS ' + passed + '/' + results.length;
})();
