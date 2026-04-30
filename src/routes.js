// ============================================
// Factor 13: API First
// GET /search         → search with filters
// GET /search/recent  → latest items
// GET /search/stats   → item statistics
// ============================================

const express = require('express');
const db = require('./db');
const authMiddleware = require('./authMiddleware');
const logger = require('./logger');

const router = express.Router();

// -----------------------------------------
// GET /search — Filter items from database
// -----------------------------------------
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { type, category, location, dateFrom, dateTo, keyword, page, limit } = req.query;

    const pageNum = parseInt(page, 10) || 1;
    const limitNum = parseInt(limit, 10) || 20;
    const offset = (pageNum - 1) * limitNum;

    let query = 'SELECT * FROM items WHERE status = $1';
    const params = ['unmatched'];
    let paramIndex = 2;

    // Filter by type (lost / found)
    if (type) {
      query += ` AND type = $${paramIndex}`;
      params.push(type);
      paramIndex++;
    }

    // Filter by category
    if (category) {
      query += ` AND LOWER(category) = LOWER($${paramIndex})`;
      params.push(category);
      paramIndex++;
    }

    // Filter by location (partial match)
    if (location) {
      query += ` AND LOWER(location) LIKE LOWER($${paramIndex})`;
      params.push(`%${location}%`);
      paramIndex++;
    }

    // Filter by date range
    if (dateFrom) {
      query += ` AND date >= $${paramIndex}`;
      params.push(dateFrom);
      paramIndex++;
    }

    if (dateTo) {
      query += ` AND date <= $${paramIndex}`;
      params.push(dateTo);
      paramIndex++;
    }

    // Keyword search in title and description
    if (keyword) {
      query += ` AND (LOWER(title) LIKE LOWER($${paramIndex}) OR LOWER(description) LIKE LOWER($${paramIndex}))`;
      params.push(`%${keyword}%`);
      paramIndex++;
    }

    // Get total count for pagination
    const countQuery = query.replace('SELECT *', 'SELECT COUNT(*)');
    const countResult = await db.query(countQuery, params);
    const totalItems = parseInt(countResult.rows[0].count, 10);

    // Add ordering and pagination
    query += ` ORDER BY created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limitNum, offset);

    const result = await db.query(query, params);

    logger.info({
      filters: { type, category, location, keyword },
      resultsCount: result.rows.length,
      page: pageNum
    }, 'Search executed');

    res.status(200).json({
      items: result.rows,
      pagination: {
        currentPage: pageNum,
        totalPages: Math.ceil(totalItems / limitNum),
        totalItems,
        limit: limitNum
      }
    });
  } catch (err) {
    logger.error({ err }, 'Search failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// -----------------------------------------
// GET /search/recent — Latest reported items
// -----------------------------------------
router.get('/recent', authMiddleware, async (req, res) => {
  try {
    const { type, limit } = req.query;
    const limitNum = parseInt(limit, 10) || 10;

    let query = 'SELECT * FROM items WHERE status = $1';
    const params = ['unmatched'];
    let paramIndex = 2;

    if (type) {
      query += ` AND type = $${paramIndex}`;
      params.push(type);
      paramIndex++;
    }

    query += ` ORDER BY created_at DESC LIMIT $${paramIndex}`;
    params.push(limitNum);

    const result = await db.query(query, params);

    res.status(200).json({ items: result.rows });
  } catch (err) {
    logger.error({ err }, 'Recent items failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// -----------------------------------------
// GET /search/stats — Item statistics
// -----------------------------------------
router.get('/stats', authMiddleware, async (req, res) => {
  try {
    const stats = await db.query(`
      SELECT
        COUNT(*) as total_items,
        COUNT(*) FILTER (WHERE type = 'lost') as lost_items,
        COUNT(*) FILTER (WHERE type = 'found') as found_items,
        COUNT(*) FILTER (WHERE status = 'unmatched') as unmatched_items,
        COUNT(*) FILTER (WHERE status = 'matched') as matched_items
      FROM items
    `);

    const categories = await db.query(`
      SELECT category, COUNT(*) as count
      FROM items
      GROUP BY category
      ORDER BY count DESC
    `);

    res.status(200).json({
      overview: stats.rows[0],
      categories: categories.rows
    });
  } catch (err) {
    logger.error({ err }, 'Stats failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
