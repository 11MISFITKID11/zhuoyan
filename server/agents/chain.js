/**
 * 琢言 · Chain 流水线（自研轻量链式编排抽象）
 *
 * 设计对标 LangChain 的 RunnableSequence / AgentExecutor：
 *   - 步骤以声明式定义：{ key, name, required, run(ctx, results) }；
 *   - Pipeline 按声明顺序执行，共享上下文 ctx 在步骤间贯穿（前序输出 = 后续输入）；
 *   - required 步骤失败 → 立即中止整个链并抛出原错误；
 *   - 非 required 步骤失败 → 记录 { ok:false, error } 后降级继续；
 *   - 支持进度钩子 onProgress(key, name, idx, total)，供 SSE 前端展示步骤进度。
 *
 * 为何不直接引 LangChain：本项目是多供应商 OpenAI 兼容网关（千问/DeepSeek/OpenAI），
 * 自研 30 行抽象即可表达顺序链 + 失败降级，且不引入重依赖、不改变既有调用语义。
 */

class Pipeline {
  /**
   * @param {object} [hooks]
   * @param {object} [hooks.logger] - 日志器（默认 console）
   * @param {function} [hooks.onProgress] - (key, name, idx, total) => void
   */
  constructor(hooks = {}) {
    this._steps = [];
    this._logger = hooks.logger || console;
    this._onProgress = hooks.onProgress || null;
  }

  /**
   * 追加一个链步骤
   * @param {{key:string, name:string, required?:boolean, run:Function}} def
   *   run(ctx, results) 返回该步骤产出；抛错时按 required 决定中止或降级
   * @returns {Pipeline} this（支持链式调用）
   */
  add(def) {
    this._steps.push({ required: false, ...def });
    return this;
  }

  /**
   * 按声明顺序执行全部步骤
   * @param {object} ctx - 贯穿整个链的共享上下文（可被步骤读写）
   * @returns {Promise<object>} results[key] = { ok:true, value } | { ok:false, error }
   */
  async run(ctx = {}) {
    const results = {};
    const total = this._steps.length;
    for (let i = 0; i < total; i++) {
      const step = this._steps[i];
      if (this._onProgress) this._onProgress(step.key, step.name, i + 1, total);
      try {
        results[step.key] = { ok: true, value: await step.run(ctx, results) };
      } catch (err) {
        if (step.required) {
          this._logger.warn(`Pipeline 中止：必需步骤「${step.name}」失败`, { error: err.message });
          throw err; // 原样抛出，保留调用方预期的错误信息
        }
        this._logger.warn(`Pipeline 步骤「${step.name}」失败（降级跳过）`, { error: err.message });
        results[step.key] = { ok: false, error: err };
      }
    }
    return results;
  }
}

module.exports = { Pipeline };
