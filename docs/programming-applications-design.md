# 编程应用阶段设计

2026-10-01。用户已要求继续完成最后阶段，完成第45–56关后暂停供试玩。沿用现有八位CPU和指令集。

## 教学与实现选择

采用在既有真实门级CPU上写汇编的路线：保留可观察电路，编程关固定机器及其依赖，只允许修改程序和布局。汇编器翻译为ROM字，运行与判题仍执行门级图。纯解释器会失去从硬件到软件的连续性；继续让每道应用题搭不同CPU会重复上一阶段。固定机器使本阶段集中练习算法。

| 关卡 | 任务 | 独立期望 |
|---|---|---|
| 45 | 第一个汇编程序 | 输出42，正常停止 |
| 46 | 字节运算与溢出 | 输出(250+13−5) mod256=2 |
| 47 | 内存搬运 | RAM[240]复制到242并输出原字节 |
| 48 | 倒计时循环 | 输入n，依次输出n…0并停止 |
| 49 | 条件分支 | 输入0输出0，其他输入输出1 |
| 50 | 两数相加 | RAM[240]+RAM[241] mod256 |
| 51 | 常数乘法 | 3×RAM[240] mod256 |
| 52 | 累加求和 | 1+…+n mod256 |
| 53 | 奇偶判断 | n mod2 |
| 54 | 四格求和 | RAM[240…243]之和 mod256 |
| 55 | 斐波那契 | F(0)=0、F(1)=1，输出F(n) mod256 |
| 56 | 两数相乘 | RAM[240]×RAM[241] mod256 |

每关公开确定测试集，含零值、边界、回绕和多组不同输入。倒计时检查重复输出事件及顺序，不只检查最后Out。其他任务要求恰好一次OUT、HLT=1、Fault=0；47关额外检查RAM[242]。测试预算足以执行参考程序，超过预算诊断未停止。期望由数学函数产生，允许不同合法算法和程序长度。无需逐周期匹配参考程序寄存器值。

## 汇编与存档

沿用NOP、MOVI A/B, byte、ADD、SUB、LOAD addr、STORE addr、JMP addr/label、JZ addr/label、OUT、HLT。大小写不敏感，标签仅标识符，分号注释，字节接受十进制或0x十六进制。两遍解析前向标签；每条指令1字；最多256字，禁止越界、重复/未知标签、错误参数，显示源行号。不开新指令、宏或间接寻址。

`assemble(source)`返回`{words,listing:[{address,word,line,text}],labels}`，错误抛出带行号的中文Error；`disassemble(words)`返回可重新汇编且保留合法字的源文本，非法字诊断，不伪装合法指令。

ROM节点新增`programSource?:string`，只保存已经成功汇编且与words完全一致的源文本。编辑应用为一个撤销事务，错误不提交。v5保存56关，兼容v1/v2/v3/v4，v4上限固定44。旧存档补入12个带完整依赖的编程机器草稿。源最大32,000字符。工作区保存组件、ROM和源文本，运行内存、输出记录、断点、选择测试、撤销栈均不跨刷新保存。导入验证程序机器完整性、源/字一致性和全部依赖，然后重新判题。

编程机器为第44关参考根图，levelId改为45–56，ROM初始为空；用户库完整保存其所需的architecture-*版本。固定机器比较电气结构和依赖闭包，忽略位置、revision以及根ROM的words/programSource；不允许改CPU节点、参数、连接或内层依赖作弊。原1–44关依然可自由编辑。

## 调试与判题

测试输入由选中场景初始化RAM，清零重置后重新载入该场景；R是机器同步复位，会真正清RAM，重新载入场景使用“重启用例”。程序修改/切关/导入取消运行并从选择用例初始状态启动。源编辑器显示生成地址/指令字、当前PC与源行；实际机器显示PC/IR/Phase/A/B/Z/Out/Halt/Fault、256格RAM分页、OUT事件序列。

提供周期单步、指令单步、快速运行/暂停、地址断点。断点在Phase=0且即将取该地址时停止；继续时跳过当前断点一次，仍可在下次循环命中。运行由Worker分批真实门级执行，每批至多90周期，主线程可响应；到HLT、Fault、断点或本用例预算时停止。输入E=0不自动推进机器，R保留既有语义。判题使用独立临时状态，不改变调试实例。

新增`ProgramCase {id,label,memory:Record<number,number>,expectedOutput:number[],maxCycles:number,expectedMemory?:Record<number,number>}`。`programmingCases(id)`返回公开集合，`programmingReferenceSource(id)`给测试参考汇编，`programmingReferenceCircuit(id)`把源汇编到固定机器。

判题每个用例从零状态和其memory开始执行保存的ROM，不替换成参考ROM。收集prePhase=2、preIR为合法OUT且E=1、R=0、未停止时的输出事件，故连续相同OUT也算两次。TestRow新增`program?:{expectedOutput:number[],actualOutput:Signal[],reason:string}`；周期为失败或终止实际周期，scenarioId为用例id，stepIndex等于周期。失败重放实际程序和该输入到首个输出不符或预算周期，并保持运行状态供下一步调试。末尾没有OUT、额外OUT、FAULT、错误内存、未停止均须明确说明。

`Simulation.program?:{caseId:string,outputs:Signal[],instructions:number,memory:Signal[],stopReason?:'halt'|'fault'|'breakpoint'|'budget'|'paused'}`。Worker扩展`programStep`（instruction布尔）、`programRun`（breakpoints数组、maxCycles≤90）、`programCase`（caseId）、原replay处理编程用例。原tick/reset/simulate在编程关保持选中用例与输出；重启清零并载入测试数据，R则真正清RAM。

## 验收

12关均通过实际门级参考程序；至少覆盖错误常量、错条件、漏OUT、重复OUT、RAM漏写、非法指令、无限循环的失败及回放。编程门级运行与DigitalJS旧值状态对照。源与ROM应用、完整撤销/重做、旧44证明迁移、56关导入、依赖篡改拒绝、瞬态不保存均测试。浏览器覆盖完整编辑→汇编→执行→判题→解锁、断点→继续、不同输入用例、失败重放、运行暂停、移动端和主线程响应。最后全套单元、生产构建、生产浏览器验收；生成从45关开始的示例与参考源，更新README、验收及交互日志，不提交或发布。
