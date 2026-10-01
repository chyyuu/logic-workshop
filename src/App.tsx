import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ReactFlow, ReactFlowProvider, Background, BackgroundVariant, useReactFlow, type Connection, type NodeChange, type EdgeChange } from '@xyflow/react';
import { CircuitBoard, Check, ChevronRight, ArrowRight, Undo2, Redo2, Trash2, RotateCcw, Play, Pause, StepForward,
  ZoomIn, ZoomOut, Maximize, Download, Upload, LockKeyhole, Lightbulb, X, CircleCheck, CircleAlert,
  Menu, SlidersHorizontal, Cable, Plus, BookOpen, MousePointer2, Copy, Package, UnfoldHorizontal, ChevronLeft } from 'lucide-react';
import { addGate, addComponent, getPorts, validateCircuit, connect, canConnect, createCircuit, removeSelection, type Circuit } from './model';
import { levels, getLevel, testInputs, type GateType, type Inputs } from './levels';
import type { TestResult, ComponentDefinition } from './contracts';
import { encapsulateSelection, expandComponent, packageCircuit } from './components';
import { backgroundTask, useSimulation } from './workerClient';
import { createId } from './id';
import { loadWorkspace, saveWorkspace, type Workspace } from './storage';
import { CircuitNodeView, GateSymbol, nodeDimensions, type FlowNode } from './CircuitNode';
import { WireEdge, type FlowEdge } from './WireEdge';
import '@xyflow/react/dist/style.css';
import './styles.css';

const nodeTypes = { circuit: CircuitNodeView };
const edgeTypes = { wire: WireEdge };
const clone = <T,>(value: T): T => structuredClone(value);

function ToolButton({ label, children, onClick, disabled = false, active = false }: {
  label: string; children: ReactNode; onClick: () => void; disabled?: boolean; active?: boolean;
}) {
  return <button className={`tool-button ${active ? 'active' : ''}`} aria-label={label} title={label} onClick={onClick} disabled={disabled}>{children}</button>;
}

function Workshop() {
  const [initial] = useState(loadWorkspace);
  const [verifyingInitial, setVerifyingInitial] = useState(initial.savedText !== undefined);
  const [workspace, setWorkspace] = useState(initial.workspace);
  const current = workspace.currentLevel;
  const circuit = workspace.circuits[current];
  const level = getLevel(current);
  const inputs = workspace.inputs[current];
  const [history, setHistory] = useState<Record<number, { past: Circuit[]; future: Circuit[] }>>({});
  const [result, setResult] = useState<TestResult | null>(null);
  const [playing, setPlaying] = useState(false);
  const [pending, setPending] = useState<{ id: string; handle: string } | null>(null);
  const [selection, setSelection] = useState<{ nodes: string[]; wires: string[] }>({ nodes: [], wires: [] });
  const [hints, setHints] = useState<Record<number, number>>({});
  const [toast, setToast] = useState('');
  const [saveStatus, setSaveStatus] = useState(initial.error ?? '已保存');
  const [resetOpen, setResetOpen] = useState(false);
  const [chapterOpen, setChapterOpen] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);
  const [panel, setPanel] = useState<'task' | 'selection'>('task');
  const [libraryTab, setLibraryTab] = useState(false);
  const [busy, setBusy] = useState('');
  const [packageMode, setPackageMode] = useState<'selection' | 'whole' | null>(null);
  const [componentName, setComponentName] = useState('');
  const [inspect, setInspect] = useState<ComponentDefinition | null>(null);
  const [page, setPage] = useState(0);
  const [failureOnly, setFailureOnly] = useState(false);
  const [busBits, setBusBits] = useState(4);
  const [fitEpoch, setFitEpoch] = useState(0);
  const taskAbort = useRef<AbortController | null>(null);
  const taskId = useRef(0);
  const workspaceRef = useRef(workspace); workspaceRef.current = workspace;
  const dragBefore = useRef<Circuit | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const boardElement = useRef<HTMLDivElement>(null);
  const flow = useReactFlow<FlowNode, FlowEdge>();
  useEffect(() => {
    let frame: number;
    const fitWhenMeasured = () => {
      const nodes = flow.getNodes();
      const ready = nodes.length === circuit.nodes.length && nodes.every(n => {
        const expected = circuit.nodes.find(c => c.id === n.id);
        const measured = flow.getInternalNode(n.id)?.measured;
        return expected && measured?.width && measured?.height;
      });
      if (ready) void flow.fitView({ padding: 0.28 });
      else frame = requestAnimationFrame(fitWhenMeasured);
    };
    frame = requestAnimationFrame(fitWhenMeasured);
    return () => cancelAnimationFrame(frame);
  }, [fitEpoch, current, circuit.nodes.length, flow]);
  const done = Object.keys(workspace.proofs).length;
  const unlocked = Math.min(levels.length, done + 1);
  const currentHistory = history[current] ?? { past: [], future: [] };
  const resultCurrent = result?.revision === circuit.revision;
  const hintCount = hints[current] ?? 0;
  const samples = useMemo(() => testInputs(current), [current]);
  const selectedSample = samples.findIndex(i => level.inputs.every(name => i[name] === inputs[name]));

  const simulation = useSimulation(circuit, inputs, workspace.library);
  const rowsToShow = samples.map((sample, index) => ({ sample, index })).filter(({ index }) => !failureOnly || (resultCurrent && result?.rows[index] && !result.rows[index].passed));
  const pages = Math.max(1, Math.ceil(rowsToShow.length / 8));
  const shownPage = Math.min(page, pages - 1);
  const visibleRows = rowsToShow.slice(shownPage * 8, shownPage * 8 + 8);
  useEffect(() => { if (!failureOnly) setPage(Math.max(0, Math.floor(selectedSample / 8))); }, [selectedSample, failureOnly]);

  const notify = useCallback((message: string) => setToast(message), []);
  const cancelTask = useCallback(() => { ++taskId.current; taskAbort.current?.abort(); taskAbort.current = null; setBusy(''); setVerifyingInitial(false); }, []);
  useEffect(() => {
    if (initial.savedText === undefined) return;
    const controller = new AbortController(); taskAbort.current = controller;
    setBusy('验证通关记录');
    void backgroundTask<Workspace>('load', { text: initial.savedText }, controller.signal).then(restored => {
      setWorkspace(restored);
      setPending(null); setSelection({ nodes: [], wires: [] }); setInspect(null); setPackageMode(null); setResetOpen(false); setPanel('task');
      setFitEpoch(epoch => epoch + 1);
      setBusy(''); setVerifyingInitial(false);
    }).catch(error => { if (error.name !== 'AbortError') { setBusy(''); setVerifyingInitial(false); setSaveStatus('存档读取失败；新编辑会创建存档'); notify(`存档读取失败：${error.message}`); } });
    return () => controller.abort();
  }, [initial, notify]);
  useEffect(() => () => taskAbort.current?.abort(), []);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 4500); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => {
    if (workspace === initial.workspace || verifyingInitial) return;
    setSaveStatus('保存中');
    saveTimer.current = setTimeout(() => {
      try { saveWorkspace(workspace); setSaveStatus('已保存'); }
      catch { setSaveStatus('保存失败，请导出备份'); }
    }, 400);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [workspace, initial.workspace, verifyingInitial]);
  useEffect(() => {
    const flush = () => { if (workspace === initial.workspace || verifyingInitial) return; try { saveWorkspace(workspace); } catch { /* The persistent status covers storage failure. */ } };
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, [workspace, initial.workspace, verifyingInitial]);

  const commit = useCallback((next: Circuit, previous = circuit) => {
    if (verifyingInitial) return;
    cancelTask();
    setHistory(h => ({ ...h, [current]: { past: [...(h[current]?.past ?? []), clone(previous)].slice(-80), future: [] } }));
    setWorkspace(w => ({ ...w, circuits: { ...w.circuits, [current]: next } }));
    setPlaying(false); setPending(null);
  }, [circuit, current, cancelTask, verifyingInitial]);

  const applyInputs = useCallback((next: Inputs) => {
    setWorkspace(w => ({ ...w, inputs: { ...w.inputs, [current]: next } }));
  }, [current]);

  const step = useCallback(() => applyInputs(samples[(selectedSample + 1) % samples.length]), [samples, selectedSample, applyInputs]);
  useEffect(() => { if (!playing) return; const timer = setInterval(step, 900); return () => clearInterval(timer); }, [playing, step]);

  const changeLevel = (id: number) => {
    if (id > unlocked || busy === '验证通关记录') return;
    cancelTask(); setPage(0); setFailureOnly(false);
    setFitEpoch(epoch => epoch + 1);
    setWorkspace(w => ({ ...w, currentLevel: id }));
    setResult(null); setPending(null); setSelection({ nodes: [], wires: [] }); setPlaying(false);
    setChapterOpen(false); setTaskOpen(false); setPanel('task');
  };

  const vacantPosition = (width: number, height: number) => {
    const occupied = circuit.nodes.map(node => {
      const ports = getPorts(node, workspace.library);
      return { ...node.position, ...nodeDimensions(node.type, ports) };
    });
    for (let index = 0; index < 400; index++) {
      const position = { x: 300 + (index % 2) * 200, y: 100 + Math.floor(index / 2) * 170 };
      if (!occupied.some(rect => position.x < rect.x + rect.width + 16 && position.x + width + 16 > rect.x
        && position.y < rect.y + rect.height + 16 && position.y + height + 16 > rect.y)) return position;
    }
    return { x: 300, y: Math.max(...occupied.map(rect => rect.y + rect.height)) + 40 };
  };

  const add = (type: GateType, position?: { x: number; y: number }) => {
    const desired = position ?? vacantPosition(130, ['SPLIT', 'JOIN'].includes(type) ? Math.max(106, 46 + busBits * 25) : 106);
    try { commit(addGate(circuit, type, desired, undefined, workspace.library, ['SPLIT', 'JOIN', 'CONST'].includes(type) ? busBits : 1)); }
    catch (error) { notify((error as Error).message); }
  };

  const makeConnection = useCallback((connection: Connection) => {
    if (!connection.sourceHandle || !connection.targetHandle) return;
    try { commit(connect(circuit, connection.source, connection.sourceHandle, connection.target, connection.targetHandle, workspace.library)); }
    catch (error) { notify((error as Error).message); }
  }, [circuit, commit, notify, workspace.library]);

  const onPort = useCallback((id: string, handle: string, direction: 'input' | 'output') => {
    if (direction === 'output') { setPending(p => p?.id === id && p.handle === handle ? null : { id, handle }); return; }
    if (!pending) { notify('先选择一个输出端口。'); return; }
    makeConnection({ source: pending.id, sourceHandle: pending.handle, target: id, targetHandle: handle });
    setPending(null);
  }, [pending, makeConnection, notify]);

  const undo = useCallback(() => {
    const h = history[current]; if (!h?.past.length) return;
    cancelTask();
    const previous = clone(h.past.at(-1)!); previous.revision = circuit.revision + 1;
    setWorkspace(w => ({ ...w, circuits: { ...w.circuits, [current]: previous } }));
    setHistory(all => ({ ...all, [current]: { past: h.past.slice(0, -1), future: [clone(circuit), ...h.future] } }));
    setPending(null); setPlaying(false);
  }, [history, current, circuit, cancelTask]);

  const redo = useCallback(() => {
    const h = history[current]; if (!h?.future.length) return;
    cancelTask();
    const next = clone(h.future[0]); next.revision = circuit.revision + 1;
    setWorkspace(w => ({ ...w, circuits: { ...w.circuits, [current]: next } }));
    setHistory(all => ({ ...all, [current]: { past: [...h.past, clone(circuit)], future: h.future.slice(1) } }));
    setPending(null); setPlaying(false);
  }, [history, current, circuit, cancelTask]);

  const deleteSelected = useCallback(() => {
    const next = removeSelection(circuit, selection.nodes, selection.wires);
    if (next.nodes.length === circuit.nodes.length && next.wires.length === circuit.wires.length) return;
    commit(next); setSelection({ nodes: [], wires: [] });
  }, [circuit, selection, commit]);

  const duplicateSelected = useCallback(() => {
    const chosen = circuit.nodes.filter(n => selection.nodes.includes(n.id) && n.type !== 'INPUT' && n.type !== 'OUTPUT');
    if (!chosen.length) return;
    let next = circuit;
    const ids = new Map<string, string>();
    try {
      for (const n of chosen) {
        const id = createId('g'); ids.set(n.id, id);
        next = { ...next, revision: next.revision + 1, nodes: [...next.nodes, { ...clone(n), id, position: { x: n.position.x + 32, y: n.position.y + 130 } }] };
      }
      for (const wire of circuit.wires.filter(w => ids.has(w.source) && ids.has(w.target))) {
        next = connect(next, ids.get(wire.source)!, wire.sourceHandle, ids.get(wire.target)!, wire.targetHandle, workspace.library);
      }
      const error = validateCircuit(next, workspace.library)[0]; if (error) throw new Error(error);
      commit(next);
    } catch (error) { notify((error as Error).message); }
  }, [selection, circuit, commit, notify, workspace.library]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setPending(null); setChapterOpen(false); setTaskOpen(false); setResetOpen(false); setPackageMode(null); setInspect(null); return; }
      if ((event.target as HTMLElement).closest('input, textarea, select') || resetOpen || packageMode || inspect) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); redo(); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') { event.preventDefault(); duplicateSelected(); }
      if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); deleteSelected(); }
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, deleteSelected, duplicateSelected, resetOpen, packageMode, inspect]);

  const runTest = async () => {
    cancelTask();
    const id = ++taskId.current;
    const controller = new AbortController(); taskAbort.current = controller;
    setBusy('测试中');
    setPlaying(false); setPending(null); setPanel('task');
    try {
      const judged = await backgroundTask<TestResult>('judge', { circuit: clone(circuit), library: workspace.library }, controller.signal);
      if (id !== taskId.current || workspaceRef.current.currentLevel !== current || workspaceRef.current.circuits[current].revision !== circuit.revision) return;
      setResult(judged); setBusy(''); setFailureOnly(false);
      if (judged.failure) { applyInputs(judged.failure.inputs); setPage(Math.floor(samples.findIndex(i => level.inputs.every(name => i[name] === judged.failure!.inputs[name])) / 8)); }
      if (judged.passed) {
        setWorkspace(w => ({ ...w, proofs: { ...w.proofs, [current]: clone(circuit) } }));
      }
      if (window.innerWidth < 1100) setTaskOpen(true);
    } catch (error) { if ((error as Error).name !== 'AbortError') { setBusy(''); notify((error as Error).message); } }
  };

  const openPackage = (mode: 'selection' | 'whole') => { setPackageMode(mode); setComponentName(mode === 'whole' ? level.rewardName ?? level.title : '自定义组件'); };
  const saveComponent = () => {
    try {
      cancelTask();
      if (!componentName.trim()) throw new Error('请输入组件名称。');
      if (packageMode === 'whole') {
        const packaged = packageCircuit(circuit, componentName.trim(), workspace.library);
        setWorkspace(w => ({ ...w, library: packaged.library }));
      } else {
        const packaged = encapsulateSelection(circuit, selection.nodes, componentName.trim(), workspace.library);
        setWorkspace(w => ({ ...w, library: packaged.library })); commit(packaged.circuit);
        setSelection({ nodes: [], wires: [] });
      }
      setPackageMode(null); setLibraryTab(true); notify('组件已保存。');
    } catch (error) { notify((error as Error).message); }
  };
  const placeComponent = (key: string, position?: { x: number; y: number }) => {
    try {
      const definition = workspace.library[key];
      if (!definition) throw new Error('组件依赖缺失。');
      const desired = position ?? vacantPosition(180, Math.max(106, 46 + Math.max(definition.inputs.length, definition.outputs.length) * 25));
      commit(addComponent(circuit, key, desired, workspace.library));
    }
    catch (error) { notify((error as Error).message); }
  };

  const exportSave = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(workspace, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = 'logic-workshop-save.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify('存档已导出。');
  };

  const importSave = async (file?: File) => {
    if (!file) return;
    try {
      if (file.size > 4_000_000) throw new Error('存档超过 4 MB 限制。');
      cancelTask(); setBusy('验证导入存档');
      const id = ++taskId.current; const controller = new AbortController(); taskAbort.current = controller;
      const imported = await backgroundTask<Workspace>('load', { text: await file.text() }, controller.signal);
      if (id !== taskId.current) return;
      setBusy(''); setPage(0); setFailureOnly(false);
      setFitEpoch(epoch => epoch + 1);
      setWorkspace(imported); setHistory({}); setResult(null); setSelection({ nodes: [], wires: [] }); setPending(null); setPlaying(false);
      setInspect(null); setPackageMode(null); setResetOpen(false); setPanel('task');
      notify('存档已导入，通关记录已重新验证。');
    } catch (error) { if ((error as Error).name !== 'AbortError') { setBusy(''); notify(`导入失败：${(error as Error).message}`); } }
    if (importInput.current) importInput.current.value = '';
  };

  const showFailure = !!(resultCurrent && result?.failure && level.inputs.every(name => result.failure!.inputs[name] === inputs[name]));
  // Retain dimensions on controlled updates so React Flow keeps visibility and handle bounds.
  const flowNodes: FlowNode[] = circuit.nodes.map(node => ({ id: node.id, type: 'circuit', position: node.position,
    measured: nodeDimensions(node.type, getPorts(node, workspace.library)),
    selected: selection.nodes.includes(node.id), data: {
      kind: node.type, label: node.label, value: node.type === 'INPUT' ? inputs[node.id] : simulation.values[node.id] ?? 'X', bits: node.bits ?? 1, ports: getPorts(node, workspace.library),
      portValues: Object.fromEntries(getPorts(node, workspace.library).outputs.map(p => [p.id, node.type === 'INPUT' ? inputs[node.id] : simulation.portValues[`${node.id}:${p.id}`] ?? 'X'])),
      inputValues: Object.fromEntries(circuit.wires.filter(w => w.target === node.id).map(w => [w.targetHandle, simulation.wires[w.id]])),
      pending: pending ? `${pending.id}:${pending.handle}` : null, failed: showFailure && !!result?.failure?.mismatches.includes(node.id),
      onToggle: id => { setPlaying(false); applyInputs({ ...inputs, [id]: inputs[id] === 1 ? 0 : 1 }); }, onPort,
      onValue: (id, value) => { setPlaying(false); applyInputs({ ...inputs, [id]: Math.trunc(value) }); },
    } }));
  const flowEdges: FlowEdge[] = circuit.wires.map(wire => ({ ...wire, type: 'wire', selected: selection.wires.includes(wire.id),
    data: { value: simulation.wires[wire.id] ?? 'X', bits: getPorts(circuit.nodes.find(n => n.id === wire.source)!, workspace.library).outputs.find(p => p.id === wire.sourceHandle)?.bits,
      failed: showFailure && !!result?.failure?.mismatches.includes(wire.target) } }));

  const onNodesChange = (changes: NodeChange<FlowNode>[]) => {
    const selected = changes.filter(change => change.type === 'select');
    if (selected.length) setSelection(previous => {
      const ids = new Set(previous.nodes);
      for (const change of selected) change.selected ? ids.add(change.id) : ids.delete(change.id);
      return { ...previous, nodes: [...ids] };
    });
    const positions = changes.filter(change => change.type === 'position');
    if (!positions.length) return;
    setWorkspace(w => {
      const currentCircuit = w.circuits[current];
      return { ...w, circuits: { ...w.circuits, [current]: { ...currentCircuit,
        nodes: currentCircuit.nodes.map(n => {
          const change = positions.find(p => p.id === n.id);
          return change?.position ? { ...n, position: change.position } : n;
        }) } } };
    });
  };

  const onEdgesChange = (changes: EdgeChange<FlowEdge>[]) => {
    const selected = changes.filter(change => change.type === 'select');
    if (selected.length) setSelection(previous => {
      const ids = new Set(previous.wires);
      for (const change of selected) change.selected ? ids.add(change.id) : ids.delete(change.id);
      return { ...previous, wires: [...ids] };
    });
  };

  const selectedNode = circuit.nodes.find(n => selection.nodes.includes(n.id));
  const selectedWire = circuit.wires.find(w => selection.wires.includes(w.id));
  const hasEditableSelection = circuit.nodes.some(n => selection.nodes.includes(n.id) && n.type !== 'INPUT' && n.type !== 'OUTPUT');

  return <div className="workshop">
    <aside className={`sidebar ${chapterOpen ? 'mobile-open' : ''}`}>
      <div className="brand"><span className="brand-mark"><CircuitBoard size={23} /></span><div><strong>逻辑工坊</strong><span>LOGIC WORKSHOP</span></div>
        <button className="close-sidebar tool-button" aria-label="关闭关卡目录" onClick={() => setChapterOpen(false)}><X size={18} /></button></div>
      <div className="library-tabs"><button className={!libraryTab ? 'chosen' : ''} onClick={() => setLibraryTab(false)}><BookOpen size={14} />关卡</button><button className={libraryTab ? 'chosen' : ''} onClick={() => setLibraryTab(true)}><Package size={14} />组件库 <small>{Object.keys(workspace.library).length}</small></button></div>
      <div className="sidebar-scroll">
      {!libraryTab ? <nav className="lesson-list" aria-label="关卡">
        {levels.map(item => <button key={item.id} className={`lesson ${item.id === current ? 'current' : ''}`} disabled={item.id > unlocked}
          aria-label={`第 ${item.id} 关 ${item.title}`} aria-current={item.id === current ? 'step' : undefined} onClick={() => changeLevel(item.id)}>
          <span className={`lesson-number ${workspace.proofs[item.id] ? 'completed' : ''}`}>{workspace.proofs[item.id] ? <Check size={14} /> : item.id > unlocked ? <LockKeyhole size={12} /> : String(item.id).padStart(2, '0')}</span>
          <span className="lesson-copy"><strong>{item.title}</strong><small>{item.caption}</small></span>
          {item.id === current && <ChevronRight size={15} />}
        </button>)}
      </nav> : <section className="saved-components" aria-label="组件库">
        {Object.entries(workspace.library).map(([key, definition]) => <div className="library-item" key={key}>
          <button className="component" aria-label={`添加组件 ${definition.name} v${definition.version}`} draggable onDragStart={e => e.dataTransfer.setData('application/logic-component', key)} onClick={() => placeComponent(key)}>
            <Package size={23} /><span><strong>{definition.name}</strong><small>v{definition.version} · {definition.inputs.length} 输入 / {definition.outputs.length} 输出</small></span><Plus size={15} /></button>
          <button className="library-inspect" onClick={() => setInspect(definition)}>查看内部电路</button>
        </div>)}
        {!Object.keys(workspace.library).length && <p className="library-empty">组件库为空</p>}
      </section>}
      <div className="components-section"><div className="sidebar-section-title"><Cable size={14} /><span>可用组件</span><span className="component-count">{level.allowed.length}</span></div>
        {level.allowed.includes('SPLIT') && <label className="bus-size">总线位宽<select aria-label="总线位宽" value={busBits} onChange={e => setBusBits(Number(e.target.value))}>{level.allowed.includes('CONST') && <option value="1">1 bit</option>}<option value="2">2 bit</option><option value="4">4 bit</option></select></label>}
        {level.allowed.length === 0 ? <div className="wire-component"><Cable size={26} /><div><strong>导线</strong><span>1 bit</span></div></div> : level.allowed.map(type =>
          <button className="component" key={type} aria-label={`添加 ${type}`} draggable onDragStart={e => { e.dataTransfer.setData('application/logic-gate', type); e.dataTransfer.effectAllowed = 'copy'; }} onClick={() => add(type)}>
            <GateSymbol type={type} small /><span><strong>{type}</strong><small>{({ NAND: '与非门', NOT: '非门', AND: '与门', OR: '或门', XOR: '异或门', XNOR: '同或门', SPLIT: '拆分总线', JOIN: '合并总线', CONST: '常量' })[type]} · {['SPLIT', 'JOIN', 'CONST'].includes(type) ? busBits : 1} bit</small></span><Plus size={15} />
          </button>)}
      </div>
      </div>
      <div className="sidebar-progress"><div><span>总进度</span><strong data-testid="progress-count">{done} / {levels.length}</strong></div><div className="progress-track"><i style={{ width: `${done / levels.length * 100}%` }} /></div></div>
      <div className="sidebar-footer"><span className="footer-dot" /><span>从信号到运算</span><span className="version">v0.2</span></div>
    </aside>

    <main className="main-workspace">
      <header className="workspace-header"><div className="workspace-location">
        <ToolButton label="查看关卡" onClick={() => setChapterOpen(true)}><Menu size={19} /></ToolButton>
        <span className="mobile-brand">逻辑工坊</span><span className="header-chapter">第 {level.chapter} 章</span><ChevronRight size={14} /><strong>{level.title}</strong><span className="level-pill">{String(current).padStart(2, '0')}</span>
      </div><div className={`save-status ${saveStatus.includes('失败') ? 'save-error' : ''}`}><span />{saveStatus}</div>
        <div className="file-tools"><ToolButton label="导出存档" onClick={exportSave}><Download size={17} /></ToolButton><ToolButton label="导入存档" onClick={() => importInput.current?.click()}><Upload size={17} /></ToolButton></div>
        <input ref={importInput} type="file" accept="application/json,.json" hidden onChange={e => void importSave(e.target.files?.[0])} />
      </header>

      <div className="editor-toolbar"><div className="toolbar-title"><span className="status-dot" />电路工作区<span className="toolbar-meta">{circuit.nodes.length - level.inputs.length - level.outputPorts.length} 元件 · {circuit.wires.length} 连接</span></div>
        <div className="edit-tools"><ToolButton label="撤销" onClick={undo} disabled={!currentHistory.past.length}><Undo2 size={17} /></ToolButton>
          <ToolButton label="重做" onClick={redo} disabled={!currentHistory.future.length}><Redo2 size={17} /></ToolButton>
          <span className="tool-divider" /><ToolButton label="复制所选组件" onClick={duplicateSelected} disabled={!hasEditableSelection}><Copy size={16} /></ToolButton>
          <ToolButton label="删除所选" onClick={deleteSelected} disabled={!selection.wires.length && !hasEditableSelection}><Trash2 size={16} /></ToolButton>
          <ToolButton label="封装所选组件" onClick={() => openPackage('selection')} disabled={!hasEditableSelection}><Package size={16} /></ToolButton>
          <ToolButton label="重置当前电路" onClick={() => setResetOpen(true)}><RotateCcw size={16} /></ToolButton>
        </div><div className="run-tools"><ToolButton label={playing ? '暂停用例' : '播放用例'} active={playing} onClick={() => setPlaying(p => !p)}>{playing ? <Pause size={17} /> : <Play size={17} />}</ToolButton>
          <ToolButton label="下一组输入" onClick={() => { setPlaying(false); step(); }}><StepForward size={18} /></ToolButton>
          {busy ? <button className="test-button" aria-label="取消后台任务" onClick={cancelTask}><X size={16} /><span>{busy}</span></button> : <button className="test-button" aria-label="测试电路" onClick={() => void runTest()}><CircleCheck size={16} /><span>测试电路</span></button>}
          <button className="task-toggle tool-button" aria-label="查看任务" title="查看任务" onClick={() => setTaskOpen(true)}><SlidersHorizontal size={18} /></button>
        </div>
      </div>

      <div className="editor-content">
        <section className="board-area" aria-label="电路画布">
          <div className="board" ref={boardElement}>
            <ReactFlow<FlowNode, FlowEdge> nodes={flowNodes} edges={flowEdges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
              onConnect={makeConnection} connectOnClick={false} connectionRadius={28}
              isValidConnection={conn => !!conn.sourceHandle && !!conn.targetHandle && canConnect(circuit, conn.source, conn.sourceHandle, conn.target, conn.targetHandle, workspace.library)}
              onConnectEnd={(_e, state) => { if (!state.isValid && state.toHandle) notify('连接无效：输入已有驱动或会形成反馈回路。'); }}
              onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
              onEdgeClick={(event, edge) => { event.stopPropagation(); setSelection(previous => ({ nodes: event.shiftKey ? previous.nodes : [], wires: event.shiftKey ? [...new Set([...previous.wires, edge.id])] : [edge.id] })); }}
              onNodeDragStart={() => { dragBefore.current = clone(circuit); }}
              onNodeDragStop={(_event, _node, draggedNodes) => {
                const before = dragBefore.current; dragBefore.current = null;
                if (!before) return;
                const moved = new Map(draggedNodes.map(n => [n.id, n.position]));
                const nodes = circuit.nodes.map(n => moved.has(n.id) ? { ...n, position: moved.get(n.id)! } : n);
                if (JSON.stringify(before.nodes.map(n => n.position)) !== JSON.stringify(nodes.map(n => n.position))) commit({ ...circuit, nodes, revision: circuit.revision + 1 }, before);
              }}
              onPaneClick={() => { setPending(null); setSelection({ nodes: [], wires: [] }); }}
              onDrop={event => { event.preventDefault(); const position = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }); const type = event.dataTransfer.getData('application/logic-gate') as GateType; const key = event.dataTransfer.getData('application/logic-component'); if (level.allowed.includes(type)) add(type, position); if (key) placeComponent(key, position); }}
              onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; }}
              fitView fitViewOptions={{ padding: 0.3 }} minZoom={0.08} maxZoom={1.6} snapToGrid snapGrid={[10, 10]}
              panOnDrag={[1, 2]} selectionOnDrag deleteKeyCode={null} multiSelectionKeyCode="Shift"
              defaultEdgeOptions={{ type: 'wire' }} attributionPosition="bottom-left">
              <Background variant={BackgroundVariant.Dots} color="#cbd2d7" gap={20} size={1.1} />
            </ReactFlow>
            <div className="board-labels"><span>输入</span><span>输出</span></div>
            <div className="board-legend"><span><i className="legend-one" />1</span><span><i className="legend-zero" />0</span><span><i className="legend-x" />X</span></div>
            {pending && <div className="connection-status"><Cable size={14} /><span>{circuit.nodes.find(n => n.id === pending.id)?.label}.{pending.handle}</span><ArrowRight size={13} /><span>输入端口</span><button aria-label="取消连线" onClick={() => setPending(null)}><X size={13} /></button></div>}
            <div className="viewport-tools"><ToolButton label="缩小" onClick={() => void flow.zoomOut({ duration: 150 })}><ZoomOut size={17} /></ToolButton>
              <ToolButton label="放大" onClick={() => void flow.zoomIn({ duration: 150 })}><ZoomIn size={17} /></ToolButton>
              <span className="tool-divider" /><ToolButton label="适应画布" onClick={() => void flow.fitView({ padding: 0.28, duration: 200 })}><Maximize size={16} /></ToolButton></div>
            {simulation.error && <div className="board-error" role="alert">{simulation.error}</div>}
          </div>

          <section className="test-panel" aria-label="测试用例">
            <div className="test-panel-heading"><div><span className="panel-label">真值表</span><span className="muted">{samples.length} 组输入</span></div><div className="sample-indicator"><span className={playing ? 'playing-dot' : ''} />{playing ? '播放中' : '当前输入'}<strong>{String(selectedSample + 1).padStart(2, '0')}</strong><span>/ {String(samples.length).padStart(2, '0')}</span></div></div>
            <div className="test-table-wrap"><table><thead><tr><th className="row-number">用例</th>{level.inputs.map(name => <th key={name}>{name}</th>)}{level.outputPorts.map(p => <th key={p.id}>期望 {p.label}</th>)}{level.outputPorts.map(p => <th key={p.id}>实际 {p.label}</th>)}<th>结果</th></tr></thead>
              <tbody>{visibleRows.map(({ sample, index }) => {
                const row = resultCurrent ? result?.rows[index] : undefined;
                const expected = level.expectedOutputs(sample);
                return <tr key={index} className={`${index === selectedSample ? 'active-row' : ''} ${row && !row.passed ? 'failed-row' : ''}`} onClick={() => { setPlaying(false); applyInputs(sample); }}>
                  <td><button aria-label={`观察用例 ${index + 1}`} onClick={event => { event.stopPropagation(); setPlaying(false); applyInputs(sample); }}><span className="row-cursor">{index === selectedSample ? <ChevronRight size={12} /> : null}</span>{String(index + 1).padStart(2, '0')}</button></td>
                  {level.inputs.map(name => <td key={name}>{sample[name]}</td>)}{level.outputPorts.map(p => <td key={`expected-${p.id}`}>{expected[p.id]}</td>)}
                  {level.outputPorts.map(p => { const actual = row?.actualOutputs[p.id] ?? (index === selectedSample ? simulation.values[p.id] ?? 'X' : '-'); return <td key={`actual-${p.id}`} className={typeof actual === 'string' && actual.includes('X') ? 'unknown-cell' : ''}>{actual}</td>; })}
                  <td>{row ? <span className={`table-status ${row.passed ? 'pass' : 'fail'}`}>{row.passed ? <Check size={12} /> : <X size={12} />}{row.passed ? '通过' : '不一致'}</span> : <span className="untested">待测试</span>}</td>
                </tr>;
              })}</tbody></table></div>
            <div className="test-panel-footer"><span>{resultCurrent && result ? `${result.rows.filter(r => r.passed).length} / ${samples.length} 通过` : '尚未验证'}{simulation.pending && ' · 信号计算中'}</span>
              {samples.length > 8 && <div className="pagination"><label><input type="checkbox" checked={failureOnly} disabled={!resultCurrent} onChange={e => { setFailureOnly(e.target.checked); setPage(0); }} />仅失败</label><ToolButton label="上一页用例" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={!shownPage}><ChevronLeft size={14} /></ToolButton><span>{shownPage + 1} / {pages}</span><ToolButton label="下一页用例" onClick={() => setPage(p => Math.min(pages - 1, p + 1))} disabled={shownPage === pages - 1}><ChevronRight size={14} /></ToolButton></div>}
            </div>
          </section>
        </section>

        <aside className={`task-panel ${taskOpen ? 'mobile-open' : ''}`}>
          <div className="task-tabs"><button className={panel === 'task' ? 'chosen' : ''} onClick={() => setPanel('task')}>任务</button><button className={panel === 'selection' ? 'chosen' : ''} onClick={() => setPanel('selection')}>属性</button>
            <button className="close-task tool-button" aria-label="关闭任务" onClick={() => setTaskOpen(false)}><X size={18} /></button></div>
          <div className="task-panel-scroll">
            {panel === 'task' ? <><div className="task-eyebrow">关卡 {String(current).padStart(2, '0')}<span>{workspace.proofs[current] ? '已完成' : '进行中'}</span></div>
              <h1>{level.title}</h1><p className="task-story">{level.story}</p>
              <div className="goal-section"><h3>目标</h3><p>{level.goal}</p><div className="formula">{level.formula}</div></div>
              <div className="interface-section"><h3>接口</h3>{level.inputPorts.map(p => <div key={p.id}><span>输入</span><strong>{p.label}</strong><small>{p.bits} bit</small></div>)}{level.outputPorts.map(p => <div key={p.id}><span>输出</span><strong>{p.label}</strong><small>{p.bits} bit</small></div>)}</div>
              <div className="hint-section"><div><h3>思路提示</h3><span>{hintCount} / 3</span></div>
                {level.hints.slice(0, hintCount).map((hint, index) => <p key={hint}><span>0{index + 1}</span>{hint}</p>)}
                <button className="hint-button" disabled={hintCount === 3} onClick={() => setHints(h => ({ ...h, [current]: Math.min(3, (h[current] ?? 0) + 1) }))}><Lightbulb size={15} />{hintCount === 3 ? '提示已全部展开' : hintCount ? '下一条提示' : '展开提示'}<ChevronRight size={14} /></button>
              </div>
              <div className={`test-feedback ${resultCurrent && result?.passed ? 'passed' : resultCurrent && result ? 'not-passed' : ''}`} data-testid="test-feedback" aria-live="polite">
                {resultCurrent && result ? result.passed ? <><CircleCheck size={23} /><strong>{samples.length} / {samples.length} 全部通过</strong><p>{current === levels.length ? '全部关卡完成。' : '电路正确，下一关已解锁。'}</p>
                  <button className="secondary-button save-component-button" onClick={() => openPackage('whole')}><Package size={14} />保存为组件</button>
                  {current < levels.length ? <button className="next-button" aria-label="下一关" onClick={() => changeLevel(current + 1)}>下一关<ArrowRight size={16} /></button>
                    : <button className="next-button" onClick={exportSave}>导出我的作品<Download size={15} /></button>}</>
                  : <><CircleAlert size={22} /><strong>{result.error ? '检查电路连接' : '发现不一致'}</strong>{result.failure && <><p className="failure-inputs">{Object.entries(result.failure.inputs).map(([name, v]) => `${name} = ${v}`).join('，')}</p>
                    {level.outputPorts.filter(p => result.failure!.mismatches.includes(p.id)).map(p => <div key={p.id} className="failure-values"><span>{level.outputPorts.length > 1 ? `${p.label} ` : ''}期望 <b>{result.failure!.expectedOutputs[p.id]}</b></span><span>实际 <b>{result.failure!.actualOutputs[p.id]}</b></span></div>)}
                    <p>已定位到输出 {result.failure.mismatches.join('、')}。</p><button className="secondary-button" onClick={() => { applyInputs(result.failure!.inputs); setFailureOnly(false); }}>回放反例</button></>}{result.error && <p>{result.error}</p>}</>
                  : <><CircuitBoard size={23} /><strong>{result && !resultCurrent ? '电路已修改' : '等待验证'}</strong><p>{result && !resultCurrent ? '重新测试当前电路。' : '完成连接后，测试所有输入组合。'}</p></>}
              </div>
            </> : <div className="properties-section"><h3>所选对象</h3>{selectedNode ? <><h1>{selectedNode.label}</h1><dl><dt>类型</dt><dd>{selectedNode.type}</dd><dt>位宽</dt><dd>{selectedNode.type === 'COMPONENT' ? `${getPorts(selectedNode, workspace.library).inputs.map(p => p.bits).join(',')} → ${getPorts(selectedNode, workspace.library).outputs.map(p => p.bits).join(',')}` : selectedNode.bits ?? 1} bit</dd><dt>当前信号</dt><dd>{selectedNode.type === 'INPUT' ? inputs[selectedNode.id] : simulation.values[selectedNode.id] ?? 'X'}</dd><dt>位置</dt><dd>{Math.round(selectedNode.position.x)}, {Math.round(selectedNode.position.y)}</dd></dl>
                {selectedNode.type === 'CONST' && <label className="property-input">常量值<input aria-label="常量值" type="number" min="0" max={2 ** (selectedNode.bits ?? 1) - 1} value={selectedNode.value ?? 0} onChange={e => { const value = Math.max(0, Math.min(2 ** (selectedNode.bits ?? 1) - 1, Math.trunc(Number(e.target.value)))); commit({ ...circuit, revision: circuit.revision + 1, nodes: circuit.nodes.map(n => n.id === selectedNode.id ? { ...n, value } : n) }); }} /></label>}
                {selectedNode.type === 'COMPONENT' && <><button className="secondary-button" onClick={() => setInspect(workspace.library[selectedNode.componentKey!])}><Package size={14} />查看内部电路</button><button className="secondary-button" onClick={() => { try { commit(expandComponent(circuit, selectedNode.id, workspace.library)); setSelection({ nodes: [], wires: [] }); } catch (error) { notify((error as Error).message); } }}><UnfoldHorizontal size={14} />展开组件</button></>}
                {selectedNode.type === 'INPUT' || selectedNode.type === 'OUTPUT' ? <p className="muted">关卡固定端口</p> : <button className="secondary-button" onClick={deleteSelected}><Trash2 size={14} />删除组件</button>}</>
                : selectedWire ? <><h1>导线</h1><dl><dt>来源</dt><dd>{circuit.nodes.find(n => n.id === selectedWire.source)?.label}.{selectedWire.sourceHandle}</dd><dt>目标</dt><dd>{circuit.nodes.find(n => n.id === selectedWire.target)?.label}.{selectedWire.targetHandle}</dd><dt>信号</dt><dd>{simulation.wires[selectedWire.id]}</dd></dl><button className="secondary-button" onClick={deleteSelected}><Trash2 size={14} />删除导线</button></>
                : <div className="empty-selection"><MousePointer2 size={26} /><p>未选择对象</p></div>}</div>}
          </div>
          <div className="task-footer"><span>数字逻辑</span><span>组合电路</span></div>
        </aside>
      </div>
    </main>
    {(chapterOpen || taskOpen) && <button className="drawer-backdrop" aria-label="关闭侧栏" onClick={() => { setChapterOpen(false); setTaskOpen(false); }} />}
    {toast && <div className="toast" role="status"><CircleAlert size={16} /><span>{toast}</span><button aria-label="关闭通知" onClick={() => setToast('')}><X size={14} /></button></div>}
    {packageMode && <div className="modal-backdrop" onClick={() => setPackageMode(null)}><section className="reset-dialog" role="dialog" aria-modal="true" aria-labelledby="package-title" onClick={e => e.stopPropagation()}><Package size={24} /><h2 id="package-title">{packageMode === 'whole' ? '保存电路为组件' : '封装所选组件'}</h2><label className="property-input">组件名称<input autoFocus aria-label="组件名称" maxLength={60} value={componentName} onChange={e => setComponentName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') saveComponent(); if (e.key === 'Escape') setPackageMode(null); }} /></label><div><button className="secondary-button" onClick={() => setPackageMode(null)}>取消</button><button className="test-button" onClick={saveComponent}>保存组件</button></div></section></div>}
    {inspect && <div className="modal-backdrop" onClick={() => setInspect(null)}><section className="component-dialog" role="dialog" aria-modal="true" aria-label="组件内部电路" onClick={e => e.stopPropagation()}><header><h2>{inspect.name} <small>v{inspect.version}</small></h2><ToolButton label="关闭组件详情" onClick={() => setInspect(null)}><X size={18} /></ToolButton></header><div className="component-interfaces"><span>输入 {inspect.inputs.map(p => `${p.label}:${p.bits}`).join(' · ')}</span><span>输出 {inspect.outputs.map(p => `${p.label}:${p.bits}`).join(' · ')}</span></div>
      <div className="component-preview"><ReactFlowProvider><ReactFlow<FlowNode, FlowEdge> nodes={inspect.graph.nodes.map(n => ({ id: n.id, type: 'circuit', position: n.position, measured: nodeDimensions(n.type, getPorts(n, workspace.library)), data: { kind: n.type, label: n.label, bits: n.bits ?? 1, ports: getPorts(n, workspace.library), value: 'X', inputValues: {}, portValues: {}, pending: null, failed: false, readOnly: true, onToggle: () => {}, onValue: () => {}, onPort: () => {} } }))} edges={inspect.graph.wires.map(w => ({ ...w, type: 'wire', data: { value: 'X', failed: false } }))} nodeTypes={nodeTypes} edgeTypes={edgeTypes} nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} fitView minZoom={0.04}><Background gap={20} /></ReactFlow></ReactFlowProvider></div>
      <footer>{inspect.dependencies.length ? <span>依赖 {inspect.dependencies.map(key => workspace.library[key]?.name ?? key).join(' · ')}</span> : <span>{inspect.graph.nodes.filter(n => n.type !== 'INPUT' && n.type !== 'OUTPUT').length} 个元件</span>}</footer></section></div>}
    {resetOpen && <div className="modal-backdrop" onClick={() => setResetOpen(false)}><section className="reset-dialog" role="dialog" aria-modal="true" aria-labelledby="reset-title" onClick={e => e.stopPropagation()}>
      <RotateCcw size={24} /><h2 id="reset-title">重置当前电路？</h2><p>移除本关的逻辑门与导线。章节进度保留，重置后可以撤销。</p><div><button autoFocus className="secondary-button" onClick={() => setResetOpen(false)}>取消</button><button className="danger-button" aria-label="确认重置" onClick={() => { const next = createCircuit(current); next.revision = circuit.revision + 1; commit(next); setResetOpen(false); }}>确认重置</button></div>
    </section></div>}
  </div>;
}

export default function App() { return <ReactFlowProvider><Workshop /></ReactFlowProvider>; }
