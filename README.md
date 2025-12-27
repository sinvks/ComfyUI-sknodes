# 🌟 ComfyUI-SKNodes (SK节点库)

**个人学习过程中根据自己的需要写的几个小节点，目前不支持Nodes2.0**，

后续随着学习会继续增加，节点可能会是杂七杂八一箩筐。

------

![nodes](docs\nodes.jpg)

## ✨ 核心节点介绍

### 1. 交互式标注工具 (Interactive Tools)

- **InteractiveAnnotationTool**: 提供直观的 UI 界面，支持直接在图片上点击以获取精确的像素坐标或归一化坐标。
- **SerialNumberMarks**: 自动为图像中的点击位置添加红底白字的序号圆圈，并输出 JSON 格式的坐标数据，完美适配 Qwen-Edit 的提示词需求。

### 2. 工作流诊断与工具 (Utility Tools)

- **TypeDetector (万能类型检测器)**: 实时检测工作流中任何节点输出的属性，包括张量维度 (Shape)、批大小、元素类型等，是调试复杂工作流的神器。
- **MemoryTools**: 提供一键显存释放和模型卸载功能。支持“温和清理”和“彻底释放（清理节点缓存）”，有效解决长序列生成或视频生成时的 OOM 问题，官方原版释放显存内存功能（新版本中顶部不显示的话可以使用，可以在“设置”--“SKNodes”中开启/关闭显示）。
- **InfoDisplay**: 纯终端日志节点，支持 13 种颜色的心形标识，帮助你在复杂的后台日志中快速定位不同节点的执行输出。

### 3. 提示词处理 (Prompt Tools)

- **PresetPrompt**: 支持从本地 `.txt` (config\\prompts\\目录下)配置文件中加载预设提示词，支持分类管理，让你的常用 Prompt 触手可及。
- **MergePrompt**: 高级提示词合并工具。支持多达 20 路输入，提供预设分隔符（逗号、换行等）及自定义分隔符选项。

------

## 🚀 安装指南

### 方法 A：通过 ComfyUI-Manager（应该是搜不到🤭）

1. 在 ComfyUI-Manager 中搜索 `sknodes`。
2. 点击 **Install**。
3. 重启 ComfyUI。

### 方法 B：手动安装

1. 进入 ComfyUI 的 `custom_nodes` 目录：

   Bash

   ```
   cd ComfyUI/custom_nodes/
   ```

2. 克隆本仓库：

   Bash

   ```
   git clone https://github.com/sinvks/comfyui-sknodes.git
   ```

3. 安装依赖：

   Bash

   ```
   cd comfyui-sknodes
   pip install -r requirements.txt
   ```

------

## 📦 依赖项 (Dependencies)

本插件需要以下 Python 库支持：

- `torch >= 2.1.0` (张量计算与显存管理)
- `numpy >= 1.24.0, < 2.0.0` (图像数组处理)
- `Pillow >= 9.5.0` (标注绘图与字体支持)
- `psutil` (系统内存监控)
- `aiohttp` (异步 Web API 支持)

------

## 🛠 开发与反馈

- **版本**: v1.0.0-beta.1 
- **说明**: 暂不支持Nodes2.0，后续ComfyUI稳定后再说。

------

## 🤝 鸣谢

感谢所有 ComfyUI 社区的开发者提供的灵感，感谢群友的支持💖。