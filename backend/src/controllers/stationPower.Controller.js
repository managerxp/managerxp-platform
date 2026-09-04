import pool from '../config/database.js';
import { recordAudit } from '../config/audit.js';

/*
 * Station power actions.
 *
 * The command itself travels over the WebSocket the admin console already
 * holds open to each station — this endpoint does not touch the machine. Its
 * job is to say whether the action is allowed and to write it to the audit
 * trail, so that "who rebooted PC-04 mid-session" always has an answer.
 *
 * The console calls this first and only sends the command if it returns
 * success, which keeps the record and the action in the same order.
 */

const ACTIONS = {
  restart: {
    label: 'Restart',
    summary: 'restarted',
    // Anything that ends a customer's play without them asking is worth
    // flagging when an owner scans the trail.
    disruptive: true
  },
  shutdown: { label: 'Shut down', summary: 'shut down', disruptive: true },
  lock: { label: 'Lock', summary: 'locked', disruptive: false },
  signout: { label: 'Sign out', summary: 'signed out of', disruptive: true },
  'restart-client': { label: 'Restart CafeXP client', summary: 'restarted the client app on', disruptive: false },

  /*
   * Moving the client window out of the way, and putting it back.
   *
   * The client runs as a kiosk: a customer cannot minimise it, exit full
   * screen or close it, which is the point. Staff still need to reach the
   * Windows desktop on a station occasionally — to install a game, to fix a
   * driver — so the console can do for them what the machine itself refuses.
   *
   * Not disruptive: neither touches the session, the billing or anything
   * running. They move a window.
   */
  'minimize-client': {
    label: 'Minimise CafeXP client', summary: 'minimised the client app on', disruptive: false
  },
  'restore-client': {
    label: 'Restore CafeXP client', summary: 'restored the client app on', disruptive: false
  },

  /* Powering on is the one action that never reaches the client — the machine
     is off. The console sends a Wake-on-LAN packet on the café LAN instead.
     It is authorised and audited here like the rest, so "who turned this on"
     is answerable, but nothing is delivered from this server. */
  wake: { label: 'Power on', summary: 'powered on', disruptive: false, viaWakeOnLan: true }
};

// GET /api/stations/power/actions — what the console may offer
export const listActions = async (req, res) => {
  res.status(200).json({
    success: true,
    data: Object.keys(ACTIONS).map((key) => ({
      action: key,
      label: ACTIONS[key].label,
      disruptive: ACTIONS[key].disruptive
    }))
  });
};

// POST /api/stations/power   { pc_name, action, reason }
export const authorisePower = async (req, res) => {
  try {
    const name = String(req.body?.pc_name || '').trim();
    const action = String(req.body?.action || '').trim();
    const reason = req.body?.reason ? String(req.body.reason).trim().slice(0, 200) : null;

    if (!name) {
      return res.status(400).json({ success: false, message: 'A station is required' });
    }
    if (!ACTIONS[action]) {
      return res.status(400).json({
        success: false,
        message: `Unknown action. Use one of: ${Object.keys(ACTIONS).join(', ')}`
      });
    }

    const station = await pool.query(
      'SELECT pc_id, name FROM pcs WHERE name = $1', [name]
    );
    if (station.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Station not found' });
    }

    // A live session is not a hard block — sometimes a machine has to go down
    // — but the console must be able to warn, and the trail must show that
    // the session was running at the time.
    const live = await pool.query(
      `SELECT s.session_id, s.status, c.customer_name, s.guest_name
       FROM sessions s
       LEFT JOIN customers c ON c.customer_id = s.customer_id
       WHERE s.pc_id = $1 AND s.status IN ('active','paused')
       LIMIT 1`,
      [station.rows[0].pc_id]
    );
    const session = live.rows[0] || null;

    await recordAudit(req, {
      action: `station.${action}`,
      category: 'station',
      entity: 'station',
      entity_id: station.rows[0].pc_id,
      sensitive: ACTIONS[action].disruptive,
      summary: `${ACTIONS[action].label} sent to ${name}` +
        (session
          ? ` while ${session.customer_name || session.guest_name || 'a guest'} was playing`
          : '') +
        (reason ? ` — ${reason}` : ''),
      meta: {
        pc_name: name,
        reason,
        session_id: session ? session.session_id : null,
        session_status: session ? session.status : null
      }
    });

    res.status(200).json({
      success: true,
      message: `${ACTIONS[action].label} authorised for ${name}`,
      data: {
        pc_name: name,
        action,
        // The console shows this before it sends, so staff are not surprised.
        active_session: session
          ? {
              session_id: session.session_id,
              status: session.status,
              playing: session.customer_name || session.guest_name || 'a guest'
            }
          : null
      }
    });
  } catch (error) {
    console.error('Error authorising station power action:', error);
    res.status(500).json({ success: false, message: 'Error authorising the action' });
  }
};
