"""
知识图谱构建器 - 调用 AST 解析器，构建完整的图谱数据
"""

import os
from pathlib import Path

from typing import List, Dict

from .ast_parser import PythonASTParser
from .models import GraphData, NodeData, EdgeData


class GraphBuilder:
    """知识图谱构建器"""

    def __init__(self, project_path: str):
        self.project_path = Path(project_path).resolve()
        if not self.project_path.exists():
            raise FileNotFoundError(f"路径不存在: {project_path}")
        if not self.project_path.is_dir():
            raise NotADirectoryError(f"不是文件夹: {project_path}")

    def build(self) -> GraphData:
        """构建知识图谱"""
        parser = PythonASTParser(str(self.project_path))
        nodes_dict, edges_list = parser.parse_project()

        # 过滤掉没有连接的孤立节点（可选）
        connected_ids = set()
        for edge in edges_list:
            connected_ids.add(edge.source)
            connected_ids.add(edge.target)

        # 保留所有有连接的节点，以及模块级节点
        filtered_nodes = [
            node for node in nodes_dict.values()
            if node.id in connected_ids or node.node_type.value in ('module', 'package')
        ]

        # 过滤掉目标节点不存在的边
        valid_ids = {node.id for node in filtered_nodes}
        filtered_edges = [
            edge for edge in edges_list
            if edge.source in valid_ids and edge.target in valid_ids
        ]

        # 收集项目元数据
        py_file_count = sum(1 for n in filtered_nodes if n.node_type.value == 'module')
        metadata = {
            "project_name": self.project_path.name,
            "project_path": str(self.project_path),
            "python_files": py_file_count,
            "total_nodes": len(filtered_nodes),
            "total_edges": len(filtered_edges),
            "node_type_counts": self._count_by_type(filtered_nodes),
            "edge_type_counts": self._count_edge_types(filtered_edges),
        }

        return GraphData(
            nodes=filtered_nodes,
            edges=filtered_edges,
            metadata=metadata,
        )

    @staticmethod
    def _count_by_type(nodes: List[NodeData]) -> dict:
        """按类型统计节点数量"""
        counts = {}
        for node in nodes:
            t = node.node_type.value
            counts[t] = counts.get(t, 0) + 1
        return counts

    @staticmethod
    def _count_edge_types(edges: List[EdgeData]) -> dict:
        """按类型统计边数量"""
        counts = {}
        for edge in edges:
            t = edge.edge_type.value
            counts[t] = counts.get(t, 0) + 1
        return counts
