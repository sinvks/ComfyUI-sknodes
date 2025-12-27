import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";
import { ComfyButtonGroup } from "/scripts/ui/components/buttonGroup.js";
import { ComfyButton } from "/scripts/ui/components/button.js";

// --- 插件唯一 ID (用于设置分类) ---
const PLUGIN_ID = "SKNodes.MemoryTools";

app.registerExtension({
    name: PLUGIN_ID,

    async setup() {
        // --- 1. 注册设置项 ---
        // 核心：ID 必须包含至少一个点号。第一部分会被用作左侧菜单的分类名。
        const settingId = `${PLUGIN_ID}.General.ShowOnTop`;

        app.ui.settings.addSetting({
            id: settingId,
            name: "在顶部栏显示内存/显存清理按钮",
            type: "boolean",
            defaultValue: true,
            onChange: (value) => {
                // 当设置改变时，直接切换按钮组的显示状态
                if (this.buttonGroup?.element) {
                    this.buttonGroup.element.style.display = value ? "flex" : "none";
                }
            },
        });

        // --- 2. 创建按钮 UI ---
        const btnReleaseVRAM = new ComfyButton({
            icon: "vacuum-outline",
            tooltip: "释放模型显存 (Unload Models)",
            action: () => api.fetchApi("/memory/release_model_vram", { method: "POST" }),
            classList: "comfyui-button primary"
        });

        const btnDeepClean = new ComfyButton({
            icon: "vacuum",
            tooltip: "深度清理 (Free Model & Node Cache)",
            action: () => api.fetchApi("/memory/release_all", { method: "POST" }),
            classList: "comfyui-button primary"
        });

        // 保存到 extension 实例中方便 onChange 访问
        this.buttonGroup = new ComfyButtonGroup(btnReleaseVRAM, btnDeepClean);
        const groupEl = this.buttonGroup.element;

        // --- 3. 插入 UI 并初始化状态 ---
        const refreshVisibility = () => {
            const isEnabled = app.ui.settings.getSettingValue(settingId, true);
            groupEl.style.display = isEnabled ? "flex" : "none";
        };

        const tryInsert = () => {
            // 尝试插入到顶部菜单的“设置组”之前
            const target = app.menu?.settingsGroup?.element;
            if (target) {
                target.before(groupEl);
                refreshVisibility();
                return true;
            }
            return false;
        };

        // 如果菜单还没加载好，循环尝试
        if (!tryInsert()) {
            const timer = setInterval(() => {
                if (tryInsert()) clearInterval(timer);
            }, 500);
            // 5秒后停止尝试，防止无限循环
            setTimeout(() => clearInterval(timer), 5000);
        }
    }
});