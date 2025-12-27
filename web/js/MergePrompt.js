// 文件路径: ./js/MergePrompt.js

import { app } from "/scripts/app.js";

app.registerExtension({
    name: "sklibs.MergePrompt",
    async nodeCreated(node) {
        if (node.comfyClass !== "MergePrompt") return;

        const countW = node.widgets.find(w => w.name === "提示词接入数量");
        if (!countW) return;

        // 核心函数：根据数量动态增减输入端口
        const ensureInputs = (target) => {
            const minCount = Math.max(2, Number(target) || 2);
            const existing = node.inputs?.map(i => i.name) || [];
            
            // 移除多余的输入端口
            for (let idx = existing.length - 1; idx >= 0; idx--) {
                const name = existing[idx];
                const m = /^提示词_(\d+)$/.exec(name);
                if (!m) continue;
                const n = Number(m[1]);
                if (n > minCount) {
                    node.removeInput(idx);
                }
            }
            
            // 添加缺少的输入端口 (从 1 开始)
            for (let i = 1; i <= minCount; i++) {
                const name = `提示词_${i}`;
                if (!existing.includes(name)) {
                    // 找到应该插入的位置
                    let insertIndex = node.inputs ? node.inputs.length : 0;
                    // 尝试找到最后一个 "提示词_" 端口的位置 + 1，保持顺序
                    for (let j = node.inputs.length - 1; j >= 0; j--) {
                        if (node.inputs[j].name.startsWith("提示词_")) {
                            insertIndex = j + 1;
                            break;
                        }
                    }
                    node.addInput(name, "STRING", null, insertIndex);
                }
            }
            
            node.setSize(node.computeSize());
            node.setDirtyCanvas(true);
        };
        
        // 初始化时确保端口数量正确
        ensureInputs(Number(countW.value || 2));

        const origCb = countW.callback;

        // 修复点：包裹原始回调函数，以兼容 Nodes 2.0 模式下的 widget.options 错误
        countW.callback = (v) => {
            // 1. 调用原始回调函数 (保存值)，使用 try/catch 捕获 Nodes 2.0 错误
            try {
                if (origCb) origCb(v);
            } catch (e) {
                // 捕获并忽略 'options' 错误，确保自定义逻辑能继续执行。
                // 这通常是 ComfyUI 内部 widget 刷新在 Nodes 2.0 中访问不存在属性导致的。
                console.warn("Original ComfyUI widget callback failed, suppressing error:", e);
            }
            
            // 2. 执行我们自己的核心逻辑：更新输入端口
            ensureInputs(Math.max(2, Number(v) || 2));
        };
        
        // 移除冗余的“增加提示词接入数量”按钮（Node 2.0下不建议使用这种冗余按钮）
        // 如果您希望保留此按钮，请将以下代码注释掉或删除：
        let btnIndex = node.widgets.findIndex(w => w.name === "增加提示词接入数量");
        if (btnIndex !== -1) {
            node.widgets.splice(btnIndex, 1);
        }
    }
});