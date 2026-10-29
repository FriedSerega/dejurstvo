(() => {
  'use strict';

  const D = window.Duty;
  const CSV = window.FIXTURE_CSV;
  const rows = D.csvToRows(CSV);

  const OCT28 = new Date(2026, 9, 28); // среда
  const OCT31 = new Date(2026, 9, 31); // суббота
  const NOV03 = new Date(2026, 10, 3); // вторник
  const NOV05 = new Date(2026, 10, 5); // четверг
  const DEC01 = new Date(2026, 11, 1); // вторник
  const NEXT_YEAR = new Date(2027, 2, 1);

  const results = [];

  function test(name, fn) {
    try {
      const detail = fn();
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

  function duty(fullName, group, date) {
    return D.analyze(CSV, { fullName, group }, date);
  }

  function rowByPrefix(prefix) {
    return rows.find((row) => String(row[0] || '').trim().startsWith(prefix));
  }

  // ==========================================
  // CSV
  // ==========================================

  test('CSV: таблица разобрана, шапка на месте', () => {
    assert(rows.length > 100, 'строк мало: ' + rows.length);
    eq(String(rows[0][0]).trim(), 'Группы');
    eq(rows[0][1], '26.10-01.11');
    return rows.length + ' строк';
  });

  test('CSV: кавычки и переводы строк внутри ячеек', () => {
    const row = rowByPrefix('Платформа ЭДО (по ошибкам)');
    assert(row, 'строка не найдена');
    assert(String(row[0]).includes('Костров В.С.'), 'потерялся текст в кавычках');
    eq(row.length, 7);
    eq(row[1], '');
    return 'ячейка: ' + String(row[0]).replace(/\s+/g, ' ').slice(0, 40) + '…';
  });

  // ==========================================
  // НЕДЕЛИ
  // ==========================================

  test('Неделя: 26.10-01.11 распознана для 28.10.2026', () => {
    const week = D.parseWeekHeader('26.10-01.11', OCT28);
    assert(week, 'не распознано');
    eq(D.findWeekColumn(rows, OCT28).colIndex, 1);
    eq(week.label, '26.10–01.11');
    return week.label;
  });

  test('Неделя: 02.11-08.11 выбрана для 03.11.2026', () => {
    eq(D.findWeekColumn(rows, NOV03).colIndex, 2);
  });

  test('Неделя: 30.11-06.12 выбрана для 01.12.2026', () => {
    eq(D.findWeekColumn(rows, DEC01).colIndex, 6);
  });

  test('Неделя: переход через Новый год (29.12-04.01)', () => {
    const week = D.parseWeekHeader('29.12-04.01', new Date(2027, 0, 2));
    assert(week, 'не распознано');
    eq(week.start.getFullYear(), 2026);
    eq(week.start.getMonth(), 11);
    eq(week.start.getDate(), 29);
    eq(week.end.getFullYear(), 2027);
    eq(week.end.getDate(), 4);
  });

  test('Неделя: для даты вне графика недели нет', () => {
    eq(D.findWeekColumn(rows, NEXT_YEAR), null);
    const res = duty('Полунин Иван', 'Оператор связи', NEXT_YEAR);
    eq(res.reason, 'no-week');
    assert(res.weeks.length >= 6, 'список недель пуст');
    return 'недели: ' + res.weeks.join(', ');
  });

  test('Неделя: мусор в шапке не ломает разбор', () => {
    eq(D.parseWeekHeader('итого', OCT28), null);
    eq(D.parseWeekHeader('', OCT28), null);
    eq(D.parseWeekHeader(null, OCT28), null);
  });

  // ==========================================
  // ПОИСК ЧЕЛОВЕКА
  // ==========================================

  test('Человек: дежурный на текущей неделе', () => {
    const res = duty('Полунин Иван', 'Оператор связи', OCT28);
    eq(res.onDuty, true);
    eq(res.todayDuty, true);
    eq(res.matches.length, 1);
    eq(res.matches[0].group, 'Оператор связи');
    eq(res.matches[0].kind, 'group');
  });

  test('Человек: его неделя ещё не началась', () => {
    const res = duty('Столяров Дмитрий', 'Оператор связи', OCT28);
    eq(res.onDuty, false);
    eq(res.groupEntry.entry, 'Полунин И.');
  });

  test('Человек: дежурство на следующей неделе', () => {
    const res = duty('Столяров Дмитрий', 'Оператор связи', NOV03);
    eq(res.onDuty, true);
  });

  test('Человек: ФИО полностью, в таблице только инициалы', () => {
    eq(duty('Куртуков Александр Сергеевич', 'Интерфейсный фреймворк', OCT28).onDuty, true);
  });

  test('Человек: однофамилец с другими инициалами не считается', () => {
    eq(duty('Куртуков Борис', 'Интерфейсный фреймворк', OCT28).onDuty, false);
  });

  test('Человек: другая фамилия не считается', () => {
    eq(duty('Куртукова Александра', 'Интерфейсный фреймворк', OCT28).onDuty, false);
  });

  test('Человек: фамилия без инициалов в таблице («Коржиневский»)', () => {
    eq(duty('Коржиневский Павел', 'Перевозочные документы', OCT28).onDuty, true);
  });

  test('Человек: сокращённое имя «Лукоянов Ар.»', () => {
    eq(duty('Лукоянов Аркадий', 'Чаты с клиентами', OCT28).onDuty, true);
  });

  test('Человек: две фамилии в одной ячейке («Серова В, Томчик А»)', () => {
    eq(duty('Томчик Анна', 'Анализ и сверки', OCT28).onDuty, true);
    eq(duty('Серова Вера', 'Анализ и сверки', OCT28).onDuty, true);
  });

  test('Человек: несколько имён через косую черту', () => {
    eq(duty('Жемчугова Вера', 'Внешние обработки для 1С', OCT28).onDuty, true);
    eq(duty('Жемчугов Пётр', 'Внешние обработки для 1С', OCT28).onDuty, false);
  });

  test('Человек: ФИО в нижнем регистре', () => {
    eq(duty('полунин иван', 'оператор связи', OCT28).onDuty, true);
  });

  // ==========================================
  // ГРУППЫ
  // ==========================================

  test('Группа: «(ОФД)» в названии не мешает', () => {
    const res = duty('Паркаренко А.С.', 'Онлайн-кассы и статистика продаж', OCT28);
    eq(res.onDuty, true);
    assert(res.matches[0].group.includes('ОФД'), 'не та группа');
  });

  test('Группа: «Деньги» — два дежурных в одной ячейке', () => {
    eq(duty('Кречетова Е.', 'Деньги', OCT28).onDuty, true);
    eq(duty('Моргунова Н.', 'Деньги', OCT28).onDuty, true);
    eq(duty('Плисов Д.', 'Деньги', OCT28).onDuty, false);
  });

  test('Группа: с уточнением в скобках «Saby Report, Saby Buhta (…)»', () => {
    const res = duty('Соколан М.', 'Saby Report, Saby Buhta', OCT28);
    eq(res.onDuty, true);
  });

  test('Группа: неверная группа, но человек найден в другой строке', () => {
    const res = duty('Полунин Иван', 'УЦ', OCT28);
    eq(res.onDuty, true);
    eq(res.matches[0].kind, 'other');
    eq(res.matches[0].group, 'Оператор связи');
  });

  test('Группа: не указана — настройка неполная', () => {
    const res = duty('Полунин Иван', '', OCT28);
    eq(res.configured, false);
    eq(res.reason, 'unconfigured');
    eq(res.onDuty, false);

    eq(D.analyze(CSV, { group: 'Оператор связи' }, OCT28).configured, false);
  });

  // ==========================================
  // ПРАВИЛО «ЕСЛИ ПУСТО»
  // ==========================================

  test('Правило «если пусто то»: пустая ячейка — дежурит резервный', () => {
    const res = duty('Рябинин С.С.', 'Мобильная платформа ЭДО', NOV03);
    eq(res.onDuty, true);
    eq(res.matches[0].kind, 'fallback');
    eq(res.matches[0].entry, 'Рябинин С.С.');
  });

  test('Правило «если пусто то»: заполненная ячейка отменяет резерв', () => {
    eq(duty('Рябинин С.С.', 'Мобильная платформа ЭДО', OCT28).onDuty, false);
    eq(duty('Сербулов А.', 'Мобильная платформа ЭДО', OCT28).onDuty, true);
  });

  test('Правило «если пусто то»: сложные правила не дают ложных срабатываний', () => {
    eq(duty('Костров В.С.', 'Документы и файлы', OCT28).onDuty, false);
    eq(duty('Трякин С.В.', 'API ЭДО', OCT28).onDuty, false);
  });

  test('Пустая ячейка: неделя есть, дежурный не указан', () => {
    const res = duty('Иванов Иван', 'Платформа', OCT28);
    eq(res.onDuty, false);
    eq(res.reason, 'unfilled');
    eq(res.emptyGroups.length, 1);
    eq(res.emptyGroups[0].group, 'Платформа');
  });

  test('Пустая ячейка: резерв по правилу «если пусто то» не считается незаполненной', () => {
    const res = duty('Иванов Иван', 'Мобильная платформа ЭДО', NOV03);
    eq(res.onDuty, false);
    eq(res.reason, 'off');
    assert(res.groupEntry && res.groupEntry.fallback, 'резерв не найден');
  });

  // ==========================================
  // ДНИ НЕДЕЛИ
  // ==========================================

  test('Дни: «(пн-пт)» — в среду дежурит, в субботу нет', () => {
    const wed = duty('Балакина М.', 'Розница', OCT28);
    eq(wed.onDuty, true);
    eq(wed.todayDuty, true);

    const sat = duty('Балакина М.', 'Розница', OCT31);
    eq(sat.onDuty, true);
    eq(sat.todayDuty, false);
  });

  test('Дни: «(сб-вс)» — в субботу дежурит', () => {
    const sat = duty('Герасимова В.', 'Розница', OCT31);
    eq(sat.onDuty, true);
    eq(sat.todayDuty, true);
  });

  test('Дни: «(пн-чт)» — в четверг дежурит, в субботу нет', () => {
    const TUE_24_NOV = new Date(2026, 10, 24);
    const SAT_28_NOV = new Date(2026, 10, 28);
    eq(duty('Курзина А.', 'Розница', TUE_24_NOV).todayDuty, true);
    eq(duty('Курзина А.', 'Розница', SAT_28_NOV).todayDuty, false);
    eq(duty('Власова А.', 'Розница', SAT_28_NOV).todayDuty, true);
  });

  // ==========================================
  // ПРОЧЕЕ
  // ==========================================

  test('Прочее: не настроено — понятная причина', () => {
    const res = D.analyze(CSV, {}, OCT28);
    eq(res.configured, false);
    eq(res.reason, 'unconfigured');
    assert(res.groups.length > 100, 'мало групп: ' + res.groups.length);
  });

  test('Прочее: список групп очищен от скобок', () => {
    const res = D.analyze(CSV, {}, OCT28);
    assert(res.groups.includes('Оператор связи'), 'нет «Оператор связи»');
    assert(res.groups.includes('Мобильная платформа ЭДО'), 'нет «Мобильная платформа ЭДО»');
    assert(!res.groups.some((g) => g.includes('(ОФД)')), 'скобки остались');
  });

  test('Прочее: пустая таблица распознаётся как отсутствие данных', () => {
    const res = D.analyze('', { fullName: 'Иванов Иван', group: 'Тест' }, OCT28);
    eq(res.hasContent, false);
    eq(res.reason, 'empty');

    const blankCells = D.analyze(',,,\n,,\n', { fullName: 'Иванов Иван', group: 'Тест' }, OCT28);
    eq(blankCells.hasContent, false);
    eq(blankCells.reason, 'empty');
  });

  test('Прочее: человек без примечаний дежурит «сегодня»', () => {
    eq(duty('Маландин Д.', 'Телефония', NOV05).todayDuty, true);
  });

  // ==========================================
  // ССЫЛКА НА ГРАФИК
  // ==========================================

  test('Ссылка: gid из hash', () => {
    const parsed = D.parseSheetUrl(
      'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit#gid=515172059'
    );
    eq(parsed.docId, '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789');
    eq(parsed.gid, '515172059');
    eq(parsed.url, 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit?gid=515172059#gid=515172059');
  });

  test('Ссылка: gid из query', () => {
    const parsed = D.parseSheetUrl(
      'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit?usp=sharing&gid=42'
    );
    eq(parsed.gid, '42');
  });

  test('Ссылка: без gid — первый лист', () => {
    const parsed = D.parseSheetUrl('https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit');
    eq(parsed.gid, '');
    eq(parsed.url, 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit');
  });

  test('Ссылка: чужой сайт отклоняется', () => {
    eq(D.parseSheetUrl('https://example.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit'), null);
  });

  test('Ссылка: мусор отклоняется', () => {
    eq(D.parseSheetUrl('просто текст'), null);
    eq(D.parseSheetUrl(''), null);
  });

  test('Ссылка: buildSheetUrl собирает канонический адрес', () => {
    eq(D.buildSheetUrl('DOC_123', '7'), 'https://docs.google.com/spreadsheets/d/DOC_123/edit?gid=7#gid=7');
    eq(D.buildSheetUrl('DOC_123', ''), 'https://docs.google.com/spreadsheets/d/DOC_123/edit');
  });

  // ==========================================
  // ВЫВОД
  // ==========================================

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

  window.__TEST_RESULTS__ = { total: results.length, passed, failed, results };
  document.title = (failed ? 'FAIL ' + passed + '/' + results.length : 'PASS ' + passed + '/' + results.length);
})();
