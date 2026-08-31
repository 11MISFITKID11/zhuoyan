/**
 * 琢言 · 文档 CRUD 路由
 */

const express = require('express');
const { sqlGet, sqlAll, sqlRun, sqlInsert } = require('../db');
const authMiddleware = require('../middleware/auth');
const cache = require('../utils/cache');
const logger = require('../utils/logger');

const router = express.Router();

/**
 * GET /api/docs
 */
router.get('/', authMiddleware, (req, res) => {
  const cacheKey = `docs_list_${req.user.id}`;
  const cached = cache.get(cacheKey);
  if (cached) return res.json(cached);

  const docs = sqlAll(
    'SELECT id, title, date, words, type, status FROM documents WHERE userId = ? ORDER BY id DESC',
    [req.user.id]
  );
  const result = { docs };
  cache.set(cacheKey, result);
  res.json(result);
});

/**
 * GET /api/docs/:id/content
 */
router.get('/:id/content', authMiddleware, (req, res) => {
  const doc = sqlGet(
    'SELECT content FROM documents WHERE id = ? AND userId = ?',
    [parseInt(req.params.id), req.user.id]
  );
  if (!doc) return res.status(404).json({ error: '文档不存在' });
  res.json({ content: doc.content || '' });
});

/**
 * POST /api/docs
 */
router.post('/', authMiddleware, (req, res) => {
  const { title, type, content = '' } = req.body;
  const now = new Date().toISOString();
  const id = sqlInsert(
    'INSERT INTO documents (userId, title, type, words, content, date, status, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [req.user.id, title || '新建文档', type || 'polish', content.length, content, '刚刚', '草稿', now, now]
  );
  cache.del(`docs_list_${req.user.id}`);
  logger.debug('文档创建', { userId: req.user.id, docId: id });
  res.json({ doc: { id, title: title || '新建文档_' + id, date: '刚刚', words: content.length, type: type || 'polish', status: '草稿' } });
});

/**
 * PUT /api/docs/:id
 */
router.put('/:id', authMiddleware, (req, res) => {
  const pid = parseInt(req.params.id);
  const { title, type, content, words, status } = req.body;
  const sets = [];
  const vals = [];
  if (title !== undefined) { sets.push('title = ?'); vals.push(title); }
  if (type !== undefined) { sets.push('type = ?'); vals.push(type); }
  if (content !== undefined) { sets.push('content = ?, words = ?'); vals.push(content, content.length); }
  if (words !== undefined) { sets.push('words = ?'); vals.push(words); }
  if (status !== undefined) { sets.push('status = ?'); vals.push(status); }
  sets.push('date = ?, updatedAt = ?');
  vals.push('刚刚', new Date().toISOString());
  vals.push(pid, req.user.id);
  sqlRun('UPDATE documents SET ' + sets.join(', ') + ' WHERE id = ? AND userId = ?', vals);
  cache.del(`docs_list_${req.user.id}`);
  const d = sqlGet('SELECT id, title, date, words, type, status FROM documents WHERE id = ? AND userId = ?', [pid, req.user.id]);
  if (!d) return res.status(404).json({ error: '文档不存在' });
  res.json({ doc: d });
});

/**
 * DELETE /api/docs/:id
 */
router.delete('/:id', authMiddleware, (req, res) => {
  const pid = parseInt(req.params.id);
  const old = sqlGet('SELECT id FROM documents WHERE id = ? AND userId = ?', [pid, req.user.id]);
  if (!old) return res.status(404).json({ error: '文档不存在' });
  sqlRun('DELETE FROM documents WHERE id = ? AND userId = ?', [pid, req.user.id]);
  cache.del(`docs_list_${req.user.id}`);
  logger.debug('文档删除', { userId: req.user.id, docId: pid });
  res.json({ ok: true });
});

module.exports = router;
