import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

const style = document.createElement('style');
style.innerHTML = `
    .sk-marks-mask {
        position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
        background: rgba(0,0,0,0.85); z-index: 10001;
        display: none; flex-direction: column; align-items: center; justify-content: center;
    }
    .sk-marks-canvas { background: #000; box-shadow: 0 0 30px rgba(0,0,0,0.5); cursor: crosshair; }
    .sk-marks-tools { 
        margin-top: 20px; display: flex; gap: 15px; 
        color: white; font-family: sans-serif; background: #222; padding: 12px 25px; border-radius: 10px;
    }
    .sk-marks-btn { padding: 6px 15px; cursor: pointer; border-radius: 4px; border: none; font-weight: bold; }
    .sk-save-btn { background: #28a745; color: white; }
    .sk-clear-btn { background: #dc3545; color: white; }
    .sk-close-btn { background: #6c757d; color: white; }
`;
document.head.appendChild(style);

app.registerExtension({
    name: "CloserAI.SerialNumberMarks.Nodes2Fix",
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name === "SerialNumberMarks") {
            
            nodeType.prototype.onNodeCreated = function() {
                this.points = [];
                this.img = null;
                this.imgs = []; 
                this.img_name = "";
                this.draggingPoint = null;
                this.size = [400, 500];

                this.addWidget("button", "🖼️ 进入弹窗标注模式", null, () => this.openEditor());
                this.addWidget("button", "🗑️ 清空标注点", null, () => {
                    this.points = [];
                    this.syncAll();
                });

                const pWidget = this.widgets.find(w => w.name === "points_data");
                if (pWidget) pWidget.type = "text";

                const imageWidget = this.widgets.find(w => w.name === "image");
                if (imageWidget) {
                    const self = this;
                    const orgCallback = imageWidget.callback;
                    imageWidget.callback = function(value) {
                        if (orgCallback) orgCallback.apply(this, arguments);
                        // 当 widget 值改变时，强制重载图片
                        if (value && self.img_name !== value) {
                            self.img_name = value;
                            self.points = []; // 换图清空点位
                            self.loadNodeImage(value);
                        }
                    };
                }
            };

            // 核心修复：加载图片后强制触发布局和预览刷新
            nodeType.prototype.loadNodeImage = function(name) {
                if (!name) return;
                const url = api.apiURL(`/view?filename=${encodeURIComponent(name)}&type=input&t=${Date.now()}`);
                const img = new Image();
                img.src = url;
                img.onload = () => { 
                    this.img = img; 
                    //  Nodes 2.0 
                    this.imgs = [img]; 
                    this.syncAll();
                    
                    // 强制 Nodes 2.0 刷新节点高度和预览区域
                    if (this.onResize) this.onResize(this.size);
                };
            };

            nodeType.prototype.syncAll = function() {
                const w = this.widgets.find(w => w.name === "points_data");
                if (w && this.img) {
                    const raw = this.points.map(p => ({
                        x: Math.round(p.x * this.img.naturalWidth),
                        y: Math.round(p.y * this.img.naturalHeight)
                    }));
                    const val = JSON.stringify(raw);
                    w.value = val;
                    // 必须调用 setProperty 以确保 Nodes 2.0 序列化正确
                    this.setProperty("points_data", val);
                    if (w.callback) w.callback(val);
                }
                
                // 双重刷新策略
                if (this.img) {
                    this.imgs = [this.img];

                    if (this.img.src && !this.img.src.includes("&rand=")) {
                         // 保持原 URL 结构，追加随机参数
                         this.img.src = this.img.src + `&rand=${Math.random()}`;
                    }
                }
                
                // 1. LiteGraph 原生刷新
                this.setDirtyCanvas(true); 
                
                // 2. Nodes 2.0 穿透刷新：强制失效 Tile 缓存
                if (app.canvas && app.canvas.graph_canvas) {
                    // 第二个参数 true 是关键，用于 invalidate 缓存
                    app.canvas.graph_canvas.setDirty(true, true);
                }
            };

            nodeType.prototype.getPreviewRect = function() {
                let yOffset = 30;
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

            // 移动到 Foreground 绘制，确保在 Overlay 之上
            nodeType.prototype.onDrawForeground = function(ctx) {
                if (this.flags.collapsed || !this.img) return;
                
                const rect = this.getPreviewRect();
                
                // 保存状态
                ctx.save();
                
                this.points.forEach((p, i) => {
                    const px = rect.x + p.x * rect.w, py = rect.y + p.y * rect.h;
                    
                    // 绘制序号红点
                    ctx.beginPath(); ctx.arc(px, py, 10, 0, Math.PI*2);
                    ctx.fillStyle = "#FF0000"; ctx.fill();
                    ctx.strokeStyle = "white"; ctx.lineWidth = 1.5; ctx.stroke();
                    
                    ctx.fillStyle = "white"; ctx.font = "bold 10px Arial";
                    ctx.textAlign = "center"; ctx.textBaseline = "middle"; 
                    ctx.fillText(i+1, px, py);

                    // 绘制删除叉号
                    const hx = px + 9, hy = py - 9;
                    ctx.beginPath(); ctx.arc(hx, hy, 6, 0, Math.PI*2);
                    ctx.fillStyle = "#333"; ctx.fill();
                    ctx.strokeStyle = "white"; ctx.lineWidth = 1; ctx.stroke();
                    
                    ctx.beginPath(); 
                    ctx.moveTo(hx-3, hy-3); ctx.lineTo(hx+3, hy+3); 
                    ctx.moveTo(hx+3, hy-3); ctx.lineTo(hx-3, hy+3);
                    ctx.strokeStyle = "white"; ctx.stroke();
                });
                
                // 恢复状态
                ctx.restore();
            };
            
            // 恢复图片绘制，但只绘制底图
            nodeType.prototype.onDrawBackground = function(ctx) {
                if (this.flags.collapsed || !this.img) return;
                const rect = this.getPreviewRect();
                // 绘制图片
                ctx.drawImage(this.img, rect.x, rect.y, rect.w, rect.h);
            };

            nodeType.prototype.onMouseDown = function(e, localPos) {
                const rect = this.getPreviewRect();
                const x = (localPos[0] - rect.x) / rect.w;
                const y = (localPos[1] - rect.y) / rect.h;
                if (x < 0 || x > 1 || y < 0 || y > 1) return;

                const isRightClick = e.button === 2;
                const delHandleIdx = this.points.findIndex(p => {
                    const hx = rect.x + p.x * rect.w + 9, hy = rect.y + p.y * rect.h - 9;
                    return Math.hypot(localPos[0] - hx, localPos[1] - hy) < 8;
                });

                if (isRightClick || delHandleIdx !== -1) {
                    const target = isRightClick ? this.points.findIndex(p => Math.hypot(p.x-x, p.y-y) < (20/rect.w)) : delHandleIdx;
                    if (target !== -1) {
                        this.points.splice(target, 1);
                        this.syncAll();
                        return true;
                    }
                    if (isRightClick) return true;
                }

                if (e.button === 0) {
                    const hit = this.points.findIndex(p => Math.hypot(p.x-x, p.y-y) < (15/rect.w));
                    if (hit !== -1) {
                        this.draggingPoint = hit;
                    } else {
                        this.points.push({x, y});
                        this.syncAll();
                    }
                    return true;
                }
            };

            nodeType.prototype.onMouseMove = function(e, localPos) {
                if (this.draggingPoint !== null) {
                    const rect = this.getPreviewRect();
                    this.points[this.draggingPoint].x = Math.max(0, Math.min(1, (localPos[0] - rect.x) / rect.w));
                    this.points[this.draggingPoint].y = Math.max(0, Math.min(1, (localPos[1] - rect.y) / rect.h));
                    this.syncAll();
                }
            };

            nodeType.prototype.onMouseUp = function() { this.draggingPoint = null; };

            nodeType.prototype.openEditor = function() {
                const imgW = this.widgets.find(w => w.name === "image");
                if (!imgW || !imgW.value) return alert("请先上传图片");
                let mask = document.getElementById("sk_marks_mask") || document.createElement("div");
                if (!mask.id) { mask.id = "sk_marks_mask"; mask.className = "sk-marks-mask"; document.body.appendChild(mask); }
                mask.innerHTML = `<div class="sk-marks-content"><canvas id="sk_marks_canvas" class="sk-marks-canvas"></canvas></div>
                    <div class="sk-marks-tools">
                        <span style="color:#aaa; font-size:12px; align-self:center;">左键点/拖 | 右键或叉号删除</span>
                        <button id="sk_clear_btn" class="sk-marks-btn sk-clear-btn">清空</button>
                        <button id="sk_save_btn" class="sk-marks-btn sk-save-btn">保存同步</button>
                        <button id="sk_close_btn" class="sk-marks-btn sk-close-btn">取消</button>
                    </div>`;
                const canvas = document.getElementById("sk_marks_canvas"), ctx = canvas.getContext("2d");
                const editImg = new Image();
                let tempPoints = JSON.parse(JSON.stringify(this.points)), dIdx = null;
                editImg.src = api.apiURL(`/view?filename=${encodeURIComponent(imgW.value)}&type=input&t=${Date.now()}`);
                editImg.onload = () => {
                    const r = Math.min((window.innerWidth*0.85)/editImg.width, (window.innerHeight*0.75)/editImg.height);
                    canvas.width = editImg.width * r; canvas.height = editImg.height * r;
                    const draw = () => {
                        ctx.drawImage(editImg, 0, 0, canvas.width, canvas.height);
                        tempPoints.forEach((p, i) => {
                            const px = p.x*canvas.width, py = p.y*canvas.height;
                            ctx.beginPath(); ctx.arc(px, py, 15, 0, Math.PI*2);
                            ctx.fillStyle = "red"; ctx.fill(); ctx.strokeStyle = "white"; ctx.lineWidth = 2; ctx.stroke();
                            ctx.fillStyle = "white"; ctx.font = "bold 14px Arial"; ctx.textAlign = "center"; ctx.fillText(i+1, px, py+5);
                            const hx = px+13, hy = py-13;
                            ctx.beginPath(); ctx.arc(hx, hy, 8, 0, Math.PI*2); ctx.fillStyle = "#333"; ctx.fill();
                            ctx.strokeStyle = "white"; ctx.lineWidth = 1; ctx.stroke();
                            ctx.beginPath(); ctx.moveTo(hx-4, hy-4); ctx.lineTo(hx+4, hy+4); ctx.moveTo(hx+4, hy-4); ctx.lineTo(hx-4, hy+4);
                            ctx.strokeStyle = "white"; ctx.stroke();
                        });
                    };
                    canvas.onmousedown = (e) => {
                        const b = canvas.getBoundingClientRect(), x = (e.clientX-b.left)/canvas.width, y = (e.clientY-b.top)/canvas.height;
                        const delHandle = tempPoints.findIndex(p => Math.hypot((e.clientX-b.left)-(p.x*canvas.width+13), (e.clientY-b.top)-(p.y*canvas.height-13)) < 12);
                        if (e.button === 2 || delHandle !== -1) {
                            const target = e.button === 2 ? tempPoints.findIndex(p => Math.hypot(p.x-x, p.y-y) < (25/canvas.width)) : delHandle;
                            if (target !== -1) { tempPoints.splice(target, 1); draw(); }
                            return;
                        }
                        const hit = tempPoints.findIndex(p => Math.hypot(p.x-x, p.y-y) < (25/canvas.width));
                        if (hit !== -1) dIdx = hit; else { tempPoints.push({x,y}); draw(); }
                    };
                    canvas.onmousemove = (e) => { if (dIdx !== null) { 
                        const b = canvas.getBoundingClientRect();
                        tempPoints[dIdx].x = Math.max(0, Math.min(1, (e.clientX-b.left)/canvas.width));
                        tempPoints[dIdx].y = Math.max(0, Math.min(1, (e.clientY-b.top)/canvas.height));
                        draw(); 
                    }};
                    canvas.onmouseup = () => dIdx = null;
                    canvas.oncontextmenu = (e) => e.preventDefault();
                    
                    document.getElementById("sk_save_btn").onclick = () => {
                        this.points = tempPoints;
                        
                        // 强制同步图片引用，确保节点显示的图片与弹窗一致
                        if (editImg && editImg.complete && editImg.width > 0) {
                            this.img = editImg;
                            // 确保图片源带上随机参数，防止缓存
                            if (this.img.src && !this.img.src.includes("&rand=")) {
                                this.img.src = this.img.src + `&rand=${Math.random()}`;
                            }
                            this.imgs = [this.img];
                        }
                        
                        this.syncAll();
                        mask.style.display = "none";
                        
                        // 再次强制刷新，确保视图更新
                        setTimeout(() => { 
                             this.setDirtyCanvas(true); 
                             if (app.canvas && app.canvas.graph_canvas) {
                                app.canvas.graph_canvas.setDirty(true, true);
                             }
                        }, 50);
                    };
                    
                    document.getElementById("sk_clear_btn").onclick = () => { tempPoints = []; draw(); };
                    document.getElementById("sk_close_btn").onclick = () => mask.style.display="none";
                    draw();
                };
                mask.style.display = "flex";
            };

            nodeType.prototype.onConfigure = function(o) {
                if (o.properties?.saved_points) this.points = o.properties.saved_points;
                const imgW = this.widgets.find(w => w.name === "image");
                if (imgW && imgW.value) {
                    this.img_name = imgW.value;
                    setTimeout(() => this.loadNodeImage(imgW.value), 100);
                }
            };
            nodeType.prototype.onSerialize = function(o) {
                o.properties = o.properties || {};
                o.properties.saved_points = this.points;
            };
        }
    }
});