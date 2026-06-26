/**************************************************************************
 * Copyright © 2026 Bangladeshi Software Ltd. All rights reserved.
 * Distributed under the license terms specified in this repository.
 *
 * ORIGINAL AUTHOR: Muhammad Nasim (Developer)
 **************************************************************************/

const { pool } = require('../config/db');
const axios = require('axios');

const CL_URL = process.env.CENTRAL_LEDGER_URL;

exports.getDepositsHistory = async (req, res) => {
  try {
    const { dfsp_id } = req.user;
    const { date_from, date_to, page = 1, limit = 50 } = req.query;
    const conditions = ['dfsp_id = ?'];
    const params = [dfsp_id];

    if (date_from) {
      conditions.push('DATE(created_at) >= ?');
      params.push(date_from);
    }
    if (date_to) {
      conditions.push('DATE(created_at) <= ?');
      params.push(date_to);
    }

    const where = `WHERE ${conditions.join(' AND ')}`;
    const lim = Math.min(parseInt(limit) || 50, 200);
    const offset = (Math.max(parseInt(page) || 1, 1) - 1) * lim;

    const [[{ total }]] = await pool.execute(
      `SELECT COUNT(*) AS total FROM dfsp_deposits ${where}`,
      params,
    );

    const [rows] = await pool.execute(
      `SELECT * FROM dfsp_deposits
       ${where}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, lim, offset],
    );

    const [[summary]] = await pool.execute(
      `SELECT
         COUNT(DISTINCT id) AS total_deposits,
         SUM(ABS(amount))      AS total_volume
       FROM dfsp_deposits ${where}`,
      params,
    );

    return res.json({
      data: rows,
      summary: {
        total_windows: parseInt(summary.total_deposits || 0),
        total_volume: parseFloat(summary.total_volume || 0),
      },
      pagination: {
        total,
        pages: Math.ceil(total / lim),
        page: parseInt(page),
        limit: lim,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getPosition = async (req, res) => {
  const { dfsp_id } = req.user;
  try {
    const [[pos]] = await pool.execute(
      `SELECT * FROM dfsp_positions WHERE dfsp_id = ? LIMIT 1`,
      [dfsp_id],
    );

    let clAccounts = [];
    try {
      const r = await axios.get(`${CL_URL}/participants/${dfsp_id}/accounts`);
      clAccounts = r.data || [];
    } catch (e) {
      console.warn(`CL accounts unavailable: ${e.message}`);
    }

    const [history] = await pool.execute(
      `
      SELECT * FROM position_changes WHERE dfsp_id = ?
      ORDER BY created_at DESC LIMIT 20`,
      [dfsp_id],
    );

    res.json({
      position: pos || {},
      cl_accounts: clAccounts,
      history,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getPositionsHistory = async (req, res) => {
  try {
    const { dfsp_id } = req.user;
    const { date_from, date_to, page = 1, limit = 50 } = req.query;

    const conditions = ['dfsp_id = ?'];
    const params = [dfsp_id];

    if (date_from) {
      conditions.push('DATE(created_at) >= ?');
      params.push(date_from);
    }
    if (date_to) {
      conditions.push('DATE(created_at) <= ?');
      params.push(date_to);
    }

    const where = `WHERE ${conditions.join(' AND ')}`;
    const lim = Math.min(parseInt(limit) || 50, 200);
    const offset = (Math.max(parseInt(page) || 1, 1) - 1) * lim;

    const [[{ total }]] = await pool.execute(
      `SELECT COUNT(*) AS total FROM position_changes ${where}`,
      params,
    );

    const [rows] = await pool.execute(
      `SELECT * FROM position_changes
       ${where}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, lim, offset],
    );

    const [[summary]] = await pool.execute(
      `SELECT
         COUNT(DISTINCT id) AS total_deposits,
         SUM(ABS(amount))      AS total_volume
       FROM position_changes ${where}`,
      params,
    );

    return res.json({
      data: rows,
      summary: {
        total_windows: parseInt(summary.total_deposits || 0),
        total_volume: parseFloat(summary.total_volume || 0),
      },
      pagination: {
        total,
        pages: Math.ceil(total / lim),
        page: parseInt(page),
        limit: lim,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getLimits = async (req, res) => {
  const { dfsp_id } = req.user;
  try {
    const [rows] = await pool.execute(
      `SELECT * FROM dfsp_limits WHERE dfsp_id = ? ORDER BY created_at DESC LIMIT 20`,
      [dfsp_id],
    );
    res.json({ data: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getChanges = async (req, res) => {
  const { dfsp_id } = req.user;
  const { page = 1, limit = 30 } = req.query;
  try {
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const [[{ total }]] = await pool.execute(
      `SELECT COUNT(*) AS total FROM position_changes WHERE dfsp_id = ?`,
      [dfsp_id],
    );
    const [rows] = await pool.execute(
      `SELECT * FROM position_changes WHERE dfsp_id = ?
       ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [dfsp_id, parseInt(limit), offset],
    );
    res.json({ data: rows, total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
