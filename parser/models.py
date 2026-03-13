"""
数据模型定义 - 定义知识图谱中的节点和边的数据结构
"""

from enum import Enum
from typing import Optional, List, Dict
from pydantic import BaseModel


class NodeType(str, Enum):
    """节点类型"""
    MODULE = "module"           # Python 模块/文件
    CLASS = "class"             # 类
    FUNCTION = "function"       # 函数
    METHOD = "method"           # 方法（类中的函数）
    CONSTANT = "constant"       # 模块级常量
    PACKAGE = "package"         # 包（文件夹）
    EXTERNAL = "external"       # 外部库（第三方/标准库）


class EdgeType(str, Enum):
    """边类型 - 关系类型"""
    IMPORTS = "imports"             # 导入关系
    INHERITS = "inherits"           # 继承关系
    CONTAINS = "contains"           # 包含关系（模块包含类/函数）
    CALLS = "calls"                 # 调用关系
    DECORATES = "decorates"         # 装饰器关系
    INSTANTIATES = "instantiates"   # 实例化关系
    USES = "uses"                   # 实际使用关系（调用导入项）


class NodeData(BaseModel):
    """图谱节点"""
    id: str                         # 唯一标识符
    label: str                      # 显示名称
    node_type: NodeType             # 节点类型
    file_path: Optional[str] = None # 所属文件路径
    line_number: Optional[int] = None  # 行号
    docstring: Optional[str] = None    # 文档字符串
    details: Optional[dict] = None     # 额外详情（参数、返回值等）


class EdgeData(BaseModel):
    """图谱边（关系）"""
    source: str                     # 源节点 ID
    target: str                     # 目标节点 ID
    edge_type: EdgeType             # 关系类型
    label: Optional[str] = None     # 显示标签
    details: Optional[dict] = None  # 额外详情


class GraphData(BaseModel):
    """完整的图谱数据"""
    nodes: List[NodeData] = []
    edges: List[EdgeData] = []
    metadata: Optional[dict] = None  # 项目元数据

    def to_vis_format(self) -> dict:
        """转换为 vis-network 所需的格式"""
        # 节点类型对应的颜色和形状
        type_styles = {
            NodeType.PACKAGE: {"color": "#FF6B6B", "shape": "diamond", "size": 30},
            NodeType.MODULE: {"color": "#4ECDC4", "shape": "dot", "size": 25},
            NodeType.CLASS: {"color": "#45B7D1", "shape": "dot", "size": 20},
            NodeType.FUNCTION: {"color": "#96CEB4", "shape": "triangle", "size": 15},
            NodeType.METHOD: {"color": "#FFEAA7", "shape": "triangle", "size": 12},
            NodeType.CONSTANT: {"color": "#DDA0DD", "shape": "square", "size": 10},
            NodeType.EXTERNAL: {"color": "#FF9F43", "shape": "dot", "size": 12},
        }

        # 边类型对应的颜色和样式
        edge_styles = {
            EdgeType.IMPORTS: {"color": "#E74C3C", "dashes": False, "width": 2},
            EdgeType.INHERITS: {"color": "#3498DB", "dashes": False, "width": 3},
            EdgeType.CONTAINS: {"color": "#95A5A6", "dashes": True, "width": 1},
            EdgeType.CALLS: {"color": "#2ECC71", "dashes": False, "width": 1},
            EdgeType.DECORATES: {"color": "#9B59B6", "dashes": True, "width": 2},
            EdgeType.INSTANTIATES: {"color": "#F39C12", "dashes": False, "width": 1},
            EdgeType.USES: {"color": "#00CEC9", "dashes": False, "width": 1.5},
        }

        # 节点类型对应的 emoji 图标
        type_icons = {
            NodeType.PACKAGE: "\U0001F4E6",   # 📦
            NodeType.MODULE: "\U0001F4C4",    # 📄
            NodeType.CLASS: "\U0001F3F7\uFE0F", # 🏷️
            NodeType.FUNCTION: "\u26A1",      # ⚡
            NodeType.METHOD: "\U0001F527",    # 🔧
            NodeType.CONSTANT: "\U0001F4CC",  # 📌
            NodeType.EXTERNAL: "\U0001F517",  # 🔗
        }

        vis_nodes = []
        for node in self.nodes:
            style = type_styles.get(node.node_type, {"color": "#999", "shape": "dot", "size": 15})
            icon = type_icons.get(node.node_type, "")
            vis_node = {
                "id": node.id,
                "label": f"{icon} {node.label}",
                "color": style["color"],
                "shape": style["shape"],
                "size": style["size"],
                "title": self._build_tooltip(node),
                "group": node.node_type.value,
            }
            if node.node_type == NodeType.EXTERNAL and node.details:
                vis_node["externalPackage"] = node.details.get("external_package", "")
            vis_nodes.append(vis_node)

        vis_edges = []
        for edge in self.edges:
            style = edge_styles.get(edge.edge_type, {"color": "#999", "dashes": False, "width": 1})
            vis_edge = {
                "from": edge.source,
                "to": edge.target,
                "label": edge.label or edge.edge_type.value,
                "color": {"color": style["color"]},
                "dashes": style["dashes"],
                "width": style["width"],
                "arrows": "to",
                "font": {"size": 10, "align": "middle"},
            }
            vis_edges.append(vis_edge)

        return {"nodes": vis_nodes, "edges": vis_edges}

    @staticmethod
    def _build_tooltip(node: NodeData) -> str:
        """构建节点的悬浮提示信息（纯文本，避免浏览器原生 tooltip 显示 HTML 标签）"""
        type_labels = {
            "package": "📦 包", "module": "📄 模块", "class": "🏷️ 类",
            "function": "⚡ 函数", "method": "🔧 方法", "constant": "📌 常量",
            "external": "🔗 外部库",
        }
        parts = [
            f"【{node.label}】",
            f"类型: {type_labels.get(node.node_type.value, node.node_type.value)}",
        ]
        if node.file_path:
            parts.append(f"文件: {node.file_path}")
        if node.line_number:
            parts.append(f"行号: {node.line_number}")
        if node.docstring:
            doc = node.docstring[:200] + "..." if len(node.docstring) > 200 else node.docstring
            parts.append(f"文档: {doc}")
        if node.details:
            if "params" in node.details and node.details["params"]:
                parts.append(f"参数: {', '.join(node.details['params'])}")
            if "bases" in node.details and node.details["bases"]:
                parts.append(f"基类: {', '.join(node.details['bases'])}")
            if "decorators" in node.details and node.details["decorators"]:
                parts.append(f"装饰器: {', '.join(node.details['decorators'])}")
        return "\n".join(parts)

    def to_blueprint_format(self) -> dict:
        """转换为蓝图模式 - 以文件为节点，左侧引脚为引入，右侧引脚为定义
        外部库按子模块分层（如 fastapi / fastapi.staticfiles 各为独立节点）"""
        node_map = {n.id: n for n in self.nodes}

        # 1. 建立 item → 所属项目模块 映射
        item_to_module: dict[str, str] = {}
        for edge in self.edges:
            if edge.edge_type == EdgeType.CONTAINS:
                src = node_map.get(edge.source)
                if src and src.node_type == NodeType.MODULE:
                    item_to_module[edge.target] = edge.source
        # 方法通过类传递归属模块
        for edge in self.edges:
            if edge.edge_type == EdgeType.CONTAINS:
                src = node_map.get(edge.source)
                tgt = node_map.get(edge.target)
                if (src and src.node_type == NodeType.CLASS
                        and tgt and tgt.node_type == NodeType.METHOD
                        and edge.source in item_to_module):
                    item_to_module[edge.target] = item_to_module[edge.source]

        # 2. 建立外部包层级树
        ext_children: dict[str, list] = {}   # parent_ext_id → [(child_id, child_node)]
        ext_parent: dict[str, str] = {}      # child_ext_id → parent_ext_id
        for edge in self.edges:
            if edge.edge_type == EdgeType.CONTAINS:
                src = node_map.get(edge.source)
                tgt = node_map.get(edge.target)
                if (src and tgt
                        and src.node_type == NodeType.EXTERNAL
                        and tgt.node_type == NodeType.EXTERNAL):
                    ext_children.setdefault(edge.source, []).append((tgt.id, tgt))
                    ext_parent[tgt.id] = edge.source

        # 有子节点的外部节点 = 外部蓝图模块节点
        ext_bp_set = set(ext_children.keys())
        # 外部叶子节点 → 直接父级蓝图模块
        ext_item_to_bp: dict[str, str] = {}
        for ext_id, parent_id in ext_parent.items():
            if ext_id not in ext_bp_set:
                ext_item_to_bp[ext_id] = parent_id

        # 3. 收集跨模块引用边
        cross_refs: list[tuple] = []
        cross_edge_types = {
            EdgeType.IMPORTS, EdgeType.CALLS, EdgeType.INSTANTIATES,
            EdgeType.USES, EdgeType.INHERITS, EdgeType.DECORATES,
        }
        for edge in self.edges:
            if edge.edge_type not in cross_edge_types:
                continue
            tgt = node_map.get(edge.target)
            if not tgt or tgt.node_type in (NodeType.MODULE, NodeType.PACKAGE):
                continue
            # 确定源所属模块
            src_node = node_map.get(edge.source)
            src_mod = (edge.source if src_node and src_node.node_type == NodeType.MODULE
                       else item_to_module.get(edge.source))
            if not src_mod:
                continue
            # 确定目标所属蓝图节点
            if tgt.node_type == NodeType.EXTERNAL:
                tgt_bp = ext_item_to_bp.get(edge.target)
                if tgt_bp:
                    cross_refs.append((src_mod, tgt_bp, edge.target, edge.edge_type))
            else:
                tgt_mod = item_to_module.get(edge.target)
                if tgt_mod and tgt_mod != src_mod:
                    cross_refs.append((src_mod, tgt_mod, edge.target, edge.edge_type))

        # 去重：同一(源模块, 目标项)只保留优先级最高的边
        edge_priority = {
            EdgeType.INHERITS: 0, EdgeType.IMPORTS: 1, EdgeType.CALLS: 2,
            EdgeType.INSTANTIATES: 3, EdgeType.DECORATES: 4, EdgeType.USES: 5,
        }
        deduped: dict = {}
        for src_mod, tgt_bp, item_id, edge_type in cross_refs:
            key = (src_mod, item_id)
            if key not in deduped or edge_priority.get(edge_type, 99) < edge_priority.get(deduped[key][1], 99):
                deduped[key] = (tgt_bp, edge_type)
        cross_refs = [(k[0], v[0], k[1], v[1]) for k, v in deduped.items()]

        # 4. 确定需要的外部蓝图节点（被引用的 + 祖先链）
        needed_ext_bps: set[str] = set()
        for _, tgt_bp, _, _ in cross_refs:
            if tgt_bp in ext_bp_set:
                needed_ext_bps.add(tgt_bp)
                p = ext_parent.get(tgt_bp)
                while p:
                    if p in ext_bp_set:
                        needed_ext_bps.add(p)
                    p = ext_parent.get(p)

        # 5. 构建蓝图节点
        bp_modules: dict = {}
        output_ids: set = set()

        # 项目模块
        for node in self.nodes:
            if node.node_type == NodeType.MODULE:
                bp_modules[node.id] = {
                    "id": node.id,
                    "label": node.label,
                    "file_path": node.file_path or "",
                    "node_type": "module",
                    "outputs": [],
                    "inputs": [],
                }

        # 外部蓝图模块（分层）
        for ext_bp_id in needed_ext_bps:
            ext_node = node_map.get(ext_bp_id)
            if not ext_node:
                continue
            bp_modules[ext_bp_id] = {
                "id": ext_bp_id,
                "label": ext_node.label,
                "file_path": "",
                "node_type": "external",
                "outputs": [],
                "inputs": [],
            }

        # 6. 填充外部蓝图模块的输出引脚（子节点 = 叶子项 + 子模块名）
        for ext_bp_id in needed_ext_bps:
            if ext_bp_id not in ext_children:
                continue
            for child_id, child_node in ext_children[ext_bp_id]:
                key = (ext_bp_id, child_id)
                if key not in output_ids:
                    bp_modules[ext_bp_id]["outputs"].append({
                        "id": child_id,
                        "label": child_node.label,
                        "node_type": "external",
                    })
                    output_ids.add(key)

        # 7. 填充项目模块的输出引脚（定义的类、函数、常量、方法）
        for edge in self.edges:
            if edge.edge_type != EdgeType.CONTAINS:
                continue
            tgt = node_map.get(edge.target)
            if not tgt:
                continue
            src = node_map.get(edge.source)
            if not src:
                continue
            # 模块直接定义的类/函数/常量
            if src.node_type == NodeType.MODULE and edge.source in bp_modules:
                if tgt.node_type in (NodeType.CLASS, NodeType.FUNCTION, NodeType.CONSTANT):
                    key = (edge.source, tgt.id)
                    if key not in output_ids:
                        bp_modules[edge.source]["outputs"].append({
                            "id": tgt.id,
                            "label": tgt.label,
                            "node_type": tgt.node_type.value,
                        })
                        output_ids.add(key)
            # 类的方法归属到模块输出（仅显示方法名）
            if src.node_type == NodeType.CLASS and tgt.node_type == NodeType.METHOD:
                mod_id = item_to_module.get(edge.source)
                if mod_id and mod_id in bp_modules:
                    key = (mod_id, tgt.id)
                    if key not in output_ids:
                        bp_modules[mod_id]["outputs"].append({
                            "id": tgt.id,
                            "label": tgt.label,
                            "node_type": tgt.node_type.value,
                        })
                        output_ids.add(key)

        # 8. 外部蓝图模块间的层级链接（父模块 → 子模块）
        links: list[dict] = []
        ext_input_ids: set = set()
        for ext_bp_id in needed_ext_bps:
            if ext_bp_id not in ext_children:
                continue
            for child_id, child_node in ext_children[ext_bp_id]:
                if child_id in needed_ext_bps:
                    # 子模块也是蓝图节点 → 添加层级引脚和链接
                    in_key = (child_id, child_id)
                    if in_key not in ext_input_ids:
                        bp_modules[child_id]["inputs"].append({
                            "id": child_id,
                            "label": child_node.label,
                            "node_type": "external",
                            "edge_type": "contains",
                        })
                        ext_input_ids.add(in_key)
                    out_key = (ext_bp_id, child_id)
                    if out_key in output_ids:
                        links.append({
                            "src_module": ext_bp_id,
                            "tgt_module": child_id,
                            "item_id": child_id,
                            "edge_type": "contains",
                        })

        # 9. 处理项目模块的输入引脚和跨模块链接
        input_ids: set = set()
        for src_mod, tgt_bp, item_id, edge_type in cross_refs:
            if src_mod not in bp_modules or tgt_bp not in bp_modules:
                continue
            tgt = node_map.get(item_id)
            if not tgt:
                continue
            # 添加输入引脚（去重）
            in_key = (src_mod, item_id)
            if in_key not in input_ids:
                bp_modules[src_mod]["inputs"].append({
                    "id": item_id,
                    "label": tgt.label,
                    "node_type": tgt.node_type.value,
                    "edge_type": edge_type.value,
                })
                input_ids.add(in_key)
            # 检查目标有对应的输出引脚 → 创建链接
            out_key = (tgt_bp, item_id)
            if out_key in output_ids:
                links.append({
                    "src_module": tgt_bp,
                    "tgt_module": src_mod,
                    "item_id": item_id,
                    "edge_type": edge_type.value,
                })

        return {"modules": list(bp_modules.values()), "links": links}
