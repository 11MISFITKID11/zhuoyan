/* 琢言 · AI 引擎与模拟数据（自 app.js 拆分，加载顺序见 index.html） */
// ============================================================
// SSE 流式请求辅助（支持取消 + 增量回调）
// ============================================================
async function streamCall(path, body, { onDelta, signal } = {}) {
  const token = getToken();
  const res = await fetch(API_BASE + path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + token,
      'Accept': 'text/event-stream'
    },
    body: JSON.stringify(body),
    signal
  });

  if (!res.ok) {
    let errMsg = '请求失败 (' + res.status + ')';
    try { const e = await res.json(); errMsg = e.error || e.message || errMsg; } catch (e) {}
    const err = new Error(errMsg);
    err.quota = res.status === 429 || errMsg.includes('QUOTA_EXCEEDED');
    throw err;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  return new Promise((resolve, reject) => {
    (async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const events = buffer.split('\n\n');
          buffer = events.pop() || '';
          for (const evt of events) {
            const line = evt.trim();
            if (!line.startsWith('data:')) continue;
            let msg;
            try { msg = JSON.parse(line.slice(5).trim()); } catch (e) { continue; }
            if (msg.type === 'delta') {
              if (onDelta) onDelta(msg.content || '');
            } else if (msg.type === 'complete') {
              resolve(msg);
              return;
            } else if (msg.type === 'error') {
              const e = new Error(msg.error || '分析失败');
              e.quota = String(msg.error || '').includes('QUOTA_EXCEEDED');
              reject(e);
              return;
            }
          }
        }
        reject(new Error('连接中断，未收到完整结果'));
      } catch (e) { reject(e); }
    })();
  });
}

// ============================================================
// AI 引擎：真实 API（SSE 流式）/ 模拟回退
// opts: { signal, onDelta } —— signal 用于取消，onDelta 用于实时增量
// ============================================================
const AIEngine = {
  async polish(text, opts = {}) {
    const token = getToken();
    if (token) {
      try {
        const data = await streamCall('/api/polish', {
          text,
          customEndpoint: apiSettings.customEndpoint,
          rawApiKey: apiSettings.apiKey || '',
          model: apiSettings.model || ''
        }, opts);
        if (data.suggestions && data.suggestions.length > 0) return data.suggestions;
        if (data.parseError) throw new Error('返回格式异常');
      } catch (err) {
        if (err.name === 'AbortError') throw err;
        if (err.quota) { showProUpgrade(); throw err; }
        showToast('API 调用失败: ' + (err.message || '未知错误') + '，已回退到模拟数据', 'error');
      }
    }
    await delay(1200 + Math.random() * 600);
    return generatePolishResults(text);
  },
  async analyzeLogic(text, opts = {}) {
    const token = getToken();
    if (token) {
      try {
        const data = await streamCall('/api/logic', {
          text,
          customEndpoint: apiSettings.customEndpoint,
          rawApiKey: apiSettings.apiKey || '',
          model: apiSettings.model || ''
        }, opts);
        if (data.nodes && data.nodes.length > 0) return data.nodes;
        if (data.parseError) throw new Error('返回格式异常');
      } catch (err) {
        if (err.name === 'AbortError') throw err;
        if (err.quota) { showProUpgrade(); throw err; }
        showToast('API 调用失败: ' + (err.message || '未知错误') + '，已回退到模拟数据', 'error');
      }
    }
    await delay(1200 + Math.random() * 800);
    return generateLogicResults(text);
  },
  async detectAIGC(text, opts = {}) {
    const token = getToken();
    if (token) {
      try {
        const data = await streamCall('/api/aigc/detect', {
          text,
          customEndpoint: apiSettings.customEndpoint,
          rawApiKey: apiSettings.apiKey || '',
          model: apiSettings.model || ''
        }, opts);
        if (data.paragraphs && data.paragraphs.length > 0) return data.paragraphs;
        if (data.parseError) throw new Error('返回格式异常');
      } catch (err) {
        if (err.name === 'AbortError') throw err;
        if (err.quota) { showProUpgrade(); throw err; }
        showToast('API 调用失败: ' + (err.message || '未知错误') + '，已回退到模拟数据', 'error');
      }
    }
    await delay(1200 + Math.random() * 600);
    return generateAIGCResults(text);
  },
  async rewriteAIGC(text, opts = {}) {
    const token = getToken();
    if (token) {
      try {
        const data = await streamCall('/api/aigc/rewrite', {
          text,
          customEndpoint: apiSettings.customEndpoint,
          rawApiKey: apiSettings.apiKey || '',
          model: apiSettings.model || ''
        }, opts);
        if (data.rewritten) return data.rewritten;
      } catch (err) {
        if (err.name === 'AbortError') throw err;
        if (err.quota) { showProUpgrade(); throw err; }
        showToast('API 调用失败: ' + (err.message || '未知错误') + '，已回退到模拟数据', 'error');
      }
    }
    await delay(1000 + Math.random() * 500);
    return generateRewrite(text);
  },
  async optimizeLogic(text, opts = {}) {
    const token = getToken();
    if (token) {
      try {
        const data = await streamCall('/api/logic/optimize', {
          text,
          customEndpoint: apiSettings.customEndpoint,
          rawApiKey: apiSettings.apiKey || '',
          model: apiSettings.model || ''
        }, opts);
        if (data.optimized) return data.optimized;
      } catch (err) {
        if (err.name === 'AbortError') throw err;
        if (err.quota) { showProUpgrade(); throw err; }
        showToast('API 调用失败: ' + (err.message || '未知错误') + '，已回退到模拟数据', 'error');
      }
    }
    await delay(1500 + Math.random() * 1000);
    return generateLogicOptimization(text);
  }
};


// ============================================================
// 模拟润色结果生成
// ============================================================
function generatePolishResults(text) {
  const suggestions = [];

  // 根据输入文本动态生成建议
  if (text.includes('通过') && text.includes('从而')) {
    suggestions.push({
      id: 's_' + uid(), type: 'grammar', typeName: '语法', severity: '高',
      old: '通过对于该问题的深入研究，从而可以使得我们更好地理解',
      new: '通过深入研究该问题，我们可以更好地理解',
      reason: '「通过对于…从而可以使得」为冗余句式，学术写作中应避免介词嵌套和多重使役结构。',
      anchor: '通过'
    });
  }
  if (text.includes('对于')) {
    suggestions.push({
      id: 's_' + uid(), type: 'clarity', typeName: '清晰度', severity: '中',
      old: '对于卷积神经网络在图像识别领域的应用进行了研究',
      new: '系统研究了卷积神经网络在图像识别领域的应用',
      reason: '「对于…进行了研究」为口语化表达，学术写作推荐使用「系统研究了…」更简洁正式。',
      anchor: '对于'
    });
  }
  if (text.includes('好了很多') || text.includes('比传统')) {
    suggestions.push({
      id: 's_' + uid(), type: 'clarity', typeName: '清晰度', severity: '中',
      old: '这个结果比传统方法好了很多',
      new: '该结果显著优于传统方法',
      reason: '「好了很多」过于口语化，学术写作应使用「显著优于」「大幅超越」等精确表述。',
      anchor: '好了很多'
    });
  }
  if (text.includes('可以使得') || text.includes('使得')) {
    suggestions.push({
      id: 's_' + uid(), type: 'style', typeName: '风格', severity: '低',
      old: '可以使得模型的性能进一步提升',
      new: '可进一步提升模型性能',
      reason: '「可以使得…进一步提升」冗余，「使得」可省略，直接用「可进一步提升」更简洁。',
      anchor: '可以使得'
    });
  }
  if (text.includes('ML') && text.includes('机器学习')) {
    suggestions.push({
      id: 's_' + uid(), type: 'term', typeName: '术语', severity: '高',
      old: 'ML和机器学习这两个术语在本文中被交替使用',
      new: '建议全文统一使用「机器学习」',
      reason: '同一概念使用多种表述（ML / 机器学习）会造成读者混淆。建议全文统一为中文全称。',
      anchor: 'ML'
    });
  }
  if (text.includes('人工神经网络') && text.includes('神经网络')) {
    suggestions.push({
      id: 's_' + uid(), type: 'term', typeName: '术语', severity: '高',
      old: '人工神经网络和神经网络也指代相同的概念',
      new: '建议全文统一使用「神经网络」',
      reason: '「人工神经网络」与「神经网络」指代相同概念，建议统一为更常用的「神经网络」。',
      anchor: '人工神经网络'
    });
  }
  if (text.includes('总的来说') || text.includes('我们可以看出')) {
    suggestions.push({
      id: 's_' + uid(), type: 'style', typeName: '风格', severity: '中',
      old: '总的来说，通过本研究的实验，我们可以看出深度学习在计算机视觉领域有着很大的潜力',
      new: '综上所述，本研究的实验表明深度学习在计算机视觉领域具有巨大潜力',
      reason: '「总的来说…我们可以看出…有着很大的」为口语化长句，学术结论应使用正式表述。',
      anchor: '总的来说'
    });
  }
  // 通用建议 - 总是添加1-2条
  if (suggestions.length < 2) {
    suggestions.push({
      id: 's_' + uid(), type: 'style', typeName: '风格', severity: '低',
      old: text.length > 30 ? text.substring(0, 30) + '...' : text,
      new: '建议精简句式，使用更直接的学术表达',
      reason: '学术写作应避免冗长句式，优先使用简洁、明确的表达方式。',
      anchor: text.length > 20 ? text.substring(0, 20) : text
    });
  }

  return suggestions;
}

function generateLogicResults(text) {
  const paragraphs = text.split('\n\n').filter(p => p.trim());
  const nodes = [];
  let level = 1;
  paragraphs.forEach((p, i) => {
    const trimmed = p.trim();
    if (trimmed.includes('本文研究') || trimmed.includes('本研究') || trimmed.includes('本文提出')) {
      nodes.push({ id: 'n_' + uid(), type: 'claim', typeName: '论点', text: trimmed.substring(0, 50) + (trimmed.length > 50 ? '...' : ''), level: 1, warning: null, paraIdx: i });
      level = 2;
    } else if (trimmed.includes('实验') || trimmed.includes('数据') || trimmed.includes('结果') || trimmed.includes('目前')) {
      const hasWarning = i > 0 && trimmed.includes('然而') || trimmed.includes('但是');
      nodes.push({ id: 'n_' + uid(), type: 'evidence', typeName: '论据', text: trimmed.substring(0, 50) + (trimmed.length > 50 ? '...' : ''), level: 2, warning: hasWarning ? '逻辑断层：此论据与上文衔接较弱，缺少过渡句。' : null, paraIdx: i });
    } else if (trimmed.includes('因此') || trimmed.includes('说明') || trimmed.includes('综上所述')) {
      nodes.push({ id: 'n_' + uid(), type: 'conclusion', typeName: '结论', text: trimmed.substring(0, 50) + (trimmed.length > 50 ? '...' : ''), level: 2, warning: i > 2 && trimmed.includes('注意力') ? '段落衔接：建议补充「针对上述不足，本文…」过渡句，使论证链条完整。' : null, paraIdx: i });
    } else {
      nodes.push({ id: 'n_' + uid(), type: 'transition', typeName: '过渡', text: trimmed.substring(0, 50) + (trimmed.length > 50 ? '...' : ''), level: nodes.length > 0 ? 2 : 1, warning: null, paraIdx: i });
    }
  });
  return nodes;
}

function generateAIGCResults(text) {
  const paragraphs = text.split('\n\n').filter(p => p.trim());
  return paragraphs.map(p => {
    const trimmed = p.trim();
    // 简单的 AI 率模拟：段落越长且含某些模式 → AI率越高
    let aiRate = 0.2 + Math.random() * 0.3;
    if (trimmed.includes('随着') && trimmed.includes('发展')) aiRate = 0.75 + Math.random() * 0.15;
    if (trimmed.includes('综上所述') || trimmed.includes('展现出')) aiRate = 0.7 + Math.random() * 0.2;
    if (trimmed.includes('其实') || trimmed.includes('挺不错')) aiRate = 0.1 + Math.random() * 0.15;
    if (trimmed.includes('基于') && trimmed.includes('实验结果表明')) aiRate = 0.5 + Math.random() * 0.25;
    aiRate = Math.min(0.98, Math.max(0.05, Math.round(aiRate * 100) / 100));
    return { text: trimmed, aiRate };
  });
}

function generateRewrite(text) {
  const rewrites = {
    '随着': '近年来，人工智能技术发展迅猛，深度学习在多个领域取得了突破性进展。尤其在计算机视觉、自然语言处理及语音识别等方向，深度学习模型性能已接近甚至超越人类水平。',
    '综上所述': '综合以上分析，深度学习技术在医学图像分析领域展现出显著的应用价值和广阔的发展前景。随着算法的持续优化与算力的不断提升，该技术有望在临床辅助诊断中发挥更大作用。',
    '本文基于': '本研究采用ResNet-50网络结构，基于ImageNet数据集开展实验。结果显示，模型在测试集上的Top-1准确率达95.6%，相较基线方法提升3.2个百分点。',
    '这个结果': '实验结果显示，模型表现超出预期。分析认为，残差连接的引入改善了梯度传播效率，从而提升了模型性能。',
    '实验中': '实验结果表明，学习率为0.001时模型收敛速度达到最优。同时，将batch size设置为64可最大化GPU利用率。'
  };
  for (const [key, val] of Object.entries(rewrites)) {
    if (text.includes(key)) return val;
  }
  return '经过系统性改写，本段落保留了核心学术信息，同时显著降低了AI生成特征。改写后的文本更符合人类学术写作的自然表达习惯。';
}

function generateLogicOptimization(text) {
  // 模拟逻辑优化结果：保留核心内容，重构论证结构
  const paras = text.split('\n\n').filter(p => p.trim());
  let result = '';
  paras.forEach((p, i) => {
    const t = p.trim();
    if (t.includes('研究') && t.includes('应用')) {
      result += '【核心论点】\n本文的核心研究问题是深度学习在医学图像诊断中的应用价值。现有研究已证明卷积神经网络在图像识别任务中表现优异，但将其应用于医学影像分析仍需解决数据量不足、标注成本高等实际问题。因此，本研究的切入点具有明确的临床需求和学术价值。\n\n';
    } else if (t.includes('迁移学习') || t.includes('预训练')) {
      result += '【论据支撑】\n针对医学影像数据量大的特点，迁移学习提供了一条可行路径。实验表明，在ImageNet上预训练的模型经过医学数据微调后，准确率可提升12%。这验证了"预训练+微调"范式在医学影像领域的适用性。然而，当前方法在罕见病变识别上仍存在性能瓶颈。\n\n';
    } else if (t.includes('注意力') || t.includes('改进')) {
      result += '【改进方案与验证】\n为突破上述瓶颈，本研究提出基于注意力机制的改进方案。在3类罕见病变上的实验结果显示，F1值提升8.3%，说明注意力机制确实增强了模型对关键特征的提取能力。\n\n';
    } else if (t.includes('实验') || t.includes('准确率') || t.includes('CNN')) {
      result += '【实验基础】\n基础实验表明，CNN模型在ImageNet数据集上的Top-1准确率达95.6%，残差连接显著提升了训练稳定性。这些结果为后续的医学影像分析提供了技术基础。\n\n';
    } else {
      result += '【论证过渡】\n' + t + '\n\n';
    }
  });
  result += '【结论与展望】\n综合以上分析，深度学习技术在医学图像分析领域展现出显著的应用潜力。本研究提出的注意力机制改进方案有效提升了罕见病变的识别性能。未来工作将围绕多中心数据验证和模型可解释性展开。';
  return result.trim();
}
