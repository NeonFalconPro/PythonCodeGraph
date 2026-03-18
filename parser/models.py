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

    def to_blueprint_format(self) -> dict:
        """转换为蓝图模式 - 以文件为节点，左侧引脚为引入，右侧引脚为定义
        外部库按子模块分层（如 fastapi / fastapi.staticfiles 各为独立节点）"""
        node_map = {n.id: n for n in self.nodes}

        def _normalize_path(path: str) -> str:
            return str(path or "").replace("\\", "/").strip("/")

        def _folder_node_id(folder_path: str) -> str:
            normalized = _normalize_path(folder_path)
            return f"folder:{normalized}" if normalized else "folder:."

        # 1. 建立 item → 所属项目模块 映射
        item_to_module: dict[str, str] = {}
        method_owner_class: dict[str, str] = {}
        for edge in self.edges:
            if edge.edge_type == EdgeType.CONTAINS:
                src = node_map.get(edge.source)
                tgt = node_map.get(edge.target)
                if src and src.node_type == NodeType.MODULE:
                    item_to_module[edge.target] = edge.source
                if (src and tgt
                        and src.node_type == NodeType.CLASS
                        and tgt.node_type == NodeType.METHOD):
                    method_owner_class[tgt.id] = src.label
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
        # 对 uses 链式调用（如 os.path.exists）做扁平化：仅保留 root 外部节点（os）
        needed_ext_bps: set[str] = set()
        for _, tgt_bp, item_id, edge_type in cross_refs:
            if edge_type == EdgeType.USES and item_id.startswith("external:"):
                ext_path = item_id.split(":", 1)[1]
                parts = ext_path.split('.')
                if len(parts) >= 3:
                    root_bp = f"external:{parts[0]}"
                    if root_bp in ext_bp_set:
                        needed_ext_bps.add(root_bp)
                    continue
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

        # 5.1 项目目录层级（目录 -> 子目录 / 文件）
        dir_children: dict[str, list] = {}
        dir_seen: set[tuple[str, str]] = set()

        def _add_dir_child(parent_dir: str, child_id: str, child_label: str, child_type: str, child_doc: Optional[str] = None):
            key = (parent_dir, child_id)
            if key in dir_seen:
                return
            dir_seen.add(key)
            dir_children.setdefault(parent_dir, []).append({
                "id": child_id,
                "label": child_label,
                "node_type": child_type,
                "docstring": child_doc,
            })

        # 先创建项目模块节点，同时收集文件路径目录树
        for node in self.nodes:
            if node.node_type != NodeType.MODULE:
                continue

            normalized_file_path = _normalize_path(node.file_path or "")
            path_parts = [p for p in normalized_file_path.split("/") if p]
            dir_parts = path_parts[:-1]

            bp_modules[node.id] = {
                "id": node.id,
                "label": node.label,
                "file_path": normalized_file_path,
                "node_type": "module",
                "outputs": [],
                "inputs": [],
            }

            if not path_parts:
                continue

            # 目录链：folder:a -> folder:a/b -> ...
            for i, dir_name in enumerate(dir_parts):
                current_dir = "/".join(dir_parts[:i + 1])
                parent_dir = "/".join(dir_parts[:i])
                _add_dir_child(
                    parent_dir,
                    _folder_node_id(current_dir),
                    dir_name,
                    "package",
                )

            # 最末级目录（或根） -> 文件模块
            parent_dir = "/".join(dir_parts)
            filename = path_parts[-1]
            _add_dir_child(
                parent_dir,
                node.id,
                filename,
                "module",
                node.docstring,
            )

        # 创建目录节点
        folder_ids: set[str] = set()
        for parent_dir, children in dir_children.items():
            if parent_dir:
                folder_id = _folder_node_id(parent_dir)
                folder_ids.add(folder_id)
                bp_modules.setdefault(folder_id, {
                    "id": folder_id,
                    "label": parent_dir.split("/")[-1],
                    "file_path": parent_dir,
                    "node_type": "package",
                    "outputs": [],
                    "inputs": [],
                })
            for child in children:
                if child["node_type"] == "package":
                    folder_ids.add(child["id"])
                    child_path = child["id"].split(":", 1)[1] if ":" in child["id"] else child["label"]
                    bp_modules.setdefault(child["id"], {
                        "id": child["id"],
                        "label": child["label"],
                        "file_path": child_path,
                        "node_type": "package",
                        "outputs": [],
                        "inputs": [],
                    })

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
                        "docstring": child_node.docstring,
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
                            "docstring": tgt.docstring,
                        })
                        output_ids.add(key)
            # 类的方法归属到模块输出（显示为 类名.方法）
            if src.node_type == NodeType.CLASS and tgt.node_type == NodeType.METHOD:
                mod_id = item_to_module.get(edge.source)
                if mod_id and mod_id in bp_modules:
                    key = (mod_id, tgt.id)
                    if key not in output_ids:
                        qualified_label = f"{src.label}.{tgt.label}"
                        bp_modules[mod_id]["outputs"].append({
                            "id": tgt.id,
                            "label": qualified_label,
                            "node_type": tgt.node_type.value,
                            "docstring": tgt.docstring,
                        })
                        output_ids.add(key)

        # 8. 目录层级链接（目录 -> 子目录 / 文件）
        links: list[dict] = []
        folder_input_ids: set = set()
        for parent_dir, children in dir_children.items():
            if parent_dir:
                parent_bp_id = _folder_node_id(parent_dir)
            else:
                # 根目录不作为单独节点，只作为层级起点
                parent_bp_id = None

            for child in children:
                child_id = child["id"]

                # 根目录直连仅用于给文件/目录增加父级输入引脚，不创建无源链接
                if parent_bp_id and parent_bp_id in bp_modules and child_id in bp_modules:
                    out_key = (parent_bp_id, child_id)
                    if out_key not in output_ids:
                        bp_modules[parent_bp_id]["outputs"].append({
                            "id": child_id,
                            "label": child["label"],
                            "node_type": child["node_type"],
                            "docstring": child.get("docstring"),
                        })
                        output_ids.add(out_key)

                    in_key = (child_id, child_id)
                    if in_key not in folder_input_ids:
                        bp_modules[child_id]["inputs"].append({
                            "id": child_id,
                            "label": child["label"],
                            "node_type": "package",
                            "edge_type": "contains",
                            "docstring": None,
                        })
                        folder_input_ids.add(in_key)

                    links.append({
                        "src_module": parent_bp_id,
                        "tgt_module": child_id,
                        "item_id": child_id,
                        "edge_type": "contains",
                    })

        # 9. 外部蓝图模块间的层级链接（父模块 → 子模块）
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
                            "docstring": child_node.docstring,
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

        # 10. 处理项目模块的输入引脚和跨模块链接
        input_ids: set = set()
        for src_mod, tgt_bp, item_id, edge_type in cross_refs:
            if src_mod not in bp_modules:
                continue
            tgt = node_map.get(item_id)
            if not tgt:
                continue

            # uses 链式调用扁平化：
            # os.path.exists() -> 外部节点 os 的输出引脚 path，项目模块输入引脚 exists
            if edge_type == EdgeType.USES and item_id.startswith("external:"):
                ext_path = item_id.split(":", 1)[1]
                parts = ext_path.split('.')
                if len(parts) >= 3:
                    root_bp = f"external:{parts[0]}"
                    src_slot_name = parts[1]
                    tgt_slot_name = parts[-1]
                    if root_bp in bp_modules:
                        existing_src_item_id = f"external:{parts[0]}.{src_slot_name}"
                        src_item_id = existing_src_item_id
                        tgt_item_id = f"external_use:{ext_path}"

                        out_key = (root_bp, src_item_id)
                        if out_key not in output_ids:
                            bp_modules[root_bp]["outputs"].append({
                                "id": src_item_id,
                                "label": src_slot_name,
                                "node_type": "external",
                                "docstring": tgt.docstring,
                            })
                            output_ids.add(out_key)

                        in_key = (src_mod, tgt_item_id)
                        if in_key not in input_ids:
                            bp_modules[src_mod]["inputs"].append({
                                "id": tgt_item_id,
                                "label": tgt_slot_name,
                                "node_type": "external",
                                "edge_type": edge_type.value,
                                "docstring": tgt.docstring,
                            })
                            input_ids.add(in_key)

                        links.append({
                            "src_module": root_bp,
                            "tgt_module": src_mod,
                            "src_item_id": src_item_id,
                            "tgt_item_id": tgt_item_id,
                            "edge_type": edge_type.value,
                        })
                        continue

            if tgt_bp not in bp_modules:
                continue

            # 添加输入引脚（去重）
            in_key = (src_mod, item_id)
            if in_key not in input_ids:
                tgt_label = tgt.label
                if tgt.node_type == NodeType.METHOD and tgt.id in method_owner_class:
                    tgt_label = f"{method_owner_class[tgt.id]}.{tgt.label}"
                bp_modules[src_mod]["inputs"].append({
                    "id": item_id,
                    "label": tgt_label,
                    "node_type": tgt.node_type.value,
                    "edge_type": edge_type.value,
                    "docstring": tgt.docstring,
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
