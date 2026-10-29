/*!
 * Дежурства — разбор графика дежурств из Google Sheets.
 *
 * Классический скрипт (без модулей): подключается через importScripts()
 * в service worker и через <script> в тестовой странице.
 *
 * Структура таблицы: строка-шапка с диапазонами дат (26.10-01.11, ...),
 * первый столбец — группа, в ячейке недели — фамилия дежурного.
 */
(function (root) {
  'use strict';

  /** Каноническая ссылка на таблицу (или на конкретный лист). */
  function buildSheetUrl(docId, gid) {
    const base = 'https://docs.google.com/spreadsheets/d/' + docId + '/edit';
    const sheet = String(gid == null ? '' : gid).trim();
    return sheet ? base + '?gid=' + sheet + '#gid=' + sheet : base;
  }

  /**
   * Разбирает ссылку на Google Sheets. Поддерживает gid в query и в hash.
   * @returns {{docId: string, gid: string, url: string}|null}
   */
  function parseSheetUrl(value) {
    const text = String(value == null ? '' : value).trim();
    if (!text) return null;

    let url;
    try {
      url = new URL(text);
    } catch {
      return null;
    }

    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (url.hostname !== 'docs.google.com') return null;
    if (url.pathname.startsWith('/spreadsheets/d/e/')) return null;

    const match = url.pathname.match(/^\/spreadsheets\/d\/([A-Za-z0-9_-]+)(?:\/|$)/);
    if (!match) return null;

    const docId = match[1];
    const hashQuery = new URLSearchParams(url.hash.replace(/^#/, ''));
    const gid = url.searchParams.get('gid') || hashQuery.get('gid') || '';

    if (gid && !/^\d+$/.test(gid)) return null;

    return { docId, gid, url: buildSheetUrl(docId, gid) };
  }

  // 26.10-01.11, 26.10 - 01.11, 26.10—01.11 и т.п.
  const WEEK_RE = /(\d{1,2})\s*\.\s*(\d{1,2})\s*[-–—−]\s*(\d{1,2})\s*\.\s*(\d{1,2})/;

  // Правило из названия группы: «(если пусто то Рябинин С.С.)»
  const FALLBACK_RE =
    /если\s+пусто(?:\s+то)?\s*[-–—:]?\s*([А-ЯЁ][а-яё-]+(?:\s+[А-ЯЁ]\.(?:\s*[А-ЯЁ]\.)?)?)/;

  const DAY = 'пн|понед[а-яё]*|вт|втор[а-яё]*|ср|сред[а-яё]*|чт|четв[а-яё]*|пт|пят[а-яё]*|сб|суб[а-яё.]*|вс|воск[а-яё.]*';
  const DAY_RANGE_RE = new RegExp('(' + DAY + ')\\s*[-–—]\\s*(' + DAY + ')', 'i');

  // ==========================================
  // ДАТЫ
  // ==========================================

  function pad2(n) {
    return n < 10 ? '0' + n : String(n);
  }

  function startOfDay(value) {
    const d = value instanceof Date ? value : new Date(value);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  function toISODate(date) {
    return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate());
  }

  /**
   * Разбирает заголовок недели («26.10-01.11»).
   * Год подбирается так, чтобы диапазон был ближе всего к refDate
   * (важно для недель, переходящих через Новый год).
   * @returns {{start: Date, end: Date, label: string, distance: number}|null}
   */
  function parseWeekHeader(value, refDate) {
    const m = String(value == null ? '' : value).match(WEEK_RE);
    if (!m) return null;

    const d1 = +m[1];
    const mo1 = +m[2];
    const d2 = +m[3];
    const mo2 = +m[4];
    if (mo1 < 1 || mo1 > 12 || mo2 < 1 || mo2 > 12) return null;
    if (d1 < 1 || d1 > 31 || d2 < 1 || d2 > 31) return null;

    const ref = startOfDay(refDate || new Date());
    const refYear = ref.getFullYear();
    let best = null;

    for (const year of [refYear - 1, refYear, refYear + 1]) {
      const start = new Date(year, mo1 - 1, d1);
      let end = new Date(year, mo2 - 1, d2);
      if (end < start) end = new Date(year + 1, mo2 - 1, d2);

      const distance = ref < start ? start - ref : ref > end ? ref - end : 0;
      if (!best || distance < best.distance) best = { start, end, distance };
      if (distance === 0) break;
    }

    return {
      start: best.start,
      end: best.end,
      label: pad2(d1) + '.' + pad2(mo1) + '–' + pad2(d2) + '.' + pad2(mo2),
      distance: best.distance,
    };
  }

  // ==========================================
  // CSV
  // ==========================================

  /** RFC 4180-парсер: кавычки, запятые и переводы строк внутри ячеек. */
  function csvToRows(text) {
    const src = String(text == null ? '' : text).replace(/^\uFEFF/, '');
    const rows = [];
    let row = [];
    let field = '';
    let quoted = false;

    for (let i = 0; i < src.length; i++) {
      const ch = src[i];

      if (quoted) {
        if (ch === '"') {
          if (src[i + 1] === '"') {
            field += '"';
            i++;
          } else {
            quoted = false;
          }
        } else {
          field += ch;
        }
        continue;
      }

      if (ch === '"') {
        quoted = true;
      } else if (ch === ',') {
        row.push(field);
        field = '';
      } else if (ch === '\n') {
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      } else if (ch === '\r') {
        // пропускаем, перевод строки обработает \n
      } else {
        field += ch;
      }
    }

    if (field !== '' || row.length) {
      row.push(field);
      rows.push(row);
    }

    return rows;
  }

  // ==========================================
  // НОРМАЛИЗАЦИЯ ТЕКСТА
  // ==========================================

  function normalizeText(value) {
    return String(value == null ? '' : value)
      .replace(/\u00a0/g, ' ')
      .replace(/[ёЁ]/g, 'е')
      .toLowerCase();
  }

  /** Ключ слова: нижний регистр, без пунктуации. */
  function wordKey(value) {
    return normalizeText(value).replace(/[^a-zа-я0-9-]+/g, '');
  }

  /** Название группы без пояснений в скобках и хвостовой пунктуации. */
  function cleanGroupLabel(label) {
    return String(label == null ? '' : label)
      .replace(/\([^)]*\)/g, ' ')
      .replace(/\s*[-–—:,]\s*$/, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function groupKey(label) {
    return normalizeText(cleanGroupLabel(label))
      .replace(/[^a-zа-я0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // ==========================================
  // ФИО
  // ==========================================

  /**
   * Инициалы из одного токена: «И.» → «и», «И.Р.» → «ир»,
   * «Ильмир» → «и». Возвращает null, если токен — не имя.
   */
  function initialsFromToken(token) {
    const raw = String(token == null ? '' : token).trim();
    if (!raw || !/^[A-Za-zА-Яа-яЁё]/.test(raw)) return null;

    const t = raw.replace(/^[«"'([{]+/, '').replace(/[»"'\])}.,;:]+$/, '.');
    if (!t) return null;

    if (/^[А-ЯЁA-Z]\.?$/i.test(t)) return t[0];

    const pair = t.match(/^([А-ЯЁA-Z])\.\s*([А-ЯЁA-Z])\.?$/i);
    if (pair) return pair[1] + pair[2];

    if (/^[А-ЯЁA-Z][а-яёa-z]+\.?$/i.test(t)) return t[0];

    return null;
  }

  /** До двух инициалов из подряд идущих токенов начиная с start. */
  function initialsAfter(tokens, start) {
    let initials = '';
    for (let i = start; i < tokens.length && initials.length < 2; i++) {
      const part = initialsFromToken(tokens[i]);
      if (!part) break;
      initials += part;
    }
    return initials.toLowerCase();
  }

  function initialsMatch(searched, found) {
    // Если у одной из сторон инициалов нет — сверяем только фамилию.
    if (!searched || !found) return true;
    return searched.indexOf(found) === 0 || found.indexOf(searched) === 0;
  }

  /**
   * Ищет человека в ячейке графика.
   * @returns {{chunk: string, days: {from: number, to: number}|null}|null}
   */
  function findPersonInText(cellText, fullName) {
    const parts = String(fullName == null ? '' : fullName).trim().split(/\s+/).filter(Boolean);
    const surnameKey = wordKey(parts[0]);
    if (!surnameKey) return null;

    const searchedInitials = initialsAfter(parts, 1);
    const chunks = String(cellText == null ? '' : cellText)
      .replace(/\u00a0/g, ' ')
      .split(/[\/,;|\\\n]+/);

    for (const chunk of chunks) {
      const notes = (chunk.match(/\([^)]*\)/g) || []).join(' ');
      const clean = chunk.replace(/\([^)]*\)/g, ' ').replace(/[«»"]/g, ' ');
      const tokens = clean.split(/\s+/).filter(Boolean);

      for (let i = 0; i < tokens.length; i++) {
        if (wordKey(tokens[i]) !== surnameKey) continue;

        const foundInitials = initialsAfter(tokens, i + 1);
        if (initialsMatch(searchedInitials, foundInitials)) {
          return { chunk: chunk.trim(), days: parseDayRange(notes) };
        }
      }
    }

    return null;
  }

  // ==========================================
  // ДНИ НЕДЕЛИ В ПРИМЕЧАНИЯХ («(пн-пт)», «(сб-вс)»)
  // ==========================================

  function dayNumber(word) {
    const w = normalizeText(word).replace(/[^а-я]/g, '');
    if (!w) return null;
    if (/^(пн|пон)/.test(w)) return 1;
    if (/^(вт|вто)/.test(w)) return 2;
    if (/^(ср|сре)/.test(w)) return 3;
    if (/^(чт|чет)/.test(w)) return 4;
    if (/^(пт|пят)/.test(w)) return 5;
    if (/^(сб|суб)/.test(w)) return 6;
    if (/^(вс|вос)/.test(w)) return 0;
    return null;
  }

  function parseDayRange(notes) {
    const m = String(notes == null ? '' : notes).match(DAY_RANGE_RE);
    if (!m) return null;

    const from = dayNumber(m[1]);
    const to = dayNumber(m[2]);
    if (from == null || to == null) return null;
    return { from, to };
  }

  function isDayInRange(days, date) {
    if (!days) return true;
    const day = date.getDay();
    return days.from <= days.to
      ? day >= days.from && day <= days.to
      : day >= days.from || day <= days.to;
  }

  function isPersonOnDutyToday(person, date) {
    return Boolean(person) && isDayInRange(person.days, date);
  }

  // ==========================================
  // ГРУППЫ
  // ==========================================

  function groupMatches(label, userGroup) {
    const rowKey = groupKey(label);
    const userKey = groupKey(userGroup);
    if (!rowKey || !userKey) return false;
    if (rowKey === userKey) return true;

    // «Оператор связи» ↔ «Оператор связи (ОФД)» и похожие уточнения
    if (userKey.length >= 4 && (rowKey.indexOf(userKey) === 0 || rowKey.indexOf(userKey) !== -1)) return true;
    if (rowKey.length >= 4 && userKey.indexOf(rowKey) !== -1) return true;

    const rowTokens = new Set(rowKey.split(' ').filter(Boolean));
    const userTokens = userKey.split(' ').filter((t) => t.length > 2);
    return userTokens.length > 0 && userTokens.every((t) => rowTokens.has(t));
  }

  /** «...(если пусто то Рябинин С.С.)» → «Рябинин С.С.» */
  function fallbackPersonFromLabel(label) {
    const m = String(label == null ? '' : label).match(FALLBACK_RE);
    return m ? m[1].trim() : '';
  }

  // ==========================================
  // СБОР ДАННЫХ ИЗ ТАБЛИЦЫ
  // ==========================================

  function collectWeekLabels(rows) {
    const labels = [];
    const limit = Math.min(rows.length, 15);

    for (let r = 0; r < limit; r++) {
      for (const cell of rows[r] || []) {
        const week = parseWeekHeader(cell, new Date());
        if (week) labels.push(week.label);
      }
    }

    return Array.from(new Set(labels));
  }

  function collectGroups(rows) {
    const groups = [];
    const seen = new Set();

    for (let r = 1; r < rows.length; r++) {
      const raw = String((rows[r] || [])[0] || '').replace(/\s+/g, ' ').trim();
      if (!raw) continue;

      const label = cleanGroupLabel(raw) || raw;
      const key = groupKey(label);
      if (!key || seen.has(key)) continue;

      seen.add(key);
      groups.push(label);
    }

    return groups;
  }

  /** Строка шапки и колонка текущей недели. */
  function findWeekColumn(rows, refDate) {
    const ref = startOfDay(refDate || new Date());
    const limit = Math.min(rows.length, 15);

    for (let r = 0; r < limit; r++) {
      const row = rows[r] || [];
      for (let c = 1; c < row.length; c++) {
        const week = parseWeekHeader(row[c], ref);
        if (week && week.distance === 0) {
          return { rowIndex: r, colIndex: c, week };
        }
      }
    }

    return null;
  }

  // ==========================================
  // ГЛАВНАЯ ФУНКЦИЯ
  // ==========================================

  /**
   * @param {string} csvText содержимое таблицы в CSV
   * @param {{fullName?: string, group?: string}} settings
   * @param {Date} [refDate] дата, для которой ищем неделю
   */
  function analyze(csvText, settings, refDate) {
    const options = settings || {};
    const fullName = String(options.fullName == null ? '' : options.fullName).replace(/\s+/g, ' ').trim();
    const group = String(options.group == null ? '' : options.group).replace(/\s+/g, ' ').trim();
    const ref = startOfDay(refDate || new Date());

    const rows = csvToRows(csvText);
    const hasContent = rows.some((row) =>
      (row || []).some((cell) => String(cell == null ? '' : cell).trim() !== '')
    );
    const found = hasContent ? findWeekColumn(rows, ref) : null;

    const result = {
      ok: true,
      configured: Boolean(fullName && group),
      settings: { fullName, group },
      hasContent,
      week: null,
      weeks: collectWeekLabels(rows),
      groups: collectGroups(rows),
      onDuty: false,
      todayDuty: false,
      matches: [],
      groupEntry: null,
      emptyGroups: [],
      reason: '',
    };

    if (!hasContent) {
      result.reason = 'empty';
      return result;
    }

    if (!found) {
      result.reason = 'no-week';
      return result;
    }

    result.week = {
      label: found.week.label,
      start: toISODate(found.week.start),
      end: toISODate(found.week.end),
    };

    if (!result.configured) {
      result.reason = 'unconfigured';
      return result;
    }

    const matches = [];
    const emptyGroups = [];
    const userGroupKey = groupKey(group);
    let exactGroupEntry = null;
    let groupEntry = null;

    for (let r = found.rowIndex + 1; r < rows.length; r++) {
      const row = rows[r] || [];
      const label = String(row[0] == null ? '' : row[0]).replace(/\s+/g, ' ').trim();
      const cell = String(row[found.colIndex] == null ? '' : row[found.colIndex]).replace(/\s+/g, ' ').trim();
      if (!label && !cell) continue;

      const isMyGroup = groupMatches(label, group);
      const isExactGroup = Boolean(userGroupKey) && groupKey(label) === userGroupKey;

      if (isMyGroup) {
        if (cell) {
          if (!groupEntry) groupEntry = { group: label, entry: cell, fallback: false };
          if (isExactGroup && !exactGroupEntry) {
            exactGroupEntry = { group: label, entry: cell, fallback: false };
          }

          const person = findPersonInText(cell, fullName);
          if (person) {
            matches.push({
              group: label,
              entry: cell,
              kind: 'group',
              days: person.days,
              today: isPersonOnDutyToday(person, ref),
            });
          }
        } else {
          // В ячейке пусто — работает правило из названия группы.
          const fallback = fallbackPersonFromLabel(label);
          if (fallback) {
            if (!groupEntry) groupEntry = { group: label, entry: fallback, fallback: true };
            if (isExactGroup && !exactGroupEntry) {
              exactGroupEntry = { group: label, entry: fallback, fallback: true };
            }

            const person = findPersonInText(fallback, fullName);
            if (person) {
              matches.push({
                group: label,
                entry: fallback,
                kind: 'fallback',
                days: null,
                today: true,
              });
            }
          } else if (isExactGroup) {
            // Неделя есть, но дежурного в строке группы не указали.
            emptyGroups.push({ group: label || 'Без группы' });
          }
        }
      }

      // Человек может быть записан и в другой группе — это тоже дежурство.
      if (cell && !isMyGroup) {
        const person = findPersonInText(cell, fullName);
        if (person) {
          matches.push({
            group: label || 'Без группы',
            entry: cell,
            kind: 'other',
            days: person.days,
            today: isPersonOnDutyToday(person, ref),
          });
        }
      }
    }

    const seen = new Set();
    result.matches = matches.filter((match) => {
      const key = groupKey(match.group) + '|' + match.entry.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    result.onDuty = result.matches.length > 0;
    result.todayDuty = result.matches.some((match) => match.today);
    result.groupEntry = groupEntry;
    result.emptyGroups = emptyGroups;
    result.reason = result.onDuty
      ? 'on'
      : emptyGroups.length && !exactGroupEntry
        ? 'unfilled'
        : 'off';

    return result;
  }

  // ==========================================
  // EXPORT
  // ==========================================

  root.Duty = {
    buildSheetUrl,
    parseSheetUrl,
    csvToRows,
    parseWeekHeader,
    findWeekColumn,
    collectWeekLabels,
    collectGroups,
    cleanGroupLabel,
    groupKey,
    groupMatches,
    findPersonInText,
    fallbackPersonFromLabel,
    parseDayRange,
    isDayInRange,
    analyze,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
