# 个人简历网站模板

这是从原个人简历站提炼的静态模板。它保留深色布局、可交互的粒子背景、项目卡片、移动端布局和 A4 打印版。两页从同一份简历数据读取内容。示例人物和经历均为虚构。

## 手动替换简历

1. 复制 `assets/site/` 整个目录。
2. 用文本编辑器打开目录内的 `resume.js`，替换示例姓名、简介、工作经历和项目。保留开头的 `window.RESUME =` 和末尾分号。中间是一个 JSON 对象，请用双引号包裹键和字符串。
3. 双击 `index.html` 预览。点「A4 简历」可查看打印版，再用「打印 / 保存为 PDF」导出。简历较长时会按 A4 纸张分页。

首页顶部可暂停和启用粒子动效。设备无法运行 WebGL 时会使用 Canvas 动效。系统开启「减少动态效果」时，首页默认显示静态背景。

头像、项目封面和演示视频可放到站点目录下的 `assets/` 中，例如填写 `"./assets/avatar.webp"`。项目没有封面时，卡片会自动使用项目标题。部署时，将 `assets/site/` 内的所有文件和个人媒体一起交给静态托管服务。

## 用 Codex 从现有简历生成

把解压后的整个 `resume-portfolio` 目录放到自己的 `~/.codex/skills/`，在 Codex 里输入下面这句话并附上 PDF、Word 简历或粘贴简历文字。

> $resume-portfolio 用我提供的简历生成个人网站，保留项目经历，并附上 A4 打印版。

## 简历字段

`name` 必填，其余字段可省略。把不需要的列表设为 `[]`，对应分区会自动隐藏。

| 字段 | 填写方式 |
| --- | --- |
| `lang` | `"zh-CN"` 使用中文界面，`"en"` 使用英语界面。简历正文保留你填写的文字。 |
| `name`、`role`、`location`、`avatar` | 姓名、职业标题、地点、头像路径。 |
| `summary` | 简介段落数组，每项一段。 |
| `links` | 联系方式和个人主页。每项填写 `label` 和 `url`，支持 `https:`、`http:`、`mailto:` 和 `tel:`。 |
| `experience`、`education` | 每项填写 `title`，可补充 `subtitle`（例如机构名）、`period`、`summary`、`bullets`（要点数组）和 `links`。 |
| `projects` | 每项填写 `title`，可补充 `category`、`stack`、`summary`、`bullets`、`links`、`coverTitle`、`image` 或 `video`。有多个分类时，首页显示筛选按钮。 |
| `skills` | 每组填写 `label` 和 `items`（技能名称数组）。 |
| `sections` | 自定义分区，例如证书或奖项。每项填写 `title` 和 `entries`，条目的结构与工作经历相同。 |
