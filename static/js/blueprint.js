/**
 * CodeGraph - 蓝图模式前端
 * 使用 LiteGraph.js 实现以文件为节点的蓝图可视化
 *
 * 每个 Python 文件 = 一个蓝图节点
 *   左侧引脚 = 该文件引入的类、函数等
 *   右侧引脚 = 该文件定义的类、函数等
 * 连线 = 跨文件的精确引用关系
 */

// ============ 配置 ============
const SLOT_COLORS = {
    "class":    "#45B7D1",
    "function": "#96CEB4",
    "method":   "#FFEAA7",
    "constant": "#DDA0DD",
    "external": "#FF9F43",
    "package":  "#FF6B6B",
    "module":   "#4ECDC4",
};

const TYPE_ABBR = {
    package:  'PKG',
    module:   'MOD',
    class:    'CLS',
    function: 'FUN',
    method:   'FUN',
    constant: 'CST',
    external: 'EXT',
};

const TYPE_PREFIX = {
    package:  '[PKG]🟥',
    module:   '[MOD]🟩',
    class:    '[CLS]🟨',
    function: '[FUN]🟩',
    method:   '[FUN]🟦',
    constant: '[CST]🟪',
    external: '[EXT]🟧',
};

const SLOT_LABEL_MAX_CHARS = 42;
const NODE_MIN_WIDTH = 290;
const NODE_MAX_WIDTH = 860;
const NODE_SIDE_PADDING = 20;
const NODE_CENTER_GAP = 30;

const EDGE_TYPE_CONFIG = {
    imports:      { color: "#E74C3C", label: "导入" },
    inherits:     { color: "#3498DB", label: "继承" },
    contains:     { color: "#95A5A6", label: "包含" },
    calls:        { color: "#2ECC71", label: "调用" },
    decorates:    { color: "#9B59B6", label: "装饰" },
    instantiates: { color: "#F39C12", label: "实例化" },
    uses:         { color: "#00CEC9", label: "使用" },
};

// ============ 全局状态 ============
let graph = null;
let graphCanvas = null;
let rawBlueprintData = null;   // 后端原始数据 { modules, links }
let currentMetadata = null;
let lgNodeMap = {};            // module_id → LGraphNode
let browsePath = '';
let browseParent = '';
let currentRenderedData = null;
let lastBaseData = null;
let highlightedModuleId = null;
let hoveredPinInfo = null;
let pinTooltipEl = null;
let focusMode = {
    active: false,
    centerId: null,
};

function t(key, vars) {
    if (window.CodeGraphI18n && typeof window.CodeGraphI18n.t === 'function') {
        return window.CodeGraphI18n.t(key, vars);
    }
    return key;
}

function getTypeAbbr(type) {
    return TYPE_ABBR[type] || 'N/A';
}

function getTypePrefix(type) {
    return TYPE_PREFIX[type] || '⬜N/A';
}

function getModuleColorByType(type) {
    if (type === 'external') return { color: '#FF9F43', bgcolor: '#3d2e1a' };
    if (type === 'package') return { color: '#FF6B6B', bgcolor: '#3a1f24' };
    return { color: '#4ECDC4', bgcolor: '#1a3a38' };
}

function truncateSlotLabel(label) {
    const text = String(label || '');
    if (text.length <= SLOT_LABEL_MAX_CHARS) return text;
    return `${text.slice(0, SLOT_LABEL_MAX_CHARS - 1)}…`;
}

function estimateTextWidth(text) {
    let w = 0;
    const s = String(text || '');
    for (let i = 0; i < s.length; i++) {
        const code = s.charCodeAt(i);
        w += code <= 0x00ff ? 6 : 10;
    }
    return w;
}

// ============ DOM 元素 ============
const projectPathInput = document.getElementById('projectPath');
const analyzeBtn = document.getElementById('analyzeBtn');
const browseBtn = document.getElementById('browseBtn');
const arrangeBtn = document.getElementById('arrangeBtn');
const fitBtn = document.getElementById('fitBtn');
const welcomeScreen = document.getElementById('welcomeScreen');
const blueprintContainer = document.getElementById('blueprintContainer');
const loading = document.getElementById('loading');
const statsPanel = document.getElementById('statsPanel');
const statsContent = document.getElementById('statsContent');
const detailPanel = document.getElementById('detailPanel');
const detailTitle = document.getElementById('detailTitle');
const detailContent = document.getElementById('detailContent');
const closeDetail = document.getElementById('closeDetail');
const browseModal = document.getElementById('browseModal');
const closeBrowse = document.getElementById('closeBrowse');
const cancelBrowse = document.getElementById('cancelBrowse');
const parentDirBtn = document.getElementById('parentDirBtn');
const currentPathSpan = document.getElementById('currentPath');
const dirList = document.getElementById('dirList');
const selectDirBtn = document.getElementById('selectDirBtn');
const searchInput = document.getElementById('searchInput');
const searchCount = document.getElementById('searchCount');
const backToFullBtn = document.getElementById('backToFullBtn');
const appContainer = document.querySelector('.app-container');
const sidebarToggleBtn = document.getElementById('sidebarToggleBtn');

// ============ 事件监听 ============
analyzeBtn.addEventListener('click', handleAnalyze);
browseBtn.addEventListener('click', () => openBrowseModal());
arrangeBtn.addEventListener('click', () => { if (rawBlueprintData) performAutoLayout(); });
fitBtn.addEventListener('click', fitToView);
closeDetail.addEventListener('click', () => detailPanel.style.display = 'none');
closeBrowse.addEventListener('click', () => browseModal.style.display = 'none');
cancelBrowse.addEventListener('click', () => browseModal.style.display = 'none');
parentDirBtn.addEventListener('click', handleParentDir);
selectDirBtn.addEventListener('click', handleSelectDir);
searchInput.addEventListener('input', handleSearch);
searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        handleSearch();
    }
});
backToFullBtn.addEventListener('click', exitFocusMode);

document.querySelectorAll('.node-filter, .edge-filter').forEach(cb => {
    cb.addEventListener('change', applyFilters);
});

projectPathInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleAnalyze();
});

document.querySelectorAll('input[type="text"], select').forEach(el => {
    el.addEventListener('keydown', (e) => e.stopPropagation());
});

initSidebarToggle();

function initSidebarToggle() {
    if (!appContainer || !sidebarToggleBtn) return;

    const syncToggleButton = () => {
        const collapsed = appContainer.classList.contains('sidebar-collapsed');
        sidebarToggleBtn.textContent = collapsed ? '⮞' : '⮜';
        sidebarToggleBtn.title = collapsed ? t('common.expand_sidebar') : t('common.collapse_sidebar');
    };

    sidebarToggleBtn.addEventListener('click', () => {
        appContainer.classList.toggle('sidebar-collapsed');
        syncToggleButton();
        setTimeout(() => {
            resizeCanvas();
            if (graphCanvas) graphCanvas.setDirty(true, true);
        }, 180);
    });

    syncToggleButton();
}

// ============ LiteGraph 初始化 ============

function initLiteGraph() {
    // 注册蓝图节点类型
    function BlueprintNode() {
        this.title = "Module";
        this.size = [280, 80];
        this.properties = { module_id: "", module_type: "module", file_path: "" };
        this.serialize_widgets = true;
    }
    BlueprintNode.title = "蓝图节点";
    BlueprintNode.desc = "代码模块蓝图节点";
    BlueprintNode.prototype.onDrawForeground = function(ctx) {
        if (this.properties.file_path) {
            ctx.font = "10px 'Segoe UI', 'Microsoft YaHei', sans-serif";
            ctx.fillStyle = 'rgba(160,160,192,0.5)';
            const fp = this.properties.file_path;
            const shortPath = fp.length > 38 ? '...' + fp.slice(-35) : fp;
            ctx.fillText(shortPath, 8, this.size[1] - 6);
        }
    };
    BlueprintNode.prototype.getExtraMenuOptions = function() { return []; };
    LiteGraph.registerNodeType("codegraph/module", BlueprintNode);

    // 提升节点标题可读性
    LiteGraph.NODE_TITLE_COLOR = '#f3f6ff';
    LiteGraph.NODE_TEXT_COLOR = '#e8ecff';

    graph = new LGraph();
    const canvasEl = document.getElementById('blueprintCanvas');
    graphCanvas = new LGraphCanvas(canvasEl, graph);

    // 暗色主题
    graphCanvas.background_color = '#1a1b2e';
    graphCanvas.clear_background_color = '#1a1b2e';
    graphCanvas.render_shadows = false;
    graphCanvas.render_curved_connections = true;
    graphCanvas.render_connection_arrows = true;
    graphCanvas.always_render_background = true;
    graphCanvas.show_info = false;
    graphCanvas.allow_searchbox = false;
    graphCanvas.default_link_color = '#6c5ce7';

    // 禁用画布右键菜单（新增节点/分组入口在此），保留拖拽与缩放。
    canvasEl.addEventListener('contextmenu', (e) => {
        e.preventDefault();
    });

    // 某些 LiteGraph 版本会直接调用内部 context menu 处理，这里统一短路。
    if (typeof graphCanvas.processContextMenu === 'function') {
        graphCanvas.processContextMenu = function() {
            return false;
        };
    }

    // 明确清空各类菜单项，避免节点/分组菜单绕过。
    graphCanvas.getCanvasMenuOptions = function() { return []; };
    graphCanvas.getNodeMenuOptions = function() { return []; };
    graphCanvas.getGroupMenuOptions = function() { return []; };

    graphCanvas.onNodeSelected = function(node) {
        if (node && node.properties && node.properties.module_id) {
            highlightNeighborhood(node.properties.module_id);
            showNodeDetail(node);
        }
    };
    graphCanvas.onNodeDeselected = function() {
        detailPanel.style.display = 'none';
        clearHighlight();
    };
    graphCanvas.onNodeDblClicked = function(node) {
        if (node && node.properties && node.properties.module_id) {
            enterFocusMode(node.properties.module_id);
        }
    };

    canvasEl.addEventListener('mousemove', handleCanvasMouseMove);
    canvasEl.addEventListener('mouseleave', handleCanvasMouseLeave);
    canvasEl.addEventListener('click', handleCanvasPinClick);

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    graph.start();
}

function ensurePinTooltip() {
    if (pinTooltipEl) return pinTooltipEl;
    pinTooltipEl = document.createElement('div');
    pinTooltipEl.className = 'bp-pin-tooltip';
    pinTooltipEl.style.display = 'none';
    document.body.appendChild(pinTooltipEl);
    return pinTooltipEl;
}

function escapeHtml(text) {
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function normalizeDocstring(docstring) {
    const text = String(docstring || '').trim();
    return text || '暂无注释';
}

function showPinTooltip(content, clientX, clientY) {
    const el = ensurePinTooltip();
    el.innerHTML = escapeHtml(content);
    el.style.display = 'block';
    const offset = 14;
    const maxX = window.innerWidth - el.offsetWidth - 8;
    const maxY = window.innerHeight - el.offsetHeight - 8;
    el.style.left = `${Math.max(8, Math.min(clientX + offset, maxX))}px`;
    el.style.top = `${Math.max(8, Math.min(clientY + offset, maxY))}px`;
}

function hidePinTooltip() {
    if (pinTooltipEl) {
        pinTooltipEl.style.display = 'none';
    }
}

function getGraphPosFromMouse(event) {
    if (!graphCanvas) return null;
    const canvasEl = graphCanvas.canvas;
    const rect = canvasEl.getBoundingClientRect();
    const x = (event.clientX - rect.left) / graphCanvas.ds.scale - graphCanvas.ds.offset[0];
    const y = (event.clientY - rect.top) / graphCanvas.ds.scale - graphCanvas.ds.offset[1];
    return [x, y];
}

function findPinAtGraphPos(x, y) {
    if (!graph || !graph._nodes) return null;
    const tmp = [0, 0];

    for (let n = graph._nodes.length - 1; n >= 0; n--) {
        const node = graph._nodes[n];
        const moduleId = node.properties && node.properties.module_id;
        if (!moduleId) continue;

        const inputs = node.inputs || [];
        for (let i = 0; i < inputs.length; i++) {
            const slot = inputs[i];
            if (!slot || !slot._itemId) continue;
            node.getConnectionPos(true, i, tmp);
            const inXMin = node.pos[0] - 12;
            const inXMax = node.pos[0] + 150;
            const inYMin = tmp[1] - 11;
            const inYMax = tmp[1] + 11;
            if (x >= inXMin && x <= inXMax && y >= inYMin && y <= inYMax) {
                return {
                    moduleId,
                    direction: 'input',
                    itemId: slot._itemId,
                    label: slot._label || slot.name || slot._itemId,
                    docstring: normalizeDocstring(slot._docstring),
                };
            }
        }

        const outputs = node.outputs || [];
        for (let i = 0; i < outputs.length; i++) {
            const slot = outputs[i];
            if (!slot || !slot._itemId) continue;
            node.getConnectionPos(false, i, tmp);
            const outXMin = node.pos[0] + node.size[0] - 150;
            const outXMax = node.pos[0] + node.size[0] + 12;
            const outYMin = tmp[1] - 11;
            const outYMax = tmp[1] + 11;
            if (x >= outXMin && x <= outXMax && y >= outYMin && y <= outYMax) {
                return {
                    moduleId,
                    direction: 'output',
                    itemId: slot._itemId,
                    label: slot._label || slot.name || slot._itemId,
                    docstring: normalizeDocstring(slot._docstring),
                };
            }
        }
    }
    return null;
}

function handleCanvasMouseMove(event) {
    const pos = getGraphPosFromMouse(event);
    if (!pos) return;
    const pin = findPinAtGraphPos(pos[0], pos[1]);
    hoveredPinInfo = pin;
    if (!pin) {
        hidePinTooltip();
        return;
    }
    const text = `${pin.label}\n${pin.docstring}`;
    showPinTooltip(text, event.clientX, event.clientY);
}

function handleCanvasMouseLeave() {
    hoveredPinInfo = null;
    hidePinTooltip();
}

function handleCanvasPinClick() {
    if (!hoveredPinInfo) return;
    highlightByPin(hoveredPinInfo.moduleId, hoveredPinInfo.itemId, hoveredPinInfo.direction);
}

function isEditableTarget(target) {
    if (!target) return false;
    const tag = target.tagName ? target.tagName.toUpperCase() : '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    return !!target.isContentEditable;
}

function handleBlueprintHotkeys(event) {
    if (isEditableTarget(event.target)) return;
    const key = event.key;
    // 禁用删除快捷键，防止误删节点/连线。
    if (key === 'Delete' || key === 'Backspace') {
        event.preventDefault();
        event.stopPropagation();
    }
}

document.addEventListener('keydown', handleBlueprintHotkeys, true);

function resizeCanvas() {
    const canvasEl = document.getElementById('blueprintCanvas');
    if (!canvasEl || !canvasEl.parentElement) return;
    const container = canvasEl.parentElement;
    canvasEl.width = container.clientWidth;
    canvasEl.height = container.clientHeight;
    if (graphCanvas) graphCanvas.resize();
}

// ============ 核心：解析与构建 ============

async function handleAnalyze() {
    const path = projectPathInput.value.trim();
    if (!path) { showToast(t('common.toast_input_path'), 'error'); return; }

    loading.style.display = 'flex';
    analyzeBtn.disabled = true;

    try {
        const response = await fetch('/api/blueprint/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.detail || '解析失败');

        if (result.success) {
            rawBlueprintData = result.data;
            currentMetadata = result.metadata;

            welcomeScreen.style.display = 'none';
            blueprintContainer.style.display = 'block';
            if (!graph) initLiteGraph();
            resizeCanvas();

            buildBlueprintGraph(getFilteredData());
            showStats(currentMetadata);
            showToast(t('common.toast_parse_done', {
                nodes: currentMetadata.total_nodes,
                edges: currentMetadata.total_edges,
            }), 'success');
        }
    } catch (error) {
        showToast(t('common.toast_error_prefix', { message: error.message }), 'error');
    } finally {
        loading.style.display = 'none';
        analyzeBtn.disabled = false;
    }
}

/**
 * 构建蓝图图谱
 * data = { modules: [...], links: [...] }
 */
function buildBlueprintGraph(data) {
    graph.clear();
    lgNodeMap = {};
    currentRenderedData = data;

    // slot 索引映射: module_id → { outputMap: {item_id: idx}, inputMap: {item_id: idx} }
    const slotMap = {};

    // 1. 创建节点
    data.modules.forEach(mod => {
        const node = LiteGraph.createNode("codegraph/module");
        if (!node) return;

        const nodeColors = getModuleColorByType(mod.node_type);
        node.title = `[${getTypeAbbr(mod.node_type)}] ${mod.label}`;
        node.color = nodeColors.color;
        node.bgcolor = nodeColors.bgcolor;
        node.title_text_color = '#f3f6ff';
        node.properties = {
            module_id: mod.id,
            module_type: mod.node_type,
            file_path: mod.file_path || "",
        };

        slotMap[mod.id] = { outputMap: {}, inputMap: {} };

        const inputDisplayLabels = [];
        const outputDisplayLabels = [];

        // 添加输入引脚（左侧 - 引入项）
        mod.inputs.forEach(inp => {
            const shortLabel = truncateSlotLabel(inp.label);
            const displayLabel = `${getTypePrefix(inp.node_type)} ${shortLabel}`;
            const slotIdx = (node.inputs || []).length;
            node.addInput(displayLabel, "*");
            if (node.inputs && node.inputs[slotIdx]) {
                node.inputs[slotIdx].color_on = SLOT_COLORS[inp.node_type] || "#aaa";
                node.inputs[slotIdx]._itemId = inp.id;
                node.inputs[slotIdx]._label = inp.label;
                node.inputs[slotIdx]._docstring = inp.docstring || '';
            }
            slotMap[mod.id].inputMap[inp.id] = slotIdx;
            inputDisplayLabels.push(displayLabel);
        });

        // 添加输出引脚（右侧 - 定义项）
        mod.outputs.forEach(out => {
            const shortLabel = truncateSlotLabel(out.label);
            const displayLabel = `${shortLabel} ${getTypePrefix(out.node_type)}`;
            const slotIdx = (node.outputs || []).length;
            node.addOutput(displayLabel, "*");
            if (node.outputs && node.outputs[slotIdx]) {
                node.outputs[slotIdx].color_on = SLOT_COLORS[out.node_type] || "#aaa";
                node.outputs[slotIdx]._itemId = out.id;
                node.outputs[slotIdx]._label = out.label;
                node.outputs[slotIdx]._docstring = out.docstring || '';
            }
            slotMap[mod.id].outputMap[out.id] = slotIdx;
            outputDisplayLabels.push(displayLabel);
        });

        // 节点尺寸：根据左右引脚最大文本长度动态计算宽度，减少遮挡
        const maxInputW = inputDisplayLabels.length
            ? Math.max(...inputDisplayLabels.map(estimateTextWidth))
            : 64;
        const maxOutputW = outputDisplayLabels.length
            ? Math.max(...outputDisplayLabels.map(estimateTextWidth))
            : 64;
        const titleW = estimateTextWidth(node.title);
        const dynamicWidth = Math.max(
            NODE_MIN_WIDTH,
            maxInputW + maxOutputW + NODE_SIDE_PADDING * 2 + NODE_CENTER_GAP,
            titleW + 38,
        );
        const clampedWidth = Math.min(NODE_MAX_WIDTH, dynamicWidth);

        const maxSlots = Math.max(mod.inputs.length, mod.outputs.length, 1);
        node.size = [clampedWidth, maxSlots * 22 + 50];

        graph.add(node);
        lgNodeMap[mod.id] = node;
    });

    // 2. 创建连线
    data.links.forEach(link => {
        const srcNode = lgNodeMap[link.src_module];
        const tgtNode = lgNodeMap[link.tgt_module];
        if (!srcNode || !tgtNode) return;

        const srcSlots = slotMap[link.src_module];
        const tgtSlots = slotMap[link.tgt_module];
        if (!srcSlots || !tgtSlots) return;

        const srcItemId = link.src_item_id || link.item_id;
        const tgtItemId = link.tgt_item_id || link.item_id;
        const outIdx = srcSlots.outputMap[srcItemId];
        const inIdx = tgtSlots.inputMap[tgtItemId];
        if (outIdx === undefined || inIdx === undefined) return;

        const lgLink = srcNode.connect(outIdx, tgtNode, inIdx);

        // 设置连线颜色
        if (lgLink && lgLink.id !== undefined) {
            const linkObj = graph.links[lgLink.id];
            if (linkObj) {
                const c = EDGE_TYPE_CONFIG[link.edge_type]?.color || '#6c5ce7';
                linkObj.color = c;
                linkObj._origColor = c;
                linkObj._srcModule = link.src_module;
                linkObj._tgtModule = link.tgt_module;
                linkObj._srcItemId = srcItemId;
                linkObj._tgtItemId = tgtItemId;
            }
        }
    });

    // 3. 自动布局
    performAutoLayout();

    // 4. 清理分组（蓝图分组已禁用）
    createNodeGroups();

    // 5. 刷新
    if (graphCanvas) graphCanvas.setDirty(true, true);
    setTimeout(fitToView, 200);
}

function getNodeBaseStyle(node) {
    const moduleType = node.properties ? node.properties.module_type : 'module';
    return getModuleColorByType(moduleType);
}

function clearHighlight() {
    if (!graph || !graph._nodes) return;
    highlightedModuleId = null;

    graph._nodes.forEach(node => {
        const base = getNodeBaseStyle(node);
        node.color = base.color;
        node.bgcolor = base.bgcolor;
    });

    if (graph.links) {
        Object.values(graph.links).forEach(link => {
            if (!link) return;
            link.color = link._origColor || '#6c5ce7';
        });
    }

    if (graphCanvas) graphCanvas.setDirty(true, true);
}

function highlightNeighborhood(moduleId) {
    if (!graph || !graph._nodes) return;
    highlightedModuleId = moduleId;

    const related = new Set([moduleId]);
    const relatedLinkIds = new Set();

    if (graph.links) {
        Object.entries(graph.links).forEach(([id, link]) => {
            if (!link) return;
            const src = link._srcModule;
            const tgt = link._tgtModule;
            if (!src || !tgt) return;
            if (src === moduleId || tgt === moduleId) {
                related.add(src);
                related.add(tgt);
                relatedLinkIds.add(String(id));
            }
        });
    }

    graph._nodes.forEach(node => {
        const nid = node.properties && node.properties.module_id;
        const base = getNodeBaseStyle(node);
        if (related.has(nid)) {
            node.color = nid === moduleId ? '#ffd166' : '#7dd3fc';
            node.bgcolor = base.bgcolor;
        } else {
            node.color = '#3a3b5c';
            node.bgcolor = '#252640';
        }
    });

    if (graph.links) {
        Object.entries(graph.links).forEach(([id, link]) => {
            if (!link) return;
            if (relatedLinkIds.has(String(id))) {
                link.color = link._origColor || '#6c5ce7';
            } else {
                link.color = 'rgba(90, 90, 120, 0.20)';
            }
        });
    }

    if (graphCanvas) graphCanvas.setDirty(true, true);
}

function highlightByPin(moduleId, itemId, direction) {
    if (!graph || !graph._nodes || !graph.links || !moduleId || !itemId) return;

    const relatedModules = new Set([moduleId]);
    const activeLinks = new Set();

    Object.entries(graph.links).forEach(([id, link]) => {
        if (!link) return;
        const srcModule = link._srcModule;
        const tgtModule = link._tgtModule;
        const srcItemId = link._srcItemId;
        const tgtItemId = link._tgtItemId;
        if (!srcModule || !tgtModule) return;

        const matched = direction === 'output'
            ? (srcModule === moduleId && srcItemId === itemId)
            : (tgtModule === moduleId && tgtItemId === itemId);

        if (matched) {
            activeLinks.add(String(id));
            relatedModules.add(srcModule);
            relatedModules.add(tgtModule);
        }
    });

    graph._nodes.forEach(node => {
        const nid = node.properties && node.properties.module_id;
        const base = getNodeBaseStyle(node);
        if (relatedModules.has(nid)) {
            node.color = nid === moduleId ? '#ffd166' : '#7dd3fc';
            node.bgcolor = base.bgcolor;
        } else {
            node.color = '#3a3b5c';
            node.bgcolor = '#252640';
        }
    });

    Object.entries(graph.links).forEach(([id, link]) => {
        if (!link) return;
        link.color = activeLinks.has(String(id))
            ? (link._origColor || '#6c5ce7')
            : 'rgba(90, 90, 120, 0.20)';
    });

    if (graphCanvas) graphCanvas.setDirty(true, true);
}

function buildFocusedData(centerId, baseData) {
    if (!baseData) return null;
    const nodeSet = new Set([centerId]);
    const links = [];

    const allLinks = baseData.links || [];

    // 先保留中心节点的一跳邻域
    allLinks.forEach(link => {
        if (link.src_module === centerId || link.tgt_module === centerId) {
            links.push(link);
            nodeSet.add(link.src_module);
            nodeSet.add(link.tgt_module);
        }
    });

    // 目录层级补齐：从中心节点沿 contains 关系向上追溯父目录链
    const containsLinks = allLinks.filter(link => link.edge_type === 'contains');
    let current = centerId;
    const visited = new Set([current]);

    while (current) {
        const parentLink = containsLinks.find(link => link.tgt_module === current);
        if (!parentLink) break;

        nodeSet.add(parentLink.src_module);
        nodeSet.add(parentLink.tgt_module);

        const exists = links.some(l =>
            l.src_module === parentLink.src_module
            && l.tgt_module === parentLink.tgt_module
            && (l.item_id || '') === (parentLink.item_id || '')
            && (l.edge_type || '') === (parentLink.edge_type || '')
        );
        if (!exists) links.push(parentLink);

        current = parentLink.src_module;
        if (visited.has(current)) break;
        visited.add(current);
    }

    const modules = (baseData.modules || []).filter(m => nodeSet.has(m.id));
    return { modules, links };
}

function enterFocusMode(centerId) {
    if (!centerId || focusMode.active) return;
    const base = currentRenderedData || getFilteredData();
    if (!base) return;
    const focused = buildFocusedData(centerId, base);
    if (!focused || focused.modules.length === 0) return;

    lastBaseData = base;
    focusMode.active = true;
    focusMode.centerId = centerId;
    backToFullBtn.style.display = 'inline-flex';

    buildBlueprintGraph(focused);
}

function exitFocusMode() {
    if (!focusMode.active) return;
    focusMode.active = false;
    focusMode.centerId = null;
    backToFullBtn.style.display = 'none';
    clearHighlight();

    const base = lastBaseData || getFilteredData();
    buildBlueprintGraph(base);
}

// ============ 分组 ============

function createNodeGroups() {
    // 蓝图模式禁用分组，仅保留节点与连线，避免复杂分组导致重叠和交互问题。
    if (!graph) return;
    if (graph._groups) graph._groups.length = 0;
    if (graphCanvas) graphCanvas.setDirty(true, true);
}

// ============ 布局 ============

function performAutoLayout() {
    if (!graph || !graph._nodes || graph._nodes.length === 0) return;

    // 聚焦模式优先使用当前子图数据，避免全图依赖把节点拉得过远
    const layoutData = currentRenderedData || rawBlueprintData || { links: [] };

    const externals = [];
    const folders = [];
    const projects = [];
    graph._nodes.forEach(n => {
        if (n.properties.module_type === "external") externals.push(n);
        else if (n.properties.module_type === "package") folders.push(n);
        else projects.push(n);
    });

    // 计算项目模块的依赖深度（基于链接方向）
    const depMap = {};
    if (layoutData && layoutData.links) {
        layoutData.links.forEach(link => {
            // tgt_module 依赖 src_module
            if (!link.src_module.startsWith("external:") && !link.tgt_module.startsWith("external:")) {
                if (!depMap[link.tgt_module]) depMap[link.tgt_module] = new Set();
                depMap[link.tgt_module].add(link.src_module);
            }
        });
    }

    // 拓扑层级（模块依赖）
    const layers = {};
    const visited = new Set();
    function getDepth(modId) {
        if (visited.has(modId)) return layers[modId] || 0;
        visited.add(modId);
        const deps = depMap[modId];
        if (!deps || deps.size === 0) { layers[modId] = 0; return 0; }
        let maxDep = 0;
        deps.forEach(d => { maxDep = Math.max(maxDep, getDepth(d) + 1); });
        layers[modId] = maxDep;
        return maxDep;
    }
    projects.forEach(n => getDepth(n.properties.module_id));

    // 目录层级（文件夹深度）
    const folderLayers = {};
    folders.forEach(n => {
        const filePath = String(n.properties.file_path || '');
        const depth = filePath ? filePath.split('/').filter(Boolean).length - 1 : 0;
        folderLayers[n.properties.module_id] = Math.max(depth, 0);
    });

    const isFocusView = focusMode.active || graph._nodes.length <= 18;
    const columnGap = isFocusView ? 90 : 140; // 聚焦时压缩横向间距
    const yPadding = isFocusView ? 50 : 80; // 聚焦时压缩纵向间距

    // 外部包列（最左）
    let y = 100;
    externals.forEach(n => {
        n.pos[0] = 80;
        n.pos[1] = y;
        y += n.size[1] + yPadding;
    });

    // 目录节点按层级排列（位于外部节点右侧）
    const folderGroupByDepth = {};
    folders.forEach(n => {
        const depth = folderLayers[n.properties.module_id] || 0;
        if (!folderGroupByDepth[depth]) folderGroupByDepth[depth] = [];
        folderGroupByDepth[depth].push(n);
    });

    // 压缩目录深度索引，避免深层目录造成不必要的横向空白
    const uniqueDepths = Object.keys(folderGroupByDepth).map(Number).sort((a, b) => a - b);
    const compactDepthMap = {};
    uniqueDepths.forEach((depth, idx) => {
        compactDepthMap[depth] = idx;
    });

    const compactFolderGroups = {};
    folders.forEach(n => {
        const rawDepth = folderLayers[n.properties.module_id] || 0;
        const compactDepth = compactDepthMap[rawDepth] ?? 0;
        if (!compactFolderGroups[compactDepth]) compactFolderGroups[compactDepth] = [];
        compactFolderGroups[compactDepth].push(n);
    });

    const maxFolderDepth = Math.max(-1, ...Object.keys(compactFolderGroups).map(Number));
    const maxExternalWidth = externals.length > 0
        ? Math.max(...externals.map(n => n.size[0] || NODE_MIN_WIDTH))
        : 0;
    const folderBaseX = externals.length > 0 ? 80 + maxExternalWidth + columnGap : 80;
    const folderDepthX = {};
    let folderCursor = folderBaseX;
    for (let depth = 0; depth <= maxFolderDepth; depth++) {
        const nodes = compactFolderGroups[depth] || [];
        const maxW = nodes.length > 0 ? Math.max(...nodes.map(n => n.size[0] || NODE_MIN_WIDTH)) : NODE_MIN_WIDTH;
        folderDepthX[depth] = folderCursor;
        folderCursor += maxW + columnGap;
    }

    for (let depth = 0; depth <= maxFolderDepth; depth++) {
        const nodes = compactFolderGroups[depth] || [];
        nodes.sort((a, b) => String(a.properties.file_path || a.title).localeCompare(String(b.properties.file_path || b.title)));
        let fy = 100;
        nodes.forEach(n => {
            n.pos[0] = folderDepthX[depth];
            n.pos[1] = fy;
            fy += n.size[1] + yPadding;
        });
    }

    // 项目模块按层级排列
    const layerGroups = {};
    projects.forEach(n => {
        const layer = layers[n.properties.module_id] || 0;
        if (!layerGroups[layer]) layerGroups[layer] = [];
        layerGroups[layer].push(n);
    });

    const maxLayer = Math.max(0, ...Object.keys(layerGroups).map(Number));
    const projectBaseX = maxFolderDepth >= 0
        ? folderCursor
        : (externals.length > 0 ? 80 + maxExternalWidth + columnGap : 80);
    const layerMaxWidth = {};
    for (let layer = 0; layer <= maxLayer; layer++) {
        const nodes = layerGroups[layer] || [];
        layerMaxWidth[layer] = nodes.length > 0
            ? Math.max(...nodes.map(n => n.size[0] || NODE_MIN_WIDTH))
            : NODE_MIN_WIDTH;
    }

    let xCursor = projectBaseX;
    const layerX = {};
    for (let layer = 0; layer <= maxLayer; layer++) {
        layerX[layer] = xCursor;
        xCursor += layerMaxWidth[layer] + columnGap;
    }

    for (let layer = 0; layer <= maxLayer; layer++) {
        const nodes = layerGroups[layer] || [];
        let ly = 100;
        nodes.forEach(n => {
            n.pos[0] = layerX[layer];
            n.pos[1] = ly;
            ly += n.size[1] + yPadding;
        });
    }

    if (graphCanvas) graphCanvas.setDirty(true, true);
}

function fitToView() {
    if (!graphCanvas || !graph || !graph._nodes || graph._nodes.length === 0) return;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    graph._nodes.forEach(n => {
        minX = Math.min(minX, n.pos[0]);
        minY = Math.min(minY, n.pos[1]);
        maxX = Math.max(maxX, n.pos[0] + n.size[0]);
        maxY = Math.max(maxY, n.pos[1] + n.size[1]);
    });

    const padding = 80;
    const graphW = maxX - minX + padding * 2;
    const graphH = maxY - minY + padding * 2;
    const canvasEl = document.getElementById('blueprintCanvas');
    const sw = canvasEl.width;
    const sh = canvasEl.height;
    const scale = Math.min(sw / graphW, sh / graphH, 1.0);
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;

    graphCanvas.ds.scale = scale;
    graphCanvas.ds.offset[0] = sw / 2 / scale - cx;
    graphCanvas.ds.offset[1] = sh / 2 / scale - cy;
    graphCanvas.setDirty(true, true);
}

// ============ 过滤 ============

function getFilteredData() {
    if (!rawBlueprintData) return { modules: [], links: [] };

    const nodeTypes = new Set(
        Array.from(document.querySelectorAll('.node-filter:checked')).map(cb => cb.value)
    );
    const edgeTypes = new Set(
        Array.from(document.querySelectorAll('.edge-filter:checked')).map(cb => cb.value)
    );

    // 过滤模块的输入/输出引脚
    const modules = rawBlueprintData.modules
        .filter(mod => {
            if (mod.node_type === 'external') return nodeTypes.has('external');
            if (mod.node_type === 'package') return nodeTypes.has('package');
            if (mod.node_type === 'module') return nodeTypes.has('module');
            return true;
        })
        .map(mod => ({
            ...mod,
            outputs: mod.outputs.filter(out => nodeTypes.has(out.node_type)),
            inputs: mod.inputs.filter(inp =>
                nodeTypes.has(inp.node_type) && edgeTypes.has(inp.edge_type)
            ),
        }));

    // 构建有效的输出/输入项集合
    const validOutputs = new Set();
    const validInputs = new Set();
    const moduleIds = new Set();
    modules.forEach(mod => {
        moduleIds.add(mod.id);
        mod.outputs.forEach(out => validOutputs.add(`${mod.id}|${out.id}`));
        mod.inputs.forEach(inp => validInputs.add(`${mod.id}|${inp.id}`));
    });

    // 过滤链接（兼容同 ID 连线与分离 ID 连线）
    const links = rawBlueprintData.links.filter(link =>
        (() => {
            const srcItemId = link.src_item_id || link.item_id;
            const tgtItemId = link.tgt_item_id || link.item_id;
            return (
                edgeTypes.has(link.edge_type) &&
                moduleIds.has(link.src_module) &&
                moduleIds.has(link.tgt_module) &&
                validOutputs.has(`${link.src_module}|${srcItemId}`) &&
                validInputs.has(`${link.tgt_module}|${tgtItemId}`)
            );
        })()
    );

    return { modules, links };
}

function applyFilters() {
    if (!rawBlueprintData) return;
    if (focusMode.active) {
        focusMode.active = false;
        focusMode.centerId = null;
        backToFullBtn.style.display = 'none';
    }
    buildBlueprintGraph(getFilteredData());
}

// ============ 搜索 ============

function handleSearch() {
    const query = searchInput.value.trim().toLowerCase();

    if (!query || !graph || !graph._nodes) {
        searchCount.textContent = '';
        resetNodeColors();
        return;
    }

    let matchCount = 0;
    graph._nodes.forEach(node => {
        const mod = rawBlueprintData?.modules?.find(m => m.id === node.properties.module_id);
        if (!mod) return;

        const matched =
            mod.label.toLowerCase().includes(query) ||
            mod.outputs.some(o => o.label.toLowerCase().includes(query)) ||
            mod.inputs.some(i => i.label.toLowerCase().includes(query));

        if (matched) {
            matchCount++;
            node.color = "#FFD700";
            node.bgcolor = "#4a3d00";
        } else {
            node.color = "#3a3b5c";
            node.bgcolor = "#252640";
        }
    });

    searchCount.textContent = matchCount > 0
        ? t('common.search_found', { count: matchCount })
        : t('common.search_none');
    if (graphCanvas) graphCanvas.setDirty(true, true);
}

function resetNodeColors() {
    if (!graph || !graph._nodes) return;
    graph._nodes.forEach(node => {
        const style = getNodeBaseStyle(node);
        node.color = style.color;
        node.bgcolor = style.bgcolor;
    });
    if (graphCanvas) graphCanvas.setDirty(true, true);
}

// ============ 节点详情面板 ============

function showNodeDetail(node) {
    const moduleId = node.properties.module_id;
    const mod = rawBlueprintData?.modules?.find(m => m.id === moduleId);
    if (!mod) return;

    const isExternal = mod.node_type === "external";
    const isPackage = mod.node_type === "package";
    detailTitle.textContent = mod.label;

    let html = '';

    // 类型
    html += `<div class="detail-row">
        <div class="detail-label">${t('common.type_label')}</div>
        <div class="detail-value">${
            isExternal ? t('common.node_external') : (isPackage ? t('common.node_package') : t('common.node_module'))
        }</div>
    </div>`;

    // 标识
    html += `<div class="detail-row">
        <div class="detail-label">${t('common.id_label')}</div>
        <div class="detail-value"><code>${mod.id}</code></div>
    </div>`;

    // 文件路径
    if (mod.file_path) {
        html += `<div class="detail-row">
            <div class="detail-label">${t('common.file_label')}</div>
            <div class="detail-value">${mod.file_path}</div>
        </div>`;
    }

    // 定义项（输出引脚）
    if (mod.outputs.length > 0) {
        html += `<div class="detail-row">
            <div class="detail-label">${t('common.defs_label')} (${mod.outputs.length})</div>
            <div class="detail-value"><div class="bp-item-list">`;
        mod.outputs.forEach(out => {
            const abbr = getTypeAbbr(out.node_type);
            html += `<div class="bp-item-tag output-tag interactive" data-item-id="${encodeURIComponent(out.id)}" data-module-id="${encodeURIComponent(mod.id)}" data-direction="output" data-doc="${encodeURIComponent(normalizeDocstring(out.docstring))}"><span class="bp-type-chip type-${out.node_type}">${abbr}</span>${out.label}</div>`;
        });
        html += `</div></div></div>`;
    }

    // 引入项（输入引脚）
    if (mod.inputs.length > 0) {
        html += `<div class="detail-row">
            <div class="detail-label">${t('common.refs_label')} (${mod.inputs.length})</div>
            <div class="detail-value"><div class="bp-item-list">`;
        mod.inputs.forEach(inp => {
            const abbr = getTypeAbbr(inp.node_type);
            const edgeCfg = EDGE_TYPE_CONFIG[inp.edge_type] || {};
            html += `<div class="bp-item-tag input-tag interactive" data-item-id="${encodeURIComponent(inp.id)}" data-module-id="${encodeURIComponent(mod.id)}" data-direction="input" data-doc="${encodeURIComponent(normalizeDocstring(inp.docstring))}"><span class="bp-type-chip type-${inp.node_type}">${abbr}</span>${inp.label}
                <span class="edge-badge" style="background:${edgeCfg.color || '#666'}">${edgeCfg.label || inp.edge_type}</span>
            </div>`;
        });
        html += `</div></div></div>`;
    }

    // 关联模块（可点击跳转）
    const relatedModules = [];
    const seen = new Set();
    if (rawBlueprintData) {
        rawBlueprintData.links.forEach(link => {
            if (link.src_module === moduleId && !seen.has(link.tgt_module)) {
                seen.add(link.tgt_module);
                const tgtMod = rawBlueprintData.modules.find(m => m.id === link.tgt_module);
                if (tgtMod) relatedModules.push({ direction: "→", label: tgtMod.label, id: tgtMod.id });
            }
            if (link.tgt_module === moduleId && !seen.has(link.src_module)) {
                seen.add(link.src_module);
                const srcMod = rawBlueprintData.modules.find(m => m.id === link.src_module);
                if (srcMod) relatedModules.push({ direction: "←", label: srcMod.label, id: srcMod.id });
            }
        });
    }

    if (relatedModules.length > 0) {
        html += `<div class="detail-row">
            <div class="detail-label">${t('common.related_modules')} (${relatedModules.length})</div>
            <div class="detail-value relation-list">`;
        relatedModules.forEach(rm => {
            html += `<div class="relation-item" data-target-node="${encodeURIComponent(rm.id)}" title="点击定位">
                <span class="relation-direction">${rm.direction}</span>
                <span class="relation-target">${rm.label}</span>
            </div>`;
        });
        html += `</div></div>`;
    }

    detailContent.innerHTML = html;
    detailPanel.style.display = 'block';

    // 点击跳转
    detailContent.querySelectorAll('.relation-item').forEach(item => {
        item.addEventListener('click', () => {
            const targetId = decodeURIComponent(item.getAttribute('data-target-node'));
            focusOnNode(targetId);
        });
    });

    detailContent.querySelectorAll('.bp-item-tag.interactive').forEach(item => {
        item.addEventListener('click', () => {
            const moduleIdAttr = item.getAttribute('data-module-id') || '';
            const itemIdAttr = item.getAttribute('data-item-id') || '';
            const direction = item.getAttribute('data-direction') || 'input';
            const moduleId = decodeURIComponent(moduleIdAttr);
            const itemId = decodeURIComponent(itemIdAttr);
            highlightByPin(moduleId, itemId, direction);
        });

        item.addEventListener('mouseenter', (event) => {
            const encodedDoc = item.getAttribute('data-doc') || '';
            const doc = decodeURIComponent(encodedDoc);
            showPinTooltip(doc, event.clientX, event.clientY);
        });

        item.addEventListener('mousemove', (event) => {
            const encodedDoc = item.getAttribute('data-doc') || '';
            const doc = decodeURIComponent(encodedDoc);
            showPinTooltip(doc, event.clientX, event.clientY);
        });

        item.addEventListener('mouseleave', () => {
            hidePinTooltip();
        });
    });
}

function focusOnNode(moduleId) {
    const targetNode = lgNodeMap[moduleId];
    if (!targetNode || !graphCanvas) return;

    const canvasEl = document.getElementById('blueprintCanvas');
    const scale = 0.8;
    graphCanvas.ds.scale = scale;
    graphCanvas.ds.offset[0] = canvasEl.width / 2 / scale - targetNode.pos[0] - targetNode.size[0] / 2;
    graphCanvas.ds.offset[1] = canvasEl.height / 2 / scale - targetNode.pos[1] - targetNode.size[1] / 2;
    graphCanvas.selectNode(targetNode);
    graphCanvas.setDirty(true, true);
    showNodeDetail(targetNode);
}

// ============ 统计 ============

function showStats(metadata) {
    statsPanel.style.display = 'block';
    let html = '';
    html += `<div class="stat-row"><span>${t('common.stats_project_name')}</span><span class="stat-value">${metadata.project_name}</span></div>`;
    html += `<div class="stat-row"><span>${t('common.stats_python_files')}</span><span class="stat-value">${metadata.python_files}</span></div>`;
    html += `<div class="stat-row"><span>${t('common.stats_total_nodes')}</span><span class="stat-value">${metadata.total_nodes}</span></div>`;
    html += `<div class="stat-row"><span>${t('common.stats_total_edges')}</span><span class="stat-value">${metadata.total_edges}</span></div>`;
    if (metadata.node_type_counts) {
        html += '<hr style="border-color:var(--border);margin:8px 0">';
        const typeLabels = {
            package: t('common.node_package'), module: t('common.node_module'), class: t('common.node_class'),
            function: t('common.node_function'), method: t('common.node_method'), constant: t('common.node_constant'),
            external: t('common.node_external'),
        };
        for (const [type, count] of Object.entries(metadata.node_type_counts)) {
            html += `<div class="stat-row"><span>${typeLabels[type] || type}</span><span class="stat-value">${count}</span></div>`;
        }
    }
    statsContent.innerHTML = html;
}

// ============ 目录浏览 ============

async function openBrowseModal(path = '') {
    browseModal.style.display = 'flex';
    await loadDirectory(path);
}

async function loadDirectory(path) {
    try {
        const url = path ? `/api/browse?path=${encodeURIComponent(path)}` : '/api/browse';
        const response = await fetch(url);
        const data = await response.json();

        browsePath = data.current || '';
        browseParent = data.parent || '';
        currentPathSpan.textContent = browsePath || '根目录';

        dirList.innerHTML = '';
        if (data.items.length === 0) {
            dirList.innerHTML = `<div style="padding:20px;text-align:center;color:var(--text-secondary)">${t('common.no_subdirs')}</div>`;
            return;
        }
        data.items.forEach(item => {
            const div = document.createElement('div');
            div.className = 'dir-item';
            div.textContent = `📁 ${item.name}`;
            div.addEventListener('click', () => {
                dirList.querySelectorAll('.selected').forEach(el => el.classList.remove('selected'));
                div.classList.add('selected');
                browsePath = item.path;
            });
            div.addEventListener('dblclick', () => loadDirectory(item.path));
            dirList.appendChild(div);
        });
    } catch (error) {
        showToast(t('common.toast_browse_failed', { message: error.message }), 'error');
    }
}

function handleParentDir() { loadDirectory(browseParent); }

function handleSelectDir() {
    if (browsePath) {
        projectPathInput.value = browsePath;
        browseModal.style.display = 'none';
        showToast(t('common.toast_selected_dir', { path: browsePath }), 'info');
    } else {
        showToast(t('common.toast_select_dir'), 'error');
    }
}

// ============ 工具 ============

function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.3s';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

window.addEventListener('codegraph:lang-changed', () => {
    if (currentMetadata) {
        showStats(currentMetadata);
    }
    if (searchInput.value.trim()) {
        handleSearch();
    }
});
