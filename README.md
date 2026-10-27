<h1 align="center">Каталог аддонов YMDMod</h1>

<p align="center">Отсюда вкладка «Каталог» в <a href="https://github.com/YMDMod/YMDMod">YMDMod</a> берёт аддоны.</p>

<p align="center">
  <a href="https://github.com/YMDMod/catalog/actions/workflows/update.yml"><img src="https://img.shields.io/github/actions/workflow/status/YMDMod/catalog/update.yml?label=робот" alt="Робот каталога"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/YMDMod/catalog?label=лицензия" alt="Лицензия"></a>
</p>

---

### Как добавить свой аддон

1. Сделайте репозиторий по [шаблону](https://github.com/YMDMod/addon-template)
2. Добавьте репозиторию топик `ymdmod-addon` (справа в блоке About → шестерёнка → Topics)
3. Выпустите релиз с тегом `vX.Y.Z`, где `X.Y.Z` — версия из `manifest.json`. В описании коротко напишите,
   что нового

Минут через пятнадцать робот откроет тут пулл-реквест. Когда его примут, аддон появится в каталоге у всех.
Обновления выкладываются так же — новым релизом, и у пользователей появится кнопка «Обновить».

### Что робот не возьмёт

- Черновики и пре-релизы — ими удобно тестировать
- Тег без релиза
- Релиз без `manifest.json` в корне, с версией, которая не совпадает с тегом, без файлов `main` или
  `renderer` из манифеста, с чужим `id`
- Аддон больше 5 МБ

Почему релиз не подошёл, видно во вкладке Actions. Файлы с точкой в начале, папки `test/`, `tests/`, `docs/`
и `*.md` в каталог не попадают; свой список можно задать полем `"files"` в манифесте.

---

<p align="center">Распространяется по лицензии <a href="LICENSE">MIT</a>.</p>
