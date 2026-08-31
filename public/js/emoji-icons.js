(function(){
  // emoji → SVG symbol ID 映射
  var M = {
    '🏠':'i-home','✍️':'i-edit','🧩':'i-logic','🛡️':'i-shield','📁':'i-folder','🔍':'i-search','🔔':'i-bell',
    '📋':'i-clipboard','🚀':'i-sparkle','✨':'i-sparkle','📥':'i-download','📄':'i-doc','🔬':'i-scan',
    '⭐':'i-star','💡':'i-bulb','⚠':'i-warn','📌':'i-pin','📊':'i-chart','🔄':'i-refresh',
    '✕':'i-close','✓':'i-check','⚙️':'i-settings','💾':'i-save','📤':'i-export','🗑️':'i-delete',
    '✏️':'i-rename','📧':'i-mail','🔒':'i-lock','📝':'i-edit','🔔':'i-bell','➕':'i-sparkle',
    '📈':'i-chart','🔄':'i-refresh','📎':'i-doc','🔗':'i-pin','💬':'i-edit','📰':'i-doc',
    '🏆':'i-star','🎯':'i-star','⚡':'i-pulse','🕐':'i-history','🔧':'i-settings'
  };
  var running = false;
  function replaceEmoji() {
    if (running) return; running = true;
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: function(n) {
        var t = n.parentElement && n.parentElement.tagName;
        if (!t) return NodeFilter.FILTER_REJECT;
        if (t === 'SCRIPT' || t === 'STYLE' || t === 'TEXTAREA' || t === 'SVG' || t === 'INPUT') return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(function(n) {
      var txt = n.textContent, changed = false;
      for (var e in M) {
        if (txt.indexOf(e) >= 0) {
          txt = txt.split(e).join('<svg class="icon"><use href="#' + M[e] + '"/></svg>');
          changed = true;
        }
      }
      if (changed) {
        var s = document.createElement('span'); s.innerHTML = txt;
        n.parentNode.replaceChild(s, n);
      }
    });
    running = false;
  }
  if (document.readyState !== 'loading') replaceEmoji();
  else document.addEventListener('DOMContentLoaded', replaceEmoji);
  var timer;
  new MutationObserver(function() {
    clearTimeout(timer); timer = setTimeout(replaceEmoji, 80);
  }).observe(document.body, { childList: true, subtree: true });
})();
