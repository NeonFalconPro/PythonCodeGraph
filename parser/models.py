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
    VARIABLE = "variable"       # 模块级变量/常量
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
            NodeType.VARIABLE: {"color": "#DDA0DD", "shape": "square", "size": 10},
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
            NodeType.VARIABLE: "\U0001F4CC",  # 📌
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
            "function": "⚡ 函数", "method": "🔧 方法", "variable": "📌 变量",
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
