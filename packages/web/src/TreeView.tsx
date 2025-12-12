import React, { useMemo } from "react";

import type { TreeNode } from "./api";

export function TreeView(props: {
  nodes: TreeNode[];
  onOpenFile: (fileId: number) => void;
  showMeta?: boolean;
}) {
  const { nodes, onOpenFile, showMeta = true } = props;

  return (
    <div className="tree">
      {nodes.map((n) => (
        <TreeNodeView key={n.type === "dir" ? `d:${n.path}` : `f:${n.id}`} node={n} onOpenFile={onOpenFile} showMeta={showMeta} />
      ))}
    </div>
  );
}

function TreeNodeView(props: {
  node: TreeNode;
  onOpenFile: (fileId: number) => void;
  showMeta: boolean;
}) {
  const { node, onOpenFile, showMeta } = props;

  if (node.type === "file") {
    const title = useMemo(() => {
      const parts: string[] = [];
      if (node.chartName) parts.push(node.chartName);
      if (node.chartType) parts.push(node.chartType);
      if (node.isSup) parts.push("SUP");
      return parts.join(" · ");
    }, [node.chartName, node.chartType, node.isSup]);

    return (
      <button className="treeFile" onClick={() => onOpenFile(node.id)} title={title}>
        <div className="treeFileName">{node.name}</div>
        {showMeta && (node.chartName || node.chartType) ? (
          <div className="treeFileMeta">
            {node.chartName ? <span className="pill">{node.chartName}</span> : null}
            {node.chartType ? <span className="pill pillGray">{node.chartType}</span> : null}
            {node.isSup ? <span className="pill pillWarn">SUP</span> : null}
          </div>
        ) : null}
      </button>
    );
  }

  return (
    <details className="treeDir" open>
      <summary className="treeDirSummary">{node.name || "（空）"}</summary>
      <div className="treeDirChildren">
        {node.children.map((c) => (
          <TreeNodeView key={c.type === "dir" ? `d:${c.path}` : `f:${c.id}`} node={c} onOpenFile={onOpenFile} showMeta={showMeta} />
        ))}
      </div>
    </details>
  );
}


