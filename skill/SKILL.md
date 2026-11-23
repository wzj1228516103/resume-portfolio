---
name: resume-portfolio
description: Turn an existing résumé, CV, or portfolio brief into a reusable static website and printable A4 résumé. Use when the user supplies résumé text, a PDF or Word résumé, or structured experience and wants this dark portfolio layout with project cards.
---

# 简历网站模板

使用 [assets/site](assets/site/) 作为网站底稿。首页 `index.html` 和 A4 打印页 `resume.html` 共用 `resume.js`。数据格式和可选字段见 [使用说明](README.md#简历字段)。

1. 从用户提供的简历中提取可用于个人网站的内容。保留姓名、任职时间、机构、项目角色和成果的原意，沿用简历语言。提取 PDF 或 Word 时先确认正文可读，扫描件需要 OCR。可省略原文缺失的信息。
2. 将 `assets/site` 的全部内容复制到用户指定的网站目录。未指定时在当前工作区创建新的 `resume-site` 目录。如果用户要更新已有的同款网站，直接在指定目录修改。保护模板底稿和用户的原始简历。
3. 在站点副本的 `resume.js` 中用用户资料替换整个示例对象。保留 `window.RESUME =`，用 JSON 序列化正文对象以正确转义引号和换行。工作、教育、项目和技能按字段写入，证书、奖项、发表成果等可放入 `sections`。添加用户提供且适合公开的链接或媒体。相对媒体放到站点的 `assets/` 下，路径以站点根目录为基准。
4. 打开首页和 A4 页验证内容一致，检查窄屏、项目详情锚点及可选媒体。确认生成目录中已替换所有示例简历内容。交付完整网站目录和首页入口。用户明确要求 PDF 时，从 A4 页打印并检查分页。用户要求发布时，遵循其指定的平台和访问范围。

用法示例：`$resume-portfolio 用我上传的简历生成个人网站，保留项目经历和邮箱。`
