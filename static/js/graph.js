/**
 * CodeGraph - 前端交互逻辑
 * 使用 vis-network 实现知识图谱的可视化展示
 */

// ============ 全局变量 ============
let network = null;        // vis-network 实例
let nodesDataSet = null;   // vis DataSet (节点)
let edgesDataSet = null;   // vis DataSet (边)
let allNodes = [];          // 所有节点原始数据
let allEdges = [];          // 所有边原始数据
let currentMetadata = null; // 当前项目元数据
let browsePath = '';        // 当前浏览路径
let browseParent = '';      // 上级目录路径（来自API）
let highlightedNodeId = null; // 当前高亮的节点

function t(key, vars) {
    if (window.CodeGraphI18n && typeof window.CodeGraphI18n.t === 'function') {
        return window.CodeGraphI18n.t(key, vars);
    }
    return key;
}

// ============ DOM 元素 ============
const projectPathInput = document.getElementById('projectPath');
const analyzeBtn = document.getElementById('analyzeBtn');
const browseBtn = document.getElementById('browseBtn');
const fitBtn = document.getElementById('fitBtn');
const exportBtn = document.getElementById('exportBtn');
const layoutSelect = document.getElementById('layoutSelect');
const graphContainer = document.getElementById('graphContainer');
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

// ============ 事件监听 ============
analyzeBtn.addEventListener('click', handleAnalyze);
browseBtn.addEventListener('click', () => openBrowseModal());
fitBtn.addEventListener('click', () => network && network.fit({ animation: true }));
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

// 过滤器变化时重新渲染
document.querySelectorAll('.node-filter, .edge-filter').forEach(cb => {
    cb.addEventListener('change', applyFilters);
});

// 回车键触发解析
projectPathInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleAnalyze();
});

// 防止 vis-network 捕获输入框中的键盘事件（下划线_等符号会被当作缩放快捷键拦截）
document.querySelectorAll('input[type="text"], select').forEach(el => {
    el.addEventListener('keydown', (e) => e.stopPropagation());
});

// ============ 核心功能 ============

/**
 * 解析项目
 */
async function handleAnalyze() {
    const path = projectPathInput.value.trim();
    if (!path) {
        showToast(t('common.toast_input_path'), 'error');
        return;
    }

    loading.style.display = 'flex';
    analyzeBtn.disabled = true;

    try {
        const response = await fetch('/api/standard/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path }),
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.detail || '解析失败');
        }

        if (result.success) {
            allNodes = result.data.nodes;
            allEdges = result.data.edges;
            currentMetadata = result.metadata;

            renderGraph(allNodes, allEdges);
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
 * 渲染知识图谱
 */
function renderGraph(nodes, edges) {
    welcomeScreen.style.display = 'none';
    graphContainer.style.display = 'block';

    // 保存每个节点/边的原始样式，用于高亮后恢复
    nodes.forEach(n => {
        n._originalColor = n.color;
    });
    edges.forEach(e => {
        e._originalColor = e.color;
        e._originalWidth = e.width;
    });

    nodesDataSet = new vis.DataSet(nodes);
    edgesDataSet = new vis.DataSet(edges);

    const data = { nodes: nodesDataSet, edges: edgesDataSet };
    const options = getGraphOptions();

    if (network) {
        network.destroy();
    }

    network = new vis.Network(graphContainer, data, options);
    highlightedNodeId = null;

    // 绘制外部库分组背景
    network.on('beforeDrawing', function(ctx) {
        drawExternalPackageHulls(ctx);
    });

    // 安全超时：防止大图稳定化时间过长
    const stabilizationTimeout = setTimeout(() => {
        if (network) {
            network.stopSimulation();
            network.fit({ animation: true });
        }
    }, 15000);

    // 点击节点：显示详情 + 高亮关联
    network.on('click', (params) => {
        if (params.nodes.length > 0) {
            const nodeId = params.nodes[0];
            highlightNeighborhood(nodeId);
            showNodeDetail(nodeId);
        } else {
            // 点击空白区域取消高亮
            clearHighlight();
            detailPanel.style.display = 'none';
        }
    });

    // 双击节点聚焦
    network.on('doubleClick', (params) => {
        if (params.nodes.length > 0) {
            network.focus(params.nodes[0], {
                scale: 1.5,
                animation: { duration: 500, easingFunction: 'easeInOutQuad' },
            });
        }
    });

    // 稳定后自适应
    network.once('stabilizationIterationsDone', () => {
        clearTimeout(stabilizationTimeout);
        network.fit({ animation: true });
    });
}

// ============ 高亮系统 ============

/**
 * 高亮选中节点及其所有关联节点和边
 */
function highlightNeighborhood(nodeId) {
    highlightedNodeId = nodeId;

    const allN = nodesDataSet.get();
    const allE = edgesDataSet.get();

    // 找出所有与该节点直接关联的节点 ID 和边 ID
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

    // 扩展外部库链：选中节点关联的外部节点同时高亮其完整包含链路
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

    // 更新节点样式
    const updatedNodes = allN.map(node => {
        if (connectedNodeIds.has(node.id)) {
            // 关联节点：保持原色，增强显示
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
            // 非关联节点：大幅淡化
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

    // 更新边样式
    const updatedEdges = allE.map(edge => {
        if (connectedEdgeIds.has(edge.id)) {
            // 关联边：大幅加粗 + 发光效果
            const origColorValue = (typeof edge._originalColor === 'object')
                ? edge._originalColor.color
                : edge._originalColor;
            return {
                id: edge.id,
                color: { color: origColorValue, highlight: origColorValue, opacity: 1 },
                width: (edge._originalWidth || 1) + 4,
                font: { size: 12, color: '#e8e8f0', strokeWidth: 3, strokeColor: '#1a1b2e' },
                shadow: { enabled: true, color: origColorValue, size: 8 },
            };
        } else {
            // 非关联边：几乎不可见
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

/**
 * 清除所有高亮，恢复原始样式
 */
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

/**
 * 聚焦并高亮指定节点（从详情面板关联关系点击触发）
 */
function focusAndHighlightNode(nodeId) {
    if (!network) return;

    // 高亮该节点的邻域
    highlightNeighborhood(nodeId);

    // 聚焦到该节点
    network.focus(nodeId, {
        scale: 1.2,
        animation: { duration: 600, easingFunction: 'easeInOutQuad' },
    });

    // 选中该节点
    network.selectNodes([nodeId]);

    // 更新详情面板
    showNodeDetail(nodeId);
}

/**
 * 获取图谱配置选项
 */
function getGraphOptions() {
    const layout = layoutSelect.value;
    const nodeCount = allNodes.length;
    // 根据节点数量动态调整稳定化参数
    const stabIterations = nodeCount > 200 ? Math.max(50, Math.floor(40000 / nodeCount)) : 200;
    const options = {
        nodes: {
            font: {
                color: '#e8e8f0',
                size: 12,
                face: 'Segoe UI, Microsoft YaHei, sans-serif',
            },
            borderWidth: 2,
            borderWidthSelected: 4,
            shadow: {
                enabled: true,
                color: 'rgba(0,0,0,0.3)',
                size: 8,
            },
        },
        edges: {
            font: {
                size: 9,
                color: '#808090',
                strokeWidth: 0,
                align: 'middle',
            },
            smooth: {
                type: 'cubicBezier',
                forceDirection: layout.startsWith('hierarchical') ? 'vertical' : 'none',
                roundness: 0.5,
            },
            arrows: {
                to: { scaleFactor: 0.8 },
            },
        },
        interaction: {
            hover: true,
            tooltipDelay: 200,
            multiselect: true,
            navigationButtons: true,
            keyboard: {
                enabled: true,
            },
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
            stabilization: {
                iterations: stabIterations,
                updateInterval: 25,
            },
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

/**
 * 应用过滤器
 */
function applyFilters() {
    if (!allNodes.length) return;

    const selectedNodeTypes = Array.from(document.querySelectorAll('.node-filter:checked'))
        .map(cb => cb.value);
    const selectedEdgeTypes = Array.from(document.querySelectorAll('.edge-filter:checked'))
        .map(cb => cb.value);

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

/**
 * 布局变化
 */
function handleLayoutChange() {
    if (!network || !nodesDataSet || !edgesDataSet) return;
    const nodes = nodesDataSet.get();
    const edges = edgesDataSet.get();
    renderGraph(nodes, edges);
}

/**
 * 显示节点详情（右侧面板）
 */
function showNodeDetail(nodeId) {
    const node = allNodes.find(n => n.id === nodeId);
    if (!node) return;

    // 去掉 emoji 前缀显示纯名称
    const cleanLabel = node.label.replace(/^[^\w\u4e00-\u9fff]+/u, '').trim() || node.label;
    detailTitle.textContent = cleanLabel;

    let html = '';

    // 类型
    const typeNames = {
        package: t('common.node_package'), module: t('common.node_module'), class: t('common.node_class'),
        function: t('common.node_function'), method: t('common.node_method'), constant: t('common.node_constant'),
        external: t('common.node_external'),
    };
    html += `<div class="detail-row">
        <div class="detail-label">${t('common.type_label')}</div>
        <div class="detail-value">${typeNames[node.group] || node.group}</div>
    </div>`;

    // ID
    html += `<div class="detail-row">
        <div class="detail-label">${t('common.id_label')}</div>
        <div class="detail-value"><code>${node.id}</code></div>
    </div>`;

    // 从 tooltip 纯文本中提取详情信息
    if (node.title) {
        const lines = node.title.split('\n');
        lines.forEach(line => {
            const colonIdx = line.indexOf(':');
            if (colonIdx > 0) {
                const label = line.substring(0, colonIdx).trim();
                const value = line.substring(colonIdx + 1).trim();
                // 跳过标题行和类型行（已单独显示），以及空值
                if (label.startsWith('【') || label === '类型' || !value) return;
                html += `<div class="detail-row">
                    <div class="detail-label">${label}</div>
                    <div class="detail-value">${value}</div>
                </div>`;
            }
        });
    }

    // 关联关系（可点击，点击可跳转到对应节点并高亮）
    const relatedEdges = allEdges.filter(e => e.from === nodeId || e.to === nodeId);
    if (relatedEdges.length > 0) {
        html += `<div class="detail-row">
            <div class="detail-label">${t('common.relations_label')} (${relatedEdges.length})</div>
            <div class="detail-value relation-list">`;
        relatedEdges.forEach(e => {
            const direction = e.from === nodeId ? '→' : '←';
            const otherId = e.from === nodeId ? e.to : e.from;
            const otherNode = allNodes.find(n => n.id === otherId);
            const otherLabel = otherNode ? otherNode.label : otherId;
            // 使用安全的 data 属性，用事件委托处理点击
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

    // 绑定关联关系的点击事件（事件委托）
    detailContent.querySelectorAll('.relation-item').forEach(item => {
        item.addEventListener('click', (e) => {
            const targetNodeId = decodeURIComponent(item.getAttribute('data-target-node'));
            focusAndHighlightNode(targetNodeId);
        });
    });
}

/**
 * 显示统计信息
 */
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

/**
 * 导出图片
 */
function handleExport() {
    if (!network) {
        showToast(t('common.toast_analyze_first'), 'error');
        return;
    }

    const canvas = graphContainer.querySelector('canvas');
    if (canvas) {
        const link = document.createElement('a');
        link.download = `codegraph_${Date.now()}.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();
        showToast(t('common.toast_export_done'), 'success');
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
            dirList.innerHTML = `<div style="padding:20px;text-align:center;color:var(--text-secondary)">${t('common.no_subdirs')}</div>`;
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
        showToast(t('common.toast_browse_failed', { message: error.message }), 'error');
    }
}

function handleParentDir() {
    // 使用 API 返回的 parent 路径，确保可以正确返回上级和驱动器列表
    loadDirectory(browseParent);
}

function handleSelectDir() {
    if (browsePath) {
        projectPathInput.value = browsePath;
        browseModal.style.display = 'none';
        showToast(t('common.toast_selected_dir', { path: browsePath }), 'info');
    } else {
        showToast(t('common.toast_select_dir'), 'error');
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

// ============ 外部库分组背景绘制 ============

/**
 * 在 canvas 上绘制外部库分组的背景区域
 */
function drawExternalPackageHulls(ctx) {
    if (!network || !nodesDataSet) return;

    // 按 externalPackage 分组
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

        const padding = 45;
        const x = minX - padding;
        const y = minY - padding - 18;
        const w = Math.max(maxX - minX + padding * 2, 100);
        const h = Math.max(maxY - minY + padding * 2 + 18, 60);
        const r = 12;

        ctx.save();
        ctx.fillStyle = style.fill;
        ctx.strokeStyle = style.stroke;
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);

        // 圆角矩形
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
        ctx.fill();
        ctx.stroke();

        // 标签
        ctx.setLineDash([]);
        ctx.fillStyle = style.text;
        ctx.font = 'bold 13px Segoe UI, Microsoft YaHei, sans-serif';
        ctx.fillText(`📦 ${pkg}`, x + 10, y + 15);
        ctx.restore();
    });
}

// ============ 搜索功能 ============

/**
 * 搜索节点并高亮显示
 */
function handleSearch() {
    const query = searchInput.value.trim().toLowerCase();

    if (!query || !nodesDataSet) {
        searchCount.textContent = '';
        clearHighlight();
        return;
    }

    const allN = nodesDataSet.get();
    const matchIds = new Set();

    allN.forEach(node => {
        const label = (node.label || '').toLowerCase();
        const id = (node.id || '').toLowerCase();
        if (label.includes(query) || id.includes(query)) {
            matchIds.add(node.id);
        }
    });

    if (matchIds.size > 0) {
        searchCount.textContent = t('common.search_found', { count: matchIds.size });
    } else {
        searchCount.textContent = t('common.search_none');
    }

    if (matchIds.size === 0) {
        clearHighlight();
        return;
    }

    // 高亮匹配节点
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

    // 如果匹配数量较少，自动聚焦
    if (matchIds.size > 0 && matchIds.size <= 20) {
        network.fit({ nodes: Array.from(matchIds), animation: true });
    }
}

window.addEventListener('codegraph:lang-changed', () => {
    if (currentMetadata) {
        showStats(currentMetadata);
    }
    if (detailPanel.style.display !== 'none' && highlightedNodeId && highlightedNodeId !== 'search') {
        showNodeDetail(highlightedNodeId);
    }
    if (searchInput.value.trim()) {
        handleSearch();
    }
});
