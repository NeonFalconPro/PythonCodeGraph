# CodeGraph 框架开发指南（蓝图模式）

本文档面向二次开发者，聚焦蓝图模式下的架构、核心数据结构、扩展流程、调试策略和维护建议。

## 1. 目标与范围

CodeGraph 是一个 Python 静态代码关系图平台，核心目标是：

- 从 Python 项目中抽取结构实体与关系
- 将关系图映射为蓝图节点/引脚/连线
- 提供低耦合扩展路径（新增关系、节点类型、UI 交互）

当前不在范围内：

- 运行时调用追踪
- 跨语言代码解析
- 语义级别数据流分析

## 2. 总体架构

系统按三层组织：

- 表现层（UI）
  - 蓝图模式（LiteGraph.js）
- 应用层（FastAPI）
  - 路由与请求模型
  - 输入校验和统一异常返回
- 领域层（Parser + Graph Model）
  - AST 扫描与解析
  - 节点边构建、去重、归一化
  - 输出格式适配（blueprint）

## 3. 关键模块职责

### 3.1 app.py

- 应用入口与静态资源挂载
- 页面路由：`/`、`/blueprint`
- API 路由：
  - `POST /api/blueprint/analyze`
  - `POST /api/blueprint/analyze/filtered`
  - `GET /api/browse`
- 共享方法：
  - `_build_graph(path)`：路径校验 + 图谱构建
  - `_apply_filters(graph_data, req)`：节点/关系过滤

### 3.2 parser/ast_parser.py

核心职责：扫描项目、解析 AST、生成节点边。

执行顺序：

1. 扫描 Python 文件（过滤隐藏目录、虚拟环境、缓存目录）
2. 建立模块名映射（模块名 -> 节点 ID）
3. 逐文件解析：
  - 模块节点
  - 包层级节点与 contains 边
  - 类、方法、函数、常量
  - 导入关系与外部依赖层级
  - 调用关系（calls/instantiates）
  - 导入项使用关系（uses）

内部索引：

- `_module_map`：模块解析
- `_class_name_index` / `_func_name_index`：名称解析兜底
- `_method_index`：实例方法调用映射
- `_edge_keys`：边去重
- `_current_import_map`：单文件导入别名解析

### 3.3 parser/graph_builder.py

- 调用 `PythonASTParser.parse_project()`
- 过滤孤立节点和无效边
- 汇总项目元数据（节点数、边数、类型统计）

### 3.4 parser/models.py

定义统一图模型：

- `NodeType`
- `EdgeType`
- `NodeData`
- `EdgeData`
- `GraphData`

输出适配：

- `to_blueprint_format()`：按“模块输入输出插槽”组织数据

## 4. 数据模型规范

### 4.1 节点 ID 约定

统一形如 `type:qualified.name`，示例：

- `module:parser.ast_parser`
- `class:parser.models.GraphData`
- `method:parser.models.GraphData.to_blueprint_format`
- `external:fastapi.responses.JSONResponse`

建议：ID 一旦发布给前端应尽量保持稳定，避免破坏 UI 侧缓存与跳转逻辑。

### 4.2 关系语义

- `imports`：导入依赖
- `inherits`：继承
- `contains`：所属/定义层级
- `calls`：调用
- `decorates`：装饰器作用
- `instantiates`：类实例化
- `uses`：导入项被实际使用

## 5. 蓝图可视化机制

入口：`templates/blueprint.html` + `static/js/blueprint.js`

特点：

- 每个模块（含外部模块）作为一个蓝图节点
- 左侧输入插槽：依赖项
- 右侧输出插槽：定义项
- 连线表达跨模块引用

关键点：

- 数据依赖 `to_blueprint_format()` 的 `modules` 和 `links`
- 前端过滤会同时过滤模块、插槽和连线
- 支持自动布局、聚焦模式、关系高亮、返回全图

## 6. 扩展开发手册

### 6.1 新增一种关系类型（推荐流程）

以新增 `overrides`（方法重写）为例：

1. 在 `EdgeType` 增加新枚举
2. 在 `ast_parser.py` 增加解析逻辑并调用 `_add_edge`
3. 在 `to_blueprint_format()` 中补齐引脚映射和连线逻辑
4. 在 `blueprint.html` 增加关系过滤复选框
5. 在 `blueprint.js` 的过滤判断中加入该类型
6. 更新 README 与本指南

### 6.2 新增一种节点类型

1. 在 `NodeType` 增加枚举
2. 在解析器构建该节点
3. 在 `to_blueprint_format()` 定义其输入/输出插槽策略
4. 在 `blueprint.js` 增加配色、缩写和过滤逻辑

### 6.3 增强调用关系精度

现状是模块级调用源，可升级为函数/方法级调用源：

1. 在解析时维护“当前作用域函数/方法节点 ID”
2. 调用边 source 从模块改为作用域节点
3. 在蓝图转换中为函数级节点制定可视化策略（聚合或直出）

### 6.4 提升导入解析能力

可逐步增强：

- 更准确处理相对导入层级
- 支持更多 `from x import *` 的静态推断策略
- 区分标准库与第三方库（可用于分组展示）

## 7. 前后端契约

蓝图模式返回：

`data`:

- `modules`: 蓝图节点定义
- `links`: 蓝图连线定义

其中 `links` 依赖 `item_id` 或 `src_item_id`/`tgt_item_id` 精准匹配 source output 和 target input。

`metadata`:

- `project_name`
- `project_path`
- `python_files`
- `total_nodes`
- `total_edges`
- `node_type_counts`
- `edge_type_counts`

## 8. 错误处理与边界条件

### 8.1 路径校验

- 空路径 -> 400
- 路径不存在 -> 400
- 非目录 -> 400

### 8.2 文件处理

- 大文件（>1MB）跳过
- 编码优先 UTF-8，失败后尝试 GBK
- 语法错误文件跳过（不中断全局）

### 8.3 目录浏览

- 忽略隐藏目录
- Windows 空路径返回盘符列表
- 权限不足目录在返回中自动降级处理

## 9. 性能建议

- 对超大项目可先做目录范围限制
- 优先减少无效边与孤立节点渲染
- 搜索与高亮保持增量更新策略
- 可考虑增加缓存层（按路径 + 文件修改时间）

## 10. 代码风格与贡献规范

建议遵循：

- 解析层与路由层分离，避免业务逻辑进入 API 控制器
- 新增关系必须补齐：模型、解析、蓝图转换、前端过滤、文档
- 避免破坏节点 ID 语义
- 前端交互动作（过滤、搜索、详情、聚焦）保持一致

推荐提交流程：

1. `feature/*` 分支开发
2. 保持单一目标提交
3. PR 描述中包含：改动点、兼容性、截图（如涉及 UI）

## 11. 调试与验证清单

后端：

- 启动服务成功
- 能解析当前仓库
- `metadata` 统计有值
- 过滤 API 返回结构正确

前端（蓝图）：

- 自动布局、搜索、过滤、详情、关系高亮正常
- 双击聚焦、返回全图正常
- 目录浏览：可上级导航、可选择目录

建议手工回归场景：

- 有语法错误文件的项目
- 混合 UTF-8/GBK 文件项目
- 外部依赖较多项目（如 FastAPI、NumPy）

## 12. 后续演进建议

- 增加单元测试与回归样例项目
- 增加函数级调用图开关
- 引入缓存与增量解析
- 提供图谱数据导出（JSON/GraphML）
- 支持按目录/模块的分片分析
