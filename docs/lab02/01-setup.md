# 操作手册01 搭建插件开发环境



## 如何开发调试此插件

- 使用 VSCode Insider 版本 1.90 以上（GitHub Copilot GA 后不再需要）
- 运行 `npm install` 
- 在调试工具栏中启动调试并选择 `Run Extension` 调试目标，这个动作将启动以下步骤:
	- 启动任务 `npm: watch` 动态编译代码
	- 启动新的VSCode调试运行窗口，自动安装当前插件的调试版本并开始运行
	- 可以进行单步调试
- VSCode调试运行窗口中，需要安装 GitHub Copilot