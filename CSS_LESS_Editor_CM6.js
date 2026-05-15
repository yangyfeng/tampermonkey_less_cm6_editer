// ==UserScript==
// @name         CSS/LESS 编辑器 CM6
// @namespace    http://tampermonkey/
// @version      12.2
// @description  CodeMirror 6 CSS/LESS 编辑器，支持格式化、搜索替换、语法错误提示、点击预览注入页面
// @match        *://*/*
// @grant        none
// @run-at       document-idle
// @require      https://cdn.jsdelivr.net/npm/less/dist/less.min.js
// ==/UserScript==

(async function () {
    'use strict';

    const APP_KEY = 'tm-css-less-cm6';
    const ROOT_ID = `${APP_KEY}-root`;
    const STYLE_ID = `${APP_KEY}-style`;

    const currentHost = location.hostname.toLowerCase();

    const storage = {
        get(key, fallback = '') {
            try {
                return localStorage.getItem(key) ?? fallback;
            } catch {
                return fallback;
            }
        },
        set(key, value) {
            try {
                localStorage.setItem(key, value);
            } catch { }
        },
        remove(key) {
            try {
                localStorage.removeItem(key);
            } catch { }
        }
    };

    function normalizeHost(input) {
        const value = String(input || '').trim();
        if (!value) return '';

        try {
            return new URL(value.includes('://') ? value : `https://${value}`).hostname.toLowerCase();
        } catch {
            return value.replace(/^https?:\/\//, '').split('/')[0].toLowerCase();
        }
    }

    function hostMatches(host, target) {
        return host === target || host.endsWith(`.${target}`);
    }

    let targetHost = normalizeHost(storage.get(`${APP_KEY}:targetHost`));

    if (!targetHost) {
        const input = prompt('请输入生效网站域名，例如：baidu.com', currentHost);
        targetHost = normalizeHost(input);

        if (!targetHost) return;

        storage.set(`${APP_KEY}:targetHost`, targetHost);
        alert('已保存，刷新页面后生效');
        location.reload();
        return;
    }

    if (!hostMatches(currentHost, targetHost)) return;

    const draftKey = `${APP_KEY}:${targetHost}:draft`;
    const appliedCssKey = `${APP_KEY}:${targetHost}:appliedCss`;
    const panelStateKey = `${APP_KEY}:${targetHost}:panelState`;
    const autoApplyKey = `${APP_KEY}:${targetHost}:autoApplyEdited`;

    let editor = null;
    let openSearchPanelApi = null;
    let forceLintingApi = null;
    let prettierCache = null;

    let styleTag = document.getElementById(STYLE_ID);

    if (!styleTag) {
        styleTag = document.createElement('style');
        styleTag.id = STYLE_ID;
        document.head.appendChild(styleTag);
    }

    // 未开启自动应用时，刷新只回显编辑框草稿，不向页面注入样式。
    const shouldAutoApplyEdited = storage.get(autoApplyKey, '0') === '1';
    const savedDraftCode = storage.get(draftKey);

    if (shouldAutoApplyEdited && savedDraftCode.trim() && window.less?.render) {
        try {
            const output = await window.less.render(savedDraftCode, {
                javascriptEnabled: false
            });

            styleTag.textContent = output.css;
            storage.set(appliedCssKey, output.css);
        } catch {
            styleTag.textContent = '';
        }
    } else {
        styleTag.textContent = '';
    }

    document.getElementById(ROOT_ID)?.remove();

    const rootHost = document.createElement('div');
    rootHost.id = ROOT_ID;
    document.documentElement.appendChild(rootHost);

    const shadow = rootHost.attachShadow({ mode: 'open' });

    const uiStyle = document.createElement('style');
    uiStyle.textContent = `
        :host {
            all: initial;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }

        * {
            box-sizing: border-box;
        }

        .toggle {
            position: fixed;
            z-index: 2147483647;
            top: 12px;
            right: 12px;
            width: 42px;
            height: 42px;
            border: 0;
            border-radius: 50%;
            background: #12c35c;
            color: #06130a;
            font-size: 13px;
            font-weight: 700;
            cursor: pointer;
            box-shadow: 0 4px 14px rgba(0, 0, 0, 0.32);
        }

        .panel {
            position: fixed;
            z-index: 2147483647;
            top: 70px;
            right: 20px;
            width: 540px;
            height: 580px;
            min-width: 360px;
            min-height: 320px;
            display: none;
            flex-direction: column;
            overflow: hidden;
            resize: both;
            background: #1e1e1e;
            border: 1px solid #3a3a3a;
            border-radius: 8px;
            box-shadow: 0 12px 36px rgba(0, 0, 0, 0.48);
        }

        .panel.is-open {
            display: flex;
        }

        .header {
            height: 40px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            padding: 0 12px;
            background: #2b2b2b;
            color: #f1f1f1;
            font-size: 13px;
            cursor: move;
            user-select: none;
            flex: 0 0 auto;
        }

        .title {
            overflow: hidden;
            white-space: nowrap;
            text-overflow: ellipsis;
        }

        .close {
            width: 28px;
            height: 28px;
            border: 0;
            border-radius: 4px;
            background: transparent;
            color: #ff7373;
            font-size: 22px;
            line-height: 1;
            cursor: pointer;
        }

        .close:hover {
            background: rgba(255, 115, 115, 0.12);
        }

        .editor {
            flex: 1 1 auto;
            min-height: 0;
        }

        .bar {
            flex: 0 0 auto;
            display: grid;
            grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr) minmax(0, 0.9fr) minmax(0, 0.72fr);
            grid-template-areas:
                "status status status status"
                "auto preview cancel clear";
            align-items: stretch;
            gap: 8px;
            padding: 10px;
            background: #242424;
            border-top: 1px solid #343434;
        }

        .btn {
            min-width: 0;
            height: 42px;
            display: flex;
            align-items: center;
            justify-content: center;
            border: 0;
            border-radius: 6px;
            padding: 0 10px;
            color: #101010;
            font-size: 13px;
            font-weight: 700;
            cursor: pointer;
            white-space: nowrap;
        }

        .btn:hover {
            filter: brightness(1.08);
        }

        .btn:disabled {
            cursor: not-allowed;
            opacity: 0.6;
            filter: none;
        }

        .btn-preview {
            grid-area: preview;
            background: #12c35c;
        }

        .btn-clear {
            grid-area: clear;
            background: #e55353;
            color: #fff;
        }

        .btn-cancel {
            grid-area: cancel;
            background: #555;
            color: #fff;
        }

        .auto-apply-toggle {
            grid-area: auto;
            min-width: 0;
            height: 42px;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 2px;
            border: 1px solid #4a4a4a;
            border-radius: 6px;
            padding: 0 10px;
            background: #303030;
            color: #f1f1f1;
            cursor: pointer;
            user-select: none;
        }

        .auto-apply-toggle:hover {
            border-color: #6a6a6a;
            background: #383838;
        }

        .auto-apply-toggle.is-on {
            border-color: #12c35c;
            background: #123d25;
            color: #e9fff1;
        }

        .auto-apply-toggle.is-on:hover {
            border-color: #35df78;
            background: #164d2e;
        }

        .auto-apply-toggle-label {
            max-width: 100%;
            overflow: hidden;
            white-space: nowrap;
            text-overflow: ellipsis;
            font-size: 12px;
            font-weight: 700;
            line-height: 1.15;
        }

        .auto-apply-toggle-state {
            max-width: 100%;
            overflow: hidden;
            white-space: nowrap;
            text-overflow: ellipsis;
            color: #bdbdbd;
            font-size: 11px;
            line-height: 1.15;
        }

        .auto-apply-toggle.is-on .auto-apply-toggle-state {
            color: #9ff0bd;
        }

        .status {
            grid-area: status;
            min-width: 0;
            height: 24px;
            display: flex;
            align-items: center;
            overflow: hidden;
            white-space: nowrap;
            text-overflow: ellipsis;
            padding: 0 8px;
            border: 1px solid #343434;
            border-radius: 5px;
            background: #1c1c1c;
            color: #bdbdbd;
            font-size: 12px;
        }

        .status.error {
            color: #ff8b8b;
        }

        .cm-editor {
            height: 100%;
            font-size: 13px;
        }

        .cm-scroller {
            font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
        }

        .cm-focused {
            outline: none !important;
        }

        .context-menu {
            position: fixed;
            z-index: 2147483647;
            min-width: 140px;
            display: none;
            padding: 4px;
            background: #252525;
            border: 1px solid #454545;
            border-radius: 6px;
            box-shadow: 0 8px 24px rgba(0, 0, 0, 0.42);
        }

        .context-menu.is-open {
            display: block;
        }

        .context-menu button {
            width: 100%;
            height: 30px;
            display: block;
            padding: 0 10px;
            border: 0;
            border-radius: 4px;
            background: transparent;
            color: #f1f1f1;
            text-align: left;
            font-size: 13px;
            cursor: pointer;
        }

        .context-menu button:hover {
            background: #3a3a3a;
        }
    `;
    shadow.appendChild(uiStyle);

    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'toggle';
    toggleBtn.type = 'button';
    toggleBtn.textContent = 'CSS';
    toggleBtn.title = '左键打开编辑器，右键重设生效网站';

    const panel = document.createElement('div');
    panel.className = 'panel';

    const savedPanelState = (() => {
        try {
            return JSON.parse(storage.get(panelStateKey, '{}')) || {};
        } catch {
            return {};
        }
    })();

    if (savedPanelState.left != null) panel.style.left = `${savedPanelState.left}px`;
    if (savedPanelState.top != null) panel.style.top = `${savedPanelState.top}px`;
    if (savedPanelState.width) panel.style.width = `${savedPanelState.width}px`;
    if (savedPanelState.height) panel.style.height = `${savedPanelState.height}px`;
    if (savedPanelState.left != null) panel.style.right = 'auto';

    const header = document.createElement('div');
    header.className = 'header';

    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = `CM6 CSS/LESS 编辑器 - ${targetHost}`;

    const closeBtn = document.createElement('button');
    closeBtn.className = 'close';
    closeBtn.type = 'button';
    closeBtn.textContent = '×';
    closeBtn.title = '关闭';

    header.append(title, closeBtn);

    const cmContainer = document.createElement('div');
    cmContainer.className = 'editor';

    const bar = document.createElement('div');
    bar.className = 'bar';

    const status = document.createElement('div');
    status.className = 'status';
    status.textContent = '加载中';

    const autoApplyButton = document.createElement('button');
    autoApplyButton.className = 'auto-apply-toggle';
    autoApplyButton.type = 'button';
    autoApplyButton.title = '切换刷新后是否自动应用当前编辑框草稿';

    const autoApplyLabel = document.createElement('span');
    autoApplyLabel.className = 'auto-apply-toggle-label';
    autoApplyLabel.textContent = '刷新自动应用';

    const autoApplyState = document.createElement('span');
    autoApplyState.className = 'auto-apply-toggle-state';

    autoApplyButton.append(autoApplyLabel, autoApplyState);

    const btnPreview = document.createElement('button');
    btnPreview.className = 'btn btn-preview';
    btnPreview.type = 'button';
    btnPreview.textContent = '预览生效';

    const btnCancelApply = document.createElement('button');
    btnCancelApply.className = 'btn btn-cancel';
    btnCancelApply.type = 'button';
    btnCancelApply.textContent = '取消应用';

    const btnClear = document.createElement('button');
    btnClear.className = 'btn btn-clear';
    btnClear.type = 'button';
    btnClear.textContent = '清空';

    bar.append(status, autoApplyButton, btnPreview, btnCancelApply, btnClear);
    panel.append(header, cmContainer, bar);

    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.innerHTML = `
        <button type="button" data-action="format">格式化</button>
        <button type="button" data-action="search">搜索 / 替换</button>
        <button type="button" data-action="lint">检查语法</button>
        <button type="button" data-action="preview">预览生效</button>
        <button type="button" data-action="cancelApply">取消应用</button>
        <button type="button" data-action="clear">清空</button>
    `;

    shadow.append(toggleBtn, panel, menu);

    function setStatus(text, isError = false) {
        status.textContent = text;
        status.classList.toggle('error', isError);
    }

    function setAutoApplyEnabled(enabled) {
        storage.set(autoApplyKey, enabled ? '1' : '0');
        autoApplyButton.classList.toggle('is-on', enabled);
        autoApplyState.textContent = enabled ? '已开启' : '已关闭';
        autoApplyButton.setAttribute('aria-pressed', enabled ? 'true' : 'false');
    }

    setAutoApplyEnabled(shouldAutoApplyEdited);

    function savePanelState() {
        const rect = panel.getBoundingClientRect();

        storage.set(panelStateKey, JSON.stringify({
            left: Math.max(0, Math.round(rect.left)),
            top: Math.max(0, Math.round(rect.top)),
            width: Math.round(rect.width),
            height: Math.round(rect.height)
        }));
    }

    function togglePanel(forceOpen) {
        const shouldOpen = typeof forceOpen === 'boolean'
            ? forceOpen
            : !panel.classList.contains('is-open');

        panel.classList.toggle('is-open', shouldOpen);

        if (shouldOpen && editor) {
            requestAnimationFrame(() => editor.focus());
        }
    }

    function showMenu(event) {
        event.preventDefault();

        const maxLeft = window.innerWidth - 150;
        const maxTop = window.innerHeight - 170;

        menu.style.left = `${Math.max(4, Math.min(event.clientX, maxLeft))}px`;
        menu.style.top = `${Math.max(4, Math.min(event.clientY, maxTop))}px`;
        menu.classList.add('is-open');
    }

    function hideMenu() {
        menu.classList.remove('is-open');
    }

    async function loadCM6() {
        const [
            cm,
            viewMod,
            langLess,
            oneDarkTheme,
            searchMod,
            lintMod,
            languageMod
        ] = await Promise.all([
            import('https://esm.sh/codemirror'),
            import('https://esm.sh/@codemirror/view'),
            import('https://esm.sh/@codemirror/lang-less'),
            import('https://esm.sh/@codemirror/theme-one-dark'),
            import('https://esm.sh/@codemirror/search'),
            import('https://esm.sh/@codemirror/lint'),
            import('https://esm.sh/@codemirror/language')
        ]);

        return {
            EditorView: viewMod.EditorView,
            keymap: viewMod.keymap,
            basicSetup: cm.basicSetup,
            less: langLess.less,
            oneDark: oneDarkTheme.oneDark,
            search: searchMod.search,
            searchKeymap: searchMod.searchKeymap,
            openSearchPanel: searchMod.openSearchPanel,
            linter: lintMod.linter,
            lintGutter: lintMod.lintGutter,
            lintKeymap: lintMod.lintKeymap,
            forceLinting: lintMod.forceLinting,
            syntaxTree: languageMod.syntaxTree,
            ensureSyntaxTree: languageMod.ensureSyntaxTree
        };
    }

    async function loadPrettier() {
        if (prettierCache) return prettierCache;

        const [prettierMod, postcssMod] = await Promise.all([
            import('https://esm.sh/prettier@3/standalone'),
            import('https://esm.sh/prettier@3/plugins/postcss')
        ]);

        prettierCache = {
            prettier: prettierMod.default || prettierMod,
            postcss: postcssMod.default || postcssMod
        };

        return prettierCache;
    }

    async function formatCode() {
        if (!editor) return;

        setStatus('格式化中');

        try {
            const { prettier, postcss } = await loadPrettier();
            const code = editor.state.doc.toString();

            const formatted = await prettier.format(code, {
                parser: 'less',
                plugins: [postcss],
                tabWidth: 2,
                printWidth: 100,
                singleQuote: false
            });

            const cursor = Math.min(editor.state.selection.main.head, formatted.length);

            editor.dispatch({
                changes: {
                    from: 0,
                    to: editor.state.doc.length,
                    insert: formatted
                },
                selection: {
                    anchor: cursor
                }
            });

            setStatus('已格式化');
        } catch (error) {
            setStatus(`格式化失败：${error?.message || error}`, true);
        }
    }

    function createLessLinter({ syntaxTree, ensureSyntaxTree }) {
        function collectSyntaxErrors(view) {
            const diagnostics = [];
            const state = view.state;
            const tree = ensureSyntaxTree(state, state.doc.length, 500) || syntaxTree(state);
            const cursor = tree.cursor();

            do {
                if (!cursor.type.isError) continue;

                diagnostics.push({
                    from: cursor.from,
                    to: Math.max(cursor.from + 1, cursor.to),
                    severity: 'error',
                    message: 'CSS/LESS 语法结构错误'
                });
            } while (cursor.next());

            return diagnostics;
        }

        return async function lessLintSource(view) {
            const code = view.state.doc.toString();
            const diagnostics = collectSyntaxErrors(view);

            if (!code.trim() || !window.less?.render) {
                return diagnostics;
            }

            try {
                await window.less.render(code, {
                    javascriptEnabled: false
                });

                return diagnostics;
            } catch (error) {
                const lineNo = Math.max(1, Number(error?.line) || 1);
                const columnNo = Math.max(0, Number(error?.column) || 0);
                const line = view.state.doc.line(Math.min(lineNo, view.state.doc.lines));
                const from = Math.min(line.from + columnNo, line.to);

                diagnostics.push({
                    from,
                    to: Math.min(from + 1, line.to),
                    severity: 'error',
                    message: `LESS 编译错误：${error?.message || error?.type || '未知错误'}`
                });

                return diagnostics;
            }
        };
    }

    async function applyCode() {
        if (!editor) return;

        const code = editor.state.doc.toString();
        storage.set(draftKey, code);

        btnPreview.disabled = true;
        setStatus('编译中');

        try {
            if (!window.less?.render) {
                throw new Error('LESS 编译器未加载');
            }

            const output = await window.less.render(code, {
                javascriptEnabled: false
            });

            styleTag.textContent = output.css;
            storage.set(appliedCssKey, output.css);
            setStatus('已生效');
        } catch (error) {
            setStatus(`预览失败：${error?.message || error}`, true);
        } finally {
            btnPreview.disabled = false;
        }
    }

    toggleBtn.addEventListener('click', () => togglePanel());
    closeBtn.addEventListener('pointerdown', (event) => event.stopPropagation());
    closeBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        togglePanel(false);
    });

    toggleBtn.addEventListener('contextmenu', (event) => {
        event.preventDefault();

        const nextHost = normalizeHost(prompt('重新设置生效网站域名', targetHost));
        if (!nextHost) return;

        storage.set(`${APP_KEY}:targetHost`, nextHost);
        alert('已保存，刷新页面后生效');
        location.reload();
    });

    let dragging = false;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;

    header.addEventListener('pointerdown', (event) => {
        if (event.button !== 0 || event.target === closeBtn) return;

        const rect = panel.getBoundingClientRect();

        dragging = true;
        startX = event.clientX;
        startY = event.clientY;
        startLeft = rect.left;
        startTop = rect.top;

        panel.style.left = `${rect.left}px`;
        panel.style.top = `${rect.top}px`;
        panel.style.right = 'auto';

        header.setPointerCapture(event.pointerId);
        event.preventDefault();
    });

    header.addEventListener('pointermove', (event) => {
        if (!dragging) return;

        const nextLeft = Math.min(
            Math.max(0, startLeft + event.clientX - startX),
            window.innerWidth - 80
        );
        const nextTop = Math.min(
            Math.max(0, startTop + event.clientY - startY),
            window.innerHeight - 60
        );

        panel.style.left = `${nextLeft}px`;
        panel.style.top = `${nextTop}px`;
    });

    header.addEventListener('pointerup', (event) => {
        if (!dragging) return;

        dragging = false;
        header.releasePointerCapture(event.pointerId);
        savePanelState();
    });

    new ResizeObserver(() => {
        if (panel.classList.contains('is-open')) savePanelState();
    }).observe(panel);

    cmContainer.addEventListener('contextmenu', showMenu);

    shadow.addEventListener('pointerdown', (event) => {
        if (!menu.contains(event.target)) hideMenu();
    });

    window.addEventListener('blur', hideMenu);

    menu.addEventListener('click', async (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;

        const action = target.dataset.action;
        hideMenu();

        if (action === 'format') await formatCode();
        if (action === 'search' && editor && openSearchPanelApi) openSearchPanelApi(editor);
        if (action === 'lint' && editor && forceLintingApi) forceLintingApi(editor);
        if (action === 'preview') applyCode();
        if (action === 'cancelApply') btnCancelApply.click();
        if (action === 'clear') btnClear.click();
    });

    btnPreview.addEventListener('click', applyCode);

    autoApplyButton.addEventListener('click', () => {
        const enabled = storage.get(autoApplyKey, '0') !== '1';
        setAutoApplyEnabled(enabled);
        setStatus(enabled ? '刷新后自动应用' : '刷新后不自动应用');
    });

    btnCancelApply.addEventListener('click', () => {
        styleTag.textContent = '';
        storage.remove(appliedCssKey);

        // 取消应用时同步关闭刷新自动应用，避免刷新后草稿又被重新注入。
        setAutoApplyEnabled(false);

        setStatus('已取消应用，草稿保留');
    });

    btnClear.addEventListener('click', () => {
        if (editor) {
            editor.dispatch({
                changes: {
                    from: 0,
                    to: editor.state.doc.length,
                    insert: ''
                }
            });
        }

        styleTag.textContent = '';
        storage.remove(draftKey);
        storage.remove(appliedCssKey);
        setStatus('已清空');
    });

    try {
        const {
            EditorView,
            keymap,
            basicSetup,
            less,
            oneDark,
            search,
            searchKeymap,
            openSearchPanel,
            linter,
            lintGutter,
            lintKeymap,
            forceLinting,
            syntaxTree,
            ensureSyntaxTree
        } = await loadCM6();

        openSearchPanelApi = openSearchPanel;
        forceLintingApi = forceLinting;

        editor = new EditorView({
            parent: cmContainer,
            root: shadow,
            doc: storage.get(draftKey),
            extensions: [
                basicSetup,
                less(),
                oneDark,
                search({ top: true }),
                lintGutter(),
                linter(createLessLinter({ syntaxTree, ensureSyntaxTree }), {
                    delay: 700
                }),
                keymap.of([
                    ...searchKeymap,
                    ...lintKeymap
                ]),
                EditorView.lineWrapping,
                EditorView.updateListener.of((update) => {
                    if (!update.docChanged) return;

                    storage.set(draftKey, update.state.doc.toString());
                    setStatus('草稿已保存');
                }),
                EditorView.domEventHandlers({
                    keydown(event) {
                        event.stopPropagation();

                        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                            event.preventDefault();
                            applyCode();
                            return true;
                        }

                        if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'f') {
                            event.preventDefault();
                            formatCode();
                            return true;
                        }

                        return false;
                    }
                })
            ]
        });

        setStatus('就绪');
    } catch (error) {
        setStatus(`CM6 加载失败：${error?.message || error}`, true);
    }
})();
