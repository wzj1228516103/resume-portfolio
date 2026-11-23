(() => {
  const resume = window.RESUME;
  const select = selector => document.querySelector(selector);
  const text = value => typeof value === "string" ? value.trim() : "";
  const list = value => Array.isArray(value) ? value : [];
  const strings = value => list(value).map(text).filter(Boolean);
  const records = value => list(value).filter(item => item && typeof item === "object");
  const entries = value => records(value).filter(item => text(item.title));
  const name = text(resume?.name);
  const message = select("#load-message");

  if (!name) {
    message.textContent = "请检查 resume.js 的格式，并填写 name 字段。 Check resume.js and provide a name.";
    return;
  }

  const english = /^en(?:-|$)/i.test(text(resume.lang));
  const labels = english ? {
    site: "Résumé & projects", print: "A4 résumé", full: "View full résumé",
    profile: "Profile", work: "Projects", experience: "Experience", skills: "Skills",
    education: "Education", navigation: "Résumé sections", body: "Résumé content",
    filter: "Filter projects", all: "All", count: total => `${total} projects shown`,
    skip: "Skip to résumé", back: "Back to profile", backProjects: "Back to projects",
    home: "Back to portfolio", printActions: "Print options", printButton: "Print / Save as PDF"
  } : {
    site: "个人简历与项目", print: "A4 简历", full: "查看完整简历",
    profile: "个人简介", work: "项目", experience: "工作经历", skills: "技能",
    education: "教育经历", navigation: "简历分区", body: "简历正文",
    filter: "筛选项目", all: "全部", count: total => `正在展示 ${total} 个项目`,
    skip: "跳到简历", back: "返回简介", backProjects: "返回项目",
    home: "返回个人主页", printActions: "简历操作", printButton: "打印 / 保存为 PDF"
  };

  const role = text(resume.role);
  const locationName = text(resume.location);
  const summary = strings(resume.summary);
  const experience = entries(resume.experience);
  const projects = entries(resume.projects);
  const skills = records(resume.skills).filter(group => text(group.label) && strings(group.items).length);
  const education = entries(resume.education);
  const extraSections = records(resume.sections).filter(group => text(group.title) && entries(group.entries).length);
  const separator = english ? ", " : "、";

  function node(tag, className = "", ...children) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    element.append(...children);
    return element;
  }

  function usableUrl(value, asset = false) {
    const href = text(value);
    if (!href || /[\x00-\x1f]/.test(href)) return "";
    try {
      if (asset && !/^(?:[a-z][a-z\d+.-]*:|[\\/])/i.test(href)) {
        return new URL(href, document.baseURI).href;
      }
      const url = new URL(href);
      const protocols = asset ? ["http:", "https:"] : ["http:", "https:", "mailto:", "tel:"];
      return protocols.includes(url.protocol) ? url.href : "";
    } catch {
      return "";
    }
  }

  function link(label, href, className = "") {
    const anchor = node("a", className, label);
    anchor.href = href;
    return anchor;
  }

  function links(value) {
    return records(value).flatMap(item => {
      const href = usableUrl(item.url);
      return href ? [link(text(item.label) || text(item.url), href)] : [];
    });
  }

  function image(className, src, size) {
    const img = node("img", className);
    img.alt = "";
    if (size) img.width = img.height = size;
    img.addEventListener("error", () => img.remove(), { once: true });
    img.src = src;
    return img;
  }

  function paragraph(parent, className, value) {
    if (value) parent.append(node("p", className, value));
  }

  function bullets(parent, value) {
    const items = strings(value);
    if (items.length) parent.append(node("ul", "", ...items.map(item => node("li", "", item))));
  }

  function section(id, title, isPrint) {
    const element = node("section", isPrint ? "" : "detail-section");
    element.id = id;
    if (!isPrint) element.tabIndex = -1;
    const heading = node("h2", isPrint ? "" : "label", isPrint ? title : `[ ${title} ]`);
    heading.id = `${id}-title`;
    element.setAttribute("aria-labelledby", heading.id);
    element.append(heading);
    return element;
  }

  function entry(item, isPrint, isProject = false) {
    const article = node("article", isPrint ? "entry" : "resume-entry");
    const title = node("h3", "", text(item.title));
    const period = text(item.period);
    if (isPrint) {
      const head = node("div", "entry-head", title);
      paragraph(head, "date", period);
      article.append(head);
    } else {
      paragraph(article, "date", period);
      article.append(title);
    }
    const context = isProject ? [text(item.category), text(item.stack)].filter(Boolean).join(" · ") : text(item.subtitle);
    paragraph(article, isPrint ? "context" : "entry-role", context);
    paragraph(article, "", text(item.summary));
    bullets(article, item.bullets);
    const entryLinks = links(item.links);
    if (entryLinks.length) article.append(node("div", isPrint ? "entry-link related-projects" : "intro-actions", ...entryLinks));
    return article;
  }

  function sections(isPrint) {
    const result = [
      ["experience", labels.experience, experience],
      ...(isPrint ? [["projects", labels.work, projects]] : []),
      ["skills", labels.skills, skills],
      ["education", labels.education, education],
      ...extraSections.map((group, index) => [`section-${index + 1}`, text(group.title), entries(group.entries)])
    ];
    return result.filter(([, , items]) => items.length).map(([id, title, items]) => {
      const content = section(id, title, isPrint);
      if (id === "skills") {
        const rows = items.flatMap(group => {
          const pair = [node("dt", "", text(group.label)), node("dd", "", strings(group.items).join(separator))];
          return isPrint ? pair : [node("div", "", ...pair)];
        });
        content.append(node("dl", "skills", ...rows));
      } else {
        content.append(...items.map(item => entry(item, isPrint, id === "projects")));
      }
      return { id, title, content };
    });
  }

  function renderProjects() {
    if (!projects.length) return [];

    const work = select("#work");
    const scroll = select(".project-scroll");
    const filters = select(".filters");
    const status = select("#filter-status");
    work.hidden = false;
    select("#work-title").textContent = `[ ${labels.work} ]`;
    scroll.setAttribute("aria-label", labels.work);
    const cards = [];

    const details = projects.map((project, index) => {
      const id = `project-${index + 1}`;
      const title = text(project.title);
      const category = text(project.category);
      const artwork = node("div", "project-art");
      artwork.dataset.tone = index % 3;
      artwork.setAttribute("aria-hidden", "true");
      if (category) artwork.append(node("span", "art-note", category));
      artwork.append(node("span", "art-word", text(project.coverTitle) || title));
      const cover = usableUrl(project.image, true);
      if (cover) {
        const img = image("", cover);
        img.loading = "lazy";
        artwork.append(img);
      }
      const card = link("", `#${id}`, "project-card");
      card.append(artwork, node("div", "project-meta", node("strong", "", title)));
      if (text(project.stack)) card.append(node("p", "project-stack", text(project.stack)));
      cards.push({ card, category });
      scroll.append(card);

      const detail = section(id, title, false);
      detail.classList.add("project-detail");
      detail.firstChild.classList.remove("label");
      detail.firstChild.textContent = title;
      const context = [category, text(project.stack)].filter(Boolean).join(" · ");
      if (context) detail.prepend(node("p", "label", `[ ${context} ]`));
      paragraph(detail, "", text(project.summary));
      bullets(detail, project.bullets);
      const video = usableUrl(project.video, true);
      if (video) {
        const player = node("video");
        player.controls = true;
        player.playsInline = true;
        player.preload = "none";
        player.src = video;
        player.setAttribute("aria-label", title);
        detail.append(player);
      }
      const projectLinks = links(project.links);
      if (projectLinks.length) detail.append(node("div", "intro-actions", ...projectLinks));
      return detail;
    });

    const categories = [...new Set(cards.map(item => item.category).filter(Boolean))];
    if (categories.length > 1) {
      filters.hidden = false;
      filters.setAttribute("aria-label", labels.filter);
      const buttons = [];
      for (const category of ["", ...categories]) {
        const button = node("button", "", category || labels.all);
        button.type = "button";
        button.setAttribute("aria-pressed", String(!category));
        button.addEventListener("click", () => {
          buttons.forEach(item => item.setAttribute("aria-pressed", String(item === button)));
          for (const item of cards) item.card.hidden = Boolean(category && item.category !== category);
          status.textContent = labels.count(cards.filter(item => !item.card.hidden).length);
          scroll.scrollTop = 0;
        });
        buttons.push(button);
        filters.append(button);
      }
    }
    return details;
  }

  function renderPortfolio() {
    const avatar = usableUrl(resume.avatar, true);
    const header = select("#site-head");
    const brand = select(".brand");
    const skip = select("#skip");
    const layout = select(".layout");
    const nav = select(".profile-nav");
    const profile = select(".profile-scroll");

    if (avatar) brand.append(image("brand-avatar", avatar, 42));
    brand.append(node("span", "", name, node("small", "", labels.site)));
    select(".print-link").textContent = `${labels.print} ↗`;
    skip.textContent = labels.skip;
    skip.hidden = false;
    nav.setAttribute("aria-label", labels.navigation);
    profile.setAttribute("aria-label", labels.body);

    const intro = node("section", "intro", node("p", "label", `[ ${labels.profile} ]`));
    intro.id = "profile";
    intro.tabIndex = -1;
    intro.setAttribute("aria-labelledby", "name");
    const heading = node("h1", "", name);
    heading.id = "name";
    const dot = node("span", "", ".");
    dot.setAttribute("aria-hidden", "true");
    heading.append(dot);
    const identity = node("div", "intro-identity", heading);
    if (avatar) identity.append(image("intro-avatar", avatar, 256));
    intro.append(identity);
    paragraph(intro, "role", role);
    paragraph(intro, "entry-role", locationName);
    summary.forEach(line => paragraph(intro, "lead", line));
    intro.append(node("div", "intro-actions", link(`${labels.full} ↗`, "./resume.html"), ...links(resume.links)));

    const resumeSections = sections(false);
    const projectDetails = renderProjects();
    nav.append(link(labels.profile, "#profile"));
    if (projects.length) nav.append(link(labels.work, "#work"));
    nav.append(...resumeSections.map(item => link(item.title, `#${item.id}`)));
    profile.append(intro, ...resumeSections.map(item => item.content), ...projectDetails);

    const footer = node("footer", "panel-footer", link(`↑ ${labels.back}`, "#profile"));
    if (projects.length) footer.append(link(`↑ ${labels.backProjects}`, "#work", "back-projects"));
    profile.append(footer);
    header.hidden = layout.hidden = false;

    function highlightLocation() {
      const current = window.location.hash || "#profile";
      for (const anchor of document.querySelectorAll(".profile-nav a, .project-card")) {
        if (anchor.getAttribute("href") === current) anchor.setAttribute("aria-current", "location");
        else anchor.removeAttribute("aria-current");
      }
    }
    highlightLocation();
    window.addEventListener("hashchange", highlightLocation);
    if (window.location.hash) {
      const target = document.getElementById(window.location.hash.slice(1));
      if (target) requestAnimationFrame(() => target.scrollIntoView());
    }
  }

  function renderPrint() {
    const toolbar = select(".toolbar");
    const sheet = select(".sheet");
    toolbar.setAttribute("aria-label", labels.printActions);
    toolbar.querySelector("a").textContent = `← ${labels.home}`;
    const printButton = toolbar.querySelector("button");
    printButton.textContent = labels.printButton;
    printButton.addEventListener("click", () => window.print());

    const copy = node("div", "identity-copy", node("h1", "", name));
    paragraph(copy, "role", role);
    const contact = links(resume.links);
    if (locationName) contact.unshift(node("span", "", locationName));
    const identity = node("header", "identity", copy);
    if (contact.length) identity.append(node("address", "", ...contact));
    sheet.append(identity);
    summary.forEach(line => paragraph(sheet, "summary", line));
    sheet.append(...sections(true).map(item => item.content));
    toolbar.hidden = sheet.hidden = false;
  }

  const isPrint = document.body.dataset.view === "print";
  document.documentElement.lang = text(resume.lang) || "zh-CN";
  document.title = [name, isPrint ? labels.print : role || labels.site].join(" · ");
  const description = select('meta[name="description"]');
  description.content = summary[0] || [name, role || labels.site].join(" · ");
  if (isPrint) renderPrint();
  else renderPortfolio();
  message.hidden = true;
})();
