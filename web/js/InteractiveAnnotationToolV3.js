import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

// --- 样式定义 ---
const style = document.createElement('style');
style.innerHTML = `
    .sk-v3-mask {
        position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
        background: rgba(0,0,0,0.9); z-index: 10001;
        display: none; flex-direction: column; align-items: center; justify-content: center;
        font-family: sans-serif;
    }
    .sk-v3-editor-container {
        position: relative; background: #111; border: 2px solid #444; box-shadow: 0 0 50px rgba(0,0,0,0.8);
        display: flex; flex-direction: column;
    }
    .sk-v3-canvas-wrapper { position: relative; overflow: hidden; background: #000; cursor: none; }
    .sk-v3-canvas-wrapper canvas { position: absolute; top: 0; left: 0; pointer-events: none; }
    .sk-v3-canvas-wrapper #v3_canvas_points { pointer-events: auto; }
    .sk-v3-toolbar { 
        padding: 15px; background: #222; display: flex; gap: 20px; align-items: center;
        border-bottom: 1px solid #333; color: white;
    }
    .sk-v3-group { display: flex; align-items: center; gap: 8px; border-right: 1px solid #444; padding-right: 15px; }
    .sk-v3-btn { padding: 6px 12px; cursor: pointer; border-radius: 4px; border: 1px solid #555; background: #333; color: #eee; font-weight: bold; font-size: 13px; }
    .sk-v3-btn:hover { background: #444; border-color: #777; }
    .sk-v3-btn.active { background: #3a6ea5; border-color: #4a90e2; }
    .sk-v3-btn.save { background: #28a745; border-color: #34ce57; }
    .sk-v3-btn.clear { background: #dc3545; border-color: #ff4d4d; }
    .sk-v3-btn.close { background: #6c757d; border-color: #888; }
    .sk-v3-status { position: absolute; bottom: 10px; right: 15px; color: #888; font-size: 11px; pointer-events: none; }
    .sk-v3-color-dot { width: 18px; height: 18px; border-radius: 50%; border: 2px solid transparent; cursor: pointer; }
    .sk-v3-color-dot.active { border-color: white; transform: scale(1.2); }
`;
document.head.appendChild(style);

app.registerExtension({
    name: "CloserAI.InteractiveAnnotationTool.V3",
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name === "InteractiveAnnotationToolV3") {
            
            // 页面加载时恢复数据
            nodeType.prototype.onConfigure = function(config) {
                if (this.widgets) {
                    const pw = this.widgets.find(w => w.name === "points_data");
                    const mw = this.widgets.find(w => w.name === "mask_data");
                    const imgW = this.widgets.find(w => w.name === "image");

                    // 优先从序列化的 config 或 widget value 中恢复
                    let pData = pw ? pw.value : null;
                    if (!pData && this.properties) pData = this.properties["points_data"];
                    
                    if (pData) {
                        try {
                            const parsed = JSON.parse(pData);
                            // 关键：如果读取到的是整数像素坐标，需要转换回归一化坐标供节点内部渲染
                            const isPixel = parsed.length > 0 && parsed.some(p => p.x > 1.0 || p.y > 1.0);
                            if (isPixel) {
                                this._pending_pixel_points = parsed;
                            } else {
                                this.points = parsed;
                            }
                        } catch (e) {
                            console.error("SK-Nodes-V3: Failed to parse points_data", e);
                            this.points = [];
                        }
                    }

                    if (mw && mw.value) {
                        this.setProperty("mask_data", mw.value);
                    }

                    // 恢复图片显示
                    if (imgW && imgW.value) {
                        this.loadNodeImage(imgW.value);
                    }
                }
                this.syncAll();
            };

            nodeType.prototype.onNodeCreated = function() {
                this.points = [];
                this.img = null;
                this.mask_img = null; 
                this.img_name = "";
                this.size = [400, 460]; // 稍微调小默认高度
                this.draggingPoint = null;

                // 彻底隐藏 Widget 的方案：使用 converted-widget 类型
                // 这种类型在 Nodes 2.0 和传统模式下都会被视为“已转换”，从而不占用渲染空间
                const hideWidget = (name) => {
                    const w = this.widgets.find(x => x.name === name);
                    if (w) {
                        w.type = "converted-widget";
                        w.hidden = true;
                    }
                };
                hideWidget("points_data");
                hideWidget("mask_data");

                const imageWidget = this.widgets.find(w => w.name === "image");
                if (imageWidget) {
                    const self = this;
                    const orgCallback = imageWidget.callback;
                    imageWidget.callback = function(v) {
                        if (orgCallback) orgCallback.apply(this, arguments);
                        if (v && v !== self.img_name) {
                            self.points = [];
                            self.mask_img = null;
                            const mw = self.widgets.find(w => w.name === "mask_data");
                            if (mw) mw.value = "";
                            self.setProperty("mask_data", "");
                            const pw = self.widgets.find(w => w.name === "points_data");
                            if (pw) pw.value = "[]";
                            self.setProperty("points_data", "[]");
                            self.img_name = v;
                            self.loadNodeImage(v);
                            self.syncAll();
                        }
                    };
                }

                this.addWidget("button", "🖼️ 进入标注编辑器V3", null, () => this.openEditor());
                this.addWidget("button", "🗑️ 清空所有数据", null, () => {
                    this.points = [];
                    const mw = this.widgets.find(w => w.name === "mask_data");
                    if (mw) { mw.value = ""; this.setProperty("mask_data", ""); }
                    this.mask_img = null;
                    this.syncAll();
                });
            };

            nodeType.prototype.loadNodeImage = function(name) {
                if (!name) return;
                const url = api.apiURL(`/view?filename=${encodeURIComponent(name)}&type=input&t=${Date.now()}`);
                const img = new Image();
                img.src = url;
                img.onload = () => { 
                    this.img = img; 
                    this.imgs = [img]; 
                    if (this._pending_pixel_points && img.naturalWidth > 0) {
                        this.points = this._pending_pixel_points.map(p => ({
                            x: p.x / img.naturalWidth,
                            y: p.y / img.naturalHeight
                        }));
                        delete this._pending_pixel_points;
                    }
                    this.setDirtyCanvas(true);
                    if (app.canvas && app.canvas.graph_canvas) app.canvas.graph_canvas.setDirty(true, true);
                };
            };

            nodeType.prototype.syncAll = function() {
                const pw = this.widgets.find(w => w.name === "points_data");
                const mw = this.widgets.find(w => w.name === "mask_data");
                
                let pixelPoints = [];
                if (this.points && this.points.length > 0) {
                    if (this.img && this.img.naturalWidth > 0) {
                        pixelPoints = this.points.map(p => ({
                            x: Math.round(p.x * this.img.naturalWidth),
                            y: Math.round(p.y * this.img.naturalHeight)
                        }));
                    } else {
                        // 如果图片还没加载好，但已有归一化坐标，暂时维持现状
                        pixelPoints = this.points; 
                    }
                } else if (this._pending_pixel_points) {
                    // 关键：如果正在等待图片加载以转换坐标，不要覆盖掉原始像素坐标
                    pixelPoints = this._pending_pixel_points;
                }

                const pointsJson = JSON.stringify(pixelPoints);
                const maskData = (mw ? mw.value : null) || this.properties["mask_data"] || "";
                
                if (pw) {
                    pw.value = pointsJson;
                    this.setProperty("points_data", pointsJson);
                    if (pw.callback) pw.callback(pointsJson);
                }
                if (mw) {
                    mw.value = maskData;
                    this.setProperty("mask_data", maskData);
                    if (mw.callback) mw.callback(maskData);
                }

                if (this.widgets && this.widgets_values) {
                    const pwIdx = this.widgets.findIndex(w => w.name === "points_data");
                    if (pwIdx !== -1) this.widgets_values[pwIdx] = pointsJson;
                    const mwIdx = this.widgets.findIndex(w => w.name === "mask_data");
                    if (mwIdx !== -1) this.widgets_values[mwIdx] = maskData;
                }

                if (app.graph) {
                    app.graph._version++; 
                    if (app.graph.setDirtyCanvas) app.graph.setDirtyCanvas(true, true);
                }
                if (app.canvas && app.canvas.setDirty) app.canvas.setDirty(true, true);

                if (maskData && maskData.startsWith("data:image")) {
                    if (!this.mask_img || this.mask_img._base64 !== maskData) {
                        const mImg = new Image();
                        mImg.onload = () => {
                            this.mask_img = mImg;
                            this.mask_img._base64 = maskData;
                            this.setDirtyCanvas(true);
                        };
                        mImg.src = maskData;
                    }
                } else {
                    this.mask_img = null;
                }
                this.setDirtyCanvas(true);
            };

            nodeType.prototype.getPreviewRect = function() {
                let yOffset = 40;
                if (this.widgets) {
                    const visible = this.widgets.filter(w => w.type !== "hidden");
                    const last = visible[visible.length - 1];
                    if (last && last.last_y !== undefined) {
                        yOffset = last.last_y + (last.computeSize ? last.computeSize(this.size[0])[1] : 24);
                    }
                }
                yOffset += 15;
                const margin = 20;
                const area = { x: margin/2, y: yOffset, w: this.size[0]-margin, h: this.size[1]-yOffset-margin };
                if (!this.img || !this.img.complete) return area;
                const r = Math.min(area.w / this.img.width, area.h / this.img.height);
                return { 
                    x: area.x + (area.w - this.img.width * r) / 2, 
                    y: area.y + (area.h - this.img.height * r) / 2, 
                    w: this.img.width * r, h: this.img.height * r 
                };
            };

            nodeType.prototype.onDrawForeground = function(ctx) {
                if (this.flags.collapsed || !this.img) return;
                const rect = this.getPreviewRect();
                if (!rect || rect.w <= 0 || rect.h <= 0) return;

                ctx.save();
                const pts = this.points || [];
                
                // 1. 第一层：绘制所有底圆
                ctx.beginPath();
                pts.forEach(p => {
                    const px = rect.x + p.x * rect.w, py = rect.y + p.y * rect.h;
                    ctx.moveTo(px + 10, py);
                    ctx.arc(px, py, 10, 0, Math.PI * 2);
                });
                ctx.fillStyle = "#FF0000";
                ctx.fill();
                ctx.strokeStyle = "white";
                ctx.lineWidth = 1.5;
                ctx.stroke();

                // 2. 第二层：绘制数字和删除叉号
                pts.forEach((p, i) => {
                    const px = rect.x + p.x * rect.w, py = rect.y + p.y * rect.h;
                    
                    // 绘制数字
                    ctx.fillStyle = "white";
                    ctx.font = "bold 10px Arial";
                    ctx.textAlign = "center";
                    ctx.textBaseline = "middle";
                    ctx.fillText(i + 1, px, py);

                    // --- 恢复叉号删除视觉按钮 ---
                    const x_off = 8, y_off = -8, r_x = 5;
                    ctx.beginPath();
                    ctx.arc(px + x_off, py + y_off, r_x, 0, Math.PI * 2);
                    ctx.fillStyle = "#333";
                    ctx.fill();
                    ctx.strokeStyle = "white";
                    ctx.lineWidth = 1;
                    ctx.stroke();
                    
                    ctx.fillStyle = "white";
                    ctx.font = "bold 8px Arial";
                    ctx.fillText("x", px + x_off, py + y_off);
                });
                
                // 3. 绘制分辨率信息
                if (this.img && this.img.naturalWidth > 0) {
                    const sizeText = `${this.img.naturalWidth} × ${this.img.naturalHeight}`;
                    ctx.font = "12px Arial";
                    ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
                    ctx.textAlign = "right";
                    ctx.textBaseline = "bottom";
                    const areaBottom = this.size[1] - 10;
                    const areaRight = this.size[0] - 10;
                    ctx.fillText(sizeText, areaRight, areaBottom);
                }
                ctx.restore();
            };

            nodeType.prototype.onDrawBackground = function(ctx) {
                if (this.flags.collapsed || !this.img) return;
                const rect = this.getPreviewRect();
                
                // 绘制底图
                ctx.drawImage(this.img, rect.x, rect.y, rect.w, rect.h);
                
                // 绘制 Mask (涂鸦层)
                if (this.mask_img) {
                    // 仅当 mask 存在且加载完成时绘制
                    ctx.save();
                    ctx.globalAlpha = 0.7;
                    ctx.drawImage(this.mask_img, rect.x, rect.y, rect.w, rect.h);
                    ctx.restore();
                }
            };

            nodeType.prototype.onMouseDown = function(e, localPos) {
                const rect = this.getPreviewRect();
                const x = (localPos[0] - rect.x) / rect.w, y = (localPos[1] - rect.y) / rect.h;
                if (x < 0 || x > 1 || y < 0 || y > 1) return;

                const hitThreshold = 15 / rect.w;
                const closeThreshold = 8 / rect.w; // 叉号点击判定范围
                
                // 优先检查是否点击了叉号 (右上角偏移 8, -8 像素)
                const closeHit = this.points.findIndex(p => {
                    const dx = (p.x + 8/rect.w) - x;
                    const dy = (p.y - 8/rect.h) - y;
                    return Math.hypot(dx, dy) < closeThreshold;
                });

                if (closeHit !== -1 || e.button === 2) { // 点击叉号或右键
                    const idx = closeHit !== -1 ? closeHit : this.points.findIndex(p => Math.hypot(p.x - x, p.y - y) < hitThreshold);
                    if (idx !== -1) {
                        this.points.splice(idx, 1);
                        this.syncAll();
                        this.setDirtyCanvas(true);
                        return true;
                    }
                }

                if (e.button === 0) { // 左键
                    const hit = this.points.findIndex(p => Math.hypot(p.x - x, p.y - y) < hitThreshold);
                    if (hit !== -1) {
                        this.draggingPoint = hit;
                    } else {
                        this.points.push({ x, y });
                        this.syncAll();
                    }
                    this.setDirtyCanvas(true);
                    return true;
                }
            };

            nodeType.prototype.onMouseMove = function(e, localPos) {
                if (app.canvas && app.canvas.canvas) {
                    app.canvas.canvas.style.cursor = "crosshair";
                }
                if (this.draggingPoint !== null) {
                    const rect = this.getPreviewRect();
                    // 1. 仅更新内存中的点位坐标 (前端纯计算)
                    this.points[this.draggingPoint].x = Math.max(0, Math.min(1, (localPos[0] - rect.x) / rect.w));
                    this.points[this.draggingPoint].y = Math.max(0, Math.min(1, (localPos[1] - rect.y) / rect.h));
                    
                    // 2. 标记 Canvas 需要重绘 (60fps 渲染)
                    // 注意：此时绝不调用 syncAll()，避免触发 LiteGraph 的全图序列化和回调
                    this.setDirtyCanvas(true);
                }
            };

            nodeType.prototype.onMouseUp = function() { 
                if (this.draggingPoint !== null) {
                    this.syncAll();
                }
                this.draggingPoint = null; // 确保状态彻底重置
            };

            nodeType.prototype.openEditor = function() {
                const imgW = this.widgets.find(w => w.name === "image");
                if (!imgW || !imgW.value) return alert("请先上传图片");
                
                let mask = document.getElementById("sk_v3_mask") || document.createElement("div");
                if (!mask.id) { mask.id = "sk_v3_mask"; mask.className = "sk-v3-mask"; document.body.appendChild(mask); }
                
                mask.innerHTML = `
                    <div class="sk-v3-editor">
                        <style>
                            .sk-v3-editor { 
                                position:fixed; top:50%; left:50%; transform:translate(-50%, -50%); 
                                width: fit-content; max-width: 95vw; min-width: 1000px; max-height: 95vh;
                                background:#1e1e1e; border:2px solid #555; display:flex; flex-direction:column; z-index:10000; 
                                box-shadow:0 0 20px rgba(0,0,0,0.8); border-radius: 8px; overflow: hidden;
                            }
                            .sk-v3-toolbar { 
                                display:flex; gap:10px; padding:10px 15px; background:#2b2b2b; border-bottom:1px solid #444; 
                                align-items:center; flex-wrap: nowrap; overflow: hidden; flex-shrink: 0;
                            }
                            .sk-v3-btn { 
                                padding:6px 12px; border:1px solid #555; background:#333; color:#eee; cursor:pointer; 
                                border-radius:4px; white-space: nowrap; font-size: 13px; transition: all 0.2s;
                            }
                            .sk-v3-btn.active { background:#4a4a4a; border-color:#00f2ff; box-shadow: 0 0 5px rgba(0,242,255,0.3); }
                            .sk-v3-btn:hover { background:#444; border-color: #777; }
                            .sk-v3-btn.save { background:#2e7d32; border-color:#4caf50; margin-left: 10px; }
                            .sk-v3-btn.close { background:#c62828; border-color:#ef5350; }
                            .sk-v3-group { display:flex; align-items:center; gap:8px; padding-right:15px; border-right: 1px solid #444; flex-shrink: 0; }
                            .sk-v3-canvas-wrapper { flex: 0 0 auto; background:#111; position:relative; overflow:hidden; display:flex; justify-content:center; align-items:center; cursor: crosshair; }
                            .sk-v3-canvas-wrapper canvas { position:absolute; }
                            .sk-v3-status { position: absolute; bottom: 10px; right: 10px; padding: 4px 8px; background: rgba(0,0,0,0.5); color: #aaa; font-size: 11px; border-radius: 4px; pointer-events: none; z-index: 101; }
                            .sk-v3-coords { position:absolute; top:10px; left:10px; pointer-events:none; z-index:100; font-family:monospace; color:#0f0; text-shadow:1px 1px 1px #000; font-size:14px; background:rgba(0,0,0,0.5); padding:5px; border-radius:4px; max-height: 90%; overflow: hidden; }
                        </style>
                        <div class="sk-v3-toolbar" id="v3_toolbar">
                            <div class="sk-v3-group">
                                <button class="sk-v3-btn active" id="v3_tool_point">📍 标注点</button>
                                <button class="sk-v3-btn" id="v3_tool_draw">🖌️ 涂鸦</button>
                            </div>
                            <div class="sk-v3-group" id="v3_draw_opts" style="display:none">
                                <input type="range" id="v3_brush_size" min="1" max="100" value="20">
                                <span id="v3_brush_val">20px</span>
                                <div class="sk-v3-color-dot active" style="background:#fff" data-color="#ffffff"></div>
                                <div class="sk-v3-color-dot" style="background:#f00" data-color="#ff0000"></div>
                                <div class="sk-v3-color-dot" style="background:#0f0" data-color="#00ff00"></div>
                                <div class="sk-v3-color-dot" style="background:#00f" data-color="#0000ff"></div>
                            </div>
                            <div class="sk-v3-group">
                                <button class="sk-v3-btn" id="v3_clear_doodle">🗑️ 清空涂鸦</button>
                                <button class="sk-v3-btn" id="v3_clear_points">🗑️ 清空点位</button>
                                <button class="sk-v3-btn clear" id="v3_clear_all">💥 清空全部</button>
                                <button class="sk-v3-btn" id="v3_undo_btn">↩️ 撤销</button>
                            </div>
                            <div style="flex:1"></div>
                            <button class="sk-v3-btn save" id="v3_save_btn">💾 保存并同步</button>
                            <button class="sk-v3-btn close" id="v3_close_btn">❌ 关闭</button>
                        </div>
                        <div class="sk-v3-canvas-wrapper" id="v3_wrapper">
                            <div id="v3_coords_list" class="sk-v3-coords"></div>
                            <canvas id="v3_canvas_bg"></canvas>
                            <canvas id="v3_canvas_mask"></canvas>
                            <canvas id="v3_canvas_points"></canvas>
                            <div class="sk-v3-status" id="v3_status">Ready</div>
                        </div>
                    </div>
                `;

                mask.style.display = "flex";

                const bgC = document.getElementById("v3_canvas_bg");
                const maskC = document.getElementById("v3_canvas_mask");
                maskC.style.opacity = "0.7"; // 设置透明度，防止遮挡背景
                const ptC = document.getElementById("v3_canvas_points");
                const bgCtx = bgC.getContext("2d");
                const maskCtx = maskC.getContext("2d");
                const ptCtx = ptC.getContext("2d");
                const status = document.getElementById("v3_status");
                const coordsList = document.getElementById("v3_coords_list");

                let mode = "point"; 
                let brushSize = 20;
                let brushColor = "#ffffff";
                let isDrawing = false;
                let tempPoints = JSON.parse(JSON.stringify(this.points));
                let lastPos = null;
                let history = []; // 存储 { points, doodle }

                const saveHistory = () => {
                    // 仅存储最近 20 步
                    if (history.length > 20) history.shift();
                    history.push({
                        points: JSON.parse(JSON.stringify(tempPoints)),
                        doodle: maskCtx.getImageData(0, 0, maskC.width, maskC.height)
                    });
                };

                const editImg = new Image();
                editImg.onload = () => {
                    const toolbar = document.getElementById("v3_toolbar");
                    const toolbarH = toolbar ? toolbar.offsetHeight : 60;
                    const maxEditorH = window.innerHeight * 0.9;
                    const H_minus_h = maxEditorH - toolbarH; 
                    
                    const imgRatio = editImg.naturalWidth / editImg.naturalHeight;
                    const canvasH = Math.min(H_minus_h, editImg.naturalHeight);
                    const canvasW = canvasH * imgRatio;

                    [bgC, maskC, ptC].forEach(c => { c.width = canvasW; c.height = canvasH; });
                    const wrapper = document.getElementById("v3_wrapper");
                    wrapper.style.width = canvasW + "px";
                    wrapper.style.height = canvasH + "px";

                    bgCtx.drawImage(editImg, 0, 0, canvasW, canvasH);
                    
                    const mw = this.widgets.find(w => w.name === "mask_data");
                    const maskData = (mw ? mw.value : null) || this.properties["mask_data"];
                    if (maskData && maskData.startsWith("data:image")) {
                        const m = new Image();
                        m.onload = () => maskCtx.drawImage(m, 0, 0, canvasW, canvasH);
                        m.src = maskData;
                    }
                    
                    if (status) status.innerText = `Ready size: ${editImg.naturalWidth} × ${editImg.naturalHeight}`;
                    renderPoints();
                };
                editImg.src = api.apiURL(`/view?filename=${encodeURIComponent(imgW.value)}&type=input&t=${Date.now()}`);

                const renderPoints = () => {
                    ptCtx.clearRect(0, 0, ptC.width, ptC.height);
                    coordsList.innerHTML = "";
                    tempPoints.forEach((p, i) => {
                        const x = p.x * ptC.width, y = p.y * ptC.height;
                        
                        // 1. 绘制底圆
                        ptCtx.beginPath(); ptCtx.arc(x, y, 12, 0, Math.PI*2);
                        ptCtx.fillStyle = "rgba(255,0,0,0.8)"; ptCtx.fill();
                        ptCtx.strokeStyle = "white"; ptCtx.lineWidth = 2; ptCtx.stroke();
                        
                        // 2. 绘制数字
                        ptCtx.fillStyle = "white"; ptCtx.font = "bold 12px Arial";
                        ptCtx.textAlign = "center"; ptCtx.textBaseline = "middle";
                        ptCtx.fillText(i+1, x, y);

                        // 3. 绘制删除叉号按钮
                        const x_off = 10, y_off = -10, r_x = 6;
                        ptCtx.beginPath();
                        ptCtx.arc(x + x_off, y + y_off, r_x, 0, Math.PI * 2);
                        ptCtx.fillStyle = "#333";
                        ptCtx.fill();
                        ptCtx.strokeStyle = "white";
                        ptCtx.lineWidth = 1;
                        ptCtx.stroke();
                        ptCtx.fillStyle = "white";
                        ptCtx.font = "bold 9px Arial";
                        ptCtx.fillText("x", x + x_off, y + y_off);

                        const div = document.createElement("div");
                        div.innerText = `标记${i+1}: (${Math.round(p.x * editImg.naturalWidth)}, ${Math.round(p.y * editImg.naturalHeight)})`;
                        coordsList.appendChild(div);
                    });
                };

                const getPos = (e) => {
                    const r = ptC.getBoundingClientRect();
                    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
                };

                ptC.onmousedown = (e) => {
                    const pos = getPos(e);
                    
                    if (mode === "point") {
                        // 1. 检查是否点击了叉号 (右上角偏移 10, -10 像素)
                        const closeThreshold = 10 / ptC.width;
                        const closeHit = tempPoints.findIndex(p => {
                            const dx = (p.x + 10/ptC.width) - pos.x;
                            const dy = (p.y - 10/ptC.height) - pos.y;
                            return Math.hypot(dx, dy) < closeThreshold;
                        });

                        if (closeHit !== -1 || e.button === 2) { // 点击叉号或右键
                            saveHistory();
                            const idx = closeHit !== -1 ? closeHit : tempPoints.findIndex(p => Math.hypot(p.x-pos.x, p.y-pos.y) < (20/ptC.width));
                            if (idx !== -1) {
                                tempPoints.splice(idx, 1);
                                renderPoints();
                                return;
                            }
                        }

                        // 2. 左键逻辑
                        if (e.button === 0) {
                            const hit = tempPoints.findIndex(p => Math.hypot(p.x-pos.x, p.y-pos.y) < (20/ptC.width));
                            if (hit !== -1) {
                                saveHistory();
                                this._drag = hit;
                            } else {
                                saveHistory();
                                tempPoints.push(pos);
                                renderPoints();
                            }
                        }
                    } else {
                            if (e.button === 0) {
                                saveHistory(); // 操作前保存
                                isDrawing = true; lastPos = pos;
                                maskCtx.beginPath(); maskCtx.lineCap = "round"; maskCtx.lineJoin = "round";
                                maskCtx.strokeStyle = brushColor; maskCtx.lineWidth = (brushSize / editImg.naturalWidth) * ptC.width;
                                maskCtx.moveTo(pos.x * ptC.width, pos.y * ptC.height);
                            }
                        }
                };

                ptC.oncontextmenu = (e) => e.preventDefault(); // 拦截编辑器右键菜单

                window.onmousemove = (e) => {
                    const pos = getPos(e);
                    const wrapper = document.getElementById("v3_wrapper");
                    if (e.target === ptC) {
                        // 根据工具切换光标，涂鸦模式不隐藏鼠标
                        wrapper.style.cursor = mode === "point" ? "crosshair" : "crosshair"; 
                    }
                    if (this._drag !== undefined) {
                        tempPoints[this._drag] = pos; renderPoints();
                    } else if (isDrawing && lastPos) {
                        maskCtx.lineTo(pos.x * ptC.width, pos.y * ptC.height); maskCtx.stroke();
                        lastPos = pos;
                    }
                };

                window.onmouseup = () => { this._drag = undefined; isDrawing = false; lastPos = null; };

                document.getElementById("v3_tool_point").onclick = (e) => {
                    mode = "point"; 
                    e.target.classList.add("active");
                    document.getElementById("v3_tool_draw").classList.remove("active");
                    document.getElementById("v3_draw_opts").style.display = "none";
                };
                document.getElementById("v3_tool_draw").onclick = (e) => {
                    mode = "draw";
                    e.target.classList.add("active");
                    document.getElementById("v3_tool_point").classList.remove("active");
                    document.getElementById("v3_draw_opts").style.display = "flex";
                };

                document.getElementById("v3_brush_size").oninput = (e) => {
                    brushSize = e.target.value;
                    document.getElementById("v3_brush_val").innerText = brushSize + "px";
                };

                document.querySelectorAll(".sk-v3-color-dot").forEach(dot => {
                    dot.onclick = (e) => {
                        document.querySelectorAll(".sk-v3-color-dot").forEach(d => d.classList.remove("active"));
                        e.target.classList.add("active");
                        brushColor = e.target.dataset.color;
                    };
                });

                document.getElementById("v3_clear_doodle").onclick = () => {
                    saveHistory();
                    maskCtx.clearRect(0, 0, maskC.width, maskC.height);
                };
                document.getElementById("v3_clear_points").onclick = () => {
                     saveHistory();
                     tempPoints = []; 
                     renderPoints();
                 };
                 document.getElementById("v3_clear_all").onclick = () => {
                     saveHistory();
                     tempPoints = [];
                     maskCtx.clearRect(0, 0, maskC.width, maskC.height);
                     renderPoints();
                 };

                document.getElementById("v3_undo_btn").onclick = () => {
                    if (history.length === 0) return;
                    const last = history.pop();
                    tempPoints = last.points;
                    maskCtx.putImageData(last.doodle, 0, 0);
                    renderPoints();
                };

                document.getElementById("v3_save_btn").onclick = async () => {
                    const maskData = maskC.toDataURL("image/png");
                    const pixelPoints = tempPoints.map(p => ({
                        x: Math.round(p.x * editImg.naturalWidth),
                        y: Math.round(p.y * editImg.naturalHeight)
                    }));
                    
                    const res = await api.fetchApi("/sk-marks/save_v3", {
                        method: "POST",
                        body: JSON.stringify({ image: imgW.value, points: pixelPoints, mask_data: maskData })
                    });
                    const json = await res.json();
                    if (json.status === "success") {
                        this.points = tempPoints;
                        const mw = this.widgets.find(w => w.name === "mask_data");
                        if (mw) mw.value = maskData;
                        this.loadNodeImage(json.preview_name);
                        this.syncAll();
                        mask.style.display = "none";
                    }
                };

                document.getElementById("v3_close_btn").onclick = () => mask.style.display = "none";
            };
        }
    }
});
