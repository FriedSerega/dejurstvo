/* Тестовый стенд: минимальная подмена chrome.* API и fetch для проверки
   background.js + content.js в обычной странице. Не входит в расширение. */
(() => {
  'use strict';

  const store = { local: {}, sync: {} };
  const messageListeners = [];
  const storageListeners = [];
  const badge = { text: '', color: '', title: '' };
  const alarms = {};

  function pick(area, keys) {
    const source = store[area];
    const out = {};

    if (keys == null) return { ...source };

    if (typeof keys === 'string') {
      if (keys in source) out[keys] = source[keys];
      return out;
    }

    if (Array.isArray(keys)) {
      for (const key of keys) if (key in source) out[key] = source[key];
      return out;
    }

    for (const key of Object.keys(keys)) out[key] = key in source ? source[key] : keys[key];
    return out;
  }

  function makeArea(name) {
    return {
      async get(keys) {
        return pick(name, keys);
      },
      async set(values) {
        const changes = {};
        for (const [key, value] of Object.entries(values)) {
          changes[key] = { oldValue: store[name][key], newValue: value };
          store[name][key] = value;
        }
        for (const listener of storageListeners) listener(changes, name);
      },
      async remove(keys) {
        const list = Array.isArray(keys) ? keys : [keys];
        for (const key of list) delete store[name][key];
      },
      async clear() {
        store[name] = {};
      },
    };
  }

  window.chrome = {
    runtime: {
      id: 'demo-extension',
      getURL: (path) => path,
      sendMessage: (message) =>
        new Promise((resolve, reject) => {
          let responded = false;
          const sender = { id: 'demo-extension', tab: { id: 1 }, url: location.href };

          for (const listener of messageListeners) {
            const result = listener(message, sender, (response) => {
              responded = true;
              resolve(response);
            });

            if (result === true) return;
          }

          if (!responded) reject(new Error('Нет обработчика сообщения'));
        }),
      onMessage: { addListener: (listener) => messageListeners.push(listener) },
      onInstalled: { addListener: () => {} },
      onStartup: { addListener: () => {} },
    },
    storage: {
      local: makeArea('local'),
      sync: makeArea('sync'),
      onChanged: { addListener: (listener) => storageListeners.push(listener) },
    },
    alarms: {
      create: (name, info) => {
        alarms[name] = { name, ...(info || {}) };
      },
      get: async (name) => alarms[name],
      onAlarm: { addListener: () => {} },
    },
    action: {
      setBadgeText: async ({ text }) => {
        badge.text = text;
      },
      setBadgeBackgroundColor: async ({ color }) => {
        badge.color = color;
      },
      setTitle: async ({ title }) => {
        badge.title = title;
      },
      openPopup: async () => {},
    },
    tabs: { create: async () => {} },
  };

  // background.js вызывает importScripts — библиотека уже подключена тегом <script>
  window.importScripts = () => {};

  const testSourceUrl =
    'https://docs.google.com/spreadsheets/d/1TestSheetAbCdEfGhIjKlMnOpQrStUvWxYz012345/edit?gid=515172059#gid=515172059';

  window.__demo = {
    store,
    badge,
    messageListeners,
    storageListeners,
    fetchCount: 0,
    fetchUrls: [],
    mode: 'normal',
    sourceUrl: testSourceUrl,
  };

  const params = new URLSearchParams(location.search);
  if (params.get('fail') === '1') window.__demo.mode = 'fail';
  if (params.get('notfound') === '1') window.__demo.mode = '404';
  if (params.get('forbidden') === '1') window.__demo.mode = '403';
  if (params.get('noweek') === '1') window.__demo.mode = 'no-week';
  if (params.get('emptyfile') === '1') window.__demo.mode = 'empty';
  if (params.get('othertab') === '1') window.__demo.mode = 'other-tab';
  if (params.get('private') === '1') window.__demo.mode = 'login';

  window.fetch = async (url) => {
    const target = String(url);
    const demo = window.__demo;

    demo.fetchUrls.push(target);

    if (demo.mode === 'fail') throw new TypeError('Failed to fetch');
    if (demo.mode === '404') return new Response('', { status: 404 });
    if (demo.mode === '403') return new Response('', { status: 403 });

    if (demo.mode === 'login' && (target.includes('export?format=csv') || target.includes('gviz/tq'))) {
      return new Response('<!doctype html><html><body>Войдите в Google</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    }

    if (target.includes('export?format=csv') || target.includes('gviz/tq')) {
      demo.fetchCount += 1;

      if (demo.mode === 'no-week') {
        return new Response('Группы ,01.01-07.01\n', { status: 200 });
      }

      if (demo.mode === 'empty') {
        // Так Google может отдать лист, из которого удалили все значения.
        return new Response(',,,\n,,\n', { status: 200 });
      }

      if (demo.mode === 'other-tab' && target.includes('gid=' + '515172059')) {
        return new Response('Группы ,01.01-07.01\n', { status: 200 });
      }

      return new Response(window.FIXTURE_CSV || '', { status: 200 });
    }

    if (target.includes('/htmlview')) {
      if (demo.mode === 'no-week' || demo.mode === 'empty') {
        return new Response('items.push({name: "Лист1", gid: "515172059"});', { status: 200 });
      }

      return new Response('items.push({name: "Лист1", gid: "515172059"}); items.push({name: "Лист2", gid: "60629275"});', {
        status: 200,
      });
    }

    return new Response('', { status: 404 });
  };

  if (params.get('empty') !== '1') {
    const name = params.get('name');
    const group = params.get('group');

    store.sync.dutySettings = {
      fullName: name == null ? 'Полунин Иван' : name,
      group: group == null ? 'Оператор связи' : group,
    };
  }

  if (params.get('nosource') !== '1') {
    store.sync.dutySource = { url: testSourceUrl };
  }

  if (params.get('collapsed') === '1') store.local.dutyOverlayCollapsed = true;
  if (params.get('muted') === '1') store.local.dutyOverlayMutedUntil = Date.now() + 60 * 60 * 1000;

  if (params.get('shown') === '1') {
    const d = new Date();
    store.local.dutyOverlayShownOn =
      d.getFullYear() +
      '-' +
      String(d.getMonth() + 1).padStart(2, '0') +
      '-' +
      String(d.getDate()).padStart(2, '0');
  }
})();
