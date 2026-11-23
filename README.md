# Resume Portfolio

用一份简历数据生成个人作品集网站和可打印的 A4 简历。模板包含可筛选的项目卡片、会响应鼠标和触摸的粒子背景，以及适配手机的布局。用浏览器打开即可预览。

[在线演示](https://wzj1228516103.github.io/resume-portfolio/) · [使用此模板](https://github.com/wzj1228516103/resume-portfolio/generate) · [下载 Codex Skill](https://github.com/wzj1228516103/resume-portfolio/releases/latest)

![Resume Portfolio 桌面预览，左边是项目卡片，中间是粒子背景，右边是简历](screenshots/desktop.png)

<details>
<summary>查看手机预览</summary>

![手机预览，个人简介在上，项目卡片在下](screenshots/mobile.png)

</details>

## 用自己的简历上线

1. 点击 GitHub 页面上的 **Use this template**，创建自己的仓库。
2. 编辑 [`docs/resume.js`](docs/resume.js)，替换示例姓名、工作经历和项目。首页和 A4 版会一起更新。头像、封面和视频可以放到 `docs/assets/`，用 `./assets/文件名` 引用。需要先在本地看效果时，下载仓库并双击 `docs/index.html`。
3. 在自己的仓库进入 **Settings → Pages**，选择 **Deploy from a branch**，分支为 `main`，目录为 `/docs`，然后保存。部署完成后，Pages 设置页会显示网站地址。

简历数据随站点公开。请在 `resume.js` 和媒体目录中填入你愿意对外展示的信息。完整字段见[简历字段说明](skill/README.md#简历字段)。

打开网页右上角的 **A4 简历**，点击 **打印 / 保存为 PDF** 即可导出。中英文界面由 `resume.js` 的 `lang` 字段切换。

## 从 PDF、Word 或文字生成

下载 [`resume-portfolio-skill.zip`](https://github.com/wzj1228516103/resume-portfolio/releases/latest/download/resume-portfolio-skill.zip)，把解压出的 `resume-portfolio` 目录放到自己的 `~/.codex/skills/`。上传简历文件或粘贴文字，在 Codex 中输入：

> $resume-portfolio 把这份简历做成个人网站，并保留可打印的 A4 版。

## 源码与贡献

- [`docs/`](docs/) 是网站源码和 GitHub Pages 的发布目录。
- [`skill/`](skill/) 是 Skill 的指令与使用说明。运行 `python scripts/package-skill.py` 会把网站源码和 Skill 一起打成 `dist/resume-portfolio-skill.zip`。
- 欢迎提交 Issue 或 Pull Request。修正渲染或字段时，请一起检查首页和 A4 版。

项目使用 [MIT 许可证](LICENSE)。随附的 Three.js 保留其 [MIT 许可证](docs/motion/three-LICENSE.txt)。
