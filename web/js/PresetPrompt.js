import { app } from "../../../scripts/app.js";

// 模式检测 (不变)
const isVueMode = () => !!(window.comfyAPI?.nodeMountService?.isVueNodesMode?.() || app.vueApp);

app.registerExtension({
    name: "sklibs.PresetPrompt",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "PresetPrompt") return;

        // 【改动1】：Nodes 2.0 Vue 组件注册（保持原样，但下面新增清空逻辑）
        if (isVueMode() && app.registerVueWidget) {
            app.registerVueWidget("PresetPrompt", {
                component: "SKPresetWidget",
                props: { reloadApi: "/sklibs/reload_prompts" }
            });
        }

        // 【改动2】：新增代码块 - 在 Vue 模式下清空 LiteGraph widget，防止内置控件渲染导致错位
        // 这一步是解决 prompt_type 标签与下拉框上下堆叠的关键
        if (isVueMode()) {
            const originalOnNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function (...args) {
                if (originalOnNodeCreated) originalOnNodeCreated.apply(this, args);
                
                // ★ 清空 widgets 数组，让 ComfyUI 不渲染任何内置 widget
                this.widgets = [];
                
                // 可选：初始化默认属性值（防止 undefined）
                this.properties = this.properties || {};
                this.properties.prompt_type = this.properties.prompt_type || '';
                this.properties.caption = this.properties.caption || '';
                
                // ★ 确保 Vue 组件能拿到初始值
                this.widgets_values = this.widgets_values || ['', ''];
            };
        }

        // --- 原型劫持实现逻辑同步 ---
        // 【改动3】：在 onNodeCreated 中添加 Vue 模式判断，跳过 LiteGraph widgets 操作
        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function (...args) {
            if (onNodeCreated) onNodeCreated.apply(this, args);
            const node = this;

            // 【改动3】新增：Vue 模式下直接返回，不操作 widgets
            if (isVueMode()) {
                // 由 SKPresetWidget.vue 完全接管 UI 和逻辑
                return;
            }

            // 以下代码仅在 LiteGraph 模式下执行（保持原样）
            const combo = node.widgets.find(w => w.name === "prompt_type");
            const text = node.widgets.find(w => w.name === "caption");

            const loadContent = async (val) => {
                if (!val || val === "无可用预设") return;
                const r = await fetch(`/sklibs/get_prompt_content?name=${encodeURIComponent(val)}&t=${Date.now()}`);
                const data = await r.json();
                if (text && data.prompt !== undefined) {
                    text.value = data.prompt;
                    if (text.callback) text.callback(data.prompt);
                    app.graph.setDirtyCanvas(true);
                }
            };

            if (combo) {
                const oldCb = combo.callback;
                combo.callback = async (v) => {
                    if (oldCb) oldCb.apply(combo, arguments);
                    await loadContent(v);
                };
                
                setTimeout(() => {
                    if (combo.value) loadContent(combo.value);
                }, 10);
            }

            // --- Nodes 1.0 Legacy 刷新按钮 ---
            if (!isVueMode()) {
                node.addWidget("button", "🔄 重新加载预设", "refresh", () => {
                    fetch("/sklibs/reload_prompts", { method: "POST" }).then(async r => {
                        const d = await r.json();
                        if (combo) {
                            combo.options.values = d.names;
                            loadContent(combo.value);
                        }
                    });
                }, { serialize: false });
            }
        };
    }
});