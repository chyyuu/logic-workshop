# 计算机架构实施计划

> 使用superpowers:subagent-driven-development在当前会话分工与审阅，用户已授权继续；不提交/发布。

**Goal:** 完成第33–44关后暂停。
**Architecture:** 扩展门级Worker与存储原语，独立教学数学规格与真实门级电路分开，工作台观察实际输出。
**Tech Stack:** React19/TS/Vite7/DigitalJS0.14.2/Vitest/Playwright。
**Spec:** `docs/computer-architecture-design.md`。

## 全局约束

保留存档；不进入编程应用；200节点/400线，展开2000/5000、16层、256组件版本、4MB；同步旧值；RAM地址依赖；每次交互追加日志。

## 任务与执行台账

- [x] 核心：owns contracts/model/netlist/simulator/simulation.worker；tests architecture-core/worker。先写16位、ROM高地址、RAM旧值/隔离/反馈测试；实现设计接口及场景程序保持；验证原仿真。
- [x] 教学：owns architectureSpec/architectureLevels/levels；tests architecture-levels。先测33–44定义与非法编码/程序覆盖；实现 encodeInstruction(op,param=0,imm=0)、decodeInstruction(word)、architecturePrograms；独立数学期望、cases与chapter6。
- [x] 电路：owns architectureCircuits；tests architecture-fixtures/architecture-circuits。实现architectureLibrary()和architectureReferenceCircuit(id)，每块门级图<200/400、展开<2000/5000；ROM id=program；CPU门级控制与状态而非替代执行器；验证封装/展开。
- [x] 存档：owns storage、architecture-storage测试与原测试版本/数量适配。先测v3迁移、44初始化、16位/ROM/依赖保留、瞬态排除；v4accept1/2/3/4，上限4/20/32/44；旧关测试专属范围保持。
- [x] 工作台：主代理owns App/CircuitNode/styles/ArchitecturePanel/architecture-editor.spec。先浏览器测试ROM撤销、取指、机器输出、程序反例回放、依赖导入、响应；教学工具按进度显示并添加依赖；运行交互沿用。
- [x] 验收：独立只读review规格/实现；修复具体发现并 scoped复审；全单元/生产构建/生产浏览器；示例存档/README/验收/log；留下5173服务、暂停。
- [x] 性能补充：核心负责人新增combinationalEvaluator与architecture-fast等价测试；无DFF/RAM批量判题拓扑计算真实门图；确认65536指令输入与旧32回归，无期望函数替代实际电路。

2026-10-01：用户“请继续完成‘计算机架构’阶段的所有关卡”授权实施；设计规格已自审。

## 完成记录

2026-10-01：第33–44关全部实施并完成独立审阅。审阅发现的RAM复位可观测性缺口已修复，新增Memory输出及错误电路回归，复审通过。CPU由实际门级组件构造。

全套单元194项通过、1项按需基准默认跳过（已单独开启通过）；生产构建通过；生产浏览器30项全部通过。全部时序场景与DigitalJS运行状态等价检查通过。完整44证明后台重验实测约1.23秒。

示例存档生产解析器检查通过：v4、当前33关、32旧证明、44草稿、23组件，解析重验约575ms。验收见docs/computer-architecture-acceptance.md，交互见docs/interaction-log.md。保留5173本地服务；按用户要求在计算机架构阶段完成后暂停，不进入编程应用，不提交或发布。