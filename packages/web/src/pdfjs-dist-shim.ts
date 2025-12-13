// 兼容层：@react-pdf-viewer/*@3.x 依赖 pdfjs-dist 的 renderTextLayer API，
// 但 pdfjs-dist@4.x 已不再导出该函数。这里用 pdfjs-dist@4 的 TextLayer 实现一个等价适配。
//
// 说明：vite.config.ts 里把「裸导入」`pdfjs-dist` alias 到本文件；
// 这样不会影响 `pdfjs-dist/build/pdf.worker*.mjs?url` 这类子路径导入。

export * from "pdfjs-dist/build/pdf.mjs";

import { TextLayer } from "pdfjs-dist/build/pdf.mjs";

type RenderTextLayerParams = {
  container: HTMLElement;
  // pdfjs 的 TextContent 对象（react-pdf-viewer 会同时传 textContent/textContentSource）
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  textContent?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  textContentSource?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  viewport: any;
};

export function renderTextLayer(params: RenderTextLayerParams) {
  const { container, viewport } = params;
  const textContentSource = params.textContentSource ?? params.textContent;

  const layer = new TextLayer({
    container,
    textContentSource,
    viewport
  });

  return {
    promise: layer.render(),
    cancel: () => layer.cancel()
  };
}


