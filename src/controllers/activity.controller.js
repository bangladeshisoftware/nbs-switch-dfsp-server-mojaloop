/**************************************************************************
 * Copyright © 2026 Bangladeshi Software Ltd. All rights reserved.
 * Distributed under the license terms specified in this repository.
 *
 * ORIGINAL AUTHOR: Muhammad Nasim (Developer)
 **************************************************************************/

const { pool } = require('../config/db');

exports.getLogs = async (req, res) => {
  try {
    const { dfsp_id } = req.user;
    const { username, page = 1, limit = 50, from, to } = req.query;

    const [dfspUsers] = await pool.execute(
      `SELECT username FROM dfsp_users WHERE dfsp_id = ?`,
      [dfsp_id],
    );
    if (!dfspUsers.length) return res.json({ total: 0, data: [] });

    const usernames = dfspUsers.map((u) => u.username);
    const placeholders = usernames.map(() => '?').join(',');

    const conditions = [`username IN (${placeholders})`, `type = 'dfsp'`];
    const values = [...usernames];

    if (username) {
      conditions.push(`username LIKE ?`);
      values.push(`%${username}%`);
    }
    if (from) {
      conditions.push(`login_time >= ?`);
      values.push(from);
    }
    if (to) {
      conditions.push(`login_time <= ?`);
      values.push(to);
    }

    const where = `WHERE ${conditions.join(' AND ')}`;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const [[{ total }]] = await pool.execute(
      `SELECT COUNT(*) as total FROM activity_logs ${where}`,
      values,
    );

    const [rows] = await pool.execute(
      `SELECT * FROM activity_logs ${where}
       ORDER BY login_time DESC
       LIMIT ? OFFSET ?`,
      [...values, parseInt(limit), offset],
    );

    res.json({
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      pages: Math.ceil(total / parseInt(limit)),
      data: rows,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getStats = async (req, res) => {
  try {
    const { dfsp_id } = req.user;

    const [dfspUsers] = await pool.execute(
      `SELECT username FROM dfsp_users WHERE dfsp_id = ?`,
      [dfsp_id],
    );
    if (!dfspUsers.length) return res.json({ stats: {}, daily: [] });

    const usernames = dfspUsers.map((u) => u.username);
    const placeholders = usernames.map(() => '?').join(',');
    const where = `WHERE username IN (${placeholders}) AND type = 'dfsp'`;

    const [[stats]] = await pool.execute(
      `
      SELECT
        COUNT(*)                                              AS total,
        COUNT(DISTINCT username)                             AS unique_users,
        COUNT(DISTINCT ip_address)                           AS unique_ips,
        SUM(CASE WHEN DATE(login_time) = CURDATE() THEN 1 ELSE 0 END) AS today
      FROM activity_logs ${where}`,
      usernames,
    );

    const [daily] = await pool.execute(
      `
      SELECT DATE(login_time) AS date, COUNT(*) AS total
      FROM activity_logs ${where}
        AND login_time >= DATE_SUB(NOW(), INTERVAL 7 DAY)
      GROUP BY DATE(login_time)
      ORDER BY date DESC`,
      usernames,
    );

    res.json({ stats, daily });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
