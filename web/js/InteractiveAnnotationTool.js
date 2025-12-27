import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

app.registerExtension({
    name: "CloserAI.InteractiveAnnotationTool",
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name === "InteractiveAnnotationTool") {
            
            nodeType.prototype.onNodeCreated = function() {
                this.points = [];
                this.mode = "point"; 
                this.pointColors = ["#00FF00", "#00CCFF", "#CC00FF", "#FF6600", "#FF0000", "#FFFFFF"];
                this.selectedPointColorIdx = 3; 
                this.selectedPointColor = this.pointColors[3];
                this.colors = ["#000000", "#FFFFFF", "#FF0000", "#0088FF", "#FFCC00", "#FF00FF"];
                this.brushColor = this.colors[0]; 
                this.selectedColorIdx = 0;
                this.sizes = [8, 14, 24, 32];
                this.brushSize = this.sizes[1];
                this.selectedSizeIdx = 1;

                this.isDrawing = false; 
                this.img = null;
                this.currentImageName = "";
                this.imgInfo = { size: "0x0" };
                this.size = [800, 720]; 
                this.draggingPoint = null; 
                this.longPressTimer = null;
                this.mouseInCanvas = false;
                this.cursorPos = { lx: 0, ly: 0 };
                this.mouseDownPos = { x: 0, y: 0 };
                this.isMoving = false;

                // --- 核心配置 ---
                this.SUGGESTED_MAX_SIZE = 600; // 定义最大显示尺寸
                this.isOriginalDisplay = false; // 内部状态：当前是否处于原图模式

                // 设置节点的最小尺寸属性 (LiteGraph 标准)
                this.min_width = 220;
                this.min_height = 500;

                this.hideDataWidgets();
                const imageWidget = this.widgets.find(w => w.name === "image");
                imageWidget.callback = (v) => { if (v && v !== this.currentImageName) this.loadImage(v, true); };

                const self = this;
                this._onGlobalMouseUp = () => {
                    if (self.longPressTimer) { clearTimeout(self.longPressTimer); self.longPressTimer = null; }
                    if (self.isDrawing) { self.isDrawing = false; self.syncDoodle(); }
                    if (self.draggingPoint) { self.syncPoints(); }
                    self.draggingPoint = null;
                    self.isMoving = false;
                    
                    // 检测用户是否手动拉大了节点
                    if (self.img && !self.isOriginalDisplay) {
                        const rect = self.getCanvasImageRect();
                        if (rect.w >= self.img.naturalWidth * 0.99) {
                            self.isOriginalDisplay = true;
                        }
                    }
                    self.setDirtyCanvas(true);
                };
                window.addEventListener("mouseup", this._onGlobalMouseUp);
                this.onRemoved = () => window.removeEventListener("mouseup", this._onGlobalMouseUp);
            };

            // --- 新增：强制限制最小尺寸的 Handler ---
            nodeType.prototype.onResize = function(size) {
                const yStart = this.getUIStartStackY();
                // 计算左侧按钮所需的最小高度：startY + 按钮区域总高(~440px) + 底部留白(20px)
                const minH = yStart + 460; 
                const minW = 220; // 保证左侧按钮能完整显示的最小宽度

                if (size[0] < minW) size[0] = minW;
                if (size[1] < minH) size[1] = minH;
            };

            // 尺寸调整逻辑
            nodeType.prototype.applyResize = function(mode) {
                if (!this.img) return;
                
                this.isOriginalDisplay = (mode === 'original');
                const yStart = this.getUIStartStackY();
                const sideWidth = 135; 
                const bottomPadding = 60;
                // 按钮区域的硬性最小高度限制
                const minSafeHeight = yStart + 460;

                let targetW, targetH;
                if (mode === 'original') {
                    targetW = this.img.naturalWidth;
                    targetH = this.img.naturalHeight;
                } else {
                    const ratio = Math.min(1, this.SUGGESTED_MAX_SIZE / this.img.naturalWidth, this.SUGGESTED_MAX_SIZE / this.img.naturalHeight);
                    targetW = this.img.naturalWidth * ratio;
                    targetH = this.img.naturalHeight * ratio;
                }

                // 更新尺寸，同时应用 Math.max 确保不小于最小安全高度
                this.setSize([
                    Math.max(600, targetW + sideWidth),
                    Math.max(minSafeHeight, targetH + yStart + bottomPadding)
                ]);
                this.setDirtyCanvas(true, true);
            };

            nodeType.prototype.getContrastColor = function(hexcolor) {
                hexcolor = hexcolor.replace("#", "");
                const r = parseInt(hexcolor.substr(0,2),16), g = parseInt(hexcolor.substr(2,2),16), b = parseInt(hexcolor.substr(4,2),16);
                const yiq = ((r*299)+(g*587)+(b*114))/1000;
                return (yiq >= 128) ? 'black' : 'white';
            };

            nodeType.prototype.loadImage = async function(filename, shouldClear = false) {
                if (!filename) return;
                this.currentImageName = filename;
                const url = api.apiURL(`/view?filename=${encodeURIComponent(filename)}&type=input&t=${Date.now()}`);
                const img = new Image();
                img.onload = () => {
                    this.img = img;
                    this.imgInfo.size = `${img.naturalWidth}x${img.naturalHeight}`;
                    this.initDoodleCanvas();
                    if (!shouldClear) { this.rehydrateCanvas(); } 
                    else { this.points = []; this.syncPoints(); this.syncDoodle(); }
                    
                    const isBig = img.naturalWidth > this.SUGGESTED_MAX_SIZE || img.naturalHeight > this.SUGGESTED_MAX_SIZE;
                    this.applyResize(isBig ? 'fit' : 'original');
                };
                img.src = url;
            };

            nodeType.prototype.initDoodleCanvas = function() {
                if (!this.img) return;
                if (!this.doodleCanvas) this.doodleCanvas = document.createElement('canvas');
                this.doodleCanvas.width = this.img.naturalWidth;
                this.doodleCanvas.height = this.img.naturalHeight;
                this.doodleCtx = this.doodleCanvas.getContext('2d', { willReadFrequently: true });
            };

            nodeType.prototype.onMouseDown = function(e, localPos) {
                if (e.button !== 0) return;
                const [lx, ly] = localPos;
                const startY = this.getUIStartStackY();
                this.mouseDownPos = { x: lx, y: ly };
                this.isMoving = false;

                if (lx < 105) {
                    // Point UI
                    if (ly >= startY && ly <= startY + 28) this.mode = "point";
                    const ptColorY = startY + 35;
                    if (ly >= ptColorY && ly <= ptColorY + 60) {
                        const col = Math.floor((lx - 15) / 32.5), row = Math.floor((ly - ptColorY) / 30);
                        const i = col + row * 3;
                        if (i >= 0 && i < this.pointColors.length) { this.selectedPointColorIdx = i; this.selectedPointColor = this.pointColors[i]; this.mode = "point"; }
                    }
                    if (ly >= startY + 95 && ly <= startY + 119) { this.points = []; this.syncPoints(); }
                    
                    // Brush UI
                    const drawAreaY = startY + 140;
                    if (ly >= drawAreaY && ly <= drawAreaY + 28) this.mode = "brush";
                    if (ly >= drawAreaY + 32 && ly <= drawAreaY + 60) this.mode = "eraser";
                    
                    const brushColorY = drawAreaY + 70;
                    if (ly >= brushColorY && ly <= brushColorY + 60) {
                        const col = Math.floor((lx - 15) / 32.5), row = Math.floor((ly - brushColorY) / 30);
                        const i = col + row * 3;
                        if (i >= 0 && i < this.colors.length) { this.selectedColorIdx = i; this.brushColor = this.colors[i]; if(this.mode === "point") this.mode = "brush"; }
                    }
                    
                    const sizeAreaY = drawAreaY + 145;
                    if (ly >= sizeAreaY && ly <= sizeAreaY + 70) {
                        const col = Math.floor((lx - 10) / 45), row = Math.floor((ly - sizeAreaY) / 35);
                        const i = col + row * 2;
                        if (i >= 0 && i < this.sizes.length) { this.selectedSizeIdx = i; this.brushSize = this.sizes[i]; }
                    }
                    
                    if (ly >= sizeAreaY + 85 && ly <= sizeAreaY + 111) { 
                        this.doodleCtx?.clearRect(0,0,this.doodleCanvas.width,this.doodleCanvas.height); 
                        this.syncDoodle(); 
                    }

                    // 尺寸切换按钮
                    const fitBtnY = sizeAreaY + 125; 
                    if (ly >= fitBtnY && ly <= fitBtnY + 28 && this.img) {
                        const isBig = this.img.naturalWidth > this.SUGGESTED_MAX_SIZE || this.img.naturalHeight > this.SUGGESTED_MAX_SIZE;
                        if (isBig) {
                            if (this.isOriginalDisplay) this.applyResize('fit');
                            else this.applyResize('original');
                        }
                        return true;
                    }
                    this.setDirtyCanvas(true); return true;
                }

                if (!this.img) return;
                const rect = this.getCanvasImageRect();
                const x = (lx - rect.x) / rect.w, y = (ly - rect.y) / rect.h;
                if (x >= 0 && x <= 1 && y >= 0 && y <= 1) {
                    if (this.mode === "point") {
                        const hitIdx = this.points.findIndex(p => Math.sqrt(Math.pow((p.x-x)*rect.w,2)+Math.pow((p.y-y)*rect.h,2)) <= 15);
                        if (hitIdx !== -1) {
                            const target = this.points[hitIdx];
                            this.draggingPoint = target;
                            this.longPressTimer = setTimeout(() => { 
                                if (this.draggingPoint === target && !this.isMoving) { 
                                    this.points = this.points.filter(p => p !== target);
                                    this.syncPoints(); this.draggingPoint = null; this.setDirtyCanvas(true);
                                } 
                            }, 600);
                        } else {
                            this.points.push({ x, y, color: this.selectedPointColor });
                            this.syncPoints();
                        }
                    } else {
                        this.isDrawing = true;
                        this.lastPos = [x * this.doodleCanvas.width, y * this.doodleCanvas.height];
                    }
                    this.setDirtyCanvas(true); return true;
                }
            };

            nodeType.prototype.onMouseMove = function(e, localPos) {
                const rect = this.img ? this.getCanvasImageRect() : null;
                const [lx, ly] = localPos;
                this.cursorPos = { lx, ly };
                
                if (rect) {
                    const x = (lx - rect.x) / rect.w, y = (ly - rect.y) / rect.h;
                    this.mouseInCanvas = (x >= 0 && x <= 1 && y >= 0 && y <= 1);
                    
                    if (Math.sqrt(Math.pow(lx - this.mouseDownPos.x, 2) + Math.pow(ly - this.mouseDownPos.y, 2)) > 5) {
                        this.isMoving = true;
                        if (this.longPressTimer) { clearTimeout(this.longPressTimer); this.longPressTimer = null; }
                    }

                    if (this.mode === "point" && this.draggingPoint && e.buttons === 1) {
                        if (this.mouseInCanvas) { this.draggingPoint.x = x; this.draggingPoint.y = y; this.setDirtyCanvas(true); }
                    } else if (this.mode !== "point" && this.isDrawing && e.buttons === 1 && this.mouseInCanvas) {
                        const curX = x * this.doodleCanvas.width, curY = y * this.doodleCanvas.height;
                        this.doodleCtx.save();
                        this.doodleCtx.globalCompositeOperation = this.mode === "eraser" ? "destination-out" : "source-over";
                        this.doodleCtx.beginPath();
                        this.doodleCtx.strokeStyle = this.brushColor;
                        this.doodleCtx.lineWidth = this.brushSize;
                        this.doodleCtx.lineJoin = this.doodleCtx.lineCap = "round";
                        this.doodleCtx.moveTo(this.lastPos[0], this.lastPos[1]);
                        this.doodleCtx.lineTo(curX, curY);
                        this.doodleCtx.stroke();
                        this.doodleCtx.restore();
                        this.lastPos = [curX, curY];
                        this.setDirtyCanvas(true);
                    }
                }
            };

            nodeType.prototype.onDrawBackground = function(ctx) {
                if (this.flags.collapsed) return;
                const startY = this.getUIStartStackY();
                const drawBtn = (x, y, txt, col, h=28, w=85) => {
                    ctx.fillStyle = col; ctx.beginPath(); ctx.roundRect(x, y, w, h, 4); ctx.fill();
                    ctx.fillStyle = "white"; ctx.font = "11px Arial"; ctx.textAlign="center"; 
                    if (txt.includes("清空")) { ctx.shadowColor = "rgba(0,0,0,0.5)"; ctx.shadowBlur = 2; }
                    ctx.fillText(txt, x + w/2, y + h/2 + 4);
                    ctx.shadowColor = "transparent"; ctx.shadowBlur = 0;
                };

                // 左侧工具栏绘制
                drawBtn(10, startY, "标注(P)", this.mode === "point" ? "#3a6ea5" : "#444");
                this.pointColors.forEach((c, i) => {
                    const cx = 20 + (i % 3) * 32.5, cy = startY + 45 + Math.floor(i / 3) * 25;
                    ctx.fillStyle = c; ctx.beginPath(); ctx.arc(cx, cy, 10, 0, Math.PI * 2); ctx.fill();
                    if (this.selectedPointColorIdx === i && this.mode === "point") { ctx.strokeStyle = "white"; ctx.lineWidth = 2; ctx.stroke(); }
                });
                drawBtn(10, startY + 95, "清空点", "#744", 24);

                const drawAreaY = startY + 140;
                drawBtn(10, drawAreaY, "画笔(B)", this.mode === "brush" ? "#0088cc" : "#444");
                drawBtn(10, drawAreaY + 32, "橡皮(E)", this.mode === "eraser" ? "#cc6600" : "#444");
                this.colors.forEach((c, i) => {
                    const cx = 20 + (i % 3) * 32.5, cy = drawAreaY + 85 + Math.floor(i / 3) * 25;
                    ctx.fillStyle = c; ctx.beginPath(); ctx.arc(cx, cy, 10, 0, Math.PI * 2); ctx.fill();
                    if (this.selectedColorIdx === i && this.mode !== 'point' && this.mode !== 'eraser') { ctx.strokeStyle = "white"; ctx.lineWidth = 2; ctx.stroke(); }
                });

                const sizeAreaY = drawAreaY + 145;
                this.sizes.forEach((s, i) => {
                    const cx = 25 + (i % 2) * 55, cy = sizeAreaY + 15 + Math.floor(i / 2) * 35;
                    ctx.fillStyle = "#444"; ctx.beginPath(); ctx.arc(cx, cy, 14, 0, Math.PI * 2); ctx.fill();
                    ctx.fillStyle = "white"; ctx.font = "10px Arial"; ctx.textAlign = "center"; ctx.fillText(s, cx, cy + 4);
                    if (this.selectedSizeIdx === i && this.mode !== 'point') { ctx.strokeStyle = "white"; ctx.lineWidth = 2; ctx.stroke(); }
                });
                drawBtn(10, sizeAreaY + 85, "清空画", "#744", 26);

                const fitBtnY = sizeAreaY + 125;
                let fitBtnText = "原图显示";
                let fitBtnColor = "#555";

                if (this.img) {
                    const isBig = this.img.naturalWidth > this.SUGGESTED_MAX_SIZE || this.img.naturalHeight > this.SUGGESTED_MAX_SIZE;
                    if (isBig) {
                        if (this.isOriginalDisplay) {
                            fitBtnText = "合适尺寸";
                            fitBtnColor = "#E67e22";
                        } else {
                            fitBtnText = "原图显示";
                            fitBtnColor = "#228855";
                        }
                    }
                }
                drawBtn(10, fitBtnY, fitBtnText, fitBtnColor, 28);


                // Canvas 绘制
                if (!this.img) {
                    const centerX = 115 + (this.size[0] - 130) / 2;
                    const centerY = startY + (this.size[1] - startY - 50) / 2;
                    ctx.fillStyle = "#666";
                    ctx.font = "bold 16px Arial";
                    ctx.textAlign = "center";
                    ctx.fillText("请在上方上传或选择图片开始标注", centerX, centerY);
                } else {
                    const rect = this.getCanvasImageRect();
                    ctx.drawImage(this.img, rect.x, rect.y, rect.w, rect.h);
                    if (this.doodleCanvas) { ctx.save(); ctx.globalAlpha = 0.7; ctx.drawImage(this.doodleCanvas, rect.x, rect.y, rect.w, rect.h); ctx.restore(); }

                    this.points.forEach((pt, i) => {
                        const px = rect.x + pt.x * rect.w, py = rect.y + pt.y * rect.h;
                        ctx.fillStyle = pt.color; ctx.beginPath(); ctx.arc(px, py, 11, 0, Math.PI * 2); ctx.fill();
                        ctx.strokeStyle = "white"; ctx.lineWidth = 2; ctx.stroke();
                        const numCol = this.getContrastColor(pt.color);
                        ctx.fillStyle = numCol; ctx.font = "bold 12px Arial"; ctx.textAlign="center"; ctx.fillText(i + 1, px, py + 4);
                        const coordTxt = `${Math.round(pt.x * this.img.naturalWidth)},${Math.round(pt.y * this.img.naturalHeight)}`;
                        ctx.font = "10px monospace";
                        const tw = ctx.measureText(coordTxt).width + 8;
                        const th = 16;
                        let lx = (px + 14 + tw > this.size[0] - 10) ? px - tw - 14 : px + 14;
                        let ly = (py + 14 + th > this.size[1] - 30) ? py - th - 14 : py + 14;
                        ctx.fillStyle = "rgba(0,0,0,0.7)";
                        ctx.beginPath(); ctx.roundRect(lx, ly, tw, th, 3); ctx.fill();
                        ctx.fillStyle = "#00FF00"; ctx.textAlign="left"; 
                        ctx.fillText(coordTxt, lx + 4, ly + 12);
                    });

                    // 画笔预览
                    if (this.mouseInCanvas && this.mode !== "point") {
                        const viewScale = rect.w / this.doodleCanvas.width;
                        ctx.beginPath(); ctx.arc(this.cursorPos.lx, this.cursorPos.ly, (this.brushSize/2)*viewScale, 0, Math.PI*2);
                        ctx.strokeStyle = "rgba(255, 255, 255, 0.8)"; ctx.lineWidth = 1.5; ctx.stroke();
                    }
                    
                    // --- 修改：底部信息显示 ---
                    ctx.fillStyle = "#AAA"; ctx.font = "11px monospace"; ctx.textAlign = "right";
                    const infoTxt = `图片尺寸：${this.img.naturalWidth}x${this.img.naturalHeight} | 当前显示：${Math.round(rect.w)}x${Math.round(rect.h)}`;
                    ctx.fillText(infoTxt, this.size[0] - 15, this.size[1] - 15);
                }
            };

            nodeType.prototype.getCanvasImageRect = function() {
                const yStart = this.getUIStartStackY();
                const availableW = this.size[0] - 130, availableH = this.size[1] - yStart - 50;
                
                if (!this.img) return { x: 115, y: yStart, w: 100, h: 100 };

                const ratio = Math.min(availableW / this.img.width, availableH / this.img.height);
                return { x: 115 + (availableW - this.img.width * ratio)/2, y: yStart + (availableH - this.img.height * ratio)/2, w: this.img.width * ratio, h: this.img.height * ratio };
            };

            nodeType.prototype.getUIStartStackY = function() {
                let maxY = 30; this.widgets?.forEach(w => { if (w.type !== "hidden") maxY = Math.max(maxY, (w.last_y || 0) + (w.computedHeight || 32)); });
                return maxY + 15;
            };

            nodeType.prototype.syncPoints = function() {
                const w = this.widgets.find(w => w.name === "points_data");
                if (w && this.img) {
                    w.value = JSON.stringify(this.points.map(p => ({ x: Math.round(p.x * this.img.naturalWidth), y: Math.round(p.y * this.img.naturalHeight), color: p.color })));
                    this.graph?.change(); 
                }
            };

            nodeType.prototype.syncDoodle = function() {
                const w = this.widgets.find(w => w.name === "doodle_data");
                if (w && this.doodleCanvas) {
                    const dataUrl = this.doodleCanvas.toDataURL("image/png");
                    if (w.value !== dataUrl) { w.value = dataUrl; this.graph?.change(); }
                }
            };

            nodeType.prototype.hideDataWidgets = function() {
                this.widgets?.forEach(w => { if (["points_data", "doodle_data"].includes(w.name)) { w.type = "hidden"; w.computeSize = () => [0, -4]; } });
            };

            nodeType.prototype.rehydrateCanvas = function() {
                if (!this.img || !this.doodleCtx) return;
                const pw = this.widgets.find(w => w.name === "points_data");
                if (pw?.value && pw.value !== "[]" && pw.value !== "") {
                    try { 
                        const pts = JSON.parse(pw.value);
                        if (this.img.naturalWidth > 0) {
                            this.points = pts.map(p => ({ x: p.x/this.img.naturalWidth, y: p.y/this.img.naturalHeight, color: p.color || "#FF6600" })); 
                        }
                    } catch(e) {}
                }
                const dw = this.widgets.find(w => w.name === "doodle_data");
                if (dw?.value?.startsWith("data:image")) {
                    const temp = new Image();
                    temp.onload = () => { this.doodleCtx.clearRect(0, 0, this.doodleCanvas.width, this.doodleCanvas.height); this.doodleCtx.drawImage(temp, 0, 0); this.setDirtyCanvas(true); };
                    temp.src = dw.value;
                }
            };

            nodeType.prototype.onConfigure = function() {
                this.hideDataWidgets();
                const imageWidget = this.widgets.find(w => w.name === "image");
                if (imageWidget?.value) this.loadImage(imageWidget.value, false);
            };

            nodeType.prototype.onSerialize = function(o) {
                this.syncPoints(); this.syncDoodle();
            };
        }
    }
});