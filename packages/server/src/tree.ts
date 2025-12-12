export type TreeNode =
  | {
      type: "dir";
      name: string;
      path: string;
      children: TreeNode[];
    }
  | {
      type: "file";
      id: number;
      name: string;
      relPath: string;
      chartName: string | null;
      chartType: string | null;
      chartPage: string | null;
      isSup: boolean | null;
      groupKey: string | null;
    };

function ensureDir(parent: Extract<TreeNode, { type: "dir" }>, name: string, path: string) {
  const existing = parent.children.find((c) => c.type === "dir" && c.name === name) as
    | Extract<TreeNode, { type: "dir" }>
    | undefined;
  if (existing) return existing;
  const next: Extract<TreeNode, { type: "dir" }> = { type: "dir", name, path, children: [] };
  parent.children.push(next);
  return next;
}

export function buildTree(items: Array<{ id: number; rel_path: string; chart_name: string | null; chart_type: string | null; chart_page: string | null; is_sup: number | null; group_key: string | null }>, basePrefixToStrip: string) {
  const root: Extract<TreeNode, { type: "dir" }> = { type: "dir", name: "", path: "", children: [] };

  const normStrip = basePrefixToStrip.replace(/\/+$/, "");

  for (const it of items) {
    const rel = it.rel_path;
    const display = normStrip && rel.startsWith(normStrip + "/") ? rel.slice(normStrip.length + 1) : rel;
    const parts = display.split("/").filter(Boolean);
    if (parts.length === 0) continue;

    let cur = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      const isLast = i === parts.length - 1;
      if (isLast) {
        cur.children.push({
          type: "file",
          id: it.id,
          name: part,
          relPath: rel,
          chartName: it.chart_name,
          chartType: it.chart_type,
          chartPage: it.chart_page,
          isSup: it.is_sup == null ? null : it.is_sup === 1,
          groupKey: it.group_key
        });
      } else {
        const nextPath = parts.slice(0, i + 1).join("/");
        cur = ensureDir(cur, part, nextPath);
      }
    }
  }

  // 排序：目录在前，文件在后，按名称
  function sortNode(n: Extract<TreeNode, { type: "dir" }>) {
    n.children.sort((a, b) => {
      if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
      return a.name.localeCompare(b.name, "zh-Hans-CN", { numeric: true, sensitivity: "base" });
    });
    for (const c of n.children) {
      if (c.type === "dir") sortNode(c);
    }
  }
  sortNode(root);

  return root.children;
}


