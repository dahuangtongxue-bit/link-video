import { type Editor, type TLShapeId, createShapeId } from "tldraw";

// 在两个卡片之间画一条会跟随移动的箭头，表达"血缘"关系。
// 纯装饰：绑定 API 在不同 tldraw 版本上略有差异，所以整段 try/catch，
// 画不出来也不影响生成流程。
export function connectShapes(editor: Editor, fromId: TLShapeId, toId: TLShapeId) {
  try {
    const arrowId = createShapeId();
    editor.createShape({
      id: arrowId,
      type: "arrow",
      props: { color: "grey", size: "s" },
    } as any);

    editor.createBindings([
      {
        fromId: arrowId,
        toId: fromId,
        type: "arrow",
        props: {
          terminal: "start",
          normalizedAnchor: { x: 0.5, y: 0.5 },
          isExact: false,
          isPrecise: false,
        },
      },
      {
        fromId: arrowId,
        toId: toId,
        type: "arrow",
        props: {
          terminal: "end",
          normalizedAnchor: { x: 0.5, y: 0.5 },
          isExact: false,
          isPrecise: false,
        },
      },
    ] as any);
  } catch (e) {
    console.warn("connectShapes 画箭头失败（不影响生成）:", e);
  }
}
