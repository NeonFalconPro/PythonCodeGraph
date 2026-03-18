(function () {
    const COOKIE_KEY = 'codegraph_lang';
    const DEFAULT_LANG = 'zh';

    const messages = {
        zh: {
            common: {
                lang_switch: 'EN',
                switch_mode: '← 返回主页',
                project_path: '项目路径',
                search_node: '🔍 搜索节点',
                node_filter: '节点类型过滤',
                edge_filter: '关系类型过滤',
                layout: '图谱布局',
                stats: '📊 项目统计',
                browse_title: '📂 选择项目文件夹',
                browse_parent: '⬆ 上级',
                browse_select: '✅ 选择此文件夹',
                browse_cancel: '取消',
                start_analyze: '🚀 开始解析',
                fit_view: '📐 自适应视图',
                export_image: '💾 导出图片',
                auto_arrange: '📐 自动排列',
                adapt_view: '🔍 适应视图',
                back_to_full: '↩ 返回全图',
                collapse_sidebar: '折叠侧边栏',
                expand_sidebar: '展开侧边栏',
                path_placeholder: '输入 Python 项目路径...',
                search_placeholder: '输入节点名称搜索...',
                loading: '正在解析项目...',
                no_subdirs: '没有子文件夹',
                stats_project_name: '项目名称',
                stats_python_files: 'Python 文件',
                stats_total_nodes: '节点总数',
                stats_total_edges: '关系总数',
                node_package: '[PKG]🟥 包',
                node_module: '[MOD]🟩 模块',
                node_class: '[CLS]🟨 类',
                node_function: '[FUN]🟩 函数',
                node_method: '[MTH]🟦 方法',
                node_constant: '[CNT]🟪 常量',
                node_external: '[EXT]🟧 外部库',
                edge_imports: '导入',
                edge_inherits: '继承',
                edge_contains: '包含',
                edge_calls: '调用',
                edge_decorates: '装饰',
                edge_instantiates: '实例化',
                edge_uses: '使用',
                type_label: '类型',
                id_label: '标识',
                file_label: '文件',
                defs_label: '定义项',
                refs_label: '引入项',
                related_modules: '关联模块',
                relations_label: '关联关系',
                toast_input_path: '请输入项目路径',
                toast_parse_done: '解析完成: {nodes} 个节点, {edges} 条关系',
                toast_error_prefix: '错误: {message}',
                toast_analyze_first: '请先解析项目',
                toast_export_done: '图片已导出',
                toast_browse_failed: '浏览目录失败: {message}',
                toast_selected_dir: '已选择: {path}',
                toast_select_dir: '请选择一个文件夹',
                search_found: '找到 {count} 个',
                search_none: '无匹配'
            },
            blueprint: {
                title: 'CodeGraph - 蓝图模式',
                page_title: '🔧 蓝图模式',
                subtitle: '基于 LiteGraph.js 的蓝图编辑器',
                welcome_title: '🔧 蓝图模式',
                welcome_desc: '基于 LiteGraph.js 的代码蓝图编辑器',
                step1: '在左侧输入 Python 项目路径',
                step2: '点击"开始解析"生成蓝图',
                step3: '拖拽节点、缩放画布自由探索',
                legend_title: '蓝图节点说明',
                legend_node_title: '节点类型',
                legend_edge_title: '连线颜色',
                detail_title: '节点详情'
            }
        },
        en: {
            common: {
                lang_switch: '中文',
                switch_mode: '← Home',
                project_path: 'Project Path',
                search_node: '🔍 Search Nodes',
                node_filter: 'Node Filters',
                edge_filter: 'Edge Filters',
                layout: 'Graph Layout',
                stats: '📊 Project Stats',
                browse_title: '📂 Select Project Folder',
                browse_parent: '⬆ Parent',
                browse_select: '✅ Select This Folder',
                browse_cancel: 'Cancel',
                start_analyze: '🚀 Analyze',
                fit_view: '📐 Fit View',
                export_image: '💾 Export Image',
                auto_arrange: '📐 Auto Arrange',
                adapt_view: '🔍 Fit Canvas',
                back_to_full: '↩ Back to Full Graph',
                collapse_sidebar: 'Collapse Sidebar',
                expand_sidebar: 'Expand Sidebar',
                path_placeholder: 'Enter Python project path...',
                search_placeholder: 'Search by node name...',
                loading: 'Analyzing project...',
                no_subdirs: 'No subfolders',
                stats_project_name: 'Project',
                stats_python_files: 'Python Files',
                stats_total_nodes: 'Total Nodes',
                stats_total_edges: 'Total Edges',
                node_package: '📦 Package',
                node_module: '📄 Module',
                node_class: '🏷️ Class',
                node_function: '⚡ Function',
                node_method: '🔧 Method',
                node_constant: '📌 Constant',
                node_external: '🔗 External',
                edge_imports: 'Import',
                edge_inherits: 'Inherit',
                edge_contains: 'Contain',
                edge_calls: 'Call',
                edge_decorates: 'Decorate',
                edge_instantiates: 'Instantiate',
                edge_uses: 'Use',
                type_label: 'Type',
                id_label: 'ID',
                file_label: 'File',
                defs_label: 'Definitions',
                refs_label: 'References',
                related_modules: 'Related Modules',
                relations_label: 'Relations',
                toast_input_path: 'Please input a project path',
                toast_parse_done: 'Done: {nodes} nodes, {edges} edges',
                toast_error_prefix: 'Error: {message}',
                toast_analyze_first: 'Please analyze first',
                toast_export_done: 'Image exported',
                toast_browse_failed: 'Browse failed: {message}',
                toast_selected_dir: 'Selected: {path}',
                toast_select_dir: 'Please select a folder',
                search_found: '{count} found',
                search_none: 'No match'
            },
            blueprint: {
                title: 'CodeGraph - Blueprint Mode',
                page_title: '🔧 Blueprint Mode',
                subtitle: 'LiteGraph.js blueprint editor',
                welcome_title: '🔧 Blueprint Mode',
                welcome_desc: 'Code blueprint editor powered by LiteGraph.js',
                step1: 'Input a Python project path on the left',
                step2: 'Click analyze to build blueprint',
                step3: 'Drag nodes and zoom to explore freely',
                legend_title: 'Blueprint Legend',
                legend_node_title: 'Node Types',
                legend_edge_title: 'Edge Colors',
                detail_title: 'Node Details'
            }
        }
    };

    function setCookie(name, value, days) {
        const maxAge = days * 24 * 60 * 60;
        document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${maxAge}`;
    }

    function getCookie(name) {
        const parts = document.cookie.split(';').map(s => s.trim());
        for (const part of parts) {
            if (part.startsWith(name + '=')) {
                return decodeURIComponent(part.substring(name.length + 1));
            }
        }
        return '';
    }

    function getLang() {
        const raw = getCookie(COOKIE_KEY);
        return raw === 'en' || raw === 'zh' ? raw : DEFAULT_LANG;
    }

    function setLang(lang) {
        const normalized = lang === 'en' ? 'en' : 'zh';
        setCookie(COOKIE_KEY, normalized, 365);
        applyI18n(normalized);
        const evt = new CustomEvent('codegraph:lang-changed', { detail: { lang: normalized } });
        window.dispatchEvent(evt);
    }

    function getByPath(obj, path) {
        return path.split('.').reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : undefined), obj);
    }

    function t(key, vars) {
        const lang = getLang();
        let value = getByPath(messages[lang], key);
        if (value === undefined) {
            value = getByPath(messages[DEFAULT_LANG], key);
        }
        if (typeof value !== 'string') {
            return key;
        }
        if (!vars) return value;
        return value.replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? String(vars[k]) : ''));
    }

    function applyI18n(lang) {
        const currentLang = lang || getLang();
        const html = document.documentElement;
        html.lang = currentLang === 'en' ? 'en' : 'zh-CN';

        document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.getAttribute('data-i18n');
            el.textContent = t(key);
        });

        document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
            const key = el.getAttribute('data-i18n-placeholder');
            el.setAttribute('placeholder', t(key));
        });

        document.querySelectorAll('[data-i18n-title]').forEach(el => {
            const key = el.getAttribute('data-i18n-title');
            el.setAttribute('title', t(key));
        });

        document.querySelectorAll('[data-i18n-html]').forEach(el => {
            const key = el.getAttribute('data-i18n-html');
            el.innerHTML = t(key);
        });

        const titleKey = document.body.getAttribute('data-i18n-title-key');
        if (titleKey) {
            document.title = t(titleKey);
        }

        const langToggle = document.getElementById('langToggle');
        if (langToggle) {
            langToggle.textContent = t('common.lang_switch');
            langToggle.setAttribute('aria-label', 'language switch');
            langToggle.setAttribute('title', 'language switch');
        }
    }

    function setupLanguageToggle(buttonId) {
        const btn = document.getElementById(buttonId || 'langToggle');
        if (!btn) return;
        btn.addEventListener('click', () => {
            const next = getLang() === 'zh' ? 'en' : 'zh';
            setLang(next);
        });
        applyI18n(getLang());
    }

    window.CodeGraphI18n = {
        t,
        getLang,
        setLang,
        applyI18n,
        setupLanguageToggle,
    };

    document.addEventListener('DOMContentLoaded', () => {
        applyI18n(getLang());
    });
})();
