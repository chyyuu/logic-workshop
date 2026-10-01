# 状态与时间 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** 交付第 21–32 关的时序交互完整闭环，随后暂停让用户测试。

**Architecture:** 扩展现有组件契约，引入 DFF 状态源和统一沿采样。展开图检查组合依赖，DigitalJS 继续负责组合求稳；后台 worker 管理临时时钟状态和波形。新关卡独立提供时序参考场景，存档迁移到 v3。

**Tech Stack:** React、TypeScript、React Flow、DigitalJS 0.14.2、Web Worker、Vitest、Playwright。

**Spec:** docs/state-and-time-design.md

## Global Constraints

- 保留用户已有文件和 20 关数据；不提交/推送 Git。
- 每步先求稳、统一采样、同时提交、再求稳，同步复位优先。
- 可见 200 节点/400 连接，展开 2,000 节点/5,000 连接、深度 16；单驱动、位宽一致。
- 运行状态不跨刷新保存；组件依赖与版本完整保存。
- 完成当前阶段即暂停，不实施后两阶段。
- 需求、进展和最终结果追加到 docs/interaction-log.md。

## Work Ledger

- [x] Core：netlist/model/simulator，DFF 与八位端口、真实组合环验证、时序判题和实例隔离；先写行为测试。
- [x] Lessons：levels/sequentialLevels，12 关 metadata、独立场景与数学期望、合法参考电路和覆盖测试。
- [x] Storage/worker：v3 迁移、32 关证明验证、临时状态与有限波形、时序操作。
- [x] UI：时钟控制、状态复位、波形、时序表与完整反例回放、八位输入/元件。
- [x] Review：核对全阶段要求与边界，修复发现。
- [x] Acceptance：单元回归、生产构建、浏览器时序场景/旧流程/响应验证；文档和用户试玩存档。

Ruling: 原路线 V2 的 10–12 关具体化为 12 关，既含独立存储原语教学，又含用原语和复用组件构造存储器；先完成这一阶段后停下，遵守用户试玩要求。

Review fix: 展开带有外部自反馈的寄存器组件时，旧接口替换保留了指向被删除实例的端点。现先替换两个端点，再通过临时接口顶点接通实际驱动和扇出；行为回归覆盖保持、复位、未知值与完整使能序列，复审确认修复。

Layout fix: 示例电路列间距改为 220px，每行按最高元件加 44px；八位 JOIN 不再与下一行重叠。封装内部视图的接口放到所选图的左右边界外。

Completion: 96 项单元测试、25 项生产版浏览器测试与生产构建通过。参考时序用例共 190 个场景、6,899 个步骤；原 20 关的 1,672 组输入仍通过。详见 docs/state-and-time-acceptance.md。现在按用户要求暂停，等待本阶段试玩反馈；不继续后两阶段。
