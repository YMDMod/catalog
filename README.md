<h1 align="center">Каталог аддонов YMDMod</h1>

<p align="center">Источник аддонов для вкладки «Каталог» в <a href="https://github.com/YMDMod/YMDMod">YMDMod</a>.</p>

<p align="center">
  <a href="https://github.com/YMDMod/catalog/actions/workflows/update.yml"><img src="https://img.shields.io/github/actions/workflow/status/YMDMod/catalog/update.yml?label=catalog%20bot" alt="Catalog bot"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/YMDMod/catalog?label=license" alt="License"></a>
</p>

---

### Публикация аддона

1. Создайте репозиторий на основе [шаблона](https://github.com/YMDMod/addon-template).
2. Добавьте репозиторию топик `ymdmod-addon` (блок About → значок настроек → Topics).
3. Опубликуйте релиз с тегом `vX.Y.Z`, где `X.Y.Z` — версия из `manifest.json`. В описании релиза кратко
   перечислите изменения.

В течение примерно пятнадцати минут робот откроет в этом репозитории пулл-реквест. После его принятия аддон
становится доступен всем пользователям каталога. Обновления публикуются так же — новым релизом; у пользователей
появится кнопка «Обновить».

### Ограничения

Робот не принимает:

- черновики и пре-релизы (их удобно использовать для тестирования);
- теги без релиза;
- релизы без `manifest.json` в корне, с версией, не совпадающей с тегом, без `main.js` и `renderer.js`
  в корне, а также с `id`, уже занятым другим аддоном;
- аддоны объёмом более 5 МБ.

Причина отклонения релиза указывается во вкладке Actions. Файлы и папки, имя которых начинается с точки,
папки `test/`, `tests/`, `docs/` и файлы `*.md` в каталог не публикуются; все остальные файлы релиза
публикуются. Автором аддона в каталоге указывается владелец репозитория.

---

<p align="center">Распространяется по лицензии <a href="LICENSE">MIT</a>.</p>
