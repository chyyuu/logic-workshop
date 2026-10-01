# 计算机架构阶段设计

日期2026-10-01。交付第33–44关；完成后暂停试玩，编程应用随后开展。用户已明确要求实施。

沿用电路工作台和统一时钟，增加16位指令总线、256×16 ROM、256×8 RAM。ROM/RAM是存储原语；ALU、PC、控制器、CPU由逻辑门和DFF构造。参考机只生成期望值。提供可查看/展开的教学子组件，按教学进度显示，保存完整依赖；也可使用玩家的组件。

| 关 | 名称 | 输入 → 输出 | 契约 |
|---|---|---|---|
|33|八位加减器|A8,B8,Sub1 → Y8,Carry1,Borrow1,Z1|mod256；加法Carry、减法Borrow，其余为0，Z=(Y=0)|
|34|八位ALU|A8,B8,Op2 → Y8,Carry1,Borrow1,Z1|Op=0加、1减、2AND、3XOR；逻辑运算清进借位|
|35|双寄存器组|D8,WA1,WB1,R1 → A8,B8|独立使能，同沿同时写，共享同步复位|
|36|程序计数器|E1,Jump1,Target8,R1 → PC8|R优先，E=1时Jump选Target，否则PC+1，E=0保持|
|37|指令格式|Instruction16 → Opcode4,Param4,Imm8,Valid1|分字段并校验操作码/保留位|
|38|取指电路|E1,Jump1,Target8,R1 → PC8,IR16|IR捕获旧PC对应ROM字，再更新PC|
|39|三阶段时序|E1,Stop1,R1 → Phase2,Execute1|0→1→2→0，E=0或Stop保持，R清零，Execute=(Phase=2)|
|40|指令控制器|Instruction16,Z1,Phase2 → WA1,WB1,ALUOp2,MemWrite1,MemRead1,Jump1,OutWrite1,Halt1,Invalid1|合法控制仅Phase=2生效；Invalid始终指示非法编码|
|41|字节存储器|Addr8,D8,W1,R1 → Q8|256格独立状态，同步写/复位、组合读|
|42|输出端口|D8,Write1,R1 → Out8|写沿锁存，其余保持，复位清零|
|43|指令数据通路|Instruction16,Data8,Exec1,R1 → A8,B8,Z1,Out8,Halt1,Fault1,Jump1,Target8,Addr8,Store8,MemWrite1,MemRead1|外部指令/读数据，Exec执行，HLT/故障锁定到复位|
|44|我的八位计算机|E1,R1 → PC8,IR16,Phase2,A8,B8,Z1,Memory8,Out8,Halt1,Fault1|ROM、RAM和门级CPU组成三阶段机器；Memory组合观察当前IR低八位地址的RAM数据|

## 指令与时钟

指令字=opcode[15:12]+param[11:8]+imm/address[7:0]。操作码0 NOP、1 MOVI、2 ADD、3 SUB、4 LOAD、5 STORE、6 JMP、7 JZ、8 OUT、9 HLT。
MOVI param0写A/1写B，其他参数非法；LOAD/STORE/JMP/JZ param必须0；NOP/ADD/SUB/OUT/HLT param和imm必须0；10–15非法。
所有状态初始0（Z也为0）。写A的MOVI/ADD/SUB/LOAD更新Z；其他指令保持Z。结果mod256，JZ用旧Z，RAM初始全0。
Phase0沿捕获ROM[旧PC]到IR；Phase1仅推进；Phase2执行IR，普通指令PC+1，跳转按条件写地址。HLT/非法编码保持PC和Phase2并锁定；非法同时设置Fault/Halt且无副作用。E=0冻结所有状态及RAM写；R沿上清全部状态/RAM并保留ROM。三个有效周期完成一条普通指令。

## 接口与运行

GateType增加ROM/RAM；CircuitNode增加`words?:number[]`，ROM长度0–256、未填地址0；ROM固定bits16，端口addr8→q16；RAM固定bits8，addr8,d8,we1,rst1→q8。RuntimeState增加`memories?:Record<string,Signal[]>`，按实例路径隔离。RAM地址有组合依赖，不能切断addr→q反馈；写输入只在沿上生效。16位支持总线工具/逻辑门/DFF/常量。
TestSequence增加`program?:number[]`，第38/44场景覆盖固定ROM节点`program`。`replaySequence(circuit,library,steps,program?)`从零完整回放；每场景重新编译对应程序，真实寻址仍来自玩家电路。Worker回放程序保持到reset/结构变化。手动修改ROM作为一次可撤销commit，清运行状态。
Level增加`cases?:()=>Inputs[]`，testInputs优先cases；33/34/37/40为组合测试集合，37覆盖全部65536编码，其他覆盖全部8位值/边界/控制组合。界面称“通过测试集”，不虚称穷举。其他关独立数学状态机与有限程序序列，覆盖暂停、复位、旧值、回绕、高地址、跳转、停止、非法指令。

## 工作台与存档

新增机器观察面板PC/IR/Phase/A/B/Z/Out/Halt/Fault，值来自真实仿真；ROM表格编辑16位字与译码、标出实际PC。单步仍是一个周期。参考教学组件通过`architectureLibrary():ComponentLibrary`提供，sourceLevel<current时工具显示，添加时保存完整依赖。`architectureReferenceCircuit(id):Circuit`为合法门级图，CPU不能成为黑箱原语。
存档v4读取v1四关/v2二十关/v3三十二关并补至44，保留草稿、证明、组件依赖与ROM字；不存RAM/寄存器运行数据。createWorkspace.library仍为空，教学组件由用户显式添加；不自动替换用户现有存档。

## 验收

44关有合法电路；新12关逐一判题。反例完整复现；封装/展开等价，RAM实例隔离，撤销完整，导入保留依赖与ROM，原32关回归；CPU批量判题时主线程持续响应。完成后提供第33关起试玩存档、验收文档和交互日志，暂停等用户测试。

审阅补充：第44关公开Memory8观察RAM，检测暂停时错误的提前STORE；增加先LOAD255再写入/停止的程序，复位后在覆盖地址前LOAD，以检测RAM复位缺失。将RAM.rst固定0或RAM.we绕过E的错误电路必须产生可重放反例。

### 已发现的性能需求

门级 DigitalJS 批量组合判题在第37关65536输入上约67秒，并造成Vitest任务更新超时。增加预编译组合网表执行路径，仅用于无DFF/RAM图的批量判题；按拓扑计算真实门、接口、拆合与未知位掩码，逐项对照DigitalJS结果验证。交互与时序CPU继续使用DigitalJS。此优化不解析指令语义、不读取期望值，缩短证明重验和新关测试等待。

全44证明复验仍约123.5秒，补充时序批量判题的同一门级编译执行路径：DFF读状态源，RAM保留地址依赖，所有d/rst/we旧值采样后同时提交；每场景从零状态开始。交互和反例回放仍用DigitalJS。等价测试比较所有已交付时序关卡的场景末尾64步、完整寄存器/RAM状态及未知信号，覆盖两个独立执行路径的契约。
