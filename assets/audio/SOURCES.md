# Demo 管弦乐采样来源

本目录的采样来自 [Versilian Studios — VS Chamber Orchestra: Community Edition](https://github.com/sgossner/VSCO-2-CE)，由 Sam Gossner 与 Simon Dalzell 录制。该仓库标为 CC0 1.0；许可证副本见 [LICENSE-CC0.txt](LICENSE-CC0.txt)。

本 Demo 选取 52 个音高／奏法样本，覆盖第一、第二小提琴合奏、中提琴合奏、大提琴合奏、低音提琴、长笛、双簧管、单簧管、巴松、圆号、小号、长号、低音号、定音鼓、竖琴、大鼓、钹与锣。小提琴拨弦和颤弓、竖琴拨奏与定音鼓击奏使用原库相应奏法的独立录音；大鼓、钹和锣各使用弱奏与强奏两层独立录音，播放器按谱面力度选择最近的层，并保持原速播放而不做音高移调。连奏、分离奏与圆号渐强则在延音采样上用时间及力度包络近似，不宣称是真正录制的连奏过渡或分离弓采样。第二小提琴复用小提琴合奏延音采样，但有独立声部与声像。逐个文件的原始路径见 [`scripts/fetch-audio.ps1`](../../scripts/fetch-audio.ps1)；机器可读的映射见 [`manifest.json`](manifest.json)。

《悲怆》原始 MusicXML 含 52 个相关记谱对象：38 个大鼓音符、8 个钹音符与 6 个锣音符。钹和锣中的跨小节连音会在转换时合并，因此浏览器演奏计划包含 44 次独立发声：大鼓 38 次、钹 4 次、锣 2 次。

[`scripts/prepare-audio.mjs`](../../scripts/prepare-audio.mjs)将原始 WAV 下混为单声道、重采样为 32 kHz，并按乐器与奏法共用一个校准增益：以组内有效响度中位数为参考，最高峰值不超过 0.78。这样弱奏与强奏录音保留原有相对电平，再保存为 16-bit PCM。[`scripts/embed-samples.mjs`](../../scripts/embed-samples.mjs)把处理后的文件嵌入 JavaScript，以便直接打开本地 HTML 时也能播放。Demo 的主题、和声与编配由本项目新写，不来自这套采样库的现成曲目。

播放器默认使用 `rounded-v1` 混音：高弦、铜管及打击乐分别做温和高频衰减，房间混响降低高频和湿声比例，并减轻总线压缩。测试时可在页面地址加 `?mix=legacy`，使用旧混音参数对照；两种配置共用当前重新制作的采样。
