const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth.middleware');

const authCtrl = require('../controllers/auth.controller');
const dashCtrl = require('../controllers/dashboard.controller');
const txCtrl = require('../controllers/transfers.controller');
const merchantCtrl = require('../controllers/merchants.controller');
const liqCtrl = require('../controllers/liquidity.controller');

// ─── AUTH ────────────────────────────────────────────────────
router.post('/auth/login', authCtrl.login);
router.post('/auth/verify-otp', authCtrl.verifyOtp);
router.get('/auth/me', auth, authCtrl.getMe);
router.get('/auth/users', auth, authCtrl.getUsers);
router.post('/auth/users', auth, authCtrl.createUser);
router.put('/auth/users/:id', auth, authCtrl.updateUser);

// ─── DASHBOARD ───────────────────────────────────────────────
router.get('/dashboard/summary', auth, dashCtrl.getSummary);

// ─── TRANSFERS ───────────────────────────────────────────────
router.get('/transfers', auth, txCtrl.getTransfers);
router.get('/transfers/stats', auth, txCtrl.getStats);
router.get('/transfers/:id', auth, txCtrl.getById);

// ─── MERCHANTS ───────────────────────────────────────────────
router.get('/merchants', auth, merchantCtrl.getMerchants);
router.get('/merchants/stats', auth, merchantCtrl.getStats);
router.post('/merchants', auth, merchantCtrl.create);
router.get('/merchants/:id', auth, merchantCtrl.getById);
router.put('/merchants/:id', auth, merchantCtrl.update);
router.put('/merchants/:id/status', auth, merchantCtrl.updateStatus);
router.delete('/merchants/:id', auth, merchantCtrl.deleteMerchant);

// ─── LIQUIDITY ───────────────────────────────────────────────
router.get('/liquidity/position', auth, liqCtrl.getPosition);
router.get('/liquidity/limits', auth, liqCtrl.getLimits);
router.get('/liquidity/changes', auth, liqCtrl.getChanges);

module.exports = router;
