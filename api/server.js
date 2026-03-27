import express from 'express';
import { Server } from 'socket.io';
import { createServer } from 'http';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';

const app = express();
const server = createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static('uploads'));

const DB_FILE = join(process.cwd(), 'db.json');
const UPLOADS_DIR = join(process.cwd(), 'uploads');

if (!existsSync(UPLOADS_DIR)) mkdirSync(UPLOADS_DIR, { recursive: true });

function loadDB() {
  if (existsSync(DB_FILE)) {
    return JSON.parse(readFileSync(DB_FILE, 'utf8'));
  }
  const initialDB = { users: [], messages: {} };
  saveDB(initialDB);
  return initialDB;
}

function saveDB(db) {
  writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

let db = loadDB();
const rooms = ['general', 'random', 'coding'];

// Multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});
const upload = multer({ storage });

const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-key-change-me';

const authenticateToken = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Access denied' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(403).json({ error: 'Invalid token' });
  }
};

// Routes
app.post('/register', async (req, res) => {
  const { username, password, bio } = req.body;
  if (db.users.find(u => u.username === username)) {
    return res.status(400).json({ error: 'Username taken' });
  }
  const hashedPassword = await bcrypt.hash(password, 10);
  const user = {
    id: uuidv4(),
    username,
    password: hashedPassword,
    bio: bio?.slice(0, 150) || '',
    profilePic: 'https://via.placeholder.com/120/5865f2/ffffff?text=👤'
  };
  db.users.push(user);
  saveDB(db);
  res.json({ message: 'User created' });
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const user = db.users.find(u => u.username === username);
  if (!user || !await bcrypt.compare(password, user.password)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '24h' });
  res.json({ 
    token, 
    user: { id: user.id, username: user.username, bio: user.bio, profilePic: user.profilePic } 
  });
});

app.post('/profile', authenticateToken, upload.single('profilePic'), (req, res) => {
  const user = db.users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (req.body.bio) user.bio = req.body.bio.slice(0, 150);
  if (req.file) user.profilePic = `/uploads/${req.file.filename}`;
  saveDB(db);
  res.json({ user });
});

app.get('/profile/:username', (req, res) => {
  const user = db.users.find(u => u.username === req.params.username);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ username: user.username, bio: user.bio, profilePic: user.profilePic });
});

app.get('/rooms', (req, res) => res.json(rooms));

// Socket.IO
io.on('connection', (socket) => {
  socket.on('joinRoom', (room) => socket.join(room));
  socket.on('chatMessage', ({ room, message, username }) => {
    const msg = { username, message, timestamp: new Date().toISOString(), room };
    if (!db.messages[room]) db.messages[room] = [];
    db.messages[room].push(msg);
    if (db.messages[room].length > 100) db.messages[room] = db.messages[room].slice(-100);
    saveDB(db);
    io.to(room).emit('message', msg);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server on ${PORT}`));

export default app;
