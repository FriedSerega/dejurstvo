// ==========================================
// CONTENT SCRIPT — плашка «вы дежурный?» поверх страницы
// ==========================================
(() => {
  'use strict';

  if (window.top !== window.self) return;
  if (window.__dutyOverlayLoaded) return;
  window.__dutyOverlayLoaded = true;

  const HOST_ID = 'duty-week-overlay';
  const REFRESH_INTERVAL_MS = 15 * 60 * 1000;
  const DAILY_CARD_MS = 12 * 1000;

  const CSS = `
    :host { all: initial; }
    *, *::before, *::after { box-sizing: border-box; }

    .dw {
      all: initial;
      position: fixed;
      right: 16px;
      bottom: 16px;
      z-index: 2147483647;
      display: block;
      font-family: Inter, "Segoe UI", Roboto, Arial, sans-serif;
      font-size: 13px;
      line-height: 1.45;
      color: #1a1d21;
      text-align: left;
      -webkit-font-smoothing: antialiased;
    }

    .dw[data-tone="on"] { --tone: #e8590c; --tone-soft: #fff1e6; --action: #e8590c; }
    .dw[data-tone="off"] { --tone: #5a6273; --tone-soft: #f2f4f7; --action: #0085f2; }
    .dw[data-tone="setup"] { --tone: #0085f2; --tone-soft: #eaf4ff; --action: #0085f2; }
    .dw[data-tone="error"] { --tone: #d92d20; --tone-soft: #fef3f2; --action: #0085f2; }
    .dw[data-tone="unknown"] { --tone: #9a6700; --tone-soft: #fff7e6; --action: #0085f2; }
    .dw[data-tone="loading"] { --tone: #c9cfd6; --tone-soft: #f7f8fa; --action: #0085f2; }

    .card {
      position: relative;
      display: block;
      width: 300px;
      max-width: calc(100vw - 32px);
      padding: 13px 14px 12px;
      border: 1px solid #e6e9ef;
      border-left: 3px solid var(--tone, #c9cfd6);
      border-radius: 12px;
      background: #ffffff;
      box-shadow: 0 12px 32px rgba(16, 24, 40, 0.18), 0 2px 6px rgba(16, 24, 40, 0.08);
      animation: dw-in 0.16s ease-out;
    }

    @keyframes dw-in {
      from { opacity: 0; transform: translateY(4px); }
      to { opacity: 1; transform: none; }
    }

    .tools {
      position: absolute;
      top: 8px;
      right: 8px;
      display: flex;
      gap: 2px;
    }

    .tool {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 22px;
      height: 22px;
      padding: 0;
      border: 0;
      border-radius: 6px;
      background: transparent;
      color: #8991a9;
      cursor: pointer;
      font: inherit;
    }

    .tool:hover { background: #f2f4f7; color: #1a1d21; }

    .tool svg {
      width: 14px;
      height: 14px;
      fill: none;
      stroke: currentColor;
      stroke-width: 1.8;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .head {
      display: flex;
      align-items: center;
      gap: 8px;
      padding-right: 46px;
    }

    .logo {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 26px;
      height: 26px;
      flex: 0 0 auto;
      border-radius: 7px;
      background: var(--tone-soft, #f2f4f7);
      color: var(--tone, #8991a9);
    }

    .logo svg {
      width: 15px;
      height: 15px;
      fill: none;
      stroke: currentColor;
      stroke-width: 1.9;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .head-text { min-width: 0; display: block; }

    .kicker {
      display: block;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.07em;
      text-transform: uppercase;
      color: #8991a9;
    }

    .week {
      display: block;
      font-size: 11.5px;
      color: #5a6273;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .title {
      display: block;
      margin: 9px 0 0;
      font-size: 17px;
      line-height: 1.25;
      font-weight: 650;
      letter-spacing: -0.01em;
      color: #1a1d21;
    }

    .dw[data-tone="error"] .title { color: var(--tone); }

    .sub {
      display: block;
      margin: 2px 0 0;
      font-size: 11.5px;
      line-height: 1.4;
      color: #5a6273;
    }

    .sub:empty { display: none; }

    .detail {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin-top: 9px;
      padding: 8px 10px;
      border-radius: 8px;
      background: #f7f8fa;
    }

    .detail[hidden] { display: none; }

    .line { display: block; font-size: 12px; line-height: 1.4; }

    .line .label {
      display: block;
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: #8991a9;
    }

    .line .value { color: #1a1d21; overflow-wrap: anywhere; }
    .line .note { color: #5a6273; }

    .chip {
      display: inline-block;
      margin-left: 5px;
      padding: 1px 6px;
      border-radius: 999px;
      background: #fff1e6;
      color: #c2410c;
      font-size: 10px;
      font-weight: 600;
      vertical-align: 1px;
      white-space: nowrap;
    }

    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      margin-top: 11px;
    }

    .btn {
      flex: 1 1 auto;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      height: 30px;
      padding: 0 7px;
      border: 1px solid #e6e9ef;
      border-radius: 8px;
      background: #ffffff;
      color: #3d4453;
      font: inherit;
      font-size: 12px;
      font-weight: 600;
      line-height: 1;
      text-decoration: none;
      white-space: nowrap;
      cursor: pointer;
    }

    .btn:hover { background: #f2f4f7; color: #1a1d21; }
    .btn[hidden] { display: none; }

    .btn.primary {
      border-color: transparent;
      background: var(--action, #0085f2);
      color: #ffffff;
    }

    .btn.primary:hover { filter: brightness(0.95); color: #ffffff; }

    .foot {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      margin-top: 8px;
      font-size: 10.5px;
      color: #8991a9;
    }

    .pill {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      height: 34px;
      padding: 0 13px;
      border: 1px solid #e6e9ef;
      border-radius: 999px;
      background: #ffffff;
      color: #1a1d21;
      font: inherit;
      font-size: 12.5px;
      font-weight: 600;
      white-space: nowrap;
      cursor: pointer;
      box-shadow: 0 8px 24px rgba(16, 24, 40, 0.18), 0 2px 6px rgba(16, 24, 40, 0.08);
    }

    .pill:hover { background: #f7f8fa; }

    .pill .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--tone, #c9cfd6);
    }

    .dw[data-tone="on"] .pill .dot { box-shadow: 0 0 0 3px rgba(232, 89, 12, 0.16); }

    .dw[data-view="pill"] .card { display: none; }
    .dw[data-view="card"] .pill { display: none; }
    .dw[data-hidden="1"] { display: none; }

    .dw button:focus-visible,
    .dw a:focus-visible {
      outline: 2px solid rgba(0, 133, 242, 0.45);
      outline-offset: 2px;
    }

    @media (prefers-reduced-motion: reduce) {
      .card { animation: none; }
    }
  `;

  const MARKUP = `
    <div class="dw" data-view="card" data-tone="loading" data-hidden="1">
      <section class="card" role="status" aria-live="polite">
        <div class="tools">
          <button class="tool" type="button" data-action="collapse" title="Свернуть" aria-label="Свернуть">
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 6l5 5 5-5"/></svg>
          </button>
          <button class="tool" type="button" data-action="mute" title="Скрыть плашку до завтра" aria-label="Скрыть плашку до завтра">
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>
          </button>
        </div>
        <div class="head">
          <span class="logo" aria-hidden="true">
            <svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>
          </span>
          <div class="head-text">
            <span class="kicker">Дежурство</span>
            <span class="week"></span>
          </div>
        </div>
        <h2 class="title">Проверяем график…</h2>
        <p class="sub"></p>
        <div class="detail" hidden></div>
        <div class="actions">
          <button class="btn" type="button" data-action="settings" hidden>Настроить</button>
          <button class="btn primary" type="button" data-action="refresh" title="Обновить данные графика">Обновить</button>
          <a class="btn" data-role="sheet" target="_blank" rel="noopener noreferrer" title="Открыть график в Google Sheets" aria-label="Открыть график в Google Sheets">График</a>
        </div>
        <div class="foot"><span data-role="updated"></span><span data-role="source"></span></div>
      </section>
      <button class="pill" type="button" data-action="expand" aria-label="Развернуть">
        <span class="dot"></span><span class="pill-text">Дежурство</span>
      </button>
    </div>
  `;

  let host = null;
  let root = null;
  let els = null;
  let data = null;
  let collapsed = false;
  let requestSeq = 0;
  let refreshTimer = 0;
  let unmuteTimer = 0;
  let autoCollapseTimer = 0;
  let contextDead = false;
  const dailyDays = { duty: '', alert: '' };

  boot().catch((err) => {
    if (isContextInvalidated(err)) shutdownForReload();
  });

  function isContextInvalidated(error) {
    return /Extension context invalidated|context invalidated/i.test(
      String((error && error.message) || error || '')
    );
  }

  /**
   * После обновления расширения старый content-скрипт больше не может
   * общаться с chrome.*. Убираем плашку и таймеры, чтобы страница не
   * продолжала получать ошибки «Extension context invalidated».
   */
  function shutdownForReload() {
    if (contextDead) return;
    contextDead = true;

    clearInterval(refreshTimer);
    clearTimeout(unmuteTimer);
    clearAutoCollapse();
    refreshTimer = 0;
    unmuteTimer = 0;

    if (host) host.remove();
    host = null;
    root = null;
    els = null;
  }

  async function storageGet(keys) {
    if (contextDead) return {};
    try {
      return await chrome.storage.local.get(keys);
    } catch (err) {
      if (isContextInvalidated(err)) shutdownForReload();
      return {};
    }
  }

  async function storageSet(values) {
    if (contextDead) return false;
    try {
      await chrome.storage.local.set(values);
      return true;
    } catch (err) {
      if (isContextInvalidated(err)) shutdownForReload();
      return false;
    }
  }

  async function sendRuntimeMessage(message) {
    if (contextDead) throw new Error('Extension context invalidated');
    try {
      return await chrome.runtime.sendMessage(message);
    } catch (err) {
      if (isContextInvalidated(err)) shutdownForReload();
      throw err;
    }
  }

  async function boot() {
    const stored = await readLocal(['dutyOverlayCollapsed', 'dutyOverlayMutedUntil']);
    if (contextDead) return;
    collapsed = Boolean(stored.dutyOverlayCollapsed);

    const mutedUntil = Number(stored.dutyOverlayMutedUntil) || 0;

    try {
      chrome.storage.onChanged.addListener(onStorageChanged);
      chrome.runtime.onMessage.addListener(onMessage);
      document.addEventListener('visibilitychange', onVisibilityChange);
    } catch (err) {
      if (isContextInvalidated(err)) {
        shutdownForReload();
        return;
      }
      throw err;
    }

    if (mutedUntil > Date.now()) {
      scheduleUnmute(mutedUntil);
      return;
    }

    createUi();
    // При открытии/перезагрузке страницы всегда проверяем таблицу заново:
    // иначе после очистки графика можно долго видеть старый результат из кеша.
    await refresh(true);
    if (!contextDead) startPolling();
  }

  function onVisibilityChange() {
    if (contextDead || document.visibilityState !== 'visible') return;

    // Вернулись на вкладку — сразу проверяем таблицу, не ждём таймер.
    if (els) void refresh(true).catch(() => {});
    void syncOverlay().catch(() => {});
  }

  function onMessage(message, sender, sendResponse) {
    if (!message || message.type !== 'duty:showOverlay') return false;

    forceReveal()
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  function startPolling() {
    if (contextDead) return;
    clearInterval(refreshTimer);
    refreshTimer = setInterval(() => {
      if (contextDead) return;
      void refresh(false).catch(() => {});
    }, REFRESH_INTERVAL_MS);
  }

  function createUi() {
    if (contextDead || document.getElementById(HOST_ID)) return;

    host = document.createElement('div');
    host.id = HOST_ID;
    (document.body || document.documentElement).appendChild(host);

    root = host.attachShadow({ mode: 'open' });
    root.innerHTML = '<style>' + CSS + '</style>' + MARKUP;

    els = {
      dw: root.querySelector('.dw'),
      title: root.querySelector('.title'),
      sub: root.querySelector('.sub'),
      week: root.querySelector('.week'),
      detail: root.querySelector('.detail'),
      updated: root.querySelector('[data-role="updated"]'),
      source: root.querySelector('[data-role="source"]'),
      sheet: root.querySelector('[data-role="sheet"]'),
      refresh: root.querySelector('[data-action="refresh"]'),
      settings: root.querySelector('[data-action="settings"]'),
      pill: root.querySelector('.pill'),
      pillText: root.querySelector('.pill-text'),
    };

    els.sheet.hidden = true;
    setCollapsed(collapsed, false);
    root.addEventListener('click', onClick);
    render();
  }

  function removeUi() {
    clearInterval(refreshTimer);
    clearAutoCollapse();
    refreshTimer = 0;
    dailyDays.duty = '';
    dailyDays.alert = '';

    if (host) host.remove();
    host = null;
    root = null;
    els = null;
  }

  function scheduleUnmute(until) {
    clearTimeout(unmuteTimer);
    if (contextDead || !until || until <= Date.now()) return;

    const delay = Math.min(until - Date.now(), 24 * 60 * 60 * 1000);
    unmuteTimer = setTimeout(() => {
      if (contextDead) return;
      if (!host) {
        createUi();
        void refresh(false).catch(() => {});
        startPolling();
      }
    }, Math.max(1000, delay));
  }

  function onStorageChanged(changes, area) {
    if (contextDead) return;

    if (area === 'local' && changes.dutyOverlayMutedUntil) {
      const until = Number(changes.dutyOverlayMutedUntil.newValue) || 0;

      if (until > Date.now()) {
        removeUi();
        scheduleUnmute(until);
      } else {
        clearTimeout(unmuteTimer);
        if (!host) {
          createUi();
          void refresh(false).catch(() => {});
          startPolling();
        }
      }
    }

    // Фоновая проверка публикует свежий статус — применяем его без F5.
    if (area === 'local' && changes.dutyLiveStatus) {
      const next = changes.dutyLiveStatus.newValue;
      if (next && typeof next === 'object' && els) {
        data = next;
        render();
        void syncOverlay().catch(() => {});
      }
    }

    // Свёрнутость — локальное состояние вкладки: разворачивать пилюлю
    // во всех вкладках из-за клика в одной не нужно.

    if (changes.dutySettings || changes.dutySource) void refresh(false).catch(() => {});
  }

  async function refresh(force) {
    if (contextDead || !els) return;

    const seq = ++requestSeq;
    if (!data) render();

    els.refresh.disabled = true;

    let next;
    try {
      next = await sendRuntimeMessage({ type: 'duty:getStatus', force: Boolean(force) });
      if (!next || typeof next !== 'object') {
        next = {
          ok: false,
          error: 'Фоновый скрипт не ответил. Попробуйте ещё раз.',
          errorKind: 'runtime',
        };
      }
    } catch {
      if (contextDead) return;
      next = {
        ok: false,
        error: 'Расширение было обновлено — перезагрузите страницу.',
        errorKind: 'runtime',
      };
    }

    if (contextDead || seq !== requestSeq || !els) return;

    data = next;
    els.refresh.disabled = false;
    render();
    void syncOverlay().catch(() => {});
  }

  /** Нет ссылки, ошибка загрузки, пустая таблица, нет недели или не заполнен дежурный. */
  function isAlertStatus(d) {
    if (!d) return false;
    if (d.configured === false) return false;
    if (d.status === 'unconfigured') return false;
    if (d.status === 'no-source') return true;
    if (d.status === 'unfilled') return true;
    if (!d.ok) return true;
    return !d.week;
  }

  /** Плашку показываем дежурному и при проблемах с графиком. */
  function shouldShowOverlay(d) {
    if (!d) return false;
    if (isAlertStatus(d)) return true;
    return d.ok && d.onDuty;
  }

  /**
   * Пока пользователь дежурит, в углу всегда висит свёрнутая пилюля.
   * Раз в календарный день первая видимая вкладка разворачивает её в карточку.
   * Так же ведут себя предупреждения: «график недоступен», «нет текущей недели»
   * и «не заполнен дежурный».
   * Право на разворот выдаёт фоновый скрипт, чтобы карточка не появилась
   * сразу в нескольких вкладках.
   */
  async function syncOverlay() {
    if (!els) return;

    if (!shouldShowOverlay(data)) {
      els.dw.dataset.hidden = '1';
      return;
    }

    const local = await readLocal(['dutyOverlayMutedUntil']);
    if (Number(local.dutyOverlayMutedUntil) > Date.now()) {
      els.dw.dataset.hidden = '1';
      return;
    }

    if (!els) return;

    const kind = isAlertStatus(data) ? 'alert' : 'duty';

    // Пилюля уже на экране: проверяем только, не наступил ли новый день.
    if (els.dw.dataset.hidden === '0') {
      maybeShowDayCard(kind);
      return;
    }

    if (await maybeShowDayCard(kind)) return;
    if (!els || els.dw.dataset.hidden === '0') return;

    revealPill();
  }

  /** Разворачивает карточку, если сегодня её ещё не показывали. */
  async function maybeShowDayCard(kind) {
    const key = kind === 'alert' ? 'alert' : 'duty';

    if (!els || dailyDays[key] === todayKey()) return false;

    if (kind === 'alert') {
      if (!isAlertStatus(data)) return false;
    } else if (!data || !data.ok || !data.onDuty) {
      return false;
    }

    if (document.visibilityState !== 'visible') return false;

    const local = await readLocal(['dutyOverlayMutedUntil']);
    if (Number(local.dutyOverlayMutedUntil) > Date.now()) return false;

    let claim = null;
    try {
      claim = await sendRuntimeMessage({
        type: kind === 'alert' ? 'duty:claimAlert' : 'duty:claimDaily',
      });
    } catch {
      if (contextDead) return false;
      claim = null;
    }

    if (contextDead || !claim) return false;
    if (!claim.show) {
      dailyDays[key] = todayKey();
      return false;
    }

    if (!els || !shouldShowOverlay(data)) return false;
    if (key === 'alert' && !isAlertStatus(data)) return false;
    if (key === 'duty' && (!data.ok || !data.onDuty)) return false;

    dailyDays[key] = todayKey();
    revealCard();
    return true;
  }

  /** Показ по кнопке «Вернуть плашку»: карточка, если её ещё не было сегодня. */
  async function forceReveal() {
    if (!host) {
      createUi();
      startPolling();
    }

    if (!data) await refresh(false);
    if (!shouldShowOverlay(data)) return;
    if (!els || els.dw.dataset.hidden === '0') return;

    const local = await readLocal(['dutyOverlayMutedUntil']);
    if (Number(local.dutyOverlayMutedUntil) > Date.now()) return;

    const kind = isAlertStatus(data) ? 'alert' : 'duty';

    if (await maybeShowDayCard(kind)) return;
    if (!els || els.dw.dataset.hidden === '0') return;

    revealPill();
  }

  function revealCard() {
    if (!els) return;

    clearAutoCollapse();
    els.dw.dataset.hidden = '0';
    setCollapsed(false, false);
    render();

    autoCollapseTimer = setTimeout(() => {
      autoCollapseTimer = 0;
      if (!els || els.dw.dataset.view !== 'card') return;
      setCollapsed(true, false);
    }, DAILY_CARD_MS);
  }

  function revealPill() {
    if (!els) return;

    clearAutoCollapse();
    els.dw.dataset.hidden = '0';
    setCollapsed(true, false);
    render();
  }

  function clearAutoCollapse() {
    clearTimeout(autoCollapseTimer);
    autoCollapseTimer = 0;
  }

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

  function render() {
    if (!els) return;

    const view = buildView(data);

    // Показываем только дежурство и проблемы с графиком (ошибка / нет недели).
    // «Не настроено» и подтверждённое «не дежурный» видны в окне расширения.
    if (data && !shouldShowOverlay(data)) {
      clearAutoCollapse();
      els.dw.dataset.hidden = '1';
    }

    els.dw.dataset.tone = view.tone;
    els.title.textContent = view.title;
    els.sub.textContent = view.sub || '';
    els.week.textContent = view.week || '';
    els.pillText.textContent = view.pill;
    const pillLabel = view.pill;
    els.pill.setAttribute('aria-label', pillLabel + ' — развернуть подробности');
    els.pill.title = pillLabel + ' — развернуть подробности';

    els.settings.hidden = !view.showSettings;
    els.refresh.hidden = !view.showRefresh;
    els.settings.textContent = view.settingsLabel || 'Настроить';
    els.settings.classList.toggle('primary', view.showSettings);
    els.refresh.classList.toggle('primary', !view.showSettings);

    if (data && data.sheetUrl) {
      els.sheet.href = data.sheetUrl;
      els.sheet.hidden = false;
    } else {
      els.sheet.removeAttribute('href');
      els.sheet.hidden = true;
    }
    renderDetail(view.lines);

    if (data && data.ok && data.updatedAt) {
      els.updated.textContent = 'Обновлено ' + formatTime(data.updatedAt);
    } else {
      els.updated.textContent = '';
    }

    els.source.textContent = '';
    els.source.className = '';
    els.source.title = '';
  }

  function buildView(d) {
    const base = {
      tone: 'loading',
      title: 'Проверяем график…',
      sub: '',
      week: '',
      lines: [],
      pill: 'Дежурство',
      showSettings: false,
      showRefresh: true,
      settingsLabel: 'Настроить',
    };

    if (!d) return base;

    if (d.status === 'no-source') {
      return {
        ...base,
        tone: 'setup',
        title: 'Укажите ссылку на график',
        sub: 'Откройте расширение и вставьте ссылку на таблицу Google Sheets.',
        pill: 'Нет ссылки',
        showSettings: true,
        showRefresh: false,
      };
    }

    if (!d.ok) {
      const message = d.error || 'Не удалось загрузить график';
      const kind = d.errorKind || 'unknown';

      if (kind === 'runtime') {
        return {
          ...base,
          tone: 'error',
          title: 'Расширение не отвечает',
          sub: message,
          pill: 'Ошибка',
        };
      }

      if (kind === 'network') {
        return {
          ...base,
          tone: 'error',
          title: 'Нет связи с Google Sheets',
          sub: 'Проверьте интернет и обновите данные.',
          pill: 'Нет связи',
        };
      }

      if (kind === 'empty') {
        return {
          ...base,
          tone: 'error',
          title: 'В графике нет данных',
          sub: 'Таблица пустая: все ячейки пустые. Заполните график или проверьте ссылку.',
          pill: 'Нет данных',
          showSettings: true,
          settingsLabel: 'Проверить ссылку',
        };
      }

      return {
        ...base,
        tone: 'error',
        title: 'График недоступен',
        sub: message.replace(/\.?$/, '.'),
        pill: 'Нет графика',
        showSettings: true,
        settingsLabel: 'Проверить ссылку',
      };
    }

    const week = d.week ? 'Неделя ' + d.week.label : '';

    if (!d.configured) {
      return {
        ...base,
        tone: 'setup',
        title: 'Заполните ФИО и группу',
        sub: 'Оба поля обязательны — по ним расширение ищет дежурного в графике.',
        week,
        pill: 'Настроить',
        showSettings: true,
        showRefresh: false,
      };
    }

    if (!d.week) {
      return {
        ...base,
        tone: 'unknown',
        title: 'Не удалось найти текущую неделю',
        sub: 'В таблице нет недели с текущей датой. Возможно, график перенесли — проверьте ссылку.',
        pill: 'Нет недели',
        showSettings: true,
        settingsLabel: 'Проверить ссылку',
      };
    }

    if (d.status === 'unfilled') {
      return {
        ...base,
        tone: 'error',
        title: 'В расписании не заполнен дежурный!',
        sub: 'Текущая неделя есть, но в строке вашей группы пустая ячейка. Заполните дежурного в графике.',
        week,
        lines: (d.emptyGroups || []).map((item) => ({
          label: item.group || (d.settings && d.settings.group) || 'Ваша группа',
          value: 'дежурный не указан',
        })),
        pill: 'Не заполнено',
      };
    }

    if (d.onDuty) {
      const lines = (d.matches || []).map((match) => ({
        label: match.group,
        value: match.entry,
        chip: match.today ? 'сегодня' : '',
        note:
          match.kind === 'fallback'
            ? 'по правилу «если пусто»'
            : match.kind === 'other'
              ? d.settings && d.settings.group
                ? 'вы указаны в другой группе'
                : 'найдено по ФИО'
              : '',
      }));

      return {
        ...base,
        tone: 'on',
        title: 'Вы дежурный',
        sub: d.todayDuty ? 'Сегодня ваш день по графику' : 'На этой неделе дежурите вы',
        week,
        lines,
        pill: 'Дежурный',
      };
    }

    const lines = [];
    if (d.groupEntry && d.groupEntry.entry) {
      lines.push({
        label: d.groupEntry.group || d.settings.group,
        value: d.groupEntry.entry,
        note: d.groupEntry.fallback ? 'по правилу «если пусто»' : '',
      });
    }

    return {
      ...base,
      tone: 'off',
      title: 'Вы не дежурный',
      sub: lines.length ? 'На этой неделе дежурит другой сотрудник' : 'На этой неделе вы не указаны в графике',
      week,
      lines,
      pill: 'Не дежурный',
    };
  }

  function renderDetail(lines) {
    const box = els.detail;
    box.textContent = '';

    if (!lines.length) {
      box.hidden = true;
      return;
    }

    for (const line of lines) {
      const row = document.createElement('div');
      row.className = 'line';

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

      box.appendChild(row);
    }

    box.hidden = false;
  }

  function setCollapsed(value, persist) {
    collapsed = Boolean(value);
    if (els) els.dw.dataset.view = collapsed ? 'pill' : 'card';
    if (persist) void storageSet({ dutyOverlayCollapsed: collapsed });
  }

  function onClick(event) {
    const node = event.target instanceof Element ? event.target.closest('[data-action]') : null;
    if (!node) return;

    const action = node.dataset.action;

    if (action === 'expand') {
      event.preventDefault();
      clearAutoCollapse();
      setCollapsed(false, true);
    } else if (action === 'collapse') {
      event.preventDefault();
      clearAutoCollapse();
      setCollapsed(true, true);
    } else if (action === 'refresh') {
      event.preventDefault();
      void refresh(true).catch(() => {});
    } else if (action === 'settings') {
      event.preventDefault();
      void sendRuntimeMessage({ type: 'duty:openSettings' }).catch(() => {});
    } else if (action === 'mute') {
      event.preventDefault();
      muteUntilTomorrow();
    }
  }

  function muteUntilTomorrow() {
    const until = new Date();
    until.setHours(24, 0, 0, 0);

    void storageSet({ dutyOverlayMutedUntil: until.getTime() });
    removeUi();
    if (!contextDead) scheduleUnmute(until.getTime());
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

  async function readLocal(keys) {
    return storageGet(keys);
  }
})();
