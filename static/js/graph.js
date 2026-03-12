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
let highlightedNodeId = null; // 当前高亮的节点

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

// 过滤器变化时重新渲染
document.querySelectorAll('.node-filter, .edge-filter').forEach(cb => {
    cb.addEventListener('change', applyFilters);
});

// 回车键触发解析
projectPathInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleAnalyze();
});

// ============ 核心功能 ============

/**
 * 解析项目
 */
async function handleAnalyze() {
    const path = projectPathInput.value.trim();
    if (!path) {
        showToast('请输入项目路径', 'error');
        return;
    }

    loading.style.display = 'flex';
    analyzeBtn.disabled = true;

    try {
        const response = await fetch('/api/analyze', {
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
            showToast(`解析完成: ${currentMetadata.total_nodes} 个节点, ${currentMetadata.total_edges} 条关系`, 'success');
        }
    } catch (error) {
        showToast(`错误: ${error.message}`, 'error');
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
                iterations: 200,
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
            (t === 'instantiates' && e.label.includes('实例化'))
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
        package: '📦 包', module: '📄 模块', class: '🏷️ 类',
        function: '⚡ 函数', method: '🔧 方法', variable: '📌 变量',
    };
    html += `<div class="detail-row">
        <div class="detail-label">类型</div>
        <div class="detail-value">${typeNames[node.group] || node.group}</div>
    </div>`;

    // ID
    html += `<div class="detail-row">
        <div class="detail-label">标识</div>
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
            <div class="detail-label">关联关系 (${relatedEdges.length})</div>
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
    html += `<div class="stat-row"><span>项目名称</span><span class="stat-value">${metadata.project_name}</span></div>`;
    html += `<div class="stat-row"><span>Python 文件</span><span class="stat-value">${metadata.python_files}</span></div>`;
    html += `<div class="stat-row"><span>节点总数</span><span class="stat-value">${metadata.total_nodes}</span></div>`;
    html += `<div class="stat-row"><span>关系总数</span><span class="stat-value">${metadata.total_edges}</span></div>`;

    if (metadata.node_type_counts) {
        html += '<hr style="border-color:var(--border);margin:8px 0">';
        const typeLabels = {
            package: '📦 包', module: '📄 模块', class: '🏷️ 类',
            function: '⚡ 函数', method: '🔧 方法', variable: '📌 变量',
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
    if (browsePath) {
        const parent = browsePath.replace(/\\[^\\]*$/, '').replace(/\/[^\/]*$/, '');
        loadDirectory(parent || '');
    }
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
