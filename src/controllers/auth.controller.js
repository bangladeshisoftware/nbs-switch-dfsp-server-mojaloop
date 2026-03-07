const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { pool } = require('../config/db');
const { sendOTPEmail } = require('../services/email.service');
const geoip = require('geoip-lite');
const OTP_EXPIRY_MINUTES = 10;

// POST /auth/login
exports.login = async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password)
      return res.status(400).json({ error: 'Username and password required' });

    const [rows] = await pool.execute(
      `SELECT u.*, d.name as dfsp_name, d.currency, d.status as dfsp_status
       FROM dfsp_users u
       JOIN dfsps d ON u.dfsp_id = d.dfsp_id
       WHERE (u.username = ? OR u.email = ?) AND u.is_active = 1`,
      [username, username],
    );

    const user = rows[0];
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    const otp = Math.floor(100000 + Math.random() * 900000);
    const otpExpiry = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

    await pool.execute(
      `UPDATE dfsp_users SET otp = ?, otp_expires_at = ? WHERE id = ?`,
      [otp, otpExpiry, user.id],
    );
    // send email
    let emailSent;
    try {
      await sendOTPEmail({
        to: user.email,
        username: user.username,
        otp,
      });
      emailSent = true;
      console.log(`[AUTH] OTP sent to ${user.email}`);
    } catch (emailErr) {
      console.error(`[AUTH] Email failed: ${emailErr.message}`);
      if (process.env.NODE_ENV !== 'production') {
        console.log(`[DEV] OTP for ${user.username}: ${otp}`);
      }
    }
    // send email

    // Dev mode
    if (process.env.NODE_ENV !== 'production') {
      console.log(
        `🔑 [DEV] OTP for ${user.username} (${user.dfsp_id}): ${otp}`,
      );
    }

    res.json({
      otp_status: true,
      email_hint: maskEmail(user.email),
      dfsp_id: user.dfsp_id,
      dfsp_name: user.dfsp_name,
      expires_in: `${OTP_EXPIRY_MINUTES} minutes`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// POST /auth/verify-otp
exports.verifyOtp = async (req, res) => {
  try {
    const { username, otp } = req.body;
    if (!username || !otp)
      return res.status(400).json({ error: 'Username and OTP required' });

    const [rows] = await pool.execute(
      `SELECT u.*, d.name as dfsp_name, d.currency, d.status as dfsp_status,
              (u.otp_expires_at IS NOT NULL AND u.otp_expires_at < NOW()) AS is_expired
       FROM dfsp_users u
       JOIN dfsps d ON u.dfsp_id = d.dfsp_id
       WHERE (u.username = ? OR u.email = ?) AND u.is_active = 1 AND u.otp = ?`,
      [username, username, otp],
    );

    const user = rows[0];
    if (!user) return res.status(401).json({ error: 'Invalid OTP' });
    if (user.is_expired) {
      await pool.execute(
        `UPDATE dfsp_users SET otp = NULL, otp_expires_at = NULL WHERE id = ?`,
        [user.id],
      );
      return res
        .status(401)
        .json({ error: 'OTP expired. Please login again.' });
    }

    await pool.execute(
      `UPDATE dfsp_users SET otp = NULL, otp_expires_at = NULL, last_login = NOW() WHERE id = ?`,
      [user.id],
    );
        // Get real client IP (behind proxy if any)
    let ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress || 'unknown';
    if (ip.includes(',')) ip = ip.split(',')[0].trim();

    // Lookup location using geoip-lite
    const geo = geoip.lookup(ip);
    const location = geo
      ? `${geo.city || 'Unknown City'}, ${geo.country || 'Unknown Country'}`
      : 'Unknown';

    // Insert login activity
    await pool.execute(
      `INSERT INTO activity_logs (username, email, login_time, ip_address, location, type)
       VALUES (?, ?, NOW(), ?, ?, ?)`,
      [user.username, user.email, ip, location, 'dfsp']
    );

    const token = jwt.sign(
      {
        id: user.id,
        dfsp_id: user.dfsp_id,
        username: user.username,
        role: user.role,
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '24h' },
    );

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        full_name: user.full_name,
        role: user.role,
        dfsp_id: user.dfsp_id,
        dfsp_name: user.dfsp_name,
        currency: user.currency,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// GET /auth/me
exports.getMe = async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT u.id, u.username, u.email, u.full_name, u.role, u.dfsp_id, u.last_login,
              d.name as dfsp_name, d.currency, d.status as dfsp_status,
              d.callback_url, d.short_name
       FROM dfsp_users u
       JOIN dfsps d ON u.dfsp_id = d.dfsp_id
       WHERE u.id = ?`,
      [req.user.id],
    );
    res.json({ data: rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// GET /auth/users — DFSP নিজের users
exports.getUsers = async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT id, username, email, full_name, role, is_active, last_login, created_at
       FROM dfsp_users WHERE dfsp_id = ? ORDER BY created_at DESC`,
      [req.user.dfsp_id],
    );
    res.json({ data: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// POST /auth/users — নতুন user তৈরি (DFSP ADMIN only)
exports.createUser = async (req, res) => {
  try {
    if (req.user.role !== 'ADMIN')
      return res.status(403).json({ error: 'Only ADMIN can create users' });

    const { username, email, password, full_name, role } = req.body;
    const hashed = await bcrypt.hash(password, 10);

    await pool.execute(
      `INSERT INTO dfsp_users (id, dfsp_id, username, email, password, full_name, role)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        uuidv4(),
        req.user.dfsp_id,
        username,
        email,
        hashed,
        full_name,
        role || 'VIEWER',
      ],
    );

    res.status(201).json({ message: 'User created successfully' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY')
      return res
        .status(409)
        .json({ error: 'Username or email already exists' });
    res.status(500).json({ error: err.message });
  }
};

// PUT /auth/users/:id
exports.updateUser = async (req, res) => {
  try {
    if (req.user.role !== 'ADMIN')
      return res.status(403).json({ error: 'Only ADMIN can update users' });

    const { id } = req.params;
    const { role, is_active, full_name } = req.body;

    await pool.execute(
      `UPDATE dfsp_users SET role = ?, is_active = ?, full_name = ?, updated_at = NOW()
       WHERE id = ? AND dfsp_id = ?`,
      [role, is_active, full_name, id, req.user.dfsp_id],
    );
    res.json({ message: 'User updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

function maskEmail(email) {
  if (!email) return null;
  const [local, domain] = email.split('@');
  return `${local.slice(0, 2)}****@${domain}`;
}
