// Иконки Lucide как SVG-строки — для карт, меток и шаблонов.
(function (root) {
  const pascal = (n) => n.split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join("");
  const esc = (v) => String(v).replace(/"/g, "&quot;");
  function build(node) {
    const [tag, attrs, children] = node;
    const a = Object.entries(attrs || {}).map(([k, v]) => `${k}="${esc(v)}"`).join(" ");
    return `<${tag} ${a}>${(children || []).map(build).join("")}</${tag}>`;
  }
  root.icon = function (name, cls = "") {
    const L = root.lucide;
    const node = L && L.icons && L.icons[pascal(name)];
    if (!node) return "";
    const [, attrs, children] = node;
    return build(["svg", { ...attrs, class: `lucide ${cls}`.trim(), "aria-hidden": "true" }, children]);
  };
})(window);
