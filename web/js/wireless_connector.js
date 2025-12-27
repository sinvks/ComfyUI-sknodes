import { app } from "../../../scripts/app.js"; 

// ==============================================================================
// **核心配置区域 **
// ==============================================================================
const SET_NODE_NAME = "SetNode"; 
const GET_NODE_NAME = "GetNode"; 
const COLLAPSE_DELAY_MS = 50; 
const NAME_WIDGET_KEY_1 = "name";      
const NAME_WIDGET_KEY_2 = "link_name"; 
const WIDGET_OLD_NAME_KEY = "_kj_old_name"; // 用于存储 oldName (Widget 级别)
let lastContextMenuEvent = null; 
// ==============================================================================

// --- 实用工具函数 ---

function generateRandom4Digits() {
    return Math.floor(1000 + Math.random() * 9000).toString();
}

function findNameWidget(node) {
    if (!node.widgets) return null;

    let widget = node.widgets.find(w => w.name === NAME_WIDGET_KEY_1);
    if (widget) return widget;

    widget = node.widgets.find(w => w.name === NAME_WIDGET_KEY_2);
    if (widget) return widget;
    
    // Fallback: 使用第一个有值的 Widget
    if (node.widgets.length > 0 && node.widgets[0].value !== undefined) {
         return node.widgets[0];
    }
    
    return null;
}

function setNodeCollapsed(node, isCollapsed) {
    if (!node) return;
    try {
        node.flags = node.flags || {};
        node.flags.collapsed = isCollapsed; 
        node._collapsed = isCollapsed;
        if (typeof node.set_collapsed === 'function') {
            node.set_collapsed(isCollapsed);
        }
        node.setSize(node.computeSize()); 
        if (typeof node.onResize === 'function') {
            node.onResize(); 
        }
        app.graph.setDirtyCanvas(true, true); 
    } catch (e) {
        console.error("--- KJNodes ERROR: setNodeCollapsed 失败:", e);
    }
}


// --- 核心同步逻辑 (SetNode -> GetNode) ---
function updateGetNodes(setNode, oldName, newName) {
    if (!newName || !oldName || oldName === newName) return;

    try {
        const getNodes = app.graph.findNodesByType(GET_NODE_NAME);
        if (!getNodes || getNodes.length === 0) return;

        getNodes.forEach(getNode => {
            const getNameWidget = findNameWidget(getNode);
            
            if (getNameWidget && getNameWidget.value === oldName) { 
                getNameWidget.value = newName;
                getNode.title = "GET_" + newName;
                getNode.setSize(getNode.computeSize());
                if (typeof getNode.onResize === 'function') {
                    getNode.onResize();
                }
            }
        });

        const setNameWidget = findNameWidget(setNode);
        if (setNameWidget) {
            setNode.title = "SET_" + newName;
            // 更新 Widget 上的存储属性，供下一次更改使用
            setNameWidget[WIDGET_OLD_NAME_KEY] = newName; 
        }

        setNode.setSize(setNode.computeSize());
        if (typeof setNode.onResize === 'function') {
            setNode.onResize();
        }
        
        app.graph.setDirtyCanvas(true, true);
        console.log(`--- KJNodes SYNC: Synchronized from "${oldName}" to "${newName}"`);
    } catch (e) {
        console.error("--- KJNodes ERROR: updateGetNodes 同步失败:", e);
    }
}

// --- 核心转换逻辑 - 优化安全回退布局 ---
function transformOutputToGetSet(originNode, originSlot, linkName, graph, isCollapsed = false) {
    if (typeof window.LiteGraph === 'undefined') {
        console.error("--- KJNodes ERROR: window.LiteGraph 核心对象丢失。---");
        return;
    }
    const LiteGraph = window.LiteGraph;
    
    try {
        const slotInfo = originNode.outputs[originSlot];
        const outputType = slotInfo.type;
        
        // 提取连接逻辑
        const targetConnections = [];
        if (slotInfo.links && slotInfo.links.length > 0) {
             for (const linkId of slotInfo.links) {
                const link = graph.links[linkId];
                if (!link || link.origin_id !== originNode.id || link.origin_slot !== originSlot) continue;
                targetConnections.push({ linkId: linkId, targetNodeId: link.target_id, targetSlot: link.target_slot, });
            }
        }
        if (targetConnections.length === 0) return;

        // 1. 创建 Set Node
        let setNode = null;
        try {
            setNode = LiteGraph.createNode(SET_NODE_NAME);
            if (!setNode) throw new Error(`KJNodes/Set Node not found: ${SET_NODE_NAME}`);
        } catch(e) {
            console.error(`--- KJNodes FATAL ERROR: 无法创建 Set Node (${SET_NODE_NAME})：`, e);
            throw e; 
        }

        // 定位逻辑 - 优先使用 getSlotPos，如果不存在则使用优化后的回退
        if (typeof originNode.getSlotPos === 'function') {
            // 精确布局 (V84 逻辑)
            const outputPos = originNode.getSlotPos(originSlot, false); // false = output
            setNode.pos[0] = outputPos[0] + 15;
            setNode.pos[1] = outputPos[1] - 30; // 估算偏移
            
        } else {
            // 安全回退布局
            // 基于节点整体位置放置 SetNode，减小水平偏移
            setNode.pos[0] = originNode.pos[0] + originNode.size[0] + 20; // 50 -> 20
            setNode.pos[1] = originNode.pos[1];
            console.warn("--- KJNodes WARNING: 节点不支持 getSlotPos，使用安全回退布局。---");
        }

        graph.add(setNode); 
        
        const setNameWidget = findNameWidget(setNode);
        if (setNameWidget) { 
            setNameWidget.value = linkName; 
            setNode.title = "SET_" + linkName; 
            setNameWidget[WIDGET_OLD_NAME_KEY] = linkName; // 初始化 Widget 同步属性
        }
        
        if (setNode.inputs && setNode.inputs.length > 0 && setNode.inputs[0]) {
            setNode.inputs[0].type = outputType;
            setNode.inputs[0].name = outputType;
            originNode.connect(originSlot, setNode, 0);
        } 
        setNode.setSize(setNode.computeSize()); 

        // 2. 创建 Get Node
        let getNodesCreated = 0; 
        const createdGetNodes = []; 
        
        for (const conn of targetConnections) {
            const targetNode = app.graph.getNodeById(conn.targetNodeId); 
            if (!targetNode) continue;
            
            let getNode = null;
            try {
                getNode = LiteGraph.createNode(GET_NODE_NAME);
                if (!getNode) throw new Error(`KJNodes/Get Node not found: ${GET_NODE_NAME}`);
            } catch(e) {
                if (setNode) graph.remove(setNode);
                console.error(`--- KJNodes FATAL ERROR: 无法创建 Get Node (${GET_NODE_NAME})：`, e);
                throw e; 
            }
            
            // GetNode 定位逻辑 - 同样增加安全检查
            if (typeof targetNode.getSlotPos === 'function') {
                // 精确布局 (V84 逻辑)
                const inputPos = targetNode.getSlotPos(conn.targetSlot, true); // true = input
                const shiftY = getNodesCreated * 100; // 多个 GetNode 向下偏移
                
                // SetNode默认宽度约100
                getNode.pos[0] = inputPos[0] - 100 - 15; 
                getNode.pos[1] = inputPos[1] - 30 + shiftY;
                
            } else {
                // 安全回退布局
                const shiftY = getNodesCreated * 100;
                // X: 减小水平偏移 50 -> 20
                getNode.pos[0] = targetNode.pos[0] - getNode.size[0] - 20;
                // Y: 垂直偏移 +30，以对齐大致的第一个输入槽位
                getNode.pos[1] = targetNode.pos[1] + 30 + shiftY;
            }

            graph.add(getNode); 
            getNodesCreated++;
            createdGetNodes.push(getNode); 
            
            const getNameWidget = findNameWidget(getNode);
            if (getNameWidget) { 
                getNameWidget.value = linkName; 
                getNode.title = "GET_" + linkName;
            }

            if (getNode.outputs && getNode.outputs.length > 0 && getNode.outputs[0]) {
                getNode.outputs[0].type = outputType;
                getNode.outputs[0].name = outputType;
                getNode.connect(0, targetNode, conn.targetSlot); 
            } 
            graph.removeLink(conn.linkId);
            getNode.setSize(getNode.computeSize()); 
        }
        
        // 3. 延迟折叠
        if (isCollapsed) {
            setTimeout(() => {
                setNodeCollapsed(setNode, true);
                createdGetNodes.forEach(node => setNodeCollapsed(node, true));
            }, COLLAPSE_DELAY_MS);
        } else {
            app.graph.setDirtyCanvas(true, true);
        }
        
        console.log(`--- KJNodes SUCCESS: 节点转换完成 (菜单/同步/布局优化修复)。---`);
    } catch (e) {
        console.error("--- KJNodes FATAL ERROR: 转换失败。", e);
        throw e;
    }
}

// --- 菜单注入工具 ---
function addMenuHandler(nodeType, cb) {
    const getOpts = nodeType.prototype.getExtraMenuOptions || function(options) { return options; };
    nodeType.prototype.getExtraMenuOptions = function (options) {
        cb.apply(this, arguments);
        const r = getOpts.apply(this, arguments);
        return r;
    };
}

function addGetSetMenu(node, options) {
    
    if (node.type === SET_NODE_NAME) {
        return; 
    }
    
    if (!window.LiteGraph) return; 
    
    if (node.outputs && node.outputs.length > 0) {
        
        const submenuOptions = [];

        node.outputs.forEach((slotInfo, index) => {
            if (!slotInfo || slotInfo.type === window.LiteGraph.EVENT) return;
            
            let alreadyConverted = false;
            if (slotInfo.links && slotInfo.links.length > 0) {
                for (const linkId of slotInfo.links) {
                    const link = app.graph.links[linkId];
                    if (link) {
                        const targetNode = app.graph.getNodeById(link.target_id);
                        if (targetNode && targetNode.type === SET_NODE_NAME) { 
                            alreadyConverted = true;
                            break;
                        }
                    }
                }
            }
            
            if (alreadyConverted) return; 
            
            submenuOptions.push({
                content: `${slotInfo.name}`,
                callback: function() { 
                    const randomDigits = generateRandom4Digits();
                    const linkName = slotInfo.name + "_" + randomDigits; 
                    transformOutputToGetSet(node, index, linkName.trim(), app.graph, false); 
                }
            });

            submenuOptions.push({
                content: `${slotInfo.name} (折叠)`,
                callback: function() { 
                    const randomDigits = generateRandom4Digits();
                    const linkName = slotInfo.name + "_" + randomDigits; 
                    transformOutputToGetSet(node, index, linkName.trim(), app.graph, true); 
                }
            });
        }); 

        if (submenuOptions.length > 0) {
            
            if (!options || !Array.isArray(options)) options = [];
            if (options.length > 0 && options[options.length - 1] !== null) {
                options.push(null); 
            }
            
            options.push({
                content: "转换为 SET/GET",
                callback: function(item, options, event, prevMenu) { 
                    
                    if (window.LiteGraph.ContextMenu.active_menu) {
                        window.LiteGraph.ContextMenu.active_menu.close();
                        window.LiteGraph.ContextMenu.active_menu = null; 
                    }
                    
                    const posEvent = lastContextMenuEvent || event; 
                    
                    if (posEvent) {
                         new window.LiteGraph.ContextMenu(submenuOptions, {
                            event: posEvent, 
                            parentMenu: null, 
                            node: node
                        });
                    } else {
                         console.error("--- KJNodes DEBUGGER ERROR: 无法获取鼠标坐标，无法创建子菜单。---");
                    }

                    return null; 
                }
            });
        }
    }
}


// ==========================================================================
// ** 核心扩展块：合并所有功能 **
// ==========================================================================
app.registerExtension({
    name: "sklibs.CombinedExtension",
    
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        
        // 1. 菜单注入
        addMenuHandler(nodeType, function (_, options) {
            try {
                addGetSetMenu(this, options);
            } catch (e) {
                console.error("--- KJNodes ERROR : 菜单注入失败:", e);
            }
        });
    },
    
    init() {
        console.log("--- KJNodes DEBUGGER: 核心扩展已加载 (菜单/同步/布局优化)。---");
        
        // 菜单上下文事件监听
        document.addEventListener('contextmenu', (e) => {
             lastContextMenuEvent = e;
        }, true);
        
        // 2. Widget 监听同步逻辑
        app.graph.onNodeAdded = (node) => {
            
            if (node.type === SET_NODE_NAME) {
                
                const nameWidget = findNameWidget(node);
                if (!nameWidget || nameWidget.type !== 'text') {
                    return;
                }
                
                // 确保 Widget 被创建时，旧名称被初始化
                if (nameWidget[WIDGET_OLD_NAME_KEY] === undefined) {
                    nameWidget[WIDGET_OLD_NAME_KEY] = nameWidget.value || "";
                }
                
                const originalCallback = nameWidget.callback;
                
                // 劫持 Widget 的回调函数
                nameWidget.callback = (newValue) => {
                    
                    const oldName = nameWidget[WIDGET_OLD_NAME_KEY]; 
                    const newName = newValue;
                    
                    try {
                        // 执行同步逻辑
                        updateGetNodes(node, oldName, newName);
                        
                    } catch (e) {
                        console.error("--- KJNodes ERROR : 同步回调失败:", e);
                    }
                    
                    // 最后调用原始回调
                    if (originalCallback) {
                        originalCallback.apply(nameWidget, [newValue]);
                    }
                };
                
                console.log(`--- KJNodes DEBUGGER: SetNode 同步监听器已设置。---`);
            }
        };
    }
});