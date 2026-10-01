# 编程应用实施计划

> 使用superpowers:subagent-driven-development在当前会话分工实施、审阅；用户已授权继续完成。保留当前可试玩目录，不提交/推送。

**Goal:** 完成第45–56关及汇编调试闭环后暂停。
**Architecture:** 汇编到现有16位ROM字，在固定真实门级八位CPU上运行，数学规格独立判题，Worker负责批次调试与回放。
**Tech Stack:** 现有React/TypeScript/Vite/DigitalJS/Vitest/Playwright，不新增依赖。
**Spec:** docs/programming-applications-design.md。

## 全局约束

200节点/400线；展开2000节点/5000线/16层；256组件版本；4MB存档；256字ROM；32,000字符源；v5兼容1–4；每批≤90周期；时钟采样旧值；仅本阶段；交互追加日志。

## 任务

- [x] 任务1 汇编与教学：owns assembler.ts、programmingSpec.ts、programmingLevels.ts、levels.ts及对应测试。产出设计中的assemble/disassemble、ProgramCase、programmingCases、programmingReferenceSource；先测前向标签、源行错误、字节越界和12关数学集合，再写实现。参考算法使用现有ISA，不依赖模拟器产生期望。
- [x] 任务2 固定机器与执行：owns programmingMachine.ts、programmingRunner.ts、contracts.ts、model.ts、simulator.ts、simulation.worker.ts、workerClient.ts及programming-core/worker测试。产出programmingReferenceCircuit；实际门级执行场景、OUT事件、预算、断点、单步、失败回放；先测固定结构及非法依赖、重复OUT、无限循环，再实现；对照DigitalJS状态。
- [x] 任务3 存档：owns storage.ts、tests/fixtures.ts、旧测试版本/总量适配及programming-storage.test.ts。v5含56关，源/ROM匹配、依赖闭包、迁移完整机器草稿、Transient排除；先测v4保持44证明/补齐12、源错误及依赖篡改，再实现。仅此任务批量适配旧测试硬编码，不改浏览器新编程用例。
- [x] 任务4 工作台：主代理owns App.tsx、ProgrammingPanel.tsx、styles.css及programming-editor.spec.ts。编程源主编辑器、生成指令、断点、PC源行、内存与输出、用例切换、测试汇总和反例；原关卡UI保持。原编辑命令在编程关受固定机器约束，源应用单次完整撤销。
- [x] 任务5 审阅与交付：每部分完成后只读规格/质量审阅，汇总修复具体发现并复审；单元+生产构建+生产浏览器；生成示例/参考源；README/验收/日志/计划；留下5173服务，暂停。

## 接口预检

| 任务边界 | 产出/消费 | 检查 |
|---|---|---|
| 1→2 | ProgramCase、assemble、programmingCases与ReferenceSource | 固定签名见spec；独立数学期望，执行只读ROM |
| 2→3 | programmingReferenceCircuit与固定机器校验 | 默认草稿空ROM，参考仅测试；依赖完整保存 |
| 1/2→4 | 程序源/字、Simulation.program、Worker扩展 | 源应用同一事务，机器状态源于真实门级 |
| 3→4 | Workspace.version5及迁移输入 | 运行初始E=1/R=0；不保存断点与调试状态 |
| 1自身 | ISA/算法/公开输入 | 最多256字；有足够但有限预算 |
| 2自身 | 固定机/门级/时钟 | 只忽略位置和根ROM，依赖结构不可绕过 |
| 3自身 | 旧版本/源一致/闭包 | v4最大44，新v5最大56，旧证明连续重验 |
| 4自身 | 运行/取消/编辑/回放 | 过期结果过滤，取消后界面响应 |

用户请求和前期设计已核对。工作目录Git状态干净，继续沿用用户此前测试的目录。不存在需删除或覆盖的个人存档，不引入发布步骤。

## 执行台账

2026-10-01：任务1–4已实施并完成只读规格/质量审阅；未提交或发布。

- 汇编、12关数学任务与合法参考源；379公开用例，全12关门级判题通过。
- 固定CPU结构/依赖完整性；Worker真实门级批次执行、指令单步、取指断点、种子RAM、输出事件及失败前缀。
- v5保存56关、源/ROM与完整依赖，兼容旧1–4；默认编程E1/R0，运行瞬态排除。
- 浏览器6项功能回归覆盖12关解锁、原子应用/完整撤销、输入/RAM、断点续跑、额外OUT与未停止、主线程响应和移动编辑。
- 审阅共确认4个具体P2：第50关非对称预算、44→45→44会话状态泄漏、编程输入E/R只读、相同汇编应用不重启。全部已修复，预算与泄漏先实际复现后新增门级/Worker回归，相同源先浏览器复现周期9未归零；修复波次只读复查确认无剩余发现。
- 最终初轮单元22文件：253通过/1失败/1跳过，失败为旧数据通路展开的5秒等待限制；另有旧全时序等价测试长时间同步执行导致Vitest进度RPC超时。单用例调整30秒，完整场景比较间增加setImmediate交还测试进度事件，保留全部断言与场景。重跑完整单元中。
- docs/programming-applications-demo.json生产解析重验通过：v5、当前45关、44证明、56草稿、23组件、1040645字节、379用例，1312ms。本次生成12篇参考汇编于docs/programming-reference-programs.md。
最终完整验收：22个单元文件全部通过，254项通过、1项按需性能基准默认跳过，退出码0，90.39秒，无未处理错误；TypeScript/Vite生产构建通过（Vite8.45秒）；生产浏览器36项全部通过、退出码0、约5.2分钟。新增6项包含全部12关通关至56/56和审阅修复的相同源重启/E/R回归。没有剩余审阅发现。

示例、参考汇编、README/IMPLEMENTATION、验收与交互日志已更新；保留本地5173服务，关闭临时5183预览。按用户要求暂停，等待试玩；未提交、推送或发布。