/* 琢言 · 全局状态对象（自 app.js 拆分，加载顺序见 index.html） */
// ============================================================
// 数据 & 状态
// ============================================================
let polishState = { suggestions: [], text: '', currentText: '', acceptedCount: 0, dismissedCount: 0, editHistory: [] };
let logicState = { nodes: [], optimizedText: '', originalText: '' };
let aigcState = { paragraphs: [], results: [] };
let docIdCounter = 0;
let currentDocId = null;

const documents = [];
