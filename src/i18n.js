// Словарь интерфейса. Один файл для окна лаунчера (window.I18N) и для main.js (require).
// Чтобы добавить язык: скопируйте блок `en`, переведите значения и добавьте код в LANGS.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.I18N = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const D = {
    ru: {
      // шапка и меню
      'hd.music': 'Музыка', 'hd.sfx': 'Звуки', 'hd.mode': 'Светлая / тёмная', 'hd.about': 'О лаунчере', 'hd.min': 'Свернуть', 'hd.home': 'На главный экран', 'hd.lang': 'Язык / Language',
      'nav.play': '▶ Играть', 'nav.acc': '☺ Аккаунты', 'nav.opt': '⚡ Оптимизация', 'nav.mods': '▣ Моды', 'nav.fx': '✦ Частицы', 'nav.theme': '❖ Тема',
      'splash.sub': 'лаунчер для Java Edition', 'splash.start': 'Начать',
      // играть
      'play.go': '▶ Играть', 'play.noacc': 'Нет аккаунта', 'play.noacc.d': 'Добавьте аккаунт во вкладке «Аккаунты»',
      'ver.t': 'Версия', 'ver.d': 'Релизы Minecraft Java', 'ver.ok': '✓ Установлена', 'ver.no': 'Не установлена — установится автоматически', 'ver.installing': 'Установка…', 'ver.done': 'Версия {v} установлена',
      'st.t': 'Статус', 'lg.ready': 'Готово к запуску', 'lg.launchErr': 'Ошибка запуска', 'lg.installErr': 'Ошибка установки', 'lg.closed': 'Игра закрыта',
      'runs.t': 'Запущенные клиенты', 'runs.d': 'Аккаунт можно сменить в любой момент — лаунчер и игра продолжат работать', 'runs.none': 'Нет запущенных клиентов', 'runs.ing': 'в игре', 'runs.mc': 'Minecraft {v} · PID {pid}',
      // аккаунты
      'acc.t': 'Аккаунты', 'acc.d': 'Нажмите на аккаунт, чтобы сделать его активным', 'acc.empty': 'Пока пусто',
      'acc.ms.d': 'Лицензионный аккаунт', 'acc.ms.btn': 'Войти', 'acc.off.t': 'Офлайн-ник', 'acc.off.d': 'Для одиночной игры и серверов без проверки', 'acc.add': 'Добавить', 'acc.del': 'Удалить',
      'acc.type.ms': 'Microsoft', 'acc.type.off': 'Офлайн',
      'acc.next': 'Следующий запуск — под {name}. Текущая игра не прервана', 'acc.sel': 'Аккаунт: {name}',
      // оптимизация
      'opt.ram.t': 'Память', 'opt.ram.d': 'Выделяемая ОЗУ', 'unit.gb': '{n} ГБ',
      'opt.jvm.t': 'Профиль JVM', 'opt.jvm.d': 'Настройки сборщика мусора', 'opt.jvm.light': 'Лёгкий', 'opt.jvm.none': 'Обычный',
      'opt.fab.d': 'Авто-установка Sodium, Lithium, FerriteCore для FPS',
      'opt.sav.t': 'Экономия в игре', 'opt.sav.d': 'Останавливать анимации фона, пока идёт игра',
      'opt.srv.t': 'Автовход на сервер', 'opt.srv.d': 'Адрес сервера: игра сразу зайдёт на него',
      'opt.java.t': 'Путь к Java', 'opt.java.d': 'Пусто — Java скачается автоматически',
      'opt.dir.t': 'Папка игры', 'opt.dir.d': 'Миры, моды, скриншоты', 'opt.dir.btn': 'Открыть',
      // моды
      'mod.t': 'Моды Modrinth', 'mod.ph': 'Поиск модов: Iris, Xaero, JourneyMap…',
      'mod.warn': 'Fabric выключен — включите его во вкладке «Оптимизация», иначе моды не загрузятся',
      'mod.found': 'Найдено', 'mod.inst': 'Установленные', 'mod.inst.d': '«авто» — оптимизирующие моды лаунчера',
      'mod.none': 'Ничего не найдено', 'mod.loading': 'Загрузка…', 'mod.loadErr': 'Не удалось загрузить: {e}',
      'mod.done': '✓ Установлено', 'mod.get': 'Установить', 'mod.dep': ' · зависимость', 'mod.auto': 'авто', 'mod.rm': 'Удалить', 'mod.empty': 'Пока нет модов',
      'mod.toast': 'Установлено: {list}', 'mod.already': 'уже есть',
      // частицы
      'fx.t': 'Частицы фона', 'fx.d': 'Плавающие огоньки',
      'fx.shape.t': 'Форма', 'fx.shape.d': 'Вид частиц', 'fx.pixel': 'Пиксели', 'fx.circle': 'Круги', 'fx.star': 'Звёзды', 'fx.ring': 'Кольца',
      'fx.dir.t': 'Направление', 'fx.dir.d': 'Куда летят частицы', 'fx.up': 'Вверх', 'fx.down': 'Вниз', 'fx.chaos': 'Хаос',
      'fx.size.t': 'Размер', 'fx.size.d': 'Масштаб частиц', 'fx.speed.t': 'Скорость', 'fx.speed.d': 'Темп движения',
      'fx.glow.t': 'Свечение', 'fx.glow.d': 'Мягкий ореол', 'fx.click.t': 'Всплеск по клику', 'fx.click.d': 'Искры там, где нажали',
      'fx.add.t': 'Добавить частицы', 'fx.add.d': '+20 к фону, салют или сброс', 'fx.burst': 'Салют', 'fx.reset': 'Сбросить',
      // тема
      'th.title': 'Цветовая гамма', 'th.d': '32 сочетания: акцент, подсветка, фон и частицы меняются плавно', 'th.rnd': '🎲 Случайная',
      'th.blur.t': 'Размытие панели', 'th.blur.d': 'Стеклянный эффект (нагружает видеокарту)',
      'themeNames': ['Изумруд', 'Аметист', 'Пламя', 'Иней', 'Закат', 'Океан', 'Лайм', 'Роза', 'Золото', 'Лаванда', 'Мята', 'Вишня', 'Космос', 'Неон', 'Лава', 'Лёд', 'Джунгли', 'Сумерки', 'Персик', 'Бирюза', 'Рубин', 'Электро', 'Арктика', 'Малина', 'Хвоя', 'Янтарь', 'Индиго', 'Сакура', 'Токсик', 'Пустота', 'Мандарин', 'Графит'],
      // «О лаунчере»
      'ab.author': 'Создатель', 'ab.ver': 'Версия {v}', 'ab.legal': 'Неофициальный лаунчер. Minecraft — торговая марка Mojang AB.', 'ab.close': 'Закрыть',
      // сообщения главного процесса
      'm.nick': 'Ник: 3–16 символов (буквы, цифры, _)',
      'm.ms.closed': 'Окно входа закрыто — попробуйте ещё раз', 'm.ms.noxbox': 'У этого Microsoft-аккаунта нет профиля Xbox. Создайте его на xbox.com и повторите',
      'm.ms.child': 'Детский аккаунт: родитель должен разрешить игру в семейной группе Microsoft', 'm.ms.country': 'В вашей стране Xbox Live недоступен',
      'm.ms.nogame': 'На этом аккаунте нет Minecraft Java Edition (игра не куплена)', 'm.ms.net': 'Нет соединения с серверами Microsoft',
      'm.ms.other': 'Не удалось войти в Microsoft: {t}', 'm.ms.expired': 'Сессия Microsoft истекла — войдите в аккаунт заново',
      'm.mod': 'Мод: {slug}', 'm.fab.unsup': 'Fabric не поддерживает {mc}', 'm.fab.p': 'Fabric и моды…', 'm.fab.crash': 'Fabric не запустился — запускаю без модов…',
      'm.java.prep': 'Подготовка Java…', 'm.java.mb': 'Java {major} {n} МБ', 'm.java.dl': 'Не удалось скачать Java {major} — проверьте интернет',
      'm.java.unpack': 'Распаковка Java…', 'm.java.unpackErr': 'Не удалось распаковать Java', 'm.java.nf': 'Java не найдена после распаковки', 'm.java.bad': 'Java по указанному пути не запускается',
      'm.inst.p': 'Установка {v}: {type}', 'm.inst.done': 'Версия {v} установлена', 'm.inst.fail': 'Не удалось установить {v} — проверьте интернет',
      'm.mr.err': 'Modrinth: ошибка {s}', 'm.mr.nover': '{title}: нет версии под {v}',
      'm.noacc': 'Выберите аккаунт', 'm.installing': 'Версия ещё устанавливается', 'm.dl': 'Загрузка: {type}',
      'm.game.err': 'Игра закрылась с ошибкой (код {code}). Проверьте моды и Java', 'm.launch.fail': 'Не удалось запустить (проверьте установленную Java)', 'm.running': 'Игра запущена',
      'm.upd.found': 'Найдено обновление лаунчера {v}, скачиваю…', 'm.upd.done': 'Обновление {v} скачано', 'm.upd.now': 'Перезапустить сейчас', 'm.upd.later': 'Позже',
      'm.upd.msg': 'Доступна новая версия {v}', 'm.upd.detail': 'Обновление скачано. Перезапустить лаунчер и установить его сейчас? Если выбрать «Позже», оно установится при закрытии.'
    },
    en: {
      'hd.music': 'Music', 'hd.sfx': 'Sounds', 'hd.mode': 'Light / dark', 'hd.about': 'About', 'hd.min': 'Minimize', 'hd.home': 'Home screen', 'hd.lang': 'Язык / Language',
      'nav.play': '▶ Play', 'nav.acc': '☺ Accounts', 'nav.opt': '⚡ Performance', 'nav.mods': '▣ Mods', 'nav.fx': '✦ Particles', 'nav.theme': '❖ Theme',
      'splash.sub': 'launcher for Java Edition', 'splash.start': 'Start',
      'play.go': '▶ Play', 'play.noacc': 'No account', 'play.noacc.d': 'Add an account in the “Accounts” tab',
      'ver.t': 'Version', 'ver.d': 'Minecraft Java releases', 'ver.ok': '✓ Installed', 'ver.no': 'Not installed — will install automatically', 'ver.installing': 'Installing…', 'ver.done': 'Version {v} installed',
      'st.t': 'Status', 'lg.ready': 'Ready to launch', 'lg.launchErr': 'Launch failed', 'lg.installErr': 'Installation failed', 'lg.closed': 'Game closed',
      'runs.t': 'Running clients', 'runs.d': 'You can switch accounts at any time — the launcher and the game keep running', 'runs.none': 'No running clients', 'runs.ing': 'in game', 'runs.mc': 'Minecraft {v} · PID {pid}',
      'acc.t': 'Accounts', 'acc.d': 'Click an account to make it active', 'acc.empty': 'Nothing here yet',
      'acc.ms.d': 'Licensed account', 'acc.ms.btn': 'Sign in', 'acc.off.t': 'Offline nickname', 'acc.off.d': 'For singleplayer and servers without authentication', 'acc.add': 'Add', 'acc.del': 'Remove',
      'acc.type.ms': 'Microsoft', 'acc.type.off': 'Offline',
      'acc.next': 'Next launch will use {name}. The current game keeps running', 'acc.sel': 'Account: {name}',
      'opt.ram.t': 'Memory', 'opt.ram.d': 'Allocated RAM', 'unit.gb': '{n} GB',
      'opt.jvm.t': 'JVM profile', 'opt.jvm.d': 'Garbage collector settings', 'opt.jvm.light': 'Light', 'opt.jvm.none': 'Default',
      'opt.fab.d': 'Auto-installs Sodium, Lithium and FerriteCore for more FPS',
      'opt.sav.t': 'Save resources in game', 'opt.sav.d': 'Pause background animations while the game is running',
      'opt.srv.t': 'Auto-join server', 'opt.srv.d': 'Server address: the game connects to it right away',
      'opt.java.t': 'Java path', 'opt.java.d': 'Leave empty — Java is downloaded automatically',
      'opt.dir.t': 'Game folder', 'opt.dir.d': 'Worlds, mods, screenshots', 'opt.dir.btn': 'Open',
      'mod.t': 'Modrinth mods', 'mod.ph': 'Search mods: Iris, Xaero, JourneyMap…',
      'mod.warn': 'Fabric is off — enable it in the “Performance” tab, otherwise mods will not load',
      'mod.found': 'Results', 'mod.inst': 'Installed', 'mod.inst.d': '“auto” — performance mods managed by the launcher',
      'mod.none': 'Nothing found', 'mod.loading': 'Loading…', 'mod.loadErr': 'Failed to load: {e}',
      'mod.done': '✓ Installed', 'mod.get': 'Install', 'mod.dep': ' · dependency', 'mod.auto': 'auto', 'mod.rm': 'Remove', 'mod.empty': 'No mods yet',
      'mod.toast': 'Installed: {list}', 'mod.already': 'already installed',
      'fx.t': 'Background particles', 'fx.d': 'Floating lights',
      'fx.shape.t': 'Shape', 'fx.shape.d': 'Particle style', 'fx.pixel': 'Pixels', 'fx.circle': 'Circles', 'fx.star': 'Stars', 'fx.ring': 'Rings',
      'fx.dir.t': 'Direction', 'fx.dir.d': 'Where particles drift', 'fx.up': 'Up', 'fx.down': 'Down', 'fx.chaos': 'Chaos',
      'fx.size.t': 'Size', 'fx.size.d': 'Particle scale', 'fx.speed.t': 'Speed', 'fx.speed.d': 'Movement pace',
      'fx.glow.t': 'Glow', 'fx.glow.d': 'Soft halo', 'fx.click.t': 'Click burst', 'fx.click.d': 'Sparks where you click',
      'fx.add.t': 'Add particles', 'fx.add.d': '+20 to the background, fireworks or reset', 'fx.burst': 'Fireworks', 'fx.reset': 'Reset',
      'th.title': 'Color scheme', 'th.d': '32 palettes: accent, glow, background and particles change smoothly', 'th.rnd': '🎲 Random',
      'th.blur.t': 'Panel blur', 'th.blur.d': 'Glass effect (uses the GPU)',
      'themeNames': ['Emerald', 'Amethyst', 'Flame', 'Frost', 'Sunset', 'Ocean', 'Lime', 'Rose', 'Gold', 'Lavender', 'Mint', 'Cherry', 'Cosmos', 'Neon', 'Lava', 'Ice', 'Jungle', 'Twilight', 'Peach', 'Turquoise', 'Ruby', 'Electric', 'Arctic', 'Raspberry', 'Pine', 'Amber', 'Indigo', 'Sakura', 'Toxic', 'Void', 'Tangerine', 'Graphite'],
      'ab.author': 'Creator', 'ab.ver': 'Version {v}', 'ab.legal': 'Unofficial launcher. Minecraft is a trademark of Mojang AB.', 'ab.close': 'Close',
      'm.nick': 'Nickname: 3–16 characters (letters, digits, _)',
      'm.ms.closed': 'The sign-in window was closed — please try again', 'm.ms.noxbox': 'This Microsoft account has no Xbox profile. Create one at xbox.com and try again',
      'm.ms.child': 'Child account: a parent must allow gaming in the Microsoft family group', 'm.ms.country': 'Xbox Live is not available in your country',
      'm.ms.nogame': 'This account does not own Minecraft Java Edition', 'm.ms.net': 'Cannot reach Microsoft servers',
      'm.ms.other': 'Microsoft sign-in failed: {t}', 'm.ms.expired': 'Microsoft session expired — please sign in again',
      'm.mod': 'Mod: {slug}', 'm.fab.unsup': 'Fabric does not support {mc}', 'm.fab.p': 'Fabric and mods…', 'm.fab.crash': 'Fabric failed to start — launching without mods…',
      'm.java.prep': 'Preparing Java…', 'm.java.mb': 'Java {major} {n} MB', 'm.java.dl': 'Failed to download Java {major} — check your connection',
      'm.java.unpack': 'Unpacking Java…', 'm.java.unpackErr': 'Failed to unpack Java', 'm.java.nf': 'Java not found after unpacking', 'm.java.bad': 'Java at the given path cannot be started',
      'm.inst.p': 'Installing {v}: {type}', 'm.inst.done': 'Version {v} installed', 'm.inst.fail': 'Failed to install {v} — check your connection',
      'm.mr.err': 'Modrinth: error {s}', 'm.mr.nover': '{title}: no version for {v}',
      'm.noacc': 'Select an account', 'm.installing': 'This version is still installing', 'm.dl': 'Downloading: {type}',
      'm.game.err': 'The game exited with an error (code {code}). Check your mods and Java', 'm.launch.fail': 'Failed to launch (check your Java installation)', 'm.running': 'Game started',
      'm.upd.found': 'Launcher update {v} found, downloading…', 'm.upd.done': 'Update {v} downloaded', 'm.upd.now': 'Restart now', 'm.upd.later': 'Later',
      'm.upd.msg': 'New version {v} available', 'm.upd.detail': 'The update has been downloaded. Restart the launcher and install it now? If you choose “Later”, it will be installed when you close the launcher.'
    }
  };
  const LANGS = Object.keys(D);
  const detect = l => /^(ru|uk|be|kk)\b/i.test(l || '') ? 'ru' : 'en';
  const t = (lang, k, p) => {
    let s = (D[lang] && D[lang][k]);
    if (s == null) s = D.en[k];
    if (s == null) return k;
    if (typeof s !== 'string' || !p) return s;
    return s.replace(/\{(\w+)\}/g, (m, n) => (p[n] != null ? p[n] : m));
  };
  return { D, LANGS, detect, t };
});
