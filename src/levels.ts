import type { GateType, Inputs, Outputs, Port } from './contracts';
export type { GateType, Inputs } from './contracts';

export interface Level {
  id: number;
  title: string;
  caption: string;
  story: string;
  goal: string;
  formula: string;
  chapter: number;
  inputs: string[];
  inputPorts: Port[];
  outputPorts: Port[];
  allowed: GateType[];
  hints: string[];
  rewardName?: string;
  expected: (inputs: Inputs) => number;
  expectedOutputs: (inputs: Inputs) => Outputs;
}

export const chapters = ['信号与逻辑门', '选择与分配', '多位信号', '组合运算'];
type PortSpec = [string, number];
const gateUnlocks: [GateType, number][] = [
  ['NAND', 2], ['NOT', 4], ['AND', 5], ['OR', 6], ['XOR', 7], ['XNOR', 8],
  ['SPLIT', 11], ['JOIN', 11], ['CONST', 19],
];
const port = ([id, bits]: PortSpec): Port => ({ id, label: id, bits });

function lesson(
  id: number, title: string, caption: string, goal: string, formula: string,
  inputSpecs: PortSpec[], outputSpecs: PortSpec[], expectedOutputs: (inputs: Inputs) => Outputs,
  hints: string[], rewardName?: string,
): Level {
  const inputPorts = inputSpecs.map(port);
  const outputPorts = outputSpecs.map(port);
  return {
    id, title, caption, story: goal, goal, formula,
    chapter: id <= 4 ? 1 : id <= 10 ? 2 : id <= 14 ? 3 : 4,
    inputs: inputPorts.map(p => p.id), inputPorts, outputPorts,
    allowed: gateUnlocks.filter(([, first]) => id >= first).map(([type]) => type),
    hints, rewardName, expectedOutputs,
    expected: inputs => expectedOutputs(inputs)[outputPorts[0].id],
  };
}

const one: PortSpec[] = [['A', 1]];
const two: PortSpec[] = [['A', 1], ['B', 1]];
const y: PortSpec[] = [['Y', 1]];
const fullAdder = (bits: number) => (i: Inputs): Outputs => {
  const total = i.A + i.B + i.Cin;
  return { Sum: total % (2 ** bits), Cout: Math.floor(total / (2 ** bits)) };
};

export const levels: Level[] = [
  lesson(1, '点亮信号灯', '让信号抵达终点', '输出 Y 始终与输入 A 相同。', 'Y = A', one, y,
    i => ({ Y: i.A }),
    ['导线可以把输入信号传递到输出。', '从 A 右侧的端口连接到 Y 左侧的端口。', '直接连接 A 与 Y，不需要逻辑门。']),
  lesson(2, '认识 NAND', '第一次逻辑运算', '只有 A 和 B 都为 1 时，Y 才为 0。', 'Y = ¬(A ∧ B)', two, y,
    i => ({ Y: i.A === 1 && i.B === 1 ? 0 : 1 }),
    ['NAND 是“与非”：先判断是否同时为 1，再反转结果。', 'NAND 有两个输入端口，分别接收 A 和 B。', '放置一个 NAND，将 A、B 接入，再把它的输出接到 Y。'], 'NAND'),
  lesson(3, '反向开关', '把已有元件变成新工具', 'A 为 0 时 Y 为 1；A 为 1 时 Y 为 0。', 'Y = ¬A', one, y,
    i => ({ Y: 1 - i.A }),
    ['观察 NAND 的两个输入相同时，会输出什么。', '同一个输出端口可以连接到多个输入端口。', '将 A 同时接到 NAND 的两个输入，再连接 NAND 的输出到 Y。'], 'NOT'),
  lesson(4, '双人确认', '组合出 AND', '只有 A 和 B 都为 1 时，Y 才为 1。', 'Y = A ∧ B', two, y,
    i => ({ Y: i.A & i.B }),
    ['NAND 的结果和任务要求恰好相反。', '上一关得到的 NOT 可以再次反转一个信号。', '先将 A、B 接入 NAND，再通过 NOT 连接到 Y。也可以用两个 NAND 完成。'], 'AND'),
  lesson(5, '任一确认', '组合出 OR', 'A、B 中至少一个为 1 时，Y 为 1。', 'Y = A ∨ B', two, y,
    i => ({ Y: i.A | i.B }),
    ['先反转两个输入，再观察 NAND 的结果。', '德摩根关系把“或”转化为“与非”。', 'A、B 分别接 NOT，再接入同一个 NAND。'], 'OR'),
  lesson(6, '不同才亮', '组合出 XOR', '仅当 A、B 不同时，Y 为 1。', 'Y = A ⊕ B', two, y,
    i => ({ Y: i.A ^ i.B }),
    ['把“至少一个为 1”和“不能同时为 1”分别算出来。', 'OR 与 NAND 的结果可以通过 AND 合并。', '将 OR(A,B) 与 NAND(A,B) 接入 AND。'], 'XOR'),
  lesson(7, '一致确认', '组合出 XNOR', '仅当 A、B 相同时，Y 为 1。', 'Y = ¬(A ⊕ B)', two, y,
    i => ({ Y: i.A === i.B ? 1 : 0 }),
    ['上一关的 XOR 表示“不同”。', '在 XOR 后增加一个反转即可表示“相同”。', 'XOR(A,B) 接入 NOT，再连接 Y。'], 'XNOR'),
  lesson(8, '多数表决', '三人投票', 'A、B、C 至少两个为 1 时，Y 为 1。', 'Y = AB ∨ AC ∨ BC', [['A', 1], ['B', 1], ['C', 1]], y,
    i => ({ Y: i.A + i.B + i.C >= 2 ? 1 : 0 }),
    ['列出所有两人同时同意的组合。', '分别计算 AB、AC 和 BC。', '把三个 AND 的结果通过 OR 合并。'], '多数表决'),
  lesson(9, '信号选择器', '一位 MUX', 'S 为 0 时 Y=A；S 为 1 时 Y=B。', 'Y = (A ∧ ¬S) ∨ (B ∧ S)', [['A', 1], ['B', 1], ['S', 1]], y,
    i => ({ Y: i.S === 0 ? i.A : i.B }),
    ['S 控制 B 通路，反向的 S 控制 A 通路。', '两条通路分别经过 AND，再通过 OR 合并。', 'NOT(S) 与 A 接 AND；S 与 B 接 AND；两个结果接 OR。'], 'MUX'),
  lesson(10, '信号分配器', '一位 DEMUX', 'S 为 0 时 (Y0,Y1)=(A,0)；S 为 1 时 (Y0,Y1)=(0,A)。', 'Y0 = A ∧ ¬S；Y1 = A ∧ S', [['A', 1], ['S', 1]], [['Y0', 1], ['Y1', 1]],
    i => ({ Y0: i.S === 0 ? i.A : 0, Y1: i.S === 1 ? i.A : 0 }),
    ['两个输出分别控制 A 的一条通路。', '两条通路需要相反的选择信号。', 'A 与 NOT(S) 接 AND 输出 Y0；A 与 S 接 AND 输出 Y1。'], 'DEMUX'),
  lesson(11, '四位信号', '组成一条总线', '将 b0、b1、b2、b3 合成四位输出，b0 是最低位。', 'Y = b0 + 2b1 + 4b2 + 8b3', [['b0', 1], ['b1', 1], ['b2', 1], ['b3', 1]], [['Y', 4]],
    i => ({ Y: i.b0 + 2 * i.b1 + 4 * i.b2 + 8 * i.b3 }),
    ['JOIN 把单个信号合成总线。', '第 0 位的权重为 1，第 3 位的权重为 8。', '把 b0 至 b3 分别连接 JOIN 的 in0 至 in3。']),
  lesson(12, '四位选择器', '并行复用 MUX', 'S 为 0 时 Y=A；S 为 1 时 Y=B，A、B、Y 均为四位数。', 'Y = S ? B : A', [['A', 4], ['B', 4], ['S', 1]], [['Y', 4]],
    i => ({ Y: i.S === 0 ? i.A : i.B }),
    ['用 SPLIT 将 A、B 拆成对应的四个位。', '四个位分别接入一位 MUX，它们共享 S。', '将四个选择结果按相同位序接入 JOIN。'], 'MUX4'),
  lesson(13, '零值检测', '检查所有位', '仅当四位输入 A 等于 0 时，Z 为 1。', 'Z = (A = 0)', [['A', 4]], [['Z', 1]],
    i => ({ Z: i.A === 0 ? 1 : 0 }),
    ['零值意味着所有位都为 0。', '将各个位 OR 起来可以判断是否存在一个 1。', 'SPLIT 拆位，通过 OR 合并四位，再用 NOT 反转。'], 'Zero4'),
  lesson(14, '四位相等', '逐位比较', '仅当四位 A 与 B 相等时，EQ 为 1。', 'EQ = (A = B)', [['A', 4], ['B', 4]], [['EQ', 1]],
    i => ({ EQ: i.A === i.B ? 1 : 0 }),
    ['两个数字相等，需要每一对对应位都相等。', 'XOR 可以检测每一对位是否不同。', '把四个 XOR 结果 OR 起来，再用 NOT 反转。'], 'Equal4'),
  lesson(15, '半加器', '同时输出和与进位', 'Sum 是 A+B 的最低位，Carry 是进位。', 'Sum = A ⊕ B；Carry = A ∧ B', two, [['Sum', 1], ['Carry', 1]],
    i => ({ Sum: (i.A + i.B) % 2, Carry: Math.floor((i.A + i.B) / 2) }),
    ['两位相加时，结果可能需要两个输出位。', 'XOR 决定最低位，AND 决定进位。', 'A、B 同时接入 XOR 和 AND，分别输出 Sum 与 Carry。'], 'HalfAdder'),
  lesson(16, '全加器', '接收上一级进位', '将 A、B、Cin 相加，输出最低位 Sum 与进位 Cout。', 'Sum + 2Cout = A + B + Cin', [['A', 1], ['B', 1], ['Cin', 1]], [['Sum', 1], ['Cout', 1]], fullAdder(1),
    ['用第一个半加器计算 A+B。', '将其 Sum 与 Cin 接入第二个半加器。', '第二个 Sum 是结果，两个 Carry 通过 OR 合并为 Cout。'], 'FullAdder'),
  lesson(17, '两位加法', '串联进位', '计算两位 A+B+Cin，Sum 保留两位，Cout 表示溢出。', 'Sum + 4Cout = A + B + Cin', [['A', 2], ['B', 2], ['Cin', 1]], [['Sum', 2], ['Cout', 1]], fullAdder(2),
    ['从最低位开始相加。', '低位全加器的 Cout 接高位全加器的 Cin。', '两个 Sum 按位序合成总线，高位 Cout 连接最终进位。'], 'Adder2'),
  lesson(18, '四位加法', '构建组合运算器', '计算四位 A+B+Cin，Sum 保留四位，Cout 表示溢出。', 'Sum + 16Cout = A + B + Cin', [['A', 4], ['B', 4], ['Cin', 1]], [['Sum', 4], ['Cout', 1]], fullAdder(4),
    ['复用全加器或者两位加法器。', '每一级进位都只流向相邻的高位。', '四个位串联进位，将四个 Sum 接 JOIN，最高位 Cout 连接输出。'], 'Adder4'),
  lesson(19, '四位自增', '复用加法器', '将 A 加 1，Y 保留四位，Cout 表示从 15 回到 0 时的进位。', 'Y + 16Cout = A + 1', [['A', 4]], [['Y', 4], ['Cout', 1]],
    i => ({ Y: (i.A + 1) % 16, Cout: i.A === 15 ? 1 : 0 }),
    ['自增可以看成一次固定加法。', 'CONST 提供固定的 0 或 1，四位常量 1 仅最低位为 1。', '给四位加法器输入 A、常量 1 和 Cin=0。'], 'Increment4'),
  lesson(20, '四位减法', '补码与借位', 'Diff 是 A−B 的四位结果；A 小于 B 时 Borrow 为 1。', 'Diff = (A − B) mod 16；Borrow = (A < B)', [['A', 4], ['B', 4]], [['Diff', 4], ['Borrow', 1]],
    i => ({ Diff: (i.A - i.B + 16) % 16, Borrow: i.A < i.B ? 1 : 0 }),
    ['减法可转为 A 加上 B 的反码再加 1。', '每一位反转 B，把初始进位设为 1。', '四位相加的 Sum 就是 Diff；最高位 Cout 反转后得到 Borrow。'], 'Subtract4'),
];

export function getLevel(id: number): Level {
  const level = levels.find(level => level.id === id);
  if (!level) throw new Error('关卡不存在。');
  return level;
}

export function testInputs(id: number): Inputs[] {
  const ports = getLevel(id).inputPorts;
  const totalBits = ports.reduce((total, p) => total + p.bits, 0);
  return Array.from({ length: 2 ** totalBits }, (_, index) => {
    let shift = totalBits;
    return Object.fromEntries(ports.map(p => {
      shift -= p.bits;
      return [p.id, (index >> shift) & ((1 << p.bits) - 1)];
    }));
  });
}
