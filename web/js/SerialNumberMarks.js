import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

app.registerExtension({
    name: "CloserAI.TouchEdit",
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name === "SerialNumberMarks") {
            
            nodeType.prototype.onNodeCreated = function() {
                this.points = [];
                this.img = null;
                this.draggingPoint = null;
                this.longPressTimer = null;
                this.longPressTriggered = false;
                this.mouseDownPos = [0, 0];

                const pointsWidget = this.widgets.find(w => w.name === "points_data");
                pointsWidget.type = "hidden";

                const imageWidget = this.widgets.find(w => w.name === "image");
                imageWidget.callback = (value) => this.loadImage(value);

                this.loadImage = (name) => {
                    if (!name) return;
                    const img = new Image();
                    img.src = api.apiURL(`/view?filename=${encodeURIComponent(name)}&type=input&t=${new Date().getTime()}`);
                    img.onload = () => { 
                        this.img = img; 
                        this.setDirtyCanvas(true); 
                    };
                };

                this.addWidget("button", "清空所有标记", "clear", () => {
                    this.points = [];
                    this.syncPoints();
                });

                const self = this;
                const releaseHandler = () => {
                    if (self.longPressTimer) { clearTimeout(self.longPressTimer); self.longPressTimer = null; }
                    self.draggingPoint = null;
                    self.longPressTriggered = false;
                };
                window.addEventListener("mouseup", releaseHandler);
                this.onRemoved = () => window.removeEventListener("mouseup", releaseHandler);

                this.size = [400, 640];
            };

            nodeType.prototype.onConfigure = function() {
                const imageWidget = this.widgets.find(w => w.name === "image");
                if (imageWidget && imageWidget.value) this.loadImage(imageWidget.value);
            };

            nodeType.prototype.getCanvasImageRect = function() {
                const visibleWidgets = this.widgets.filter(w => w.type !== "hidden");
                const yOffset = visibleWidgets.length > 0 ? (visibleWidgets[visibleWidgets.length - 1].last_y || 120) + 15 : 100;
                const margin = 10;
                const areaW = this.size[0] - margin * 2;
                const areaH = this.size[1] - yOffset - margin - 25; 
                
                if (!this.img || areaH < 10) return { x: margin, y: yOffset, w: areaW, h: Math.max(10, areaH) };

                const imgAspect = this.img.width / this.img.height;
                const areaAspect = areaW / areaH;
                let drawW, drawH;
                if (imgAspect > areaAspect) {
                    drawW = areaW; drawH = areaW / imgAspect;
                } else {
                    drawH = areaH; drawW = areaH * imgAspect;
                }
                return { x: margin + (areaW - drawW) / 2, y: yOffset + (areaH - drawH) / 2, w: drawW, h: drawH };
            };

            nodeType.prototype.onDrawBackground = function(ctx) {
                if (this.flags.collapsed) return;
                const rect = this.getCanvasImageRect();
                
                if (this.img) {
                    ctx.drawImage(this.img, rect.x, rect.y, rect.w, rect.h);
                    ctx.save();
                    ctx.fillStyle = "#AAA"; ctx.font = "12px Arial"; ctx.textAlign = "center"; ctx.textBaseline = "top";
                    ctx.fillText(`${this.img.naturalWidth} x ${this.img.naturalHeight}`, rect.x + rect.w / 2, rect.y + rect.h + 5);
                    ctx.restore();
                }

                ctx.save();
                this.points.forEach((pt, i) => {
                    const px = rect.x + pt.x * rect.w;
                    const py = rect.y + pt.y * rect.h;
                    
                    // 1. 绘制标记圆圈
                    ctx.fillStyle = "#00FF00";
                    ctx.beginPath(); ctx.arc(px, py, 12, 0, Math.PI * 2); ctx.fill();
                    ctx.strokeStyle = "white"; ctx.lineWidth = 2; ctx.stroke();

                    // 2. 绘制圆圈内的序号 (向下移动1像素)
                    ctx.fillStyle = "black";
                    ctx.font = "bold 14px Arial";
                    ctx.textAlign = "center";
                    ctx.textBaseline = "middle";
                    ctx.fillText(i + 1, px, py + 1); // 修改：原为 py-1，现改为 py+1 居中

                    // 3. 绘制上方坐标值（白色圆角背景+自动避让边缘）
                    if (this.img) {
                        const realX = Math.round(pt.x * this.img.naturalWidth);
                        const realY = Math.round(pt.y * this.img.naturalHeight);
                        const coordStr = `(${realX}, ${realY})`;
                        
                        ctx.font = "10px Arial";
                        const textWidth = ctx.measureText(coordStr).width;
                        const bgW = textWidth + 8;
                        const bgH = 14;
                        
                        // 初始位置：圆圈上方
                        let bgX = px - bgW / 2;
                        let bgY = py - 28;

                        // 边缘避让检测
                        if (bgY < rect.y) bgY = py + 18; // 如果上方超出，移到下方
                        if (bgX < rect.x) bgX = rect.x; // 左侧避让
                        if (bgX + bgW > rect.x + rect.w) bgX = rect.x + rect.w - bgW; // 右侧避让

                        // 绘制圆角矩形背景
                        ctx.fillStyle = "white";
                        this.drawRoundedRect(ctx, bgX, bgY, bgW, bgH, 4);
                        ctx.fill();
                        
                        // 绘制坐标文字
                        ctx.fillStyle = "black";
                        ctx.textAlign = "left";
                        ctx.textBaseline = "middle";
                        ctx.fillText(coordStr, bgX + 4, bgY + bgH/2 + 0.5);
                    }
                });
                ctx.restore();
            };

            // 圆角矩形辅助函数
            nodeType.prototype.drawRoundedRect = function(ctx, x, y, width, height, radius) {
                ctx.beginPath();
                ctx.moveTo(x + radius, y);
                ctx.lineTo(x + width - radius, y);
                ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
                ctx.lineTo(x + width, y + height - radius);
                ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
                ctx.lineTo(x + radius, y + height);
                ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
                ctx.lineTo(x, y + radius);
                ctx.quadraticCurveTo(x, y, x + radius, y);
                ctx.closePath();
            };

            nodeType.prototype.syncPoints = function() {
                const w = this.widgets.find(w => w.name === "points_data");
                if (w && this.img) {
                    const pixelPoints = this.points.map(p => ({
                        x: Math.round(p.x * this.img.naturalWidth),
                        y: Math.round(p.y * this.img.naturalHeight)
                    }));
                    w.value = JSON.stringify(pixelPoints);
                }
                this.setDirtyCanvas(true);
            };

            nodeType.prototype.onMouseDown = function(e, localPos) {
                if (e.button !== 0) return;
                const rect = this.getCanvasImageRect();
                const x = (localPos[0] - rect.x) / rect.w;
                const y = (localPos[1] - rect.y) / rect.h;
                if (x >= 0 && x <= 1 && y >= 0 && y <= 1) {
                    this.mouseDownPos = [...localPos];
                    const hitIdx = this.points.findIndex(p => Math.hypot(p.x - x, p.y - y) < (25 / rect.w));
                    if (hitIdx !== -1) {
                        this.draggingPoint = hitIdx;
                        this.longPressTimer = setTimeout(() => {
                            this.points.splice(hitIdx, 1);
                            this.draggingPoint = null; this.longPressTriggered = true; this.syncPoints();
                        }, 1000);
                    } else {
                        this.points.push({ x, y }); this.syncPoints();
                    }
                    return true;
                }
            };

            nodeType.prototype.onMouseMove = function(e, localPos) {
                if (this.draggingPoint !== null && !this.longPressTriggered && e.buttons === 1) {
                    if (Math.hypot(localPos[0] - this.mouseDownPos[0], localPos[1] - this.mouseDownPos[1]) > 5) {
                        if (this.longPressTimer) { clearTimeout(this.longPressTimer); this.longPressTimer = null; }
                        const rect = this.getCanvasImageRect();
                        this.points[this.draggingPoint].x = Math.max(0, Math.min(1, (localPos[0] - rect.x) / rect.w));
                        this.points[this.draggingPoint].y = Math.max(0, Math.min(1, (localPos[1] - rect.y) / rect.h));
                        this.syncPoints();
                    }
                }
            };
        }
    }
});