"""
Python AST 解析器 - 解析 Python 源代码，提取模块、类、函数、导入等信息
"""

import ast
import os
from pathlib import Path
from typing import Optional, Dict, List, Tuple

from .models import (
    NodeData, EdgeData, NodeType, EdgeType
)


class PythonASTParser:
    """Python AST 解析器"""

    def __init__(self, root_path: str):
        self.root_path = Path(root_path).resolve()
        self.nodes: Dict[str, NodeData] = {}
        self.edges: List[EdgeData] = []
        self._module_map: Dict[str, str] = {}  # 模块名 -> 节点ID 的映射
        self._edge_keys: set = set()  # (source, target, edge_type) 快速去重
        self._class_name_index: Dict[str, str] = {}  # 类名 -> 节点ID 索引
        self._func_name_index: Dict[str, str] = {}   # 函数名 -> 节点ID 索引
        self._current_import_map: Dict[str, str] = {}  # 每个文件的导入别名 -> 外部节点ID

    def parse_project(self):
        """解析整个项目"""
        # 1. 扫描所有 Python 文件
        py_files = self._scan_python_files()

        # 2. 建立模块映射
        self._build_module_map(py_files)

        # 3. 解析每个文件
        for py_file in py_files:
            self._parse_file(py_file)

        return self.nodes, self.edges

    def _scan_python_files(self) -> List[Path]:
        """扫描目录下所有 Python 文件"""
        py_files = []
        for root, dirs, files in os.walk(self.root_path):
            # 跳过隐藏目录、虚拟环境、缓存等
            dirs[:] = [
                d for d in dirs
                if not d.startswith('.')
                and d not in ('__pycache__', 'node_modules', '.git', 'venv', 'env',
                              '.venv', '.env', '.tox', '.mypy_cache', '.pytest_cache',
                              'dist', 'build', 'egg-info', 'site-packages',
                              '__pypackages__', '.eggs', 'htmlcov', '.nox')
                and not d.endswith('.egg-info')
            ]
            for f in files:
                if f.endswith('.py'):
                    py_files.append(Path(root) / f)
        return sorted(py_files)

    def _build_module_map(self, py_files: List[Path]):
        """建立模块名到节点ID的映射"""
        for py_file in py_files:
            rel_path = py_file.relative_to(self.root_path)
            module_name = self._path_to_module(rel_path)
            node_id = f"module:{module_name}"
            self._module_map[module_name] = node_id

    def _path_to_module(self, rel_path: Path) -> str:
        """将文件路径转为模块名"""
        parts = list(rel_path.parts)
        if parts[-1] == '__init__.py':
            parts = parts[:-1]
            if not parts:
                return str(rel_path.parent.name) if rel_path.parent.name else '__init__'
        else:
            parts[-1] = parts[-1].replace('.py', '')
        return '.'.join(parts)

    def _parse_file(self, file_path: Path):
        """解析单个 Python 文件"""
        try:
            if file_path.stat().st_size > 1024 * 1024:  # 跳过超过 1MB 的文件
                return
        except OSError:
            return

        try:
            source = file_path.read_text(encoding='utf-8')
        except (UnicodeDecodeError, PermissionError):
            try:
                source = file_path.read_text(encoding='gbk')
            except Exception:
                return

        try:
            tree = ast.parse(source, filename=str(file_path))
        except SyntaxError:
            return

        rel_path = file_path.relative_to(self.root_path)
        module_name = self._path_to_module(rel_path)
        module_id = f"module:{module_name}"

        # 重置每个文件的导入别名映射
        self._current_import_map = {}

        # 添加模块节点
        self._add_node(NodeData(
            id=module_id,
            label=module_name,
            node_type=NodeType.MODULE,
            file_path=str(rel_path),
            line_number=1,
            docstring=ast.get_docstring(tree),
        ))

        # 添加包节点和包含关系
        self._add_package_hierarchy(module_name, module_id)

        # 遍历 AST 节点
        for node in ast.iter_child_nodes(tree):
            if isinstance(node, ast.ClassDef):
                self._parse_class(node, module_id, module_name, str(rel_path))
            elif isinstance(node, ast.FunctionDef) or isinstance(node, ast.AsyncFunctionDef):
                self._parse_function(node, module_id, module_name, str(rel_path))
            elif isinstance(node, (ast.Import, ast.ImportFrom)):
                self._parse_import(node, module_id, module_name)
            elif isinstance(node, ast.Assign):
                self._parse_assignment(node, module_id, module_name, str(rel_path))

        # 解析函数调用关系（深层遍历）
        self._parse_calls(tree, module_id, module_name, str(rel_path))

        # 解析导入内容的实际使用情况
        self._parse_import_usage(tree, module_id)

    def _add_package_hierarchy(self, module_name: str, module_id: str):
        """添加包的层级结构"""
        parts = module_name.split('.')
        if len(parts) > 1:
            for i in range(len(parts) - 1):
                pkg_name = '.'.join(parts[:i + 1])
                pkg_id = f"package:{pkg_name}"
                if pkg_id not in self.nodes:
                    self._add_node(NodeData(
                        id=pkg_id,
                        label=pkg_name,
                        node_type=NodeType.PACKAGE,
                    ))
                # 包含关系
                if i == len(parts) - 2:
                    self._add_edge(EdgeData(
                        source=pkg_id,
                        target=module_id,
                        edge_type=EdgeType.CONTAINS,
                        label="包含",
                    ))
                elif i < len(parts) - 2:
                    child_pkg_id = f"package:{'.'.join(parts[:i + 2])}"
                    self._add_edge(EdgeData(
                        source=pkg_id,
                        target=child_pkg_id,
                        edge_type=EdgeType.CONTAINS,
                        label="包含",
                    ))

    def _parse_class(self, node: ast.ClassDef, module_id: str, module_name: str, file_path: str):
        """解析类定义"""
        class_id = f"class:{module_name}.{node.name}"

        # 获取装饰器
        decorators = []
        for dec in node.decorator_list:
            dec_name = self._get_decorator_name(dec)
            if dec_name:
                decorators.append(dec_name)

        # 获取基类
        bases = []
        for base in node.bases:
            base_name = self._get_name(base)
            if base_name:
                bases.append(base_name)

        self._add_node(NodeData(
            id=class_id,
            label=node.name,
            node_type=NodeType.CLASS,
            file_path=file_path,
            line_number=node.lineno,
            docstring=ast.get_docstring(node),
            details={"bases": bases, "decorators": decorators},
        ))

        # 模块包含类
        self._add_edge(EdgeData(
            source=module_id,
            target=class_id,
            edge_type=EdgeType.CONTAINS,
            label="定义",
        ))

        # 继承关系
        for base_name in bases:
            base_id = self._resolve_class_id(base_name, module_name)
            if base_id:
                self._add_edge(EdgeData(
                    source=class_id,
                    target=base_id,
                    edge_type=EdgeType.INHERITS,
                    label="继承",
                ))

        # 装饰器关系
        for dec_name in decorators:
            dec_id = self._resolve_function_id(dec_name, module_name)
            if dec_id:
                self._add_edge(EdgeData(
                    source=dec_id,
                    target=class_id,
                    edge_type=EdgeType.DECORATES,
                    label="装饰",
                ))

        # 解析类中的方法
        for item in ast.iter_child_nodes(node):
            if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)):
                self._parse_method(item, class_id, module_name, node.name, file_path)

    def _parse_method(self, node, class_id: str, module_name: str,
                      class_name: str, file_path: str):
        """解析类方法"""
        method_id = f"method:{module_name}.{class_name}.{node.name}"

        # 获取参数
        params = [arg.arg for arg in node.args.args if arg.arg != 'self']

        # 获取装饰器
        decorators = []
        for dec in node.decorator_list:
            dec_name = self._get_decorator_name(dec)
            if dec_name:
                decorators.append(dec_name)

        self._add_node(NodeData(
            id=method_id,
            label=node.name,
            node_type=NodeType.METHOD,
            file_path=file_path,
            line_number=node.lineno,
            docstring=ast.get_docstring(node),
            details={"params": params, "decorators": decorators},
        ))

        # 类包含方法
        self._add_edge(EdgeData(
            source=class_id,
            target=method_id,
            edge_type=EdgeType.CONTAINS,
            label="定义",
        ))

    def _parse_function(self, node, module_id: str, module_name: str, file_path: str):
        """解析函数定义"""
        func_id = f"function:{module_name}.{node.name}"

        # 获取参数
        params = [arg.arg for arg in node.args.args]

        # 获取装饰器
        decorators = []
        for dec in node.decorator_list:
            dec_name = self._get_decorator_name(dec)
            if dec_name:
                decorators.append(dec_name)

        self._add_node(NodeData(
            id=func_id,
            label=node.name,
            node_type=NodeType.FUNCTION,
            file_path=file_path,
            line_number=node.lineno,
            docstring=ast.get_docstring(node),
            details={"params": params, "decorators": decorators},
        ))

        # 模块包含函数
        self._add_edge(EdgeData(
            source=module_id,
            target=func_id,
            edge_type=EdgeType.CONTAINS,
            label="定义",
        ))

    def _parse_import(self, node, module_id: str, module_name: str):
        """解析导入语句"""
        if isinstance(node, ast.Import):
            for alias in node.names:
                target_id = self._resolve_module_id(alias.name)
                if target_id:
                    self._add_edge(EdgeData(
                        source=module_id,
                        target=target_id,
                        edge_type=EdgeType.IMPORTS,
                        label="导入",
                    ))
                else:
                    # 外部库导入
                    self._add_external_import_chain(module_id, alias.name, [])
                    self._current_import_map[alias.asname or alias.name] = f"external:{alias.name}"
        elif isinstance(node, ast.ImportFrom):
            if node.module:
                # 处理相对导入
                import_module = node.module
                if node.level > 0:
                    parts = module_name.split('.')
                    if len(parts) >= node.level:
                        base = '.'.join(parts[:len(parts) - node.level + 1])
                        import_module = f"{base}.{node.module}" if node.module else base

                target_id = self._resolve_module_id(import_module)
                if target_id:
                    self._add_edge(EdgeData(
                        source=module_id,
                        target=target_id,
                        edge_type=EdgeType.IMPORTS,
                        label="导入",
                    ))

                    # 解析 from xxx import yyy 中的具体导入项
                    if node.names:
                        for alias in node.names:
                            if alias.name == '*':
                                continue
                            item_id = (
                                self._resolve_class_id(alias.name, import_module) or
                                self._resolve_function_id(alias.name, import_module)
                            )
                            if item_id and item_id in self.nodes:
                                self._add_edge(EdgeData(
                                    source=module_id,
                                    target=item_id,
                                    edge_type=EdgeType.IMPORTS,
                                    label=f"导入 {alias.name}",
                                ))
                elif node.level == 0:
                    # 外部库导入
                    names = [alias.name for alias in node.names if alias.name != '*']
                    self._add_external_import_chain(module_id, import_module, names)
                    # 记录导入别名映射
                    for alias in node.names:
                        if alias.name != '*':
                            self._current_import_map[alias.asname or alias.name] = f"external:{import_module}.{alias.name}"

    def _add_external_import_chain(self, module_id: str, import_module: str, imported_names: List[str]):
        """创建外部库导入链节点"""
        parts = import_module.split('.')
        root_pkg = parts[0]
        prev_id = None

        for i, part in enumerate(parts):
            full_path = '.'.join(parts[:i + 1])
            ext_id = f"external:{full_path}"
            self._add_node(NodeData(
                id=ext_id,
                label=part,
                node_type=NodeType.EXTERNAL,
                details={"external_package": root_pkg},
            ))
            if prev_id:
                self._add_edge(EdgeData(
                    source=prev_id,
                    target=ext_id,
                    edge_type=EdgeType.CONTAINS,
                    label="包含",
                ))
            prev_id = ext_id

        leaf_id = f"external:{import_module}"
        if imported_names:
            for name in imported_names:
                item_id = f"external:{import_module}.{name}"
                self._add_node(NodeData(
                    id=item_id,
                    label=name,
                    node_type=NodeType.EXTERNAL,
                    details={"external_package": root_pkg},
                ))
                self._add_edge(EdgeData(
                    source=leaf_id,
                    target=item_id,
                    edge_type=EdgeType.CONTAINS,
                    label="包含",
                ))
                self._add_edge(EdgeData(
                    source=module_id,
                    target=item_id,
                    edge_type=EdgeType.IMPORTS,
                    label="导入",
                ))
        else:
            self._add_edge(EdgeData(
                source=module_id,
                target=leaf_id,
                edge_type=EdgeType.IMPORTS,
                label="导入",
            ))

    def _parse_assignment(self, node: ast.Assign, module_id: str,
                          module_name: str, file_path: str):
        """解析模块级变量赋值"""
        for target in node.targets:
            if isinstance(target, ast.Name):
                # 只记录全大写的常量或重要变量
                name = target.id
                if name.isupper() or name.startswith('__'):
                    var_id = f"variable:{module_name}.{name}"
                    self._add_node(NodeData(
                        id=var_id,
                        label=name,
                        node_type=NodeType.VARIABLE,
                        file_path=file_path,
                        line_number=node.lineno,
                    ))
                    self._add_edge(EdgeData(
                        source=module_id,
                        target=var_id,
                        edge_type=EdgeType.CONTAINS,
                        label="定义",
                    ))

    def _parse_calls(self, tree: ast.AST, module_id: str,
                     module_name: str, file_path: str):
        """解析函数/类调用关系"""
        for node in ast.walk(tree):
            if isinstance(node, ast.Call):
                caller_id = module_id
                call_name = self._get_call_name(node)
                if not call_name:
                    continue

                # 尝试解析被调用的目标
                target_id = (
                    self._resolve_class_id(call_name, module_name) or
                    self._resolve_function_id(call_name, module_name)
                )

                if target_id and target_id in self.nodes:
                    # 判断是否是实例化（调用类）
                    if target_id.startswith("class:"):
                        edge_type = EdgeType.INSTANTIATES
                        label = "实例化"
                    else:
                        edge_type = EdgeType.CALLS
                        label = "调用"

                    self._add_edge(EdgeData(
                        source=caller_id,
                        target=target_id,
                        edge_type=edge_type,
                        label=label,
                    ))

    def _parse_import_usage(self, tree: ast.AST, module_id: str):
        """解析导入内容的实际使用情况：追踪哪些导入的函数/类被实际调用"""
        if not self._current_import_map:
            return

        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            call_name = self._get_call_name(node)
            if not call_name:
                continue

            parts = call_name.split('.')
            root = parts[0]
            if root not in self._current_import_map:
                continue

            root_ext_id = self._current_import_map[root]
            root_pkg = root_ext_id.split(':')[1].split('.')[0]

            if len(parts) == 1:
                # 直接调用导入项：FastAPI(), Path() 等
                self._add_edge(EdgeData(
                    source=module_id,
                    target=root_ext_id,
                    edge_type=EdgeType.USES,
                    label="使用",
                ))
            else:
                # 链式调用：os.path.join(), ast.parse() 等
                base_parts = root_ext_id.split(':')[1].split('.')
                prev_id = root_ext_id
                for i in range(1, len(parts)):
                    full_parts = base_parts + parts[1:i + 1]
                    full_path = '.'.join(full_parts)
                    ext_id = f"external:{full_path}"
                    self._add_node(NodeData(
                        id=ext_id,
                        label=parts[i],
                        node_type=NodeType.EXTERNAL,
                        details={"external_package": root_pkg},
                    ))
                    self._add_edge(EdgeData(
                        source=prev_id,
                        target=ext_id,
                        edge_type=EdgeType.CONTAINS,
                        label="包含",
                    ))
                    prev_id = ext_id

                self._add_edge(EdgeData(
                    source=module_id,
                    target=prev_id,
                    edge_type=EdgeType.USES,
                    label="使用",
                ))

    # ============ 辅助方法 ============

    def _add_node(self, node: NodeData):
        """添加节点（去重）"""
        if node.id not in self.nodes:
            self.nodes[node.id] = node
            # 构建名称索引以加速后续解析
            short_name = node.id.split(":", 1)[-1].rsplit(".", 1)[-1]
            if node.id.startswith("class:"):
                self._class_name_index[short_name] = node.id
            elif node.id.startswith("function:"):
                self._func_name_index[short_name] = node.id

    def _add_edge(self, edge: EdgeData):
        """添加边（去重）"""
        key = (edge.source, edge.target, edge.edge_type)
        if key in self._edge_keys:
            return
        self._edge_keys.add(key)
        self.edges.append(edge)

    def _resolve_module_id(self, module_name: str) -> Optional[str]:
        """解析模块名到节点ID"""
        if module_name in self._module_map:
            return self._module_map[module_name]
        # 尝试匹配子模块
        for name, node_id in self._module_map.items():
            if name.endswith(f".{module_name}") or module_name.endswith(f".{name}"):
                return node_id
        return None

    def _resolve_class_id(self, class_name: str, context_module: str) -> Optional[str]:
        """解析类名到节点ID"""
        full_id = f"class:{context_module}.{class_name}"
        if full_id in self.nodes:
            return full_id
        return self._class_name_index.get(class_name)

    def _resolve_function_id(self, func_name: str, context_module: str) -> Optional[str]:
        """解析函数名到节点ID"""
        full_id = f"function:{context_module}.{func_name}"
        if full_id in self.nodes:
            return full_id
        return self._func_name_index.get(func_name)

    @staticmethod
    def _get_name(node) -> Optional[str]:
        """获取 AST 节点的名称"""
        if isinstance(node, ast.Name):
            return node.id
        elif isinstance(node, ast.Attribute):
            value_name = PythonASTParser._get_name(node.value)
            if value_name:
                return f"{value_name}.{node.attr}"
            return node.attr
        elif isinstance(node, ast.Subscript):
            return PythonASTParser._get_name(node.value)
        return None

    @staticmethod
    def _get_decorator_name(node) -> Optional[str]:
        """获取装饰器名称"""
        if isinstance(node, ast.Name):
            return node.id
        elif isinstance(node, ast.Attribute):
            return PythonASTParser._get_name(node)
        elif isinstance(node, ast.Call):
            return PythonASTParser._get_name(node.func)
        return None

    @staticmethod
    def _get_call_name(node: ast.Call) -> Optional[str]:
        """获取函数调用的名称"""
        return PythonASTParser._get_name(node.func)
