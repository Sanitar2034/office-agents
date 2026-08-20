---
name: ifrs16-lease
description: Расчёт договора аренды по МСФО (IFRS) 16 в Excel — обязательство по аренде, ROU-актив, график, ОСВ (сальдо/обороты), показатели на отчётную дату. Быстрая сборка ОДНИМ вызовом eval_officejs с готовым скриптом — подходит малым моделям. Листы: Параметры, График, ОСВ, Отчётная дата. Модификации: выкуп, аванс, стимулы, CPI, переоценка, малая аренда, несколько договоров, rent-free. Использовать при запросах: расчёт аренды/лизинга по МСФО 16 / IFRS 16, lease liability, ROU asset, ОСВ по аренде.
---

# МСФО (IFRS) 16 — расчёт договора аренды

Два пути. **Всегда начинай с пути А** (один вызов — вся модель готова). Путь Б — только для точечных правок сильной моделью.

## ПУТЬ А — быстрый (обязателен для малых моделей)

Вся модель (4 листа: Параметры, График, ОСВ, Отчётная дата) собирается ОДНИМ вызовом `eval_officejs`.

**Шаг 1** — только если пользователь дал свои цифры: запиши их в JSON через bash
(не указанные поля не пиши — подставятся значения по умолчанию):
```
cat > /home/user/ifrs16.json << 'EOF'
{"years": 5, "payment": 100000, "annualRate": 0.05, "freq": 1, "timing": "конец", "startDate": "2026-01-01", "directCosts": 0, "reportDate": "2026-12-31"}
EOF
```

**Шаг 2** — вызови `eval_officejs` и передай в `code` скрипт ниже **ДОСЛОВНО, без единого изменения**. Не вставляй параметры в скрипт — он сам прочитает JSON из шага 1 (или возьмёт значения по умолчанию):

```js
// ===== IFRS 16 builder (не менять) =====
const DEF = { years: 5, payment: 100000, annualRate: 0.05, freq: 1,
  timing: "конец", startDate: "2026-01-01", directCosts: 0, reportDate: "2026-12-31" };
let cfg = {};
try { cfg = JSON.parse(await readFile("/home/user/ifrs16.json")) || {}; } catch (e) {}
const P = Object.assign({}, DEF, cfg);
const adv = String(P.timing).toLowerCase().indexOf("начало") >= 0 || String(P.timing).toLowerCase() === "advance";
const dt = (s) => { const a = String(s).split("-").map(Number); return new Date(a[0], a[1] - 1, a[2]); };

const NAMES = ["Параметры", "График", "ОСВ", "Отчётная дата"];
const ws = context.workbook.worksheets;
for (const n of NAMES) {
  const sh = ws.getItemOrNullObject(n);
  sh.load("name");
  await context.sync();
  if (!sh.isNullObject) sh.delete();
}
await context.sync();
const sp = ws.add(NAMES[0]), sg = ws.add(NAMES[1]), so = ws.add(NAMES[2]), sr = ws.add(NAMES[3]);

sp.getRange("A1").values = [["МСФО (IFRS) 16 — Параметры аренды"]];
sp.getRange("A1").format.font.bold = true;
sp.getRange("A3:B10").values = [
  ["Дата начала аренды", dt(P.startDate)],
  ["Срок аренды, лет", P.years],
  ["Годовой платёж", P.payment],
  ["Платежей в год (1/2/4/12)", P.freq],
  ["Годовая ставка дисконтирования", P.annualRate],
  ["Платежи: конец или начало периода", adv ? "начало" : "конец"],
  ["Первоначальные прямые затраты", P.directCosts],
  ["Отчётная дата", dt(P.reportDate)],
];
sp.getRange("A11:B12").formulas = [
  ["Ставка за период", "=(1+$B$7)^(1/$B$6)-1"],
  ["Всего периодов", "=$B$4*$B$6"],
];
sp.getRange("A13").values = [["Синие ячейки — входные данные, можно менять"]];
sp.getRange("B3:B10").format.font.color = "#0000FF";
sp.getRange("B3:B10").format.fill.color = "#FFFF99";
sp.getRange("B3").numberFormat = [["DD.MM.YYYY"]];
sp.getRange("B10").numberFormat = [["DD.MM.YYYY"]];
sp.getRange("B7").numberFormat = [["0.00%"]];
sp.getRange("B5").numberFormat = [["#,##0.00"]];
sp.getRange("B9").numberFormat = [["#,##0.00"]];

sg.getRange("A1").values = [["График аренды"]];
sg.getRange("A1").format.font.bold = true;
sg.getRange("A3:H3").values = [["Период", "Дата", "Платёж", "Проценты",
  "Погашение обязательства", "Обязательство на конец", "Амортизация ROU", "ROU на конец"]];
sg.getRange("A3:H3").format.font.bold = true;
sg.getRange("A4:H4").formulas = [[
  0, "='Параметры'!$B$3", 0, 0, 0,
  "='Параметры'!$B$5*(1-(1+'Параметры'!$B$11)^-'Параметры'!$B$12)/'Параметры'!$B$11*IF('Параметры'!$B$8=\"начало\",1+'Параметры'!$B$11,1)",
  0, "=F4+'Параметры'!$B$9",
]];
const N = Math.max(1, Math.round(Number(P.years) * Number(P.freq)));
const rows = [];
for (let k = 1; k <= N; k++) {
  const r = 4 + k, p = r - 1;
  rows.push([
    `=A${p}+1`,
    `=EDATE('Параметры'!$B$3,A${r}*12/'Параметры'!$B$6)`,
    `='Параметры'!$B$5`,
    `=IF('Параметры'!$B$8="начало",(F${p}-C${r})*'Параметры'!$B$11,F${p}*'Параметры'!$B$11)`,
    `=C${r}-D${r}`,
    `=F${p}-E${r}`,
    `=$H$4/'Параметры'!$B$12`,
    `=H${p}-G${r}`,
  ]);
}
sg.getRange(`A5:H${4 + N}`).formulas = rows;
const last = 4 + N, tot = 5 + N;
sg.getRange(`A${tot}:H${tot}`).formulas = [["ИТОГО", null,
  `=SUM(C5:C${last})`, `=SUM(D5:D${last})`, `=SUM(E5:E${last})`,
  `=F${last}`, `=SUM(G5:G${last})`, `=H${last}`]];
sg.getRange(`I${tot}`).formulas = [[`=IF(ROUND(F${last},2)=0,"OK: обязательство погашено","ОШИБКА: проверь параметры")`]];
sg.getRange(`A${tot}:I${tot}`).format.font.bold = true;
sg.getRange(`B4:B${last}`).numberFormat = [["DD.MM.YYYY"]];
sg.getRange(`C4:H${last}`).numberFormat = [["#,##0.00"]];

so.getRange("A1").values = [["ОСВ по аренде — сальдо и обороты"]];
so.getRange("A1").format.font.bold = true;
so.getRange("A3").values = [["Период"]];
so.getRange("B3").values = [["Обязательство по аренде (пассив, Кт)"]];
so.getRange("F3").values = [["Актив права пользования (Дт)"]];
so.getRange("B4:H4").values = [["Сальдо на начало (Кт)", "Оборот Дт (платежи)",
  "Оборот Кт (проценты)", "Сальдо на конец (Кт)", "Сальдо на начало (Дт)",
  "Оборот Кт (амортизация)", "Сальдо на конец (Дт)"]];
so.getRange("A3:H4").format.font.bold = true;
const orows = [];
for (let k = 1; k <= N; k++) {
  const g = 4 + k, gp = 3 + k;
  orows.push([`='График'!A${g}`, `='График'!F${gp}`, `='График'!C${g}`, `='График'!D${g}`,
    `='График'!F${g}`, `='График'!H${gp}`, `='График'!G${g}`, `='График'!H${g}`]);
}
so.getRange(`A5:H${4 + N}`).formulas = orows;
so.getRange(`A${tot}:H${tot}`).formulas = [["ИТОГО обороты", null,
  `=SUM(C5:C${last})`, `=SUM(D5:D${last})`, `=E${last}`, null,
  `=SUM(G5:G${last})`, `=H${last}`]];
so.getRange(`I${tot}`).formulas = [[`=IF(ROUND(B5-(E${last}+C${tot}-D${tot}),2)=0,"OK","ОШИБКА увязки")`]];
so.getRange(`J${tot}`).formulas = [[`=IF(ROUND(F5-(H${last}+G${tot}),2)=0,"OK","ОШИБКА увязки")`]];
so.getRange(`A${tot}:J${tot}`).format.font.bold = true;
so.getRange(`A5:A${last}`).numberFormat = [["0"]];
so.getRange(`B5:H${last}`).numberFormat = [["#,##0.00"]];

sr.getRange("A1").values = [["МСФО (IFRS) 16 — Показатели на отчётную дату"]];
sr.getRange("A1").format.font.bold = true;
sr.getRange("A3:B3").formulas = [["Отчётная дата", "='Параметры'!$B$10"]];
sr.getRange("B3").numberFormat = [["DD.MM.YYYY"]];
sr.getRange("A5").values = [["БАЛАНС"]];
sr.getRange("A5").format.font.bold = true;
sr.getRange("A6:B9").formulas = [
  ["Обязательство по аренде, всего", "=INDEX('График'!$F:$F,MATCH($B$3,'График'!$B:$B,1))"],
  ["— краткосрочная часть (12 мес)", "=SUMIFS('График'!$E:$E,'График'!$B:$B,\">\"&$B$3,'График'!$B:$B,\"<=\"&EDATE($B$3,12))"],
  ["— долгосрочная часть", "=B6-B7"],
  ["Актив права пользования (ROU)", "=INDEX('График'!$H:$H,MATCH($B$3,'График'!$B:$B,1))"],
];
sr.getRange("A11").values = [["ПРИБЫЛИ И УБЫТКИ (с начала аренды по отчётную дату)"]];
sr.getRange("A11").format.font.bold = true;
sr.getRange("A12:B13").formulas = [
  ["Амортизация ROU", "=SUMIFS('График'!$G:$G,'График'!$B:$B,\"<=\"&$B$3)"],
  ["Проценты по обязательству", "=SUMIFS('График'!$D:$D,'График'!$B:$B,\"<=\"&$B$3)"],
];
sr.getRange("B6:B9").numberFormat = [["#,##0.00"]];
sr.getRange("B12:B13").numberFormat = [["#,##0.00"]];

const f4 = sg.getRange("F4"), h4 = sg.getRange("H4");
f4.load("values"); h4.load("values");
await context.sync();
return { built: true, sheets: NAMES, periods: N,
  initialLiability: f4.values[0][0], initialROU: h4.values[0][0] };
```

**Шаг 3** — проверь ответ: `success: true` и поля `initialLiability`/`initialROU`. Если ошибка — прочитай её текст, исправь в JSON (шаг 1) и повтори шаг 2 один раз. В чате доложи двумя строками: обязательство на начало и ROU на начало + «параметры на листе Параметры (синие ячейки)».

## ПУТЬ Б — ручной (точечные правки, для сильных моделей)

Общие правила: каждое допущение — отдельная ячейка «Параметры»; все производные числа — формулами; `value` в set_cell_range — только примитивы; формулы — полем `formula` или строкой с `=`; пиши построчно.

**«Параметры»**: как в пути А (A1 заголовок; A3:B10 входные; B11 `=(1+B7)^(1/B6)-1`; B12 `=B4*B6`; синие входные).

**«График»**: шапка как в пути А. Строка 4 (период 0): F4 — PV аннуитета (`*'Параметры'!$B$11` при платежах в начале), H4 `=F4+'Параметры'!$B$9`. Строки k: A `=A(k-1)+1`; B `=EDATE('Параметры'!$B$3,A*12/'Параметры'!$B$6)`; C `='Параметры'!$B$5`; D `=F(k-1)*'Параметры'!$B$11` (конец) / `=(F(k-1)-C)*'Параметры'!$B$11` (начало); E `=C-D`; F `=F(k-1)-E`; G `=$H$4/'Параметры'!$B$12`; H `=H(k-1)-G`. Контроль: `ROUND(F(последняя),2)=0`.

**«ОСВ»**: шапка двухуровневая как в пути А; строка периода k: B `='График'!F(k-1)`, C `='График'!C(k)`, D `='График'!D(k)`, E `='График'!F(k)`, F `='График'!H(k-1)`, G `='График'!G(k)`, H `='График'!H(k)`; итоговая строка с суммами и увязками.

**«Отчётная дата»**: формулы как в пути А (INDEX/MATCH по отчётной дате, SUMIFS для краткосрочной части и расходов). Отчётная дата должна быть ≥ даты начала аренды.

## Модификации (после пути А — вручную по правилам пути Б)

1. **Выкупной платёж / лизинг**: параметр «Выкупной платёж» и «СПУ актива, лет»; выкуп добавляется в PV последним платежом; амортизация ROU по СПУ.
2. **Аренда с авансом**: обязательство = PV оставшихся платежей; ROU = обязательство + аванс + ПЗ.
3. **Стимулы арендодателя**: ROU = обязательство + аванс + ПЗ − стимулы.
4. **Индексация (CPI/ИПЦ)**: в PV — только фиксированная часть; на дату пересмотра строка «Переоценка» в Графике и оборот в ОСВ.
5. **Изменение срока/ставки**: пересчёт PV оставшихся платежей по новой ставке, разница в ROU (остаток в P&L при обнулении).
6. **Краткосрочная/малая аренда**: без обязательства и ROU, равномерное списание (блок сравнения на «Отчётная дата»).
7. **Несколько договоров**: блок параметров на договор, блоки Графика/ОСВ друг под другом, итоговая сводка.
8. **Льготный период**: платёж 0, проценты начисляются на остаток.

## Порядок работы

1. Дорога одна: путь А. Цифры пользователя → JSON (шаг 1) → eval_officejs дословно (шаг 2) → доклад (шаг 3). Не выдумывай свои формулы и не собирай модель построчно, пока путь А не попробован.
2. Модификации — после базовой сборки, правилами пути Б.
