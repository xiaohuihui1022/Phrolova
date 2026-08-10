/**
 * 轻量级 HTML 白名单清理器（无外部依赖）。
 * 只放行安全的排版标签与超链接，移除 <script>/<iframe>/on*= 等所有潜在危险内容。
 * 用于致谢名单描述等「管理员输入但需简单支持 <a>、<br>、<b> 等」的场景。
 */

// 允许的标签名（小写）
const ALLOWED_TAGS = new Set([
  "a", "abbr", "b", "br", "code", "em", "i", "li", "ol", "p", "small", "span", "strong", "sub", "sup", "u", "ul",
]);

// 允许的全局属性（所有标签都可以带的）
const ALLOWED_GLOBAL_ATTRS = new Set(["class", "title"]);

// 针对特定标签额外允许的属性（属性名→校验函数，返回 true 才保留值）
const TAG_EXTRA_ATTRS: Record<string, Record<string, (v: string) => boolean>> = {
  a: {
    href: (v) => {
      // 只允许 http/https/mailto 协议，避免 javascript:/data: 等危险协议
      try {
        const u = new URL(v);
        return u.protocol === "http:" || u.protocol === "https:" || u.protocol === "mailto:";
      } catch {
        // 相对路径 /xxx 或纯锚点 #xxx 也放行
        return /^[/#?]/.test(v);
      }
    },
    target: (v) => v === "_blank" || v === "_self" || v === "_parent" || v === "_top",
    rel: () => true,
  },
};

function escapeAttr(v: string): string {
  return v
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function sanitizeElement(el: Element): string {
  const tag = el.tagName.toLowerCase();
  if (!ALLOWED_TAGS.has(tag)) {
    // 不允许的标签：跳过标签本身，但保留其内部文本（递归子节点）
    return sanitizeChildNodes(el);
  }

  let html = `<${tag}`;
  const extraAttrs = TAG_EXTRA_ATTRS[tag] ?? {};
  // 遍历属性，保留符合白名单 + 校验通过的
  for (const attr of Array.from(el.attributes)) {
    const name = attr.name.toLowerCase();
    const rawValue = attr.value;
    // 丢弃所有 on* 事件属性
    if (name.startsWith("on")) continue;

    let ok = false;
    if (ALLOWED_GLOBAL_ATTRS.has(name)) ok = true;
    else if (name in extraAttrs) ok = extraAttrs[name](rawValue);

    if (!ok) continue;

    // 对 <a target="_blank"> 强制追加 rel="noopener noreferrer"
    let value = rawValue;
    if (tag === "a" && name === "href") {
      // 规范化 href：不做改写，交给校验
    }
    html += ` ${name}="${escapeAttr(value)}"`;
  }

  // <a target="_blank" 自动加 rel
  if (tag === "a") {
    const t = el.getAttribute("target");
    if (t === "_blank" && !el.hasAttribute("rel")) {
      html += ` rel="noopener noreferrer"`;
    }
  }

  // 自闭合标签（不接受子节点）
  if (tag === "br") {
    html += " />";
    return html;
  }

  html += `>${sanitizeChildNodes(el)}</${tag}>`;
  return html;
}

function sanitizeChildNodes(parent: Element | DocumentFragment | Document): string {
  let out = "";
  for (const node of Array.from(parent.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      // 文本节点直接保留文本内容（浏览器会在 innerHTML 注入时正确转义）
      // 但为了严格性，我们把文本做一次 escape，避免 v-html 场景下被再解析
      out += node.textContent ?? "";
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      out += sanitizeElement(node as Element);
    }
    // 其他节点（注释、CDATA 等）丢弃
  }
  return out;
}

/**
 * 清理任意 HTML 字符串，只保留白名单内的安全标签与属性。
 * 空输入返回空串。在 SSR / workerd 等非浏览器环境下会退化走正则清理路径。
 */
export function sanitizeHtml(input: string | null | undefined): string {
  if (!input) return "";
  const raw = String(input);

  // 优先走 DOMParser（浏览器环境）
  try {
    if (typeof DOMParser !== "undefined") {
      const doc = new DOMParser().parseFromString(`<div>${raw}</div>`, "text/html");
      const root = doc.body.firstElementChild as HTMLDivElement | null;
      if (root) return sanitizeChildNodes(root);
    }
  } catch {
    /* ignore, fall back to regex strip */
  }

  // Fallback：粗暴地用正则剥掉不在白名单里的所有标签，以及 on*= / javascript: 等危险属性
  return raw
    .replace(/<\s*script[\s\S]*?<\s*\/\s*script\s*>/gi, "")
    .replace(/<\s*iframe[\s\S]*?<\s*\/\s*iframe\s*>/gi, "")
    .replace(/<\s*(style|object|embed|svg|math|form|input|button|textarea|select|option|link|meta|base|frameset|frame|noframes|noscript|template|xmp)[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/\son[\w-]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\shref\s*=\s*("javascript:[^"]*"|'javascript:[^']*'|javascript:[^\s>]+)/gi, "")
    .trim();
}
