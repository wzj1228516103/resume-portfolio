# Resume Portfolio

一套可自托管的个人作品集，包含静态简历网站、A4 打印简历和 AI 问答服务。网站保留项目卡片、交互式粒子背景、底部 AI 输入栏和中央回答区。AI 使用同仓库内的 Portfolio Agent 检索作品资料，通过 SSE 流式回答。

[打开演示](https://wzj1228516103.github.io/resume-portfolio/) · [预览 A4 简历](https://wzj1228516103.github.io/resume-portfolio/resume.html) · [使用此模板](https://github.com/wzj1228516103/resume-portfolio/generate) · [下载 Codex Skill](https://github.com/wzj1228516103/resume-portfolio/releases/latest)

![Resume Portfolio 桌面预览，左边是项目卡片，中间是粒子背景，右边是简历](screenshots/desktop.png)

## 快速开始

**预览静态简历**。下载或复制仓库，双击 [`docs/index.html`](docs/index.html)。修改 [`docs/resume.js`](docs/resume.js) 后，首页和 A4 打印版会一起更新。

**本地运行网站和 AI**。需要 Node.js 22.19 或更新版本。在仓库根目录执行：

```sh
npm ci
cp agent/.env.example agent/.env
```

Windows PowerShell 用 `Copy-Item agent/.env.example agent/.env`。在 `agent/.env` 中填写自己的 `DEEPSEEK_API_KEY`，再从仓库根目录运行：

```sh
npm start
```

打开 [http://127.0.0.1:3000/](http://127.0.0.1:3000/)，试问「岸线协作台里，设计师负责什么？」本地启动器会为页面设置同源问答地址。要更换端口，设置 `agent/.env` 中的 `SITE_PORT`。

示例资料来自 [`agent/public-rag/example-profile.md`](agent/public-rag/example-profile.md)。可在 `agent/.env` 中用 `KNOWLEDGE_DIR` 指向自己的资料目录。Agent 会将检索到的片段随问题发送给配置的模型服务。[后端配置和 API 说明](agent/README.md)

## 页面预览

### 项目筛选和详情

按分类筛选项目，点击卡片跳到详细介绍。项目可附上封面、视频和外部链接。

[![已筛选产品设计项目，右侧展开岸线协作台详情](screenshots/project-detail.png)](https://wzj1228516103.github.io/resume-portfolio/#project-1)

| 手机浏览 | A4 打印版 |
| --- | --- |
| 简介排在最上方，项目卡片按两列展示。 | 用浏览器打印，或保存为 PDF。 |
| <img src="screenshots/mobile.png" width="270" alt="手机上的个人简介、导航和两列项目卡片"> | <a href="https://wzj1228516103.github.io/resume-portfolio/resume.html"><img src="screenshots/a4-preview.png" width="340" alt="A4 简历全页预览，含经历、项目、技能和教育"></a> |

## 部署作品集

1. 点击 GitHub 页面上的 **Use this template**，创建自己的仓库。
2. 编辑 [`docs/resume.js`](docs/resume.js)，替换姓名、工作经历和项目。打开 `docs/index.html` 检查首页，再点右上角的 **A4 简历** 检查打印版。两页从同一份文件读取内容。
3. 在自己的仓库进入 **Settings → Pages**，选择 **Deploy from a branch**，分支为 `main`，目录为 `/docs`，然后保存。部署完成后，Pages 设置页会显示网站地址。

头像、封面和视频可以放到 `docs/assets/`，用 `./assets/文件名` 引用。通过 `lang` 切换中英文界面，空的项目或经历分区会自动隐藏。站点会公开你填入的资料，演示中的姓名和经历均为虚构。[简历字段说明](skill/README.md#简历字段)

## 从 PDF、Word 或文字生成

下载 [`resume-portfolio-skill.zip`](https://github.com/wzj1228516103/resume-portfolio/releases/latest/download/resume-portfolio-skill.zip)，把解压出的 `resume-portfolio` 目录放到自己的 `~/.codex/skills/`。上传简历文件或粘贴文字，在 Codex 中输入：

> `$resume-portfolio` 把这份简历做成个人网站，并保留可打印的 A4 版。

## 给线上网站接入 AI

GitHub Pages 发布 `docs/` 中的静态网站。对话栏默认显示服务尚未接入。要启用线上问答，把同仓库里的 Agent 部署在 Node.js 主机上，再为网站配置网关。

![底部 AI 输入栏和中央流式回答](screenshots/ai-chat.png)

截图使用虚构资料和模拟网关响应。

1. 在 Node.js 主机上安装依赖和配置服务端环境变量，然后从仓库根目录运行 `npm run agent`。公开模式的资料白名单、令牌和网关设置见 [Agent 部署说明](agent/README.md#接入公开作品集)。
2. 打开 [`docs/chat-config.js`](docs/chat-config.js)，把 `endpoint` 设为公开网关的 HTTPS 地址，例如 `https://api.example.com/chat/stream`。跨域部署时，网关需允许网站的 Origin。localhost 可使用 HTTP 测试。
3. 如果 Agent 开启了访客验证，同时填写同一网关的 `accessEndpoint`（例如 `/chat/access`）和你自己的 Turnstile **公开站点键** `turnstileSiteKey`。页面在发送提问前验证访客，短期访客令牌保存在当前页面内存中。

模型密钥、Agent 令牌和 Turnstile 验证密钥放在服务端的 `agent/.env` 或部署环境中。仓库中的配置示例保留空白字段，公开资料只放入你愿意展示给访客的内容。

[查看检索、终端和流式输出示例](agent/README.md#检索和流式输出)

## 源码与贡献

- [`docs/`](docs/) 是网站源码和 GitHub Pages 的发布目录。
- [`agent/`](agent/) 是问答后端、资料检索和本地启动器。根目录的 npm workspace 统一安装依赖。
- [`skill/`](skill/) 是 Skill 的指令与使用说明。运行 `python scripts/package-skill.py` 会把静态网站和 Skill 打成 `dist/resume-portfolio-skill.zip`。
- 运行 `npm run typecheck` 和 `npm test` 检查类型、访客访问、配额和本地网页到 Agent 的流式链路。模型调用使用模拟响应。

项目使用 [MIT 许可证](LICENSE)。随附的 [Three.js](docs/motion/three-LICENSE.txt) 和 [Marked](docs/marked-LICENSE.txt) 保留各自的 MIT 许可证。
