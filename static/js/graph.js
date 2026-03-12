/**
 * CodeGraph - 前端交互逻辑
 * 蓝图模式使用 LiteGraph.js 实现引脚精准连线（独立后端 /api/analyze/blueprint）
 * 标准模式使用 vis-network 实现知识图谱可视化（独立后端 /api/analyze）
 */

// ============ 全局变量 ============
let network = null;        // vis-network 实例（标准模式）
let nodesDataSet = null;   // vis DataSet (节点)
let edgesDataSet = null;   // vis DataSet (边)
let allNodes = [];          // 所有节点原始数据（标准模式）
let allEdges = [];          // 所有边原始数据（标准模式）
let currentMetadata = null; // 当前项目元数据
let browsePath = '';        // 当前浏览路径
let browseParent = '';      // 上级目录路径
let highlightedNodeId = null;
let blueprintData = null;  // 蓝图模式数据
let isBlueprintMode = true;
let lastAnalyzedPath = ''; // 上次解析路径（缓存用）
// LiteGraph 实例
let lgGraph = null;
let lgCanvas = null;

// ============ DOM 元素 ============
const projectPathInput = document.getElementById('projectPath');
const analyzeBtn = document.getElementById('analyzeBtn');
const browseBtn = document.getElementById('browseBtn');
const fitBtn = document.getElementById('fitBtn');
const exportBtn = document.getElementById('exportBtn');
const layoutSelect = document.getElementById('layoutSelect');
const graphContainer = document.getElementById('graphContainer');
const lgCanvasEl = document.getElementById('lgCanvas');
const welcomeScreen = document.getElementById('welcomeScreen');
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
const viewModeSelect = document.getElementById('viewModeSelect');

// ============ 事件监听 ============
analyzeBtn.addEventListener('click', handleAnalyze);
browseBtn.addEventListener('click', () => openBrowseModal());
fitBtn.addEventListener('click', handleFit);
exportBtn.addEventListener('click', handleExport);
layoutSelect.addEventListener('change', handleLayoutChange);
closeDetail.addEventListener('click', () => {
    detailPanel.style.display = 'none';
    clearHighlight();
});
closeBrowse.addEventListener('click', () => browseModal.style.display = 'none');
cancelBrowse.addEventListener('click', () => browseModal.style.display = 'none');
parentDirBtn.addEventListener('click', handleParentDir);
selectDirBtn.addEventListener('click', handleSelectDir);
searchInput.addEventListener('input', handleSearch);

if (viewModeSelect) {
    viewModeSelect.addEventListener('change', () => {
        isBlueprintMode = viewModeSelect.value === 'blueprint';
        // 切换模式时，如果有已解析的路径，重新调用对应后端
        const path = projectPathInput.value.trim();
        if (path && lastAnalyzedPath === path) {
            // 检查是否已缓存对应模式的数据
            if (isBlueprintMode && blueprintData) {
                renderBlueprintGraph();
                return;
            } else if (!isBlueprintMode && allNodes.length > 0) {
                renderGraph(allNodes, allEdges);
                return;
            }
        }
        if (path) {
            handleAnalyze();
        }
    });
}

document.querySelectorAll('.node-filter, .edge-filter').forEach(cb => {
    cb.addEventListener('change', applyFilters);
});

projectPathInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleAnalyze();
});

document.querySelectorAll('input[type="text"], select').forEach(el => {
    el.addEventListener('keydown', (e) => e.stopPropagation());
});

function handleFit() {
    if (isBlueprintMode && lgCanvas) {
        lgCanvas.ds.reset();
        lgCanvas.setDirty(true, true);
    } else if (network) {
        network.fit({ animation: true });
    }
}

// ============ 核心功能 ============

async function handleAnalyze() {
    const path = projectPathInput.value.trim();
    if (!path) {
        showToast('请输入项目路径', 'error');
        return;
    }

    loading.style.display = 'flex';
    analyzeBtn.disabled = true;

    try {
        if (isBlueprintMode) {
            // 蓝图模式：调用独立的蓝图后端
            const response = await fetch('/api/analyze/blueprint', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path }),
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.detail || '蓝图解析失败');
            if (result.success) {
                blueprintData = result.data;
                currentMetadata = result.metadata;
                lastAnalyzedPath = path;
                renderBlueprintGraph();
                showStats(currentMetadata);
                showToast(`蓝图解析完成: ${currentMetadata.total_nodes} 个节点`, 'success');
            }
        } else {
            // 标准模式：调用独立的标准后端
            const response = await fetch('/api/analyze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path }),
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.detail || '解析失败');
            if (result.success) {
                allNodes = result.data.nodes;
                allEdges = result.data.edges;
                currentMetadata = result.metadata;
                lastAnalyzedPath = path;
                renderGraph(allNodes, allEdges);
                showStats(currentMetadata);
                showToast(`解析完成: ${currentMetadata.total_nodes} 个节点, ${currentMetadata.total_edges} 条关系`, 'success');
            }
        }
    } catch (error) {
        showToast(`错误: ${error.message}`, 'error');
    } finally {
        loading.style.display = 'none';
        analyzeBtn.disabled = false;
    }
}

// ============ LiteGraph 蓝图模式 ============

/**
 * 渲染蓝图模式（使用 LiteGraph.js）
 * 每个 Python 模块渲染为带引脚的蓝图节点
 * 使用后端预计算的 links 数据精准连接引脚
 */
function renderBlueprintGraph() {
    if (!blueprintData) return;
    if (typeof LiteGraph === 'undefined') {
        showToast('LiteGraph.js 加载失败，请检查网络', 'error');
        return;
    }

    // 隐藏标准模式容器，显示 LiteGraph 画布
    welcomeScreen.style.display = 'none';
    graphContainer.style.display = 'none';
    lgCanvasEl.style.display = 'block';

    // 销毁旧的 vis-network
    if (network) {
        network.destroy();
        network = null;
    }

    // 调整画布尺寸
    const mainContent = lgCanvasEl.parentElement;
    lgCanvasEl.width = mainContent.clientWidth;
    lgCanvasEl.height = mainContent.clientHeight;

    // 清理旧 LiteGraph
    if (lgGraph) {
        lgGraph.stop();
        lgGraph.clear();
    }

    // 创建 LiteGraph 图实例
    lgGraph = new LGraph();

    // 全局允许输入端口多连接
    if (typeof LiteGraph.allow_multi_input_for_links !== 'undefined') {
        LiteGraph.allow_multi_input_for_links = true;
    }

    const lgNodeMap = {};  // 我们的节点 ID → LiteGraph 节点实例
    const uniquePrefix = Date.now();

    // ---- 创建蓝图模块节点 ----
    const pinIcons = { 'class': '🏷️', 'function': '⚡', 'method': '🔧', 'variable': '📌' };

    blueprintData.blueprintNodes.forEach((bpNode, moduleIdx) => {
        const typeName = 'cg/bp_' + uniquePrefix + '_' + moduleIdx;

        function CodeGraphNode() {
            // Slot 0: 模块级（用于模块→模块的导入等边）
            this.addOutput('📄 ' + bpNode.label, 'module');
            this.addInput('📄 ' + bpNode.label, 'module');
            // Slot 1..N: 引脚（类、函数、方法、变量）
            bpNode.pins.forEach(pin => {
                const icon = pinIcons[pin.type] || '●';
                this.addOutput(icon + ' ' + pin.label, pin.type);
                this.addInput(icon + ' ' + pin.label, pin.type);
            });

            this.title = '📄 ' + bpNode.label;
            this.size = this.computeSize();
            this.size[0] = Math.max(this.size[0], 240);
            this._bpData = bpNode;
            this.color = '#2a4a48';
            this.bgcolor = '#1e2230';
            this.boxcolor = '#4ECDC4';
        }
        CodeGraphNode.title = '📄 ' + bpNode.label;
        LiteGraph.registerNodeType(typeName, CodeGraphNode);

        const lgNode = LiteGraph.createNode(typeName);
        // 启用所有输入端口的多连接
        _enableMultiConnection(lgNode);

        // 网格布局：每行3个
        const col = moduleIdx % 3;
        const row = Math.floor(moduleIdx / 3);
        lgNode.pos = [col * 420 + 50, row * 500 + 50];
        lgGraph.add(lgNode);
        lgNodeMap[bpNode.id] = lgNode;
    });

    // ---- 创建普通节点（外部库、包等） ----
    const totalBp = blueprintData.blueprintNodes.length;
    const bpCols = Math.min(totalBp, 3);

    blueprintData.plainNodes.forEach((pn, i) => {
        const typeName = 'cg/pn_' + uniquePrefix + '_' + i;

        function PlainNode() {
            this.addOutput('out', 'any');
            this.addInput('in', 'any');
            this.title = pn.label;
            this.size = this.computeSize();
            this.size[0] = Math.max(this.size[0], 130);
            this._plainData = pn;
            this.color = '#3a2820';
            this.bgcolor = '#2a1e18';
            this.boxcolor = pn.color || '#FF9F43';
        }
        PlainNode.title = pn.label;
        LiteGraph.registerNodeType(typeName, PlainNode);

        const lgNode = LiteGraph.createNode(typeName);
        _enableMultiConnection(lgNode);

        // 放在蓝图节点的右侧
        const plainCol = i % 4;
        const plainRow = Math.floor(i / 4);
        lgNode.pos = [bpCols * 420 + 120 + plainCol * 220, plainRow * 120 + 50];
        lgGraph.add(lgNode);
        lgNodeMap[pn.id] = lgNode;
    });

    // ---- 使用后端预计算的 links 创建连线 ----
    const linkColorData = [];  // 用于后续着色
    if (blueprintData.links) {
        blueprintData.links.forEach(link => {
            const fromNode = lgNodeMap[link.fromNodeId];
            const toNode = lgNodeMap[link.toNodeId];
            if (fromNode && toNode) {
                const linkResult = fromNode.connect(link.fromSlot, toNode, link.toSlot);
                if (linkResult !== null) {
                    linkColorData.push({
                        originId: fromNode.id,
                        originSlot: link.fromSlot,
                        targetId: toNode.id,
                        targetSlot: link.toSlot,
                        color: link.color,
                    });
                }
            }
        });
    }

    // ---- 创建外部库分组区域（LGraphGroup） ----
    if (blueprintData.externalGroups && typeof LGraphGroup !== 'undefined') {
        const groupColors = [
            '#FF9F4330', '#2ED57330', '#74B9FF30',
            '#A29BFE30', '#FF6B8130', '#00CEC930',
        ];
        let gIdx = 0;
        Object.entries(blueprintData.externalGroups).forEach(([pkg, nodeIds]) => {
            const groupNodes = nodeIds.map(id => lgNodeMap[id]).filter(Boolean);
            if (groupNodes.length === 0) return;

            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            groupNodes.forEach(n => {
                minX = Math.min(minX, n.pos[0]);
                minY = Math.min(minY, n.pos[1]);
                maxX = Math.max(maxX, n.pos[0] + n.size[0]);
                maxY = Math.max(maxY, n.pos[1] + n.size[1]);
            });

            const padding = groupNodes.length <= 2 ? 25 : 40;
            const group = new LGraphGroup();
            group.title = '📦 ' + pkg;
            group.color = groupColors[gIdx % groupColors.length];
            group.font_size = 14;
            group._bounding = [
                minX - padding,
                minY - padding - 28,
                maxX - minX + padding * 2,
                maxY - minY + padding * 2 + 28,
            ];
            group.pos = [minX - padding, minY - padding - 28];
            group.size = [maxX - minX + padding * 2, maxY - minY + padding * 2 + 28];
            lgGraph.add(group);
            gIdx++;
        });
    }

    // ---- 配置 LiteGraph 渲染样式 ----
    LiteGraph.CANVAS_GRID_SIZE = 20;
    LiteGraph.NODE_TEXT_SIZE = 13;
    LiteGraph.NODE_SUBTEXT_SIZE = 11;
    LiteGraph.NODE_DEFAULT_COLOR = '#2a4a48';
    LiteGraph.NODE_DEFAULT_BGCOLOR = '#1e2230';
    LiteGraph.NODE_DEFAULT_BOXCOLOR = '#4ECDC4';
    LiteGraph.DEFAULT_SHADOW_COLOR = 'rgba(0,0,0,0.4)';
    LiteGraph.LINK_COLOR = '#9a9aaa';
    LiteGraph.NODE_TITLE_HEIGHT = 26;
    LiteGraph.NODE_SLOT_HEIGHT = 20;

    // 设置 slot 类型颜色
    const slotTypeColors = {
        'module': '#4ECDC4', 'class': '#45B7D1', 'function': '#96CEB4',
        'method': '#FFEAA7', 'variable': '#DDA0DD', 'any': '#FF9F43',
    };
    Object.entries(slotTypeColors).forEach(([type, color]) => {
        LGraphCanvas.link_type_colors[type] = color;
    });

    // 创建画布
    lgCanvas = new LGraphCanvas(lgCanvasEl, lgGraph);
    lgCanvas.background_image = null;
    lgCanvas.clear_background = true;
    lgCanvas.render_canvas_border = false;
    lgCanvas.render_connections_border = false;
    lgCanvas.highquality_render = true;
    lgCanvas.render_curved_connections = true;
    lgCanvas.render_connection_arrows = true;
    lgCanvas.connections_width = 2;
    lgCanvas.default_connection_color = {
        output_off: '#555', output_on: '#8e8',
        input_off: '#555', input_on: '#8e8',
    };
    lgCanvas.allow_searchbox = false;
    lgCanvas.allow_interaction = true;
    lgCanvas.allow_dragnodes = true;
    lgCanvas.allow_reconnect_links = false;
    lgCanvas.read_only = false;
    lgCanvas.background_color = '#1a1b2e';

    // 节点点击事件 → 显示详情
    lgCanvas.onNodeSelected = function(node) {
        if (node && node._bpData) {
            showBlueprintNodeDetail(node._bpData);
        } else if (node && node._plainData) {
            showPlainNodeDetail(node._plainData);
        }
    };
    lgCanvas.onNodeDeselected = function() {
        detailPanel.style.display = 'none';
    };

    // 应用连线颜色
    _applyLinkColors(linkColorData);

    // 启动渲染
    lgGraph.start();

    // 窗口尺寸变化时调整画布
    window._lgResizeHandler = function() {
        if (lgCanvasEl.style.display !== 'none') {
            lgCanvasEl.width = mainContent.clientWidth;
            lgCanvasEl.height = mainContent.clientHeight;
            lgCanvas.resize();
        }
    };
    window.removeEventListener('resize', window._lgResizeHandler);
    window.addEventListener('resize', window._lgResizeHandler);
}

/**
 * 启用 LiteGraph 节点所有输入端口的多连接支持
 */
function _enableMultiConnection(lgNode) {
    if (!lgNode.inputs) return;
    lgNode.inputs.forEach(inp => {
        inp.multi_connnection = true;   // LiteGraph v0.7 spelling
        inp.multiconnection = true;     // alternative spelling
    });
}

/**
 * 应用预计算的颜色到 LiteGraph 连线
 */
function _applyLinkColors(colorData) {
    if (!lgGraph || !colorData || colorData.length === 0) return;

    const lgLinks = lgGraph.links;
    if (!lgLinks) return;

    // 建立颜色查找表：originId_outSlot_targetId_inSlot → color
    const colorMap = {};
    colorData.forEach(d => {
        colorMap[d.originId + '_' + d.originSlot + '_' + d.targetId + '_' + d.targetSlot] = d.color;
    });

    for (const linkId in lgLinks) {
        const lgLink = lgLinks[linkId];
        if (!lgLink) continue;
        const key = lgLink.origin_id + '_' + lgLink.origin_slot + '_' + lgLink.target_id + '_' + lgLink.target_slot;
        if (colorMap[key]) {
            lgLink.color = colorMap[key];
        }
    }
}

/**
 * 显示蓝图节点详情
 */
function showBlueprintNodeDetail(bpNode) {
    detailTitle.textContent = bpNode.label;

    const pinTypeIcons = {
        'class': '🏷️',
        'function': '⚡',
        'method': '🔧',
        'variable': '📌',
    };

    let html = '';
    html += `<div class="detail-row">
        <div class="detail-label">类型</div>
        <div class="detail-value">📄 模块 (蓝图)</div>
    </div>`;
    html += `<div class="detail-row">
        <div class="detail-label">标识</div>
        <div class="detail-value"><code>${bpNode.id}</code></div>
    </div>`;
    if (bpNode.filePath) {
        html += `<div class="detail-row">
            <div class="detail-label">文件</div>
            <div class="detail-value">${bpNode.filePath}</div>
        </div>`;
    }

    if (bpNode.pins.length > 0) {
        html += `<div class="detail-row">
            <div class="detail-label">成员 (${bpNode.pins.length})</div>
            <div class="detail-value relation-list">`;
        bpNode.pins.forEach(pin => {
            const icon = pinTypeIcons[pin.type] || '●';
            const prefix = pin.parentClass ? '  ' : '';
            html += `<div class="relation-item" title="${pin.tooltip || ''}">
                <span class="relation-direction" style="color:${pin.color}">${icon}</span>
                <span class="relation-type">${pin.type}</span>
                <span class="relation-target">${prefix}${pin.label}</span>
            </div>`;
        });
        html += `</div></div>`;
    }

    detailContent.innerHTML = html;
    detailPanel.style.display = 'block';
}

/**
 * 显示普通节点详情（外部库等）
 */
function showPlainNodeDetail(plainData) {
    detailTitle.textContent = plainData.label || plainData.id;

    const typeNames = {
        package: '📦 包', external: '🔗 外部库',
    };

    let html = '';
    html += `<div class="detail-row">
        <div class="detail-label">类型</div>
        <div class="detail-value">${typeNames[plainData.group] || plainData.group || '节点'}</div>
    </div>`;
    html += `<div class="detail-row">
        <div class="detail-label">标识</div>
        <div class="detail-value"><code>${plainData.id}</code></div>
    </div>`;
    if (plainData.title) {
        const lines = plainData.title.split('\n');
        lines.forEach(line => {
            const colonIdx = line.indexOf(':');
            if (colonIdx > 0) {
                const label = line.substring(0, colonIdx).trim();
                const value = line.substring(colonIdx + 1).trim();
                if (label.startsWith('【') || label === '类型' || !value) return;
                html += `<div class="detail-row">
                    <div class="detail-label">${label}</div>
                    <div class="detail-value">${value}</div>
                </div>`;
            }
        });
    }

    detailContent.innerHTML = html;
    detailPanel.style.display = 'block';
}

/**
 * 停止蓝图模式（切换到标准模式时）
 */
function destroyBlueprintMode() {
    if (lgGraph) {
        lgGraph.stop();
        lgGraph.clear();
        lgGraph = null;
    }
    if (lgCanvas) {
        lgCanvas = null;
    }
    lgCanvasEl.style.display = 'none';
}

// ============ 标准模式渲染（vis-network） ============

function renderGraph(nodes, edges) {
    // 关闭蓝图模式
    destroyBlueprintMode();

    welcomeScreen.style.display = 'none';
    graphContainer.style.display = 'block';
    lgCanvasEl.style.display = 'none';

    nodes.forEach(n => { n._originalColor = n.color; });
    edges.forEach(e => { e._originalColor = e.color; e._originalWidth = e.width; });

    nodesDataSet = new vis.DataSet(nodes);
    edgesDataSet = new vis.DataSet(edges);

    const data = { nodes: nodesDataSet, edges: edgesDataSet };
    const options = getGraphOptions();

    if (network) { network.destroy(); }

    network = new vis.Network(graphContainer, data, options);
    highlightedNodeId = null;

    network.on('beforeDrawing', function(ctx) {
        drawExternalPackageHulls(ctx);
    });

    const stabilizationTimeout = setTimeout(() => {
        if (network) { network.stopSimulation(); network.fit({ animation: true }); }
    }, 15000);

    network.on('click', (params) => {
        if (params.nodes.length > 0) {
            highlightNeighborhood(params.nodes[0]);
            showNodeDetail(params.nodes[0]);
        } else {
            clearHighlight();
            detailPanel.style.display = 'none';
        }
    });

    network.on('doubleClick', (params) => {
        if (params.nodes.length > 0) {
            network.focus(params.nodes[0], {
                scale: 1.5,
                animation: { duration: 500, easingFunction: 'easeInOutQuad' },
            });
        }
    });

    network.once('stabilizationIterationsDone', () => {
        clearTimeout(stabilizationTimeout);
        network.fit({ animation: true });
    });
}

// ============ 高亮系统（标准模式） ============

function highlightNeighborhood(nodeId) {
    highlightedNodeId = nodeId;

    const allN = nodesDataSet.get();
    const allE = edgesDataSet.get();

    const connectedNodeIds = new Set();
    connectedNodeIds.add(nodeId);
    const connectedEdgeIds = new Set();

    allE.forEach(edge => {
        if (edge.from === nodeId || edge.to === nodeId) {
            connectedNodeIds.add(edge.from);
            connectedNodeIds.add(edge.to);
            connectedEdgeIds.add(edge.id);
        }
    });

    // 扩展外部库链
    const nodeMap = new Map(allN.map(n => [n.id, n]));
    const containsAdj = new Map();
    allE.forEach(edge => {
        if (edge.label && (edge.label.includes('包含') || edge.label.includes('定义'))) {
            if (!containsAdj.has(edge.from)) containsAdj.set(edge.from, []);
            containsAdj.get(edge.from).push({ neighbor: edge.to, edgeId: edge.id });
            if (!containsAdj.has(edge.to)) containsAdj.set(edge.to, []);
            containsAdj.get(edge.to).push({ neighbor: edge.from, edgeId: edge.id });
        }
    });
    const expandQueue = [];
    connectedNodeIds.forEach(id => {
        const node = nodeMap.get(id);
        if (node && node.group === 'external') expandQueue.push(id);
    });
    while (expandQueue.length > 0) {
        const cur = expandQueue.shift();
        (containsAdj.get(cur) || []).forEach(({ neighbor, edgeId }) => {
            if (!connectedNodeIds.has(neighbor)) {
                const n = nodeMap.get(neighbor);
                if (n && n.group === 'external') {
                    connectedNodeIds.add(neighbor);
                    connectedEdgeIds.add(edgeId);
                    expandQueue.push(neighbor);
                }
            }
        });
    }

    const updatedNodes = allN.map(node => {
        if (connectedNodeIds.has(node.id)) {
            return {
                id: node.id,
                color: node._originalColor,
                opacity: 1,
                borderWidth: node.id === nodeId ? 5 : 3,
                font: {
                    color: '#ffffff',
                    size: node.id === nodeId ? 16 : 13,
                    face: 'Segoe UI, Microsoft YaHei, sans-serif',
                },
                shadow: {
                    enabled: true,
                    color: node.id === nodeId ? 'rgba(108,92,231,0.7)' : 'rgba(255,255,255,0.3)',
                    size: node.id === nodeId ? 18 : 10,
                },
            };
        } else {
            return {
                id: node.id,
                color: { background: '#3a3b5c', border: '#2d2e52' },
                opacity: 0.12,
                borderWidth: 1,
                font: { color: 'rgba(160,160,192,0.2)', size: 9, face: 'Segoe UI, Microsoft YaHei, sans-serif' },
                shadow: { enabled: false },
            };
        }
    });

    const updatedEdges = allE.map(edge => {
        if (connectedEdgeIds.has(edge.id)) {
            const origColorValue = (typeof edge._originalColor === 'object')
                ? edge._originalColor.color : edge._originalColor;
            return {
                id: edge.id,
                color: { color: origColorValue, highlight: origColorValue, opacity: 1 },
                width: (edge._originalWidth || 1) + 4,
                font: { size: 12, color: '#e8e8f0', strokeWidth: 3, strokeColor: '#1a1b2e' },
                shadow: { enabled: true, color: origColorValue, size: 8 },
            };
        } else {
            return {
                id: edge.id,
                color: { color: 'rgba(50,50,70,0.08)', highlight: 'rgba(50,50,70,0.08)', opacity: 0.05 },
                width: 0.3,
                font: { size: 0 },
                shadow: { enabled: false },
            };
        }
    });

    nodesDataSet.update(updatedNodes);
    edgesDataSet.update(updatedEdges);
}

function clearHighlight() {
    if (!highlightedNodeId || !nodesDataSet || !edgesDataSet) return;
    highlightedNodeId = null;

    const allN = nodesDataSet.get();
    const allE = edgesDataSet.get();

    const restoredNodes = allN.map(node => ({
        id: node.id,
        color: node._originalColor,
        opacity: 1,
        borderWidth: 2,
        font: { color: '#e8e8f0', size: 12, face: 'Segoe UI, Microsoft YaHei, sans-serif' },
        shadow: { enabled: true, color: 'rgba(0,0,0,0.3)', size: 8 },
    }));

    const restoredEdges = allE.map(edge => ({
        id: edge.id,
        color: edge._originalColor,
        width: edge._originalWidth || 1,
        font: { size: 9, color: '#808090', strokeWidth: 0, align: 'middle' },
        shadow: { enabled: false },
    }));

    nodesDataSet.update(restoredNodes);
    edgesDataSet.update(restoredEdges);
}

function focusAndHighlightNode(nodeId) {
    if (!network) return;
    highlightNeighborhood(nodeId);
    network.focus(nodeId, {
        scale: 1.2,
        animation: { duration: 600, easingFunction: 'easeInOutQuad' },
    });
    network.selectNodes([nodeId]);
    showNodeDetail(nodeId);
}

// ============ 标准模式配置 ============

function getGraphOptions() {
    const layout = layoutSelect.value;
    const nodeCount = allNodes.length;
    const stabIterations = nodeCount > 200 ? Math.max(50, Math.floor(40000 / nodeCount)) : 200;
    const options = {
        nodes: {
            font: { color: '#e8e8f0', size: 12, face: 'Segoe UI, Microsoft YaHei, sans-serif' },
            borderWidth: 2,
            borderWidthSelected: 4,
            shadow: { enabled: true, color: 'rgba(0,0,0,0.3)', size: 8 },
        },
        edges: {
            font: { size: 9, color: '#808090', strokeWidth: 0, align: 'middle' },
            smooth: {
                type: 'cubicBezier',
                forceDirection: layout.startsWith('hierarchical') ? 'vertical' : 'none',
                roundness: 0.5,
            },
            arrows: { to: { scaleFactor: 0.8 } },
        },
        interaction: {
            hover: true,
            tooltipDelay: 200,
            multiselect: true,
            navigationButtons: true,
            keyboard: { enabled: true },
        },
        physics: {
            enabled: true,
            solver: 'forceAtlas2Based',
            forceAtlas2Based: {
                gravitationalConstant: -60,
                centralGravity: 0.01,
                springLength: 150,
                springConstant: 0.08,
                damping: 0.4,
            },
            stabilization: { iterations: stabIterations, updateInterval: 25 },
        },
    };

    if (layout.startsWith('hierarchical')) {
        const direction = layout.split('-')[1] || 'UD';
        options.layout = {
            hierarchical: {
                enabled: true,
                direction: direction,
                sortMethod: 'hubsize',
                levelSeparation: 150,
                nodeSpacing: 120,
                treeSpacing: 200,
            },
        };
        options.physics.enabled = false;
    } else {
        options.layout = { hierarchical: { enabled: false } };
    }

    return options;
}

// ============ 过滤与布局 ============

function applyFilters() {
    if (!allNodes.length && !(blueprintData && blueprintData.blueprintNodes && blueprintData.blueprintNodes.length)) return;

    if (isBlueprintMode && blueprintData) {
        renderBlueprintGraph();
        return;
    }

    const selectedNodeTypes = Array.from(document.querySelectorAll('.node-filter:checked')).map(cb => cb.value);
    const selectedEdgeTypes = Array.from(document.querySelectorAll('.edge-filter:checked')).map(cb => cb.value);

    const filteredNodes = allNodes.filter(n => selectedNodeTypes.includes(n.group));
    const nodeIds = new Set(filteredNodes.map(n => n.id));
    const filteredEdges = allEdges.filter(e =>
        nodeIds.has(e.from) && nodeIds.has(e.to) &&
        selectedEdgeTypes.some(t => e.label && (
            (t === 'imports' && e.label.includes('导入')) ||
            (t === 'inherits' && e.label.includes('继承')) ||
            (t === 'contains' && (e.label.includes('包含') || e.label.includes('定义'))) ||
            (t === 'calls' && e.label.includes('调用')) ||
            (t === 'decorates' && e.label.includes('装饰')) ||
            (t === 'instantiates' && e.label.includes('实例化')) ||
            (t === 'uses' && e.label.includes('使用'))
        ))
    );

    renderGraph(filteredNodes, filteredEdges);
}

function handleLayoutChange() {
    if (isBlueprintMode && blueprintData) {
        renderBlueprintGraph();
    } else if (network && nodesDataSet && edgesDataSet) {
        renderGraph(nodesDataSet.get(), edgesDataSet.get());
    }
}

// ============ 节点详情（标准模式） ============

function showNodeDetail(nodeId) {
    const node = nodesDataSet.get(nodeId);
    if (!node) return;

    const cleanLabel = (node.label || '').replace(/^[^\w\u4e00-\u9fff]+/u, '').trim() || node.label;
    detailTitle.textContent = cleanLabel;

    const typeNames = {
        package: '📦 包', module: '📄 模块', class: '🏷️ 类',
        function: '⚡ 函数', method: '🔧 方法', variable: '📌 变量',
        external: '🔗 外部库',
    };

    let html = '';
    html += `<div class="detail-row">
        <div class="detail-label">类型</div>
        <div class="detail-value">${typeNames[node.group] || node.group}</div>
    </div>`;
    html += `<div class="detail-row">
        <div class="detail-label">标识</div>
        <div class="detail-value"><code>${node.id}</code></div>
    </div>`;

    if (node.title) {
        const lines = node.title.split('\n');
        lines.forEach(line => {
            const colonIdx = line.indexOf(':');
            if (colonIdx > 0) {
                const label = line.substring(0, colonIdx).trim();
                const value = line.substring(colonIdx + 1).trim();
                if (label.startsWith('【') || label === '类型' || !value) return;
                html += `<div class="detail-row">
                    <div class="detail-label">${label}</div>
                    <div class="detail-value">${value}</div>
                </div>`;
            }
        });
    }

    const allE = edgesDataSet.get();
    const relatedEdges = allE.filter(e => e.from === nodeId || e.to === nodeId);
    if (relatedEdges.length > 0) {
        html += `<div class="detail-row">
            <div class="detail-label">关联关系 (${relatedEdges.length})</div>
            <div class="detail-value relation-list">`;
        relatedEdges.forEach(e => {
            const direction = e.from === nodeId ? '→' : '←';
            const otherId = e.from === nodeId ? e.to : e.from;
            const otherNode = nodesDataSet.get(otherId);
            const otherLabel = otherNode ? (otherNode.label || otherId) : otherId;
            html += `<div class="relation-item" data-target-node="${encodeURIComponent(otherId)}" 
                          title="点击定位到该节点">
                <span class="relation-direction">${direction}</span>
                <span class="relation-type">${e.label}</span>
                <span class="relation-target">${otherLabel}</span>
            </div>`;
        });
        html += `</div></div>`;
    }

    detailContent.innerHTML = html;
    detailPanel.style.display = 'block';

    detailContent.querySelectorAll('.relation-item').forEach(item => {
        item.addEventListener('click', () => {
            const targetNodeId = decodeURIComponent(item.getAttribute('data-target-node'));
            focusAndHighlightNode(targetNodeId);
        });
    });
}

// ============ 统计信息 ============

function showStats(metadata) {
    statsPanel.style.display = 'block';

    let html = '';
    html += `<div class="stat-row"><span>项目名称</span><span class="stat-value">${metadata.project_name}</span></div>`;
    html += `<div class="stat-row"><span>Python 文件</span><span class="stat-value">${metadata.python_files}</span></div>`;
    html += `<div class="stat-row"><span>节点总数</span><span class="stat-value">${metadata.total_nodes}</span></div>`;
    html += `<div class="stat-row"><span>关系总数</span><span class="stat-value">${metadata.total_edges}</span></div>`;

    if (metadata.node_type_counts) {
        html += '<hr style="border-color:var(--border);margin:8px 0">';
        const typeLabels = {
            package: '📦 包', module: '📄 模块', class: '🏷️ 类',
            function: '⚡ 函数', method: '🔧 方法', variable: '📌 变量',
            external: '🔗 外部库',
        };
        for (const [type, count] of Object.entries(metadata.node_type_counts)) {
            html += `<div class="stat-row"><span>${typeLabels[type] || type}</span><span class="stat-value">${count}</span></div>`;
        }
    }

    statsContent.innerHTML = html;
}

// ============ 导出图片 ============

function handleExport() {
    if (isBlueprintMode && lgCanvasEl.style.display !== 'none') {
        const link = document.createElement('a');
        link.download = `codegraph_blueprint_${Date.now()}.png`;
        link.href = lgCanvasEl.toDataURL('image/png');
        link.click();
        showToast('蓝图已导出', 'success');
        return;
    }

    if (!network) {
        showToast('请先解析项目', 'error');
        return;
    }

    const canvas = graphContainer.querySelector('canvas');
    if (canvas) {
        const link = document.createElement('a');
        link.download = `codegraph_${Date.now()}.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();
        showToast('图片已导出', 'success');
    }
}

// ============ 目录浏览功能 ============

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
            dirList.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-secondary)">没有子文件夹</div>';
            return;
        }

        data.items.forEach(item => {
            const div = document.createElement('div');
            div.className = 'dir-item';
            div.innerHTML = `📁 ${item.name}`;
            div.addEventListener('click', () => {
                dirList.querySelectorAll('.selected').forEach(el => el.classList.remove('selected'));
                div.classList.add('selected');
                browsePath = item.path;
            });
            div.addEventListener('dblclick', () => {
                loadDirectory(item.path);
            });
            dirList.appendChild(div);
        });
    } catch (error) {
        showToast(`浏览目录失败: ${error.message}`, 'error');
    }
}

function handleParentDir() {
    loadDirectory(browseParent);
}

function handleSelectDir() {
    if (browsePath) {
        projectPathInput.value = browsePath;
        browseModal.style.display = 'none';
        showToast(`已选择: ${browsePath}`, 'info');
    } else {
        showToast('请选择一个文件夹', 'error');
    }
}

// ============ 工具函数 ============

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

// ============ 外部库分组背景绘制（标准模式） ============

function drawRoundedRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}

function drawExternalPackageHulls(ctx) {
    if (!network || !nodesDataSet) return;

    const groups = {};
    const allN = nodesDataSet.get();
    allN.forEach(node => {
        if (node.group === 'external' && node.externalPackage) {
            if (!groups[node.externalPackage]) groups[node.externalPackage] = [];
            groups[node.externalPackage].push(node.id);
        }
    });

    const positions = network.getPositions();
    const hullColors = [
        { fill: 'rgba(255, 159, 67, 0.07)', stroke: 'rgba(255, 159, 67, 0.30)', text: 'rgba(255, 159, 67, 0.55)' },
        { fill: 'rgba(46, 213, 115, 0.07)', stroke: 'rgba(46, 213, 115, 0.30)', text: 'rgba(46, 213, 115, 0.55)' },
        { fill: 'rgba(116, 185, 255, 0.07)', stroke: 'rgba(116, 185, 255, 0.30)', text: 'rgba(116, 185, 255, 0.55)' },
        { fill: 'rgba(162, 155, 254, 0.07)', stroke: 'rgba(162, 155, 254, 0.30)', text: 'rgba(162, 155, 254, 0.55)' },
        { fill: 'rgba(255, 107, 129, 0.07)', stroke: 'rgba(255, 107, 129, 0.30)', text: 'rgba(255, 107, 129, 0.55)' },
    ];

    let colorIdx = 0;
    Object.entries(groups).forEach(([pkg, nodeIds]) => {
        const points = nodeIds.map(id => positions[id]).filter(Boolean);
        if (points.length === 0) return;

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        points.forEach(p => {
            minX = Math.min(minX, p.x);
            minY = Math.min(minY, p.y);
            maxX = Math.max(maxX, p.x);
            maxY = Math.max(maxY, p.y);
        });

        const style = hullColors[colorIdx % hullColors.length];
        colorIdx++;

        const padding = points.length <= 2 ? 22 : 45;
        const x = minX - padding;
        const y = minY - padding - 18;
        const minW = points.length === 1 ? 60 : 100;
        const minH = points.length === 1 ? 45 : 60;
        const w = Math.max(maxX - minX + padding * 2, minW);
        const h = Math.max(maxY - minY + padding * 2 + 18, minH);
        const r = 12;

        ctx.save();
        ctx.fillStyle = style.fill;
        ctx.strokeStyle = style.stroke;
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        drawRoundedRect(ctx, x, y, w, h, r);
        ctx.fill();
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = style.text;
        ctx.font = 'bold 13px Segoe UI, Microsoft YaHei, sans-serif';
        ctx.fillText(`📦 ${pkg}`, x + 10, y + 15);
        ctx.restore();
    });
}

// ============ 搜索功能 ============

function handleSearch() {
    const query = searchInput.value.trim().toLowerCase();

    if (!query) {
        searchCount.textContent = '';
        if (isBlueprintMode) return;
        clearHighlight();
        return;
    }

    // 蓝图模式搜索 — 高亮匹配的 LiteGraph 节点
    if (isBlueprintMode && lgGraph) {
        const nodes = lgGraph._nodes;
        let matchCount = 0;
        nodes.forEach(node => {
            const title = (node.title || '').toLowerCase();
            let match = title.includes(query);
            if (!match && node._bpData) {
                match = node._bpData.pins.some(pin => {
                    const pl = (pin.label || '').toLowerCase();
                    const pid = (pin.id || '').toLowerCase();
                    return pl.includes(query) || pid.includes(query);
                });
            }
            if (!match && node._plainData) {
                const pid = (node._plainData.id || '').toLowerCase();
                match = pid.includes(query);
            }
            if (match) {
                matchCount++;
                node.color = '#2a5a38';
                node.boxcolor = '#FFD700';
            } else {
                node.color = node._bpData ? '#2a4a48' : '#3a2820';
                node.boxcolor = node._bpData ? '#4ECDC4' : (node._plainData?.color || '#FF9F43');
            }
        });
        searchCount.textContent = matchCount > 0 ? `找到 ${matchCount} 个` : '无匹配';
        lgCanvas.setDirty(true, true);
        return;
    }

    // 标准模式搜索
    if (!nodesDataSet) return;

    const allN = nodesDataSet.get();
    const matchIds = new Set();

    allN.forEach(node => {
        const label = (node.label || '').toLowerCase();
        const id = (node.id || '').toLowerCase();
        if (label.includes(query) || id.includes(query)) {
            matchIds.add(node.id);
        }
    });

    searchCount.textContent = matchIds.size > 0 ? `找到 ${matchIds.size} 个` : '无匹配';

    if (matchIds.size === 0) {
        clearHighlight();
        return;
    }

    const updatedNodes = allN.map(node => {
        if (matchIds.has(node.id)) {
            return {
                id: node.id,
                color: { background: '#FFD700', border: '#FFA500' },
                opacity: 1,
                borderWidth: 4,
                font: { color: '#ffffff', size: 15, face: 'Segoe UI, Microsoft YaHei, sans-serif' },
                shadow: { enabled: true, color: 'rgba(255, 215, 0, 0.6)', size: 15 },
            };
        } else {
            return {
                id: node.id,
                color: { background: '#3a3b5c', border: '#2d2e52' },
                opacity: 0.15,
                borderWidth: 1,
                font: { color: 'rgba(160,160,192,0.25)', size: 9, face: 'Segoe UI, Microsoft YaHei, sans-serif' },
                shadow: { enabled: false },
            };
        }
    });

    const allE = edgesDataSet.get();
    const updatedEdges = allE.map(edge => {
        if (matchIds.has(edge.from) || matchIds.has(edge.to)) {
            return {
                id: edge.id,
                color: edge._originalColor,
                width: edge._originalWidth || 1,
                font: { size: 9, color: '#808090', strokeWidth: 0, align: 'middle' },
                shadow: { enabled: false },
            };
        } else {
            return {
                id: edge.id,
                color: { color: 'rgba(50,50,70,0.08)', highlight: 'rgba(50,50,70,0.08)', opacity: 0.05 },
                width: 0.3,
                font: { size: 0 },
                shadow: { enabled: false },
            };
        }
    });

    nodesDataSet.update(updatedNodes);
    edgesDataSet.update(updatedEdges);

    highlightedNodeId = 'search';

    if (matchIds.size > 0 && matchIds.size <= 20) {
        network.fit({ nodes: Array.from(matchIds), animation: true });
    }
}
