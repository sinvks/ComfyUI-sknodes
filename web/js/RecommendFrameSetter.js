import { app } from "/scripts/app.js";

app.registerExtension({
    name: "sklibs.RecommendFrameSetter",
    async nodeCreated(node) {
        if (node.comfyClass !== "RecommendFrameSetter") return;

        const minW = node.widgets.find(w => w.name === "窗口帧数最小值");
        const maxW = node.widgets.find(w => w.name === "窗口帧数最大值");
        if (!minW || !maxW) return;

        const origMinCb = minW.callback;
        const origMaxCb = maxW.callback;

        minW.callback = (v) => {
            if (origMinCb) origMinCb(v);
            const vMin = Number(minW.value ?? v ?? 0);
            const vMax = Number(maxW.value ?? 0);
            if (vMin > vMax) {
                maxW.value = vMin;
                if (origMaxCb) origMaxCb(maxW.value);
            }
            node.setDirtyCanvas(true);
        };

        maxW.callback = (v) => {
            if (origMaxCb) origMaxCb(v);
            node.setDirtyCanvas(true);
        };

        if (typeof minW.value !== "undefined") {
            minW.callback(minW.value);
        }
    }
});
