# Units 单位模型

`src/lib/inputs/units.ts`：纯逻辑、无 DOM / Svelte，`bun test tests/units.test.ts` 覆盖。
组件侧的接线（`unit` / `units` / `activeUnit` prop、粘贴解析、显示换算）见
[`docs/input.md`](input.md)。

## 两层结构

单位不是一个扁平 dict，而是「注册表 → 量纲表」两层，key 含义不同：

```ts
type Registry = Record<dimensionName, Dimension>; // length / mass / temperature …

interface Dimension {
  base: string; // 基准单位 id，必须也在 units 里且值为 1
  units: Record<unitId, UnitFactor>; // 单位 id → 换算（m / cm / ft / K / C）
  alias?: Record<alias, unitId>; // 别名 → 单位 id（厘米 → cm）
}
```

这样 `units={STD_UNITS.length}`（量纲表）与 `units={STD_UNITS}`（注册表）是同一种「选一批单位」
的两种粒度，类型统一；组件只传其中一个即可。

- **纯 dict、无 array**：`units` / `alias` 都是 `Record`，顺序无关（查表走 `Map` 索引）。
- **基准单位必须自列**：`m: 1` 也要写进 `units`，否则回答不了「基准是谁、显示单位是谁」。
- 内置注册表 `STD_UNITS` 含 `length`（基准 `m`）、`mass`（基准 `kg`）、`temperature`（基准 `K`）。

## 方向约定（钉死）

`factor` 的含义是 **1 个该单位 = factor 个基准单位**：

```ts
length: { base: "m", units: { m: 1, cm: 0.01, ft: 0.3048 } }   // 不是 cm: 100
mass:   { base: "kg", units: { kg: 1, g: 0.001, lb: 0.45359237, oz: 0.028349523125 } }
```

换算 = `to.fromBase(from.toBase(value))`，即先归到基准、再落到目标单位。基准单位自身的
`toBase` / `fromBase` 是恒等（factor = 1）。

## 非线性单位：成对的函数

超出「乘一个系数」的换算（有偏移的温标）用 `{ toBase, fromBase }`，且**必须成对给逆变换**：

```ts
temperature: {
  base: "K",
  units: {
    K: 1,
    C: { toBase: (c) => c + 273.15, fromBase: (k) => k - 273.15 },
    F: { toBase: (f) => ((f - 32) * 5) / 9 + 273.15, fromBase: (k) => ((k - 273.15) * 9) / 5 + 32 },
  },
}
```

`toBase` / `fromBase` 必须是互逆的（`convertValue` 只做「归基准 → 出基准」两步，不做特殊分支）。
也**不允许** `kg_lb({ kg } | { lb })` 这种「一个函数认两种单位」的联合参数签名——方向写在字段名里。

## 别名：按量纲挂，不做全局表

别名有量纲歧义（`oz` 既可能是质量盎司，也可能是液量盎司；`t` 既可能是吨，也可能是别的），
所以 `alias` 挂在**量纲表**上，不搞全局一张表：

```ts
length: { alias: { 厘米: "cm", 公里: "km", 英寸: "in" } }
mass:   { alias: { 磅: "lb", 盎司: "oz" } }
```

- 别名解析后 `ResolvedUnit.id` 仍是**规范单位 id**（`findUnit(STD_UNITS, "厘米").id === "cm"`）。
- 同一量纲内单位 id 优先于别名（先收单位 id、再收别名，撞名时别名丢弃）。
- 别名的目标必须存在于**同一量纲**，否则该别名被忽略。
- 勘误：**盎司是 `oz`，`lb` 是磅**（`1 lb = 16 oz`）。早期稿把「盎司」写成 `lb` 是错的。

## 查表、归一化与原型键

用户输入 / 粘贴的文本先做归一化再查表（`normalizeUnitKey`）：

1. **NFKC 兼容归一化**：全角 → 半角（`１２ｃｍ` → `12cm`）、CJK 单位字符 → 字母形式
   （`㎝` → `cm`、`℃` → `°C`、`℉` → `°F`）、表意空格 → 普通空格；
2. `trim()`；
3. 小写（单位 id 一律 ASCII，`CM` / `cm` 等价）。

查表走 `Map`，不是 `obj[key]`：`constructor` / `toString` / `__proto__` 这类粘贴内容
**必须查不中**（`findUnit` / `parseQuantity` 一律返回 `undefined`）。

**索引只建一次**：`findUnit` 首次命中某个 registry 时构建 `Map` 并存进模块级
`WeakMap<Registry, Map<key, ResolvedUnit>>`，之后每次按键都是纯 `Map.get`。因此
**`Registry` 视为不可变**——建好之后只读；要变体就换一个新对象（改了旧对象不会失效缓存）。

**`UnitSource`**：`findUnit` / `parseQuantity` 既接受注册表（`STD_UNITS`），也接受**单张量纲表**
（`STD_UNITS.length`）。裸量纲表没有量纲名，`toRegistry` 会把它包成 `{ [table.base]: table }`
并把包对象缓进 `WeakMap<Dimension, Registry>`——所以「量纲表也能查」且**每次调用拿到的是同一个
包对象**，索引缓存不会退化成每次重建。包之间的量纲名（此处就是 `base` 的 id）只用于相等判断，
不对外展示。

## API

| 导出               | 签名                                                         | 说明                                                     |
| ------------------ | ------------------------------------------------------------ | -------------------------------------------------------- |
| `STD_UNITS`        | `Registry`                                                   | 内置注册表：`length` / `mass` / `temperature`            |
| `toRegistry`       | `(source: UnitSource) => Registry`                           | 量纲表 → 注册表（缓存包装）；注册表原样返回              |
| `isDimensionTable` | `(source) => source is Dimension`                            | 形状判定（有字符串 `base` 与对象 `units`）               |
| `findUnit`         | `(source: UnitSource, idOrAlias) => ResolvedUnit \| undefined` | 查单位（含别名、大小写、NFKC），未知 → `undefined`        |
| `convertValue`     | `(value, from, to) => number \| undefined`                   | **同量纲**换算；跨量纲 / 缺一侧 / 非有限值 → `undefined` |
| `parseQuantity`    | `(text, source, options?) => { value, unit } \| undefined`   | 解析 `'12 cm'` / `'12cm'` / `'12 厘米'` / `'1e3 m'`      |
| `formatQuantity`   | `(value, unit, decimals?) => string`                         | 显示格式化，如 `'0.12 cm'`                               |
| `normalizeUnitKey` | `(text) => string`                                           | 暴露给调用方比较 `activeUnit` prop 与 `ResolvedUnit.id`  |

`ResolvedUnit` 把「量纲名 / 基准单位 / 规范 id / 两个换算函数」打包在一起，所以调用方不需要
再回头查注册表：

```ts
interface ResolvedUnit {
  dimension: string; // "length"
  base: string; // "m"
  id: string; // "cm"（别名解析后是规范 id）
  toBase: (value: number) => number;
  fromBase: (value: number) => number;
}
```

### `parseQuantity` 的接受 / 拒绝

接受（数字与单位之间的空格可有可无；指数形式、正负号、全角均可）：

```text
'12 cm'  '12cm'  '  12 CM '  '12 厘米'  '1e3 m'  '1E3m'  '１２ｃｍ'  '－４０℃'  '212℉'
```

拒绝（一律 `undefined`，由调用方决定语义——通常是保留原文并让 `:invalid` 生效）：

- 空串 / 非数字（`'abc'`）；
- **裸数字**（`'12'`，没有单位就回答不了「哪个量纲」）；
- 未知单位（`'12 xyz'`）；
- 多个数字 / 多个 token（`'12 3 m'`、`'12 m 3'`、`'12 c m'`、`'12.5.3 m'`）；
- 单位在前（`'cm 12'`）、非十进制（`'1/2 in'`）；
- 原型键（`'12 constructor'`）；
- 与 `options.expectDimension` 不符（质量框里粘 `'12 cm'`）。

### `formatQuantity` 的精度

- 不给 `decimals`：按 12 位有效数字收敛，消掉 `0.12000000000000001` 这类浮点噪音
  （`0.1 + 0.2` → `'0.3 m'`）。
- 给 `decimals`：**最多**几位小数，不是固定宽度——末尾零会去掉
  （`formatQuantity(2.5, m, 2) === '2.5 m'`，`formatQuantity(1/3, m, 4) === '0.3333 m'`）。
- `-0` 归一成 `'0'`；非有限值不会抛异常（输出 `'NaN m'`）。
- `value` 已经是**该单位下**的值，本函数不换算；要换算先 `convertValue` / `unit.fromBase`。

## 货币：只作 example，勿直接使用

货币是线性换算，形状上完全放得下，但**汇率时变**，内置表会立刻过期，所以 `STD_UNITS` 里没有：

```ts
// 仅作形状示例：rate 会变，必须来自运行时数据源（别抄进 STD_UNITS）。
const CURRENCY: Dimension = {
  base: "usd",
  units: {
    usd: 1,
    cny: { toBase: (cny) => cny * 0.14, fromBase: (usd) => usd / 0.14 },
  },
  alias: { 美元: "usd", 人民币: "cny" },
};
```

带符号的 id（`USD$` / `CNY¥`）不采用：id 一律 ASCII（`usd` / `cny`），展示文案交给 paraglide。

## 与组件的约定（D2）

- 组件默认 `units = STD_UNITS`（注册表），`activeUnit` 决定量纲：**只允许同量纲换算**。
- 跨量纲粘贴（质量框里粘 `12 cm`）→ 拒绝，保留原文并让 `:invalid` 生效。
- `unit` / `activeUnit` 是 ASCII 单位 id；查表统一走 `findUnit`（别自己 `STD_UNITS[x]`）。

## 明确不做

- 货币 / 汇率（只留上面的 example）。
- 单位切换 UI（下拉 / 循环按钮）——只做 `activeUnit` prop + 粘贴解析换算。
