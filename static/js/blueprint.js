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

const SLOT_ICONS = {
    "class":    "🏷️",
    "function": "⚡",
    "method":   "🔧",
    "constant": "📌",
    "external": "🔗",
};

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

document.querySelectorAll('.node-filter, .edge-filter').forEach(cb => {
    cb.addEventListener('change', applyFilters);
});

projectPathInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleAnalyze();
});

document.querySelectorAll('input[type="text"], select').forEach(el => {
    el.addEventListener('keydown', (e) => e.stopPropagation());
});

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

    graphCanvas.onNodeSelected = function(node) {
        if (node && node.properties && node.properties.module_id) {
            showNodeDetail(node);
        }
    };
    graphCanvas.onNodeDeselected = function() {
        detailPanel.style.display = 'none';
    };

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    graph.start();
}

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
    if (!path) { showToast('请输入项目路径', 'error'); return; }

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
            showToast(
                `解析完成: ${currentMetadata.total_nodes} 个节点, ${currentMetadata.total_edges} 条关系`,
                'success'
            );
        }
    } catch (error) {
        showToast(`错误: ${error.message}`, 'error');
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

    // slot 索引映射: module_id → { outputMap: {item_id: idx}, inputMap: {item_id: idx} }
    const slotMap = {};

    // 1. 创建节点
    data.modules.forEach(mod => {
        const node = LiteGraph.createNode("codegraph/module");
        if (!node) return;

        const isExternal = mod.node_type === "external";
        node.title = isExternal ? `📦 ${mod.label}` : `📄 ${mod.label}`;
        node.color = isExternal ? "#FF9F43" : "#4ECDC4";
        node.bgcolor = isExternal ? "#3d2e1a" : "#1a3a38";
        node.properties = {
            module_id: mod.id,
            module_type: mod.node_type,
            file_path: mod.file_path || "",
        };

        slotMap[mod.id] = { outputMap: {}, inputMap: {} };

        // 添加输入引脚（左侧 - 引入项）
        mod.inputs.forEach(inp => {
            const icon = SLOT_ICONS[inp.node_type] || "📥";
            const slotIdx = (node.inputs || []).length;
            node.addInput(`${icon} ${inp.label}`, "*");
            if (node.inputs && node.inputs[slotIdx]) {
                node.inputs[slotIdx].color_on = SLOT_COLORS[inp.node_type] || "#aaa";
            }
            slotMap[mod.id].inputMap[inp.id] = slotIdx;
        });

        // 添加输出引脚（右侧 - 定义项）
        mod.outputs.forEach(out => {
            const icon = SLOT_ICONS[out.node_type] || "📤";
            const slotIdx = (node.outputs || []).length;
            node.addOutput(`${icon} ${out.label}`, "*");
            if (node.outputs && node.outputs[slotIdx]) {
                node.outputs[slotIdx].color_on = SLOT_COLORS[out.node_type] || "#aaa";
            }
            slotMap[mod.id].outputMap[out.id] = slotIdx;
        });

        // 节点尺寸
        const maxSlots = Math.max(mod.inputs.length, mod.outputs.length, 1);
        node.size = [280, maxSlots * 22 + 50];

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

        const outIdx = srcSlots.outputMap[link.item_id];
        const inIdx = tgtSlots.inputMap[link.item_id];
        if (outIdx === undefined || inIdx === undefined) return;

        const lgLink = srcNode.connect(outIdx, tgtNode, inIdx);

        // 设置连线颜色
        if (lgLink && lgLink.id !== undefined) {
            const linkObj = graph.links[lgLink.id];
            if (linkObj) {
                linkObj.color = EDGE_TYPE_CONFIG[link.edge_type]?.color || '#6c5ce7';
            }
        }
    });

    // 3. 自动布局
    performAutoLayout();

    // 4. 创建分组
    createNodeGroups();

    // 5. 刷新
    if (graphCanvas) graphCanvas.setDirty(true, true);
    setTimeout(fitToView, 200);
}

// ============ 分组 ============

const GROUP_COLORS = [
    "#2d4a3e80", "#3d2e1a80", "#2a2d4e80", "#4a2d3e80",
    "#2d3d4a80", "#4a3d2d80", "#3e2d4a80", "#2d4a4a80",
];

function createNodeGroups() {
    if (!graph || !graph._nodes || graph._nodes.length === 0) return;

    // 移除已有分组
    if (graph._groups) {
        graph._groups.length = 0;
    }

    // 按包前缀对节点分组
    const groupMap = {};  // prefix → [node, ...]

    graph._nodes.forEach(n => {
        const modId = n.properties.module_id || "";
        const modType = n.properties.module_type;

        let prefix = "";
        if (modType === "external") {
            // external:fastapi.staticfiles → 取 "fastapi"
            const name = modId.replace(/^external:/, "");
            prefix = "📦 " + name.split(".")[0];
        } else {
            // module:parser.ast_parser → 取 "parser"
            const name = modId.replace(/^module:/, "");
            const parts = name.split(".");
            if (parts.length > 1) {
                prefix = "📁 " + parts[0];
            }
            // 单层模块（如 app）不分组
        }

        if (prefix) {
            if (!groupMap[prefix]) groupMap[prefix] = [];
            groupMap[prefix].push(n);
        }
    });

    // 只对包含 2+ 个节点的前缀创建分组
    let colorIdx = 0;
    Object.entries(groupMap).forEach(([prefix, nodes]) => {
        if (nodes.length < 2) return;

        const group = new LGraphGroup();
        group.title = prefix;
        group.color = GROUP_COLORS[colorIdx % GROUP_COLORS.length];
        colorIdx++;

        // 计算包围盒
        const padding = 30;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        nodes.forEach(n => {
            minX = Math.min(minX, n.pos[0]);
            minY = Math.min(minY, n.pos[1]);
            maxX = Math.max(maxX, n.pos[0] + n.size[0]);
            maxY = Math.max(maxY, n.pos[1] + n.size[1]);
        });

        group._bounding = [
            minX - padding,
            minY - padding - 20,  // 标题高度
            maxX - minX + padding * 2,
            maxY - minY + padding * 2 + 20,
        ];

        graph.add(group);
    });

    if (graphCanvas) graphCanvas.setDirty(true, true);
}

// ============ 布局 ============

function performAutoLayout() {
    if (!graph || !graph._nodes || graph._nodes.length === 0) return;

    const externals = [];
    const projects = [];
    graph._nodes.forEach(n => {
        if (n.properties.module_type === "external") externals.push(n);
        else projects.push(n);
    });

    // 计算项目模块的依赖深度（基于链接方向）
    const depMap = {};
    if (rawBlueprintData && rawBlueprintData.links) {
        rawBlueprintData.links.forEach(link => {
            // tgt_module 依赖 src_module
            if (!link.src_module.startsWith("external:") && !link.tgt_module.startsWith("external:")) {
                if (!depMap[link.tgt_module]) depMap[link.tgt_module] = new Set();
                depMap[link.tgt_module].add(link.src_module);
            }
        });
    }

    // 拓扑层级
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

    const xSpacing = 800; // 同层节点间距
    const yPadding = 200; // 层间距

    // 外部包列（最左）
    let y = 100;
    externals.forEach(n => {
        n.pos[0] = 80;
        n.pos[1] = y;
        y += n.size[1] + yPadding;
    });

    // 项目模块按层级排列
    const layerGroups = {};
    projects.forEach(n => {
        const layer = layers[n.properties.module_id] || 0;
        if (!layerGroups[layer]) layerGroups[layer] = [];
        layerGroups[layer].push(n);
    });

    const maxLayer = Math.max(0, ...Object.keys(layerGroups).map(Number));
    const startX = externals.length > 0 ? 80 + xSpacing : 80;

    for (let layer = 0; layer <= maxLayer; layer++) {
        const nodes = layerGroups[layer] || [];
        let ly = 100;
        nodes.forEach(n => {
            n.pos[0] = startX + layer * xSpacing;
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
        .filter(mod =>
            mod.node_type === "module" || (mod.node_type === "external" && nodeTypes.has("external"))
        )
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

    // 过滤链接
    const links = rawBlueprintData.links.filter(link =>
        edgeTypes.has(link.edge_type) &&
        moduleIds.has(link.src_module) &&
        moduleIds.has(link.tgt_module) &&
        validOutputs.has(`${link.src_module}|${link.item_id}`) &&
        validInputs.has(`${link.tgt_module}|${link.item_id}`)
    );

    return { modules, links };
}

function applyFilters() {
    if (!rawBlueprintData) return;
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

    searchCount.textContent = matchCount > 0 ? `找到 ${matchCount} 个` : '无匹配';
    if (graphCanvas) graphCanvas.setDirty(true, true);
}

function resetNodeColors() {
    if (!graph || !graph._nodes) return;
    graph._nodes.forEach(node => {
        const isExt = node.properties.module_type === "external";
        node.color = isExt ? "#FF9F43" : "#4ECDC4";
        node.bgcolor = isExt ? "#3d2e1a" : "#1a3a38";
    });
    if (graphCanvas) graphCanvas.setDirty(true, true);
}

// ============ 节点详情面板 ============

function showNodeDetail(node) {
    const moduleId = node.properties.module_id;
    const mod = rawBlueprintData?.modules?.find(m => m.id === moduleId);
    if (!mod) return;

    const isExternal = mod.node_type === "external";
    detailTitle.textContent = mod.label;

    let html = '';

    // 类型
    html += `<div class="detail-row">
        <div class="detail-label">类型</div>
        <div class="detail-value">${isExternal ? '🔗 外部库' : '📄 模块'}</div>
    </div>`;

    // 标识
    html += `<div class="detail-row">
        <div class="detail-label">标识</div>
        <div class="detail-value"><code>${mod.id}</code></div>
    </div>`;

    // 文件路径
    if (mod.file_path) {
        html += `<div class="detail-row">
            <div class="detail-label">文件</div>
            <div class="detail-value">${mod.file_path}</div>
        </div>`;
    }

    // 定义项（输出引脚）
    if (mod.outputs.length > 0) {
        html += `<div class="detail-row">
            <div class="detail-label">定义项 (${mod.outputs.length})</div>
            <div class="detail-value"><div class="bp-item-list">`;
        mod.outputs.forEach(out => {
            const icon = SLOT_ICONS[out.node_type] || "";
            html += `<div class="bp-item-tag output-tag">${icon} ${out.label}</div>`;
        });
        html += `</div></div></div>`;
    }

    // 引入项（输入引脚）
    if (mod.inputs.length > 0) {
        html += `<div class="detail-row">
            <div class="detail-label">引入项 (${mod.inputs.length})</div>
            <div class="detail-value"><div class="bp-item-list">`;
        mod.inputs.forEach(inp => {
            const icon = SLOT_ICONS[inp.node_type] || "";
            const edgeCfg = EDGE_TYPE_CONFIG[inp.edge_type] || {};
            html += `<div class="bp-item-tag input-tag">${icon} ${inp.label}
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
            <div class="detail-label">关联模块 (${relatedModules.length})</div>
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
    html += `<div class="stat-row"><span>项目名称</span><span class="stat-value">${metadata.project_name}</span></div>`;
    html += `<div class="stat-row"><span>Python 文件</span><span class="stat-value">${metadata.python_files}</span></div>`;
    html += `<div class="stat-row"><span>节点总数</span><span class="stat-value">${metadata.total_nodes}</span></div>`;
    html += `<div class="stat-row"><span>关系总数</span><span class="stat-value">${metadata.total_edges}</span></div>`;
    if (metadata.node_type_counts) {
        html += '<hr style="border-color:var(--border);margin:8px 0">';
        const typeLabels = {
            package: '📦 包', module: '📄 模块', class: '🏷️ 类',
            function: '⚡ 函数', method: '🔧 方法', constant: '📌 常量',
            external: '🔗 外部库',
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
            dirList.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-secondary)">没有子文件夹</div>';
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
        showToast(`浏览目录失败: ${error.message}`, 'error');
    }
}

function handleParentDir() { loadDirectory(browseParent); }

function handleSelectDir() {
    if (browsePath) {
        projectPathInput.value = browsePath;
        browseModal.style.display = 'none';
        showToast(`已选择: ${browsePath}`, 'info');
    } else {
        showToast('请选择一个文件夹', 'error');
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
