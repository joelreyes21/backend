// server.js
import express from 'express';
import cors from 'cors';
import mysql from 'mysql2/promise';

const app = express();
const PORT = process.env.PORT || 3000; // Render necesita PORT dinámico

app.use(cors());
app.use(express.json());

// ✅ Conexión directa a tu base de datos de Hostinger
const pool = mysql.createPool({
  host: 'srv650.hstgr.io',           // Host de MySQL en Hostinger
  user: 'u752608130_kriss',          // Usuario de tu captura
  password: 'Bancosalado123',        // Contraseña que configuraste en Hostinger
  database: 'u752608130_banco',      // Nombre de tu base de datos
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// ===== Tipos y colores =====
const TIPOS = [
  { letra: 'A', nombre: 'Caja',                   color: '#e74c3c'  },
  { letra: 'B', nombre: 'Servicio al Cliente',    color: '#2ecc71'  },
  { letra: 'C', nombre: 'Créditos y Préstamos',   color: '#3498db'  },
  { letra: 'D', nombre: 'Pagos y Transferencias', color: '#f39c12'  },
  { letra: 'E', nombre: 'Otros Servicios',        color: '#9b59b6'  },
  { letra: 'F', nombre: 'Tercera Edad',           color: '#f4ea5fff'}
];
const ESTADOS = ['desocupada','ocupada','fuera_servicio'];
const colorDe = (letra) => (TIPOS.find(t => t.letra === letra) || {}).color || '#999';

function tipoAleatorio() {
  return TIPOS[Math.floor(Math.random() * TIPOS.length)];
}

function normalizarServicio(servicio) {
  if (servicio == null) return null;
  const s = String(servicio).trim();
  const t = TIPOS.find(t =>
    t.letra.toUpperCase() === s.toUpperCase() ||
    t.nombre.toLowerCase() === s.toLowerCase()
  );
  return t ? t.letra : null;
}

// ===== Tickets =====
app.post('/api/ticket', async (_req, res) => {
  const t = tipoAleatorio();
  const conn = await pool.getConnection();
  try {
    const [[{ total }]] = await conn.query(
      'SELECT COUNT(*) AS total FROM tickets WHERE tipo = ?',
      [t.letra]
    );
    const codigo = `${t.letra}${total + 1}`;
    await conn.query(
      'INSERT INTO tickets (tipo, codigo, color, estado) VALUES (?, ?, ?, "espera")',
      [t.letra, codigo, t.color]
    );
    res.json({ codigo, tipo: t.letra, color: t.color });
  } catch (err) {
    console.error('ticket:', err);
    res.status(500).json({ error: 'Error al generar ticket' });
  } finally {
    conn.release();
  }
});

app.get('/api/cola', async (_req, res) => {
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.query(
      'SELECT * FROM tickets WHERE estado = "espera" ORDER BY id ASC'
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener cola' });
  } finally {
    conn.release();
  }
});

app.post('/api/entregar', async (_req, res) => {
  const conn = await pool.getConnection();
  try {
    const [[siguiente]] = await conn.query(
      'SELECT * FROM tickets WHERE estado = "espera" ORDER BY id ASC LIMIT 1'
    );
    if (!siguiente) return res.status(404).json({ error: 'No hay clientes en espera' });
    res.json({ entregado: siguiente });
  } catch (err) {
    res.status(500).json({ error: 'Error al entregar ticket' });
  } finally {
    conn.release();
  }
});

app.post('/api/reiniciar', async (_req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.query('DELETE FROM tickets');
    await conn.query('UPDATE cajas SET ticket_id = NULL, estado = "desocupada", updated_at = NOW()');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Error al reiniciar' });
  } finally {
    conn.release();
  }
});

// ===== Cajas =====
app.post('/api/cajas', async (req, res) => {
  const letra = normalizarServicio(req.body?.servicio);
  if (!letra) return res.status(400).json({ error: 'Servicio inválido' });
  const conn = await pool.getConnection();
  try {
    const [[{ total }]] = await conn.query('SELECT COUNT(*) AS total FROM cajas');
    const numero = total + 1;
    await conn.query(
      'INSERT INTO cajas (numero, servicio, estado) VALUES (?, ?, "desocupada")',
      [numero, letra]
    );
    res.json({ ok: true, numero, servicio: letra });
  } catch (err) {
    console.error('crear caja:', err);
    res.status(500).json({ error: 'Error al crear caja' });
  } finally {
    conn.release();
  }
});

app.get('/api/cajas', async (_req, res) => {
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.query(
      `SELECT c.*, t.codigo AS cliente_codigo, t.color AS cliente_color
         FROM cajas c
    LEFT JOIN tickets t ON c.ticket_id = t.id
     ORDER BY c.numero ASC`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener cajas' });
  } finally {
    conn.release();
  }
});

async function _actualizarEstadoCajaHandler(req, res) {
  const id = req.params.id;
  const { estado } = req.body || {};
  if (!ESTADOS.includes(String(estado))) {
    return res.status(400).json({ error: 'Estado inválido' });
  }
  const conn = await pool.getConnection();
  try {
    await conn.query('UPDATE cajas SET estado=?, updated_at=NOW() WHERE id=?', [estado, id]);
    const [[row]] = await conn.query('SELECT * FROM cajas WHERE id=?', [id]);
    res.json(row);
  } catch (e) {
    console.error('estado caja:', e);
    res.status(500).json({ error: 'Error al actualizar estado' });
  } finally {
    conn.release();
  }
}
app.patch('/api/cajas/:id/estado', _actualizarEstadoCajaHandler);
app.put('/api/cajas/:id/estado', _actualizarEstadoCajaHandler);

app.put('/api/cajas/:id', async (req, res) => {
  const cajaId = req.params.id;
  const conn = await pool.getConnection();
  try {
    await conn.query(
      `UPDATE cajas
          SET ticket_id = NULL,
              estado = CASE
                         WHEN estado = 'fuera_servicio' THEN 'fuera_servicio'
                         ELSE 'desocupada'
                       END,
              updated_at = NOW()
        WHERE id = ?`,
      [cajaId]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('liberar caja:', err);
    res.status(500).json({ error: 'Error al liberar caja' });
  } finally {
    conn.release();
  }
});

app.put('/api/cajas/:id/asignar', async (req, res) => {
  const cajaId = req.params.id;
  const { cliente_id } = req.body || {};
  const conn = await pool.getConnection();
  try {
    const [[caja]] = await conn.query('SELECT * FROM cajas WHERE id = ?', [cajaId]);
    if (!caja) return res.status(404).json({ error: 'Caja no existe' });
    if ((caja.estado || '').toLowerCase() === 'fuera_servicio') {
      return res.status(409).json({ error: 'Caja fuera de servicio' });
    }
    if ((caja.estado || '').toLowerCase() === 'ocupada' || caja.ticket_id != null) {
      return res.status(409).json({ error: 'Caja ocupada' });
    }

    let ticket = null;
    if (cliente_id) {
      const [[t]] = await conn.query('SELECT * FROM tickets WHERE id = ?', [cliente_id]);
      if (!t || t.estado !== 'espera') return res.status(409).json({ error: 'Ticket no disponible' });
      ticket = t;
    } else {
      const [[t]] = await conn.query(
        'SELECT * FROM tickets WHERE estado = "espera" AND tipo = ? ORDER BY id ASC LIMIT 1',
        [caja.servicio]
      );
      if (!t) return res.status(404).json({ error: 'No hay clientes en espera para este servicio' });
      ticket = t;
    }

    await conn.query(
      'UPDATE cajas SET ticket_id = ?, estado = "ocupada", updated_at = NOW() WHERE id = ?',
      [ticket.id, cajaId]
    );
    await conn.query('UPDATE tickets SET estado = "atendido" WHERE id = ?', [ticket.id]);
    res.json({ ok: true, cajaId, ticketId: ticket.id });
  } catch (err) {
    console.error('asignar:', err);
    res.status(500).json({ error: 'Error al asignar' });
  } finally {
    conn.release();
  }
});

app.listen(PORT, () => {
  console.log(`✅ API escuchando en puerto https://backend-7i6k.onrender.com ${puerto PORT}`);
});
