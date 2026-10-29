// ==========================================
// POPUP — настройка ФИО/группы и статус на неделю
// ==========================================
(() => {
  'use strict';

  const SOURCE_KEY = 'dutySource';
  const SOURCE_HINT = 'Ссылка на таблицу с графиком.';
  const SOURCE_WARNING = 'Вставьте ссылку из адресной строки Google Sheets.';

  const els = {
    status: document.getElementById('status'),
    week: document.getElementById('statusWeek'),
    title: document.getElementById('statusTitle'),
    sub: document.getElementById('statusSub'),
    list: document.getElementById('statusList'),
    live: document.getElementById('live'),
    form: document.getElementById('form'),
    fullName: document.getElementById('fullName'),
    group: document.getElementById('group'),
    groupList: document.getElementById('groupList'),
    save: document.getElementById('saveBtn'),
    sheetLink: document.getElementById('sheetLink'),
    updated: document.getElementById('updated'),
    showOverlay: document.getElementById('showOverlay'),
    sourceBox: document.getElementById('sourceBox'),
    sheetUrl: document.getElementById('sheetUrl'),
    sourceState: document.getElementById('sourceState'),
    sourceHint: document.getElementById('sourceHint'),
    refresh: document.getElementById('refreshBtn'),
  };

  let status = null;
  let saveTimer = 0;
  let groupsKey = '';
  let currentSource = null;
  let sourceInvalid = false;
  let refreshing = false;

  els.sourceBox.addEventListener('toggle', syncSourceMode);

  init();

  function syncSourceMode() {
    document.body.classList.toggle('source-open', els.sourceBox.open);
  }

  async function init() {
    const [settings, source, local] = await Promise.all([
      readSettings(),
      readSource(),
      chrome.storage.local.get('dutyOverlayMutedUntil').catch(() => ({})),
    ]);

    els.fullName.value = settings.fullName;
    els.group.value = settings.group;
    els.sheetUrl.value = source ? source.url : '';
    currentSource = source;
    els.sheetLink.hidden = !source;
    if (source) els.sheetLink.href = source.url;
    updateSourceState();

    if (!source) {
      els.sourceBox.open = true;
      syncSourceMode();
      setSourceMessage(SOURCE_WARNING, false);
    }

    updateOverlayLink(Number(local.dutyOverlayMutedUntil) || 0);

    // Попап всегда проверяет таблицу заново: старые данные из кеша
    // не должны выглядеть как актуальный график.
    await requestStatus(true);
  }

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

  function markSettingsInvalid(inputs) {
    for (const input of [els.fullName, els.group]) {
      const invalid = inputs.indexOf(input) !== -1;
      input.dataset.invalid = invalid ? '1' : '0';
      input.setAttribute('aria-invalid', invalid ? 'true' : 'false');
    }
  }

  function clearSettingsInvalid(input) {
    for (const field of input ? [input] : [els.fullName, els.group]) {
      field.dataset.invalid = '0';
      field.setAttribute('aria-invalid', 'false');
    }
  }

  async function readSettings() {
    try {
      const data = await chrome.storage.sync.get('dutySettings');
      return normalizeSettings(data.dutySettings);
    } catch {
      const data = await chrome.storage.local.get('dutySettings').catch(() => ({}));
      return normalizeSettings(data.dutySettings);
    }
  }

  // ==========================================
  // ИСТОЧНИК ГРАФИКА
  // ==========================================

  function normalizeSource(raw) {
    const text = raw && typeof raw === 'object' ? raw.url : raw;
    return text ? Duty.parseSheetUrl(text) : null;
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

  async function writeSource(url) {
    try {
      await chrome.storage.sync.set({ [SOURCE_KEY]: { url } });
    } catch {
      await chrome.storage.local.set({ [SOURCE_KEY]: { url } }).catch(() => {});
    }
  }

  function updateSourceState() {
    if (!currentSource) {
      els.sourceState.textContent = 'не указана';
      els.sourceState.title = 'Вставьте ссылку на график';
      return;
    }

    els.sourceState.textContent = 'используется';
    els.sourceState.title = currentSource.url;
  }

  function updateSourceDraftState() {
    const draft = els.sheetUrl.value.trim();

    if (!currentSource) {
      els.sourceState.textContent = draft ? 'не сохранена' : 'не указана';
      els.sourceState.title = draft ? 'Ссылка ещё не применена' : 'Вставьте ссылку на график';
      return;
    }

    if (draft !== currentSource.url) {
      els.sourceState.textContent = 'не сохранена';
      els.sourceState.title = 'Изменения ещё не применены';
      return;
    }

    updateSourceState();
  }

  function setSourceMessage(text, bad, invalid) {
    sourceInvalid = Boolean(invalid && text);
    els.sourceHint.textContent = text || SOURCE_HINT;
    els.sourceHint.classList.toggle('bad', Boolean(bad && text));
    els.sheetUrl.dataset.invalid = sourceInvalid ? '1' : '0';
    els.sheetUrl.setAttribute('aria-invalid', sourceInvalid ? 'true' : 'false');
    if (sourceInvalid) updateSourceDraftState();
  }

  async function saveSource() {
    if (!els.sheetUrl.value.trim()) {
      setSourceMessage('Вставьте ссылку Google Sheets — без неё проверить график нельзя.', true, true);
      return { ok: false, changed: false };
    }

    const parsed = Duty.parseSheetUrl(els.sheetUrl.value);
    if (!parsed) {
      setSourceMessage(
        currentSource
          ? 'Это не ссылка Google Sheets. Текущая ссылка не изменена.'
          : 'Это не ссылка Google Sheets. Вставьте ссылку из адресной строки таблицы.',
        true,
        true
      );
      return { ok: false, changed: false };
    }

    els.sheetUrl.value = parsed.url;

    if (currentSource && parsed.url === currentSource.url) {
      setSourceMessage('', false);
      updateSourceState();
      return { ok: true, changed: false };
    }

    await writeSource(parsed.url);
    currentSource = parsed;

    // Новая таблица — старый кеш больше не нужен.
    await chrome.storage.local.remove(['dutySheets', 'dutyDiscovery']).catch(() => {});

    setSourceMessage('', false);
    updateSourceState();
    return { ok: true, changed: true };
  }

  async function saveSettings(force, includeSource) {
    let forceNow = Boolean(force);
    const settings = normalizeSettings({ fullName: els.fullName.value, group: els.group.value });

    els.fullName.value = settings.fullName;
    els.group.value = settings.group;

    if (includeSource) {
      const missing = [];
      if (!settings.fullName) missing.push(els.fullName);
      if (!settings.group) missing.push(els.group);

      if (missing.length) {
        markSettingsInvalid(missing);
        missing[0].focus();
        missing[0].scrollIntoView({ block: 'nearest' });
        return;
      }

      clearSettingsInvalid();

      const source = await saveSource();
      if (!source.ok) {
        // Не подменяем неудачную правку старой ссылкой и не делаем вид,
        // что проверка прошла. Показываем поле и даём исправить.
        els.sourceBox.open = true;
        syncSourceMode();
        els.sheetUrl.focus();
        els.sheetUrl.scrollIntoView({ block: 'nearest' });
        return;
      }
      forceNow = forceNow || source.changed;
    }

    try {
      await chrome.storage.sync.set({ dutySettings: settings });
    } catch {
      await chrome.storage.local.set({ dutySettings: settings }).catch(() => {});
    }

    clearTimeout(saveTimer);
    els.save.disabled = true;
    els.save.textContent = 'Проверяем…';

    await requestStatus(forceNow);

    els.save.disabled = false;
    els.save.textContent = 'Сохранить и проверить';
  }

  els.form.addEventListener('submit', (event) => {
    event.preventDefault();
    saveSettings(true, true);
  });

  // Автосохранение, чтобы настройки не терялись при закрытии popup
  els.form.addEventListener('input', (event) => {
    if (event.target === els.sheetUrl) return;

    if (event.target === els.fullName || event.target === els.group) {
      clearSettingsInvalid(event.target);
    }

    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveSettings(false, false), 800);
  });

  els.sheetUrl.addEventListener('input', () => {
    setSourceMessage('', false);
    updateSourceDraftState();
  });

  els.sheetUrl.addEventListener('change', async () => {
    const result = await saveSource();
    if (result.ok) {
      await requestStatus(result.changed);
    } else {
      els.sourceBox.open = true;
      syncSourceMode();
    }
  });

  els.refresh.addEventListener('click', async () => {
    if (refreshing) return;

    refreshing = true;
    els.refresh.disabled = true;
    els.refresh.textContent = 'Обновляем…';

    await requestStatus(true);

    refreshing = false;
    els.refresh.disabled = false;
    els.refresh.textContent = 'Обновить';
  });

  els.showOverlay.addEventListener('click', async () => {
    await chrome.storage.local.set({ dutyOverlayMutedUntil: 0 }).catch(() => {});
    updateOverlayLink(0);

    // Показываем сразу в текущей вкладке, не дожидаясь её перезагрузки.
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tab = tabs && tabs[0];

      if (tab && tab.id != null) {
        await chrome.tabs.sendMessage(tab.id, { type: 'duty:showOverlay' });
        return;
      }
    } catch {
      /* вкладка без content-скрипта — сбросим дневную отметку */
    }

    await chrome.storage.local.set({ dutyOverlayShownOn: '' }).catch(() => {});
  });

  // ==========================================
  // СТАТУС
  // ==========================================

  async function requestStatus(force) {
    let reply;

    try {
      reply = await chrome.runtime.sendMessage({ type: 'duty:getStatus', force: Boolean(force) });
    } catch {
      reply = {
        ok: false,
        error: 'Фоновый скрипт недоступен. Перезагрузите расширение.',
        errorKind: 'runtime',
      };
    }

    if (!reply || typeof reply !== 'object') {
      reply = { ok: false, error: 'Пустой ответ фонового скрипта.', errorKind: 'runtime' };
    }

    status = reply;
    render();
  }

  function render() {
    const view = buildView();

    els.status.dataset.tone = view.tone;
    els.live.dataset.tone = view.tone;
    els.week.textContent = view.week;
    els.title.textContent = view.title;
    els.sub.textContent = view.sub;

    renderList(view.lines);
    renderGroups(status && status.groups);

    if (status && status.sheetUrl) {
      els.sheetLink.href = status.sheetUrl;
      els.sheetLink.hidden = false;
    } else {
      els.sheetLink.removeAttribute('href');
      els.sheetLink.hidden = true;
    }

    // При проблеме со ссылкой сразу раскрываем блок — часто дело в переносе файла.
    if (view.openSource) {
      els.sourceBox.open = true;
      syncSourceMode();
      if (!sourceInvalid) {
        setSourceMessage(view.sourceHint || SOURCE_WARNING, view.sourceBad !== false);
      }
    } else if (!sourceInvalid) {
      setSourceMessage('', false);
    }

    renderUpdated();
  }

  function buildView() {
    const s = status;

    if (!s) {
      return { tone: 'loading', title: 'Проверяем график…', sub: '', week: '', lines: [] };
    }

    if (s.status === 'no-source') {
      return {
        tone: 'setup',
        title: 'Укажите ссылку на график',
        sub: 'Вставьте ссылку на таблицу Google Sheets. Ссылка нужна один раз — потом её можно поменять здесь же.',
        week: '',
        lines: [],
        openSource: true,
        sourceHint: SOURCE_WARNING,
        sourceBad: false,
      };
    }

    const week = s.week ? 'Неделя ' + s.week.label : '';

    if (s.configured === false) {
      const settings = s.settings || {};
      const missingName = !settings.fullName;
      const missingGroup = !settings.group;
      const title =
        missingName && missingGroup
          ? 'Заполните ФИО и группу'
          : missingName
            ? 'Укажите ФИО'
            : 'Укажите группу';

      return {
        tone: 'setup',
        title,
        sub: 'Оба поля обязательны — по ним расширение ищет дежурного в графике.',
        week,
        lines: [],
        openSource: false,
      };
    }

    if (!s.ok) {
      const message = s.error || 'Ошибка загрузки графика';
      const kind = s.errorKind || 'unknown';

      if (kind === 'runtime') {
        return {
          tone: 'error',
          title: 'Расширение не отвечает',
          sub: message,
          week: '',
          lines: [],
          openSource: false,
        };
      }

      if (kind === 'network') {
        return {
          tone: 'error',
          title: 'Нет связи с Google Sheets',
          sub: 'Проверьте интернет и нажмите «Обновить».',
          week: '',
          lines: [],
          openSource: false,
        };
      }

      if (kind === 'empty') {
        return {
          tone: 'error',
          title: 'В графике нет данных',
          sub: 'Таблица пустая: все ячейки пустые. Заполните график или проверьте ссылку.',
          week: '',
          lines: [],
          openSource: false,
        };
      }

      return {
        tone: 'error',
        title: 'График недоступен',
        sub: message.replace(/\.?$/, '.') + ' Проверьте ссылку на график ниже.',
        week: '',
        lines: [],
        openSource: true,
      };
    }

    if (!s.week) {
      return {
        tone: 'unknown',
        title: 'Не удалось найти текущую неделю',
        sub: 'В таблице нет недели с текущей датой. Возможно, график перенесли — проверьте ссылку ниже.',
        week: '',
        lines: [],
        openSource: true,
      };
    }

    if (s.status === 'unfilled') {
      return {
        tone: 'error',
        title: 'В расписании не заполнен дежурный!',
        sub: 'Текущая неделя есть, но в строке вашей группы пустая ячейка. Заполните дежурного в графике.',
        week,
        lines: (s.emptyGroups || []).map((item) => ({
          label: item.group || (s.settings && s.settings.group) || 'Ваша группа',
          value: 'дежурный не указан',
        })),
        openSource: false,
      };
    }

    if (s.onDuty) {
      return {
        tone: 'on',
        title: 'Вы дежурный',
        sub: s.todayDuty ? 'Сегодня ваш день по графику' : 'Дежурство на этой неделе',
        week,
        lines: (s.matches || []).map((match) => ({
          label: match.group,
          value: match.entry,
          chip: match.today ? 'сегодня' : '',
          note:
            match.kind === 'fallback'
              ? 'по правилу «если пусто»'
              : match.kind === 'other'
                ? s.settings && s.settings.group
                  ? 'вы указаны в другой группе'
                  : 'найдено по ФИО'
                : '',
        })),
      };
    }

    const lines = [];
    if (s.groupEntry && s.groupEntry.entry) {
      lines.push({
        label: s.groupEntry.group || s.settings.group,
        value: s.groupEntry.entry,
        note: s.groupEntry.fallback ? 'по правилу «если пусто»' : '',
      });
    }

    return {
      tone: 'off',
      title: 'Вы не дежурный',
      sub: lines.length ? 'На этой неделе дежурит другой сотрудник' : 'На этой неделе вы не указаны в графике',
      week,
      lines,
    };
  }

  function renderList(lines) {
    els.list.textContent = '';

    if (!lines.length) {
      els.list.hidden = true;
      return;
    }

    for (const line of lines) {
      const row = document.createElement('div');
      row.className = 'status-line';

      if (line.label) {
        const label = document.createElement('span');
        label.className = 'label';
        label.textContent = line.label;
        row.appendChild(label);
      }

      const value = document.createElement('span');
      value.className = 'value';
      value.textContent = line.value || '';
      row.appendChild(value);

      if (line.chip) {
        const chip = document.createElement('span');
        chip.className = 'chip';
        chip.textContent = line.chip;
        row.appendChild(chip);
      }

      if (line.note) {
        const note = document.createElement('span');
        note.className = 'note';
        note.textContent = ' — ' + line.note;
        row.appendChild(note);
      }

      els.list.appendChild(row);
    }

    els.list.hidden = false;
  }

  function renderGroups(groups) {
    const names = Array.isArray(groups) ? groups : [];
    const key = names.length + '|' + names.slice(0, 3).join('|');
    if (key === groupsKey) return;

    groupsKey = key;
    els.groupList.textContent = '';

    for (const name of names) {
      const option = document.createElement('option');
      option.value = name;
      els.groupList.appendChild(option);
    }
  }

  function renderUpdated() {
    if (status && status.ok && status.updatedAt) {
      els.updated.textContent = 'Обновлено ' + formatTime(status.updatedAt);
    } else {
      els.updated.textContent = '';
    }

    els.updated.title = '';
  }

  function updateOverlayLink(mutedUntil) {
    els.showOverlay.hidden = !(Number(mutedUntil) > Date.now());
  }

  function formatTime(timestamp) {
    const date = new Date(Number(timestamp));
    if (Number.isNaN(date.getTime())) return '';

    const time =
      String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0');
    const today = new Date();

    if (date.toDateString() === today.toDateString()) return 'в ' + time;
    return String(date.getDate()).padStart(2, '0') + '.' + String(date.getMonth() + 1).padStart(2, '0') + ' ' + time;
  }
})();
